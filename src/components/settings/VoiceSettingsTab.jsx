import { useEffect, useState } from 'react';
import { Mic, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiUrl } from '../../config/api.js';
import { AuthService } from '../../services/authService.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import TestVoiceButton from './TestVoiceButton.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

// Curated list of locales the browser SpeechRecognition handles reliably.
// Could be expanded; kept short to avoid choice paralysis.
const STT_LANGUAGES = [
    { code: 'en-US', label: 'English (US)' },
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'tr-TR', label: 'Turkish' },
    { code: 'ar-SA', label: 'Arabic (Saudi)' },
    { code: 'fr-FR', label: 'French' },
    { code: 'de-DE', label: 'German' },
    { code: 'es-ES', label: 'Spanish' }
];

// Voice slots are stored per-provider since voice IDs are provider-specific
// (a Google "en-US-Neural2-F" can't be played by Kokoro). The four supported
// catalogue providers; 'browser' speaks via Web Speech API and has no slots.
const PROVIDERS = ['piper', 'kokoro', 'openai', 'google'];
const GENDERS = ['male', 'female', 'child'];

function emptyVoiceSlots() {
    const out = {};
    for (const p of PROVIDERS) {
        out[p] = { male: '', female: '', child: '' };
    }
    return out;
}

const blankSettings = {
    voice_mode_enabled: false,
    tts_provider: 'piper',
    // Per-provider voice slots. Switching providers no longer wipes anything;
    // each provider keeps its own selections. UI shows the current provider's
    // slots only; save only writes the current provider's three keys.
    voiceSlots: emptyVoiceSlots(),
    tts_rate: 1.0,
    tts_pitch: 1.0,
    stt_provider: 'browser',
    stt_language: 'en-US',
    avatar_type: '3d_head',
    llm_model_voice: '',
    // Cloud TTS API keys. The server never sends the actual value back; only
    // *_set / *_via_env booleans for UI state. The two strings below carry a
    // *new* key the admin types into the input — sent on save, cleared on
    // load. An empty string means "no change" (we omit it from the payload).
    google_tts_api_key: '',
    google_tts_api_key_set: false,
    google_tts_api_key_via_env: false,
    openai_tts_api_key: '',
    openai_tts_api_key_set: false,
    openai_tts_api_key_via_env: false
};

