import React, { useState, useEffect } from 'react';
import {
  Key,
  ShieldCheck,
  Activity,
  FileCode,
  Terminal,
  CloudUpload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  Copy,
  Download,
  Plus,
  Trash2,
  Play,
  ArrowRight,
  ExternalLink,
  Layers,
  Settings2,
  Check,
} from 'lucide-react';

interface KeyStats {
  id: string;
  name: string;
  maskedKey: string;
  provider: string;
  enabled: boolean;
  priority: number;
  status: 'healthy' | 'cooling_down' | 'quota_exhausted' | 'error' | 'disabled';
  statusMessage?: string;
  cooldownUntil?: number;
  lastUsedAt?: number;
  currentRpm: number;
  rpmLimit: number;
  dailyRequests: number;
  rpdLimit: number;
  dailyTokens: number;
  tpdLimit: number;
  totalSuccess: number;
  totalErrors: number;
  lastError?: string;
}

interface RotationLog {
  id: string;
  timestamp: number;
  fromKeyId?: string;
  toKeyId: string;
  reason: 'initial' | 'round_robin' | 'idle_timeout' | 'rate_limit_429' | 'quota_exhausted' | 'manual';
  details: string;
}

interface PoolMetrics {
  totalKeys: number;
  healthyKeys: number;
  coolingDownKeys: number;
  quotaExhaustedKeys: number;
  totalRpm: number;
  maxPoolRpm: number;
  totalDailyTokens: number;
  totalDailyRequests: number;
  strategy: string;
  idleTimeout: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'pool' | 'config' | 'test' | 'render' | 'logs'>('pool');
  const [keys, setKeys] = useState<KeyStats[]>([]);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PoolMetrics | null>(null);
  const [logs, setLogs] = useState<RotationLog[]>([]);
  const [rawYaml, setRawYaml] = useState<string>('');
  const [yamlEditContent, setYamlEditContent] = useState<string>('');
  const [isSavingYaml, setIsSavingYaml] = useState(false);
  const [yamlSaveNotice, setYamlSaveNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Test Console State
  const [testPrompt, setTestPrompt] = useState<string>('Bize 2 cümlede yapay zeka hızlandırma mimarisini açıkla.');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.8-flash');
  const [isGenerating, setIsGenerating] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Add Key Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyPriority, setNewKeyPriority] = useState(1);
  const [isAddingKey, setIsAddingKey] = useState(false);

