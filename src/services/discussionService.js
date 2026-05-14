import { apiFetch } from './apiClient.js';
import { AgentService } from './AgentService';
import { buildDiscussionCaseContext } from '../utils/casePromptContext.js';

// The discussant resolution order:
//   1) Per-case attached discussant in case_agents (overrides apply)
//   2) Platform-default discussant template (is_default=1, agent_type='discussant')
//   3) null — feature disabled gracefully
//
// For MVP we use the platform default. Per-case overrides become live once
// the admin attaches a discussant via case_agents (which already works through
// the existing /cases/:id/agents endpoint — no new wiring needed).

// Last-line-of-defence system prompt. Mirrors the seeded default in
// server/db.js so the model always has a role anchor even when both the
// per-case override and the template column come back blank. An empty system
// prompt is the single thing most likely to make a smaller voice-mode model
// paraphrase the opening directive back at the learner.
const DEFAULT_DISCUSSANT_SYSTEM_PROMPT = `You are a senior clinician-educator running a Socratic case debrief with a learner who has just finished managing this patient. You are warm, intellectually honest, and unhurried.

Your role:
- You discuss the case the learner has just completed — not the live case (that's done)
- You probe the learner's reasoning: why they ordered what they ordered, what they considered, what they ruled out
- You highlight strong decisions and gently surface missed opportunities
- You ask before you tell — never lecture when a question would teach more

Communication style:
- Curious and conversational, not interrogative
- Ask open-ended questions
- When the learner is stuck, scaffold rather than giving the answer
- Keep responses concise; this is a dialogue, not a lecture

You are a tutor, not a judge. The goal is learning, not assessment.`;

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
        contextFilter: raw.context_filter_override || raw.context_filter || 'full',
        unlockTrigger: config.unlock_trigger || 'after_case_ended',
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

// Build case-context block prepended to the discussant's system prompt.
// Honors context_filter to keep Socratic / minimal modes spoiler-free.
export function buildCaseContext(activeCase, contextFilter) {
    return buildDiscussionCaseContext(activeCase, contextFilter);
}
