import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const NO_MESSAGES = Object.freeze([]);

/**
 * Asking the patient a question, out loud, from inside the 3D room.
 *
 * The room decides nothing about the patient. `conversation` is the host's
 * 'conversation' grant — the session's ONE patient thread, as ChatInterface
 * publishes it through PatientConversationContext — and `ask()` sends the
 * learner's words THROUGH the chat room's own handler: same persona, same
 * agent template, same patient-record write, same voice, same
 * /interactions row (stamped `source: 'room3d'`). The answer streams back
 * into `conversation.messages` exactly as a typed one would, so it appears
 * in the chat transcript as it is spoken here, and a question typed in the
 * chat while this room is open is answered here too.
 *
 * The latest patient line is handed to `onReply` as the transcript grows,
 * rather than held as state here: the room has one caption slot with two
 * writers — a scripted exam reaction and this answer — and whoever spoke
 * last owns it. `onReply(null)` clears the slot while the patient thinks.
 * The meta says who ASKED (`source`), so the screen can tell whether the
 * reply is one it requested aloud or one the chat room is voicing on its
 * own terms.
 *
 * @param {{conversation: {messages: Array, loading: boolean, sessionId: *,
 *   send: (text: string, meta: object) => Promise<*>}|null,
 *   spoken: boolean,
 *   onReply: (line: string|null, meta?: {source: string|null}) => void}} options
 *   `spoken` asks the host to voice the reply (the room's own voice switch).
 * @return {{ask: (text: string) => Promise<void>, thinking: boolean,
 *   error: string|null, ready: boolean}}
 */
export default function useRoomConversation({ conversation, spoken = true, onReply }) {
    const { t } = useTranslation('room3d');
    const [error, setError] = useState(null);
    const messages = conversation?.messages ?? NO_MESSAGES;
    const ready = Boolean(conversation?.sessionId);
    const thinking = Boolean(conversation?.loading);

    const onReplyRef = useRef(onReply);
    useEffect(() => {
        onReplyRef.current = onReply;
    });

    // Mirror the thread's newest line into the caption. A user turn clears
    // the slot (the patient is thinking); an assistant turn fills it as it
    // streams; an errored turn shows nothing — never an error in the
    // patient's mouth. The meta names who asked: the nearest user turn
    // before the reply, read from the transcript itself so a room that
    // mounts mid-conversation sees the same answer as one that watched it.
    useEffect(() => {
        const last = messages[messages.length - 1];
        if (!last) return;
        if (last.role === 'user') {
            onReplyRef.current?.(null);
            return;
        }
        if (last.role !== 'assistant') return;
        const asked = [...messages].reverse().find((m) => m.role === 'user');
        const line = last.error ? null : (last.content || null);
        onReplyRef.current?.(line, { source: asked?.source ?? null });
    }, [messages]);

    const ask = useCallback(async (heard) => {
        const text = typeof heard === 'string' ? heard.trim() : '';
        if (!text) return;
        if (!ready) {
            setError(t('not_ready'));
            return;
        }
        setError(null);
        try {
            await conversation.send(text, { source: 'room3d', spoken });
        } catch (err) {
            setError(err?.message || t('no_answer'));
        }
    }, [conversation, ready, spoken, t]);

    return { ask, thinking, error, ready };
}
