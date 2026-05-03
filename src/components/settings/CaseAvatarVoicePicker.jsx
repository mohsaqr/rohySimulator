import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { apiUrl, baseUrl } from '../../config/api.js';
import { AuthService } from '../../services/authService.js';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import AvatarFramingSliders from './AvatarFraming.jsx';
import { mergeCameraPatch, resolveCamera } from '../../utils/avatarFraming.js';
import TestVoiceButton from './TestVoiceButton.jsx';

// Per-case avatar + voice tab. Owns:
//   config.avatar_id           — GLB filename, blank = auto-pick by gender/age
//   config.avatar_camera       — { pos:[x,y,z], lookY, fov } framing override
//   config.voice.tts_provider  — 'piper' | 'kokoro' | '' (inherit)
//   config.voice.case_voice    — single voice id; wins over the gender slot
//   config.voice.tts_rate      — server tempo (0.5–1.5), blank = inherit
//   config.voice.tts_pitch     — client playbackRate (0.7–1.4), blank = inherit
//
// Empty-string values mean "inherit from the platform persona default for
// this case's gender". ChatInterface.resolveSpeakerSettings strips empties
// before merging so cases get a coherent voice/rate/pitch combo without
// having to set every field explicitly.

// Pull in the 3D head only when the editor is open (~250 KB gzip lazy chunk).
const PatientAvatar = lazy(() => import('../chat/PatientAvatar'));

const PROVIDER_OPTIONS = [
    { value: '',       label: 'Inherit (use global)' },
    { value: 'piper',  label: 'Piper (local, fast, robotic)' },
    { value: 'kokoro', label: 'Kokoro-82M (local, expressive)' },
    { value: 'google', label: 'Google Cloud TTS (cloud, 1M chars/month free)' },
    { value: 'openai', label: 'OpenAI TTS (cloud, lowest latency, paid)' }
];

// Decide which persona slot a case inherits from based on patient demographics.
function personaSlotFor(config) {
    const age = Number(config?.demographics?.age);
    const safeAge = Number.isFinite(age) ? age : 35;
    if (safeAge < 13) return 'child';
    return /^f/i.test(config?.demographics?.gender || '') ? 'female' : 'male';
}

