import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Bot, User as UserIcon, Loader2, Stethoscope, Phone, Clock, Users, Mic, MicOff, Volume2, Eye, EyeOff } from 'lucide-react';
import { LLMService } from '../../services/llmService';
import { AgentService } from '../../services/AgentService';
import { buildPersonaBlocks } from '../../utils/personaBlocks';
import { roleAnchor } from '../../utils/roleAnchor';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { sttLocaleFor, DEFAULT_LANGUAGE } from '../../i18n/languages';
import { caseDisplayLabel } from '../../utils/caseDisplayLabel';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { baseUrl } from '../../config/api';
import { apiFetch, apiPost } from '../../services/apiClient';
import { usePatientRecord } from '../../services/PatientRecord';
import { VoiceService } from '../../services/voiceService';
import { useVoice } from '../../contexts/VoiceContext';
import { stripStageDirections } from '../../utils/stageDirections';
import { parseConfig } from '../../utils/parseConfig';
import { extractCompleteSentences } from '../../utils/sentenceSplit';
import { resolveVoice, voiceMatchesLanguage } from '../../utils/voiceResolver';
import { useToast } from '../../contexts/ToastContext';
import { useNotifications } from '../../notifications/useNotifications';
import { SOURCES, SEVERITY } from '../../notifications/types';
import { formatHistoryAsMarkdown } from '../../data/historyGroups';
import {
    formatRadiologyAsMarkdown,
    formatVitalsAsMarkdown,
    formatRecentActivityAsMarkdown,
} from '../../data/aiPromptContext';
import {
    buildPatientCaseDesignContext,
    formatPersonaDemographicsForPrompt,
    formatPersonalityForPrompt,
} from '../../utils/casePromptContext';
import { setLastPatientPrompt } from '../../utils/lastPatientPrompt';
import { pickWaitPhase, formatRemaining, waitProgressPct } from '../../utils/agentWait';

// Lazy-loaded so the ~270 KB gzipped Three.js / drei / r3f bundle is fetched
// only when a user actually toggles voice mode on for the first time.

// Agents eligible for their own chat tab. The patient already has a
// dedicated first tab driven by the case + attachedPatient merge, so an
// agent_type==='patient' template (the seeded "Default Patient") must NOT
// render a second tab mapped to the same person (Bug 10, 16.5.2026).
export function visibleAgentTabs(agents) {
    if (!Array.isArray(agents)) return [];
    return agents.filter(a => a && a.enabled !== false && a.agent_type !== 'patient');
}

// Build a participant {avatar_id, avatar_camera, gender, name, id} from the
// chat's current "who's talking" state — patient (from caseData) or one of
// the agents (from the agents list). Pushed into VoiceContext for PatientVisual.
function deriveActiveParticipant(activeTab, activeCase, agents) {
    if (activeTab === 'patient') {
        const c = activeCase?.config || {};
        return {
            avatar_id: c.avatar_id || null,
            avatar_camera: c.avatar_camera || null,
            gender: c.demographics?.gender || null,
            name: c.patient_name || null,
            age: c.demographics?.age || null,
            id: activeCase?.id ? `case:${activeCase.id}` : null
        };
    }
    const agent = agents.find(a => a.agent_type === activeTab);
    if (!agent) return null;
    const cfg = parseConfig(agent.config);
    // Agents lack a stored gender today — use cfg.gender if set, otherwise
    // fall back to a name/role heuristic so the platform-default fallback in
    // resolveAvatarId still routes male vs female correctly when avatar_url is blank.
    const guessedFemale = /female|relative/i.test(`${agent.name} ${agent.role_title || ''}`);
    return {
        avatar_id: agent.avatar_url || null,
        avatar_camera: cfg.avatar_camera || null,
        gender: cfg.gender || (guessedFemale ? 'female' : 'male'),
        name: agent.name,
        id: `agent:${agent.id}`
    };
}

// Shallow equality on the fields PatientAvatar reads. Lets the activeParticipant
// useEffect early-out when an agent-list refresh produced an equivalent shape.
function sameParticipant(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.avatar_id !== b.avatar_id || a.gender !== b.gender || a.id !== b.id || a.name !== b.name) return false;
    const ac = a.avatar_camera, bc = b.avatar_camera;
    if (ac === bc) return true;
    if (!ac || !bc) return false;
    return ac.lookY === bc.lookY && ac.fov === bc.fov
        && ac.pos?.[0] === bc.pos?.[0] && ac.pos?.[1] === bc.pos?.[1] && ac.pos?.[2] === bc.pos?.[2];
}

// Friendly TTS error → toast translation. The server bakes the upstream
// error message into err.message; we just rephrase the common cases so the
// admin knows where to look. Anything we don't recognise falls through with
// the raw message so we never silently swallow problems. `t` is the
// chat-namespace translator passed in from the component (this helper is
// module-level, so it can't call useTranslation itself).
function ttsErrorToast(toast, err, t) {
    if (!toast?.error) return;
    const msg = err?.message || t('tts_failed');
    if (/unknown.*voice|not in catalog/i.test(msg)) {
        toast.error(t('voice_not_valid_for_engine'));
    } else if (/api.?key|API_KEY/i.test(msg)) {
        toast.error(t('cloud_tts_missing_api_key'));
    } else {
        toast.error(t('voice_playback_failed', { msg }));
    }
}

const EMOTIONS_ROW1 = ['Inspired', 'Alert', 'Excited', 'Enthusiastic', 'Determined'];
const EMOTIONS_ROW2 = ['Afraid', 'Upset', 'Nervous', 'Scared', 'Distressed'];
// Display-key map for the emotion buttons. The English emotion word stays the
// canonical value logged to EventLogger and /emotion-logs; only the label the
// student sees goes through i18n (static keys — never t(variable)).
const EMOTION_KEYS = {
    Inspired: 'emotion_inspired',
    Alert: 'emotion_alert',
    Excited: 'emotion_excited',
    Enthusiastic: 'emotion_enthusiastic',
    Determined: 'emotion_determined',
    Afraid: 'emotion_afraid',
    Upset: 'emotion_upset',
    Nervous: 'emotion_nervous',
    Scared: 'emotion_scared',
    Distressed: 'emotion_distressed',
};
// Tab badge label per agent status; anything unknown renders as "Away".
const AGENT_STATUS_KEYS = {
    present: 'status_here',
    paged: 'status_coming',
    'on-call': 'status_on_call',
};
const ALARM_SPEECH_COOLDOWN_MS = 90 * 1000;
const AVATAR_ALARM_SPEECH_FORCE_OFF_KEY = 'rohy_avatar_alarm_speech_force_off';
const ALARM_SEVERITY_RANK = {
    [SEVERITY.WARNING]: 1,
    [SEVERITY.ERROR]: 2,
    [SEVERITY.CRITICAL]: 3,
};

function alarmSpeechLine(notification) {
    if (notification?.source !== SOURCES.CLINICAL) return null;
    if (!notification.key?.startsWith('alarm:')) return null;
    if (![SEVERITY.WARNING, SEVERITY.CRITICAL].includes(notification.severity)) return null;

    const data = notification.data || {};
    const key = notification.key.replace(/^alarm:/, '');
    const vital = data.vital || key.split('_')[0];
    const kind = data.thresholdType || key.split('_').slice(1).join('_');
    const critical = notification.severity === SEVERITY.CRITICAL;

    const lines = {
        hr_high: critical ? 'My heart is racing and I feel much worse.' : 'My heart feels like it is racing.',
        hr_low: critical ? 'I feel very weak and lightheaded.' : 'I feel weak and a little lightheaded.',
        spo2_low: critical ? 'I feel much more short of breath.' : 'I am getting more short of breath.',
        bpSys_low: critical ? 'I feel like I might pass out.' : 'I feel dizzy and lightheaded.',
        bpDia_low: critical ? 'I feel like I might pass out.' : 'I feel dizzy and lightheaded.',
        bpSys_high: critical ? 'My head is pounding and I feel worse.' : 'My head is starting to pound.',
        bpDia_high: critical ? 'My head is pounding and I feel worse.' : 'My head is starting to pound.',
        rr_high: critical ? 'I cannot catch my breath.' : 'It is getting harder to breathe.',
        rr_low: critical ? 'I feel very drowsy and it is hard to breathe.' : 'I feel unusually drowsy.',
        temp_high: critical ? 'I feel like I am burning up.' : 'I feel hot and unwell.',
        temp_low: critical ? 'I am shivering and feel very cold.' : 'I feel cold and shaky.',
        etco2_high: critical ? 'I feel drowsy and short of breath.' : 'I feel more drowsy.',
        etco2_low: critical ? 'I feel lightheaded and short of breath.' : 'I feel lightheaded.',
    };

    return lines[`${vital}_${kind}`] || (critical
        ? 'Something feels really wrong. I feel worse.'
        : 'I am starting to feel worse.');
}

function isAvatarAlarmSpeechForceOff() {
    try {
        return localStorage.getItem(AVATAR_ALARM_SPEECH_FORCE_OFF_KEY) === '1';
    } catch {
        return false;
    }
}

// Merge the patient's voice config: template is the base, the active case
// Voice 2.0: case and template voice configs are passed to resolveVoice
// UNMERGED (the old mergePatientVoiceConfig pre-merge meant an invalid
// case-level voice masked a valid template voice — plan P3). The resolver
// owns case-over-template precedence, validation-aware fallback, and the
// rate/pitch inherit chain, so this component and DiagnosticBar cannot
// diverge.

// One-time default-voice toast, deduped by the (played, provider) pair for
// the page lifetime: a re-render or repeated utterance never re-toasts.
// v1.4 sovereignty: the ONLY substitution left is the platform default
// standing in for a speaker with NO voice configured — configured voices
// are literal and fail loudly instead (ttsErrorToast carries the server's
// honest message for those).
const _substitutionToastShown = new Set();
function notifySubstitutionOnce(toast, t, r) {
    if (!r?.substituted || !r.file) return;
    const key = `${r.file}|${r.provider}`;
    if (_substitutionToastShown.has(key)) return;
    _substitutionToastShown.add(key);
    console.warn('[voice] playing platform default', {
        playing: r.file, provider: r.provider, reason: r.substitutionReason
    });
    toast?.info?.(t('voice_default_not_configured', { voice: r.file }));
}

