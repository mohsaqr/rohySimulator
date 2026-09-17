// On-call specialists: the specialty registry.
//
// The single source of truth for which agent types are on-call specialists,
// which case material each one may read, and how willing each one is by
// default to discuss findings with the learner. Lives under server/shared/
// for the same reason as languages.js and llmCatalogue.js: the Docker runtime
// stage copies server/ but not src/, and the client (case editor, agent
// editor) needs the same list. No node-only imports here.
//
// Each specialty is its own agent_type. Everything runtime-side
// (agent_session_state UNIQUE(session_id, agent_type), agent_conversations,
// the chat tabs) is keyed by agent_type, so one specialist per specialty per
// case falls out of that keying; POST /cases/:caseId/agents enforces it.
//
// CONTRACT — adding a specialty is exactly two changes:
//   1. one entry in SPECIALTIES below (agentType, domain, pluginIds, …), and
//   2. one seeded default template for that agent_type in server/db.js
//      DEFAULT_AGENTS (its config.disclosure comes from defaultDisclosure
//      here, never a copy).
// Plus the editor label keys `type_<agentType>_label` / `_desc` in
// src/locales/en/authoring_persona.json. Nothing else may hardcode the list:
// import SPECIALIST_TYPES / isSpecialistType instead.

// When the specialist will discuss the findings in its brief:
//   after_effort — only once the learner has shown effort (turns, room
//                  activity, their own interpretation; see thresholds below)
//   on_request   — whenever the learner asks
//   never        — teaches how to look, never confirms findings
export const DISCLOSURE_MODES = Object.freeze(['after_effort', 'on_request', 'never']);

const DEFAULT_DISCLOSURE = Object.freeze({
    findings: 'after_effort',
    minStudentTurns: 3,
    requireRoomActivity: true,
    requireInterpretation: true,
});

// Field -> kind. Drives normalizeDisclosure; a field not listed here is
// rejected, so a typo in a case config surfaces instead of being ignored.
const DISCLOSURE_FIELDS = Object.freeze({
    findings: 'mode',
    minStudentTurns: 'count',
    requireRoomActivity: 'boolean',
    requireInterpretation: 'boolean',
});

export const SPECIALTIES = Object.freeze({
    pathologist: Object.freeze({
        agentType: 'pathologist',
        domain: 'pathology',
        pluginIds: Object.freeze(['pathology']),
        legacyRadiology: false,
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
    cardiologist: Object.freeze({
        agentType: 'cardiologist',
        domain: 'ecg',
        pluginIds: Object.freeze(['ecg']),
        legacyRadiology: false,
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
    radiologist: Object.freeze({
        agentType: 'radiologist',
        domain: 'radiology',
        pluginIds: Object.freeze(['pacs']),
        // Also reads the pre-plugin case config.radiology block.
        legacyRadiology: true,
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
});

export const SPECIALIST_TYPES = Object.freeze(Object.keys(SPECIALTIES));

export function isSpecialistType(agentType) {
    return typeof agentType === 'string' && Object.hasOwn(SPECIALTIES, agentType);
}

export function specialtyFor(agentType) {
    return isSpecialistType(agentType) ? SPECIALTIES[agentType] : null;
}

// Merge a partial per-case disclosure config over the default and validate it.
// Returns { value, errors }: `value` is the merged config with every valid
// field applied (invalid fields keep the default), `errors` lists one message
// per rejected field. Callers that persist the config must refuse it when
// errors is non-empty; they must not store `value` silently.
export function normalizeDisclosure(config) {
    const value = { ...DEFAULT_DISCLOSURE };
    const errors = [];
    if (config === undefined || config === null) {
        return { value, errors };
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
        errors.push('disclosure must be an object');
        return { value, errors };
    }
    for (const [key, raw] of Object.entries(config)) {
        const kind = DISCLOSURE_FIELDS[key];
        if (!kind) {
            errors.push(`unknown disclosure field: ${key}`);
        } else if (kind === 'mode' && !DISCLOSURE_MODES.includes(raw)) {
            errors.push(`${key} must be one of ${DISCLOSURE_MODES.join(', ')}`);
        } else if (kind === 'count' && !(Number.isInteger(raw) && raw >= 0)) {
            errors.push(`${key} must be an integer >= 0`);
        } else if (kind === 'boolean' && typeof raw !== 'boolean') {
            errors.push(`${key} must be a boolean`);
        } else {
            value[key] = raw;
        }
    }
    return { value, errors };
}