export default function VoiceSettingsTab() {
    const toast = useToast();
    const [settings, setSettings] = useState(blankSettings);
    const [voices, setVoices] = useState([]);
    const [piperInstalled, setPiperInstalled] = useState(true);
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const auth = () => AuthService.authHeaders();

    const loadAll = async () => {
        setLoading(true);
        try {
            const [s, m] = await Promise.all([
                fetch(apiUrl('/platform-settings/voice'), { headers: auth() }).then(r => r.json()),
                fetch(apiUrl('/llm/models'), { headers: auth() }).then(r => r.json())
            ]);
            const provider = s.tts_provider || 'piper';
            const v = await fetch(apiUrl(`/tts/voices?provider=${provider}`), { headers: auth() }).then(r => r.json());

            // Hydrate voice slots from the new per-provider keys.
            const voiceSlots = emptyVoiceSlots();
            for (const p of PROVIDERS) {
                for (const g of GENDERS) {
                    voiceSlots[p][g] = s[`voice_${p}_${g}`] || '';
                }
            }

            setSettings({
                voice_mode_enabled: !!s.voice_mode_enabled,
                tts_provider: provider,
                voiceSlots,
                tts_rate: s.tts_rate ?? 1.0,
                tts_pitch: s.tts_pitch ?? 1.0,
                stt_provider: s.stt_provider || 'browser',
                stt_language: s.stt_language || 'en-US',
                avatar_type: s.avatar_type || '3d_head',
                llm_model_voice: s.llm_model_voice || '',
                google_tts_api_key: '',  // input is always empty on load
                google_tts_api_key_set: !!s.google_tts_api_key_set,
                google_tts_api_key_via_env: !!s.google_tts_api_key_via_env,
                openai_tts_api_key: '',
                openai_tts_api_key_set: !!s.openai_tts_api_key_set,
                openai_tts_api_key_via_env: !!s.openai_tts_api_key_via_env
            });
            setVoices(v.voices || []);
            setPiperInstalled(v.piperInstalled !== false);
            setModels(m.models || []);
        } catch (err) {
            toast.error?.(`Failed to load voice settings: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadAll(); }, []);

    const refetchVoices = async (provider) => {
        try {
            const v = await fetch(apiUrl(`/tts/voices?provider=${provider}`), { headers: auth() }).then(r => r.json());
            setVoices(v.voices || []);
            setPiperInstalled(v.piperInstalled !== false);
        } catch (err) {
            toast.error?.(`Failed to load ${provider} voices: ${err.message}`);
        }
    };

    const update = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        // Switching providers no longer wipes anything: each provider keeps
        // its own voice slots. We just refetch the new provider's catalogue
        // so the dropdown shows the right options.
        if (key === 'tts_provider') refetchVoices(value);
    };

    // Update one voice slot. Mutates the per-provider sub-object immutably.
    const updateVoiceSlot = (provider, gender, value) => {
        setSettings(prev => ({
            ...prev,
            voiceSlots: {
                ...prev.voiceSlots,
                [provider]: { ...prev.voiceSlots[provider], [gender]: value }
            }
        }));
    };

    const save = async () => {
        setSaving(true);
        try {
            const provider = settings.tts_provider;
            const payload = {
                voice_mode_enabled: settings.voice_mode_enabled,
                tts_provider: provider || null,
                tts_rate: Number(settings.tts_rate),
                tts_pitch: Number(settings.tts_pitch),
                stt_provider: settings.stt_provider || null,
                stt_language: settings.stt_language || null,
                avatar_type: settings.avatar_type || null,
                llm_model_voice: settings.llm_model_voice || null
            };
            // Save ONLY the current provider's voice slots. Other providers'
            // slots stay in the database untouched — switching back to them
            // restores their voices instead of finding empty fields.
            // 'browser' has no server-side voice catalogue so nothing to save.
            if (PROVIDERS.includes(provider)) {
                for (const g of GENDERS) {
                    payload[`voice_${provider}_${g}`] = settings.voiceSlots[provider][g] || null;
                }
            }
            // Only include API key fields when the admin actually entered
            // something — empty input means "leave the existing key alone".
            if (settings.google_tts_api_key.trim()) payload.google_tts_api_key = settings.google_tts_api_key.trim();
            if (settings.openai_tts_api_key.trim()) payload.openai_tts_api_key = settings.openai_tts_api_key.trim();
            const res = await fetch(apiUrl('/platform-settings/voice'), {
                method: 'PUT',
                headers: { ...auth(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            toast.success?.('Voice settings saved');
            // After save, reload to pick up the *_set flags and clear the input.
            await loadAll();
        } catch (err) {
            toast.error?.(err.message);
        } finally {
            setSaving(false);
        }
    };

    const clearKey = async (field) => {
        try {
            const res = await fetch(apiUrl('/platform-settings/voice'), {
                method: 'PUT',
                headers: { ...auth(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: '' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Clear failed');
            toast.success?.('Key cleared');
            await loadAll();
        } catch (err) {
            toast.error?.(err.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-neutral-400">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading voice settings…
            </div>
        );
    }

    const voiceOptions = voices.map(v => (
        <option key={v.filename} value={v.filename}>
            {v.displayName}{v.gender ? ` (${v.gender})` : ''} — {v.language}
        </option>
    ));

    const isKokoro = settings.tts_provider === 'kokoro';
    const showPiperWarning = settings.tts_provider === 'piper' && !piperInstalled;

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                    <Mic className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-bold">Voice & Avatar</h3>
                </div>
                <span className="text-xs text-neutral-500">
                    Stack T — local TTS + browser STT + 3D avatar
                </span>
            </div>

            {showPiperWarning && (
                <div className="flex items-start gap-2 p-3 rounded border border-amber-700 bg-amber-950/40 text-amber-200 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                        Piper is not installed on the server. Run{' '}
                        <code className="bg-black/40 px-1 rounded">bash server/scripts/install-piper.sh</code>{' '}
                        and reload, otherwise TTS requests will fail.
                    </div>
                </div>
            )}

            {/* TTS provider */}
            <label className="block max-w-md">
                <span className="text-xs text-neutral-400 block mb-1">TTS engine</span>
                <select
                    value={settings.tts_provider}
                    onChange={(e) => update('tts_provider', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white"
                >
                    <option value="piper">Piper — local, fast (~0.5 s), robotic, ~25 MB voices</option>
                    <option value="kokoro">Kokoro-82M — local, ~0.7× realtime, expressive, ~330 MB model</option>
                    <option value="google">Google Cloud TTS — cloud, 1M chars/month free on Neural2/Chirp HD</option>
                    <option value="openai">OpenAI TTS — cloud, lowest latency, ~$0.015 per 1k chars</option>
                </select>
                {isKokoro && (
                    <span className="text-xs text-neutral-500 mt-1 block">
                        First synthesis after server restart loads the model (~3 s) and may download
                        ~330 MB to the Hugging Face cache.
                    </span>
                )}
                {settings.tts_provider === 'openai' && (
                    <span className="text-xs text-neutral-500 mt-1 block">
                        Requires the platform LLM provider to be set to OpenAI (with a valid API key) OR{' '}
                        <code className="text-neutral-300">OPENAI_API_KEY</code> in <code>server/.env</code>. Voices:
                        alloy, echo, fable, onyx, nova, shimmer. Cost: ~$0.015 per 1k chars on tts-1.
                    </span>
                )}
                {settings.tts_provider === 'google' && (
                    <span className="text-xs text-neutral-500 mt-1 block">
                        Free tier: 1M chars/month on Neural2 &amp; Chirp HD voices (~3,000 patient responses).
                        Create a key at console.cloud.google.com → APIs &amp; Services → Credentials, after enabling
                        the Text-to-Speech API.
                    </span>
                )}
            </label>

            {/* Cloud TTS API keys — admin-paste, never returned over the wire after save. */}
            {(settings.tts_provider === 'google' || settings.tts_provider === 'openai') && (
                <div className="max-w-md space-y-3 pl-3 border-l-2 border-neutral-800">
                    {settings.tts_provider === 'google' && (
                        <ApiKeyField
                            label="Google TTS API key"
                            inputValue={settings.google_tts_api_key}
                            isSet={settings.google_tts_api_key_set}
                            viaEnv={settings.google_tts_api_key_via_env}
                            placeholder="AIzaSy…"
                            onChange={(v) => update('google_tts_api_key', v)}
                            onClear={() => clearKey('google_tts_api_key')}
                        />
                    )}
                    {settings.tts_provider === 'openai' && (
                        <ApiKeyField
                            label="OpenAI TTS API key"
                            inputValue={settings.openai_tts_api_key}
                            isSet={settings.openai_tts_api_key_set}
                            viaEnv={settings.openai_tts_api_key_via_env}
                            placeholder="sk-…"
                            onChange={(v) => update('openai_tts_api_key', v)}
                            onClear={() => clearKey('openai_tts_api_key')}
                            hint="Optional — leave blank to reuse the platform LLM key when LLM provider is OpenAI."
                        />
                    )}
                </div>
            )}

            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={settings.voice_mode_enabled}
                    onChange={(e) => update('voice_mode_enabled', e.target.checked)}
                    className="w-4 h-4 accent-purple-500"
                />
                <div>
                    <div className="text-sm font-bold text-white">Enable voice mode</div>
                    <div className="text-xs text-neutral-500">
                        When off, voice toggle is hidden from chat and TTS endpoints reject requests.
                    </div>
                </div>
            </label>

            {/* TTS voices */}
            <fieldset className="space-y-3">
                <legend className="text-sm font-bold text-white">
                    Patient voices ({isKokoro ? 'Kokoro' : 'Piper'})
                </legend>
                {voices.length === 0 ? (
                    <div className="text-sm text-neutral-500">
                        {isKokoro
                            ? 'No Kokoro voices loaded yet. The model loads on first request — try saving and synthesizing once.'
                            : <>No voices installed. Drop <code>.onnx</code> + <code>.onnx.json</code> files into <code>server/data/piper/</code> and refresh.</>
                        }
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {GENDERS.map(g => {
                            const label = g === 'male' ? 'Male voice' : g === 'female' ? 'Female voice' : 'Child voice';
                            const provider = settings.tts_provider;
                            const value = PROVIDERS.includes(provider) ? settings.voiceSlots[provider][g] : '';
                            return (
                                <label key={g} className="block">
                                    <span className="text-xs text-neutral-400 block mb-1">{label}</span>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <select
                                            value={value}
                                            onChange={(e) => updateVoiceSlot(provider, g, e.target.value)}
                                            className="flex-1 min-w-0 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white"
                                        >
                                            <option value="">— none —</option>
                                            {voiceOptions}
                                        </select>
                                        <TestVoiceButton
                                            voice={value}
                                            provider={provider}
                                            rate={settings.tts_rate}
                                            pitch={settings.tts_pitch}
                                        />
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                )}
            </fieldset>

            {/* Rate & pitch */}
            <div className="grid grid-cols-2 gap-4">
                <label className="block">
                    <span className="text-xs text-neutral-400 block mb-1">
                        Speech rate ({settings.tts_rate.toFixed(2)}×)
                    </span>
                    <input
                        type="range"
                        min="0.5" max="1.5" step="0.05"
                        value={settings.tts_rate}
                        onChange={(e) => update('tts_rate', Number(e.target.value))}
                        className="w-full accent-purple-500"
                    />
                </label>
                <label className="block">
                    <span className="text-xs text-neutral-400 block mb-1">
                        Pitch ({settings.tts_pitch.toFixed(2)}×){' '}
                        <span className="text-neutral-600">— browser TTS only</span>
                    </span>
                    <input
                        type="range"
                        min="0.5" max="1.5" step="0.05"
                        value={settings.tts_pitch}
                        onChange={(e) => update('tts_pitch', Number(e.target.value))}
                        className="w-full accent-purple-500"
                    />
                </label>
            </div>

            {/* STT language */}
            <label className="block max-w-sm">
                <span className="text-xs text-neutral-400 block mb-1">Speech recognition language</span>
                <select
                    value={settings.stt_language}
                    onChange={(e) => update('stt_language', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white"
                >
                    {STT_LANGUAGES.map(l => (
                        <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
                    ))}
                </select>
            </label>

            {/* Avatar type */}
            <fieldset>
                <legend className="text-xs text-neutral-400 mb-2">Avatar</legend>
                <div className="flex gap-4">
                    {[['3d_head', '3D head'], ['none', 'None']].map(([val, label]) => (
                        <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="radio"
                                name="avatar_type"
                                value={val}
                                checked={settings.avatar_type === val}
                                onChange={(e) => update('avatar_type', e.target.value)}
                                className="accent-purple-500"
                            />
                            {label}
                        </label>
                    ))}
                </div>
            </fieldset>

            {/* Voice-mode LLM override */}
            <label className="block max-w-md">
                <span className="text-xs text-neutral-400 block mb-1">
                    Voice-mode LLM (override) <span className="text-neutral-600">— blank to inherit</span>
                </span>
                <select
                    value={settings.llm_model_voice}
                    onChange={(e) => update('llm_model_voice', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white"
                >
                    <option value="">inherit platform model</option>
                    {models.map(m => (
                        <option key={m.id} value={m.id}>
                            {m.label} ({m.tier})
                        </option>
                    ))}
                </select>
            </label>

            <div className="pt-2 flex gap-2">
                <button
                    onClick={save}
                    disabled={saving}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-white text-sm font-bold flex items-center gap-2"
                >
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save voice settings
                </button>
                <button
                    onClick={loadAll}
                    disabled={saving}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded text-neutral-300 text-sm flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" /> Reload
                </button>
            </div>

            <UsagePanel />
        </div>
    );
}

// Usage rollups — char-count + estimated cost per provider, today / 7 days /
// this month / all time. Free-tier remaining shown for Google. Admin sees
// platform-wide; everyone else sees their own usage.
function UsagePanel() {
    const [usage, setUsage] = useState(null);
    const [scope, setScope] = useState('self');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { isAdmin: isAdminFn } = useAuth();
    const isAdmin = isAdminFn();

    const load = async (s = scope) => {
        setLoading(true);
        try {
            const url = apiUrl(`/tts/usage${s === 'all' ? '?scope=all' : ''}`);
            const res = await fetch(url, { headers: AuthService.authHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            setUsage(await res.json());
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load('self'); /* eslint-disable-next-line */ }, []);

    const totalChars = (rows) => (rows || []).reduce((s, r) => s + (r.chars || 0), 0);
    const totalCost  = (rows) => (rows || []).reduce((s, r) => s + (r.cost  || 0), 0);
    const fmtChars = (n) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}k` : `${n}`;
    const fmtCost  = (c) => c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`;

    const cards = usage ? [
        { key: 'today',       label: 'Today',         rows: usage.today },
        { key: 'last_7_days', label: 'Last 7 days',   rows: usage.last_7_days },
        { key: 'this_month',  label: 'This month',    rows: usage.this_month },
        { key: 'all_time',    label: 'All time',      rows: usage.all_time }
    ] : [];

    return (
        <div className="border-t border-neutral-800 pt-4 mt-4">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h4 className="text-sm font-bold text-neutral-200">TTS usage</h4>
                    <p className="text-[11px] text-neutral-500">
                        Characters synthesized per provider. Local providers (Piper, Kokoro) are free.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {isAdmin && (
                        <select
                            value={scope}
                            onChange={(e) => { setScope(e.target.value); load(e.target.value); }}
                            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                        >
                            <option value="self">Just me</option>
                            <option value="all">All users (admin)</option>
                        </select>
                    )}
                    <button
                        onClick={() => load(scope)}
                        disabled={loading}
                        className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 flex items-center gap-1"
                    >
                        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Reload
                    </button>
                </div>
            </div>

            {error && <div className="text-xs text-red-400 mb-2">Failed to load usage: {error}</div>}

            {usage && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                        {cards.map(c => (
                            <div key={c.key} className="bg-neutral-800/50 border border-neutral-700 rounded p-2">
                                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{c.label}</div>
                                <div className="font-mono text-base text-neutral-100 mt-0.5">{fmtChars(totalChars(c.rows))}</div>
                                <div className="text-[10px] text-neutral-500">{fmtCost(totalCost(c.rows))}</div>
                            </div>
                        ))}
                    </div>

                    {(usage.this_month || []).length > 0 && (
                        <div className="bg-neutral-800/30 border border-neutral-800 rounded p-2 mb-3">
                            <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">This month, by provider</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                {usage.this_month.map(r => (
                                    <div key={r.provider} className="flex flex-col">
                                        <span className="text-neutral-300 font-medium">{r.provider}</span>
                                        <span className="font-mono text-neutral-400">{fmtChars(r.chars || 0)} chars</span>
                                        <span className="text-[10px] text-neutral-500">
                                            {r.requests || 0} reqs · {fmtCost(r.cost || 0)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Google free-tier indicator (1M chars/month on Neural2/Chirp HD) */}
                    <GoogleFreeTier remaining={usage.google_free_tier_remaining} total={usage.google_free_tier_total} />
                </>
            )}
        </div>
    );
}

function GoogleFreeTier({ remaining, total }) {
    if (total == null) return null;
    const used = total - remaining;
    const pct = Math.min(100, Math.max(0, (used / total) * 100));
    return (
        <div className="bg-emerald-950/20 border border-emerald-900/40 rounded p-2">
            <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-emerald-300 font-medium">Google free tier (this month)</span>
                <span className="text-neutral-400 font-mono">
                    {(remaining / 1_000_000).toFixed(2)}M of {(total / 1_000_000).toFixed(0)}M chars left
                </span>
            </div>
            <div className="h-1.5 bg-neutral-800 rounded overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[10px] text-neutral-500 mt-1">
                Neural2 / Chirp HD voices: 1M chars/month free, then $16/M. Resets on the 1st of each month.
            </div>
        </div>
    );
}

// Admin-paste API key input. The actual saved key never round-trips to the
// browser — only `isSet` (is one configured anywhere) and `viaEnv` (is the
// active key coming from process.env, in which case the DB write is a no-op
// and the env wins until unset). Pasting a new value into the input + Save
// replaces whatever's in the DB. The Clear button explicitly wipes the DB
// entry so the env var (if any) becomes authoritative again.
function ApiKeyField({ label, inputValue, isSet, viaEnv, placeholder, onChange, onClear, hint }) {
    return (
        <label className="block">
            <span className="text-xs text-neutral-400 block mb-1">{label}</span>
            <div className="flex items-center gap-2">
                <input
                    type="password"
                    value={inputValue}
                    placeholder={isSet ? '•••• (configured — paste to replace)' : placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white placeholder:text-neutral-600"
                    autoComplete="off"
                    spellCheck={false}
                />
                {isSet && !viaEnv && (
                    <button
                        type="button"
                        onClick={onClear}
                        className="px-2 py-1.5 text-xs rounded bg-neutral-800 hover:bg-red-900/40 hover:text-red-300 text-neutral-400 border border-neutral-700"
                        title="Remove the key from the database"
                    >
                        Clear
                    </button>
                )}
            </div>
            <span className="text-[11px] text-neutral-500 mt-1 block">
                {viaEnv && (
                    <span className="text-emerald-400">Currently using server <code>.env</code> — paste a value here to override.</span>
                )}
                {!viaEnv && isSet && (
                    <span className="text-emerald-400">Configured. Paste a new value to replace.</span>
                )}
                {!isSet && (
                    <span className="text-amber-400">Not configured.</span>
                )}
                {hint && <span className="block text-neutral-600 mt-0.5">{hint}</span>}
            </span>
        </label>
    );
}
