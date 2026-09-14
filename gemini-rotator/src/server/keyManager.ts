import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { GoogleGenAI } from '@google/genai';

export interface KeyConfig {
  id: string;
  name: string;
  key: string;
  env_var?: string;
  provider: string;
  enabled: boolean;
  priority: number;
}

export interface KeyStats {
  id: string;
  name: string;
  maskedKey: string;
  provider: string;
  enabled: boolean;
  priority: number;
  status: 'healthy' | 'cooling_down' | 'quota_exhausted' | 'error' | 'disabled';
  statusMessage?: string;
  cooldownUntil?: number; // timestamp
  lastUsedAt?: number;
  
  // RPM Tracking (Sliding 60 seconds)
  currentRpm: number;
  rpmLimit: number;
  
  // Daily Tracking (Resets daily at 00:00 UTC)
  dailyRequests: number;
  rpdLimit: number;
  dailyTokens: number;
  tpdLimit: number;
  
  totalSuccess: number;
  totalErrors: number;
  lastError?: string;
}

export interface RotationLog {
  id: string;
  timestamp: number;
  fromKeyId?: string;
  toKeyId: string;
  reason: 'initial' | 'round_robin' | 'idle_timeout' | 'rate_limit_429' | 'quota_exhausted' | 'manual';
  details: string;
}

export interface AppConfig {
  server: {
    port: number;
    host: string;
    openai_compatibility: boolean;
    enable_cors: boolean;
    log_level: string;
  };
  default_provider: string;
  default_model: string;
  rate_limits: {
    max_rpm_per_key: number;
    max_tpm_per_key: number;
    max_rpd_per_key: number;
    max_tpd_per_key: number;
    queue_when_limited: boolean;
    max_queue_size: number;
    queue_timeout_ms: number;
  };
  rotation: {
    strategy: 'failover_on_error' | 'round_robin' | 'least_used';
    switch_on_429: boolean;
    switch_on_quota_exhausted: boolean;
    switch_on_error_codes: number[];
    switch_on_idle: boolean;
    idle_timeout_seconds: number;
    max_retry_attempts: number;
    retry_delay_ms: number;
    cooldown_on_rate_limit_seconds: number;
    cooldown_on_quota_exceeded_seconds: number;
    cooldown_on_unknown_error_seconds: number;
  };
  keys_pool: KeyConfig[];
  models: Array<{
    id: string;
    provider: string;
    display_name: string;
    type: string;
    context_window: number;
    is_free: boolean;
  }>;
}

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

export class KeyRotationManager {
  private configPath: string;
  private config!: AppConfig;
  private rawConfigYaml: string = '';
  private keys: Map<string, { config: KeyConfig; stats: KeyStats; requests: RequestRecord[] }> = new Map();
  private activeKeyId: string | null = null;
  private rotationLogs: RotationLog[] = [];
  private lastActiveTimestamp: number = Date.now();
  private lastResetDay: string = new Date().toISOString().slice(0, 10);

  constructor(configPath?: string) {
    this.configPath = configPath || path.resolve(process.cwd(), 'config.yaml');
    this.loadConfig();
    this.initKeys();
    
    // Periodic maintenance timer (cleans sliding window & resets day stats)
    setInterval(() => this.maintenanceTick(), 2000);
  }

