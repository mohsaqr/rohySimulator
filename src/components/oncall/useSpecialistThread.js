// One specialist's conversation: texts and call turns share a single thread
// (the server keys agent_conversations by agent_type), so a call's
// transcript shows up in the chat afterwards and the model sees both.
//
// A turn that could not be answered is NOT a message from the specialist.
// Until 2026-10-14 AgentService handed back "Error: Could not communicate
// with …" as if it were the reply; this hook appended it as role 'assistant',
// logged it as agentMessageReceived, and the call screen could read it aloud
// (FI-0010 review, F13). Now a failure leaves the learner's turn in the
// thread marked `failed` and sets `failure`, which the screens show as a
// localized operational error with Retry.

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
    // The last turn that went unanswered: { key, row, kind, learnerTurnStored }.
    const [failureState, setFailureState] = useState(null);
    const current = store.key === threadKey;
    const messages = current ? store.rows : [];
    const loaded = current && store.loaded;
    const failure = failureState && failureState.key === threadKey ? failureState : null;
    // Mirrors the current thread so send() builds the model history from the
    // latest rows even when two turns are dispatched from the same render.
    const messagesRef = useRef([]);
    const sendingRef = useRef(false);
    const failureRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        messagesRef.current = [];
        failureRef.current = null;
        if (!threadKey) return undefined;
        AgentService.getConversation(sessionId, agentType).then((rows) => {
            if (cancelled) return;
            messagesRef.current = rows;
            setStore({ key: threadKey, rows, loaded: true });
        });
        return () => { cancelled = true; };
    }, [threadKey, sessionId, agentType]);

    const commit = (rows) => {
        messagesRef.current = rows;
        setStore(prev => ({ key: threadKey, rows, loaded: prev.key === threadKey && prev.loaded }));
    };
    const append = (row) => commit([...messagesRef.current, row]);
    const replaceRow = (from, to) => commit(messagesRef.current.map(m => (m === from ? to : m)));
    const setFailure = (value) => {
        failureRef.current = value;
        setFailureState(value);
    };

    // Ask the specialist to answer `row` (already in the thread). History is
    // every row before it, minus turns that were never answered.
    const dispatch = async (row, { storeLearnerTurn }) => {
        const index = messagesRef.current.indexOf(row);
        const before = index >= 0 ? messagesRef.current.slice(0, index) : messagesRef.current;
        const history = before.filter(m => !m.failed).map(m => ({ role: m.role, content: m.content }));
        const result = await AgentService.requestAgentReply(sessionId, agent, row.content, history, {
            caseLanguage,
            channel: row.channel,
            callId: row.call_id,
            storeLearnerTurn,
        });
        if (result.ok) {
            setFailure(null);
            append({ role: 'assistant', content: result.content, channel: row.channel, call_id: row.call_id });
            EventLogger.agentMessageReceived(agent.agent_type, agent.name || agent.agent_type, result.content, LOG_COMPONENT);
            return result;
        }
        const failedRow = { ...row, failed: true };
        replaceRow(row, failedRow);
        setFailure({ key: threadKey, row: failedRow, kind: result.error.kind, learnerTurnStored: result.learnerTurnStored });
        return result;
    };

    const run = async (fn) => {
        if (!agent || sendingRef.current) return null;
        sendingRef.current = true;
        setSending(true);
        try {
            return await fn();
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    // Send one learner turn. Resolves to requestAgentReply's result
    // ({ok:true, content} | {ok:false, error}), or null when nothing was sent
    // (empty text, no agent, or a turn already in flight — one turn at a
    // time, like the patient chat).
    const send = useCallback(async (text, { channel = 'chat', callId = null } = {}) => {
        const content = String(text || '').trim();
        if (!content) return null;
        return run(async () => {
            // A new turn supersedes an unanswered one; it stays in the thread,
            // marked failed, and is left out of the model's history.
            setFailure(null);
            const row = { role: 'user', content, channel, call_id: callId };
            append(row);
            EventLogger.agentMessageSent(agent.agent_type, agent.name || agent.agent_type, content, LOG_COMPONENT);
            return dispatch(row, { storeLearnerTurn: true });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- append/dispatch close over threadKey only
    }, [agent, sessionId, activeCase, caseLanguage, threadKey]);

    // Send the unanswered turn again. Its learner turn is not stored twice
    // when the first attempt got as far as storing it.
    const retry = useCallback(async () => {
        const pending = failureRef.current;
        if (!pending || pending.key !== threadKey) return null;
        return run(async () => {
            const row = { ...pending.row, failed: false };
            replaceRow(pending.row, row);
            setFailure(null);
            return dispatch(row, { storeLearnerTurn: !pending.learnerTurnStored });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replaceRow/dispatch close over threadKey only
    }, [agent, sessionId, activeCase, caseLanguage, threadKey]);

    return { messages, loaded, sending, failure, send, retry };
}
