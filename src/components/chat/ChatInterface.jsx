import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, User as UserIcon, Loader2, Stethoscope, Phone, Clock, Users, MessageCircle, X, Mic, MicOff, Volume2, Eye, EyeOff } from 'lucide-react';
import { LLMService } from '../../services/llmService';
import { AgentService } from '../../services/AgentService';
import { useAuth } from '../../contexts/AuthContext';
import { AuthService } from '../../services/authService';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { apiUrl, baseUrl } from '../../config/api';
import { usePatientRecord } from '../../services/PatientRecord';
import { VoiceService } from '../../services/voiceService';
import { useVoice } from '../../contexts/VoiceContext';
import { stripStageDirections } from '../../utils/stageDirections';
import { parseConfig } from '../../utils/parseConfig';
import { extractCompleteSentences } from '../../utils/sentenceSplit';
import { PROVIDER_FALLBACK_VOICE } from '../../utils/voiceFallbacks';
import { useToast } from '../../contexts/ToastContext';

// Lazy-loaded so the ~270 KB gzipped Three.js / drei / r3f bundle is fetched
// only when a user actually toggles voice mode on for the first time.

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
// the raw message so we never silently swallow problems.
function ttsErrorToast(toast, err) {
    if (!toast?.error) return;
    const msg = err?.message || 'TTS failed';
    if (/unknown.*voice|not in catalog/i.test(msg)) {
        toast.error('Voice not valid for this engine. Set a default in admin → Avatars & voices.');
    } else if (/api.?key|API_KEY/i.test(msg)) {
        toast.error('Cloud TTS is missing an API key. Set it in admin → Voice & Avatar.');
    } else {
        toast.error(`Voice playback failed: ${msg}`);
    }
}

const EMOTIONS_ROW1 = ['Inspired', 'Alert', 'Excited', 'Enthusiastic', 'Determined'];
const EMOTIONS_ROW2 = ['Afraid', 'Upset', 'Nervous', 'Scared', 'Distressed'];

