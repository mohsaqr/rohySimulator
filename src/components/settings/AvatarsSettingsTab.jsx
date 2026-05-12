// Avatars settings page: per-gender persona defaults (avatar + voice + rate
// + pitch), per-agent assignment, gallery browser. All sections render
// previews via the same <PatientAvatar> the chat panel uses, so admin
// tweaks reflect the runtime exactly.

import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2, Save, Users, Image as ImageIcon, Sliders } from 'lucide-react';
import { baseUrl } from '../../config/api.js';
import { ApiError, apiFetch, apiPut } from '../../services/apiClient.js';
import { AgentService } from '../../services/AgentService.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import AvatarFramingSliders from './AvatarFraming.jsx';
import { mergeCameraPatch, resolveCamera } from '../../utils/avatarFraming.js';
import { parseConfig } from '../../utils/parseConfig.js';
import { avatarsForSlot } from '../../utils/resolveAvatar.js';

const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

// Three personas the platform pre-fills for new cases. Cases inherit by
// patient gender (with age<13 selecting the child slot) unless they override.
const PERSONAS = [
    { gender: 'male',   label: 'Male' },
    { gender: 'female', label: 'Female' },
    { gender: 'child',  label: 'Child' }
];

// 2026-05-12 — `default_voice_<provider>_<gender>` keys were removed from
// this tab's UI. Per-character voice now belongs in the case / persona
// editors only. The existing DB rows are not migrated (no destructive
// schema change) but the resolver ignores them, so editing them here would
// be a no-op trap. Keys kept here:
//   default_avatar_<gender>, default_rate_<gender>, default_pitch_<gender>
const FLAT_FIELDS = ['avatar', 'rate', 'pitch'];
const PERSONA_KEYS = PERSONAS.flatMap(p => FLAT_FIELDS.map(f => `default_${f}_${p.gender}`));

function emptyDefaults() {
    return Object.fromEntries(PERSONA_KEYS.map(k => [k, '']));
}

