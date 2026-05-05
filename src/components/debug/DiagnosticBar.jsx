// Live diagnostic footer — shows the runtime values that determine what the
// learner actually hears and sees. Reads from VoiceContext + AuthContext +
// EventLogger + the platform-LLM endpoint, with no plumbing through props.
//
// Toggle:
//   localStorage[rohy_diag_bar_enabled_<userId>] = '1' | '0'
// Default OFF. Admin enables via Settings → Notifications → Diagnostics or
// by clicking the floating "Diag" pill in the bottom-right corner.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, X, Activity } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { apiUrl } from '../../config/api';
import { AuthService } from '../../services/authService';
import EventLogger from '../../services/eventLogger';
import { resolveVoice } from '../../utils/voiceResolver';
import { parseConfig } from '../../utils/parseConfig';

const KEY_PREFIX = 'rohy_diag_bar_enabled_';
const storageKey = (uid) => `${KEY_PREFIX}${uid ?? 'anon'}`;

export function isDiagnosticBarEnabled(userId) {
    try {
        return localStorage.getItem(storageKey(userId)) === '1';
    } catch {
        return false;
    }
}

export function setDiagnosticBarEnabled(userId, enabled) {
    try {
        localStorage.setItem(storageKey(userId), enabled ? '1' : '0');
    } catch { /* ignore quota */ }
}

