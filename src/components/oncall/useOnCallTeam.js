// The session's on-call specialists and their live paging state.
//
// The server owns the wait: POST /sessions/:id/agents/:type/page answers
// either `present` (instant, the default) or `paged` with `arrives_at`. We
// copy that in, tick once a second while anyone is on the way, and re-read
// the agent list once an ETA passes — the server flips paged → present on
// read. Same contract as ChatInterface.handlePageAgent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentService } from '../../services/AgentService';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { specialistsOf } from './onCallModel';

// The EventLogger component vocabulary lives in server/shared; the phone logs
// under the chat interface's name until it has its own entry there.
const LOG_COMPONENT = COMPONENTS.CHAT_INTERFACE;
const EMPTY = Object.freeze([]);

export function useOnCallTeam(sessionId) {
    // Stored with the session they were read for, so a new session never
    // shows the previous one's contacts while its own list loads.
    const [store, setStore] = useState({ sessionId: null, specialists: [] });
    const loaded = Boolean(sessionId) && store.sessionId === sessionId;
    const specialists = loaded ? store.specialists : EMPTY;
    const [now, setNow] = useState(() => Date.now());
    const refreshingRef = useRef(false);

    const setSpecialists = useCallback((update) => {
        setStore(prev => ({ sessionId: prev.sessionId, specialists: update(prev.specialists) }));
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (!sessionId) return undefined;
        AgentService.getSessionAgents(sessionId).then((agents) => {
            if (cancelled) return;
            setStore({ sessionId, specialists: specialistsOf(agents) });
        });
        return () => { cancelled = true; };
    }, [sessionId]);

    const anyPaged = specialists.some(a => a.status === 'paged' && a.arrives_at);
    useEffect(() => {
        if (!anyPaged) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [anyPaged]);

    // Converge once an ETA has passed. The merge is by agent_type, so a
    // refresh that comes back empty (the service logs and returns [] on a
    // failed read) never wipes the contacts the learner is looking at.
    useEffect(() => {
        if (!sessionId || refreshingRef.current) return;
        const due = specialists.filter(a => a.status === 'paged' && a.arrives_at
            && new Date(a.arrives_at).getTime() <= now);
        if (due.length === 0) return;
        refreshingRef.current = true;
        AgentService.getSessionAgents(sessionId).then((fresh) => {
            const byType = new Map(specialistsOf(fresh).map(a => [a.agent_type, a]));
            due.forEach((a) => {
                const next = byType.get(a.agent_type);
                if (next?.status === 'present') {
                    const waitMs = next.paged_at && next.arrived_at
                        ? Math.max(0, new Date(next.arrived_at) - new Date(next.paged_at))
                        : null;
                    EventLogger.agentArrived(a.agent_type, a.name || a.agent_type, LOG_COMPONENT, { wait_ms: waitMs });
                }
            });
            setSpecialists(prev => prev.map(a => byType.get(a.agent_type) || a));
        }).finally(() => {
            refreshingRef.current = false;
        });
    }, [now, specialists, sessionId, setSpecialists]);

    // Page a specialist. Resolves to the status the server returned
    // ('present' or 'paged'); rejects when the page call fails.
    const page = useCallback(async (agent) => {
        const result = await AgentService.pageAgent(sessionId, agent.agent_type);
        const arrivesAt = result?.arrives_at || null;
        const status = result?.status || (arrivesAt ? 'paged' : 'present');
        const pagedAt = new Date().toISOString();
        EventLogger.agentPaged(agent.agent_type, agent.name || agent.agent_type, LOG_COMPONENT, {
            status, arrives_at: arrivesAt, delayed: Boolean(arrivesAt),
        });
        if (status === 'present') {
            EventLogger.agentArrived(agent.agent_type, agent.name || agent.agent_type, LOG_COMPONENT, { wait_ms: 0 });
        }
        setSpecialists(prev => prev.map(a => (a.agent_type === agent.agent_type
            ? {
                ...a,
                status,
                paged_at: pagedAt,
                arrives_at: arrivesAt,
                arrived_at: status === 'present' ? pagedAt : null,
            }
            : a)));
        setNow(Date.now());
        return status;
    }, [sessionId, setSpecialists]);

    return { specialists, loaded, now, page };
}