  public loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        this.rawConfigYaml = fs.readFileSync(this.configPath, 'utf8');
        this.config = yaml.load(this.rawConfigYaml) as AppConfig;
      } else {
        this.config = this.getDefaultConfig();
        this.rawConfigYaml = yaml.dump(this.config);
      }
    } catch (err) {
      console.error('Failed to parse config.yaml, using defaults:', err);
      this.config = this.getDefaultConfig();
    }
  }

  public saveConfig(yamlContent: string): { success: boolean; error?: string } {
    try {
      const parsed = yaml.load(yamlContent) as AppConfig;
      if (!parsed || !parsed.rate_limits || !parsed.rotation) {
        return { success: false, error: 'Geçersiz config yapısı: rate_limits veya rotation eksik.' };
      }
      fs.writeFileSync(this.configPath, yamlContent, 'utf8');
      this.rawConfigYaml = yamlContent;
      this.config = parsed;
      this.initKeys();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'YAML kaydetme hatası' };
    }
  }

  public getRawYaml(): string {
    return this.rawConfigYaml;
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  private getDefaultConfig(): AppConfig {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        openai_compatibility: true,
        enable_cors: true,
        log_level: 'info',
      },
      default_provider: 'google-gemini',
      default_model: 'gemini-3.8-flash',
      rate_limits: {
        max_rpm_per_key: 14,
        max_tpm_per_key: 1000000,
        max_rpd_per_key: 1500,
        max_tpd_per_key: 1000000,
        queue_when_limited: true,
        max_queue_size: 50,
        queue_timeout_ms: 25000,
      },
      rotation: {
        strategy: 'failover_on_error',
        switch_on_429: true,
        switch_on_quota_exhausted: true,
        switch_on_error_codes: [429, 503, 403],
        switch_on_idle: true,
        idle_timeout_seconds: 180,
        max_retry_attempts: 3,
        retry_delay_ms: 1000,
        cooldown_on_rate_limit_seconds: 65,
        cooldown_on_quota_exceeded_seconds: 86400,
        cooldown_on_unknown_error_seconds: 120,
      },
      keys_pool: [],
      models: [
        {
          id: 'gemini-3.8-flash',
          provider: 'google-gemini',
          display_name: 'Gemini 3.8 Flash (Free/Recommended)',
          type: 'chat',
          context_window: 1048576,
          is_free: true,
        },
      ],
    };
  }

  private maskKey(key: string): string {
    if (!key) return '(no-key)';
    if (key.length <= 8) return '****' + key.slice(-2);
    return key.slice(0, 6) + '...' + key.slice(-4);
  }

  private initKeys(): void {
    const existingStats = new Map<string, KeyStats>();
    for (const [id, val] of this.keys.entries()) {
      existingStats.set(id, val.stats);
    }

    this.keys.clear();

    const discoveredKeys: KeyConfig[] = [];

    // 1. Check GEMINI_API_KEYS (comma separated in environment)
    if (process.env.GEMINI_API_KEYS) {
      const keys = process.env.GEMINI_API_KEYS.split(',')
        .map(k => k.trim())
        .filter(Boolean);
      keys.forEach((k, idx) => {
        discoveredKeys.push({
          id: `env-multi-key-${idx + 1}`,
          name: `Render Env Key #${idx + 1}`,
          key: k,
          provider: 'google-gemini',
          enabled: true,
          priority: idx + 1,
        });
      });
    }

    // 2. Check individual environment keys
    if (process.env.GEMINI_API_KEY && !discoveredKeys.some(k => k.key === process.env.GEMINI_API_KEY)) {
      discoveredKeys.push({
        id: 'env-primary-key',
        name: 'Primary Env Key (GEMINI_API_KEY)',
        key: process.env.GEMINI_API_KEY,
        env_var: 'GEMINI_API_KEY',
        provider: 'google-gemini',
        enabled: true,
        priority: 0,
      });
    }

    // 3. Check keys from config.yaml
    if (Array.isArray(this.config.keys_pool)) {
      for (const kc of this.config.keys_pool) {
        let keyValue = kc.key || '';
        if (kc.env_var && process.env[kc.env_var]) {
          keyValue = process.env[kc.env_var]!;
        }
        if (keyValue && !discoveredKeys.some(k => k.key === keyValue || k.id === kc.id)) {
          discoveredKeys.push({
            id: kc.id,
            name: kc.name || kc.id,
            key: keyValue,
            env_var: kc.env_var,
            provider: kc.provider || 'google-gemini',
            enabled: kc.enabled !== false,
            priority: kc.priority || 10,
          });
        }
      }
    }

    // If still no keys found (e.g. testing in sandbox without custom secret), add a dummy placeholder
    if (discoveredKeys.length === 0) {
      discoveredKeys.push({
        id: 'placeholder-demo-key-1',
        name: 'Demo Gemini Key #1',
        key: 'AIzaSyDemoKeyExampleSlot1_PleaseSetGeminiApiKey',
        provider: 'google-gemini',
        enabled: true,
        priority: 1,
      });
      discoveredKeys.push({
        id: 'placeholder-demo-key-2',
        name: 'Demo Gemini Key #2 (Backup)',
        key: 'AIzaSyDemoKeyExampleSlot2_BackupSlotForRotation',
        provider: 'google-gemini',
        enabled: true,
        priority: 2,
      });
    }

    // Register all discovered keys
    for (const kc of discoveredKeys) {
      const prev = existingStats.get(kc.id);
      this.keys.set(kc.id, {
        config: kc,
        requests: [],
        stats: prev || {
          id: kc.id,
          name: kc.name,
          maskedKey: this.maskKey(kc.key),
          provider: kc.provider,
          enabled: kc.enabled,
          priority: kc.priority,
          status: 'healthy',
          currentRpm: 0,
          rpmLimit: this.config.rate_limits?.max_rpm_per_key || 14,
          dailyRequests: 0,
          rpdLimit: this.config.rate_limits?.max_rpd_per_key || 1500,
          dailyTokens: 0,
          tpdLimit: this.config.rate_limits?.max_tpd_per_key || 1000000,
          totalSuccess: 0,
          totalErrors: 0,
        },
      });
    }

    if (!this.activeKeyId || !this.keys.has(this.activeKeyId)) {
      const firstEnabled = Array.from(this.keys.values()).find(k => k.config.enabled);
      if (firstEnabled) {
        this.activeKeyId = firstEnabled.config.id;
        this.addLog(undefined, this.activeKeyId, 'initial', 'Sistem başlangıcı: İlk sağlıklı anahtar seçildi.');
      }
    }
  }

  private addLog(fromKeyId: string | undefined, toKeyId: string, reason: RotationLog['reason'], details: string) {
    const log: RotationLog = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      timestamp: Date.now(),
      fromKeyId,
      toKeyId,
      reason,
      details,
    };
    this.rotationLogs.unshift(log);
    if (this.rotationLogs.length > 50) {
      this.rotationLogs.pop();
    }
  }

  private maintenanceTick(): void {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    // Reset daily counters if day changed
    if (today !== this.lastResetDay) {
      this.lastResetDay = today;
      for (const item of this.keys.values()) {
        item.stats.dailyRequests = 0;
        item.stats.dailyTokens = 0;
        if (item.stats.status === 'quota_exhausted') {
          item.stats.status = 'healthy';
          item.stats.statusMessage = 'Yeni gün başladı: Günlük kota sıfırlandı.';
        }
      }
    }

    // Clean sliding window (60 seconds) for RPM
    for (const item of this.keys.values()) {
      item.requests = item.requests.filter(r => now - r.timestamp < 60000);
      item.stats.currentRpm = item.requests.length;

      // Check cooldown expiry
      if (item.stats.status === 'cooling_down' && item.stats.cooldownUntil) {
        if (now >= item.stats.cooldownUntil) {
          item.stats.status = 'healthy';
          item.stats.cooldownUntil = undefined;
          item.stats.statusMessage = 'Soğuma süresi bitti, anahtar tekrar sağlıklı.';
        }
      }
    }

    // Check idle switch
    if (this.config.rotation.switch_on_idle && this.activeKeyId) {
      const idleTimeSec = (now - this.lastActiveTimestamp) / 1000;
      if (idleTimeSec >= this.config.rotation.idle_timeout_seconds) {
        // Switch to next healthy key to rotate when idle
        const next = this.findNextAvailableKey(this.activeKeyId);
        if (next && next.config.id !== this.activeKeyId) {
          const prev = this.activeKeyId;
          this.activeKeyId = next.config.id;
          this.lastActiveTimestamp = now;
          this.addLog(
            prev,
            next.config.id,
            'idle_timeout',
            `Anahtar ${Math.round(idleTimeSec)}s boyunca boşta kaldı, otomatik olarak diğer anahtara devredildi.`
          );
        }
      }
    }
  }

  public getAvailableKeys(): Array<{ config: KeyConfig; stats: KeyStats }> {
    return Array.from(this.keys.values()).map(v => ({ config: v.config, stats: v.stats }));
  }

  public getActiveKeyId(): string | null {
    return this.activeKeyId;
  }

  public getLogs(): RotationLog[] {
    return this.rotationLogs;
  }

  public findNextAvailableKey(excludeKeyId?: string): { config: KeyConfig; stats: KeyStats } | null {
    const all = Array.from(this.keys.values()).filter(k => k.config.enabled);
    if (all.length === 0) return null;

    const healthyList = all.filter(k => {
      if (k.config.id === excludeKeyId) return false;
      if (k.stats.status === 'disabled') return false;
      if (k.stats.status === 'quota_exhausted') return false;
      if (k.stats.status === 'cooling_down' && k.stats.cooldownUntil && Date.now() < k.stats.cooldownUntil) {
        return false;
      }
      // Check RPM ceiling
      if (k.stats.currentRpm >= (this.config.rate_limits?.max_rpm_per_key || 14)) {
        return false;
      }
      // Check TPD ceiling
      if (k.stats.dailyTokens >= (this.config.rate_limits?.max_tpd_per_key || 1000000)) {
        return false;
      }
      return true;
    });

    if (healthyList.length === 0) {
      // If none completely healthy, find any that is not quota exhausted and not explicitly disabled
      const nonExhausted = all.filter(k => k.config.id !== excludeKeyId && k.stats.status !== 'quota_exhausted');
      if (nonExhausted.length > 0) return nonExhausted[0];
      return all[0];
    }

    if (this.config.rotation.strategy === 'least_used') {
      // Sort by dailyTokens or currentRpm
      healthyList.sort((a, b) => a.stats.dailyTokens - b.stats.dailyTokens || a.stats.currentRpm - b.stats.currentRpm);
      return healthyList[0];
    }

    // Default: Round-robin or Priority
    healthyList.sort((a, b) => a.config.priority - b.config.priority);
    return healthyList[0];
  }

  public manualSelectKey(keyId: string): boolean {
    if (!this.keys.has(keyId)) return false;
    const prev = this.activeKeyId;
    this.activeKeyId = keyId;
    this.lastActiveTimestamp = Date.now();
    this.addLog(prev || undefined, keyId, 'manual', 'Kullanıcı panodan manuel anahtar seçti.');
    return true;
  }

  public toggleKey(keyId: string, enabled: boolean): boolean {
    const item = this.keys.get(keyId);
    if (!item) return false;
    item.config.enabled = enabled;
    item.stats.enabled = enabled;
    item.stats.status = enabled ? 'healthy' : 'disabled';
    if (!enabled && this.activeKeyId === keyId) {
      const next = this.findNextAvailableKey(keyId);
      if (next) {
        this.activeKeyId = next.config.id;
        this.addLog(keyId, next.config.id, 'manual', 'Aktif anahtar devre dışı bırakıldığı için sonrakine geçildi.');
      }
    }
    return true;
  }

  public resetKeyStats(keyId?: string): void {
    if (keyId && this.keys.has(keyId)) {
      const item = this.keys.get(keyId)!;
      item.stats.currentRpm = 0;
      item.stats.dailyRequests = 0;
      item.stats.dailyTokens = 0;
      item.stats.status = item.config.enabled ? 'healthy' : 'disabled';
      item.stats.cooldownUntil = undefined;
      item.stats.lastError = undefined;
      item.requests = [];
    } else {
      for (const item of this.keys.values()) {
        item.stats.currentRpm = 0;
        item.stats.dailyRequests = 0;
        item.stats.dailyTokens = 0;
        item.stats.status = item.config.enabled ? 'healthy' : 'disabled';
        item.stats.cooldownUntil = undefined;
        item.stats.lastError = undefined;
        item.requests = [];
      }
    }
  }

  public addKey(keyData: { name: string; key: string; priority?: number }): KeyConfig {
    const id = 'key-custom-' + Date.now().toString(36);
    const kc: KeyConfig = {
      id,
      name: keyData.name || 'Custom Key ' + this.keys.size,
      key: keyData.key.trim(),
      provider: 'google-gemini',
      enabled: true,
      priority: keyData.priority || this.keys.size + 1,
    };
    this.keys.set(id, {
      config: kc,
      requests: [],
      stats: {
        id: kc.id,
        name: kc.name,
        maskedKey: this.maskKey(kc.key),
        provider: kc.provider,
        enabled: true,
        priority: kc.priority,
        status: 'healthy',
        currentRpm: 0,
        rpmLimit: this.config.rate_limits?.max_rpm_per_key || 14,
        dailyRequests: 0,
        rpdLimit: this.config.rate_limits?.max_rpd_per_key || 1500,
        dailyTokens: 0,
        tpdLimit: this.config.rate_limits?.max_tpd_per_key || 1000000,
        totalSuccess: 0,
        totalErrors: 0,
      },
    });

    if (!this.activeKeyId) {
      this.activeKeyId = id;
    }
    return kc;
  }

  public deleteKey(keyId: string): boolean {
    if (!this.keys.has(keyId)) return false;
    this.keys.delete(keyId);
    if (this.activeKeyId === keyId) {
      const next = this.findNextAvailableKey();
      this.activeKeyId = next ? next.config.id : null;
    }
    return true;
  }

  /**
   * Main proxy execution method: executes with auto-rotation, rate limiting, and failover
   */
  public async executeWithRotation<T>(
    operation: (ai: GoogleGenAI, keyConfig: KeyConfig) => Promise<{ result: T; estimatedTokens?: number }>,
    options?: { requestedModel?: string }
  ): Promise<{ data: T; keyUsed: KeyStats; attempts: number; rotated: boolean }> {
    const maxAttempts = Math.min(this.config.rotation.max_retry_attempts || 3, this.keys.size || 1);
    let attempts = 0;
    let rotated = false;
    let lastError: any = null;

    // Pick starting key
    let currentKeyItem = this.activeKeyId ? this.keys.get(this.activeKeyId) : null;
    if (!currentKeyItem || !currentKeyItem.config.enabled || currentKeyItem.stats.status === 'disabled') {
      const next = this.findNextAvailableKey();
      if (!next) {
        throw new Error('Havuzda kullanılabilir hiçbir aktif API anahtarı bulunamadı.');
      }
      currentKeyItem = this.keys.get(next.config.id)!;
      this.activeKeyId = next.config.id;
    }

    while (attempts < maxAttempts) {
      attempts++;
      const currentKey = currentKeyItem.config;
      const stats = currentKeyItem.stats;

      // Rate limit check before sending
      const maxRpm = this.config.rate_limits.max_rpm_per_key || 14;
      const maxTpd = this.config.rate_limits.max_tpd_per_key || 1000000;

      if (stats.currentRpm >= maxRpm) {
        // Key hit local RPM threshold! Put on short cooldown and switch to next key
        stats.status = 'cooling_down';
        stats.cooldownUntil = Date.now() + (this.config.rotation.cooldown_on_rate_limit_seconds || 65) * 1000;
        stats.statusMessage = `Yerel RPM limiti (${stats.currentRpm}/${maxRpm}) aşıldı. Soğumaya alındı.`;

        const next = this.findNextAvailableKey(currentKey.id);
        if (next && next.config.id !== currentKey.id) {
          this.addLog(
            currentKey.id,
            next.config.id,
            'rate_limit_429',
            `Anahtar [${stats.name}] RPM sınırına (${stats.currentRpm}) ulaştı. Kota yormamak için [${next.stats.name}] anahtarına geçildi.`
          );
          currentKeyItem = this.keys.get(next.config.id)!;
          this.activeKeyId = next.config.id;
          rotated = true;
          continue;
        }
      }

      if (stats.dailyTokens >= maxTpd) {
        stats.status = 'quota_exhausted';
        stats.statusMessage = `Günlük token kotası (${stats.dailyTokens}/${maxTpd}) aşıldı.`;
        const next = this.findNextAvailableKey(currentKey.id);
        if (next && next.config.id !== currentKey.id) {
          this.addLog(
            currentKey.id,
            next.config.id,
            'quota_exhausted',
            `Anahtar [${stats.name}] günlük TPD kotasına ulaştı. [${next.stats.name}] anahtarına geçildi.`
          );
          currentKeyItem = this.keys.get(next.config.id)!;
          this.activeKeyId = next.config.id;
          rotated = true;
          continue;
        }
      }

      try {
        // Instantiate server-side GoogleGenAI client with telemetry
        const ai = new GoogleGenAI({
          apiKey: currentKey.key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const startTime = Date.now();
        const { result, estimatedTokens = 150 } = await operation(ai, currentKey);

        // Success! Record metrics
        this.lastActiveTimestamp = Date.now();
        stats.lastUsedAt = Date.now();
        stats.totalSuccess++;
        stats.dailyRequests++;
        stats.dailyTokens += estimatedTokens;
        currentKeyItem.requests.push({ timestamp: Date.now(), tokens: estimatedTokens });
        stats.currentRpm = currentKeyItem.requests.length;

        // If strategy is round-robin, switch active key for NEXT request
        if (this.config.rotation.strategy === 'round_robin') {
          const next = this.findNextAvailableKey(currentKey.id);
          if (next && next.config.id !== currentKey.id) {
            this.activeKeyId = next.config.id;
            this.addLog(currentKey.id, next.config.id, 'round_robin', 'Round-Robin: Sıradaki anahtara önceden geçildi.');
          }
        }

        return {
          data: result,
          keyUsed: { ...stats },
          attempts,
          rotated,
        };
      } catch (err: any) {
        lastError = err;
        stats.totalErrors++;
        const errMsg = err.message || String(err);
        stats.lastError = errMsg;

        const isRateLimit =
          errMsg.includes('429') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('Quota exceeded') ||
          errMsg.includes('rateLimitExceeded');

        const isDailyQuota =
          errMsg.includes('daily') ||
          errMsg.includes('Daily limit') ||
          errMsg.includes('PerDay');

        if (isDailyQuota) {
          stats.status = 'quota_exhausted';
          stats.statusMessage = 'Google API Günlük Kotası (TPD/RPD) doldu.';
        } else if (isRateLimit) {
          stats.status = 'cooling_down';
          stats.cooldownUntil = Date.now() + (this.config.rotation.cooldown_on_rate_limit_seconds || 65) * 1000;
          stats.statusMessage = 'Google 429 Too Many Requests hatası aldı. 65s soğumaya alındı.';
        } else {
          stats.status = 'error';
          stats.statusMessage = errMsg.slice(0, 100);
        }

        // Auto failover to next key!
        const next = this.findNextAvailableKey(currentKey.id);
        if (next && next.config.id !== currentKey.id) {
          const reason = isDailyQuota ? 'quota_exhausted' : isRateLimit ? 'rate_limit_429' : 'rate_limit_429';
          this.addLog(
            currentKey.id,
            next.config.id,
            reason,
            `HATA [${currentKey.name}]: ${errMsg.slice(0, 70)}... -> Otomatik olarak [${next.stats.name}] anahtarına geçildi.`
          );
          currentKeyItem = this.keys.get(next.config.id)!;
          this.activeKeyId = next.config.id;
          rotated = true;
          // brief delay before retry
          await new Promise(res => setTimeout(res, this.config.rotation.retry_delay_ms || 800));
          continue;
        } else {
          break;
        }
      }
    }

    throw lastError || new Error('Tüm API anahtarları denendi ancak istek tamamlanamadı.');
  }
}
