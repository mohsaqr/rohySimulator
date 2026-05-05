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

    const toggleEnabled = useCallback((next) => {
        setDiagnosticBarEnabled(userId, next);
        setEnabledState(next);
        if (!next) setExpanded(false);
    }, [userId]);

    // Derive the active speaker's voice (resolver mirrors the runtime path).
    const speakerVoice = useMemo(() => {
        if (!activeParticipant) return null;
        const cfg = activeParticipant?.voice || activeParticipant?.config?.voice;
        return cfg?.case_voice || null;
    }, [activeParticipant]);

    // Build the compact one-liner. Show only fields that have a value so the
    // bar stays readable.
    const oneLiner = useMemo(() => {
        const parts = [];
        if (llm?.provider) parts.push(`LLM: ${llm.provider}/${llm.model || '(default)'}`);
        if (voiceSettings?.tts_provider) {
            const v = speakerVoice || activeVoiceSlot(voiceSettings, activeParticipant);
            parts.push(`TTS: ${voiceSettings.tts_provider}${v ? ` · ${v}` : ''}`);
        }
        parts.push(voiceMode ? 'voice ON' : 'voice OFF');
        if (activeParticipant?.name) parts.push(`speaker: ${activeParticipant.name}`);
        if (eventStatus.sessionId) parts.push(`s${eventStatus.sessionId}`);
        if (user?.tenant_id) parts.push(`t${user.tenant_id}`);
        return parts.join(' · ');
    }, [llm, voiceSettings, voiceMode, speakerVoice, activeParticipant, eventStatus.sessionId, user?.tenant_id]);

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
                            <Row k="apiKey" v={llm?.apiKey ? maskKey(llm.apiKey) : '<unset>'} />
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
                            <Row k="active voice (case_voice)" v={speakerVoice || '(falls through)'} />
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
                            <Row k="avatar_type" v={platformAvatars?.avatar_type} />
                        </Section>
                    </div>
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
    const s = String(key || '');
    if (s.length <= 10) return '***';
    return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)`;
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
