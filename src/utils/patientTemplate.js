// Which Patient persona template a session speaks and sounds like.
//
// EXTRACTED VERBATIM from ChatInterface's agents loader so the 3D room
// resolves the same template the chat room does. Before this, the room
// skipped the persona tier entirely and every unconfigured case fell
// through to the platform's language default voice — which is female, so a
// male patient answered in a woman's voice.
//
// The logic is unchanged; only its location is. Note in particular that the
// resolver is NOT symmetric by design: a female-coded case with only male
// templates seeded must fail loudly rather than pick the male one.

import { parseConfig } from './parseConfig';

function parseConfigSafe(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
}

/**
 * Normalise either a per-case attached agent row (from /cases/:id/agents) or
 * a raw template row (from /agents/templates) into a uniform shape. Per-case
 * rows carry name_override / system_prompt_override / config_override which
 * take precedence; raw templates supply the underlying defaults.
 *
 * @param {object|null} raw The agent or template row.
 * @param {string|number|null} caseId The case this was resolved for.
 * @return {object|null} Normalised template, or null for a missing row.
 */
export function normalizePatientAgent(raw, caseId = null) {
    if (!raw) return null;
    const config = parseConfigSafe(raw.config) || parseConfigSafe(raw.config_override) || {};
    return {
        templateId: raw.agent_template_id || raw.id,
        name: raw.name_override || raw.name || 'Patient',
        roleTitle: raw.role_title || 'Simulated Patient',
        avatarUrl: raw.avatar_url || null,
        systemPrompt: raw.system_prompt_override || raw.system_prompt || '',
        contextFilter: raw.context_filter_override || raw.context_filter || 'history',
        config,
        // Stamp the case this template was resolved for. The agents loader
        // is gated on `sessionId && activeCase`, so during a case switch
        // there is a window where sessionId is briefly null and the loader
        // is suspended; without this stamp, patientTemplate retains case
        // A's value while activeCase is already B and buildPatientSystemPrompt
        // happily glues B's persona to A's template prose. See the
        // _caseId guard in buildPatientSystemPrompt for the consumer side.
        _caseId: caseId,
    };
}

/**
 * Resolve the Patient template for a session.
 *
 * Prefers the per-case attached row; otherwise picks a platform-default
 * patient template by gender. Order tried:
 *   1. Exact match — first letter of case demographics.gender matches a
 *      template's config.voice.gender.
 *   2. For non-female cases (including empty gender, "Other", "Non-binary",
 *      anything that doesn't start with 'f'), the first NON-female template.
 *      This matches the seed doc that "Default Patient is used otherwise"
 *      and keeps the patient audible for cases that don't slot cleanly into
 *      male/female.
 *   3. Otherwise null. A female-coded case with only male templates seeded
 *      must NOT silently pick the male one — that's a real misconfig the
 *      admin needs to see, so we surface a loud error instead.
 *
 * @param {Array<object>} agentList Session agents (/sessions/:id/agents).
 * @param {object} activeCase The case in focus.
 * @param {() => Promise<Array<object>>} fetchTemplates Platform templates.
 * @return {Promise<object|null>} Normalised template, or null.
 */
export async function resolvePatientTemplate(agentList, activeCase, fetchTemplates) {
    const attachedPatient = (agentList || []).find(
        (a) => a.agent_type === 'patient' && a.enabled !== 0 && a.enabled !== false,
    );
    if (attachedPatient) {
        return normalizePatientAgent(attachedPatient, activeCase?.id ?? null);
    }
    try {
        const templates = await fetchTemplates();
        const patientDefaults = (templates || []).filter((t) =>
            t.agent_type === 'patient' && (t.is_default === 1 || t.is_default === true)
        );
        const caseGender = (activeCase?.config?.demographics?.gender || '').toLowerCase();
        const firstLetter = caseGender.charAt(0);
        const isFemaleCase = firstLetter === 'f';
        const templateGender = (t) =>
            (parseConfig(t.config)?.voice?.gender || '').toLowerCase();
        const exact = patientDefaults.find((t) =>
            firstLetter && templateGender(t).charAt(0) === firstLetter
        );
        const nonFemale = isFemaleCase
            ? null
            : patientDefaults.find((t) => templateGender(t).charAt(0) !== 'f');
        const fallback = exact || nonFemale || null;
        return fallback ? normalizePatientAgent(fallback, activeCase?.id ?? null) : null;
    } catch {
        return null;
    }
}