export default function AvatarsSettingsTab() {
    const toast = useToast();
    const {
        headManifest, setHeadManifest,
        platformAvatars, setPlatformAvatars
    } = useVoice();

    const [manifest, setManifestLocal] = useState(headManifest);
    const [defaults, setDefaults] = useState(() => ({ ...emptyDefaults(), ...(platformAvatars || {}) }));
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(!headManifest || !platformAvatars);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Reuse already-loaded values from VoiceContext when present;
                // otherwise fetch and write back so other consumers benefit too.
                // Voice catalogue + platform voice settings are no longer
                // fetched here — the per-persona voice picker that used them
                // was removed 2026-05-12.
                const needManifest = !headManifest;
                const needDefaults = !platformAvatars;
                const [manRes, defRes, ags] = await Promise.allSettled([
                    needManifest
                        ? fetch(baseUrl('/avatars/heads/manifest.json')).then(r => r.json())
                        : Promise.resolve(headManifest),
                    needDefaults
                        ? apiFetch('/platform-settings/avatars')
                        : Promise.resolve(platformAvatars),
                    AgentService.getTemplates()
                ]);
                if (cancelled) return;
                if (manRes.status === 'fulfilled') {
                    setManifestLocal(manRes.value);
                    if (needManifest) setHeadManifest(manRes.value);
                }
                if (defRes.status === 'fulfilled') {
                    const merged = { ...emptyDefaults() };
                    for (const k of PERSONA_KEYS) {
                        const v = defRes.value?.[k];
                        merged[k] = v == null ? '' : v;
                    }
                    setDefaults(merged);
                    if (needDefaults) setPlatformAvatars(merged);
                }
                if (ags.status === 'fulfilled') setAgents(ags.value || []);
            } catch (err) {
                toast.error?.(`Failed to load avatar settings: ${err.message}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveDefaults = async () => {
        try {
            await apiPut('/platform-settings/avatars', defaults);
            setPlatformAvatars(defaults);
            toast.success?.('Persona defaults saved');
        } catch (err) {
            if (err instanceof ApiError) {
                toast.error?.(err.body?.error || `Save failed (${err.status})`);
            } else {
                toast.error?.(err.message);
            }
        }
    };

    const saveAgent = async (agent) => {
        try {
            const config = parseConfig(agent.config);
            await AgentService.updateTemplate(agent.id, {
                avatar_url: agent.avatar_url || null,
                config: { ...config, avatar_camera: agent.avatar_camera || undefined }
            });
            toast.success?.(`${agent.name} saved`);
        } catch (err) {
            toast.error?.(err.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12 text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading avatars…
            </div>
        );
    }

    const updateDefault = (key, value) => setDefaults(d => ({ ...d, [key]: value }));

    return (
        <div className="space-y-8 max-w-5xl">
            <header>
                <h2 className="text-xl font-bold text-neutral-200">Avatars &amp; voices</h2>
                <p className="text-xs text-neutral-500 mt-1">
                    Per-gender persona defaults (avatar + voice + speech parameters). Cases inherit these by
                    patient gender unless they override. Children (age &lt; 13) use the Child slot.
                </p>
            </header>

            <Section title="Persona defaults" icon={Sliders} description="Pick a default face, speech rate and pitch for each gender. Per-character voice files live in the case / persona editor — not here.">
                <div className="space-y-4">
                    {PERSONAS.map(p => (
                        <PersonaCard
                            key={p.gender}
                            label={p.label}
                            gender={p.gender}
                            manifest={manifest}
                            avatarId={defaults[`default_avatar_${p.gender}`]}
                            rate={defaults[`default_rate_${p.gender}`]}
                            pitch={defaults[`default_pitch_${p.gender}`]}
                            onChange={(field, v) => {
                                updateDefault(`default_${field}_${p.gender}`, v);
                            }}
                        />
                    ))}
                </div>
                <div className="flex justify-end pt-2">
                    <button
                        type="button"
                        onClick={saveDefaults}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm font-bold flex items-center gap-2"
                    >
                        <Save className="w-4 h-4" /> Save persona defaults
                    </button>
                </div>
            </Section>

            <Section title="Agent personas" icon={Users} description="The active speaker's avatar shows in the patient panel. Pick a face and framing for each agent.">
                <div className="space-y-6">
                    {agents.map(agent => {
                        const config = parseConfig(agent.config);
                        const cameraOverride = agent.avatar_camera ?? config.avatar_camera ?? null;
                        const effectiveCamera = resolveCamera(manifest, agent.avatar_url, cameraOverride);
                        return (
                            <AvatarPickerCard
                                key={agent.id}
                                title={`${agent.name} — ${agent.role_title || agent.agent_type}`}
                                manifest={manifest}
                                avatarId={agent.avatar_url || ''}
                                camera={effectiveCamera}
                                hasOverride={!!cameraOverride}
                                onAvatarChange={id => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, avatar_url: id } : a))}
                                onCameraChange={patch => setAgents(prev => prev.map(a => {
                                    if (a.id !== agent.id) return a;
                                    const base = a.avatar_camera ?? parseConfig(a.config).avatar_camera ?? resolveCamera(manifest, a.avatar_url, null);
                                    return { ...a, avatar_camera: mergeCameraPatch(base, patch) };
                                }))}
                                onCameraReset={() => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, avatar_camera: null } : a))}
                                onSave={() => saveAgent(agent)}
                                showFraming={true}
                            />
                        );
                    })}
                </div>
            </Section>

            <Section title="Gallery" icon={ImageIcon} description="Every avatar in the manifest. Click one to see it at default framing.">
                <Gallery manifest={manifest} />
            </Section>
        </div>
    );
}

function Section({ title, description, icon: Icon, children }) {
    return (
        <section className="bg-neutral-900 rounded-lg border border-neutral-800 p-5 space-y-4">
            <div className="flex items-start gap-3">
                {Icon && <Icon className="w-5 h-5 text-purple-400 mt-0.5" />}
                <div>
                    <h3 className="text-sm font-bold text-neutral-200">{title}</h3>
                    {description && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
                </div>
            </div>
            {children}
        </section>
    );
}

// Per-gender persona row: avatar dropdown + voice dropdown + rate/pitch
// sliders + live preview. Each control writes one slot of the parent's
// `defaults` blob via onChange(field, value).
function PersonaCard({ label, gender, manifest, avatarId, rate, pitch, onChange }) {
    const avatars = avatarsForSlot(manifest, gender, avatarId);
    return (
        <div className="bg-neutral-800/50 rounded-lg border border-neutral-700 p-4">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-neutral-300">{label}</h4>
                <span className="text-[10px] text-neutral-500">slot: {gender}</span>
            </div>
            {/* Stack on narrow viewports; 3 columns on >=lg. min-w-0 on each
                cell is critical so long labels don't push siblings out. The
                per-persona voice picker that used to live in column 1 was
                removed 2026-05-12 — per-character voice now belongs in the
                case / persona editors only. */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px] gap-4 items-start">
                {/* Column 1: avatar */}
                <div className="space-y-2 min-w-0">
                    <label className="text-[10px] text-neutral-500 uppercase tracking-wide">Avatar</label>
                    <select
                        className="input-dark"
                        value={avatarId || ''}
                        onChange={e => onChange('avatar', e.target.value)}
                    >
                        <option value="">— pick —</option>
                        {avatars.map(a => (
                            <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                    </select>
                </div>

                {/* Column 2: rate + pitch */}
                <div className="space-y-3 min-w-0">
                    <SliderField
                        label="Speech rate"
                        hint="server tempo"
                        value={rate}
                        defaultDisplay="1.00"
                        min={0.5} max={1.5} step={0.05}
                        onChange={v => onChange('rate', v)}
                    />
                    <SliderField
                        label="Pitch"
                        hint="semitones"
                        value={pitch}
                        defaultDisplay="0.00"
                        min={-10} max={10} step={0.25}
                        onChange={v => onChange('pitch', v)}
                    />
                </div>

                {/* Column 3: live preview */}
                <div className="aspect-square w-full min-w-0">
                    {avatarId && manifest ? (
                        <Suspense fallback={<PreviewSpinner />}>
                            <PatientAvatar
                                patient={{ gender }}
                                headManifest={manifest}
                                avatarId={avatarId}
                            />
                        </Suspense>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[11px] text-neutral-500 bg-neutral-900/60 rounded border border-neutral-700">
                            Pick an avatar.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Numeric slider with a "(default)" affordance: empty/blank value means the
// platform falls back to whatever ChatInterface.resolveRatePitch decides.
// Setting any value persists it as the gender's default. Reset button clears.
function SliderField({ label, hint, value, defaultDisplay, min, max, step, onChange }) {
    const isSet = value !== '' && value != null;
    const display = isSet ? Number(value).toFixed(2) : defaultDisplay;
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-neutral-400">
                    {label} <span className="text-neutral-600">{hint}</span>
                </label>
                <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-mono ${isSet ? 'text-neutral-200' : 'text-neutral-500 italic'}`}>
                        {display}{!isSet && ' (unset)'}
                    </span>
                    {isSet && (
                        <button
                            type="button"
                            className="text-[10px] text-neutral-500 hover:text-neutral-300"
                            onClick={() => onChange('')}
                            title="Clear (use platform fallback)"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>
            <input
                type="range"
                min={min} max={max} step={step}
                value={isSet ? value : 1}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full"
            />
        </div>
    );
}

function AvatarPickerCard({
    title, manifest, avatarId, camera, hasOverride,
    onAvatarChange, onCameraChange, onCameraReset, onSave, showFraming, gender
}) {
    const options = manifest?.all || [];
    const filtered = gender ? options.filter(o => !gender || o.gender === gender) : options;
    return (
        <div className="bg-neutral-800/50 rounded-lg border border-neutral-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-neutral-300">{title}</h4>
                {onSave && (
                    <button
                        type="button"
                        onClick={onSave}
                        className="text-[11px] text-purple-400 hover:text-purple-200 flex items-center gap-1"
                    >
                        <Save className="w-3 h-3" /> Save
                    </button>
                )}
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                    <select
                        className="input-dark"
                        value={avatarId || ''}
                        onChange={e => onAvatarChange(e.target.value)}
                    >
                        <option value="">— pick —</option>
                        {filtered.map(a => (
                            <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                    </select>
                    {showFraming && avatarId && onCameraChange && (
                        <AvatarFramingSliders
                            camera={camera}
                            onChange={onCameraChange}
                            onReset={onCameraReset}
                            hasOverride={hasOverride}
                        />
                    )}
                </div>
                <div className="flex items-center justify-center">
                    {avatarId && manifest ? (
                        <div className="aspect-square w-full max-w-[200px]">
                            <Suspense fallback={<PreviewSpinner />}>
                                <PatientAvatar
                                    patient={{ gender }}
                                        headManifest={manifest}
                                    avatarId={avatarId}
                                    cameraOverride={camera}
                                />
                            </Suspense>
                        </div>
                    ) : (
                        <div className="text-[11px] text-neutral-500 text-center px-4">
                            Pick an avatar to preview.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PreviewSpinner() {
    return (
        <div className="w-full h-full rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
        </div>
    );
}

function Gallery({ manifest }) {
    const [selected, setSelected] = useState(null);
    const items = manifest?.all || [];
    const selectedItem = items.find(i => i.id === selected) || null;
    return (
        <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {items.map(it => (
                    <button
                        key={it.id}
                        type="button"
                        onClick={() => setSelected(it.id)}
                        className={`p-2 rounded border text-left transition-colors ${
                            selected === it.id
                                ? 'border-purple-500 bg-purple-500/10'
                                : 'border-neutral-700 bg-neutral-800/50 hover:border-neutral-600'
                        }`}
                    >
                        <div className="text-[11px] font-medium text-neutral-200 truncate">{it.label}</div>
                        <div className="text-[10px] text-neutral-500 truncate">{it.id}</div>
                    </button>
                ))}
            </div>
            <div className="aspect-square bg-neutral-800/50 rounded border border-neutral-700">
                {selectedItem ? (
                    <Suspense fallback={<PreviewSpinner />}>
                        <PatientAvatar
                            patient={{ gender: selectedItem.gender }}
                            headManifest={manifest}
                            avatarId={selectedItem.id}
                        />
                    </Suspense>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-neutral-500">
                        Click an avatar to preview.
                    </div>
                )}
            </div>
        </div>
    );
}
