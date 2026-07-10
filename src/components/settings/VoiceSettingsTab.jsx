import { useEffect, useState } from 'react';
import { Mic, Save, RefreshCw, Info } from 'lucide-react';
import { ApiError, apiFetch, apiPut } from '../../services/apiClient.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import { sttOptions, LANGUAGES } from '../../i18n/languages.js';
import { TTS_PROVIDERS, isPaidProvider, voiceMatchesLanguage, guessVoiceProvider } from '../../utils/voiceResolver.js';
import TestVoiceButton from './TestVoiceButton.jsx';

// Voice 2.0 (VOICE2_PLAN.md §6.4) — THERE IS NO ENGINE DROPDOWN. Each
// configured voice plays on its own engine (derived from the voice id), so
// this tab manages exactly three platform-wide things:
//   1. Configured voice providers — a status CARD per engine (installed /
//      keyed / blocking reason) with an enable toggle (the cost-policy
//      switch) and the cloud API key fields.
//   2. Default voices — ONE per registry language: the never-mute safety
//      net that plays when a case's voice can't (missing engine, missing
//      key, or a paid-service outage). Substitution never crosses a
//      language boundary, so each language needs its own default; an unset
//      row means that language fails loudly instead.
//   3. Global rate/pitch, STT, avatar type, voice-mode LLM (unchanged).
//
// Per-character voices still belong in the case editor (patient) and the
// persona editor (agents) — this tab never picks a speaker's voice.

// STT locale options come from the language registry (I18N_PLAN.md §2):
// every full app language's STT locale plus the curated extra dialects.
// Adding a language never touches this file again.
const STT_LANGUAGES = sttOptions();

const ENGINE_INFO = {
    kokoro: {
        label: 'Kokoro-82M',
        blurb: 'Local, ~0.7× realtime, expressive. First synthesis after a server restart loads the model (~3 s, ~330 MB Hugging Face cache).'
    },
    piper: {
        label: 'Piper',
        blurb: 'Local, fast (~0.5 s), robotic, ~25 MB voices. The free way to cover de/fi/sv fallbacks — install voices via server/scripts/install-piper.sh.'
    },
    google: {
        label: 'Google Cloud TTS',
        blurb: 'Cloud. 1M chars/month free on Neural2/Chirp HD, then ~$16/M. Key: console.cloud.google.com → Credentials (enable the Text-to-Speech API).'
    },
    openai: {
        label: 'OpenAI TTS',
        blurb: 'Cloud, lowest latency, ~$0.015 per 1k chars (tts-1). Reuses the platform LLM key when the LLM provider is OpenAI.'
    }
};

const blankSettings = {
    voice_mode_enabled: false,
    tts_rate: 1.0,
    tts_pitch: 0,
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
    openai_tts_api_key_via_env: false,
    // Voice 2.0: provider status cards + policy toggles + per-language
    // default voices.
    providers: [],
    ...Object.fromEntries(TTS_PROVIDERS.map(p => [`tts_provider_enabled_${p}`, true])),
    ...Object.fromEntries(Object.keys(LANGUAGES).map(l => [`tts_default_voice_${l}`, '']))
};

