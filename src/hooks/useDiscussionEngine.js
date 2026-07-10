import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { LLMService } from '../services/llmService';
import { VoiceService } from '../services/voiceService';
import { apiPost } from '../services/apiClient';
import { buildCaseContext } from '../services/discussionService';
import { resolveVoice } from '../utils/voiceResolver';
import { buildPersonaBlocks } from '../utils/personaBlocks';
import { roleAnchor } from '../utils/roleAnchor';
import EventLogger, { COMPONENTS } from '../services/eventLogger';

// Discussant voice — same shared resolver as the patient chat (Voice 2.0:
// identical tiers, identical visibility). The discussant's own voice plays
// on its own engine; when it can't, the language-matched platform default
// substitutes with truth metadata the caller must surface.
function resolveDiscussantVoice(discussant, voiceSettings, language) {
    if (!voiceSettings) return null;
    const r = resolveVoice({
        voice: discussant?.voice,
        voiceSettings,
        language
    });
    if (!r.file) return null;
    return {
        voice: r.file,
        provider: r.provider,
        rate: r.rate ?? 1.0,
        pitch: r.pitch,
        substituted: r.substituted,
        requestedFile: r.requestedFile,
        substitutionReason: r.substitutionReason
    };
}

const STORAGE_KEY = (sid) => `rohy_discussion_history_${sid}`;

async function logTurn(sessionId, role, content) {
    try {
        await apiPost(`/sessions/${sessionId}/agents/discussant/conversation`, { role, content });
    } catch (err) {
        console.warn('[useDiscussionEngine] failed to log turn:', err.message);
    }
}