  // Fetch live pool status
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/pool/status');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
        setActiveKeyId(data.activeKeyId);
        setMetrics(data.metrics || null);
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to poll status:', err);
    }
  };

  // Fetch raw yaml
  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setRawYaml(data.rawYaml || '');
        setYamlEditContent(data.rawYaml || '');
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleSaveYaml = async () => {
    setIsSavingYaml(true);
    setYamlSaveNotice(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yamlContent: yamlEditContent }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setYamlSaveNotice({ type: 'success', text: 'config.yaml başarıyla kaydedildi ve uygulandı!' });
        fetchConfig();
        fetchStatus();
      } else {
        setYamlSaveNotice({ type: 'error', text: data.error || 'Kaydetme hatası oluştu.' });
      }
    } catch (err: any) {
      setYamlSaveNotice({ type: 'error', text: err.message || 'Sunucuya bağlanılamadı.' });
    } finally {
      setIsSavingYaml(false);
    }
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([yamlEditContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.yaml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelectActiveKey = async (keyId: string) => {
    try {
      await fetch('/api/pool/select-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      fetchStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleKey = async (keyId: string, currentEnabled: boolean) => {
    try {
      await fetch('/api/pool/toggle-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, enabled: !currentEnabled }),
      });
      fetchStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetStats = async (keyId?: string) => {
    try {
      await fetch('/api/pool/reset-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      fetchStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyValue) return;
    setIsAddingKey(true);
    try {
      const res = await fetch('/api/pool/add-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName || 'Slot ' + (keys.length + 1),
          key: newKeyValue,
          priority: Number(newKeyPriority) || 1,
        }),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewKeyName('');
        setNewKeyValue('');
        fetchStatus();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsAddingKey(false);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm('Bu anahtarı havuzdan kaldırmak istediğinize emin misiniz?')) return;
    try {
      await fetch('/api/pool/delete-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      fetchStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunTest = async () => {
    if (!testPrompt.trim()) return;
    setIsGenerating(true);
    setTestResult(null);
    setTestError(null);
    try {
      const startTime = performance.now();
      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: testPrompt,
          model: selectedModel,
        }),
      });
      const duration = Math.round(performance.now() - startTime);
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ ...data, latencyMs: duration });
        fetchStatus();
      } else {
        setTestError(data.error || 'İstek başarısız oldu.');
      }
    } catch (err: any) {
      setTestError(err.message || 'Bağlantı hatası.');
    } finally {
      setIsGenerating(false);
    }
  };

  const activeKeyObj = keys.find(k => k.id === activeKeyId);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shadow-sm shadow-emerald-950">
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight text-white text-base sm:text-lg">
                  Gemini Key Rotator & Rate Limiter
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Render Ready
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Repo: <span className="text-slate-300 font-mono">awesome-freellm-apis</span> • Otomatik Hata & Boşta Geçişi (Failover)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/furkanarslangraydomain-stack/awesome-freellm-apis.git"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>GitHub Deposu</span>
            </a>

            <button
              onClick={() => {
                fetchStatus();
                fetchConfig();
              }}
              title="Yenile"
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors border border-slate-800"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Top Highlight Banners / Metrics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Active Key Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Aktif Anahtar</span>
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <div className="font-semibold text-lg text-white truncate">
              {activeKeyObj?.name || 'Anahtar Seçilmedi'}
            </div>
            <div className="font-mono text-xs text-slate-400 mt-1 truncate">
              {activeKeyObj?.maskedKey || '---'}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium border ${
                  activeKeyObj?.status === 'healthy'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : activeKeyObj?.status === 'cooling_down'
                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                    : 'bg-rose-950 text-rose-300 border-rose-800'
                }`}
              >
                {activeKeyObj?.status === 'healthy'
                  ? 'Sağlıklı (Ready)'
                  : activeKeyObj?.status === 'cooling_down'
                  ? 'Soğumada (Cooldown)'
                  : 'Kota Doldu'}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Öncelik: #{activeKeyObj?.priority || 1}
              </span>
            </div>
          </div>

          {/* RPM Limit Gauge */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Dakikalık İstek (RPM)</span>
              <Clock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">
                {activeKeyObj?.currentRpm || 0}
              </span>
              <span className="text-xs text-slate-400">
                / {activeKeyObj?.rpmLimit || 14} RPM (Güvenli Sınır)
              </span>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  (activeKeyObj?.currentRpm || 0) >= 12
                    ? 'bg-rose-500'
                    : (activeKeyObj?.currentRpm || 0) >= 8
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{
                  width: `${Math.min(100, (((activeKeyObj?.currentRpm || 0) / (activeKeyObj?.rpmLimit || 14)) * 100))}%`,
                }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Gemini Free resmi kotası 15 RPM'dir, 14 safe tavanıyla 429 engellenir.
            </p>
          </div>

          {/* Daily TPD (Tokens Per Day) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Günlük Token (TPD)</span>
              <Activity className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">
                {(metrics?.totalDailyTokens || 0).toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">
                / {((activeKeyObj?.tpdLimit || 1000000) * (keys.length || 1)).toLocaleString()} TPD
              </span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-500"
                style={{
                  width: `${Math.min(100, (((metrics?.totalDailyTokens || 0) / ((activeKeyObj?.tpdLimit || 1000000) * (keys.length || 1))) * 100))}%`,
                }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Toplam {metrics?.totalDailyRequests || 0} istek / RPD kotası: {(keys.length * 1500).toLocaleString()}
            </p>
          </div>

          {/* Rotation Policy & Strategy */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Rotasyon Politikası</span>
              <Layers className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="font-semibold text-base text-white">
              {metrics?.strategy === 'failover_on_error'
                ? 'Failover On Error (429)'
                : metrics?.strategy === 'round_robin'
                ? 'Round-Robin (Sıralı)'
                : 'Least-Used (Dengeli)'}
            </div>
            <div className="mt-2 space-y-1 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Boşta Geçiş: <strong>{metrics?.idleTimeout || 180}s</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Havuz Boyutu: <strong>{keys.length} Anahtar</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('pool')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'pool'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Anahtar Havuzu ({keys.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('config')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'config'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>config.yaml Eklentisi</span>
          </button>

          <button
            onClick={() => setActiveTab('test')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'test'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Canlı Test & Rotasyon Konsolu</span>
          </button>

          <button
            onClick={() => setActiveTab('render')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'render'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <CloudUpload className="w-4 h-4" />
            <span>Render Deploy Rehberi</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'logs'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Geçiş Olayları ({logs.length})</span>
          </button>
        </div>

        {/* TAB 1: KEY POOL & MANAGEMENT */}
        {activeTab === 'pool' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Yedekli Anahtar Havuzu</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Render ortamında tanımlanan <code className="text-emerald-400 font-mono">GEMINI_API_KEYS</code> ve <code className="text-emerald-400 font-mono">config.yaml</code> anahtarları tek bir havuzda birleştirilir.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleResetStats()}
                  className="px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Kotaları / Soğumaları Sıfırla</span>
                </button>

                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm shadow-emerald-950"
                >
                  <Plus className="w-4 h-4" />
                  <span>Yeni Anahtar Ekle</span>
                </button>
              </div>
            </div>

            {/* Keys Table / Card Grid */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-4">Durum & Anahtar</th>
                      <th className="px-5 py-4">Sağlayıcı / Model</th>
                      <th className="px-5 py-4">RPM (Dakikalık)</th>
                      <th className="px-5 py-4">Günlük TPD & RPD</th>
                      <th className="px-5 py-4">Başarı / Hata</th>
                      <th className="px-5 py-4 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {keys.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                          Henüz hiçbir anahtar yüklenmedi.
                        </td>
                      </tr>
                    ) : (
                      keys.map((k) => {
                        const isActive = k.id === activeKeyId;
                        return (
                          <tr
                            key={k.id}
                            className={`hover:bg-slate-800/40 transition-colors ${
                              isActive ? 'bg-emerald-500/[0.04]' : ''
                            }`}
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-3 h-3 rounded-full flex-shrink-0 ${
                                    !k.enabled
                                      ? 'bg-slate-600'
                                      : k.status === 'healthy'
                                      ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                                      : k.status === 'cooling_down'
                                      ? 'bg-amber-400 shadow-sm shadow-amber-400/50 animate-pulse'
                                      : 'bg-rose-500 shadow-sm shadow-rose-500/50'
                                  }`}
                                  title={k.statusMessage || k.status}
                                />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-white">{k.name}</span>
                                    {isActive && (
                                      <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full">
                                        ŞU AN AKTİF
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs font-mono text-slate-400 mt-0.5">
                                    {k.maskedKey} • Öncelik #{k.priority}
                                  </div>
                                  {k.statusMessage && (
                                    <div className="text-[11px] text-amber-400/90 mt-1">
                                      {k.statusMessage}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="px-5 py-4">
                              <span className="inline-flex items-center gap-1.5 text-xs font-mono bg-slate-800 px-2.5 py-1 rounded-md text-slate-300 border border-slate-700">
                                {k.provider}
                              </span>
                            </td>

                            <td className="px-5 py-4">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs font-mono">
                                  <span>{k.currentRpm} / {k.rpmLimit}</span>
                                  <span className="text-[10px] text-slate-400">
                                    {Math.round((k.currentRpm / k.rpmLimit) * 100)}%
                                  </span>
                                </div>
                                <div className="w-28 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${
                                      k.currentRpm >= 12
                                        ? 'bg-rose-500'
                                        : k.currentRpm >= 8
                                        ? 'bg-amber-400'
                                        : 'bg-emerald-400'
                                    }`}
                                    style={{
                                      width: `${Math.min(100, (k.currentRpm / k.rpmLimit) * 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>

                            <td className="px-5 py-4">
                              <div className="text-xs">
                                <div><strong className="text-white font-mono">{k.dailyTokens.toLocaleString()}</strong> <span className="text-slate-400">TPD</span></div>
                                <div className="text-slate-400 font-mono text-[11px] mt-0.5">{k.dailyRequests} / {k.rpdLimit} RPD</div>
                              </div>
                            </td>

                            <td className="px-5 py-4">
                              <div className="text-xs space-y-0.5">
                                <div className="text-emerald-400 font-mono">{k.totalSuccess} Başarılı</div>
                                <div className="text-rose-400 font-mono">{k.totalErrors} Hata</div>
                              </div>
                            </td>

                            <td className="px-5 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {!isActive && k.enabled && (
                                  <button
                                    onClick={() => handleSelectActiveKey(k.id)}
                                    className="px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-950/60 border border-emerald-900 rounded-lg transition-colors"
                                  >
                                    Aktif Yap
                                  </button>
                                )}

                                <button
                                  onClick={() => handleToggleKey(k.id, k.enabled)}
                                  className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                                    k.enabled
                                      ? 'text-slate-400 border-slate-700 hover:text-slate-200'
                                      : 'text-amber-400 border-amber-800 bg-amber-950/30'
                                  }`}
                                >
                                  {k.enabled ? 'Devre Dışı' : 'Etkinleştir'}
                                </button>

                                <button
                                  onClick={() => handleDeleteKey(k.id)}
                                  className="p-1 text-slate-500 hover:text-rose-400 rounded-lg transition-colors"
                                  title="Sil"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Info Callout */}
            <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 space-y-1">
                <p className="font-medium text-emerald-300">
                  Otomatik Kotasız Çalışma Garantisi
                </p>
                <p>
                  Sistem herhangi bir anahtarda <strong>429 (Too Many Requests)</strong> veya <strong>RESOURCE_EXHAUSTED</strong> aldığında anında sıradaki anahtara geçer ve o anahtarı <strong>65 saniye</strong> dinlendirir. 
                  Ayrıca anahtar <strong>180 saniye</strong> boşta kalırsa yükü dengeli tutmak amacıyla sonraki anahtara devredilir.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CONFIG.YAML EDITOR */}
        {activeTab === 'config' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">config.yaml Yapılandırması</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Render'da veya yerel ortamda çalışan proxy'nin RPM, TPD, rotasyon stratejisi ve havuz ayarlarını buradan doğrudan düzenleyebilirsiniz.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleCopy(yamlEditContent, 'yaml-code')}
                  className="px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {copiedSection === 'yaml-code' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Kopyalandı</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>YAML Kopyala</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleDownloadYaml}
                  className="px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>config.yaml İndir</span>
                </button>

                <button
                  onClick={handleSaveYaml}
                  disabled={isSavingYaml}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm shadow-emerald-950"
                >
                  {isSavingYaml ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>Kaydet ve Uygula</span>
                </button>
              </div>
            </div>

            {yamlSaveNotice && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                  yamlSaveNotice.type === 'success'
                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800'
                    : 'bg-rose-950/40 text-rose-300 border-rose-800'
                }`}
              >
                {yamlSaveNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                )}
                <span>{yamlSaveNotice.text}</span>
              </div>
            )}

            {/* Quick parameter cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <div className="text-xs text-slate-400 font-medium">max_rpm_per_key</div>
                <div className="text-xl font-bold text-white mt-1">14 RPM</div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Gemini Free 15 sınırını zorlamamak için emniyet payı ile 14 istek/dakika.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <div className="text-xs text-slate-400 font-medium">max_tpd_per_key</div>
                <div className="text-xl font-bold text-white mt-1">1,000,000 TPD</div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Günlük 1 Milyon token kotası aşıldığında sonraki anahtara devredilir.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <div className="text-xs text-slate-400 font-medium">cooldown_on_rate_limit</div>
                <div className="text-xl font-bold text-white mt-1">65 Saniye</div>
                <p className="text-[11px] text-slate-400 mt-1">
                  429 alan anahtar tam bir dakika dinlendirilip otomatik olarak tekrar devreye alınır.
                </p>
              </div>
            </div>

            {/* Code Editor */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">/config.yaml</span>
                <span className="text-xs text-slate-400">Doğrudan düzenlenebilir YAML metni</span>
              </div>
              <textarea
                value={yamlEditContent}
                onChange={(e) => setYamlEditContent(e.target.value)}
                rows={22}
                className="w-full bg-slate-950 p-4 font-mono text-xs text-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-y leading-relaxed"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* TAB 3: LIVE TEST & PLAYGROUND */}
        {activeTab === 'test' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Canlı Test & Rotatör Konsolu</h2>
              <p className="text-sm text-slate-400 mt-1">
                İsteklerin hangi anahtardan yanıtlandığını, kota tüketimini ve olası 429 failover durumunda anahtar değişimini canlı olarak izleyin.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Prompt Box */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Test İstemi (Prompt)
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
                  >
                    <option value="gemini-3.8-flash">gemini-3.8-flash (Free/Recommended)</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  </select>
                </div>

                <textarea
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  rows={4}
                  placeholder="Model için bir istem girin..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-slate-400">
                    Aktif Rotatör: <span className="text-emerald-400 font-semibold">{activeKeyObj?.name || 'Yok'}</span>
                  </div>

                  <button
                    onClick={handleRunTest}
                    disabled={isGenerating}
                    className="px-5 py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-xl transition-all flex items-center gap-2 shadow-sm shadow-emerald-950"
                  >
                    {isGenerating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Rotatör Üzerinden İstek Yapılıyor...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        <span>İsteği Gönder (Execute)</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Test Result Display */}
                {testResult && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2 text-xs">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-slate-300 font-medium">Yanıt Alındı</span>
                        <span className="text-slate-500">•</span>
                        <span className="font-mono text-emerald-400">{testResult.latencyMs}ms</span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400">Kullanılan Anahtar:</span>
                        <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-200">
                          {testResult.keyUsed?.name}
                        </span>
                      </div>

                      {testResult.rotationInfo?.rotated && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                          OTOMATİK FAILOVER GEÇİŞİ YAPILDI
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {testResult.text}
                    </p>
                  </div>
                )}

                {testError && (
                  <div className="mt-4 p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-semibold">İstek Hatası: </strong>
                      <span>{testError}</span>
                      <p className="mt-1 text-slate-400 text-[11px]">
                        Eğer tüm anahtarlar soğumada veya geçersizse lütfen anahtar havuzunu ve GEMINI_API_KEYS ayarlarını kontrol edin.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* cURL & OpenAI SDK Format */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    OpenAI Standart API
                  </span>
                  <button
                    onClick={() =>
                      handleCopy(
                        `curl -X POST http://localhost:3000/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "gemini-3.8-flash",\n    "messages": [{"role": "user", "content": "${testPrompt}"}]\n  }'`,
                        'curl'
                      )
                    }
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedSection === 'curl' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>cURL</span>
                  </button>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl font-mono text-[11px] text-slate-300 overflow-x-auto border border-slate-800">
                  <div className="text-slate-500"># Cursor, Cline, Open WebUI URL</div>
                  <div className="text-emerald-400 mt-1">
                    http://localhost:3000/v1
                  </div>
                  <div className="text-slate-400 mt-2">Endpoint: /chat/completions</div>
                </div>

                <div className="text-xs text-slate-400 space-y-2">
                  <p className="font-medium text-slate-300">Nasıl Çalışır?</p>
                  <p>
                    Render'a deploy ettiğinizde tüm istemciler bu servisi bir OpenAI proxy'si olarak kullanır. 
                    Kullanıcılar tek bir API anahtarı girse bile sistem arkadaki 5-10 farklı Gemini Free anahtarını çevirerek kesintisiz yanıt verir.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: RENDER DEPLOY GUIDE */}
        {activeTab === 'render' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Render.com Dağıtım (Deployment) Rehberi</h2>
              <p className="text-sm text-slate-400 mt-1">
                <code className="text-emerald-400 font-mono">awesome-freellm-apis</code> deponuzu Render üzerinde kotaları aşmayacak şekilde kurma adımları.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Step 1 & 2 */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
                  1
                </div>
                <h3 className="font-semibold text-white text-base">Render Web Service Oluşturun</h3>
                <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed">
                  <li>
                    <a
                      href="https://dashboard.render.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 underline inline-flex items-center gap-1"
                    >
                      dashboard.render.com <ExternalLink className="w-3 h-3" />
                    </a>{' '}
                    adresine gidin.
                  </li>
                  <li><strong>New +</strong> butonuna basıp <strong>Web Service</strong> seçin.</li>
                  <li>GitHub reposu olarak <code className="text-emerald-400">awesome-freellm-apis</code> seçin.</li>
                  <li>
                    Aşağıdaki build ve start komutlarını girin:
                    <div className="bg-slate-950 p-3 rounded-lg font-mono text-[11px] text-slate-300 mt-2 space-y-1">
                      <div>Build: <span className="text-emerald-400">npm install && npm run build</span></div>
                      <div>Start: <span className="text-emerald-400">npm start</span></div>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Step 2: Environment Variables */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
                    2
                  </div>
                  <button
                    onClick={() =>
                      handleCopy(
                        'GEMINI_API_KEYS=AIzaSyKey1...,AIzaSyKey2...,AIzaSyKey3...\nROTATION_STRATEGY=failover_on_error\nNODE_ENV=production',
                        'env-vars'
                      )
                    }
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedSection === 'env-vars' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Kopyala</span>
                  </button>
                </div>
                <h3 className="font-semibold text-white text-base">Çevre Değişkenleri (Environment)</h3>
                <p className="text-xs text-slate-400">
                  Render Web Service &gt; <strong>Environment</strong> sekmesine aşağıdaki değişkenleri ekleyin:
                </p>

                <div className="bg-slate-950 p-3 rounded-lg font-mono text-[11px] text-slate-300 space-y-2 border border-slate-800">
                  <div>
                    <span className="text-emerald-400 font-bold">GEMINI_API_KEYS</span>:
                    <div className="text-slate-400 text-[10px]">
                      Virgülle ayrılmış birden çok Gemini Free anahtarı (AIzaSy...,AIzaSy...)
                    </div>
                  </div>
                  <div>
                    <span className="text-emerald-400 font-bold">ROTATION_STRATEGY</span>:
                    <div className="text-slate-400 text-[10px]">
                      failover_on_error veya round_robin
                    </div>
                  </div>
                  <div>
                    <span className="text-emerald-400 font-bold">NODE_ENV</span>: production
                  </div>
                </div>
              </div>
            </div>

            {/* render.yaml Blueprint Preview */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  render.yaml (Render Blueprint Dosyası)
                </span>
                <span className="text-xs text-slate-500 font-mono">Otomatik Dağıtım</span>
              </div>
              <p className="text-xs text-slate-400">
                Deponuzun kök dizininde bulunan <code className="text-emerald-400">render.yaml</code> dosyası sayesinde Render Blueprint ile tek tıkla kurulum yapabilirsiniz.
              </p>
              <div className="bg-slate-950 p-4 rounded-xl font-mono text-xs text-emerald-300/90 overflow-x-auto border border-slate-800">
                <pre>{`services:
  - type: web
    name: freellm-api-rotator
    env: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: GEMINI_API_KEYS
        sync: false
      - key: ROTATION_STRATEGY
        value: failover_on_error`}</pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ROTATION LOGS */}
        {activeTab === 'logs' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Anahtar Geçiş ve Hata Olay Günlüğü</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Kullanılmayan anahtarların devredilmesi (idle switch), 429 kota aşımı failover'ları ve manuel geçişlerin canlı kaydı.
                </p>
              </div>

              <span className="text-xs text-slate-400 font-mono">
                {logs.length} Kayıt Bulundu
              </span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="divide-y divide-slate-800 max-h-[550px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Henüz kayıtlı bir geçiş olayı bulunmuyor.
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-4 hover:bg-slate-800/30 transition-colors flex items-start gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                          log.reason === 'rate_limit_429'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : log.reason === 'idle_timeout'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                            : log.reason === 'quota_exhausted'
                            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {log.reason === 'rate_limit_429' ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : log.reason === 'idle_timeout' ? (
                          <Clock className="w-3.5 h-3.5" />
                        ) : (
                          <Zap className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-white uppercase tracking-wider">
                              {log.reason.replace(/_/g, ' ')}
                            </span>
                            {log.fromKeyId && (
                              <span className="text-slate-400 font-mono text-[11px]">
                                {log.fromKeyId} <ArrowRight className="w-3 h-3 inline mx-0.5" /> {log.toKeyId}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          {log.details}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Add Key Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-white text-base">Havuz'a Yeni Gemini Anahtarı Ekle</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddKeySubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Slot / İsim</label>
                <input
                  type="text"
                  placeholder="Örn: Gemini Yedek Anahtar 3"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Gemini API Key</label>
                <input
                  type="password"
                  required
                  placeholder="AIzaSy..."
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Öncelik Sırası (Priority)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={newKeyPriority}
                  onChange={(e) => setNewKeyPriority(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isAddingKey || !newKeyValue}
                  className="px-4 py-2 font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-xl shadow-sm"
                >
                  {isAddingKey ? 'Ekleniyor...' : 'Havuza Ekle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
