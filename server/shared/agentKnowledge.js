// What an agent knows about the case: the knowledge axis.
//
// Every persona in a case — the bedside nurse, the on-call consultant, the
// family member, the debrief tutor, the on-call specialists — is given some
// slice of the case document before it speaks. Until this module that slice
// was decided by four unrelated mechanisms, three of which did not work:
//
//   agent_templates.context_filter   a four-value ladder, wired for four
//                                    types, dead for the patient and for
//                                    every specialist, and whose per-case
//                                    override was stored but never read
//   context_filter_override          read in two places, in no migration
//   memory_access                    reached no runtime object, and its one
//                                    consumer called a method defined nowhere
//   config.disclosure                the one that worked — specialists only
//
// THE DEFECT THIS EXISTS TO FIX. `context_filter: 'full'` was the only value
// that included configured results, and it ALSO emitted the answer key:
// expected diagnosis, expected treatment plan, learning objectives
// (casePromptContext.js, "### Authoring Expectations"). There was no rung for
// "knows the chart but not the answer", so the seeded consultant was handed
// the diagnosis it was meant to coach the learner towards.
//
// Lives under server/shared/ for the same reason as specialties.js: the
// Docker runtime stage copies server/ but not src/, and the case editor needs
// the same list. No node-only imports here.
//
// CONTRACT. A scope is what the agent is GIVEN, not what it is allowed to
// say. `answerKey` and `record` are separate booleans because they are
// separate questions — an agent can legitimately know the whole chart and not
// the answer, or know nothing and still be told what the learner did.
// Everything that decides an agent's knowledge reads this module; nothing
// else may hardcode a scope name.

/**
 * What the agent is given, in ascending order. The order is meaningful:
 * SCOPE_RANK compares them, so a new scope must be inserted at the right
 * place rather than appended.
 *
 *   none      nothing at all. A server-built block says so in as many words,
 *             and the learner must present the case themselves.
 *   handover  who the patient is, one line on why they presented, the live
 *             vitals, and what has been done this session — a shift handover.
 *             Server-built (services/situationBrief.js).
 *   summary   the case summary, the chief complaint and the initial vitals.
 *   history   the structured history and the clinical records.
 *   chart     everything the chart holds: configured vitals, physical exam,
 *             radiology and laboratory results.
 *
 * `none` and `handover` are SERVER-BUILT: the route drops whatever situation
 * the browser sent and assembles the block itself, so a tampered client
 * cannot widen what the agent knows. `summary`/`history`/`chart` are still
 * assembled client-side, exactly as before.
 */
export const KNOWLEDGE_SCOPES = Object.freeze(['none', 'handover', 'summary', 'history', 'chart']);

const SCOPE_RANK = Object.freeze(
    KNOWLEDGE_SCOPES.reduce((acc, scope, index) => ({ ...acc, [scope]: index }), {})
);

// Field -> kind. Drives normalizeKnowledge; a field not listed here is
// rejected, so a typo in a case config surfaces instead of being ignored.
// Same discipline as DISCLOSURE_FIELDS in specialties.js, and for the same
// reason: a stored setting that never fires is worse than no setting.
const KNOWLEDGE_FIELDS = Object.freeze({
    scope: 'scope',
    answerKey: 'boolean',
    record: 'boolean',
});

/**
 * The knowledge a type is given when nothing overrides it.
 *
 * `answerKey` is false for every type. The debrief tutor is the only persona
 * with a defensible claim to the expected diagnosis, and it is also the one
 * persona that can simply be told it by the learner; an educator who wants it
 * ticks the box. No persona ships holding the answer.
 *
 * `record` is the server-rendered encounter record (services/encounterRecord.js).
 * It stays false for the relative and the specialists, who have no business
 * knowing what was ordered in another room, and for anything unlisted.
 */
const KNOWLEDGE_BY_TYPE = Object.freeze({
    // Keeps the chart — a bedside nurse who cannot see the record is not a
    // nurse. Loses the answer key. `handover` is the "just took shift" option.
    nurse: Object.freeze({ scope: 'chart', answerKey: false, record: true }),
    // Keeps the chart by decision; `none` (the learner presents the case to
    // the person they paged) is one setting away and is the pedagogical point
    // of the whole axis.
    consultant: Object.freeze({ scope: 'chart', answerKey: false, record: true }),
    // A family member knows the story, not the workup.
    relative: Object.freeze({ scope: 'history', answerKey: false, record: false }),
    // A brief summary; the learner presents what happened. The record stays
    // on, because it is the one account of the encounter the learner cannot
    // quietly edit by forgetting.
    discussant: Object.freeze({ scope: 'summary', answerKey: false, record: true }),
    // Not seeded, but named in encounterRecord.js RECORD_AGENT_TYPES. Listed
    // so that gating the record on `knowledge.record` does not silently take
    // it away from a type the allowlist already granted it to.
    pharmacist: Object.freeze({ scope: 'chart', answerKey: false, record: true }),
    technician: Object.freeze({ scope: 'chart', answerKey: false, record: true }),
    // The specialists: `none` IS what they already did — the route drops the
    // client situation and services/specialistBrief.js builds a findings-only
    // brief. config.disclosure remains their findings sub-gate.
    pathologist: Object.freeze({ scope: 'none', answerKey: false, record: false }),
    cardiologist: Object.freeze({ scope: 'none', answerKey: false, record: false }),
    radiologist: Object.freeze({ scope: 'none', answerKey: false, record: false }),
    laboratorian: Object.freeze({ scope: 'none', answerKey: false, record: false }),
});

