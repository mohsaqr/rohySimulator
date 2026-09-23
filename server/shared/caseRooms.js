// Per-case rooms: which rooms a case offers its learners.
//
// An educator can switch rooms off on a case — a case built around the
// history and the pathology slides needs no examination, lab, radiology or
// debrief room. A switched-off room is HIDDEN (no tab in the room bar, no way
// to navigate into it) and LOCKED (the server refuses its actions for a
// learner), so a learner's client is never what enforces it.
//
// Stored on the case as `config.rooms = { disabled: [...], enabled: [...] }`.
// Most rooms are ON unless listed in `disabled`, deliberately: every case
// written before this setting existed, every seeded case, and every room a
// newly installed plugin adds are on with nothing stored at all. A few rooms
// are OFF unless listed in `enabled` (DEFAULT_OFF_ROOMS): today the bedside,
// which duplicates the examination room. The setting travels in the
// session's case_snapshot like the rest of the config, so a running session
// keeps the rooms it started with.
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

/** Rooms that are off unless a case switches them on (`rooms.enabled`). The
 *  bedside examines the patient too, so for now a case gets one examination
 *  room — the examination room — unless the educator asks for the bedside. */
export const DEFAULT_OFF_ROOMS = Object.freeze(['room3d']);

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

const listOf = (rooms, field) => (isPlainObject(rooms) && Array.isArray(rooms[field]) ? rooms[field] : []);

/**
 * The rooms switched off on a case: those listed in `rooms.disabled`, plus
 * every default-off room not listed in `rooms.enabled`. Total: a missing,
 * malformed or unreadable setting leaves only the default-off rooms off, and a
 * key that is not switchable (the patient room, a plugin since uninstalled) is
 * ignored.
 *
 * @param {object|string|null} config  the case config, parsed or as stored
 * @returns {string[]} switchable room keys, sorted
 */
export function disabledRooms(config) {
    const rooms = readConfig(config)?.rooms;
    const enabled = listOf(rooms, 'enabled');
    const off = [
        ...listOf(rooms, 'disabled'),
        ...DEFAULT_OFF_ROOMS.filter((key) => !enabled.includes(key)),
    ];
    return [...new Set(off.filter((key) => SWITCHABLE_ROOM_KEYS.includes(key)))].sort();
}

/**
 * The `rooms` value that switches one room on or off, from the current one.
 * Shared by every writer (the case editor) so the two lists stay consistent:
 * a default-off room is switched through `enabled`, any other through
 * `disabled`. Returns undefined when nothing differs from the defaults, so a
 * case back at its defaults stores no setting at all.
 *
 * @param {object|undefined} rooms  the current `config.rooms`
 * @param {string} roomKey
 * @param {boolean} on
 * @returns {{disabled?: string[], enabled?: string[]}|undefined}
 */
export function withRoom(rooms, roomKey, on) {
    const field = DEFAULT_OFF_ROOMS.includes(roomKey) ? 'enabled' : 'disabled';
    const add = field === 'enabled' ? on : !on;
    const current = listOf(rooms, field).filter((key) => key !== roomKey);
    const next = { disabled: listOf(rooms, 'disabled'), enabled: listOf(rooms, 'enabled') };
    next[field] = add ? [...current, roomKey].sort() : current;
    const out = Object.fromEntries(Object.entries(next).filter(([, list]) => list.length > 0));
    return Object.keys(out).length > 0 ? out : undefined;
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
 * @returns {{ rooms: {disabled?: string[], enabled?: string[]}|undefined, problem: string|null,
 *            warnings: Array<{field: string, received: string, hint: string}> }}
 *          `rooms` is the value to store; undefined means store none (the
 *          defaults)
 */
export function normaliseCaseRooms(config) {
    const raw = isPlainObject(config) ? config.rooms : undefined;
    if (raw === undefined || raw === null) return { rooms: undefined, problem: null, warnings: [] };
    const shape = 'rooms must be { disabled?: [room key, ...], enabled?: [room key, ...] }';
    if (!isPlainObject(raw)) return { rooms: undefined, problem: shape, warnings: [] };
    const unknownFields = Object.keys(raw).filter((field) => field !== 'disabled' && field !== 'enabled');
    if (unknownFields.length > 0) {
        return { rooms: undefined, problem: `unknown rooms field: ${unknownFields.join(', ')}`, warnings: [] };
    }
    const lists = { disabled: raw.disabled ?? [], enabled: raw.enabled ?? [] };
    if (!Object.values(lists).every((list) => Array.isArray(list) && list.every((key) => typeof key === 'string'))) {
        return { rooms: undefined, problem: shape, warnings: [] };
    }
    const fixed = lists.disabled.filter((key) => FIXED_ROOMS.includes(key));
    if (fixed.length > 0) {
        return { rooms: undefined, problem: `the ${fixed[0]} room cannot be switched off`, warnings: [] };
    }
    // `enabled` only means something for a default-off room; anything else in
    // it is on already, and is dropped with the same warning as an unknown key.
    const accepts = { disabled: SWITCHABLE_ROOM_KEYS, enabled: DEFAULT_OFF_ROOMS };
    const warnings = [];
    const rooms = {};
    for (const [field, list] of Object.entries(lists)) {
        const allowed = accepts[field];
        [...new Set(list.filter((key) => !allowed.includes(key)))].forEach((key) => warnings.push({
            field: `config.rooms.${field}`,
            received: key,
            hint: `Not a room this list takes; dropped. Expected one of: ${allowed.join(', ')}.`,
        }));
        const kept = [...new Set(list.filter((key) => allowed.includes(key)))].sort();
        if (kept.length > 0) rooms[field] = kept;
    }
    return { rooms: Object.keys(rooms).length > 0 ? rooms : undefined, problem: null, warnings };
}
