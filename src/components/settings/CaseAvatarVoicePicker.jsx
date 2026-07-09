import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RotateCcw } from 'lucide-react';
import { baseUrl } from '../../config/api.js';
import { apiFetch } from '../../services/apiClient.js';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import AvatarFramingSliders from './AvatarFraming.jsx';
import { mergeCameraPatch, resolveCamera } from '../../utils/avatarFraming.js';
import TestVoiceButton from './TestVoiceButton.jsx';
import { resolveVoice } from '../../utils/voiceResolver.js';
import { voiceGenderLabel } from '../../utils/voiceCatalogue.js';
import { avatarsForSlot } from '../../utils/resolveAvatar.js';
import { deriveDemographicSlot } from '../../utils/demographics.js';

// Per-case avatar + voice tab. Owns:
//   config.avatar_id           — GLB filename, blank = auto-pick by gender/age
//   config.avatar_camera       — { pos:[x,y,z], lookY, fov } framing override
//   config.voice.case_voice    — single voice id; overrides the Patient persona
//                                default. Blank = inherit the persona default.
//   config.voice.tts_rate      — server tempo (0.5–1.5), blank = inherit
//   config.voice.tts_pitch     — provider pitch in semitones, blank = inherit
//
// TTS provider is platform-wide (Settings → Voice). It's deliberately not
// editable per-case — having the provider in two places is what made it
// impossible to tell which engine the runtime would actually use.

// Pull in the 3D head only when the editor is open (~250 KB gzip lazy chunk).
const PatientAvatar = lazy(() => import('../chat/PatientAvatar'));

// Avatar slot is still demographic (the 3D head should match the patient).
// Only the *voice* lost its slot pickers.
function avatarSlotFor(config) {
    return deriveDemographicSlot(config?.demographics?.gender, config?.demographics?.age);
}

