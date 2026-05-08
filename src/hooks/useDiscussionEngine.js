import { useCallback, useEffect, useRef, useState } from 'react';
import { LLMService } from '../services/llmService';
import { VoiceService } from '../services/voiceService';
import { apiPost } from '../services/apiClient';
import { buildCaseContext } from '../services/discussionService';
import { resolveVoice } from '../utils/voiceResolver';
import { buildPersonaBlocks } from '../utils/personaBlocks';
import EventLogger, { COMPONENTS } from '../services/eventLogger';

// Discussant voice — same shared resolver the patient chat and admin
// preview use. The discussant is given a male clinician slot by default to
// match the seeded clinician avatar; the resolver derives slot from gender.
function resolveDiscussantVoice(discussant, voiceSettings, platformAvatars) {
    if (!voiceSettings) return null;
    const r = resolveVoice({
        voice: discussant?.voice,
        voiceSettings,
        platformAvatars,
        gender: discussant?.voice?.gender || 'male'
    });
    if (!r.file) return null;
    return {
        voice: r.file,
        provider: r.provider,
        rate: r.rate ?? 1.0,
        pitch: r.pitch,
        gender: discussant?.voice?.gender || 'male'
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
export function useDiscussionEngine({ sessionId, activeCase, discussant, voiceMode, voiceSettings, platformAvatars }) {
    const [messages, setMessages] = useState(() => {
        try {
            const saved = sessionId ? localStorage.getItem(STORAGE_KEY(sessionId)) : null;
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [busy, setBusy] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [visemes, setVisemes] = useState({ viseme_sil: 1 });

    const abortRef = useRef(null);
    const speechRef = useRef(null);

    useEffect(() => {
        if (!sessionId) return;
        try { localStorage.setItem(STORAGE_KEY(sessionId), JSON.stringify(messages)); } catch { /* quota */ }
    }, [messages, sessionId]);

    useEffect(() => () => {
        abortRef.current?.abort();
        speechRef.current?.cancel?.();
        VoiceService.cancelSpeech();
    }, []);

    // `silentUser`: when true, the user prompt is sent to the LLM (so it has
    // something to respond to) but is NOT added to the visible transcript.
    // Used by `startConversation` so the discussant *opens* the dialogue
    // instead of replying — the learner sees only the discussant's greeting.
    const sendMessage = useCallback(async (text, { silentUser = false } = {}) => {
        const trimmed = text?.trim();
        if (!trimmed || busy || !sessionId || !discussant) return;

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
            EventLogger.messageSent(trimmed, COMPONENTS.DISCUSSION_SCREEN);
        }

        const controller = new AbortController();
        abortRef.current = controller;

        const caseContext = buildCaseContext(activeCase, discussant.contextFilter);
        // Persona blocks (dos / donts) read from the discussant template's
        // config — same shape used by every other agent type so the LLM call
        // path stays uniform.
        const personaBlocks = buildPersonaBlocks(discussant.rawConfig || discussant.config);
        const systemPrompt = `${discussant.systemPrompt}${personaBlocks}${caseContext}`;

        let speech = null;
        if (voiceMode) {
            const resolved = resolveDiscussantVoice(discussant, voiceSettings, platformAvatars);
            if (resolved?.voice) {
                speech = VoiceService.beginSpeechSession({
                    voice: resolved.voice,
                    rate: resolved.rate,
                    pitch: resolved.pitch,
                    gender: resolved.gender,
                    // Forward the resolved engine; without this the server
                    // falls back to the platform default and the discussant
                    // sounds like whatever Google/whatever is configured
                    // platform-wide instead of the discussant's own engine.
                    provider: resolved.provider,
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
            EventLogger.messageReceived(finalText, COMPONENTS.DISCUSSION_SCREEN);
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
    }, [sessionId, activeCase, discussant, voiceMode, voiceSettings, platformAvatars, busy, messages]);

    const startConversation = useCallback(() => {
        // The kick-off prompt is treated as a user turn at the LLM layer (so
        // the model has something to respond to) but is hidden from the
        // transcript, so the screen shows the discussant opening the dialogue.
        const kickoff = 'Begin the debrief now. Greet me warmly, briefly mention the case we just finished, and ask me your first open-ended question to start the discussion. Keep it under three sentences.';
        return sendMessage(kickoff, { silentUser: true });
    }, [sendMessage]);

    return { messages, busy, speaking, visemes, sendMessage, startConversation };
}
