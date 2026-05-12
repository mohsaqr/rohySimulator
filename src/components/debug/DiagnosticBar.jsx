// Live diagnostic footer — shows the runtime values that determine what the
// learner actually hears and sees. Reads from VoiceContext + AuthContext +
// EventLogger + the platform-LLM endpoint, with no plumbing through props.
//
// Toggle:
//   localStorage[rohy_diag_bar_enabled_<userId>] = '1' | '0'
// Default OFF. Admin enables via Settings → Notifications → Diagnostics or
// by clicking the floating "Diag" pill in the bottom-right corner.
//
// Audit #22 — role gating:
// The bar surfaces operational metadata (platform LLM endpoint, TTS wire
// payloads, voice resolver tier) that should not be visible to learners
// even with browser-storage access. Visibility is now gated to
// admin / educator roles regardless of the localStorage flag. A non-
// admin user with rohy_diag_bar_enabled_<id>=1 still sees nothing — the
// per-user flag is preserved (so admins keep their preference), but the
// render gate adds a role check on top.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, X, Activity, Play, Square } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/apiClient';
import EventLogger from '../../services/eventLogger';
import { resolveVoice } from '../../utils/voiceResolver';
import { parseConfig } from '../../utils/parseConfig';
import { getLastTtsRequest, getRecentTtsRequests, auditionWirePayload } from '../../services/voiceService';
import { getBackendTelemetry } from '../../notifications/surfaces/BackendSurface';

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

// Roles allowed to see the diagnostic bar. Locked at the top of the file so
// auditors can see the policy without spelunking. Educators get access for
// course authoring (resolving "why does the patient sound wrong"); admins
// always; everyone else (student, reviewer, guest) is hidden.
const DIAG_BAR_VISIBLE_ROLES = new Set(['admin', 'educator']);

export function isDiagBarRoleAllowed(user) {
    if (!user) return false;
    const role = user.role === 'user' ? 'student' : user.role;
    return DIAG_BAR_VISIBLE_ROLES.has(role);
}