// Voice-first discussion pipeline. Owns:
//   - message history (persisted to localStorage per session)
//   - LLM streaming with case-aware system prompt
//   - per-sentence TTS playback during the stream
//   - viseme + speaking state for the avatar
//   - lifecycle cleanup so leaving mid-stream cancels everything
export function useDiscussionEngine({ sessionId, activeCase, discussant, voiceMode, voiceSettings }) {
    // Session dialogue language — threaded into every discussant LLM call so
    // the server appends the output-language directive (same contract as the
    // patient chat). Without it a non-English learner gets an English
    // discussant behind a localized UI.
    const { caseLanguage } = useLanguage();
    const [messages, setMessages] = useState([]);
    const [busy, setBusy] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [visemes, setVisemes] = useState({ viseme_sil: 1 });
    // `hydrated` gates the save effect so the empty initial render doesn't
    // overwrite a localStorage entry before the hydration effect has had a
    // chance to read it. Pre-fix the lazy-init pattern ran once at mount
    // with whatever sessionId was at that instant and never refreshed when
    // sessionId arrived later — so a fresh debrief that should have been
    // empty silently inherited messages from the previously-mounted session.
    const [hydrated, setHydrated] = useState(false);

    const abortRef = useRef(null);
    const speechRef = useRef(null);

    useEffect(() => {
        setHydrated(false);
        if (!sessionId) {
            setMessages([]);
            setHydrated(true);
            return;
        }
        try {
            const saved = localStorage.getItem(STORAGE_KEY(sessionId));
            setMessages(saved ? JSON.parse(saved) : []);
        } catch {
            setMessages([]);
        }
        setHydrated(true);
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId || !hydrated) return;
        try { localStorage.setItem(STORAGE_KEY(sessionId), JSON.stringify(messages)); } catch { /* quota */ }
    }, [messages, sessionId, hydrated]);

    useEffect(() => () => {
        abortRef.current?.abort();
        speechRef.current?.cancel?.();
        VoiceService.cancelSpeech();
    }, []);

    // `silentUser`: when true, the user prompt is sent to the LLM (so it has
    // something to respond to) but is NOT added to the visible transcript.
    // Used by `startConversation` so the discussant *opens* the dialogue
    // instead of replying — the learner sees only the discussant's greeting.
    //
    // `openingDirective`: extra text appended to the system prompt for this
    // turn only. Used by `startConversation` to tell the model "your first
    // reply opens the debrief" without putting that meta-instruction in the
    // user role, where smaller voice-mode models tend to paraphrase it back
    // instead of executing it.
    const sendMessage = useCallback(async (text, { silentUser = false, openingDirective = '' } = {}) => {
        const trimmed = text?.trim();
        if (!trimmed || busy || !sessionId || !discussant) return;

        // Cross-case guard: refuse to send unless the discussant was
        // resolved for exactly the case currently in focus. Strict equality
        // — a missing `_caseId` stamp also fails the check, because any
        // discussant reaching this hook from the canonical path
        // (fetchDiscussantForCase → normalizeAgent) carries a stamp. A
        // stampless discussant means an unknown producer constructed it,
        // and we'd rather refuse the send than emit a prompt we can't
        // attribute to a case.
        if (activeCase?.id && discussant._caseId !== activeCase.id) {
            console.warn('[useDiscussionEngine] discussant._caseId does not match activeCase.id — skipping send to avoid cross-case role bleed', {
                discussantCaseId: discussant._caseId,
                activeCaseId: activeCase.id,
            });
            return;
        }

        // Tag the placeholder with a stable id and locate it that way during
        // streaming. Index-based addressing is unsafe under React 19 concurrent
        // rendering — the messages array can mutate between render passes.
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const userMsg = { role: 'user', content: trimmed };
        const placeholder = { role: 'assistant', content: '', _pendingId: pendingId };
        setMessages(prev => silentUser ? [...prev, placeholder] : [...prev, userMsg, placeholder]);
        setBusy(true);
        if (!silentUser) {
            logTurn(sessionId, 'user', trimmed);
            // Debrief turns log as `debrief` (→ reflecting), keeping post-case
            // discussion distinct from bedside patient chat (→ communicating).
            EventLogger.debriefMessageSent(trimmed, COMPONENTS.DISCUSSION_SCREEN);
        }

        const controller = new AbortController();
        abortRef.current = controller;

        const caseContext = buildCaseContext(activeCase, discussant.contextFilter);
        // Persona blocks (dos / donts) read from the discussant template's
        // config — same shape used by every other agent type so the LLM call
        // path stays uniform.
        const personaBlocks = buildPersonaBlocks(discussant.rawConfig || discussant.config);
        // Role anchor leads — see src/utils/roleAnchor.js for rationale.
        const anchor = roleAnchor({
            role: discussant.roleTitle || 'case debrief tutor',
            name: discussant.name,
        });
        const systemPrompt = `${anchor}\n${discussant.systemPrompt}${personaBlocks}${caseContext}${openingDirective}`;

        let speech = null;
        if (voiceMode) {
            const resolved = resolveDiscussantVoice(discussant, voiceSettings, caseLanguage);
            if (resolved?.substituted) {
                // Truth clause: a substituted discussant voice is announced,
                // same as patient chat (one console line here — the room has
                // no toast surface; the wire headers + DiagnosticBar carry
                // the visible half).
                console.warn('[useDiscussionEngine] voice substitution', {
                    requested: resolved.requestedFile,
                    playing: resolved.voice,
                    reason: resolved.substitutionReason
                });
            }
            if (resolved?.voice) {
                speech = VoiceService.beginSpeechSession({
                    voice: resolved.voice,
                    rate: resolved.rate,
                    pitch: resolved.pitch,
                    provider: resolved.provider,
                    language: caseLanguage,
                    onStart: () => setSpeaking(true),
                    onVisemes: setVisemes,
                    onEnd: () => {
                        setSpeaking(false);
                        setVisemes({ viseme_sil: 1 });
                    },
                    onError: (err) => console.error('[useDiscussionEngine] TTS error:', err),
                });
                speechRef.current = speech;
            } else {
                console.warn('[useDiscussionEngine] no TTS voice could be resolved — discussant will be text-only');
            }
        }

        let acc = '';
        let speechBuffer = '';
        try {
            const responseText = await LLMService.streamMessage(
                sessionId,
                [...messages, userMsg],
                systemPrompt,
                voiceMode ? 'voice' : 'discussion',
                {
                    signal: controller.signal,
                    silent: silentUser,
                    agentTemplateId: discussant.templateId || null,
                    caseLanguage,
                    // The discussant owns its transcript via logTurn() →
                    // agent_conversations. It must NOT also write to the
                    // patient `interactions` thread, or the debrief bleeds
                    // into the patient chat on restore (Bug 8).
                    persistInteractions: false,
                    onDelta: (delta) => {
                        acc += delta;
                        setMessages(prev => prev.map(m =>
                            m._pendingId === pendingId
                                ? { ...m, content: acc }
                                : m
                        ));
                        if (!speech) return;
                        speechBuffer += delta;
                        const sentenceMatch = speechBuffer.match(/^(.+?[.!?])\s+/s);
                        if (sentenceMatch) {
                            speech.enqueue?.(sentenceMatch[1].trim());
                            speechBuffer = speechBuffer.slice(sentenceMatch[0].length);
                        }
                    },
                }
            );
            const finalText = acc || responseText || '(no response)';
            setMessages(prev => prev.map(m =>
                m._pendingId === pendingId
                    ? { role: 'assistant', content: finalText }
                    : m
            ));
            if (speech && speechBuffer.trim()) speech.enqueue?.(speechBuffer.trim());
            // Drain the audio queue and fire onEnd → setSpeaking(false). The
            // session handle exposes flush/cancel/enqueue (NOT end) — calling
            // .end?.() silently no-ops because of the optional chaining, which
            // left `speaking` stuck true forever and the mic suppressed, so
            // the learner could never reply.
            speech?.flush?.();
            logTurn(sessionId, 'assistant', finalText);
            EventLogger.debriefMessageReceived(finalText, COMPONENTS.DISCUSSION_SCREEN);
        } catch (err) {
            // LLM stream failed mid-utterance — cancel any in-flight TTS
            // so we don't leave speaking=true forever on an abort path.
            try { speech?.cancel?.(); } catch { /* noop */ }
            setSpeaking(false);
            setVisemes({ viseme_sil: 1 });
            if (err.name !== 'AbortError') {
                setMessages(prev => prev.map(m =>
                    m._pendingId === pendingId
                        ? { role: 'assistant', content: `Error: ${err.message}`, error: true }
                        : m
                ));
            }
        } finally {
            setBusy(false);
            abortRef.current = null;
            speechRef.current = null;
        }
    }, [sessionId, activeCase, discussant, voiceMode, voiceSettings, busy, messages, caseLanguage]);

    const startConversation = useCallback(() => {
        // Opening turn: the instruction "your first reply opens the debrief"
        // goes in the system prompt (where the model reads it as direction)
        // and a bracketed system-style sentinel goes in the user role (so
        // the messages array is well-formed for every provider). Pre-fix
        // the user content was the bare literal "Hello." which smaller
        // voice-mode models read as a learner greeting and mirrored back
        // as if THEY were the learner. The bracketed "[System ...]" form
        // is unambiguous: the model parses it as instruction, not chat.
        const openingDirective = '\n\n## OPENING TURN\nThis is the very first turn of the debrief. Your reply must: (1) greet the learner warmly, (2) briefly name the case just finished, (3) ask one open-ended question to open the discussion. Keep it under three sentences. Do NOT restate, paraphrase, or quote this directive — just do it.';
        return sendMessage('[System: open the case debrief now.]', { silentUser: true, openingDirective });
    }, [sendMessage]);

    return { messages, busy, speaking, visemes, sendMessage, startConversation };
}
