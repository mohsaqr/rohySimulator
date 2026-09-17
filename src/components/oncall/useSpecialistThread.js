// One specialist's conversation: texts and call turns share a single thread
// (the server keys agent_conversations by agent_type), so a call's
// transcript shows up in the chat afterwards and the model sees both.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentService } from '../../services/AgentService';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';

const LOG_COMPONENT = COMPONENTS.CHAT_INTERFACE;

export function useSpecialistThread({ sessionId, agent, activeCase, caseLanguage }) {
    const agentType = agent?.agent_type || null;
    const threadKey = sessionId && agentType ? `${sessionId}|${agentType}` : null;
    // Rows are stored with the thread they belong to, so switching specialist
    // shows an empty, loading thread instead of the previous one's messages.
    const [store, setStore] = useState({ key: null, rows: [], loaded: false });
    const [sending, setSending] = useState(false);
    const current = store.key === threadKey;
    const messages = current ? store.rows : [];
    const loaded = current && store.loaded;
    // Mirrors the current thread so send() builds the model history from the
    // latest rows even when two turns are dispatched from the same render.
    const messagesRef = useRef([]);
    const sendingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        messagesRef.current = [];
        if (!threadKey) return undefined;
        AgentService.getConversation(sessionId, agentType).then((rows) => {
            if (cancelled) return;
            messagesRef.current = rows;
            setStore({ key: threadKey, rows, loaded: true });
        });
        return () => { cancelled = true; };
    }, [threadKey, sessionId, agentType]);

    const append = (row) => {
        messagesRef.current = [...messagesRef.current, row];
        const rows = messagesRef.current;
        setStore(prev => ({ key: threadKey, rows, loaded: prev.key === threadKey && prev.loaded }));
    };

    // Send one learner turn. Resolves to the reply text, or null when a turn
    // is already in flight (one turn at a time, like the patient chat).
    const send = useCallback(async (text, { channel = 'chat', callId = null } = {}) => {
        const content = String(text || '').trim();
        if (!content || !agent || sendingRef.current) return null;
        sendingRef.current = true;
        setSending(true);
        const history = messagesRef.current.map(m => ({ role: m.role, content: m.content }));
        const tags = { channel, call_id: callId };
        append({ role: 'user', content, ...tags });
        EventLogger.agentMessageSent(agent.agent_type, agent.name || agent.agent_type, content, LOG_COMPONENT);
        try {
            const reply = await AgentService.sendAgentMessage(
                sessionId,
                agent,
                content,
                null,
                [],
                null,
                history,
                activeCase,
                { caseLanguage, channel, callId },
            );
            append({ role: 'assistant', content: reply, ...tags });
            EventLogger.agentMessageReceived(agent.agent_type, agent.name || agent.agent_type, reply, LOG_COMPONENT);
            return reply;
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- append closes over threadKey only
    }, [agent, sessionId, activeCase, caseLanguage, threadKey]);

    return { messages, loaded, sending, send };
}