/**
 * Every agent type with an explicit shipped knowledge default.
 *
 * The seeder backfills `config.knowledge` for exactly these. The `patient` is
 * deliberately absent: its prompt is built by a different path that never
 * consults this module, so writing a scope onto it would be a setting that
 * looks live and is not.
 */
export const KNOWLEDGE_TYPES = Object.freeze(Object.keys(KNOWLEDGE_BY_TYPE));

// An agent type with no entry above. Deliberately the most private reading:
// a type added later knows nothing until somebody decides otherwise, which is
// the safe direction for a mistake. (The `patient` is not listed because its
// prompt is built by a different path entirely — ChatInterface's
// buildPatientCaseDesignContext — which never consults this module.)
const FALLBACK_KNOWLEDGE = Object.freeze({ scope: 'none', answerKey: false, record: false });

/**
 * The shipped knowledge for an agent type.
 *
 * @param {string|null|undefined} agentType
 * @returns {{scope: string, answerKey: boolean, record: boolean}} frozen
 */
export function defaultKnowledgeFor(agentType) {
    if (typeof agentType === 'string' && Object.hasOwn(KNOWLEDGE_BY_TYPE, agentType)) {
        return KNOWLEDGE_BY_TYPE[agentType];
    }
    return FALLBACK_KNOWLEDGE;
}

/**
 * The legacy `agent_templates.context_filter` ladder, mapped onto scopes.
 *
 * These four mappings are exact, not approximate: each one reproduces the
 * sections the old value emitted (see buildDiscussionCaseContext). `full`
 * additionally implied the answer key, which is the whole reason this axis
 * exists — so it maps to `chart` AND turns answerKey on, preserving the
 * behaviour of an agent nobody has migrated.
 */
export const LEGACY_SCOPE_BY_CONTEXT_FILTER = Object.freeze({
    minimal: 'none',
    vitals: 'summary',
    history: 'history',
    full: 'chart',
});

/**
 * Is this scope at least as wide as `floor`?
 *
 * @param {string} scope
 * @param {string} floor  a KNOWLEDGE_SCOPES value
 * @returns {boolean} false for an unknown scope — unknown reads as narrow.
 */
export function scopeAtLeast(scope, floor) {
    const rank = SCOPE_RANK[scope];
    const min = SCOPE_RANK[floor];
    if (rank === undefined || min === undefined) return false;
    return rank >= min;
}

/**
 * Does the SERVER build this agent's situation block?
 *
 * True for `none` and `handover`, where the route drops the client's text and
 * assembles the block itself. The distinction matters for trust, not taste: a
 * learner's browser must not get to decide that the colleague it is briefing
 * already knows everything.
 *
 * @param {string} scope
 * @returns {boolean}
 */
export function serverBuildsSituation(scope) {
    return scope === 'none' || scope === 'handover';
}

/**
 * Resolve and validate an agent's knowledge.
 *
 * Resolution order, widest-losing-to-most-specific:
 *   1. the type's shipped default (defaultKnowledgeFor)
 *   2. the legacy `context_filter` column, when the agent carries no
 *      `config.knowledge` — so an agent nobody has migrated keeps the
 *      behaviour it had
 *   3. `config.knowledge`, field by field; an invalid field keeps the value
 *      from 1/2 and adds an error
 *
 * Returns `{ value, errors }`. Callers that PERSIST the config must refuse it
 * when `errors` is non-empty and must not store `value` silently — the same
 * contract as normalizeDisclosure. Callers that merely READ (the LLM proxy)
 * log the errors and proceed on `value`, because a template config is not
 * validated on write and a bad field must cost a setting, not a reply.
 *
 * @param {object} args
 * @param {object} [args.knowledge]      the stored config.knowledge
 * @param {string} [args.agentType]
 * @param {string} [args.contextFilter]  the legacy column, read only at step 2
 * @returns {{value: {scope: string, answerKey: boolean, record: boolean}, errors: string[]}}
 */
export function normalizeKnowledge({ knowledge, agentType, contextFilter } = {}) {
    const value = { ...defaultKnowledgeFor(agentType) };
    const errors = [];

    const absent = knowledge === undefined || knowledge === null;
    if (absent) {
        const legacy = LEGACY_SCOPE_BY_CONTEXT_FILTER[contextFilter];
        if (legacy) {
            value.scope = legacy;
            // `full` was the rung that carried the answer key. Preserve that
            // for an unmigrated agent rather than silently narrowing it.
            value.answerKey = contextFilter === 'full';
        }
        return { value, errors };
    }

    if (typeof knowledge !== 'object' || Array.isArray(knowledge)) {
        errors.push('knowledge must be an object');
        return { value, errors };
    }

    for (const [key, raw] of Object.entries(knowledge)) {
        const kind = KNOWLEDGE_FIELDS[key];
        if (!kind) {
            errors.push(`unknown knowledge field: ${key}`);
        } else if (kind === 'scope' && !KNOWLEDGE_SCOPES.includes(raw)) {
            errors.push(`${key} must be one of ${KNOWLEDGE_SCOPES.join(', ')}`);
        } else if (kind === 'boolean' && typeof raw !== 'boolean') {
            errors.push(`${key} must be a boolean`);
        } else {
            value[key] = raw;
        }
    }
    return { value, errors };
}
