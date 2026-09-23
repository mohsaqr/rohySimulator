// Per-case rooms: which rooms a case offers its learners.
//
// An educator can switch rooms off on a case — a case built around the
// history and the pathology slides needs no examination, lab, radiology or
// debrief room. A switched-off room is HIDDEN (no tab in the room bar, no way
// to navigate into it) and LOCKED (the server refuses its actions for a
// learner), so a learner's client is never what enforces it.
//
// Stored on the case as `config.rooms = { disabled: [roomKey, ...] }`. The list
// is of rooms turned OFF, deliberately: every case written before this setting
// existed, every seeded case, and every room a newly installed plugin adds are
// ON with nothing stored at all. The setting travels in the session's
// case_snapshot like the rest of the config, so a running session keeps the
// rooms it started with.
//
// The patient room (`chat`, the history) is always on: it is where a case is
// played, and where the learner lands when a room goes away.
//
// Imported by the client and the server (server/shared/ for the Docker reason
// given in specialties.js). No node-only imports here.

import { CORE_ROOM_KEYS } from './pluginRegistry.js';
import { PLUGIN_MANIFESTS } from './plugins/manifests.generated.js';
import { roomKeysOf } from './specialties.js';

/** Rooms that cannot be switched off. */
export const FIXED_ROOMS = Object.freeze(['chat']);

/** Every room an educator may switch off: the core rooms but the patient
 *  room, and every installed plugin room (a plugin room's key is its id). */
export const SWITCHABLE_ROOM_KEYS = Object.freeze([
    ...CORE_ROOM_KEYS.filter((key) => !FIXED_ROOMS.includes(key)),
    ...PLUGIN_MANIFESTS.map((m) => m.id),
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readConfig(config) {
    if (typeof config !== 'string') return isPlainObject(config) ? config : null;
    try {
        const parsed = JSON.parse(config);
        return isPlainObject(parsed) ? parsed : null;
    } catch {
        // An unreadable config switches nothing off; the case editor reports
        // the config itself.
        return null;
    }
}

/**
 * The rooms switched off on a case. Total: a missing, malformed or unreadable
 * setting switches nothing off, and a key that is not switchable (the patient
 * room, a plugin since uninstalled) is ignored.
 *
 * @param {object|string|null} config  the case config, parsed or as stored
 * @returns {string[]} switchable room keys, sorted
 */
export function disabledRooms(config) {
    const parsed = readConfig(config);
    const listed = parsed && isPlainObject(parsed.rooms) && Array.isArray(parsed.rooms.disabled)
        ? parsed.rooms.disabled
        : [];
    return [...new Set(listed.filter((key) => SWITCHABLE_ROOM_KEYS.includes(key)))].sort();
}

/**
 * Is this room on for the case? Always true for the patient room and for a
 * case that stores no setting.
 *
 * @param {object|string|null} config
 * @param {string} roomKey  a core room key or a plugin id
 * @returns {boolean}
 */
export function isRoomEnabled(config, roomKey) {
    return !disabledRooms(config).includes(roomKey);
}

/**
 * Does this specialist answer the phone on the case? A specialist is on the
 * phone whatever the rooms say (specialties.js decides that), but nobody
 * picks up for one whose rooms are ALL switched off: the radiologist answers
 * while Radiology or PACS is on. A non-specialist is not this rule's business.
 *
 * @param {string} agentType
 * @param {object|string|null} config
 * @returns {boolean}
 */
export function specialistAnswers(agentType, config) {
    const rooms = roomKeysOf(agentType);
    if (rooms.length === 0) return true;
    const off = disabledRooms(config);
    return rooms.some((key) => !off.includes(key));
}

/**
 * Validate `config.rooms` for storage.
 *
 * Refuses a shape it cannot read and an attempt to switch off a fixed room —
 * both are an editor bug, and storing them would silently mean "all on".
 * Drops, with a warning, a key that names no installed room: a case saved
 * while a plugin was installed must stay re-savable after it is removed.
 *
 * @param {object} config  the case config about to be stored (not mutated)
 * @returns {{ rooms: {disabled: string[]}|undefined, problem: string|null,
 *            warnings: Array<{field: string, received: string, hint: string}> }}
 *          `rooms` is the value to store (undefined when the config has none)
 */
export function normaliseCaseRooms(config) {
    const raw = isPlainObject(config) ? config.rooms : undefined;
    if (raw === undefined || raw === null) return { rooms: undefined, problem: null, warnings: [] };
    if (!isPlainObject(raw) || !Array.isArray(raw.disabled)
        || !raw.disabled.every((key) => typeof key === 'string')) {
        return { rooms: undefined, problem: 'rooms must be { disabled: [room key, ...] }', warnings: [] };
    }
    const unknownFields = Object.keys(raw).filter((field) => field !== 'disabled');
    if (unknownFields.length > 0) {
        return { rooms: undefined, problem: `unknown rooms field: ${unknownFields.join(', ')}`, warnings: [] };
    }
    const fixed = raw.disabled.filter((key) => FIXED_ROOMS.includes(key));
    if (fixed.length > 0) {
        return { rooms: undefined, problem: `the ${fixed[0]} room cannot be switched off`, warnings: [] };
    }
    const warnings = [...new Set(raw.disabled.filter((key) => !SWITCHABLE_ROOM_KEYS.includes(key)))]
        .map((key) => ({
            field: 'config.rooms.disabled',
            received: key,
            hint: `Not an installed room; dropped. Expected one of: ${SWITCHABLE_ROOM_KEYS.join(', ')}.`,
        }));
    return {
        rooms: { disabled: [...new Set(raw.disabled.filter((key) => SWITCHABLE_ROOM_KEYS.includes(key)))].sort() },
        problem: null,
        warnings,
    };
}
