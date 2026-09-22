// On-call specialists: the specialty registry.
//
// The single source of truth for which agent types are on-call specialists,
// which case material each one may read, which rooms each one owns, and how
// willing each one is by default to discuss findings with the learner. Lives
// under server/shared/ for the same reason as languages.js and
// llmCatalogue.js: the Docker runtime stage copies server/ but not src/, and
// the client (case editor, agent editor, the on-call phone) needs the same
// list. No node-only imports here.
//
// WHAT A SPECIALIST IS. Not a consultant. Each one is the person who READ ONE
// ROOM'S MATERIAL — the ECG, the slides, the images, the analyser run — and
// knows nothing else about the patient. They explain what the material shows
// and teach how to look at it. They never name a diagnosis, and they never
// discuss the patient's symptoms, history or story, because they were never
// told any of it: services/specialistBrief.js builds their brief out of
// findings alone.
//
// Each specialty is its own agent_type. Everything runtime-side
// (agent_session_state UNIQUE(session_id, agent_type), agent_conversations,
// the chat tabs) is keyed by agent_type, so one specialist per specialty per
// case falls out of that keying; POST /cases/:caseId/agents enforces it.
//
// CONTRACT — adding a specialty is exactly two changes:
//   1. one entry in SPECIALTIES below (agentType, standing, domain,
//      pluginIds, rooms, defaultDisclosure), and
//   2. one seeded default template for that agent_type in server/db.js
//      DEFAULT_AGENTS (its config.disclosure comes from defaultDisclosure
//      here, never a copy).
// Plus a findings extractor for its `domain` in services/specialistBrief.js,
// the editor label keys `type_<agentType>_label` / `_desc` in
// src/locales/en/authoring_persona.json, and the phone's `specialty_<type>`
// key in src/locales/en/oncall.json. Nothing else may hardcode the list:
// import SPECIALIST_TYPES / isSpecialistType instead.

// When the specialist will discuss the findings in its brief:
//   after_effort — only once the learner has shown effort (turns in this
//                  conversation, and optionally activity in the specialty's
//                  own room; see requireRoomActivity below)
//   on_request   — whenever the learner asks
//   never        — teaches how to look, never confirms findings
export const DISCLOSURE_MODES = Object.freeze(['after_effort', 'on_request', 'never']);

const DEFAULT_DISCLOSURE = Object.freeze({
    findings: 'after_effort',
    minStudentTurns: 3,
    requireRoomActivity: true,
});

// Field -> kind. Drives normalizeDisclosure; a field not listed here is
// rejected, so a typo in a case config surfaces instead of being ignored.
//
// `requireInterpretation` was a fourth field until it was removed: deciding
// whether a free-text turn contains the learner's own interpretation is not
// something the server can check, and a stored setting that never fires is
// worse than no setting. Stored overrides that still carry it are refused by
// normalizeDisclosure with `unknown disclosure field`, which is the visible
// failure the silent version never gave.
const DISCLOSURE_FIELDS = Object.freeze({
    findings: 'mode',
    minStudentTurns: 'count',
    requireRoomActivity: 'boolean',
});

export const SPECIALTIES = Object.freeze({
    pathologist: Object.freeze({
        agentType: 'pathologist',
        standing: false,
        domain: 'pathology',
        // Plugin rooms this specialty owns (a plugin room's key IS its
        // plugin id — RoomNavigator builds them from the manifests).
        pluginIds: Object.freeze(['pathology']),
        // Core (non-plugin) room keys this specialty owns; see App.jsx
        // ROOM_KEYS.
        rooms: Object.freeze([]),
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
    cardiologist: Object.freeze({
        agentType: 'cardiologist',
        standing: false,
        domain: 'ecg',
        pluginIds: Object.freeze(['ecg']),
        rooms: Object.freeze([]),
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
    radiologist: Object.freeze({
        agentType: 'radiologist',
        standing: true,
        domain: 'radiology',
        pluginIds: Object.freeze(['pacs']),
        // The pre-plugin radiology room, whose case material is the
        // top-level config.radiology block.
        rooms: Object.freeze(['radiology']),
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
    laboratorian: Object.freeze({
        agentType: 'laboratorian',
        standing: true,
        domain: 'laboratory',
        // The lab has no plugin: it is the core `lab` room
        // (InvestigationsScreen), and its material is config.investigations.
        pluginIds: Object.freeze([]),
        rooms: Object.freeze(['lab']),
        defaultDisclosure: DEFAULT_DISCLOSURE,
    }),
});

export const SPECIALIST_TYPES = Object.freeze(Object.keys(SPECIALTIES));

// STANDING specialists are on every case: whatever the case holds, a learner
// can always ring the lab and radiology from the phone. Every case has a lab
// room and a radiology room, so there is always something to ask them about;
// when the case configured no material, the brief says so and they answer
// that honestly (specialistBrief BRIEF_NO_FINDINGS). The others are attached
// by an educator, because they only make sense on a case with slides or an
// ECG to discuss.
//
// services/standingSpecialists.js attaches them — when a case is created, and
// in a boot sweep for every existing case. Because the sweep re-attaches a
// missing one, a standing specialist cannot be REMOVED from a case (DELETE
// answers 409 standing_specialist); an educator who does not want it
// disables it instead, which the sweep leaves alone.
export const STANDING_SPECIALIST_TYPES = Object.freeze(
    SPECIALIST_TYPES.filter((type) => SPECIALTIES[type].standing === true),
);

export function isStandingSpecialistType(agentType) {
    return STANDING_SPECIALIST_TYPES.includes(agentType);
}

export function isSpecialistType(agentType) {
    return typeof agentType === 'string' && Object.hasOwn(SPECIALTIES, agentType);
}

export function specialtyFor(agentType) {
    return isSpecialistType(agentType) ? SPECIALTIES[agentType] : null;
}

/**
 * Every room key a specialty owns — plugin rooms and core rooms together.
 *
 * Used both to open the phone on the right person (the learner rang from that
 * room) and to answer `requireRoomActivity` (did the learner do anything in
 * the room whose material this specialist read).
 *
 * @param {object|string} specialtyOrType  a SPECIALTIES entry or an agentType
 * @returns {string[]} room keys; [] for anything that is not a specialty
 */
export function roomKeysOf(specialtyOrType) {
    const specialty = typeof specialtyOrType === 'string'
        ? specialtyFor(specialtyOrType)
        : specialtyOrType;
    if (!specialty) return [];
    return [...(specialty.pluginIds || []), ...(specialty.rooms || [])];
}

/**
 * The specialty that owns a room, so the phone opens on the right person and
 * the room-activity gate knows where to look.
 *
 * @param {string|null} room  a room key (core room or plugin id)
 * @returns {string|null} agentType, or null when nobody owns the room
 */
export function specialtyTypeForRoom(room) {
    if (!room) return null;
    const found = Object.values(SPECIALTIES).find((s) => roomKeysOf(s).includes(room));
    return found ? found.agentType : null;
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
