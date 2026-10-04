import { apiFetch } from './apiClient.js';
import { AgentService } from './AgentService';
import { normalizeKnowledge } from '../../server/shared/agentKnowledge.js';
import { DEFAULT_DISCUSSANT_SYSTEM_PROMPT } from '../../server/shared/discussantPrompt.js';

// The discussant resolution order:
//   1) Per-case attached discussant in case_agents (overrides apply)
//   2) Platform-default discussant template (is_default=1, agent_type='discussant')
//   3) null — feature disabled gracefully
//
// For MVP we use the platform default. Per-case overrides become live once
// the admin attaches a discussant via case_agents (which already works through
// the existing /cases/:id/agents endpoint — no new wiring needed).

// Last-line-of-defence persona text: canonical in server/shared/discussantPrompt.js (imported above).

export async function fetchDiscussantForCase(caseId) {
    if (caseId) {
        try {
            const data = await apiFetch(`/cases/${caseId}/agents`);
            const attached = (data?.agents || []).find(a => a.agent_type === 'discussant' && a.enabled !== 0);
            if (attached) return normalizeAgent(attached, caseId);
        } catch (err) {
            console.warn('[discussionService] failed to load case agents:', err.message);
        }
    }
    const templates = await AgentService.getTemplates();
    const fallback =
        templates.find(t => t.agent_type === 'discussant' && t.is_default) ||
        templates.find(t => t.agent_type === 'discussant');
    return fallback ? normalizeAgent(fallback, caseId) : null;
}

// `_caseId` stamps the resolved discussant with the case it was resolved for.
// Callers (useDiscussionEngine.sendMessage) MUST verify the stamp matches the
// current activeCase.id before assembling a prompt — otherwise a stale
// discussant from the previous case can be sent with the new case's context,
// producing the cross-case role bleed audited 2026-05-14.
function normalizeAgent(raw, caseId = null) {
    const config = parseConfig(raw.config) || parseConfig(raw.config_override) || {};
    // Admin UI stores agent gender at config.gender (top-level); voice settings
    // may also carry their own gender override at config.voice.gender. Surface
    // both so downstream voice resolution can pick the right slot.
    const gender = config.voice?.gender || config.gender || null;
    return {
        id: raw.id,
        templateId: raw.agent_template_id || raw.id,
        name: raw.name_override || raw.name || 'Discussant',
        roleTitle: raw.role_title || 'Case Debrief Tutor',
        avatarUrl: raw.avatar_url || null,
        systemPrompt: (raw.system_prompt_override || raw.system_prompt || '').trim() || DEFAULT_DISCUSSANT_SYSTEM_PROMPT,
        // How much of the case the tutor is given. `context_filter_override`
        // was read here for a column that exists in no migration — always
        // undefined, and its unit test passed by hand-feeding a fake row. The
        // real per-case control is config.knowledge, which normalizeKnowledge
        // resolves over the type default and the legacy context_filter column.
        knowledge: normalizeKnowledge({
            knowledge: config.knowledge,
            agentType: raw.agent_type || 'discussant',
            contextFilter: raw.context_filter,
        }).value,
        unlockTrigger: config.unlock_trigger || 'after_case_ended',
        // Per-case educator opt-in: show the learner their own encounter
        // record during debrief. Default OFF — during the case the same view
        // would be a checklist that does the remembering for them, and even at
        // debrief an educator may want the learner to reconstruct it unaided
        // first. `=== true` so a missing/garbage value is off, not truthy.
        showEncounterRecord: config.show_encounter_record === true,
        gender,
        voice: config.voice ? { ...config.voice, gender: gender || config.voice.gender } : (gender ? { gender } : null),
        rawConfig: config,
        _caseId: caseId,
    };
}

function parseConfig(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
}
