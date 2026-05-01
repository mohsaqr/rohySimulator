import { useEffect, useState } from 'react';
import { Mic, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiUrl } from '../../config/api.js';
import { AuthService } from '../../services/authService.js';
import { useToast } from '../../contexts/ToastContext.jsx';

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

const blankSettings = {
    voice_mode_enabled: false,
    tts_provider: 'piper',
    piper_voice_male: '',
    piper_voice_female: '',
    piper_voice_child: '',
    tts_rate: 1.0,
    tts_pitch: 1.0,
    stt_provider: 'browser',
    stt_language: 'en-US',
    avatar_type: '3d_head',
    llm_model_voice: ''
};

export default function VoiceSettingsTab() {
    const toast = useToast();
    const [settings, setSettings] = useState(blankSettings);
    const [voices, setVoices] = useState([]);
    const [piperInstalled, setPiperInstalled] = useState(true);
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const auth = () => ({ 'Authorization': `Bearer ${AuthService.getToken()}` });

    const loadAll = async () => {
        setLoading(true);
        try {
            const [s, v, m] = await Promise.all([
                fetch(apiUrl('/platform-settings/voice'), { headers: auth() }).then(r => r.json()),
                fetch(apiUrl('/tts/voices'), { headers: auth() }).then(r => r.json()),
                fetch(apiUrl('/llm/models'), { headers: auth() }).then(r => r.json())
            ]);

            setSettings({
                voice_mode_enabled: !!s.voice_mode_enabled,
                tts_provider: s.tts_provider || 'piper',
                piper_voice_male: s.piper_voice_male || '',
                piper_voice_female: s.piper_voice_female || '',
                piper_voice_child: s.piper_voice_child || '',
                tts_rate: s.tts_rate ?? 1.0,
                tts_pitch: s.tts_pitch ?? 1.0,
                stt_provider: s.stt_provider || 'browser',
                stt_language: s.stt_language || 'en-US',
                avatar_type: s.avatar_type || '3d_head',
                llm_model_voice: s.llm_model_voice || ''
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

    const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                voice_mode_enabled: settings.voice_mode_enabled,
                tts_provider: settings.tts_provider || null,
                piper_voice_male: settings.piper_voice_male || null,
                piper_voice_female: settings.piper_voice_female || null,
                piper_voice_child: settings.piper_voice_child || null,
                tts_rate: Number(settings.tts_rate),
                tts_pitch: Number(settings.tts_pitch),
                stt_provider: settings.stt_provider || null,
                stt_language: settings.stt_language || null,
                avatar_type: settings.avatar_type || null,
                llm_model_voice: settings.llm_model_voice || null
            };
            const res = await fetch(apiUrl('/platform-settings/voice'), {
                method: 'PUT',
                headers: { ...auth(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            toast.success?.('Voice settings saved');
        } catch (err) {
            toast.error?.(err.message);
        } finally {
            setSaving(false);
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
            {v.displayName} — {v.language}
        </option>
    ));

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                    <Mic className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-bold">Voice & Avatar</h3>
                </div>
                <span className="text-xs text-neutral-500">
                    Stack T — local Piper TTS + browser STT + 3D avatar
                </span>
            </div>

            {!piperInstalled && (
                <div className="flex items-start gap-2 p-3 rounded border border-amber-700 bg-amber-950/40 text-amber-200 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                        Piper is not installed on the server. Run{' '}
                        <code className="bg-black/40 px-1 rounded">bash server/scripts/install-piper.sh</code>{' '}
                        and reload, otherwise TTS requests will fail.
                    </div>
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
                <legend className="text-sm font-bold text-white">Patient voices (Piper)</legend>
                {voices.length === 0 ? (
                    <div className="text-sm text-neutral-500">
                        No voices installed. Drop <code>.onnx</code> + <code>.onnx.json</code> files into{' '}
                        <code>server/data/piper/</code> and refresh.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {[
                            ['piper_voice_male',   'Male voice'],
                            ['piper_voice_female', 'Female voice'],
                            ['piper_voice_child',  'Child voice']
                        ].map(([key, label]) => (
                            <label key={key} className="block">
                                <span className="text-xs text-neutral-400 block mb-1">{label}</span>
                                <select
                                    value={settings[key]}
                                    onChange={(e) => update(key, e.target.value)}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white"
                                >
                                    <option value="">— none —</option>
                                    {voiceOptions}
                                </select>
                            </label>
                        ))}
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
                    {[
                        ['3d_head',    '3D head (GLB)'],
                        ['procedural', 'Procedural (no GLB)'],
                        ['none',       'None']
                    ].map(([val, label]) => (
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
        </div>
    );
}