export default function ChatInterface({ activeCase, onSessionStart, restoredSessionId, sessionStartTime, currentVitals }) {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [messagesLoaded, setMessagesLoaded] = useState(false);
    const messagesEndRef = useRef(null);
    const { user } = useAuth();
    const toast = useToast();

    // Voice-mode transcript curtain. The transcript is the textual log of
    // what was said. Showing it during a real patient interaction feels
    // unnatural — you don't see captions in real life. So in voice mode we
    // hide it by default behind a clickable curtain; users can reveal it
    // explicitly when they want to review what was said.
    const [showTranscript, setShowTranscript] = useState(true);

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
        platformAvatars, setPlatformAvatars,
        setActiveParticipant
    } = useVoice();

    // Raw global voice settings live separately so per-case overrides can be
    // re-merged on top whenever the active case changes.
    const [globalVoiceSettings, setGlobalVoiceSettings] = useState(null);

    // Multi-agent state
    const [activeTab, setActiveTab] = useState('patient'); // 'patient' or agent_type
    const [agents, setAgents] = useState([]);
    const [agentConversations, setAgentConversations] = useState({}); // { agent_type: [...messages] }
    const [agentStates, setAgentStates] = useState({}); // { agent_type: { status, paged_at, ... } }
    const [pagingTimers, setPagingTimers] = useState({}); // { agent_type: timeoutId }
    const [teamLog, setTeamLog] = useState([]);

    // Load chat settings (doctor name/avatar)
    useEffect(() => {
        const loadChatSettings = async () => {
            try {
                const token = AuthService.getToken();
                const res = await fetch(apiUrl('/platform-settings/chat'), {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setChatSettings(data);
                }
            } catch (err) {
                console.error('Failed to load chat settings:', err);
            }
        };
        loadChatSettings();
    }, []);

    // Load voice settings + avatar manifest + platform default avatars in parallel.
    useEffect(() => {
        const token = AuthService.getToken();
        let cancelled = false;
        (async () => {
            try {
                const [voiceRes, manifestRes, avatarsRes] = await Promise.allSettled([
                    fetch(apiUrl('/platform-settings/voice'),   { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch(baseUrl('/avatars/heads/manifest.json')),
                    fetch(apiUrl('/platform-settings/avatars'), { headers: { 'Authorization': `Bearer ${token}` } })
                ]);
                if (cancelled) return;
                if (voiceRes.status === 'fulfilled' && voiceRes.value.ok) {
                    setGlobalVoiceSettings(await voiceRes.value.json());
                }
                if (manifestRes.status === 'fulfilled' && manifestRes.value.ok) {
                    setHeadManifest(await manifestRes.value.json());
                }
                if (avatarsRes.status === 'fulfilled' && avatarsRes.value.ok) {
                    setPlatformAvatars(await avatarsRes.value.json());
                }
            } catch (err) {
                console.warn('Voice/avatar config load failed:', err);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Merge per-case voice override (caseData.config.voice) on top of the
    // global blob. Empty / undefined per-case fields inherit from global.
    // Pushed into VoiceContext so consumers (this component, downstream) all
    // see the effective settings.
    useEffect(() => {
        if (!globalVoiceSettings) return;
        const override = activeCase?.config?.voice;
        if (override && typeof override === 'object') {
            const merged = { ...globalVoiceSettings };
            for (const [k, v] of Object.entries(override)) {
                if (v !== undefined && v !== null && v !== '') merged[k] = v;
            }
            setVoiceSettings(merged);
        } else {
            setVoiceSettings(globalVoiceSettings);
        }
    }, [globalVoiceSettings, activeCase?.id, setVoiceSettings]);

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
        if (!sessionId || !activeCase) return;

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
                        arrived_at: a.arrived_at
                    };
                });
                setAgentStates(states);

                // Load team communications
                const log = await AgentService.getTeamCommunications(sessionId);
                setTeamLog(log);
            } catch (err) {
                console.error('Failed to load agents:', err);
            }
        };

        loadAgents();
    }, [sessionId, activeCase?.id]);

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

    // Handle paging an agent
    const handlePageAgent = async (agentType) => {
        const agent = agents.find(a => a.agent_type === agentType);
        if (!agent) return;

        try {
            await AgentService.pageAgent(sessionId, agentType);

            // Update local state
            setAgentStates(prev => ({
                ...prev,
                [agentType]: { ...(prev[agentType] || {}), status: 'paged', paged_at: new Date().toISOString() }
            }));

            // Calculate wait time and set timer for arrival
            const waitTime = AgentService.calculateWaitTime(agent);
            const timerId = setTimeout(async () => {
                await AgentService.arriveAgent(sessionId, agentType);
                setAgentStates(prev => ({
                    ...prev,
                    [agentType]: { ...(prev[agentType] || {}), status: 'present', arrived_at: new Date().toISOString() }
                }));
                setPagingTimers(prev => {
                    const newTimers = { ...prev };
                    delete newTimers[agentType];
                    return newTimers;
                });
            }, waitTime * 60 * 1000); // Convert minutes to ms

            setPagingTimers(prev => ({ ...prev, [agentType]: timerId }));
        } catch (err) {
            console.error('Failed to page agent:', err);
        }
    };

    // Load chat history from database or localStorage
    useEffect(() => {
        const loadChatHistory = async () => {
            if (!activeCase) return;

            // Try localStorage first (faster)
            try {
                const savedChat = localStorage.getItem('rohy_chat_history');
                if (savedChat) {
                    const parsed = JSON.parse(savedChat);
                    if (parsed.caseId === activeCase.id && parsed.messages?.length > 0) {
                        console.log('Restored chat from localStorage:', parsed.messages.length, 'messages');
                        setMessages(parsed.messages);
                        setMessagesLoaded(true);
                        return;
                    }
                }
            } catch (e) {
                console.warn('Failed to parse localStorage chat:', e);
            }

            // If restoring a session, fetch from database
            if (restoredSessionId) {
                try {
                    const token = AuthService.getToken();
                    const res = await fetch(apiUrl(`/interactions/${restoredSessionId}`), {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.interactions?.length > 0) {
                            const chatMessages = data.interactions.map(i => ({
                                role: i.role,
                                content: i.content
                            }));
                            console.log('Restored chat from database:', chatMessages.length, 'messages');
                            setMessages(chatMessages);
                            // Also save to localStorage for faster next load
                            localStorage.setItem('rohy_chat_history', JSON.stringify({
                                caseId: activeCase.id,
                                messages: chatMessages,
                                timestamp: Date.now()
                            }));
                        }
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
                messages,
                timestamp: Date.now()
            }));
        }
    }, [messages, activeCase, messagesLoaded]);

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
    const buildPatientSystemPrompt = () => {
        const config = activeCase.config || {};
        const demo = config.demographics || {};

        let richSystemPrompt = `## PERSONA\n`;
        richSystemPrompt += `Role: ${config.persona_type || 'Patient'}\n`;
        richSystemPrompt += `Name: ${config.patient_name || activeCase.name}\n`;
        richSystemPrompt += `Demographics: ${demo.age || 'Unknown'} year old ${demo.gender || 'Unknown'}\n`;

        richSystemPrompt += `\n## INSTRUCTIONS\n`;
        richSystemPrompt += `${activeCase.system_prompt || 'You are a patient.'}\n`;
        richSystemPrompt += `\nSpeak only what the patient would say aloud. Never use stage directions, narration, or asterisk-wrapped action descriptors (e.g. "*nods*", "*clutches chest*", "*sighs*"). Express feelings through words alone.\n`;

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
            labs: false,
            radiology: false,
            procedures: true,
            notes: false
        };

        let hasAnyRecords = false;

        // History & HPI
        if (aiAccess.history && clinicalRecords.history) {
            const h = clinicalRecords.history;
            const historyParts = [];
            if (h.chiefComplaint) historyParts.push(`Chief Complaint: ${h.chiefComplaint}`);
            if (h.hpi) historyParts.push(`History of Present Illness: ${h.hpi}`);
            if (h.pastMedical) historyParts.push(`Past Medical History: ${h.pastMedical}`);
            if (h.pastSurgical) historyParts.push(`Past Surgical History: ${h.pastSurgical}`);
            if (h.allergies) historyParts.push(`Allergies: ${h.allergies}`);
            if (h.social) historyParts.push(`Social History: ${h.social}`);
            if (h.family) historyParts.push(`Family History: ${h.family}`);

            if (historyParts.length > 0) {
                if (!hasAnyRecords) {
                    richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                    hasAnyRecords = true;
                }
                richSystemPrompt += `\n### Medical History\n${historyParts.join('\n')}\n`;
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

        return richSystemPrompt;
    };

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
        EventLogger.emotionExpressed(emotion, COMPONENTS.CHAT_INTERFACE);
        const token = AuthService.getToken();
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
        try {
            await fetch(apiUrl('/emotion-logs'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    session_id: sessionId,
                    case_id: activeCase?.id,
                    emotion
                })
            });
        } catch (err) {
            console.error('Failed to log emotion:', err);
        }
        try {
            await fetch(apiUrl('/events/batch'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    session_id: sessionId,
                    events: [{
                        event_type: 'emotion_selected',
                        description: `Emotion: ${emotion}`,
                        timestamp: new Date().toISOString()
                    }]
                })
            });
        } catch (err) {
            console.error('Failed to log emotion to event log:', err);
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

    // Pick the voice for this patient. A per-case `case_voice` (merged in from
    // Resolve which voice should speak given a per-speaker override (case or
    // agent) layered on top of the global gender/age slots. Returns the
    // effective settings the speak() call uses.
    const resolveSpeakerSettings = (override) => {
        if (!voiceSettings) return null;
        const merged = { ...voiceSettings };
        if (override && typeof override === 'object') {
            for (const [k, v] of Object.entries(override)) {
                if (v !== undefined && v !== null && v !== '') merged[k] = v;
            }
        }
        return merged;
    };

    // Voice resolution precedence (most → least specific):
    //   case override (case_voice)
    //     → platform persona default for active provider+gender (default_voice_<provider>_<gender>)
    //     → platform voice slot for active provider+gender   (voice_<provider>_<gender>)
    //     → hardcoded fallback per provider                     (PROVIDER_FALLBACK_VOICE)
    //
    // Voice IDs are provider-specific so everything that's NOT case_voice has
    // to be looked up under the active provider's namespace; the server runs
    // a final upfront-validation that swaps in the same fallback if a stale
    // voice slips through (e.g. case_voice was set under a different
    // provider). See server/services/voiceFallbacks.js.
    const pickVoiceFile = (settings, gender, age) => {
        if (!settings) return null;
        if (settings.case_voice) return settings.case_voice;
        const safeAge = Number.isFinite(Number(age)) ? Number(age) : 35;
        const slot = safeAge < 13 ? 'child' : (/^f/i.test(gender || '') ? 'female' : 'male');
        const provider = settings.tts_provider || 'piper';

        const personaDefault = platformAvatars?.[`default_voice_${provider}_${slot}`];
        if (personaDefault) return personaDefault;

        const voiceSlot = settings[`voice_${provider}_${slot}`];
        if (voiceSlot) return voiceSlot;

        return PROVIDER_FALLBACK_VOICE[provider]?.[slot] || null;
    };

    // Effective rate/pitch for the active speaker. Override (case/agent) wins;
    // otherwise inherit from platform persona default for this gender; final
    // fallback is the global tts_rate or 1.0.
    const resolveRatePitch = (override, gender, age) => {
        const safeAge = Number.isFinite(Number(age)) ? Number(age) : 35;
        const slot = safeAge < 13 ? 'child' : (/^f/i.test(gender || '') ? 'female' : 'male');
        // Rate and pitch stay flat (provider-independent) — they're scalar
        // factors that work the same on any TTS engine.
        const personaRate  = platformAvatars?.[`default_rate_${slot}`];
        const personaPitch = platformAvatars?.[`default_pitch_${slot}`];

        const pickNum = (...vals) => {
            for (const v of vals) {
                if (v == null || v === '') continue;
                const n = Number(v);
                if (Number.isFinite(n)) return n;
            }
            return undefined;
        };

        return {
            rate:  pickNum(override?.tts_rate,  personaRate,  voiceSettings?.tts_rate),
            pitch: pickNum(override?.tts_pitch, personaPitch, voiceSettings?.tts_pitch)
        };
    };

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
            const override = activeCase?.config?.voice;
            const rawGender = activeCase?.config?.demographics?.gender;
            const age      = activeCase?.config?.demographics?.age;
            const safeAge  = Number.isFinite(Number(age)) ? Number(age) : 35;
            const slotGender = safeAge < 13 ? 'child' : (/^f/i.test(rawGender || '') ? 'female' : 'male');
            const settings = resolveSpeakerSettings(override);
            const voice    = pickVoiceFile(settings, rawGender, age);
            if (voice) {
                const { rate, pitch } = resolveRatePitch(override, rawGender, age);
                speech = VoiceService.beginSpeechSession({
                    voice, rate, pitch,
                    gender: slotGender,
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
                        ttsErrorToast(toast, err);
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
            : (acc ? stripStageDirections(acc) : (responseText ? stripStageDirections(responseText) : '(no response from LLM — check server logs)'));
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
    // LLM streaming hook today, so it stays single-shot). Layered override >
    // platform persona default > global, applied to voice/rate/pitch.
    const speakResponse = (responseText, { override, gender, age }) => {
        const settings = resolveSpeakerSettings(override);
        const voice = pickVoiceFile(settings, gender, age);
        const spokenText = stripStageDirections(responseText);
        if (!voice || !spokenText || responseText.startsWith('Error:')) return;
        const { rate, pitch } = resolveRatePitch(override, gender, age);
        const safeAge = Number.isFinite(Number(age)) ? Number(age) : 35;
        const slotGender = safeAge < 13 ? 'child' : (/^f/i.test(gender || '') ? 'female' : 'male');
        VoiceService.speak({
            text: spokenText,
            voice,
            rate,
            pitch,
            gender: slotGender,
            onStart: () => setSpeaking(true),
            onVisemes: setVisemes,
            onEnd: () => {
                setSpeaking(false);
                setVisemes({ viseme_sil: 1 });
            },
            onError: (err) => {
                console.error('TTS error:', err);
                setSpeaking(false);
                ttsErrorToast(toast, err);
            }
        });
    };

    const startVoiceTurn = () => {
        if (!voiceSettings?.stt_language) {
            console.warn('No STT language configured');
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

        VoiceService.startListening({
            lang: voiceSettings.stt_language,
            onResult: ({ final, interim, isFinal }) => {
                setInput(interim || final);
                if (isFinal && final) {
                    VoiceService.stopListening();
                }
            },
            onError: (err) => {
                console.warn('STT error:', err.message);
                setListening(false);
            },
            onEnd: ({ final }) => {
                setListening(false);
                if (final) {
                    handleSendToPatient(final);
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
                currentConversation
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
                speakResponse(responseText, {
                    override: cfg.voice,
                    gender: cfg.gender,
                    age: undefined
                });
            }
        } catch (err) {
            console.error('Failed to send message to agent:', err);
            // Use functional update with fallback to empty array
            setAgentConversations(prev => ({
                ...prev,
                [agentType]: [...(prev[agentType] || []), { role: 'assistant', content: 'Error: Could not get response.' }]
            }));
        }

        setLoading(false);
    };

    if (!activeCase) {
        return (
            <div className="flex items-center justify-center h-full text-neutral-500 bg-neutral-900 border-t border-neutral-800">
                <div className="text-center">
                    <p>No Case Selected.</p>
                    <p className="text-xs">Please load a case from settings.</p>
                </div>
            </div>
        );
    }

    // Get patient info from case config
    const patientName = activeCase?.config?.patient_name || activeCase?.name || 'Patient';
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
                        {status === 'present' ? 'Here' :
                         status === 'paged' ? 'Coming' :
                         status === 'on-call' ? 'On-Call' :
                         'Away'}
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
                {agents.filter(a => a.enabled !== false).map(agent => {
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
                                title={showTranscript ? 'Hide transcript (more immersive)' : 'Show transcript'}
                                className="px-2.5 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                            >
                                {showTranscript
                                    ? <><EyeOff className="w-3.5 h-3.5" /> Hide</>
                                    : <><Eye className="w-3.5 h-3.5" /> Show</>}
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
                            title={voiceMode ? 'Switch to text mode' : 'Switch to voice mode'}
                            className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition-colors ${
                                voiceMode
                                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                            }`}
                        >
                            {voiceMode ? <Volume2 className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                            {voiceMode ? 'Voice on' : 'Voice'}
                        </button>
                    </div>
                )}
            </div>

            {/* Agent Status Bar (when on agent tab) */}
            {activeTab !== 'patient' && currentAgent && agentStatus && (
                <div className={`px-4 py-2 flex items-center justify-between text-sm ${
                    agentStatus.status === 'present' ? 'bg-green-900/20 border-b border-green-800/50' :
                    agentStatus.status === 'paged' ? 'bg-amber-900/20 border-b border-amber-800/50' :
                    agentStatus.status === 'on-call' ? 'bg-blue-900/20 border-b border-blue-800/50' :
                    'bg-neutral-800/50 border-b border-neutral-700'
                }`}>
                    <div className="flex items-center gap-2">
                        {getAgentIcon(currentAgent.agent_type)}
                        <span className="font-medium">{currentAgent.name}</span>
                        <span className="text-neutral-500">• {currentAgent.role_title}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {agentStatus.canPage && (
                            <button
                                onClick={() => handlePageAgent(currentAgent.agent_type)}
                                className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold"
                            >
                                <Phone className="w-3 h-3" /> Page
                            </button>
                        )}
                        {agentStatus.status === 'paged' && (
                            <span className="flex items-center gap-1 text-amber-400">
                                <Clock className="w-3 h-3 animate-pulse" />
                                On the way...
                            </span>
                        )}
                        {!agentStatus.canChat && agentStatus.status !== 'paged' && (
                            <span className="text-neutral-500">{agentStatus.label}</span>
                        )}
                    </div>
                </div>
            )}

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
                                <p className="text-neutral-400 text-sm mb-2">Start a conversation with your patient</p>
                                <p className="text-neutral-600 text-xs">Type a message below to begin taking the patient's history</p>
                            </>
                        ) : agentStatus?.canChat ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">Chat with {currentAgent?.name}</p>
                                <p className="text-neutral-600 text-xs">Type a message to communicate with the {currentAgent?.role_title?.toLowerCase()}</p>
                            </>
                        ) : agentStatus?.canPage ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{currentAgent?.name} is on-call</p>
                                <p className="text-neutral-600 text-xs">Click the "Page" button above to request their presence</p>
                            </>
                        ) : (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{currentAgent?.name} is not available</p>
                                <p className="text-neutral-600 text-xs">{agentStatus?.label}</p>
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
                                            <img src={BASE_PATH + patientAvatar} alt={patientName} className="w-full h-full object-cover" />
                                        ) : (
                                            <Bot className="w-5 h-5 text-emerald-400" />
                                        )
                                    ) : (
                                        getAgentIcon(currentAgent?.agent_type)
                                    )}
                                </div>
                                <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">
                                    {activeTab === 'patient' ? 'Patient' : currentAgent?.name?.split(' ')[0]}
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
                                {activeTab === 'patient' ? 'Patient' : currentAgent?.name?.split(' ')[0]}
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

                {/* Curtain — covers the transcript in voice mode. Clicking
                    anywhere on the curtain reveals the transcript (matches
                    the toggle button in the header). */}
                {voiceMode && !showTranscript && (
                    <button
                        type="button"
                        onClick={() => setShowTranscript(true)}
                        className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/85 backdrop-blur-md hover:bg-neutral-900/75 transition-colors group"
                    >
                        <div className="w-12 h-12 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-3 group-hover:bg-neutral-700 transition-colors">
                            <Eye className="w-5 h-5 text-neutral-400 group-hover:text-purple-300" />
                        </div>
                        <p className="text-sm text-neutral-400 group-hover:text-neutral-200 font-medium">
                            Transcript hidden
                        </p>
                        <p className="text-xs text-neutral-600 mt-1">
                            Click anywhere to show what's been said
                        </p>
                    </button>
                )}
            </div>

            {/* Recurring Emotion Questionnaire — appears every 2 minutes */}
            {showQuestionnaire && (
                <div className="px-4 pt-3 pb-2 border-t border-indigo-800/60 bg-indigo-950/40">
                    <p className="text-[11px] font-semibold text-indigo-300 text-center mb-2 tracking-wide">
                        How are you feeling right now?
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
                                            {emotion}
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
                                    Listening… click to stop
                                </>
                            ) : speaking ? (
                                <>
                                    <Volume2 className="w-4 h-4 animate-pulse" />
                                    Patient speaking…
                                </>
                            ) : !sttSupported ? (
                                <>
                                    <MicOff className="w-4 h-4" />
                                    Speech recognition not supported in this browser
                                </>
                            ) : loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Thinking…
                                </>
                            ) : (
                                <>
                                    <Mic className="w-4 h-4" />
                                    Click to talk to {patientName}
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
                                loading ? "Waiting for response..." :
                                activeTab !== 'patient' && !agentStatus?.canChat ? `${currentAgent?.name} is not available` :
                                `Message ${activeTab === 'patient' ? patientName : currentAgent?.name}...`
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