export default function VoiceSettingsTab() {
    const toast = useToast();
    const { setVoiceSettings } = useVoice();
    const [settings, setSettings] = useState(blankSettings);
    const [catalogue, setCatalogue] = useState([]); // all-provider voice lists for the default selects
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // Engine-off impact modal: { provider, entries } while awaiting the
    // admin's confirm. Configured voices are literal (never substituted),
    // so disabling an engine strands every case/persona voiced on it —
    // the admin must see the blast radius by name before flipping.
    const [disableConfirm, setDisableConfirm] = useState(null);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [s, m, v] = await Promise.all([
                apiFetch('/platform-settings/voice'),
                apiFetch('/llm/models'),
                apiFetch('/tts/voices').catch(() => ({ providers: [] }))
            ]);

            const hydratedSettings = {
                voice_mode_enabled: !!s.voice_mode_enabled,
                tts_rate: s.tts_rate ?? 1.0,
                tts_pitch: s.tts_pitch ?? 0,
                stt_provider: s.stt_provider || 'browser',
                stt_language: s.stt_language || 'en-US',
                avatar_type: s.avatar_type || '3d_head',
                llm_model_voice: s.llm_model_voice || '',
                google_tts_api_key: '',  // input is always empty on load
                google_tts_api_key_set: !!s.google_tts_api_key_set,
                google_tts_api_key_via_env: !!s.google_tts_api_key_via_env,
                openai_tts_api_key: '',
                openai_tts_api_key_set: !!s.openai_tts_api_key_set,
                openai_tts_api_key_via_env: !!s.openai_tts_api_key_via_env,
                providers: s.providers || [],
                ...Object.fromEntries(TTS_PROVIDERS.map(p => [
                    `tts_provider_enabled_${p}`, s[`tts_provider_enabled_${p}`] !== false
                ])),
                ...Object.fromEntries(Object.keys(LANGUAGES).map(l => [
                    `tts_default_voice_${l}`, s[`tts_default_voice_${l}`] || ''
                ]))
            };
            setSettings(hydratedSettings);
            setVoiceSettings?.(s);
            setCatalogue(v.providers || []);
            setModels(m.models || []);
        } catch (err) {
            toast.error?.(`Failed to load voice settings: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadAll(); }, []);

    const update = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    // Turning an engine OFF checks the blast radius first: every stored
    // case/persona voice on that engine will FAIL (never substitute) once
    // it's disabled, so the modal lists them and asks for an explicit
    // "disable anyway". Turning ON is always immediate.
    const onToggleProvider = async (p, checked) => {
        if (checked) {
            update(`tts_provider_enabled_${p}`, true);
            return;
        }
        try {
            const usage = await apiFetch('/tts/voice-usage');
            const entries = usage?.providers?.[p] || [];
            if (entries.length > 0) {
                setDisableConfirm({ provider: p, entries });
                return; // stays enabled until the admin confirms
            }
        } catch {
            // Scan unavailable — don't block the admin on a diagnostics
            // failure; the boot audit still names stranded rows.
        }
        update(`tts_provider_enabled_${p}`, false);
    };

    const save = async () => {
        setSaving(true);
        try {
            // Explicit field list on purpose (the GET-after-PUT round-trip
            // test asserts nothing here gets silently dropped).
            const payload = {
                voice_mode_enabled: settings.voice_mode_enabled,
                tts_rate: Number(settings.tts_rate),
                tts_pitch: Number(settings.tts_pitch),
                stt_provider: settings.stt_provider || null,
                stt_language: settings.stt_language || null,
                avatar_type: settings.avatar_type || null,
                llm_model_voice: settings.llm_model_voice || null,
                ...Object.fromEntries(Object.keys(LANGUAGES).map(l => [
                    `tts_default_voice_${l}`, settings[`tts_default_voice_${l}`] || ''
                ])),
                ...Object.fromEntries(TTS_PROVIDERS.map(p => [
                    `tts_provider_enabled_${p}`, !!settings[`tts_provider_enabled_${p}`]
                ]))
            };
            // Only include API key fields when the admin actually entered
            // something — empty input means "leave the existing key alone".
            if (settings.google_tts_api_key.trim()) payload.google_tts_api_key = settings.google_tts_api_key.trim();
            if (settings.openai_tts_api_key.trim()) payload.openai_tts_api_key = settings.openai_tts_api_key.trim();
            const res = await apiPut('/platform-settings/voice', payload);
            toast.success?.('Voice settings saved');
            // Tolerant-validation warnings ("couldn't verify X; saved
            // unverified") surface instead of vanishing.
            for (const w of res?.warnings || []) toast.info?.(w);
            // After save, reload to pick up the *_set flags, refreshed
            // provider status (a new key flips capable), and clear inputs.
            await loadAll();
        } catch (err) {
            if (err instanceof ApiError) {
                toast.error?.(err.body?.error || 'Save failed');
            } else {
                toast.error?.(err.message);
            }
        } finally {
            setSaving(false);
        }
    };

    const clearKey = async (field) => {
        try {
            await apiPut('/platform-settings/voice', { [field]: '' });
            toast.success?.('Key cleared');
            await loadAll();
        } catch (err) {
            if (err instanceof ApiError) {
                toast.error?.(err.body?.error || 'Clear failed');
            } else {
                toast.error?.(err.message);
            }
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-neutral-400">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading voice settings…
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                    <Mic className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-bold">Voice & Avatar</h3>
                </div>
                <span className="text-xs text-neutral-500">
                    Voice 2.0 — each voice plays on its own engine
                </span>
            </div>

            <div className="flex items-start gap-2 p-3 rounded border border-sky-800 bg-sky-950/30 text-sky-200 text-sm">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                    Per-character voices are configured in the{' '}
                    <strong>case editor</strong> (patient voice) and the{' '}
                    <strong>agent persona editor</strong> (each agent), and
                    every voice plays on the engine it belongs to — there is
                    no platform engine to switch. This tab manages which
                    engines are <strong>enabled</strong>, the per-language{' '}
                    <strong>default voices</strong> (what plays when a
                    configured voice can't — missing engine, missing key, or
                    a paid-service outage), global rate/pitch, and the cloud
                    API keys. Platform-wide.
                </div>
            </div>

            {/* Configured voice providers — status cards, not a dropdown. */}
            <section>
                <h4 className="text-sm font-bold text-neutral-200 mb-2">Configured voice providers</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {TTS_PROVIDERS.map(p => {
                        const status = (settings.providers || []).find(x => x.id === p) || {};
                        return (
                            <div key={p} className="bg-neutral-800/50 border border-neutral-700 rounded p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-white">{ENGINE_INFO[p].label}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${
                                            isPaidProvider(p)
                                                ? 'bg-amber-900/30 text-amber-300 border-amber-800'
                                                : 'bg-emerald-900/30 text-emerald-300 border-emerald-800'
                                        }`}>
                                            {isPaidProvider(p) ? 'paid · API' : 'free · local'}
                                        </span>
                                    </div>
                                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={!!settings[`tts_provider_enabled_${p}`]}
                                            onChange={(e) => onToggleProvider(p, e.target.checked)}
                                            className="w-3.5 h-3.5 accent-purple-500"
                                        />
                                        <span className="text-neutral-400">enabled</span>
                                    </label>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <div className={`text-[11px] ${status.capable ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {status.capable
                                            ? (status.usable ? '✓ ready' : `configured, but ${status.reason || 'disabled'}`)
                                            : `✗ ${status.reason || 'not available'}`}
                                    </div>
                                    {/* One-click engine smoke test: audition this
                                        engine's first catalogue voice (preview is
                                        substitution-exempt — you hear THIS engine
                                        or an error, so a fresh API key is provable
                                        without leaving the card). */}
                                    {status.usable && (() => {
                                        const firstVoice = (catalogue.find(x => x.id === p)?.voices || [])[0];
                                        if (!firstVoice) return null;
                                        return (
                                            <div title={`Test ${ENGINE_INFO[p].label} with “${firstVoice.displayName || firstVoice.filename}”`}>
                                                <TestVoiceButton voice={firstVoice.filename} provider={p} />
                                            </div>
                                        );
                                    })()}
                                </div>
                                <p className="text-[11px] text-neutral-500">{ENGINE_INFO[p].blurb}</p>
                                {p === 'google' && (
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
                                {p === 'openai' && (
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
                        );
                    })}
                </div>
            </section>

            {/* Default voices — the per-language never-mute safety net. */}
            <section>
                <h4 className="text-sm font-bold text-neutral-200 mb-1">Default voices (platform-wide)</h4>
                <p className="text-[11px] text-neutral-500 mb-2">
                    Plays for a language's cases when the configured voice can't
                    play on this server. A <strong>local</strong> voice makes
                    the fallback immune to API outages. An unset language fails
                    loudly instead of playing a wrong-language voice.
                </p>
                <div className="space-y-2">
                    {Object.keys(LANGUAGES).map(lang => (
                        <DefaultVoiceRow
                            key={lang}
                            lang={lang}
                            value={settings[`tts_default_voice_${lang}`] || ''}
                            catalogue={catalogue}
                            rate={settings.tts_rate}
                            pitch={settings.tts_pitch}
                            onChange={(v) => update(`tts_default_voice_${lang}`, v)}
                        />
                    ))}
                </div>
            </section>

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

            {/* Rate & pitch — with an audition button so the sliders are
                never set deaf: it plays the en default voice at the CURRENT
                slider values (preview is substitution-exempt server-side). */}
            <div className="flex items-end gap-4">
                <div className="grid grid-cols-2 gap-4 flex-1">
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
                            Pitch ({settings.tts_pitch.toFixed(2)} st){' '}
                            <span className="text-neutral-600">— Google only</span>
                        </span>
                        <input
                            type="range"
                            min="-10" max="10" step="0.25"
                            value={settings.tts_pitch}
                            onChange={(e) => update('tts_pitch', Number(e.target.value))}
                            className="w-full accent-purple-500"
                        />
                    </label>
                </div>
                <div
                    className="pb-0.5"
                    title={settings.tts_default_voice_en
                        ? `Hear the en default voice (${settings.tts_default_voice_en}) at these rate/pitch values`
                        : 'Set an English default voice below to audition rate/pitch'}
                >
                    <TestVoiceButton
                        voice={settings.tts_default_voice_en || ''}
                        provider={settings.tts_default_voice_en ? guessVoiceProvider(settings.tts_default_voice_en) : null}
                        rate={settings.tts_rate}
                        pitch={settings.tts_pitch}
                    />
                </div>
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

            {/* Engine-off impact modal — the blast radius, by name, before
                the toggle lands. Configured voices are literal: with the
                engine off they FAIL, so this is the "these cases rely on
                this engine — disable anyway or cancel" gate. */}
            {disableConfirm && (
                <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Disable engine confirmation">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-5 max-w-lg w-full mx-4 space-y-3 shadow-2xl">
                        <h4 className="text-sm font-bold text-amber-400">
                            {disableConfirm.entries.length}{' '}
                            {disableConfirm.entries.length === 1 ? 'configured voice relies' : 'configured voices rely'}{' '}
                            on {ENGINE_INFO[disableConfirm.provider].label}
                        </h4>
                        <p className="text-xs text-neutral-400">
                            Configured voices are never substituted. With{' '}
                            <span className="font-mono text-neutral-300">{disableConfirm.provider}</span> disabled
                            (takes effect when you save), these will <strong>fail with an error</strong> until
                            their voices are re-picked or the engine is re-enabled:
                        </p>
                        <ul className="text-xs text-neutral-300 max-h-40 overflow-y-auto space-y-1 border border-neutral-800 rounded p-2">
                            {disableConfirm.entries.map(e => (
                                <li key={`${e.kind}-${e.id}`} className="flex justify-between gap-3">
                                    <span>{e.kind === 'case' ? 'Case' : 'Persona'}: {e.name}</span>
                                    <span className="font-mono text-neutral-500">{e.voice}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => setDisableConfirm(null)}
                                className="px-3 py-1.5 text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                            >
                                Cancel — keep enabled
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    update(`tts_provider_enabled_${disableConfirm.provider}`, false);
                                    setDisableConfirm(null);
                                }}
                                className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white font-bold"
                            >
                                Disable anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

// One per registry language: a select of every USABLE engine's voices that
// speak that language (grouped per engine, badged free/paid) + an audition
// button (preview plays the literal voice — never a substitute). An unset
// row shows the loud amber gap warning so "German has no fallback" is
// visible here, not just in the boot log.
function DefaultVoiceRow({ lang, value, catalogue, rate, pitch, onChange }) {
    const langName = LANGUAGES[lang]?.name || lang;
    const selectedProvider = value ? guessVoiceProvider(value) : null;
    const usableProviders = (catalogue || []).filter(p => p.usable);
    // A saved default must STAY visible when its engine becomes unusable
    // (key removed, outage) — a blank select would make an existing
    // fallback look unset, the exact "UI disagrees with storage" lie the
    // truth clause forbids. Render it under its own group with the reason.
    const valueListed = !!value && usableProviders.some(p =>
        (p.voices || []).some(v => v.filename === value));
    const valueEngineStatus = value
        ? (catalogue || []).find(p => p.id === selectedProvider)
        : null;
    return (
        <div className="bg-neutral-800/30 border border-neutral-800 rounded p-2">
            <div className="flex items-center gap-2">
                <span className="w-20 text-xs text-neutral-300 font-medium flex-shrink-0">{langName}</span>
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="flex-1 min-w-0 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-white"
                    aria-label={`Default voice for ${langName}`}
                >
                    <option value="">(none — {langName} fails loudly when a voice can't play)</option>
                    {value && !valueListed && (
                        <optgroup label={`saved — ${selectedProvider || 'engine'} unavailable`}>
                            <option value={value}>{value}</option>
                        </optgroup>
                    )}
                    {usableProviders.map(p => {
                        const speaking = (p.voices || []).filter(v =>
                            voiceMatchesLanguage(v.filename, p.id, lang) !== false);
                        if (speaking.length === 0) return null;
                        return (
                            <optgroup key={p.id} label={`${p.id} · ${isPaidProvider(p.id) ? 'paid · API' : 'free · local'}`}>
                                {speaking.map(v => (
                                    <option key={v.filename} value={v.filename}>
                                        {v.displayName || v.filename}
                                    </option>
                                ))}
                            </optgroup>
                        );
                    })}
                </select>
                {/* Audition at the PLATFORM rate/pitch — what a fallback
                    actually sounds like in a session, not factory settings. */}
                <TestVoiceButton
                    voice={value}
                    provider={selectedProvider}
                    rate={rate}
                    pitch={pitch}
                />
            </div>
            {!value && (
                <p className="text-[11px] text-amber-400 mt-1">
                    No fallback for {langName} — if a {langName} case's voice can't play
                    (missing engine, missing key, or a paid-service outage), playback
                    fails with an error instead. Pick a local voice to close the gap.
                </p>
            )}
            {value && !valueListed && (
                <p className="text-[11px] text-amber-400 mt-1">
                    The saved default “{value}” needs {selectedProvider || 'an engine'}, which is
                    currently unavailable{valueEngineStatus?.reason ? ` (${valueEngineStatus.reason})` : ''} —
                    {' '}{langName} falls back to a loud error until the engine returns or
                    another voice is picked.
                </p>
            )}
            {value && valueListed && selectedProvider && isPaidProvider(selectedProvider) && (
                <p className="text-[11px] text-neutral-500 mt-1">
                    Heads up: this default is a paid API voice — a local voice makes the
                    fallback immune to API outages.
                </p>
            )}
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
            const data = await apiFetch(`/tts/usage${s === 'all' ? '?scope=all' : ''}`);
            setUsage(data);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load('self');   }, []);

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