export default function DiagnosticBar() {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const roleAllowed = isDiagBarRoleAllowed(user);
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
    // Last literal /api/tts request body the runtime actually sent. The
    // configured-speakers table above is a static prediction (resolveVoice on
    // a snapshot of state); this row is the truth — what `voiceService.ttsFetch`
    // actually put on the wire and what response came back. Without this,
    // "the bar says voice X but I hear voice Y" arguments stall on hypothesis.
    const [lastTts, setLastTts] = useState(() => getLastTtsRequest());
    // Full ring buffer (newest first). The "last" pointer above is a
    // convenience for the one-liner; the table below uses the full history so
    // the user can see whether the voice changed mid-stream.
    const [wireHistory, setWireHistory] = useState(() => getRecentTtsRequests());
    // Audition state: {id} of the wire currently playing back, plus the stop
    // handle so the user can cancel mid-playback.
    const [auditionId, setAuditionId] = useState(null);
    const auditionStopRef = React.useRef(null);
    const [auditionError, setAuditionError] = useState(null);
    // Audit #20: backend persistence failure counters surfaced in the bar.
    // BackendSurface fires 'rohy:backend-telemetry' on every recordFailure;
    // we re-read the snapshot on each event so a sudden burst of alarm-log
    // failures becomes visible without polling.
    const [backendTelemetry, setBackendTelemetry] = useState(() => getBackendTelemetry());
    const [clientLogs, setClientLogs] = useState([]);
    const [clientLogsError, setClientLogsError] = useState(null);

    // Subscribe to BackendSurface telemetry events so the panel reflects
    // failures live. Listener is idempotent: re-reads the full snapshot
    // each time, no incremental state.
    useEffect(() => {
        if (!enabled) return;
        const onTelemetry = () => setBackendTelemetry(getBackendTelemetry());
        window.addEventListener('rohy:backend-telemetry', onTelemetry);
        // Also poll once on mount in case events fired before we subscribed.
        onTelemetry();
        return () => window.removeEventListener('rohy:backend-telemetry', onTelemetry);
    }, [enabled]);

    // Re-read enabled flag when the user changes (login/logout) so the bar
    // honours the per-user toggle without a full reload.
    useEffect(() => {
        setEnabledState(isDiagnosticBarEnabled(userId));
    }, [userId]);

    // Subscribe to live TTS wire events emitted by voiceService.ttsFetch.
    // Fires once per request lifecycle phase (pending, ok, error, aborted),
    // so the bar reflects the most-recent attempt without polling.
    useEffect(() => {
        if (!enabled) return;
        const handler = (e) => {
            setLastTts(e.detail);
            // Snapshot the buffer rather than mutate-in-place so React diffs.
            setWireHistory(getRecentTtsRequests());
        };
        window.addEventListener('rohy:tts-request', handler);
        // Pick up any request that fired before the bar was enabled.
        setLastTts(getLastTtsRequest());
        setWireHistory(getRecentTtsRequests());
        return () => window.removeEventListener('rohy:tts-request', handler);
    }, [enabled]);

    // Audition control. Plays the captured wire payload (default voice) or a
    // chosen alternative (e.g. Charon) so the user can verify against what
    // they think they heard. We stop any prior audition before starting a new
    // one — the underlying VoiceService.teardown() also cancels live runtime
    // playback, which is the right behaviour: pausing the runtime to listen
    // to a captured payload is exactly the workflow this is meant to support.
    const handleAudition = useCallback(async (wire, override) => {
        if (auditionStopRef.current) {
            try { auditionStopRef.current.stop(); } catch { /* noop */ }
            auditionStopRef.current = null;
        }
        if (auditionId === auditionKey(wire, override)) {
            // Toggle off if user re-clicks the same row+voice combo.
            setAuditionId(null);
            return;
        }
        setAuditionError(null);
        setAuditionId(auditionKey(wire, override));
        try {
            const handle = await auditionWirePayload(wire, override || {});
            auditionStopRef.current = handle;
            // When playback ends naturally, clear the spinner state.
            const totalMs = Math.ceil((handle.durationSec || 0) * 1000) + 200;
            setTimeout(() => {
                if (auditionStopRef.current === handle) {
                    auditionStopRef.current = null;
                    setAuditionId(prev => prev === auditionKey(wire, override) ? null : prev);
                }
            }, totalMs);
        } catch (err) {
            setAuditionError(err?.message || 'audition failed');
            setAuditionId(null);
        }
    }, [auditionId]);

    // Stop any in-flight audition when the bar is hidden so audio doesn't
    // continue after the user collapses the UI.
    useEffect(() => () => {
        if (auditionStopRef.current) {
            try { auditionStopRef.current.stop(); } catch { /* noop */ }
            auditionStopRef.current = null;
        }
    }, []);

    // Fetch platform LLM block once when the bar appears. Cheap (cached
    // server-side) and the values rarely change mid-session. Uses
    // apiFetch so cookie-mode users (no localStorage token) are still
    // authed via the rohy_auth cookie — pre-fix this raw-fetch sent
    // literal "Bearer null" and silently 403'd.
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        apiFetch('/platform-settings/llm')
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

    useEffect(() => {
        if (!enabled || !expanded || !roleAllowed) return;
        let cancelled = false;
        const load = async () => {
            const session = eventStatus.sessionId;
            const qs = new URLSearchParams({ limit: '50' });
            if (session) qs.set('session_id', String(session));
            try {
                const data = await apiFetch(`/client-logs?${qs.toString()}`);
                if (cancelled) return;
                const next = Array.isArray(data?.logs) ? data.logs : [];
                // 5s poll: skip the setState (and downstream re-render) when
                // the log set hasn't changed. Length + first/last id is a
                // cheap fingerprint — log rows have stable autoincrement ids.
                setClientLogs(prev => {
                    if (prev.length !== next.length) return next;
                    if (prev.length === 0) return prev;
                    if (prev[0]?.id !== next[0]?.id) return next;
                    if (prev[prev.length - 1]?.id !== next[next.length - 1]?.id) return next;
                    return prev;
                });
                setClientLogsError(prev => (prev === null ? prev : null));
            } catch (err) {
                if (cancelled) return;
                const msg = err?.message || 'failed to load client logs';
                setClientLogsError(prev => (prev === msg ? prev : msg));
            }
        };
        load();
        const id = setInterval(load, 5000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [enabled, expanded, roleAllowed, eventStatus.sessionId]);

    // Whenever the case changes, fetch its case_agents (patient template +
    // attached agents) and pre-resolve each one's voice. Shows the user every
    // speaker's voice at a glance.
    const caseId = eventStatus.caseId;
    useEffect(() => {
        if (!enabled || !caseId) { setConfiguredSpeakers([]); return; }
        let cancelled = false;
        (async () => {
            try {
                // Fetch case + case_agents + agent templates in parallel via
                // apiFetch (cookie-or-bearer auth handled centrally; null-token
                // surfaces as missing-Authorization → cookie fallback, not
                // "Bearer null"). The patient template is needed so the
                // diagnostic mirrors the chat runtime's case→template merge
                // — otherwise the bar reads "(no voice)" while the runtime
                // actually plays the persona default.
                const [caseData, agentsData, templatesData] = await Promise.all([
                    apiFetch(`/cases/${caseId}`).catch(() => null),
                    apiFetch(`/cases/${caseId}/agents`).catch(() => null),
                    apiFetch(`/agents/templates`).catch(() => null),
                ]);
                if (cancelled) return;
                const speakers = [];

                // Patient row — merge template voice with case overrides, same
                // shape as mergePatientVoiceConfig() in ChatInterface.
                const caseConfig = parseConfig(caseData?.case?.config || caseData?.config);
                const patientTemplate = (templatesData?.templates || [])
                    .find(t => t.agent_type === 'patient');
                const patientTemplateVoice = parseConfig(patientTemplate?.config)?.voice || {};
                const mergedPatientVoice = { ...patientTemplateVoice };
                for (const [k, v] of Object.entries(caseConfig?.voice || {})) {
                    if (v !== '' && v != null) mergedPatientVoice[k] = v;
                }
                const patientResolved = resolveVoice({
                    voice: mergedPatientVoice,
                    voiceSettings
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
                        voiceSettings
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
    }, [enabled, caseId, voiceSettings]);

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
    // tell at a glance whether it's an override or a fallback. When a wire
    // payload is available, prefer it over the static prediction — that's the
    // ground truth the user actually heard.
    const oneLiner = useMemo(() => {
        const parts = [];
        if (llm?.provider) parts.push(`LLM: ${llm.provider}/${llm.model || '(default)'}`);
        const wireVoice = lastTts?.voice;
        const wireProvider = lastTts?.provider;
        if (wireVoice) {
            // Live row wins. Surface the literal voice that was last sent on
            // the wire so the bar's headline matches what the user is hearing.
            parts.push(`TTS wire: ${wireProvider || '?'} · ${wireVoice}`);
        } else if (voiceSettings?.tts_provider) {
            const v = speakerVoice || activeVoiceSlot(voiceSettings, activeParticipant);
            const tierTag = speakerTier ? ` (${speakerTier})` : '';
            parts.push(`TTS: ${voiceSettings.tts_provider}${v ? ` · ${v}${tierTag}` : ''}`);
        }
        parts.push(voiceMode ? 'voice ON' : 'voice OFF');
        if (activeParticipant?.name) parts.push(`speaker: ${activeParticipant.name}`);
        if (eventStatus.sessionId) parts.push(`s${eventStatus.sessionId}`);
        if (user?.tenant_id) parts.push(`t${user.tenant_id}`);
        return parts.join(' · ');
    }, [llm, voiceSettings, voiceMode, speakerVoice, speakerTier, activeParticipant, eventStatus.sessionId, user?.tenant_id, lastTts]);

    // Audit #22: hard role gate. Non-admin/educator users see nothing,
    // even if their localStorage flag says enabled. Returning early
    // before any of the floating-pill / expanded-bar branches makes
    // the gate impossible to bypass via flag flipping.
    if (!roleAllowed) return null;

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
                        <Section title="Backend persistence (audit #20)">
                            <Row
                                k="alarm-log fails"
                                v={backendTelemetry.alarmLogFailures}
                                warn={backendTelemetry.alarmLogFailures > 0}
                            />
                            <Row
                                k="alarm-ack fails"
                                v={backendTelemetry.alarmAckFailures}
                                warn={backendTelemetry.alarmAckFailures > 0}
                            />
                            <Row
                                k="telemetry fails"
                                v={backendTelemetry.telemetryFailures}
                                warn={backendTelemetry.telemetryFailures > 0}
                            />
                            <Row
                                k="recent (last 20)"
                                v={backendTelemetry.recentFailures.length}
                            />
                            {backendTelemetry.recentFailures.slice(-3).reverse().map((f, i) => (
                                <Row
                                    key={`${f.at}-${i}`}
                                    k={`  ${f.kind}`}
                                    v={`${f.reason} (${f.status || 'net'})`}
                                />
                            ))}
                        </Section>
                        <Section title="Client log replay">
                            <Row k="rows" v={clientLogs.length} />
                            <Row k="status" v={clientLogsError || 'ok'} warn={Boolean(clientLogsError)} />
                        </Section>
                        <Section title="Platform avatars">
                            <Row k="default_male" v={platformAvatars?.default_avatar_male} />
                            <Row k="default_female" v={platformAvatars?.default_avatar_female} />
                            <Row k="default_child" v={platformAvatars?.default_avatar_child} />
                            <Row k="avatar_type" v={voiceSettings?.avatar_type ?? platformAvatars?.avatar_type} />
                        </Section>
                    </div>

                    {clientLogs.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <div className="text-emerald-400 font-bold tracking-wider uppercase mb-2">
                                Client log replay
                            </div>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-neutral-500 border-b border-neutral-900">
                                        <th className="pr-3 py-1 font-normal">ts</th>
                                        <th className="pr-3 py-1 font-normal">level</th>
                                        <th className="pr-3 py-1 font-normal">component</th>
                                        <th className="pr-3 py-1 font-normal">msg</th>
                                        <th className="pr-3 py-1 font-normal">request_id</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {clientLogs.map(log => (
                                        <tr key={log.id} className="border-b border-neutral-900/50 hover:bg-neutral-900/40">
                                            <td className="pr-3 py-1 text-neutral-500 whitespace-nowrap">{formatLogTime(log.ts)}</td>
                                            <td className="pr-3 py-1"><ClientLogLevel level={log.level} /></td>
                                            <td className="pr-3 py-1 text-neutral-300">{log.component}</td>
                                            <td className="pr-3 py-1 text-white truncate max-w-[60ch]" title={log.msg}>{log.msg}</td>
                                            <td className="pr-3 py-1 text-neutral-400 font-mono text-[10px]">{log.request_id || ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Live TTS wire history — the literal payloads the runtime
                        last sent to /api/tts (newest first, ring buffer). This
                        is the ground truth: every row above is a static
                        prediction; these rows are what actually flew. The play
                        button on each row replays the payload and the [vs.
                        male slot] button replays the same TEXT through the
                        platform's `voice_<provider>_male` slot so the user can
                        do an A/B comparison and confirm whether what they
                        heard matches the configured voice or a different one. */}
                    {wireHistory.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-emerald-400 font-bold tracking-wider uppercase">
                                    TTS wire history (last {wireHistory.length}, newest first)
                                </div>
                                {auditionError && (
                                    <div className="text-[10px] text-red-400">audition: {auditionError}</div>
                                )}
                            </div>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-neutral-500 border-b border-neutral-900">
                                        <th className="pr-2 py-1 font-normal w-8"></th>
                                        <th className="pr-3 py-1 font-normal">when</th>
                                        <th className="pr-3 py-1 font-normal">voice</th>
                                        <th className="pr-3 py-1 font-normal">provider</th>
                                        <th className="pr-3 py-1 font-normal">rate</th>
                                        <th className="pr-3 py-1 font-normal">status</th>
                                        <th className="pr-3 py-1 font-normal">text preview</th>
                                        <th className="pr-2 py-1 font-normal">A/B</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {wireHistory.map(w => {
                                        const playKey = auditionKey(w);
                                        const altVoice = pickSlot(voiceSettings, deriveSlotForGender(w.gender));
                                        const altKey = altVoice ? auditionKey(w, { voice: altVoice }) : null;
                                        const isPlayingPrimary = auditionId === playKey;
                                        const isPlayingAlt = altKey && auditionId === altKey;
                                        return (
                                            <tr key={w.id} className="border-b border-neutral-900/50 hover:bg-neutral-900/40">
                                                <td className="pr-2 py-1">
                                                    <button
                                                        onClick={() => handleAudition(w)}
                                                        disabled={w.status !== 'ok'}
                                                        title={w.status === 'ok'
                                                            ? `Re-play this wire payload (${w.voice})`
                                                            : 'replay only available for successful (ok) requests'}
                                                        className="w-5 h-5 flex items-center justify-center rounded bg-neutral-800 hover:bg-emerald-700 text-neutral-300 hover:text-white disabled:opacity-30 disabled:hover:bg-neutral-800"
                                                    >
                                                        {isPlayingPrimary
                                                            ? <Square className="w-3 h-3" />
                                                            : <Play className="w-3 h-3" />}
                                                    </button>
                                                </td>
                                                <td className="pr-3 py-1 text-neutral-500 whitespace-nowrap">
                                                    {w.sentAt ? `${Math.max(0, Math.round((now - w.sentAt) / 1000))}s ago` : ''}
                                                </td>
                                                <td className="pr-3 py-1 text-white">{w.voice || <span className="italic text-neutral-600">none</span>}</td>
                                                <td className="pr-3 py-1 text-neutral-300">{w.provider || ''}</td>
                                                <td className="pr-3 py-1 text-neutral-400">{w.rate ?? ''}</td>
                                                <td className="pr-3 py-1">
                                                    <WireStatusBadge wire={w} />
                                                </td>
                                                <td className="pr-3 py-1 text-neutral-300 truncate max-w-[18ch]" title={w.textPreview}>
                                                    {w.textPreview || ''}
                                                </td>
                                                <td className="pr-2 py-1">
                                                    {altVoice && altVoice !== w.voice ? (
                                                        <button
                                                            onClick={() => handleAudition(w, { voice: altVoice })}
                                                            disabled={w.status !== 'ok'}
                                                            title={`Play same text with ${altVoice} (platform male slot) for A/B comparison`}
                                                            className="text-[10px] px-1.5 py-0.5 rounded border border-amber-800 bg-amber-900/30 text-amber-300 hover:bg-amber-900/60 disabled:opacity-30"
                                                        >
                                                            {isPlayingAlt ? '■ stop' : `vs. ${shortVoice(altVoice)}`}
                                                        </button>
                                                    ) : null}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="mt-2 text-[10px] text-neutral-600">
                                <strong>Re-play</strong> (▶) re-fires the same /api/tts payload so you hear the captured voice.{' '}
                                <strong>vs. &lt;voice&gt;</strong> sends the same TEXT through the platform's male/female/child slot so you can A/B compare.{' '}
                                If the original (▶) sounds the same as what you heard during runtime, the wiring is correct.
                            </div>
                        </div>
                    )}

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

function Row({ k, v, warn = false }) {
    if (v === undefined || v === null || v === '') {
        return (
            <div className="flex gap-2">
                <span className="text-neutral-500">{k}</span>
                <span className="text-neutral-700">·</span>
                <span className="text-neutral-700 italic">unset</span>
            </div>
        );
    }
    const valueClass = warn ? 'text-amber-400 truncate' : 'text-white truncate';
    return (
        <div className="flex gap-2">
            <span className="text-neutral-500">{k}</span>
            <span className="text-neutral-700">·</span>
            <span className={valueClass} title={String(v)}>{String(v)}</span>
        </div>
    );
}

function formatLogTime(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[1].slice(0, 8);
}

function ClientLogLevel({ level }) {
    const palette = {
        debug: 'bg-neutral-800 text-neutral-300 border-neutral-700',
        info: 'bg-blue-900/30 text-blue-300 border-blue-800',
        warn: 'bg-amber-900/30 text-amber-300 border-amber-800',
        error: 'bg-red-900/40 text-red-300 border-red-800',
    };
    const cls = palette[level] || palette.info;
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${cls}`}>
            {level}
        </span>
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

// Compact label for the wire row. "ok" wins over the raw lifecycle phase
// because most of the time we land on success; the other phases are the ones
// that need attention.
function ttsStatusLabel(wire) {
    if (!wire) return '';
    if (wire.status === 'ok') return `ok${wire.httpStatus ? ` (${wire.httpStatus})` : ''}`;
    if (wire.status === 'error') return `error${wire.httpStatus ? ` (${wire.httpStatus})` : ''}`;
    if (wire.status === 'aborted') return 'aborted';
    if (wire.status === 'pending') return 'pending…';
    return wire.status;
}

// Color the status by lifecycle phase so the eye picks up the rare error /
// aborted entries in a fast scan.
function WireStatusBadge({ wire }) {
    const palette = {
        ok: 'bg-emerald-900/30 text-emerald-300 border-emerald-800',
        error: 'bg-red-900/40 text-red-300 border-red-800',
        aborted: 'bg-neutral-800 text-neutral-400 border-neutral-700',
        pending: 'bg-amber-900/30 text-amber-300 border-amber-800'
    };
    const cls = palette[wire?.status] || 'bg-neutral-800 text-neutral-400 border-neutral-700';
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${cls}`}>
            {ttsStatusLabel(wire)}
        </span>
    );
}

// Stable identity for an audition — same row + same voice override means the
// user is toggling the same playback, so we treat re-clicks as stop. Using
// id+voice instead of id alone lets the [vs. <slot>] button track separately
// from the primary [▶] button on the same row.
function auditionKey(wire, override) {
    if (!wire) return null;
    return `${wire.id}::${override?.voice || wire.voice}`;
}

// Map a wire's gender field to the slot key used in voice_*_<slot> platform
// settings. Mirrors voiceResolver.deriveSlot but without age (the wire never
// captures age — it's already been resolved out by the time we record).
function deriveSlotForGender(gender) {
    if (gender === 'child') return 'child';
    return /^f/i.test(gender || '') ? 'female' : 'male';
}

// Shorten a long voice name for the inline A/B button. Prefers the trailing
// distinctive segment (e.g. "Charon" or "Neural2-D") over the full string.
function shortVoice(voice) {
    if (!voice) return '?';
    const parts = voice.split('-');
    if (parts.length <= 3) return voice;
    return parts.slice(-2).join('-');
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

// No hardcoded fallback exists post-2026-05-12. When the configured-speakers
// table has no resolved voice for the active speaker, the bar shows
// "(no voice)" instead of guessing — that mirrors what the runtime does
// and makes "I haven't configured a voice yet" visible at a glance.
function activeVoiceSlot() {
    return '';
}

function pickSlot() {
    return '';
}
