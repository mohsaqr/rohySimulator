import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * The session's ONE patient conversation, shared between every surface that
 * takes part in it.
 *
 * ChatInterface owns the turn — the persona prompt, the model call, the
 * persistence to /interactions, the patient's voice — and stays the only
 * place that logic lives. What this context adds is a bus beside it:
 *
 *   - ChatInterface PUBLISHES the transcript here (`publish(messages)`) and
 *     REGISTERS its send handler (`register({ send })`).
 *   - Anything else — the 3D bedside room, through the host's 'conversation'
 *     plugin grant — reads `messages` and calls `send(text, meta)`, and the
 *     turn runs through ChatInterface exactly as a typed one would: same
 *     persona, same agent template, same patient-record write, same voice.
 *
 * So a question asked at the bedside appears in the chat transcript as it
 * streams, a question typed in the chat is heard at the bedside, and the
 * transcript that is saved and restored holds both. Before this, the room
 * kept a private copy of the history that the chat never saw, and reloading
 * the chat dropped every bedside turn from the visible transcript.
 *
 * `voiced` says whether the CURRENT reply is actually being spoken aloud —
 * true once the chat has opened a speech session for it, false when it
 * never will (voice mode off, no voice resolved, TTS failed), null while
 * that is not yet known. A consumer that holds a caption back for the
 * audio's head start needs this, or a reply nobody voices is a reply
 * nobody sees.
 *
 * `meta` on send: `{ source, spoken }`. `source` says where the turn came
 * from ('typed', 'voice', or a plugin room id) and is persisted with the
 * interaction; `spoken: true` asks for the reply to be voiced even when the
 * chat's own voice mode is off — a learner who SPOKE to the patient expects
 * to be answered aloud.
 *
 * Absent a provider the hook returns an inert bus: ChatInterface keeps
 * working exactly as before (its own state is still the source of truth),
 * and no consumer can reach the conversation. Tests that render ChatInterface
 * without the provider are therefore unaffected.
 */
const PatientConversationContext = createContext(null);

const INERT_BUS = Object.freeze({
    messages: Object.freeze([]),
    loading: false,
    voiced: null,
    sessionId: null,
    available: false,
    send: async () => {
        throw new Error('No patient conversation is mounted.');
    },
    publish: () => {},
    register: () => () => {},
});

export function PatientConversationProvider({ children }) {
    const [messages, setMessages] = useState(INERT_BUS.messages);
    const [loading, setLoading] = useState(false);
    const [voiced, setVoiced] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    // The registered sender lives in a ref: ChatInterface re-registers on
    // every render of its handler, and consumers must always reach the
    // latest closure without re-rendering for it.
    const senderRef = useRef(null);

    // Called by ChatInterface whenever its transcript or turn state changes.
    const publish = useCallback(({ messages: next, loading: busy, voiced: spoken, sessionId: sid }) => {
        if (next !== undefined) setMessages(next);
        if (busy !== undefined) setLoading(Boolean(busy));
        if (spoken !== undefined) setVoiced(spoken === null ? null : Boolean(spoken));
        if (sid !== undefined) setSessionId(sid ?? null);
    }, []);

    // Called by ChatInterface with its send handler; returns the unregister.
    const register = useCallback(({ send }) => {
        senderRef.current = typeof send === 'function' ? send : null;
        return () => {
            if (senderRef.current === send) senderRef.current = null;
        };
    }, []);

    const send = useCallback(async (text, meta = {}) => {
        const sender = senderRef.current;
        if (!sender) throw new Error('No patient conversation is mounted.');
        return sender(text, meta);
    }, []);

    const value = useMemo(() => ({
        messages,
        loading,
        voiced,
        sessionId,
        available: true,
        send,
        publish,
        register,
    }), [messages, loading, voiced, sessionId, send, publish, register]);

    return (
        <PatientConversationContext.Provider value={value}>
            {children}
        </PatientConversationContext.Provider>
    );
}

/** The bus, or an inert stand-in when no provider is mounted. */
export function usePatientConversation() {
    return useContext(PatientConversationContext) ?? INERT_BUS;
}

/**
 * The narrowed shape the host grants a plugin that asked for the
 * 'conversation' capability: speak into the thread and read it, nothing
 * else — no publish, no register, no way to replace the sender.
 */
export function narrowConversation(bus) {
    if (!bus?.available) return null;
    return {
        messages: bus.messages,
        loading: bus.loading,
        voiced: bus.voiced,
        sessionId: bus.sessionId,
        send: bus.send,
    };
}

export default PatientConversationContext;