export default function ChatInterface({ activeCase, onSessionStart, restoredSessionId, sessionStartTime, currentVitals, personaRefreshCounter = 0 }) {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [messagesLoaded, setMessagesLoaded] = useState(false);
    const messagesEndRef = useRef(null);
    // Last (voice|language) pair we already warned about — one toast per
    // combination, re-armed automatically when either side changes.
    const voiceLangWarnedRef = useRef(null);
    const { user } = useAuth();
    const { caseLanguage } = useLanguage();
    const { t } = useTranslation('chat');
    const toast = useToast();
    const { subscribe, prefs } = useNotifications();

    // Voice-mode transcript curtain. The transcript is the textual log of
    // what was said. Showing it during a real patient interaction feels
    // unnatural — you don't see captions in real life. So in voice mode we
    // hide it by default behind a clickable curtain; users can reveal it
    // explicitly when they want to review what was said.
    const [showTranscript, setShowTranscript] = useState(true);
    // Subtitle reveal gate. The subtitle band is tied to the TTS playback
    // window: it must not appear before the audio starts (or trainees read
    // ahead and tune the voice out), and it must disappear when audio ends.
    // True word-boundary streaming isn't available across all four TTS
    // providers, so we hold the caption back for ~30% of the estimated
    // utterance duration after `speaking` flips true — close enough to give
    // the audio a head start without going noticeably out of sync.
    const [subtitleReady, setSubtitleReady] = useState(false);

    // Recurring emotion questionnaire
    const [showQuestionnaire, setShowQuestionnaire] = useState(false);
    const questionnaireTimerRef = useRef(null);
    const QUESTIONNAIRE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

    const patientRecord = usePatientRecord();
    const { obtained } = patientRecord;
    const [messages, setMessages] = useState([]);
    const [chatSettings, setChatSettings] = useState({
        doctorName: 'Dr. Carmen',
        doctorAvatar: ''
    });

    // Voice mode (Stack T) — voiceSettings is loaded from /api/platform-settings/voice.
    // Defaults are intentionally absent in the frontend; voice mode only activates
    // when the admin has explicitly enabled it AND configured voices.
    // Voice/avatar state lives in VoiceContext so PatientVisual (a sibling
    // up in App.jsx) can render the live 3D head where the patient photo is.
    // ChatInterface owns the writes; visemes / headManifest are consumed by
    // PatientVisual directly so we don't read them here.
    const {
        voiceMode, setVoiceMode,
        listening, setListening,
        speaking, setSpeaking,
        setVisemes,
        voiceSettings, setVoiceSettings,
        setHeadManifest,
        setPlatformAvatars,
        setActiveParticipant
    } = useVoice();

    // Raw global voice settings live separately from per-case voice overrides.
    // VoiceContext must stay platform-only; patient/case overrides are passed
    // directly to resolveSpeakerVoice at the patient TTS callsite.
    const [globalVoiceSettings, setGlobalVoiceSettings] = useState(null);
    // In-flight /platform-settings/voice fetch — awaited by the voice-mode
    // send path so a send during the first render can't race to mute.
    const voiceSettingsPromiseRef = useRef(null);

    // Multi-agent state
    const [activeTab, setActiveTab] = useState('patient'); // 'patient' or agent_type
    const [agents, setAgents] = useState([]);
    // Resolved patient template (per-case attached → platform default).
    // Holds the merged-config object the server returns, or null if no patient
    // template has been attached/seeded — in which case the chat falls through
    // to the legacy case.config-only path.
    const [patientTemplate, setPatientTemplate] = useState(null);

    // Stage-4 audit: fetch the case snapshot at session start and freeze it
    // for the chat persona. Pre-fix `buildPatientSystemPrompt` read from
    // `activeCase.config` (live React state, re-fetched whenever the
    // /api/cases list refreshed), so an admin renaming the case or
    // editing the system_prompt mid-session shifted the in-progress chat's
    // persona. The snapshot stays immutable for the session's lifetime.
    const [caseSnapshot, setCaseSnapshot] = useState(null);
    useEffect(() => {
        const sid = sessionId || restoredSessionId;
        if (!sid) { setCaseSnapshot(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch(`/sessions/${sid}`);
                if (cancelled) return;
                const raw = data?.session?.case_snapshot;
                if (!raw) return;
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!cancelled) setCaseSnapshot(parsed);
            } catch (e) {
                console.warn('[ChatInterface] case snapshot fetch failed:', e.message);
            }
        })();
        return () => { cancelled = true; };
    }, [sessionId, restoredSessionId]);
    const [agentConversations, setAgentConversations] = useState({}); // { agent_type: [...messages] }
    const [agentStates, setAgentStates] = useState({}); // { agent_type: { status, paged_at, arrives_at, ... } }
    // Drives the "Dr. Chen is on the way — 1:42" countdown. One ticker
    // for the whole component; UI derives remaining time from each
    // agent's `arrives_at` (server-anchored, see migration 0024). No
    // per-agent setTimeout — those used to live here and got dropped
    // whenever the chat remounted, leaving agents stuck "on the way".
    const [nowTick, setNowTick] = useState(() => Date.now());
    const [teamLog, setTeamLog] = useState([]);
    const alarmSpeechCooldownRef = useRef(new Map());
    const pendingAlarmSpeechRef = useRef(null);

    // Load chat settings (doctor name/avatar)
    useEffect(() => {
        const loadChatSettings = async () => {
            try {
                const data = await apiFetch('/platform-settings/chat');
                setChatSettings(data);
            } catch (err) {
                console.error('Failed to load chat settings:', err);
            }
        };
        loadChatSettings();
    }, []);

    // Load voice settings + avatar manifest + platform default avatars in
    // parallel. The voice-settings PROMISE is kept in a ref so a voice-mode
    // send fired before the fetch resolves can await it instead of taking
    // the mute path (first-render race — VOICE2_PLAN.md §6.1; already
    // resolved after first load, so the await is free in the steady state).
    useEffect(() => {
        let cancelled = false;
        const voicePromise = apiFetch('/platform-settings/voice');
        voiceSettingsPromiseRef.current = voicePromise;
        (async () => {
            const [voiceRes, manifestRes, avatarsRes] = await Promise.allSettled([
                voicePromise,
                fetch(baseUrl('/avatars/heads/manifest.json')).then(r => r.ok ? r.json() : Promise.reject(new Error('manifest fetch'))),
                apiFetch('/platform-settings/avatars'),
            ]);
            if (cancelled) return;
            if (voiceRes.status === 'fulfilled') setGlobalVoiceSettings(voiceRes.value);
            if (manifestRes.status === 'fulfilled') setHeadManifest(manifestRes.value);
            if (avatarsRes.status === 'fulfilled') setPlatformAvatars(avatarsRes.value);
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!globalVoiceSettings) return;
        setVoiceSettings(globalVoiceSettings);
    }, [globalVoiceSettings, setVoiceSettings]);

    // Push the active participant into VoiceContext so PatientVisual mirrors
    // whoever the trainee is talking to. Updates skip when nothing changed
    // to avoid re-rendering every useVoice consumer on agents-list refreshes.
    useEffect(() => {
        const next = deriveActiveParticipant(activeTab, activeCase, agents);
        setActiveParticipant(prev => sameParticipant(prev, next) ? prev : next);
    }, [activeTab, activeCase?.id, activeCase?.config, agents, setActiveParticipant]);

    // If admin disables voice mode platform-wide, drop the local toggle too.
    useEffect(() => {
        if (voiceSettings && !voiceSettings.voice_mode_enabled && voiceMode) {
            setVoiceMode(false);
            VoiceService.cancelSpeech();
            VoiceService.stopListening();
        }
    }, [voiceSettings, voiceMode]);

    // Cleanup voice resources when the case changes or component unmounts.
    useEffect(() => {
        return () => {
            VoiceService.cancelSpeech();
            VoiceService.stopListening();
        };
    }, [activeCase?.id]);

    // Load agents for this case/session
    useEffect(() => {
        // Defensive clear: during a case switch, App.jsx sets sessionId to
        // null before the new session starts. Without this, patientTemplate
        // and the agents list keep the previous case's values for the
        // ~100-400ms window between cases, and any send during that window
        // mixes case B's persona block with case A's template prose. The
        // case-id stamp inside normalizePatientAgent is the second line of
        // defence; this clear is the first.
        if (!sessionId || !activeCase) {
            setPatientTemplate(null);
            setAgents([]);
            setAgentStates({});
            return;
        }

        const loadAgents = async () => {
            try {
                const agentList = await AgentService.getSessionAgents(sessionId);
                setAgents(agentList);

                // Initialize agent states
                const states = {};
                agentList.forEach(a => {
                    states[a.agent_type] = {
                        status: a.status || 'absent',
                        paged_at: a.paged_at,
                        arrives_at: a.arrives_at,
                        arrived_at: a.arrived_at
                    };
                });
                setAgentStates(states);

                // Patient template resolution: prefer per-case attached row;
                // otherwise pick a platform-default patient template by gender.
                // Order tried:
                //   1. Exact match — first-letter of case demographics.gender
                //      matches a template's config.voice.gender.
                //   2. For non-female cases (including empty gender, "Other",
                //      "Non-binary", anything that doesn't start with 'f'),
                //      fall back to the first NON-female template. This
                //      matches the seed doc that "Default Patient is used
                //      otherwise" and keeps the patient audible for cases
                //      that don't slot cleanly into male/female.
                //   3. Otherwise null. A female-coded case with only male
                //      templates seeded must NOT silently pick the male one
                //      — that's a real misconfig the admin needs to see, so
                //      we surface a loud error instead.
                const attachedPatient = agentList.find(a => a.agent_type === 'patient' && a.enabled !== 0 && a.enabled !== false);
                if (attachedPatient) {
                    setPatientTemplate(normalizePatientAgent(attachedPatient, activeCase.id));
                } else {
                    try {
                        const templates = await AgentService.getTemplates();
                        const patientDefaults = (templates || []).filter(t =>
                            t.agent_type === 'patient' && (t.is_default === 1 || t.is_default === true)
                        );
                        const caseGender = (activeCase?.config?.demographics?.gender || '').toLowerCase();
                        const firstLetter = caseGender.charAt(0);
                        const isFemaleCase = firstLetter === 'f';
                        const templateGender = (t) =>
                            (parseConfig(t.config)?.voice?.gender || '').toLowerCase();
                        const exact = patientDefaults.find((t) =>
                            firstLetter && templateGender(t).charAt(0) === firstLetter
                        );
                        const nonFemale = isFemaleCase
                            ? null
                            : patientDefaults.find((t) => templateGender(t).charAt(0) !== 'f');
                        const fallback = exact || nonFemale || null;
                        setPatientTemplate(fallback ? normalizePatientAgent(fallback, activeCase.id) : null);
                    } catch {
                        setPatientTemplate(null);
                    }
                }

                // Load team communications
                const log = await AgentService.getTeamCommunications(sessionId);
                setTeamLog(log);
            } catch (err) {
                console.error('Failed to load agents:', err);
            }
        };

        loadAgents();
        // `personaRefreshCounter` from App.jsx bumps when AgentPersonaEditor
        // saves, so this effect re-runs and refetches the Patient template +
        // agents list. Without it, the chat tab keeps the pre-edit copy and
        // an admin who just changed the patient persona's voice still hears
        // the old voice — exactly the bug that triggered today's session.
    }, [sessionId, activeCase?.id, activeCase?.config?.demographics?.gender, personaRefreshCounter]);

    // Load agent conversations when switching tabs
    useEffect(() => {
        if (activeTab === 'patient' || !sessionId) return;

        const loadConversation = async () => {
            try {
                const conversation = await AgentService.getConversation(sessionId, activeTab);
                setAgentConversations(prev => ({
                    ...prev,
                    [activeTab]: conversation.map(m => ({ role: m.role, content: m.content }))
                }));
            } catch (err) {
                console.error('Failed to load agent conversation:', err);
            }
        };

        // Only load if not already loaded
        if (!agentConversations[activeTab]) {
            loadConversation();
        }
    }, [activeTab, sessionId]);

    // Drive the countdown card. One ticker for the whole component;
    // the UI derives "Dr. Chen arrives in 1:42" from each agent's
    // `arrives_at`. The ticker is gated on whether any agent is paged
    // so we don't burn renders when nothing is in flight.
    const anyPaged = Object.values(agentStates).some(s => s?.status === 'paged');
    useEffect(() => {
        if (!anyPaged) return undefined;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [anyPaged]);

    // When any paged agent's ETA passes, refetch the agent list once.
    // The server flips paged → present on read, so a single GET is
    // enough to converge — the next tick will see the new status and
    // stop ticking. The `convergedRef` guards against re-firing the
    // fetch every second while we wait for the response.
    const convergedRef = useRef(new Set());
    useEffect(() => {
        if (!sessionId) return;
        const due = Object.entries(agentStates).filter(([type, s]) => {
            if (s?.status !== 'paged' || !s?.arrives_at) return false;
            if (convergedRef.current.has(type)) return false;
            return new Date(s.arrives_at).getTime() <= nowTick;
        });
        if (due.length === 0) return;

        due.forEach(([type]) => convergedRef.current.add(type));
        (async () => {
            try {
                const fresh = await AgentService.getSessionAgents(sessionId);
                setAgentStates(prev => {
                    const next = { ...prev };
                    fresh.forEach(a => {
                        next[a.agent_type] = {
                            status: a.status || 'absent',
                            paged_at: a.paged_at,
                            arrives_at: a.arrives_at,
                            arrived_at: a.arrived_at
                        };
                    });
                    return next;
                });
                // Drop converged entries so a future page cycle isn't
                // ignored. We only suppress duplicate fetches inside
                // this single ETA tick.
                due.forEach(([type]) => convergedRef.current.delete(type));
            } catch (err) {
                console.error('[ChatInterface] post-ETA agent refresh failed:', err);
                due.forEach(([type]) => convergedRef.current.delete(type));
            }
        })();
    }, [nowTick, agentStates, sessionId]);

    // Calculate elapsed time since session start
    const getElapsedMinutes = useCallback(() => {
        if (!sessionStartTime) return 0;
        return Math.floor((Date.now() - sessionStartTime) / 60000);
    }, [sessionStartTime]);

    // Check agent availability based on elapsed time
    const getAgentDisplayStatus = useCallback((agent) => {
        const elapsedMinutes = getElapsedMinutes();
        return AgentService.getAgentDisplayStatus(agent, elapsedMinutes);
    }, [getElapsedMinutes]);

    // Handle paging an agent.
    //
    // The server computes the arrival ETA (clamped to 1–3 min), stamps
    // `arrives_at` on agent_session_state, and returns it here. We copy
    // it into local state so the countdown card can render immediately.
    // We don't schedule a setTimeout to flip the status — the once-per-
    // second `nowTick` ticker plus the convergence loop below trigger a
    // refresh when the ETA passes, and the server's read paths flip the
    // row to 'present' on read. That means refresh / room switch / chat
    // remount all do the right thing without any extra plumbing.
    const handlePageAgent = async (agentType) => {
        const agent = agents.find(a => a.agent_type === agentType);
        if (!agent) return;

        try {
            const result = await AgentService.pageAgent(sessionId, agentType);
            const arrivesAt = result?.arrives_at || null;
            const pagedAt = new Date().toISOString();

            setAgentStates(prev => ({
                ...prev,
                [agentType]: {
                    ...(prev[agentType] || {}),
                    status: 'paged',
                    paged_at: pagedAt,
                    arrives_at: arrivesAt,
                    arrived_at: null
                }
            }));
        } catch (err) {
            console.error('Failed to page agent:', err);
        }
    };

    // Load chat history from database or localStorage.
    //
    // Stage-1 audit: previously the localStorage entry was keyed only by
    // caseId, so opening the same case in a fresh session restored the
    // previous session's chat. Now we additionally require the stored
    // sessionId to match restoredSessionId — for fresh sessions where
    // restoredSessionId is null, only an in-progress draft (also tagged
    // with sessionId=null) is allowed to restore.
    useEffect(() => {
        const loadChatHistory = async () => {
            if (!activeCase) return;

            // Try localStorage first (faster)
            try {
                const savedChat = localStorage.getItem('rohy_chat_history');
                if (savedChat) {
                    const parsed = JSON.parse(savedChat);
                    const caseMatches = parsed.caseId === activeCase.id;
                    const sessionMatches = (parsed.sessionId ?? null) === (restoredSessionId ?? null);
                    if (caseMatches && sessionMatches && parsed.messages?.length > 0) {
                        console.log('Restored chat from localStorage:', parsed.messages.length, 'messages');
                        setMessages(parsed.messages);
                        setMessagesLoaded(true);
                        return;
                    }
                    // Stale localStorage chat (different session). Clear it
                    // so the save effect below can take over with current data.
                    if (caseMatches && !sessionMatches) {
                        console.log('Discarding stale chat history from prior session');
                        localStorage.removeItem('rohy_chat_history');
                    }
                }
            } catch (e) {
                console.warn('Failed to parse localStorage chat:', e);
            }

            // If restoring a session, fetch from database
            if (restoredSessionId) {
                try {
                    const data = await apiFetch(`/interactions/${restoredSessionId}`);
                    if (data?.interactions?.length > 0) {
                        const chatMessages = data.interactions.map(i => ({
                            role: i.role,
                            content: i.content
                        }));
                        console.log('Restored chat from database:', chatMessages.length, 'messages');
                        setMessages(chatMessages);
                        localStorage.setItem('rohy_chat_history', JSON.stringify({
                            caseId: activeCase.id,
                            sessionId: restoredSessionId,
                            messages: chatMessages,
                            timestamp: Date.now()
                        }));
                    }
                } catch (e) {
                    console.error('Failed to fetch chat history from database:', e);
                }
            }
            setMessagesLoaded(true);
        };

        loadChatHistory();
    }, [activeCase, restoredSessionId]);

    // Save messages to localStorage whenever they change
    useEffect(() => {
        if (activeCase && messages.length > 0 && messagesLoaded) {
            localStorage.setItem('rohy_chat_history', JSON.stringify({
                caseId: activeCase.id,
                sessionId: sessionId || restoredSessionId || null,
                messages,
                timestamp: Date.now()
            }));
        }
    }, [messages, activeCase, messagesLoaded, sessionId, restoredSessionId]);

    // Initialize Session when Active Case Changes
    useEffect(() => {
        if (!activeCase || !user) return;

        const init = async () => {
            // If we have a restored session ID from parent, use it
            if (restoredSessionId) {
                console.log('Using restored session:', restoredSessionId);
                setSessionId(restoredSessionId);
                if (onSessionStart) {
                    onSessionStart(restoredSessionId);
                }
            } else {
                // Start new session
                setMessages([]); // Clear previous chat
                const sid = await LLMService.startSession(activeCase.id, user.username);
                setSessionId(sid);

                // Log session start
                EventLogger.sessionStarted(sid, activeCase.id, activeCase.name);

                // Notify parent of session start
                if (onSessionStart) {
                    onSessionStart(sid);
                }

                // Initial Greeting from Config
                const greeting = activeCase.config?.greeting;
                if (greeting) {
                    setMessages([{ role: 'assistant', content: greeting }]);
                    // Log initial greeting as received message
                    EventLogger.messageReceived(greeting, COMPONENTS.CHAT_INTERFACE);
                }
            }
        };
        init();
    }, [activeCase, user, restoredSessionId]);

    // Scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(() => { scrollToBottom(); }, [messages, agentConversations, activeTab]);

    // Build rich system prompt for patient chat
    //
    // Stage-4 audit: prefer the session's frozen `case_snapshot` over the
    // live `activeCase` so the persona stays stable for the session's
    // lifetime. Falls back to `activeCase` only if the snapshot fetch
    // hasn't completed yet (rare — the effect above runs on mount).
    const buildPatientSystemPrompt = () => {
        const sourceConfig = caseSnapshot?.config ?? activeCase.config ?? {};
        const sourceName = caseSnapshot?.name ?? activeCase.name;
        const sourceSystemPrompt = caseSnapshot?.system_prompt ?? activeCase.system_prompt;
        const config = sourceConfig;
        const demo = config.demographics || {};

        // Case-specific persona ALWAYS leads. The role/name/demographics block
        // is the model's first anchor — everything below (template baseline,
        // shared dos/donts, case design context) reads as supporting context.
        // Absent fields are omitted rather than filled with "Unknown" so the
        // model can't latch onto fake values.
        const trimOrEmpty = (v) => (v == null ? '' : String(v).trim());
        const personaRole = trimOrEmpty(config.persona_type) || 'the patient';
        const personaName = trimOrEmpty(config.patient_name) || trimOrEmpty(sourceName) || 'Patient';
        // Role anchor leads. See src/utils/roleAnchor.js. Without this,
        // the admin-authored case.system_prompt (which follows in the
        // INSTRUCTIONS block) can outweigh the PERSONA header alone —
        // especially when authored in third-person clinical voice
        // ("Patient presents with crushing chest pain") which the model
        // reads as instruction to BE the clinician describing the case.
        let richSystemPrompt = roleAnchor({ role: personaRole, name: personaName });
        richSystemPrompt += `## PERSONA\n`;
        richSystemPrompt += `Role: ${personaRole}\n`;
        richSystemPrompt += `Name: ${personaName}\n`;
        const demographicsBlock = formatPersonaDemographicsForPrompt(demo);
        if (demographicsBlock) {
            richSystemPrompt += `${demographicsBlock}\n`;
        }

        // Behavioural sliders the author set on the case (communication style,
        // emotional state, pain tolerance, cooperativeness, health literacy).
        // Only non-default values are surfaced — the helper drops defaults so
        // the prompt stays tight.
        const personalityBlock = formatPersonalityForPrompt(config.personality);
        if (personalityBlock) {
            richSystemPrompt += `\n## PATIENT BEHAVIOUR\n${personalityBlock}\n`;
        }

        richSystemPrompt += `\n## INSTRUCTIONS\n`;
        richSystemPrompt += `${sourceSystemPrompt || 'You are a patient.'}\n`;
        richSystemPrompt += `\nSpeak only what the patient would say aloud. Never use stage directions, narration, or asterisk-wrapped action descriptors (e.g. "*nods*", "*clutches chest*", "*sighs*"). Express feelings through words alone.\n`;

        // Patient agent template prose runs AFTER the case-specific persona +
        // instructions so the case anchors first and the template reads as
        // shared behavioral guidance — not a competing persona definition.
        //
        // Cross-case guard: only include the template block if it was
        // resolved for the case currently in focus. During a case switch,
        // patientTemplate may briefly hold the previous case's template
        // before the agents loader catches up; in that window, omit the
        // block rather than glue case B's persona to case A's template.
        const templateForThisCase = patientTemplate && patientTemplate._caseId === activeCase?.id
            ? patientTemplate
            : null;
        if (templateForThisCase?.systemPrompt) {
            richSystemPrompt += `\n## PATIENT PERSONA (from template "${templateForThisCase.name}")\n`;
            richSystemPrompt += `${templateForThisCase.systemPrompt}\n`;
        }
        const personaBlocks = templateForThisCase ? buildPersonaBlocks(templateForThisCase.config) : '';
        if (personaBlocks) {
            richSystemPrompt += personaBlocks;
        }

        richSystemPrompt += buildPatientCaseDesignContext({
            ...activeCase,
            name: sourceName,
            system_prompt: sourceSystemPrompt,
            config,
        });

        if (config.constraints) {
            richSystemPrompt += `\n## CONSTRAINTS\n${config.constraints}\n`;
        }

        // Append Config Pages as Markdown Context if they exist
        if (config.pages && config.pages.length > 0) {
            richSystemPrompt += "\n---\n## PATIENT MEDICAL RECORD (Hidden Context)\n";
            richSystemPrompt += "Only reveal this information if specifically asked or relevant to the history taking.\n";

            config.pages.forEach(page => {
                richSystemPrompt += `\n### ${page.title}\n${page.content}\n`;
            });
        }

        // Append Clinical Records based on AI Access settings
        const clinicalRecords = config.clinicalRecords || {};
        const aiAccess = clinicalRecords.aiAccess || {
            history: true,
            physicalExam: true,
            medications: true,
            radiology: false,
            procedures: true,
            notes: false
        };

        let hasAnyRecords = false;

        // History & HPI — formatted by the canonical group structure so the
        // LLM sees the same Present-History / Past-Medical / Personal-&-Social
        // shape the human authors and views. Single source of truth lives in
        // src/data/historyGroups.js; consumers must NOT re-implement the flat
        // → grouped mapping here.
        if (aiAccess.history && clinicalRecords.history) {
            const historyMarkdown = formatHistoryAsMarkdown(clinicalRecords.history);
            if (historyMarkdown) {
                if (!hasAnyRecords) {
                    richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                    hasAnyRecords = true;
                }
                richSystemPrompt += `\n### Medical History\n${historyMarkdown}\n`;
            }
        }

        // Physical Exam
        if (aiAccess.physicalExam && clinicalRecords.physicalExam) {
            const pe = clinicalRecords.physicalExam;
            const peParts = [];
            if (pe.general) peParts.push(`General: ${pe.general}`);
            if (pe.heent) peParts.push(`HEENT: ${pe.heent}`);
            if (pe.cardiovascular) peParts.push(`Cardiovascular: ${pe.cardiovascular}`);
            if (pe.respiratory) peParts.push(`Respiratory: ${pe.respiratory}`);
            if (pe.abdomen) peParts.push(`Abdomen: ${pe.abdomen}`);
            if (pe.neurological) peParts.push(`Neurological: ${pe.neurological}`);
            if (pe.extremities) peParts.push(`Extremities/Skin: ${pe.extremities}`);

            if (peParts.length > 0) {
                if (!hasAnyRecords) {
                    richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                    hasAnyRecords = true;
                }
                richSystemPrompt += `\n### Physical Examination\n${peParts.join('\n')}\n`;
            }
        }

        // Medications
        if (aiAccess.medications && clinicalRecords.medications?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                hasAnyRecords = true;
            }
            const medList = clinicalRecords.medications.map(m =>
                `- ${m.name} ${m.dose} ${m.route} ${m.frequency}${m.indication ? ` (for ${m.indication})` : ''}`
            ).join('\n');
            richSystemPrompt += `\n### Current Medications\n${medList}\n`;
        }

        // Radiology — formatted by the shared helper so the LLM sees a stable
        // text shape (image URLs intentionally omitted; binary assets aren't
        // useful context for a text model).
        if (aiAccess.radiology && clinicalRecords.radiology?.length > 0) {
            const radiologyMarkdown = formatRadiologyAsMarkdown(clinicalRecords.radiology);
            if (radiologyMarkdown) {
                if (!hasAnyRecords) {
                    richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                    hasAnyRecords = true;
                }
                richSystemPrompt += `\n### Radiology Studies\n${radiologyMarkdown}\n`;
            }
        }

        // Procedures
        if (aiAccess.procedures && clinicalRecords.procedures?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                hasAnyRecords = true;
            }
            const procList = clinicalRecords.procedures.map(p =>
                `- ${p.name}${p.date ? ` (${p.date})` : ''}: ${p.indication || 'No indication documented'}${p.findings ? ` - Findings: ${p.findings}` : ''}${p.complications ? ` - Complications: ${p.complications}` : ''}`
            ).join('\n');
            richSystemPrompt += `\n### Procedures\n${procList}\n`;
        }

        // Clinical Notes
        if (aiAccess.notes && clinicalRecords.notes?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
            }
            const noteList = clinicalRecords.notes.map(n =>
                `#### ${n.type}${n.title ? `: ${n.title}` : ''} (${n.date || 'No date'}${n.author ? `, ${n.author}` : ''})\n${n.content || 'No content'}`
            ).join('\n\n');
            richSystemPrompt += `\n### Clinical Notes\n${noteList}\n`;
        }

        // Live patient state — current vitals from PatientRecord. Without this
        // the AI guesses when asked "how do you feel" / "what's your heart
        // rate"; with it, the model can answer consistent with the monitor.
        const vitalsMarkdown = formatVitalsAsMarkdown(patientRecord?.record?.current_state?.vitals);
        if (vitalsMarkdown) {
            richSystemPrompt += `\n---\n## CURRENT PATIENT STATE\n${vitalsMarkdown}\n`;
            richSystemPrompt += `\nAnswer questions about how you currently feel in a way consistent with these vitals.\n`;
        }

        // Session activity feedback — tells the AI what the student has
        // already done so far in THIS session. Without it, the AI has no
        // memory of prior actions (the chat history is the assistant's only
        // proxy for that, and it doesn't capture non-verbal events like exams
        // or treatments). Capped at the last 10 events to bound prompt size.
        const recentActivity = formatRecentActivityAsMarkdown(patientRecord?.record?.events, 10);
        if (recentActivity) {
            richSystemPrompt += `\n---\n## SESSION ACTIVITY SO FAR (clinician's actions this encounter)\n${recentActivity}\n`;
            richSystemPrompt += `\nDo not repeat answers to questions that were already obtained above. Acknowledge prior actions when relevant.\n`;
        }

        // Stash for the DiagnosticBar "show assembled prompt" inspector.
        // Bounded to a single value — only the most recent assembly is kept.
        setLastPatientPrompt({
            prompt: richSystemPrompt,
            caseId: activeCase?.id ?? null,
            caseName: sourceName ?? null,
            sessionId: sessionId ?? null,
        });

        return richSystemPrompt;
    };

    // Pre-assemble the patient prompt once the case + (optional) snapshot +
    // patient template are ready, so the DiagnosticBar inspector has
    // something to show before the learner sends their first message.
    // buildPatientSystemPrompt reads state + props and writes the module
    // cache via setLastPatientPrompt (the "pre-warm" side effect we want);
    // the returned string is intentionally discarded here. Live vitals and
    // session events are deliberately NOT in the dep list — including them
    // would re-stash the prompt on every monitor tick, churning the cache
    // for no inspector benefit. The cache is refreshed for real on each
    // outgoing patient message anyway.
    useEffect(() => {
        if (!activeCase) return;
        try {
            buildPatientSystemPrompt();
        } catch {
            // Don't let inspector pre-warm failures break the chat surface.
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCase, caseSnapshot, patientTemplate, sessionId]);

    // Schedule the next questionnaire appearance (2 min from now)
    const startQuestionnaireTimer = useCallback(() => {
        if (questionnaireTimerRef.current) clearTimeout(questionnaireTimerRef.current);
        questionnaireTimerRef.current = setTimeout(() => {
            setShowQuestionnaire(true);
        }, QUESTIONNAIRE_INTERVAL_MS);
    }, [QUESTIONNAIRE_INTERVAL_MS]);

    // Start timer when session becomes active; clean up when it ends or on unmount
    useEffect(() => {
        if (sessionId) {
            startQuestionnaireTimer();
        } else {
            if (questionnaireTimerRef.current) clearTimeout(questionnaireTimerRef.current);
            setShowQuestionnaire(false);
        }
        return () => {
            if (questionnaireTimerRef.current) clearTimeout(questionnaireTimerRef.current);
        };
    }, [sessionId, startQuestionnaireTimer]);

    // Emotion logging — hides questionnaire and resets the 2-minute timer
    const handleEmotionClick = async (emotion) => {
        if (!sessionId) return;
        setShowQuestionnaire(false);
        startQuestionnaireTimer();
        // Canonical xAPI event (routes through EventLogger → BackendSurface
        // → /learning-events/batch). The previous /events/batch dual-write
        // to the legacy event_log table was dropped in Phase 2 of
        // PLAN_LOGGING.md.
        EventLogger.emotionExpressed(emotion, COMPONENTS.CHAT_INTERFACE);
        try {
            await apiPost('/emotion-logs', {
                session_id: sessionId,
                case_id: activeCase?.id,
                emotion,
            });
        } catch (err) {
            console.error('Failed to log emotion:', err);
        }
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading || !sessionId) return;

        // If on patient tab, send to patient
        if (activeTab === 'patient') {
            await handleSendToPatient();
        } else {
            // Send to agent
            await handleSendToAgent(activeTab);
        }
    };

    // Voice resolution goes through the shared util in src/utils/voiceResolver.js
    // (see that file's header for the full Voice 2.0 chain). Case + template
    // are passed UNMERGED — the P3 fix lives in the resolver — the session
    // language selects which platform default may substitute, and validity
    // comes from the providers status the server put in voiceSettings.
    // There is no engine setting: each voice's engine derives from its id.
    const resolveSpeakerVoice = useCallback((caseVoice, templateVoice = null, settings = voiceSettings) => resolveVoice({
        voice: caseVoice,
        templateVoice,
        voiceSettings: settings,
        language: caseLanguage,
    }), [voiceSettings, caseLanguage]);

    const handleSendToPatient = async (overrideText) => {
        const text = (overrideText ?? input).trim();
        if (!text) return;

        const userMsg = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);

        EventLogger.messageSent(text, COMPONENTS.CHAT_INTERFACE);

        setInput('');
        setLoading(true);

        const richSystemPrompt = buildPatientSystemPrompt();

        // Append an empty assistant message and grow it as tokens stream in
        // (typewriter effect for the chat bubble).
        let assistantIdx = -1;
        setMessages(prev => {
            assistantIdx = prev.length;
            return [...prev, { role: 'assistant', content: '' }];
        });

        // In voice mode, open a per-sentence speech session up-front so each
        // completed sentence can fire its own TTS request as soon as the
        // LLM finishes that sentence — not after the whole reply. This
        // collapses perceived latency from "full LLM duration" to
        // "first-sentence duration + first Kokoro chunk RTT".
        let speech = null;
        let voiceErrored = false;
        if (voiceMode) {
            // Patient voice precedence (Voice 2.0):
            //   1. activeCase.config.voice.case_voice  — per-case override.
            //   2. patientTemplate.config.voice        — Patient persona
            //      default ("all my patients sound like this").
            //   3. tts_default_voice_<language>        — the platform's
            //      language-matched safety net. Never crosses a language
            //      boundary; every use is announced (toast + wire headers).
            // Each voice plays on its OWN engine (derived from the id) —
            // there is no platform engine setting anymore.
            //
            // First-render race: settings may still be in flight on the
            // very first send — await the mount-time fetch promise instead
            // of misresolving against null settings.
            let settings = voiceSettings;
            if (!settings && voiceSettingsPromiseRef.current) {
                try { settings = await voiceSettingsPromiseRef.current; }
                catch { settings = null; /* loud path below, never a wrong voice */ }
            }
            const r = resolveSpeakerVoice(activeCase?.config?.voice, patientTemplate?.config?.voice, settings);
            if (!r.file) {
                // No playable voice AND no language default — mute with
                // truth. Two distinct stories (plan P2): a voice IS
                // configured but can't play here, vs nothing configured.
                console.warn('[voice] no voice resolved for case', {
                    requested: r.requestedFile, tier: r.tier, provider: r.provider
                });
                if (r.tier === 'invalid') {
                    toast?.error?.(t('voice_wrong_provider', {
                        voice: r.requestedFile, provider: r.provider || '?'
                    }));
                } else {
                    toast?.error?.(t('no_voice_configured_case'));
                }
                voiceErrored = true;
            } else {
                notifySubstitutionOnce(toast, t, r);
                // Language↔voice mismatch guard (i18n hassle of 2026-07:
                // an English Google/Kokoro voice reading a translated
                // session sounds broken but produced zero user-visible
                // signal — only the DiagnosticBar warned). Warn ONCE per
                // (voice, language) pair; never substitute a voice —
                // fallback chains stay dead by design (I18N_PLAN.md §5).
                const mismatchKey = `${r.file}|${caseLanguage}`;
                if (voiceMatchesLanguage(r.file, r.provider, caseLanguage) === false
                    && voiceLangWarnedRef.current !== mismatchKey) {
                    voiceLangWarnedRef.current = mismatchKey;
                    console.warn('[voice] voice does not speak the session language', {
                        voice: r.file, provider: r.provider, caseLanguage
                    });
                    toast?.warning?.(t('voice_language_mismatch', { voice: r.file, language: caseLanguage }));
                }
                speech = VoiceService.beginSpeechSession({
                    voice: r.file,
                    rate: r.rate,
                    pitch: r.pitch,
                    // Display/diagnostic only — the server derives the
                    // engine from the voice id itself (Voice 2.0).
                    provider: r.provider,
                    // Fallback-language tiebreak for multilingual voice ids
                    // — a de session must never fall back to an en default.
                    language: caseLanguage,
                    onStart: () => setSpeaking(true),
                    onVisemes: setVisemes,
                    onEnd: () => {
                        setSpeaking(false);
                        setVisemes({ viseme_sil: 1 });
                    },
                    onError: (err) => {
                        console.error('TTS error:', err);
                        voiceErrored = true;
                        setSpeaking(false);
                        ttsErrorToast(toast, err, t);
                    }
                });
            }
        }

        let acc = '';            // raw accumulator (for chat bubble + bubble-final)
        let speechBuffer = '';   // sentence detector buffer (TTS only)

        const responseText = await LLMService.streamMessage(
            sessionId,
            [...messages, userMsg],
            richSystemPrompt,
            voiceMode ? 'voice' : undefined,
            {
                agentTemplateId: patientTemplate?.templateId || null,
                // Server appends the output-language directive for this code
                // (systemPromptAssembly) — never inject it into the prompt here.
                caseLanguage,
                onDelta: (delta) => {
                    acc += delta;
                    const display = stripStageDirections(acc);
                    setMessages(prev => {
                        const copy = [...prev];
                        copy[assistantIdx] = { role: 'assistant', content: display };
                        return copy;
                    });

                    if (!speech || voiceErrored) return;
                    speechBuffer += delta;
                    const { sentences, remainder } = extractCompleteSentences(speechBuffer);
                    speechBuffer = remainder;
                    for (const s of sentences) {
                        const spoken = stripStageDirections(s).trim();
                        if (spoken) speech.enqueue(spoken);
                    }
                }
            }
        );

        // Make the bubble actually reflect what came back. Three paths:
        //   - Error: show the error text in red so the user sees it
        //   - Empty: tell the user nothing was returned (catches silent hangs)
        //   - Success but onDelta never fired (server returned JSON not SSE):
        //     overwrite the bubble with responseText so it's not stuck blank
        const isError = typeof responseText === 'string' && responseText.startsWith('Error:');
        const finalDisplay = isError
            ? responseText
            : (acc ? stripStageDirections(acc) : (responseText ? stripStageDirections(responseText) : t('no_response_from_llm')));
        setMessages(prev => {
            const copy = [...prev];
            if (assistantIdx >= 0 && copy[assistantIdx]?.role === 'assistant') {
                copy[assistantIdx] = { role: 'assistant', content: finalDisplay, error: isError || !responseText };
            }
            return copy;
        });

        EventLogger.messageReceived(responseText, COMPONENTS.CHAT_INTERFACE);
        obtained('history', text, responseText);
        setLoading(false);

        if (speech) {
            // Flush trailing partial sentence (e.g. an unterminated final clause)
            // and surface any error state to skip TTS for error responses.
            if (isError || !responseText) {
                speech.cancel();
            } else {
                const tail = stripStageDirections(speechBuffer).trim();
                if (tail) speech.enqueue(tail);
                speech.flush();
            }
        }
    };

    // Shared speak helper used by the agent send path (which doesn't expose an
    // LLM streaming hook today, so it stays single-shot). Goes through the
    // shared resolver so the engine the case was configured for is the engine
    // that plays.
    const speakResponse = (responseText, { override }) => {
        const r = resolveSpeakerVoice(override);
        const spokenText = stripStageDirections(responseText);
        if (!spokenText || responseText.startsWith('Error:')) return;
        if (!r.file) {
            console.warn('[voice] no voice resolved for agent', {
                requested: r.requestedFile, tier: r.tier, provider: r.provider
            });
            if (r.tier === 'invalid') {
                toast?.error?.(t('voice_wrong_provider', { voice: r.requestedFile, provider: r.provider || '?' }));
            } else {
                toast?.error?.(t('no_voice_configured_agent'));
            }
            return;
        }
        notifySubstitutionOnce(toast, t, r);
        VoiceService.speak({
            text: spokenText,
            voice: r.file,
            rate: r.rate,
            pitch: r.pitch,
            provider: r.provider,
            language: caseLanguage,
            onStart: () => setSpeaking(true),
            onVisemes: setVisemes,
            onEnd: () => {
                setSpeaking(false);
                setVisemes({ viseme_sil: 1 });
            },
            onError: (err) => {
                console.error('TTS error:', err);
                setSpeaking(false);
                ttsErrorToast(toast, err, t);
            }
        });
    };

    const speakPatientAlarm = useCallback(({ text }) => {
        if (!voiceMode || activeTab !== 'patient') return false;
        if (prefs.avatarAlarmSpeechEnabled === false || isAvatarAlarmSpeechForceOff()) return false;
        const r = resolveSpeakerVoice(activeCase?.config?.voice, patientTemplate?.config?.voice);
        const spokenText = stripStageDirections(text);
        if (!spokenText || !r.file) return false;

        notifySubstitutionOnce(toast, t, r);
        setMessages(prev => [...prev, { role: 'assistant', content: spokenText }]);
        EventLogger.messageReceived(spokenText, COMPONENTS.CHAT_INTERFACE);
        VoiceService.speak({
            text: spokenText,
            voice: r.file,
            rate: r.rate,
            pitch: r.pitch,
            provider: r.provider,
            language: caseLanguage,
            onStart: () => setSpeaking(true),
            onVisemes: setVisemes,
            onEnd: () => {
                setSpeaking(false);
                setVisemes({ viseme_sil: 1 });
            },
            onError: (err) => {
                console.error('TTS error:', err);
                setSpeaking(false);
                ttsErrorToast(toast, err, t);
            }
        });
        return true;
    }, [voiceMode, activeTab, prefs.avatarAlarmSpeechEnabled, activeCase?.config?.voice, patientTemplate?.config?.voice, resolveSpeakerVoice, toast, t, setSpeaking, setVisemes]);

    useEffect(() => {
        return subscribe((event) => {
            if (event?.type !== 'notify') return;
            const notification = event.notification;
            const text = alarmSpeechLine(notification);
            if (!text || !voiceMode || activeTab !== 'patient') return;
            if (prefs.avatarAlarmSpeechEnabled === false || isAvatarAlarmSpeechForceOff()) return;

            const now = Date.now();
            const nextRank = ALARM_SEVERITY_RANK[notification.severity] || 0;
            const last = alarmSpeechCooldownRef.current.get(notification.key);
            if (last && now - last.at < ALARM_SPEECH_COOLDOWN_MS && nextRank <= last.rank) {
                return;
            }
            alarmSpeechCooldownRef.current.set(notification.key, { at: now, rank: nextRank });

            const alarmSpeech = { key: notification.key, severity: notification.severity, text };
            const busy = loading || listening || speaking || VoiceService.isSpeaking();
            if (busy) {
                if (notification.severity === SEVERITY.CRITICAL) {
                    pendingAlarmSpeechRef.current = alarmSpeech;
                }
                return;
            }
            speakPatientAlarm(alarmSpeech);
        });
    }, [subscribe, voiceMode, activeTab, prefs.avatarAlarmSpeechEnabled, loading, listening, speaking, speakPatientAlarm]);

    useEffect(() => {
        if (!voiceMode || activeTab !== 'patient') return;
        if (prefs.avatarAlarmSpeechEnabled === false || isAvatarAlarmSpeechForceOff()) {
            pendingAlarmSpeechRef.current = null;
            return;
        }
        if (loading || listening || speaking || VoiceService.isSpeaking()) return;
        const pending = pendingAlarmSpeechRef.current;
        if (!pending) return;
        pendingAlarmSpeechRef.current = null;
        speakPatientAlarm(pending);
    }, [voiceMode, activeTab, prefs.avatarAlarmSpeechEnabled, loading, listening, speaking, speakPatientAlarm]);

    // Drives the subtitle reveal gate. When TTS starts, hold the caption
    // back for ~30% of the estimated audio length so the trainee hears the
    // first beat of voice before the line shows up on screen. When TTS ends,
    // hide it immediately. We read the latest assistant message
    // synchronously inside the effect (no deps on currentMessages) so a
    // mid-utterance message append doesn't restart the lag timer.
    useEffect(() => {
        if (!speaking) {
            setSubtitleReady(false);
            return undefined;
        }
        const latest = currentMessages[currentMessages.length - 1];
        const text = latest?.role === 'assistant' ? (latest.content || '') : '';
        const estimatedMs = Math.max(1000, (text.length / 15) * 1000);
        const lagMs = Math.min(estimatedMs * 0.30, 4000);
        const t = setTimeout(() => setSubtitleReady(true), lagMs);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speaking]);

    const startVoiceTurn = () => {
        if (!VoiceService.isSttSupported()) {
            toast?.error?.(t('stt_not_supported_browser'));
            return;
        }
        // Session language wins over the platform-wide STT locale: a student
        // in an Italian session speaks Italian into the mic regardless of the
        // platform default. English sessions keep the platform setting, so
        // English-only deployments see zero behaviour change.
        const sttLang = caseLanguage !== DEFAULT_LANGUAGE
            ? sttLocaleFor(caseLanguage)
            : voiceSettings?.stt_language;
        if (!sttLang) {
            toast?.error?.(t('no_stt_language'));
            return;
        }
        if (listening) {
            VoiceService.stopListening();
            return;
        }
        // Stop any in-flight playback so the patient stops talking when we start.
        VoiceService.cancelSpeech();
        setSpeaking(false);
        setVisemes({ viseme_sil: 1 });
        setListening(true);

        let sawError = false;

        VoiceService.startListening({
            lang: sttLang,
            onResult: ({ final, interim, _isFinal }) => {
                // Continuous mode (default in voiceService): show whatever's
                // currently transcribed but DO NOT stop on isFinal — pauses
                // mid-sentence shouldn't kill the mic. The user explicitly
                // taps the button again to end and send.
                setInput(interim || final);
            },
            onError: (err) => {
                // Make the silent-immediate-return symptom debuggable. The
                // browser fires deterministic error codes ('not-allowed',
                // 'service-not-allowed', 'network', 'audio-capture',
                // 'no-speech', 'aborted') — surface them verbatim so the
                // admin can tell HTTP-origin vs. mic-permission vs. firewall.
                sawError = true;
                console.warn('STT error:', err.message);
                const code = err?.message || 'unknown';
                if (code === 'not-allowed' || code === 'service-not-allowed') {
                    toast?.error?.(t('mic_blocked'));
                } else if (code === 'network') {
                    toast?.error?.(t('stt_network_error'));
                } else if (code === 'audio-capture') {
                    toast?.error?.(t('no_microphone'));
                } else if (code === 'no-speech') {
                    toast?.error?.(t('no_speech_heard'));
                } else if (code === 'aborted') {
                    // Self-aborted (we called stopListening); not a user-facing error.
                } else {
                    toast?.error?.(t('stt_error', { code }));
                }
                setListening(false);
            },
            onEnd: ({ final }) => {
                setListening(false);
                if (final) {
                    handleSendToPatient(final);
                } else if (!sawError) {
                    // Recogniser ended without ever hearing speech and without
                    // emitting a code — typical of "started, immediately ended"
                    // on an insecure origin where Chrome silently refuses.
                    toast?.error?.(t('listening_ended_no_speech'));
                }
            }
        });
    };

    const handleSendToAgent = async (agentType) => {
        const agent = agents.find(a => a.agent_type === agentType);
        if (!agent) return;

        const userMsg = { role: 'user', content: input };
        const currentConversation = agentConversations[agentType] || [];

        // Use functional update to properly add user message
        setAgentConversations(prev => ({
            ...prev,
            [agentType]: [...(prev[agentType] || []), userMsg]
        }));

        setInput('');
        setLoading(true);

        try {
            const responseText = await AgentService.sendAgentMessage(
                sessionId,
                agent,
                input,
                patientRecord.record,
                teamLog,
                currentVitals,
                currentConversation,
                caseSnapshot || activeCase,
                { caseLanguage }
            );

            // Use functional update with fallback to empty array
            setAgentConversations(prev => ({
                ...prev,
                [agentType]: [...(prev[agentType] || []), { role: 'assistant', content: responseText }]
            }));

            // Reload team log after agent response
            const updatedLog = await AgentService.getTeamCommunications(sessionId);
            setTeamLog(updatedLog);

            // Voice playback — agents speak with their own per-agent override
            // (config.voice) on top of global. Visemes flow into the active
            // participant avatar (which is this agent because the trainee is
            // on their tab).
            if (voiceMode) {
                const cfg = parseConfig(agent.config);
                speakResponse(responseText, { override: cfg.voice });
            }
        } catch (err) {
            console.error('Failed to send message to agent:', err);
            // Use functional update with fallback to empty array
            setAgentConversations(prev => ({
                ...prev,
                [agentType]: [...(prev[agentType] || []), { role: 'assistant', content: t('agent_response_error') }]
            }));
        }

        setLoading(false);
    };

    if (!activeCase) {
        return (
            <div className="flex items-center justify-center h-full text-neutral-500 bg-neutral-900 border-t border-neutral-800">
                <div className="text-center">
                    <p>{t('no_case_selected')}</p>
                    <p className="text-xs">{t('load_case_from_settings')}</p>
                </div>
            </div>
        );
    }

    // Get patient info from case config. Never fall back to activeCase.name
    // for students — that is the diagnosis (Bug 14). caseDisplayLabel applies
    // the role rule and still returns the real title for educators+.
    const patientName = caseDisplayLabel(activeCase, user);
    const patientAvatar = activeCase?.config?.patient_avatar || '';

    // Get current conversation based on active tab
    const currentMessages = activeTab === 'patient' ? messages : (agentConversations[activeTab] || []);
    const currentAgent = agents.find(a => a.agent_type === activeTab);
    const agentStatus = currentAgent ? getAgentDisplayStatus(currentAgent) : null;

    // Render tab button
    const renderTab = (key, label, icon, status = null) => {
        const isActive = activeTab === key;
        return (
            <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                    isActive
                        ? 'bg-neutral-900 text-white border-t border-l border-r border-neutral-700'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800/80'
                }`}
            >
                {icon}
                <span>{label}</span>
                {status && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        status === 'present' ? 'bg-green-900/50 text-green-400' :
                        status === 'paged' ? 'bg-amber-900/50 text-amber-400' :
                        status === 'on-call' ? 'bg-blue-900/50 text-blue-400' :
                        'bg-neutral-700 text-neutral-500'
                    }`}>
                        {t(AGENT_STATUS_KEYS[status] || 'status_away')}
                    </span>
                )}
            </button>
        );
    };

    // Get icon for agent type
    const getAgentIcon = (type) => {
        switch (type) {
            case 'nurse': return <Users className="w-4 h-4 text-blue-400" />;
            case 'consultant': return <Stethoscope className="w-4 h-4 text-green-400" />;
            case 'relative': return <UserIcon className="w-4 h-4 text-amber-400" />;
            default: return <Bot className="w-4 h-4 text-purple-400" />;
        }
    };

    const voiceModeAvailable = !!voiceSettings?.voice_mode_enabled;
    const sttSupported = VoiceService.isSttSupported();

    return (
        <div className="flex flex-col h-full bg-neutral-900 text-white font-sans border-t border-neutral-800">
            {/* Tab Bar */}
            <div className="flex items-end gap-1 px-2 pt-2 bg-neutral-950 border-b border-neutral-800">
                {renderTab('patient', patientName, <Bot className="w-4 h-4 text-emerald-400" />)}
                {/* Bug 10 (16.5.2026): patient already has its own tab
                    above — visibleAgentTabs() drops agent_type==='patient'
                    so the seeded "Default Patient" isn't a duplicate tab. */}
                {visibleAgentTabs(agents).map(agent => {
                    const status = agentStates[agent.agent_type]?.status || agent.status || 'absent';
                    return renderTab(
                        agent.agent_type,
                        agent.name,
                        getAgentIcon(agent.agent_type),
                        status
                    );
                })}
                {voiceModeAvailable && (
                    <div className="ml-auto mb-1 flex items-center gap-1.5">
                        {voiceMode && (
                            <button
                                onClick={() => setShowTranscript(s => !s)}
                                title={showTranscript ? t('hide_transcript_title') : t('show_transcript_title')}
                                className="px-2.5 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                            >
                                {showTranscript
                                    ? <><EyeOff className="w-3.5 h-3.5" /> {t('hide')}</>
                                    : <><Eye className="w-3.5 h-3.5" /> {t('show')}</>}
                            </button>
                        )}
                        <button
                            onClick={() => {
                                const next = !voiceMode;
                                setVoiceMode(next);
                                if (next) {
                                    // Voice mode → curtain the transcript by default
                                    setShowTranscript(false);
                                } else {
                                    VoiceService.cancelSpeech();
                                    VoiceService.stopListening();
                                    setSpeaking(false);
                                    setListening(false);
                                    // Back to text mode → always show messages
                                    setShowTranscript(true);
                                }
                            }}
                            title={voiceMode ? t('switch_to_text_mode') : t('switch_to_voice_mode')}
                            className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition-colors ${
                                voiceMode
                                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                            }`}
                        >
                            {voiceMode ? <Volume2 className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                            {voiceMode ? t('voice_on') : t('voice')}
                        </button>
                    </div>
                )}
            </div>

            {/* Agent Status Bar (when on agent tab) */}
            {activeTab !== 'patient' && currentAgent && agentStatus && (() => {
                const liveState = agentStates[currentAgent.agent_type] || {};
                const arrivesAt = liveState.arrives_at;
                const pagedAt = liveState.paged_at;
                const isPaged = agentStatus.status === 'paged';
                const remaining = isPaged ? formatRemaining(arrivesAt, nowTick) : '';
                const progress = isPaged ? waitProgressPct(pagedAt, arrivesAt, nowTick) : 0;
                const phase = isPaged ? t(pickWaitPhase(currentAgent.agent_type, pagedAt, arrivesAt, nowTick)) : '';
                return (
                    <div className={`border-b ${
                        agentStatus.status === 'present' ? 'bg-green-900/20 border-green-800/50' :
                        isPaged ? 'bg-amber-900/20 border-amber-800/50' :
                        agentStatus.status === 'on-call' ? 'bg-blue-900/20 border-blue-800/50' :
                        'bg-neutral-800/50 border-neutral-700'
                    }`}>
                        <div className="px-4 py-2 flex items-center justify-between text-sm gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                {getAgentIcon(currentAgent.agent_type)}
                                <span className="font-medium truncate">{currentAgent.name}</span>
                                <span className="text-neutral-500 truncate">• {currentAgent.role_title}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                {isPaged && (
                                    <span className="hidden sm:inline text-amber-200/80 italic truncate max-w-[14rem]">
                                        {phase}
                                    </span>
                                )}
                                {isPaged && (
                                    <span className="flex items-center gap-1.5 text-amber-300 font-semibold tabular-nums">
                                        <Clock className="w-3.5 h-3.5 animate-pulse" />
                                        {remaining || '0:00'}
                                    </span>
                                )}
                                {agentStatus.canPage && (
                                    <button
                                        onClick={() => handlePageAgent(currentAgent.agent_type)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-bold shadow-sm"
                                    >
                                        <Phone className="w-3.5 h-3.5" /> {t('call_agent', { name: currentAgent.name.split(' ')[0] })}
                                    </button>
                                )}
                                {agentStatus.status === 'present' && (
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 text-xs font-semibold">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> {t('in_the_room')}
                                    </span>
                                )}
                                {!agentStatus.canChat && !isPaged && !agentStatus.canPage && (
                                    <span className="text-neutral-500">{t(agentStatus.labelKey, agentStatus.labelParams)}</span>
                                )}
                            </div>
                        </div>
                        {isPaged && (
                            <div className="h-1 bg-amber-950/40">
                                <div
                                    className="h-full bg-amber-400/80 transition-[width] duration-1000 ease-linear"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Chat Messages — curtained in voice mode for immersion. The
                transcript still streams in the background; the curtain just
                hides the visual stream so the user focuses on the voice and
                avatar. Click the curtain to peek; toggle in the header to
                pin it open or shut. */}
            <div className="flex-1 relative overflow-hidden">
                <div className={`absolute inset-0 overflow-y-auto p-4 space-y-4 transition-opacity ${
                    voiceMode && !showTranscript ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}>
                {/* Empty state hint */}
                {currentMessages.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6">
                        <div className="w-16 h-16 rounded-full bg-neutral-800 flex items-center justify-center border border-neutral-700 mb-4">
                            {activeTab === 'patient' ? (
                                <Bot className="w-8 h-8 text-emerald-400" />
                            ) : (
                                getAgentIcon(activeTab)
                            )}
                        </div>
                        {activeTab === 'patient' ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{t('start_conversation_with_patient')}</p>
                                <p className="text-neutral-600 text-xs">{t('type_message_to_begin_history')}</p>
                            </>
                        ) : agentStatus?.status === 'paged' ? (() => {
                            const liveState = agentStates[currentAgent.agent_type] || {};
                            return (
                                <div className="w-full max-w-sm">
                                    <p className="text-amber-200 text-sm font-medium mb-1">
                                        {t('calling_agent', { name: currentAgent?.name })}
                                    </p>
                                    <p className="text-neutral-400 text-xs italic mb-4">
                                        {t(pickWaitPhase(currentAgent.agent_type, liveState.paged_at, liveState.arrives_at, nowTick))}
                                    </p>
                                    <div className="text-3xl font-bold tabular-nums text-amber-300 mb-3">
                                        {formatRemaining(liveState.arrives_at, nowTick) || '0:00'}
                                    </div>
                                    <div className="h-1.5 bg-amber-950/40 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-amber-400/80 transition-[width] duration-1000 ease-linear"
                                            style={{ width: `${waitProgressPct(liveState.paged_at, liveState.arrives_at, nowTick)}%` }}
                                        />
                                    </div>
                                    <p className="text-neutral-600 text-[11px] mt-3">
                                        {t('keep_working_agent_arrives')}
                                    </p>
                                </div>
                            );
                        })() : agentStatus?.canChat ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{t('chat_with_agent', { name: currentAgent?.name })}</p>
                                <p className="text-neutral-600 text-xs">{t('type_message_to_agent', { role: currentAgent?.role_title?.toLowerCase() })}</p>
                            </>
                        ) : agentStatus?.canPage ? (
                            <div className="w-full max-w-sm">
                                <p className="text-neutral-300 text-sm font-medium mb-1">{currentAgent?.name}</p>
                                <p className="text-neutral-500 text-xs mb-1">{currentAgent?.role_title}</p>
                                <p className="text-blue-300/80 text-xs mb-4">{t('on_call_responds')}</p>
                                <button
                                    onClick={() => handlePageAgent(currentAgent.agent_type)}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-bold shadow-md"
                                >
                                    <Phone className="w-4 h-4" /> {t('call_agent', { name: currentAgent.name.split(' ')[0] })}
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{t('agent_not_available', { name: currentAgent?.name })}</p>
                                <p className="text-neutral-600 text-xs">{agentStatus?.labelKey ? t(agentStatus.labelKey, agentStatus.labelParams) : agentStatus?.label}</p>
                            </>
                        )}
                    </div>
                )}

                {currentMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {/* Assistant avatar and name */}
                        {msg.role === 'assistant' && (
                            <div className="flex flex-col items-center gap-1 shrink-0">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center border overflow-hidden ${
                                    activeTab === 'patient'
                                        ? 'bg-neutral-800 border-neutral-700'
                                        : currentAgent?.agent_type === 'nurse' ? 'bg-blue-900/30 border-blue-700'
                                        : currentAgent?.agent_type === 'consultant' ? 'bg-green-900/30 border-green-700'
                                        : currentAgent?.agent_type === 'relative' ? 'bg-amber-900/30 border-amber-700'
                                        : 'bg-purple-900/30 border-purple-700'
                                }`}>
                                    {activeTab === 'patient' ? (
                                        patientAvatar ? (
                                            <img src={baseUrl(patientAvatar)} alt={patientName} className="w-full h-full object-cover" />
                                        ) : (
                                            <Bot className="w-5 h-5 text-emerald-400" />
                                        )
                                    ) : (
                                        getAgentIcon(currentAgent?.agent_type)
                                    )}
                                </div>
                                <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">
                                    {activeTab === 'patient' ? t('patient_label') : currentAgent?.name?.split(' ')[0]}
                                </span>
                            </div>
                        )}

                        <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : msg.error
                            ? 'bg-red-950/40 text-red-200 border border-red-800/60 rounded-bl-none'
                            : activeTab === 'patient'
                            ? 'bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-bl-none'
                            : currentAgent?.agent_type === 'nurse' ? 'bg-blue-900/20 text-blue-100 border border-blue-800/50 rounded-bl-none'
                            : currentAgent?.agent_type === 'consultant' ? 'bg-green-900/20 text-green-100 border border-green-800/50 rounded-bl-none'
                            : currentAgent?.agent_type === 'relative' ? 'bg-amber-900/20 text-amber-100 border border-amber-800/50 rounded-bl-none'
                            : 'bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-bl-none'
                            }`}>
                            {msg.content}
                        </div>

                        {/* Doctor (user) avatar and name */}
                        {msg.role === 'user' && (
                            <div className="flex flex-col items-center gap-1 shrink-0">
                                <div className="w-9 h-9 rounded-full bg-blue-900/30 flex items-center justify-center border border-blue-700 overflow-hidden">
                                    {chatSettings.doctorAvatar ? (
                                        <img src={chatSettings.doctorAvatar} alt={chatSettings.doctorName} className="w-full h-full object-cover" />
                                    ) : (
                                        <Stethoscope className="w-5 h-5 text-blue-400" />
                                    )}
                                </div>
                                <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">{chatSettings.doctorName}</span>
                            </div>
                        )}
                    </div>
                ))}

                {loading && (
                    <div className="flex gap-3 justify-start">
                        <div className="flex flex-col items-center gap-1 shrink-0">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center border overflow-hidden ${
                                activeTab === 'patient'
                                    ? 'bg-neutral-800 border-neutral-700'
                                    : 'bg-neutral-800 border-neutral-700'
                            }`}>
                                <Loader2 className={`w-5 h-5 animate-spin ${
                                    activeTab === 'patient' ? 'text-emerald-400' :
                                    currentAgent?.agent_type === 'nurse' ? 'text-blue-400' :
                                    currentAgent?.agent_type === 'consultant' ? 'text-green-400' :
                                    currentAgent?.agent_type === 'relative' ? 'text-amber-400' :
                                    'text-purple-400'
                                }`} />
                            </div>
                            <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">
                                {activeTab === 'patient' ? t('patient_label') : currentAgent?.name?.split(' ')[0]}
                            </span>
                        </div>
                        <div className="bg-neutral-800 px-4 py-2.5 rounded-2xl rounded-bl-none border border-neutral-700 text-neutral-400 text-sm flex items-center gap-2">
                            <span className="inline-flex gap-1">
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
                </div>

                {/* Subtitle layer — caption + localized radial haze.
                    Captures BOTH speakers:
                      - User STT: while `listening`, show the live interim
                        transcript (no lag — natural to see your own words
                        form as you say them).
                      - Agent TTS: while `speaking` AND the 30% reveal gate
                        has fired, show the latest assistant line.
                    Visual treatment: NOT a full-viewport scrim. Instead a
                    feathered ellipse of `bg-black/30` is masked behind the
                    caption with `radial-gradient` so it dims the area
                    immediately around the text and fades out toward the
                    edges of the screen. Pixel-anchored under the RESP
                    waveform (see top:29rem below). The whole layer is a
                    single button → click anywhere on the haze to bring the
                    transcript back. No speaker label — the caption is the
                    only content. */}
                {voiceMode && !showTranscript && activeTab === 'patient' && (() => {
                    let line = null;
                    if (listening && input) {
                        line = input;
                    } else if (speaking && subtitleReady) {
                        const latest = currentMessages[currentMessages.length - 1] || null;
                        if (latest?.role === 'assistant' && latest.content) {
                            line = latest.content;
                        }
                    }
                    if (!line) return null;
                    // Haze: a feathered ellipse of dim+blur sitting only
                    // behind the caption, fading to fully transparent at the
                    // edges — never a full-screen scrim. Mask-image is the
                    // mechanism: it controls where the dim/blur layer is
                    // visible, with a soft radial falloff.
                    const hazeMask = 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 90%)';
                    return (
                        <button
                            type="button"
                            onClick={() => setShowTranscript(true)}
                            aria-label={t('show_full_transcript')}
                            // Anchored pixel-wise to the bottom edge of the
                            // resp waveform: PatientMonitor.jsx stacks three
                            // 128px canvases (ECG / PLETH / RESP) below a
                            // ~64px header, so the resp line ends at ~448px.
                            // Base anchor 29rem (464px) + 1cm breathing gap
                            // per user feedback so the caption sits clearly
                            // below the waveform rather than abutting it.
                            // Pixel anchor (not vh) so the position stays
                            // glued to the waveform stack regardless of
                            // viewport height. No speaker label per prior
                            // user request.
                            // pointer-events-none on the full-width strip so it
                            // never swallows taps meant for the controls behind
                            // it (Bug 17); only the visible caption block below
                            // re-enables pointer events to stay dismissable.
                            className="fixed inset-x-0 z-40 flex justify-center items-center px-6 py-8 text-center group pointer-events-none"
                            style={{ top: 'calc(29rem + 1cm)', background: 'transparent' }}
                        >
                            <div
                                aria-hidden
                                className="absolute inset-0 backdrop-blur-sm"
                                style={{
                                    backgroundColor: 'rgba(0,0,0,0.30)',
                                    WebkitMaskImage: hazeMask,
                                    maskImage: hazeMask,
                                }}
                            />
                            <div
                                className="relative max-w-2xl pointer-events-auto cursor-pointer"
                                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.75)' }}
                            >
                                <p className="text-xl md:text-2xl font-medium text-white leading-snug whitespace-pre-wrap break-words">
                                    {line}
                                </p>
                            </div>
                        </button>
                    );
                })()}
            </div>

            {/* Recurring Emotion Questionnaire — appears every 2 minutes */}
            {showQuestionnaire && (
                <div className="px-4 pt-3 pb-2 border-t border-indigo-800/60 bg-indigo-950/40">
                    <p className="text-[11px] font-semibold text-indigo-300 text-center mb-2 tracking-wide">
                        {t('how_are_you_feeling')}
                    </p>
                    <div className="flex flex-col gap-1">
                        {[EMOTIONS_ROW1, EMOTIONS_ROW2].map((row, rowIdx) => (
                            <div key={rowIdx} className="flex gap-1">
                                {row.map((emotion) => {
                                    const isPositive = rowIdx === 0;
                                    return (
                                        <button
                                            key={emotion}
                                            type="button"
                                            onClick={() => handleEmotionClick(emotion)}
                                            className={`flex-1 text-[10px] font-medium px-1 py-1 rounded transition-colors truncate border ${
                                                isPositive
                                                    ? 'bg-neutral-800 text-blue-300 hover:bg-blue-900/50 hover:text-blue-100 border-neutral-700 hover:border-blue-600'
                                                    : 'bg-neutral-800 text-orange-300 hover:bg-orange-900/50 hover:text-orange-100 border-neutral-700 hover:border-orange-600'
                                            }`}
                                        >
                                            {t(EMOTION_KEYS[emotion])}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Input */}
            <div className="px-4 pb-4 pt-1 bg-neutral-900/90">
                {voiceMode && activeTab === 'patient' ? (
                    <div className="flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={startVoiceTurn}
                            disabled={loading || !sttSupported || speaking}
                            className={`w-full py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                                listening
                                    ? 'bg-green-600 hover:bg-green-500 text-white'
                                    : speaking
                                    ? 'bg-blue-700 text-white cursor-not-allowed'
                                    : 'bg-purple-600 hover:bg-purple-500 text-white disabled:bg-neutral-700 disabled:text-neutral-500'
                            }`}
                        >
                            {listening ? (
                                <>
                                    <Mic className="w-4 h-4 animate-pulse" />
                                    {t('listening_click_to_stop')}
                                </>
                            ) : speaking ? (
                                <>
                                    <Volume2 className="w-4 h-4 animate-pulse" />
                                    {t('patient_speaking')}
                                </>
                            ) : !sttSupported ? (
                                <>
                                    <MicOff className="w-4 h-4" />
                                    {t('stt_not_supported_short')}
                                </>
                            ) : loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('thinking')}
                                </>
                            ) : (
                                <>
                                    <Mic className="w-4 h-4" />
                                    {t('click_to_talk', { name: patientName })}
                                </>
                            )}
                        </button>
                        {input && (
                            <div className="text-xs text-neutral-500 px-1 italic truncate">{input}</div>
                        )}
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="relative">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading || (activeTab !== 'patient' && !agentStatus?.canChat)}
                            placeholder={
                                loading ? t('waiting_for_response') :
                                activeTab !== 'patient' && !agentStatus?.canChat ? t('agent_not_available', { name: currentAgent?.name }) :
                                t('message_placeholder', { name: activeTab === 'patient' ? patientName : currentAgent?.name })
                            }
                            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600 disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={loading || !input.trim() || (activeTab !== 'patient' && !agentStatus?.canChat)}
                            className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-md hover:bg-blue-500 transition-colors text-white disabled:bg-neutral-700 disabled:text-neutral-500"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

// Normalise either a per-case attached agent row (from /cases/:id/agents) or
// a raw template row (from /agents/templates) into a uniform shape. Per-case
// rows carry name_override / system_prompt_override / config_override which
// take precedence; raw templates supply the underlying defaults.
function normalizePatientAgent(raw, caseId = null) {
    if (!raw) return null;
    const config = parseConfigSafe(raw.config) || parseConfigSafe(raw.config_override) || {};
    return {
        templateId: raw.agent_template_id || raw.id,
        name: raw.name_override || raw.name || 'Patient',
        roleTitle: raw.role_title || 'Simulated Patient',
        avatarUrl: raw.avatar_url || null,
        systemPrompt: raw.system_prompt_override || raw.system_prompt || '',
        contextFilter: raw.context_filter_override || raw.context_filter || 'history',
        config,
        // Stamp the case this template was resolved for. The agents loader
        // is gated on `sessionId && activeCase`, so during a case switch
        // there is a window where sessionId is briefly null and the loader
        // is suspended; without this stamp, patientTemplate retains case
        // A's value while activeCase is already B and buildPatientSystemPrompt
        // happily glues B's persona to A's template prose. See the
        // _caseId guard in buildPatientSystemPrompt for the consumer side.
        _caseId: caseId,
    };
}

function parseConfigSafe(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
}
