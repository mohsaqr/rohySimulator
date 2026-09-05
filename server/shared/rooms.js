/**
 * Rooms — the one list of `learning_events.room` values and their labels.
 *
 * Before this module, the analytics layer carried a five-entry literal
 * (`ROOM_LABELS` in windowSequences.js) that predated every plugin room, so
 * `pacs`, `ecg`, `pathology`, `room3d` and `lessons` rendered as title-cased
 * ids in the room filter and the location-transition network. The core list
 * lives here next to the plugin registry so a new room reaches every consumer
 * the moment its manifest is generated.
 *
 * Analytics screens are English-only (they are excluded from i18n
 * extraction), so `roomLabel()` returns English. A localised surface should
 * use `roomLabelKey()` and its own `t()`: core rooms map to the
 * `room_<key>` keys the RoomNavigator already uses, and plugin rooms to their
 * manifest's `room.labelKey`.
 */
import { PLUGIN_MANIFESTS } from './plugins/manifests.generated.js';
import { CORE_ROOM_KEYS } from './pluginRegistry.js';

/** Core rooms with the English labels the analytics screens have always shown. */
export const CORE_ROOMS = Object.freeze({
    chat: { key: 'chat', label: 'Patient (main)', labelKey: 'room_chat', order: 10 },
    examination: { key: 'examination', label: 'Examination', labelKey: 'room_examination', order: 20 },
    lab: { key: 'lab', label: 'Lab', labelKey: 'room_lab', order: 30 },
    radiology: { key: 'radiology', label: 'Radiology', labelKey: 'room_radiology', order: 40 },
    consultant: { key: 'consultant', label: 'Discussant', labelKey: 'room_consultant', order: 90 },
});

/** Surfaces that stamp a room without being a navigator room. */
export const EXTRA_ROOMS = Object.freeze({
    lessons: { key: 'lessons', label: 'Lessons', labelKey: 'room_lessons', order: 95 },
});

function titleCase(key) {
    const s = String(key || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Plugin rooms, from the generated manifests. Labels are the humanised id
 *  because a manifest carries only an i18n key (RPS-1 §3.1). */
export const PLUGIN_ROOMS = Object.freeze(Object.fromEntries(
    PLUGIN_MANIFESTS.map((m) => [m.id, Object.freeze({
        key: m.id,
        label: titleCase(m.id),
        labelKey: m.room?.labelKey ?? `room_${m.id}`,
        order: m.room?.order ?? 50,
        plugin: true,
    })]),
));

/** Every known room, keyed by `learning_events.room` value. */
export const ROOMS = Object.freeze({ ...CORE_ROOMS, ...PLUGIN_ROOMS, ...EXTRA_ROOMS });

/** Every known room key, navigator order. */
export const ROOM_KEYS = Object.freeze(
    Object.values(ROOMS).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map((r) => r.key),
);

/**
 * English label for a room key. Unknown keys (historical rows from a plugin
 * since removed) are title-cased rather than dropped — the row is still real.
 * @param {string} room
 * @returns {string|null} null for an empty/absent room
 */
export function roomLabel(room) {
    const key = typeof room === 'string' ? room.trim().toLowerCase() : '';
    if (!key) return null;
    return ROOMS[key]?.label ?? titleCase(key);
}

/**
 * i18n key for a room, for surfaces that translate.
 * @param {string} room
 * @returns {string|null}
 */
export function roomLabelKey(room) {
    const key = typeof room === 'string' ? room.trim().toLowerCase() : '';
    if (!key) return null;
    return ROOMS[key]?.labelKey ?? `room_${key}`;
}

/** Guard: every core key the plugin registry protects has a label here. */
CORE_ROOM_KEYS.forEach((key) => {
    if (!CORE_ROOMS[key]) throw new Error(`server/shared/rooms.js has no entry for core room '${key}'`);
});
