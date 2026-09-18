// Server-built persona for team agents (nurse, consultant, relative, and the
// on-call specialists that follow).
//
// WHY THE SERVER BUILDS IT. The authored prompt of a team agent is where an
// educator writes what the agent knows and the learner does not: the
// consultant's coaching script, a specialist's findings. Until this module the
// browser assembled the whole prompt and posted it to /proxy/llm, so every
// learner's client had to be sent the prompt text by GET /sessions/:id/agents
// and GET /cases/:id/agents. The agent-template library had already been
// closed to learners (agents-routes.js, LEARNER_VISIBLE_AGENT_TYPES); the two
// per-case routes still served it.
//
// Now the client names the case agent (`agent_llm_config.case_agent_id`) and
// sends only the situation it can see — patient, vitals, team log. The server
// reads the authored prompt, checks the agent belongs to the case of the
// session the caller owns, and leads with the role anchor.
//
// Two agent types still assemble client-side and therefore still reach the
// learner: `patient` (its persona is glued to the case's own system_prompt in
// ChatInterface, which the browser already holds) and `discussant` (the
// debrief tutor, useDiscussionEngine). Moving those is its own change; this
// list is the single place that says so.

import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import { roleAnchor } from '../shared/roleAnchor.js';
import { buildPersonaBlocks } from '../shared/personaBlocks.js';

const personaLog = logger('agent-persona');

// A stored JSON object column, or {} with a warning. The config columns are
// written through validated routes, so a parse failure is a data defect worth
// seeing, not a reason to refuse the agent.
function parseConfigColumn(raw, column, caseAgentId) {
    if (raw === null || raw === undefined || raw === '') return {};
    try {
        const value = JSON.parse(raw);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        personaLog.warn('agent config column is not an object', { column, case_agent_id: caseAgentId });
    } catch (err) {
        personaLog.warn('agent config column json parse failed', { column, case_agent_id: caseAgentId, error: err.message });
    }
    return {};
}

/** Agent types whose prompt the learner's browser still assembles. */
export const CLIENT_BUILT_PROMPT_TYPES = Object.freeze(['patient', 'discussant']);

/**
 * May a learner's client be sent this agent type's authored prompt?
 *
 * An ALLOW list: an agent type added later is server-built, and private, by
 * default.
 *
 * @param {string|null|undefined} agentType
 * @returns {boolean}
 */
export function learnerMayHoldPrompt(agentType) {
    return CLIENT_BUILT_PROMPT_TYPES.includes(agentType);
}

/**
 * The system prompt for a team agent.
 *
 * Order, and why:
 *
 *   ## ROLE            the anchor: who you are, and never anyone else
 *   <authored prompt>  the educator's persona
 *   You should: …      config.dos / config.donts, the behavioural reminder
 *   <brief>            a specialist's server-built CASE BRIEF
 *   --- CURRENT SITUATION ---
 *   <situation>        client text
 *
 * The dos/donts follow the persona they qualify, and PRECEDE the brief so the
 * brief stays the last word on what may be disclosed — an educator cannot
 * write a "do" that argues with the disclosure gate and have it read last.
 *
 * `situation` is client text. It sits under its own header at the end, so it
 * adds context but cannot displace the persona. A specialist is passed none
 * (proxy-routes drops it: the browser builds it from the whole case).
 *
 * @param {object} agent
 * @param {string} agent.agentType
 * @param {string} [agent.roleTitle]
 * @param {string} [agent.name]
 * @param {string} [agent.prompt]   authored prompt (override or template)
 * @param {object} [agent.config]   merged template config + case override;
 *                                  read for `dos` / `donts` only
 * @param {string} [situation]      client-reported current situation
 * @param {string} [brief]          server-built block appended after the
 *                                  persona (the specialist CASE BRIEF)
 * @returns {string}
 */
export function buildAgentPersonaPrompt({ agentType, roleTitle, name, prompt, config }, situation = '', brief = '') {
    const parts = [
        roleAnchor({ role: roleTitle || agentType || 'team member', name }),
        typeof prompt === 'string' ? prompt : '',
    ];
    // Already self-delimiting: buildPersonaBlocks returns '\n\n…\n' or ''.
    const blocks = buildPersonaBlocks(config);
    if (blocks) parts.push(blocks);
    const briefText = typeof brief === 'string' ? brief.trim() : '';
    if (briefText) {
        parts.push('');
        parts.push(briefText);
    }
    const context = typeof situation === 'string' ? situation.trim() : '';
    if (context) {
        parts.push('');
        parts.push('--- CURRENT SITUATION ---');
        parts.push(context);
    }
    return parts.join('\n');
}

/**
 * One enabled case agent, resolved for a session.
 *
 * Returns null unless the agent is enabled, its template is live, and it is
 * attached to the case this session runs — all within the caller's tenant.
 * Session OWNERSHIP is the caller's check (verifySessionOwnership), made
 * before this is reached.
 *
 * @param {object} args
 * @param {number|string} args.sessionId
 * @param {number|string} args.caseAgentId
 * @param {number} args.tenant
 * @returns {Promise<object|null>} `{ caseAgentId, agentTemplateId, agentType,
 *   name, roleTitle, prompt, config, llm: { provider, model, apiKey, endpoint,
 *   temperature, maxTokens } }` — `config` is the template config with the
 *   case's config_override spread over it (shallow), exactly as
 *   GET /cases/:id/agents presents it.
 */
export async function loadSessionCaseAgent({ sessionId, caseAgentId, tenant }) {
    const row = await dbAdapter.get(
        `SELECT ca.id AS case_agent_id, ca.agent_template_id, ca.name_override,
                ca.system_prompt_override, ca.config_override,
                at.agent_type, at.name AS template_name, at.role_title,
                at.system_prompt AS template_system_prompt, at.config AS template_config,
                at.llm_provider, at.llm_model, at.llm_api_key, at.llm_endpoint,
                at.llm_temperature, at.llm_max_tokens
           FROM case_agents ca
           JOIN agent_templates at
             ON at.id = ca.agent_template_id AND at.tenant_id = ca.tenant_id
            AND at.deleted_at IS NULL
           JOIN sessions s
             ON s.case_id = ca.case_id AND s.tenant_id = ca.tenant_id
          WHERE ca.id = ? AND s.id = ? AND ca.tenant_id = ? AND ca.enabled = 1`,
        [caseAgentId, sessionId, tenant]
    );
    if (!row) return null;
    return {
        caseAgentId: row.case_agent_id,
        agentTemplateId: row.agent_template_id,
        agentType: row.agent_type,
        name: row.name_override || row.template_name,
        roleTitle: row.role_title,
        prompt: row.system_prompt_override || row.template_system_prompt || '',
        config: {
            ...parseConfigColumn(row.template_config, 'agent_templates.config', row.case_agent_id),
            ...parseConfigColumn(row.config_override, 'case_agents.config_override', row.case_agent_id),
        },
        llm: {
            provider: row.llm_provider,
            model: row.llm_model,
            apiKey: row.llm_api_key,
            endpoint: row.llm_endpoint,
            temperature: row.llm_temperature,
            maxTokens: row.llm_max_tokens,
        },
    };
}