export default function CaseAvatarVoicePicker({ caseData, setCaseData }) {
    const [manifest, setManifest] = useState(null);
    const [voices, setVoices] = useState([]);
    const { platformAvatars } = useVoice();

    const config = caseData?.config || {};
    const voice = config.voice || {};
    const cameraOverride = config.avatar_camera || null;
    const slot = personaSlotFor(config);

    const effectiveProvider = voice.tts_provider || 'piper';
    // Voice inheritance is keyed on the active TTS provider since voice IDs
    // are provider-specific. Rate and pitch are flat (provider-independent).
    const inheritedVoice = platformAvatars?.[`default_voice_${effectiveProvider}_${slot}`] || '';
    const inheritedRate  = platformAvatars?.[`default_rate_${slot}`];
    const inheritedPitch = platformAvatars?.[`default_pitch_${slot}`];

    useEffect(() => {
        let cancelled = false;
        fetch(baseUrl('/avatars/heads/manifest.json'))
            .then(r => r.ok ? r.json() : null)
            .then(m => { if (!cancelled) setManifest(m); })
            .catch(() => { /* manifest is optional */ });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetch(apiUrl(`/tts/voices?provider=${effectiveProvider}`), {
            headers: { 'Authorization': `Bearer ${AuthService.getToken()}` }
        })
            .then(r => r.ok ? r.json() : { voices: [] })
            .then(d => { if (!cancelled) setVoices(d.voices || []); })
            .catch(() => { if (!cancelled) setVoices([]); });
        return () => { cancelled = true; };
    }, [effectiveProvider]);

    const updateAvatarId = (val) => {
        setCaseData(prev => {
            const next = { ...(prev.config || {}) };
            if (val) next.avatar_id = val;
            else { delete next.avatar_id; delete next.avatar_camera; }
            return { ...prev, config: next };
        });
    };

    const updateCamera = (patch) => {
        setCaseData(prev => {
            const base = prev.config?.avatar_camera || resolveCamera(manifest, prev.config?.avatar_id, null);
            const next = mergeCameraPatch(base, patch);
            return { ...prev, config: { ...(prev.config || {}), avatar_camera: next } };
        });
    };

    const resetCamera = () => {
        setCaseData(prev => {
            const next = { ...(prev.config || {}) };
            delete next.avatar_camera;
            return { ...prev, config: next };
        });
    };

    const updateVoice = (key, val) => {
        setCaseData(prev => {
            const nextVoice = { ...(prev.config?.voice || {}) };
            if (val === '' || val === null || val === undefined) delete nextVoice[key];
            else nextVoice[key] = val;
            const nextConfig = { ...(prev.config || {}) };
            if (Object.keys(nextVoice).length === 0) delete nextConfig.voice;
            else nextConfig.voice = nextVoice;
            return { ...prev, config: nextConfig };
        });
    };

    const updateProvider = (val) => {
        setCaseData(prev => {
            const nextVoice = { ...(prev.config?.voice || {}) };
            // Provider change invalidates voice id (Kokoro and Piper share no filenames).
            delete nextVoice.case_voice;
            if (val === '') delete nextVoice.tts_provider;
            else nextVoice.tts_provider = val;
            const nextConfig = { ...(prev.config || {}) };
            if (Object.keys(nextVoice).length === 0) delete nextConfig.voice;
            else nextConfig.voice = nextVoice;
            return { ...prev, config: nextConfig };
        });
    };

    const avatarOptions = manifest?.all || [];
    const effectiveCamera = resolveCamera(manifest, config.avatar_id, cameraOverride);

    return (
        <div className="space-y-6 max-w-5xl">
            {/* Avatar + framing + preview */}
            <section className="bg-neutral-800/50 rounded-lg p-5 border border-neutral-700 space-y-4">
                <header>
                    <h3 className="text-sm font-bold text-neutral-200">Avatar</h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        Pick the 3D head and framing the patient panel uses for this case. Leave on Auto to
                        inherit the {slot} default.
                    </p>
                </header>

                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                        <div>
                            <label className="label-xs">3D Avatar</label>
                            <select
                                className="input-dark"
                                value={config.avatar_id || ''}
                                onChange={e => updateAvatarId(e.target.value)}
                            >
                                <option value="">Auto ({slot} default)</option>
                                {avatarOptions.map(a => (
                                    <option key={a.id} value={a.id}>{a.label}</option>
                                ))}
                            </select>
                        </div>

                        {config.avatar_id && (
                            <div className="pt-2 border-t border-neutral-700">
                                <AvatarFramingSliders
                                    camera={effectiveCamera}
                                    onChange={updateCamera}
                                    onReset={resetCamera}
                                    hasOverride={!!cameraOverride}
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-center">
                        {config.avatar_id && manifest ? (
                            <div className="aspect-square w-full max-w-[260px]">
                                <Suspense fallback={
                                    <div className="w-full h-full rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
                                    </div>
                                }>
                                    <PatientAvatar
                                        patient={config}
                                        avatarType="3d"
                                        headManifest={manifest}
                                        avatarId={config.avatar_id}
                                        cameraOverride={effectiveCamera}
                                    />
                                </Suspense>
                            </div>
                        ) : (
                            <div className="text-[11px] text-neutral-500 text-center px-4">
                                Pick an avatar to preview here.
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Voice */}
            <section className="bg-neutral-800/50 rounded-lg p-5 border border-neutral-700 space-y-4">
                <header>
                    <h3 className="text-sm font-bold text-neutral-200">Voice</h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        Empty fields inherit the platform's <span className="text-neutral-300">{slot}</span> persona
                        default. The first sentence of the LLM reply starts speaking as it streams — no extra
                        delay added.
                    </p>
                </header>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="label-xs">TTS engine</label>
                        <select
                            className="input-dark"
                            value={voice.tts_provider || ''}
                            onChange={e => updateProvider(e.target.value)}
                        >
                            {PROVIDER_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <div className="flex items-center justify-between">
                            <label className="label-xs">Case voice</label>
                            {voice.case_voice && (
                                <button
                                    type="button"
                                    onClick={() => updateVoice('case_voice', '')}
                                    className="text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
                                >
                                    <RotateCcw className="w-3 h-3" /> Reset
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                            <select
                                className="input-dark flex-1 min-w-0"
                                value={voice.case_voice || ''}
                                onChange={e => updateVoice('case_voice', e.target.value)}
                            >
                                <option value="">
                                    Inherit{inheritedVoice ? ` (${inheritedVoice})` : ` (${slot} default)`}
                                </option>
                                {voices.map(v => {
                                    const tag = v.gender ? ` — ${v.gender}` : '';
                                    return (
                                        <option key={v.filename} value={v.filename}>
                                            {(v.displayName || v.filename) + tag}
                                        </option>
                                    );
                                })}
                            </select>
                            <TestVoiceButton
                                voice={voice.case_voice || inheritedVoice}
                                provider={effectiveProvider}
                                rate={voice.tts_rate}
                                pitch={voice.tts_pitch}
                            />
                        </div>
                    </div>
                </div>

                <SliderRow
                    label="Speech rate"
                    hint="server tempo (no pitch change)"
                    min={0.5} max={1.5} step={0.05}
                    value={voice.tts_rate}
                    inherited={inheritedRate}
                    onChange={v => updateVoice('tts_rate', v)}
                />

                <SliderRow
                    label="Pitch"
                    hint="client playbackRate — couples with speed"
                    min={0.7} max={1.4} step={0.05}
                    value={voice.tts_pitch}
                    inherited={inheritedPitch}
                    onChange={v => updateVoice('tts_pitch', v)}
                />
            </section>
        </div>
    );
}

// Numeric slider with explicit "(inherits N from gender default)" hint.
// Empty value = inherit. ✕ button clears any override.
function SliderRow({ label, hint, min, max, step, value, inherited, onChange }) {
    const isSet = value != null && value !== '';
    const inheritDisplay = inherited == null || inherited === '' ? '1.00' : Number(inherited).toFixed(2);
    const display = isSet ? Number(value).toFixed(2) : `${inheritDisplay} (inherited)`;
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="label-xs">
                    {label} <span className="text-neutral-600 font-normal">{hint}</span>
                </label>
                <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-mono ${isSet ? 'text-neutral-200' : 'text-neutral-500 italic'}`}>
                        {display}
                    </span>
                    {isSet && (
                        <button
                            type="button"
                            className="text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
                            onClick={() => onChange('')}
                            title="Clear override (inherit from persona default)"
                        >
                            <RotateCcw className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>
            <input
                type="range"
                min={min} max={max} step={step}
                value={isSet ? Number(value) : (inherited != null && inherited !== '' ? Number(inherited) : 1)}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full"
            />
        </div>
    );
}
