import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { KeyRotationManager } from './src/server/keyManager.ts';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Initialize Key Rotation and Quota Manager
const keyManager = new KeyRotationManager();

// -------------------------------------------------------------
// Health Check Endpoint (Render & Uptime monitors)
// -------------------------------------------------------------
app.get('/api/health', (req: Request, res: Response) => {
  const keys = keyManager.getAvailableKeys();
  const activeKeyId = keyManager.getActiveKeyId();
  const healthyCount = keys.filter(k => k.stats.status === 'healthy').length;

  res.json({
    status: 'ok',
    service: 'awesome-freellm-apis-rotator',
    timestamp: new Date().toISOString(),
    totalKeys: keys.length,
    healthyKeys: healthyCount,
    activeKeyId,
    safeQuotaMode: 'RPM <= 14, TPD <= 1M (Free Tier Safe)',
  });
});

// -------------------------------------------------------------
// Config Endpoints (Read / Update config.yaml)
// -------------------------------------------------------------
app.get('/api/config', (req: Request, res: Response) => {
  try {
    const config = keyManager.getConfig();
    const rawYaml = keyManager.getRawYaml();
    res.json({ success: true, config, rawYaml });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config', (req: Request, res: Response) => {
  try {
    const { yamlContent } = req.body;
    if (!yamlContent) {
      return res.status(400).json({ success: false, error: 'yamlContent alanı gereklidir.' });
    }
    const result = keyManager.saveConfig(yamlContent);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json({ success: true, message: 'config.yaml başarıyla güncellendi ve yeniden yüklendi.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Pool & Key Management Endpoints
// -------------------------------------------------------------
app.get('/api/pool/status', (req: Request, res: Response) => {
  try {
    const keys = keyManager.getAvailableKeys();
    const activeKeyId = keyManager.getActiveKeyId();
    const logs = keyManager.getLogs();
    const config = keyManager.getConfig();

    // Summary calculations
    const totalRpm = keys.reduce((sum, k) => sum + k.stats.currentRpm, 0);
    const totalDailyTokens = keys.reduce((sum, k) => sum + k.stats.dailyTokens, 0);
    const totalDailyRequests = keys.reduce((sum, k) => sum + k.stats.dailyRequests, 0);

    res.json({
      success: true,
      activeKeyId,
      keys: keys.map(k => k.stats),
      logs,
      metrics: {
        totalKeys: keys.length,
        healthyKeys: keys.filter(k => k.stats.status === 'healthy').length,
        coolingDownKeys: keys.filter(k => k.stats.status === 'cooling_down').length,
        quotaExhaustedKeys: keys.filter(k => k.stats.status === 'quota_exhausted').length,
        totalRpm,
        maxPoolRpm: (config.rate_limits?.max_rpm_per_key || 14) * keys.length,
        totalDailyTokens,
        totalDailyRequests,
        strategy: config.rotation.strategy,
        idleTimeout: config.rotation.idle_timeout_seconds,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pool/select-key', (req: Request, res: Response) => {
  const { keyId } = req.body;
  if (!keyId) return res.status(400).json({ error: 'keyId required' });
  const ok = keyManager.manualSelectKey(keyId);
  res.json({ success: ok, activeKeyId: keyManager.getActiveKeyId() });
});

app.post('/api/pool/toggle-key', (req: Request, res: Response) => {
  const { keyId, enabled } = req.body;
  if (!keyId || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'keyId and enabled boolean required' });
  }
  const ok = keyManager.toggleKey(keyId, enabled);
  res.json({ success: ok });
});

app.post('/api/pool/reset-stats', (req: Request, res: Response) => {
  const { keyId } = req.body;
  keyManager.resetKeyStats(keyId);
  res.json({ success: true, message: 'İstatistikler ve soğuma süreleri sıfırlandı.' });
});

app.post('/api/pool/add-key', (req: Request, res: Response) => {
  const { name, key, priority } = req.body;
  if (!key || typeof key !== 'string' || key.trim().length < 5) {
    return res.status(400).json({ error: 'Geçerli bir API anahtarı giriniz.' });
  }
  const created = keyManager.addKey({ name, key, priority });
  res.json({ success: true, key: created });
});

app.post('/api/pool/delete-key', (req: Request, res: Response) => {
  const { keyId } = req.body;
  if (!keyId) return res.status(400).json({ error: 'keyId required' });
  const ok = keyManager.deleteKey(keyId);
  res.json({ success: ok });
});

// -------------------------------------------------------------
// Native Gemini Generation API (Rotator + Failover Protected)
// -------------------------------------------------------------
app.post('/api/gemini/generate', async (req: Request, res: Response) => {
  const { prompt, model, systemInstruction, temperature } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt parametresi zorunludur.' });
  }

  const targetModel = model || keyManager.getConfig().default_model || 'gemini-3.8-flash';

  try {
    const response = await keyManager.executeWithRotation(
      async (ai, keyConfig) => {
        const genResponse = await ai.models.generateContent({
          model: targetModel,
          contents: prompt,
          config: {
            systemInstruction: systemInstruction || undefined,
            temperature: typeof temperature === 'number' ? temperature : 0.7,
          },
        });

        const text = genResponse.text || '';
        // Estimate token count roughly (1 token ~ 4 characters)
        const estimatedTokens = Math.ceil((prompt.length + text.length) / 4) + 20;

        return {
          result: {
            text,
            model: targetModel,
            candidatesCount: genResponse.candidates?.length || 1,
          },
          estimatedTokens,
        };
      },
      { requestedModel: targetModel }
    );

    res.json({
      success: true,
      text: response.data.text,
      model: response.data.model,
      keyUsed: {
        id: response.keyUsed.id,
        name: response.keyUsed.name,
        maskedKey: response.keyUsed.maskedKey,
        currentRpm: response.keyUsed.currentRpm,
        dailyTokens: response.keyUsed.dailyTokens,
      },
      rotationInfo: {
        attempts: response.attempts,
        rotated: response.rotated,
      },
    });
  } catch (err: any) {
    console.error('Gemini Generate Error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Gemini API çağrısı başarısız oldu.',
    });
  }
});

// -------------------------------------------------------------
// OpenAI-Compatible Proxy Endpoint: /v1/chat/completions
// For Cursor, Claude Code, Cline, Open WebUI, Python OpenAI SDK
// -------------------------------------------------------------
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const { messages, model, temperature, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid messages array', type: 'invalid_request_error' },
    });
  }

  const targetModel = model || keyManager.getConfig().default_model || 'gemini-3.8-flash';

  // Format messages for Gemini
  let systemText = '';
  const promptParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemText += (systemText ? '\n' : '') + msg.content;
    } else {
      promptParts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
    }
  }

  const fullPrompt = promptParts.join('\n\n') || 'Hello';

  try {
    const response = await keyManager.executeWithRotation(
      async (ai, keyConfig) => {
        const genResponse = await ai.models.generateContent({
          model: targetModel,
          contents: fullPrompt,
          config: {
            systemInstruction: systemText || undefined,
            temperature: typeof temperature === 'number' ? temperature : 0.7,
            maxOutputTokens: typeof max_tokens === 'number' ? max_tokens : undefined,
          },
        });

        const text = genResponse.text || '';
        const estimatedTokens = Math.ceil((fullPrompt.length + text.length) / 4) + 30;

        return {
          result: { text },
          estimatedTokens,
        };
      },
      { requestedModel: targetModel }
    );

    const completionId = 'chatcmpl-' + Date.now().toString(36);
    res.json({
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: targetModel,
      system_fingerprint: `fp_rotator_${response.keyUsed.id}`,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.data.text,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(fullPrompt.length / 4),
        completion_tokens: Math.ceil(response.data.text.length / 4),
        total_tokens: Math.ceil((fullPrompt.length + response.data.text.length) / 4),
      },
      _rotator_meta: {
        keyId: response.keyUsed.id,
        keyName: response.keyUsed.name,
        rotated: response.rotated,
        attempts: response.attempts,
      },
    });
  } catch (err: any) {
    console.error('OpenAI Proxy Error:', err);
    res.status(500).json({
      error: {
        message: err.message || 'Internal proxy error',
        type: 'api_error',
      },
    });
  }
});

// OpenAI models list endpoint: /v1/models
app.get('/v1/models', (req: Request, res: Response) => {
  const config = keyManager.getConfig();
  const models = (config.models || []).map(m => ({
    id: m.id,
    object: 'model',
    created: 1700000000,
    owned_by: 'google-gemini',
    permission: [],
    root: m.id,
    parent: null,
  }));
  res.json({ object: 'list', data: models });
});

// -------------------------------------------------------------
// Vite Dev Server / Production Static Serving
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Gemini Rotator Proxy] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[Gemini Rotator Proxy] Active rotation strategy: ${keyManager.getConfig().rotation.strategy}`);
    console.log(`[Gemini Rotator Proxy] Safe Free Tier Limits: RPM <= 14, TPD <= 1,000,000`);
  });
}

startServer().catch(err => {
  console.error('Server startup error:', err);
});