export default function CaseAvatarVoicePicker({ caseData, setCaseData, patientTemplateVoice = null }) {
    const { t } = useTranslation('authoring_case');
    const [manifest, setManifest] = useState(null);
    const [voices, setVoices] = useState([]);
    const {
        voiceSettings: ctxVoiceSettings,
        setVoiceSettings
    } = useVoice();
    const [fetchedVoiceSettings, setFetchedVoiceSettings] = useState(null);
    const voiceSettings = ctxVoiceSettings || fetchedVoiceSettings;
    // When the caller doesn't pass it in, fetch the Patient persona template
    // ourselves so the "inherits (…)" label shows the actual default the
    // runtime will play.
    const [fetchedTemplateVoice, setFetchedTemplateVoice] = useState(null);
    const templateVoice = patientTemplateVoice || fetchedTemplateVoice;

    const config = caseData?.config || {};
    const voice = config.voice || {};
    const cameraOverride = config.avatar_camera || null;
    const slot = avatarSlotFor(config);

    // The "what plays if you leave this case blank" preview comes from the
    // Patient persona template. That's the only fallback that exists now —
    // there's no hardcoded provider voice.
    const inheritedResolvedVoice = resolveVoice({
        voice: templateVoice || {},
        voiceSettings
    });
    const resolvedVoice = resolveVoice({
        voice: { ...(templateVoice || {}), ...voice },
        voiceSettings
    });

    const effectiveProvider = resolvedVoice.provider;
    const inheritedVoice = inheritedResolvedVoice.file || '';
    const inheritedRate = inheritedResolvedVoice.rate;
    const inheritedPitch = inheritedResolvedVoice.pitch;
    // Voice list is the full platform-provider catalogue — no slot filter.
    const voiceOptions = voices;

    useEffect(() => {
        let cancelled = false;
        fetch(baseUrl('/avatars/heads/manifest.json'))
            .then(r => r.ok ? r.json() : null)
            .then(m => { if (!cancelled) setManifest(m); })
            .catch(() => { /* manifest is optional */ });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (patientTemplateVoice) return;
        let cancelled = false;
        apiFetch('/agents/templates')
            .then(data => {
                if (cancelled) return;
                const patient = (data?.templates || []).find(t => t.agent_type === 'patient');
                let cfg = patient?.config;
                if (typeof cfg === 'string') {
                    try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
                }
                setFetchedTemplateVoice(cfg?.voice || {});
            })
            .catch(() => { /* leave null — inherit label will just say "(none set)" */ });
        return () => { cancelled = true; };
    }, [patientTemplateVoice]);

    useEffect(() => {
        if (voiceSettings) return;
        let cancelled = false;
        apiFetch('/platform-settings/voice')
            .then(v => {
                if (cancelled || !v) return;
                setFetchedVoiceSettings(v);
                setVoiceSettings?.(v);
            })
            .catch(() => { /* fallthrough — UI will show "no provider" hint */ });
        return () => { cancelled = true; };
    }, [voiceSettings, setVoiceSettings]);

    useEffect(() => {
        if (!effectiveProvider) { setVoices([]); return; }
        let cancelled = false;
        apiFetch(`/tts/voices?provider=${encodeURIComponent(effectiveProvider)}`)
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

    const avatarOptions = avatarsForSlot(manifest, slot, config.avatar_id);
    const effectiveCamera = resolveCamera(manifest, config.avatar_id, cameraOverride);

    return (
        <div className="space-y-6 max-w-5xl">
            {/* Avatar + framing + preview */}
            <section className="bg-neutral-800/50 rounded-lg p-5 border border-neutral-700 space-y-4">
                <header>
                    <h3 className="text-sm font-bold text-neutral-200">{t('avatar_heading')}</h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        {t('avatar_help', { slot })}
                    </p>
                </header>

                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                        <div>
                            <label className="label-xs">{t('avatar_3d_label')}</label>
                            <select
                                className="input-dark"
                                value={config.avatar_id || ''}
                                onChange={e => updateAvatarId(e.target.value)}
                            >
                                <option value="">{t('avatar_auto_option', { slot })}</option>
                                {avatarOptions.map(a => (
                                    <option key={a.id} value={a.id}>{a.label}</option>
                                ))}
                            </select>
                            {/* Stale-reference warning: a case may have been
                                authored against an avatar GLB that's since been
                                removed from the manifest (renamed/deleted). The
                                runtime falls back to the platform default
                                silently — surface that here so the admin can
                                pick a fresh avatar before saving. */}
                            {config.avatar_id && manifest && !avatarOptions.some(a => a.id === config.avatar_id) && (
                                <p className="text-[11px] text-amber-400 mt-1">
                                    {t('avatar_stale_before')}<span className="font-mono text-amber-200">{config.avatar_id}</span>{t('avatar_stale_after')}
                                </p>
                            )}
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
                                        headManifest={manifest}
                                        avatarId={config.avatar_id}
                                        cameraOverride={effectiveCamera}
                                    />
                                </Suspense>
                            </div>
                        ) : (
                            <div className="text-[11px] text-neutral-500 text-center px-4">
                                {t('avatar_preview_empty')}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Voice */}
            <section className="bg-neutral-800/50 rounded-lg p-5 border border-neutral-700 space-y-4">
                <header>
                    <h3 className="text-sm font-bold text-neutral-200">{t('voice_heading')}</h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        {t('voice_help_before')}<span className="text-neutral-300">{t('voice_settings_path')}</span>
                        {effectiveProvider ? <> {t('voice_provider_current_before')}<span className="font-mono text-neutral-300">{effectiveProvider}</span>{t('voice_provider_current_after')}</> : t('voice_no_provider')}
                        {t('voice_help_after')}
                    </p>
                </header>

                <div>
                    <div className="flex items-center justify-between">
                        <label className="label-xs">{t('case_voice_label')}</label>
                        {voice.case_voice && (
                            <button
                                type="button"
                                onClick={() => updateVoice('case_voice', '')}
                                className="text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
                            >
                                <RotateCcw className="w-3 h-3" /> {t('reset')}
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                        <select
                            className="input-dark flex-1 min-w-0"
                            value={voice.case_voice || ''}
                            onChange={e => updateVoice('case_voice', e.target.value)}
                            disabled={!effectiveProvider}
                        >
                            <option value="">
                                {inheritedVoice
                                    ? t('inherit_voice_with', { voice: inheritedVoice })
                                    : t('inherit_voice_none')}
                            </option>
                            {voiceOptions.map(v => {
                                const genderLabel = voiceGenderLabel(v);
                                const tag = genderLabel ? ` — ${genderLabel}` : '';
                                return (
                                    <option key={v.filename} value={v.filename}>
                                        {(v.displayName || v.filename) + tag}
                                    </option>
                                );
                            })}
                        </select>
                        <TestVoiceButton
                            voice={resolvedVoice.file || ''}
                            provider={effectiveProvider}
                            rate={resolvedVoice.rate}
                            pitch={resolvedVoice.pitch}
                        />
                    </div>
                </div>

                <SliderRow
                    label={t('speech_rate_label')}
                    hint={t('speech_rate_hint')}
                    min={0.5} max={1.5} step={0.05}
                    value={voice.tts_rate}
                    inherited={inheritedRate}
                    onChange={v => updateVoice('tts_rate', v)}
                    t={t}
                />

                <SliderRow
                    label={t('pitch_label')}
                    hint={t('pitch_hint')}
                    min={-10} max={10} step={0.25}
                    value={voice.tts_pitch}
                    inherited={inheritedPitch}
                    onChange={v => updateVoice('tts_pitch', v)}
                    t={t}
                />
            </section>
        </div>
    );
}

// Numeric slider with explicit "(inherits N from gender default)" hint.
// Empty value = inherit. ✕ button clears any override.
function SliderRow({ label, hint, min, max, step, value, inherited, onChange, t }) {
    const isSet = value != null && value !== '';
    const inheritDisplay = inherited == null || inherited === '' ? '1.00' : Number(inherited).toFixed(2);
    const display = isSet ? Number(value).toFixed(2) : t('slider_inherited', { value: inheritDisplay });
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
                            title={t('clear_override_title')}
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
