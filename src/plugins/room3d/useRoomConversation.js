import { useCallback, useEffect, useRef, useState } from 'react';
import { LLMService } from '../../services/llmService';
import EventLogger from '../../services/eventLogger';
import { apiFetch } from '../../services/apiClient.js';
import { getLastPatientPrompt } from '../../utils/lastPatientPrompt';
import { extractCompleteSentences } from '../../utils/sentenceSplit';
import { sanitizeResponseText } from '../../utils/plainText';
import { DEFAULT_LANGUAGE } from '../../i18n/languages';

/**
 * Asking the patient a question, out loud, from inside the 3D room.
 *
 * Nothing about the patient is re-decided here. The persona is the SAME
 * assembled system prompt the chat room sends — ChatInterface stays mounted
 * (hidden and inert) beneath this room and pre-warms it into the
 * lastPatientPrompt module cache on every case change, so the room reads it
 * rather than re-deriving a second, drifting persona. The thread is the same
 * one too: `/interactions/:sessionId` is the patient conversation, and
 * LLMService persists both sides of every turn there, so a question asked in
 * the room is in the transcript the educator reviews.
 *
 * The prompt is checked against the case in focus before it is used. A room
 * that cannot prove it holds THIS patient's persona refuses to ask rather
 * than putting words in a different patient's mouth — the same stance the
 * voice resolver takes about substituting voices.
 *
 * The answer is handed to `onReply` as it streams rather than held as state
 * here. The room has one caption slot with two writers — a scripted exam
 * reaction and this answer — and whoever spoke last owns it; a second copy
 * of the reply living in this hook could only disagree with that.
 *
 * `onReply` is told whether the line will be `spoken`. A room with voice mode
 * off (or a case whose voice cannot play) still has to SHOW the answer — a
 * caption that waits for audio which is never coming is, from the learner's
 * side, a patient who does not respond at all.
 *
 * @param {{activeCase: object|null, sessionId: string|null,
 *   beginSession: () => ({enqueue, flush, cancel}|null),
 *   onReply: (line: string|null, meta?: {spoken: boolean}) => void}} options
 * @return {{ask: (text: string) => Promise<void>, thinking: boolean,
 *   error: string|null, ready: boolean}}
 */
export default function useRoomConversation({ activeCase, sessionId, beginSession, onReply }) {
    const [thinking, setThinking] = useState(false);
    const [error, setError] = useState(null);
    // The thread, mirrored locally so each turn carries its predecessors.
    // Server-loaded once: the learner may have been talking in the chat room
    // before walking into the 3D one, and the patient must remember that.
    const historyRef = useRef([]);
    // Which session's thread has been read. Storing the id rather than a
    // boolean means a session change invalidates readiness by comparison,
    // with no setState in the effect body to reset it.
    const [loadedFor, setLoadedFor] = useState(null);
    const ready = Boolean(sessionId) && loadedFor === sessionId;

    useEffect(() => {
        if (!sessionId) return undefined;
        let cancelled = false;
        apiFetch(`/interactions/${sessionId}`)
            .then((data) => {
                if (cancelled) return;
                historyRef.current = (data?.interactions ?? [])
                    .filter((i) => i.role === 'user' || i.role === 'assistant')
                    .map((i) => ({ role: i.role, content: i.content }));
                setLoadedFor(sessionId);
            })
            .catch(() => {
                // A thread we could not read is an empty thread, not a
                // blocked room: the learner can still ask, the patient just
                // starts without the earlier chat in mind.
                if (!cancelled) setLoadedFor(sessionId);
            });
        return () => { cancelled = true; };
    }, [sessionId]);

    const beginSessionRef = useRef(beginSession);
    const onReplyRef = useRef(onReply);
    useEffect(() => {
        beginSessionRef.current = beginSession;
        onReplyRef.current = onReply;
    });

    const ask = useCallback(async (spoken) => {
        const text = typeof spoken === 'string' ? spoken.trim() : '';
        if (!text || !sessionId || !activeCase) return;

        const cached = getLastPatientPrompt();
        // Belongs to THIS case, or it is not this patient's persona.
        if (!cached?.prompt || cached.caseId !== activeCase.id) {
            setError('The patient is not ready to talk yet.');
            return;
        }

        setError(null);
        setThinking(true);
        onReplyRef.current?.(null);

        const userMsg = { role: 'user', content: text };
        const messages = [...historyRef.current, userMsg];
        EventLogger.messageSent(text, 'Room3D');

        // Open the voice up front so the first finished sentence can start
        // playing while the model is still writing the second.
        const speech = beginSessionRef.current?.() ?? null;

        let acc = '';
        let speechBuffer = '';

        const responseText = await LLMService.streamMessage(
            sessionId,
            messages,
            cached.prompt,
            'voice',
            {
                caseLanguage: activeCase?.config?.language ?? DEFAULT_LANGUAGE,
                onDelta: (delta) => {
                    acc += delta;
                    onReplyRef.current?.(sanitizeResponseText(acc), { spoken: Boolean(speech) });
                    if (!speech) return;
                    speechBuffer += delta;
                    const { sentences, remainder } = extractCompleteSentences(speechBuffer);
                    speechBuffer = remainder;
                    sentences.forEach((sentence) => {
                        const line = sanitizeResponseText(sentence).trim();
                        if (line) speech.enqueue(line);
                    });
                },
            },
        );

        const failed = typeof responseText === 'string' && responseText.startsWith('Error:');
        if (failed || !responseText) {
            // Never speak an error in the patient's voice.
            speech?.cancel();
            onReplyRef.current?.(null);
            setError(failed ? responseText : 'The patient did not answer.');
        } else {
            const finalText = sanitizeResponseText(acc || responseText);
            onReplyRef.current?.(finalText, { spoken: Boolean(speech) });
            if (speech) {
                const tail = sanitizeResponseText(speechBuffer).trim();
                if (tail) speech.enqueue(tail);
                speech.flush();
            }
            historyRef.current = [...messages, { role: 'assistant', content: finalText }];
            EventLogger.messageReceived(responseText, 'Room3D');
        }
        setThinking(false);
    }, [activeCase, sessionId]);

    return { ask, thinking, error, ready };
}
