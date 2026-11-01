// One writer for agent_conversations rows.
//
// A conversation turn is stored by two routes: the learner's own turn by
// POST /sessions/:id/agents/:type/conversation, and the AGENT's turn by
// POST /proxy/llm, from the reply it just produced. The agent's reply used to
// be written by the browser in a second request, which the server could only
// accept by matching it against an in-memory ledger of replies (L3-10). Any
// reply the browser had not got from the proxy itself — a stubbed proxy, a
// ledger cleared by a restart, the debrief discussant (never remembered) — was
// refused with 403 and the turn was lost (monkey walk, 2026-11-01). The proxy
// now stores the reply as it answers; the browser only stores its own turn.

import dbAdapter from '../dbAdapter.js';

/** How a conversation message arrived (migration 0061). The column has no CHECK constraint, so this list is the enforcement. */
export const CONVERSATION_CHANNELS = Object.freeze(['chat', 'call']);
/** Client-generated call ids group the turns of one call; opaque, bounded. */
export const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Check a turn's optional `channel` / `call_id` tags.
 * @returns {{error: string, code: string}|null} null when both are absent or valid
 */
export function turnTagError(channel, callId) {
    if (channel !== undefined && channel !== null && !CONVERSATION_CHANNELS.includes(channel)) {
        return { error: `channel must be one of ${CONVERSATION_CHANNELS.join(', ')}`, code: 'invalid_channel' };
    }
    if (callId !== undefined && callId !== null && !(typeof callId === 'string' && CALL_ID_PATTERN.test(callId))) {
        return { error: 'call_id must be 1-64 characters of letters, digits, _ or -', code: 'invalid_call_id' };
    }
    return null;
}

/**
 * Store one conversation turn. Attribution (`case_agent_id`) is the case agent
 * of this type on the session's case, resolved here rather than taken from a
 * request body — same liveness rules as the proxy
 * (agentPersona.loadSessionCaseAgent): enabled, template not soft-deleted,
 * same tenant. NULL when the case has none (the platform discussant).
 *
 * The caller has already checked the session belongs to the requester and
 * that the tags are valid (turnTagError).
 *
 * @param {object} args
 * @param {number|string} args.sessionId
 * @param {number} args.tenant
 * @param {string} args.agentType
 * @param {'user'|'assistant'} args.role
 * @param {string} args.content
 * @param {'chat'|'call'|null} [args.channel] default 'chat'
 * @param {string|null} [args.callId]
 * @returns {Promise<number>} the new row's id
 */
export async function recordConversationTurn({ sessionId, tenant, agentType, role, content, channel = null, callId = null }) {
    const caseAgentRow = await dbAdapter.get(
        `SELECT ca.id FROM case_agents ca
           JOIN agent_templates at
             ON at.id = ca.agent_template_id AND at.tenant_id = ca.tenant_id
            AND at.deleted_at IS NULL
           JOIN sessions s
             ON s.case_id = ca.case_id AND s.tenant_id = ca.tenant_id
          WHERE s.id = ? AND ca.tenant_id = ? AND at.agent_type = ? AND ca.enabled = 1
          ORDER BY ca.id ASC LIMIT 1`,
        [sessionId, tenant, agentType]
    );
    const result = await dbAdapter.run(
        `INSERT INTO agent_conversations (session_id, tenant_id, agent_type, role, content, channel, call_id, case_agent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, tenant, agentType, role, content, channel || 'chat', callId ?? null, caseAgentRow?.id ?? null]
    );
    return result.lastID;
}

/**
 * Put the call tags an older client sent with its echo of the agent's reply on
 * the row the proxy stored (a tab loaded before the proxy stored replies sends
 * the tags only on that echo). Only the tags change; the content was the
 * agent's own.
 */
export async function tagConversationTurn({ turnId, sessionId, tenant, channel = null, callId = null }) {
    if (!channel && !callId) return;
    await dbAdapter.run(
        `UPDATE agent_conversations SET channel = COALESCE(?, channel), call_id = COALESCE(?, call_id)
          WHERE id = ? AND session_id = ? AND tenant_id = ?`,
        [channel || null, callId ?? null, turnId, sessionId, tenant]
    );
}