export default function DiagnosticBar() {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const {
        voiceMode, listening, speaking,
        voiceSettings, platformAvatars, activeParticipant
    } = useVoice();

    const [enabled, setEnabledState] = useState(() => isDiagnosticBarEnabled(userId));
    const [expanded, setExpanded] = useState(false);
    const [llm, setLlm] = useState(null);
    const [eventStatus, setEventStatus] = useState({});
    const [now, setNow] = useState(Date.now());
    // Configured speakers for the current case (patient + every agent). Shows
    // the resolved voice each one *would* play, even when not currently
    // active. This is the diagnostic surface that answers "the setting says
    // Neural2 but I hear Charon" — by showing both rows side-by-side.
    const [configuredSpeakers, setConfiguredSpeakers] = useState([]);

    // Re-read enabled flag when the user changes (login/logout) so the bar
    // honours the per-user toggle without a full reload.
    useEffect(() => {
        setEnabledState(isDiagnosticBarEnabled(userId));
    }, [userId]);

    // Fetch platform LLM block once when the bar appears. Cheap (cached
    // server-side) and the values rarely change mid-session.
    useEffect(() => {
        if (!enabled) return;
        const token = AuthService.getToken();
        if (!token) return;
        let cancelled = false;
        fetch(apiUrl('/platform-settings/llm'), {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (!cancelled && data) setLlm(data); })
            .catch(() => { /* ignore — bar just shows blanks */ });
        return () => { cancelled = true; };
    }, [enabled]);

    // EventLogger holds session/case context that's plumbed through
    // BackendSurfaceBridge. Read it on a 1s tick so the bar reflects new
    // sessions without re-rendering on every state change in the rest of
    // the app.
    useEffect(() => {
        if (!enabled) return;
        const tick = () => {
            try {
                const status = EventLogger.getStatus ? EventLogger.getStatus() : {};
                setEventStatus(status || {});
                setNow(Date.now());
            } catch { /* ignore */ }
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [enabled]);

    // Whenever the case changes, fetch its case_agents (patient template +
    // attached agents) and pre-resolve each one's voice. Shows the user every
    // speaker's voice at a glance.
    const caseId = eventStatus.caseId;
    useEffect(() => {
        if (!enabled || !caseId) { setConfiguredSpeakers([]); return; }
        const token = AuthService.getToken();
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                // Fetch case + case_agents in parallel.
                const [caseRes, agentsRes] = await Promise.all([
                    fetch(apiUrl(`/cases/${caseId}`), { headers: { Authorization: `Bearer ${token}` } }),
                    fetch(apiUrl(`/cases/${caseId}/agents`), { headers: { Authorization: `Bearer ${token}` } })
                ]);
                if (cancelled) return;
                const caseData = caseRes.ok ? await caseRes.json() : null;
                const agentsData = agentsRes.ok ? await agentsRes.json() : null;
                const speakers = [];

                // Patient row.
                const caseConfig = parseConfig(caseData?.case?.config || caseData?.config);
                const patientVoice = caseConfig?.voice;
                const patientGender = caseConfig?.demographics?.gender || '';
                const patientAge = caseConfig?.demographics?.age;
                const patientResolved = resolveVoice({
                    voice: patientVoice,
                    voiceSettings,
                    platformAvatars,
                    gender: patientGender,
                    age: patientAge
                });
                speakers.push({
                    role: 'patient',
                    name: caseConfig?.patient_name || caseData?.case?.name || 'Patient',
                    file: patientResolved.file,
                    provider: patientResolved.provider,
                    tier: patientResolved.tier
                });

                // Each configured agent row.
                for (const a of (agentsData?.agents || [])) {
                    const cfg = parseConfig(a.config);
                    const r = resolveVoice({
                        voice: cfg?.voice,
                        voiceSettings,
                        platformAvatars,
                        gender: cfg?.voice?.gender || cfg?.gender || ''
                    });
                    speakers.push({
                        role: a.agent_type || 'agent',
                        name: a.name || a.agent_type,
                        file: r.file,
                        provider: r.provider,
                        tier: r.tier
                    });
                }
                if (!cancelled) setConfiguredSpeakers(speakers);
            } catch (e) {
                console.warn('[DiagnosticBar] failed to load case speakers:', e.message);
            }
        })();
        return () => { cancelled = true; };
    }, [enabled, caseId, voiceSettings, platformAvatars]);

    const toggleEnabled = useCallback((next) => {
        setDiagnosticBarEnabled(userId, next);
        setEnabledState(next);
        if (!next) setExpanded(false);
    }, [userId]);

    // Derive the active speaker's resolved voice from the pre-resolved
    // configuredSpeakers table. Keying on name is fine because it's stable
    // for the lifetime of a case.
    //
    // Why not read activeParticipant.voice directly: deriveActiveParticipant
    // in ChatInterface only propagates avatar/gender/name fields, not the
    // voice block, so the live activeParticipant says "(falls through)"
    // even when the case has a `case_voice` override. The configured-speakers
    // table reads from /cases/:id where the override IS present, so it
    // accurately reflects what the runtime *will* play.
    const activeSpeakerRow = useMemo(() => {
        if (!activeParticipant) return null;
        return configuredSpeakers.find(s =>
            s.name === activeParticipant.name ||
            (activeParticipant.id?.startsWith('case:') && s.role === 'patient')
        ) || null;
    }, [activeParticipant, configuredSpeakers]);
    const speakerVoice = activeSpeakerRow?.file || null;
    const speakerTier = activeSpeakerRow?.tier || null;

    // Build the compact one-liner. Show only fields that have a value so the
    // bar stays readable. Voice tier appears next to the file so the user can
    // tell at a glance whether it's an override or a fallback.
    const oneLiner = useMemo(() => {
        const parts = [];
        if (llm?.provider) parts.push(`LLM: ${llm.provider}/${llm.model || '(default)'}`);
        if (voiceSettings?.tts_provider) {
            const v = speakerVoice || activeVoiceSlot(voiceSettings, activeParticipant);
            const tierTag = speakerTier ? ` (${speakerTier})` : '';
            parts.push(`TTS: ${voiceSettings.tts_provider}${v ? ` · ${v}${tierTag}` : ''}`);
        }
        parts.push(voiceMode ? 'voice ON' : 'voice OFF');
        if (activeParticipant?.name) parts.push(`speaker: ${activeParticipant.name}`);
        if (eventStatus.sessionId) parts.push(`s${eventStatus.sessionId}`);
        if (user?.tenant_id) parts.push(`t${user.tenant_id}`);
        return parts.join(' · ');
    }, [llm, voiceSettings, voiceMode, speakerVoice, speakerTier, activeParticipant, eventStatus.sessionId, user?.tenant_id]);

    // Floating toggle when bar is disabled — a tiny pill bottom-right that
    // surfaces the feature without requiring the user to dig into Settings.
    if (!enabled) {
        if (!user) return null;
        return (
            <button
                onClick={() => toggleEnabled(true)}
                className="fixed bottom-2 right-2 z-[9990] flex items-center gap-1 px-2 py-1 rounded-full bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700 text-xs text-neutral-400 hover:text-white shadow-lg"
                title="Show diagnostic bar"
                aria-label="Show diagnostic bar"
            >
                <Activity className="w-3 h-3" />
                <span>Diag</span>
            </button>
        );
    }

    return (
        <div
            className="fixed bottom-0 left-0 right-0 z-[9990] bg-neutral-950/95 border-t border-neutral-800 text-neutral-300 shadow-2xl backdrop-blur-sm"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-center gap-3 px-3 py-1.5 text-xs font-mono">
                <Activity className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="flex-1 text-left truncate hover:text-white"
                    title={expanded ? 'Collapse details' : 'Show all details'}
                >
                    {oneLiner || '(no runtime context yet)'}
                </button>
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="text-neutral-500 hover:text-white"
                    aria-label={expanded ? 'Collapse details' : 'Expand details'}
                >
                    {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
                <button
                    onClick={() => toggleEnabled(false)}
                    className="text-neutral-500 hover:text-red-400"
                    title="Hide diagnostic bar"
                    aria-label="Hide diagnostic bar"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {expanded && (
                <div className="border-t border-neutral-800 px-3 py-2 max-h-[40vh] overflow-y-auto text-xs font-mono">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                        <Section title="LLM (platform)">
                            <Row k="provider" v={llm?.provider} />
                            <Row k="model" v={llm?.model} />
                            <Row k="baseUrl" v={llm?.baseUrl} />
                            <Row k="temperature" v={llm?.temperature} />
                            <Row k="maxOutputTokens" v={llm?.maxOutputTokens} />
                            <Row k="enabled" v={String(llm?.enabled ?? '')} />
                            <Row k="apiKey" v={maskKey(llm?.apiKey)} />
                        </Section>
                        <Section title="Voice (platform)">
                            <Row k="tts_provider" v={voiceSettings?.tts_provider} />
                            <Row k="tts_rate" v={voiceSettings?.tts_rate} />
                            <Row k="tts_pitch" v={voiceSettings?.tts_pitch} />
                            <Row k="voice_mode_enabled" v={String(voiceSettings?.voice_mode_enabled ?? '')} />
                            <Row k="voice_*_male slot" v={pickSlot(voiceSettings, 'male')} />
                            <Row k="voice_*_female slot" v={pickSlot(voiceSettings, 'female')} />
                            <Row k="voice_*_child slot" v={pickSlot(voiceSettings, 'child')} />
                        </Section>
                        <Section title="Voice runtime">
                            <Row k="voice mode" v={voiceMode ? 'ON' : 'OFF'} />
                            <Row k="listening" v={String(listening)} />
                            <Row k="speaking" v={String(speaking)} />
                            <Row k="active speaker" v={activeParticipant?.name || '(none)'} />
                            <Row k="active gender" v={activeParticipant?.gender || ''} />
                            <Row k="active resolved voice" v={speakerVoice || '(no voice)'} />
                            <Row k="active voice tier" v={speakerTier || ''} />
                            <Row k="active avatar" v={activeParticipant?.avatar_id || activeParticipant?.avatar_url || ''} />
                        </Section>
                        <Section title="Session">
                            <Row k="sessionId" v={eventStatus.sessionId || ''} />
                            <Row k="caseId" v={eventStatus.caseId || ''} />
                            <Row k="caseName" v={eventStatus.caseName || ''} />
                            <Row k="userId" v={user?.id} />
                            <Row k="username" v={user?.username} />
                            <Row k="role" v={user?.role} />
                            <Row k="tenant_id" v={user?.tenant_id ?? ''} />
                            <Row k="updated" v={new Date(now).toISOString().split('T')[1].slice(0, 8) + 'Z'} />
                        </Section>
                        <Section title="Platform avatars">
                            <Row k="default_male" v={platformAvatars?.default_avatar_male} />
                            <Row k="default_female" v={platformAvatars?.default_avatar_female} />
                            <Row k="default_child" v={platformAvatars?.default_avatar_child} />
                            <Row k="avatar_type" v={voiceSettings?.avatar_type ?? platformAvatars?.avatar_type} />
                        </Section>
                    </div>

                    {/* Configured speakers — patient + every agent attached to
                        the case, with the voice each one would actually play
                        right now. Shows tier so you can see whether a row is
                        using a per-speaker case_voice override or falling
                        through to the platform slot. This is the canonical
                        view for "the setting says X but I hear Y" questions. */}
                    {configuredSpeakers.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <div className="text-emerald-400 font-bold tracking-wider uppercase mb-2">
                                Configured speakers (this case)
                            </div>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-neutral-500 border-b border-neutral-900">
                                        <th className="pr-3 py-1 font-normal">role</th>
                                        <th className="pr-3 py-1 font-normal">name</th>
                                        <th className="pr-3 py-1 font-normal">resolved voice</th>
                                        <th className="pr-3 py-1 font-normal">provider</th>
                                        <th className="pr-3 py-1 font-normal">tier</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {configuredSpeakers.map((s, i) => (
                                        <tr key={i} className="border-b border-neutral-900/50 hover:bg-neutral-900/40">
                                            <td className="pr-3 py-1 text-neutral-400">{s.role}</td>
                                            <td className="pr-3 py-1 text-white">{s.name}</td>
                                            <td className="pr-3 py-1 text-white">
                                                {s.file || <span className="italic text-neutral-600">no voice</span>}
                                            </td>
                                            <td className="pr-3 py-1 text-neutral-400">{s.provider}</td>
                                            <td className="pr-3 py-1">
                                                <TierBadge tier={s.tier} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="mt-2 text-[10px] text-neutral-600">
                                <code>override</code> = per-speaker <code>case_voice</code> set;{' '}
                                <code>platform-default</code> = persona default in /platform-settings/avatars;{' '}
                                <code>voice-slot</code> = falls through to <code>voice_&lt;provider&gt;_&lt;slot&gt;</code>.
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div>
            <div className="text-emerald-400 font-bold tracking-wider uppercase mb-1">{title}</div>
            <div className="space-y-0.5">{children}</div>
        </div>
    );
}

function Row({ k, v }) {
    if (v === undefined || v === null || v === '') {
        return (
            <div className="flex gap-2">
                <span className="text-neutral-500">{k}</span>
                <span className="text-neutral-700">·</span>
                <span className="text-neutral-700 italic">unset</span>
            </div>
        );
    }
    return (
        <div className="flex gap-2">
            <span className="text-neutral-500">{k}</span>
            <span className="text-neutral-700">·</span>
            <span className="text-white truncate" title={String(v)}>{String(v)}</span>
        </div>
    );
}

function maskKey(key) {
    if (!key) return '<unset>';
    const s = String(key);
    // E5's redaction policy ships short sentinels ("[redacted]" = 10 chars)
    // for any GET response. Show that verbatim instead of "***" so it's
    // obvious the value is *intentionally* hidden, not missing.
    if (s === '[redacted]') return '[redacted] (server-side)';
    if (s.length <= 10) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)`;
}

function TierBadge({ tier }) {
    if (!tier) return <span className="text-neutral-600 italic">no voice</span>;
    const palette = {
        'override': 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
        'platform-default': 'bg-blue-900/30 text-blue-300 border-blue-800',
        'voice-slot': 'bg-amber-900/30 text-amber-300 border-amber-800',
        'hardcoded': 'bg-orange-900/30 text-orange-300 border-orange-800',
        'catalog-first': 'bg-neutral-800 text-neutral-300 border-neutral-700'
    };
    const cls = palette[tier] || 'bg-neutral-800 text-neutral-300 border-neutral-700';
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${cls}`}>
            {tier}
        </span>
    );
}

// Find the platform default voice for the active speaker's slot. Used in
// the one-liner when the speaker has no per-speaker case_voice override.
function activeVoiceSlot(voiceSettings, participant) {
    if (!voiceSettings?.tts_provider) return '';
    const provider = voiceSettings.tts_provider;
    const gender = (participant?.gender || '').toLowerCase();
    const slot = /^f/.test(gender) ? 'female' : (gender === 'child' ? 'child' : 'male');
    return voiceSettings[`voice_${provider}_${slot}`] || '';
}

function pickSlot(voiceSettings, slot) {
    if (!voiceSettings?.tts_provider) return '';
    return voiceSettings[`voice_${voiceSettings.tts_provider}_${slot}`] || '';
}
