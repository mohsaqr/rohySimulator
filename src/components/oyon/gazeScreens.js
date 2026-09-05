/**
 * The picture behind a per-screen gaze map.
 *
 * A 3×3 zone grid on a blank canvas says "top centre, 39%". The same grid
 * over a toned-down miniature of the actual screen says "the monitor, 39%".
 * This module names the picture for each room stamp Oyon writes on a window
 * (`oyon_emotion_records.room`): the five core rooms, the plugin rooms, and
 * the app surfaces that stamp a room without being one (settings, analytics,
 * the course). A stamp with no picture (an old or unknown key) gets no
 * background and the map draws as before — the picture is an aid to reading,
 * never a requirement for drawing.
 *
 * The files live in `public/gaze-screens/` and are 480 px miniatures of the
 * website's screenshots, copied there by `npm run website:gaze-screens`
 * (website/export-gaze-screens.mjs owns the scene-to-room mapping). They are
 * plain assets, so a deployment without them shows the blank grid.
 */

const BASE = '/gaze-screens';

/** Room stamp → English label, in the order the per-screen maps are shown. */
export const GAZE_SCREENS = Object.freeze([
    { room: 'chat', label: 'Patient (main)' },
    { room: 'room3d', label: 'Bedside' },
    { room: 'examination', label: 'Examination' },
    { room: 'lab', label: 'Lab' },
    { room: 'radiology', label: 'Radiology' },
    { room: 'ecg', label: '12-lead ECG' },
    { room: 'pathology', label: 'Pathology' },
    { room: 'pacs', label: 'PACS' },
    { room: 'consultant', label: 'Discussant' },
    { room: 'lessons', label: 'Course' },
    { room: 'settings', label: 'Settings' },
    { room: 'tna', label: 'Analytics' },
]);

const BY_ROOM = new Map(GAZE_SCREENS.map((s) => [s.room, s]));

/** Every navigator room always gets a panel, even with no windows, so the
 *  map reads as the whole simulator; the app surfaces (settings, analytics,
 *  the course) appear when the selection holds gaze windows stamped with them. */
export const ALWAYS_SHOWN_ROOMS = Object.freeze([
    'chat', 'room3d', 'examination', 'lab', 'radiology', 'ecg', 'pathology', 'pacs', 'consultant',
]);

/**
 * @param {string|null|undefined} room a window's room stamp
 * @returns {{room:string, label:string, src:string}|null} the picture to
 *   draw behind that room's gaze map, or null when there is none
 */
export function gazeScreenFor(room) {
    const entry = typeof room === 'string' ? BY_ROOM.get(room) : undefined;
    return entry ? { ...entry, src: `${BASE}/${entry.room}.webp` } : null;
}

/** Display order for a set of room stamps: known rooms in map order, then
 *  the unknown ones alphabetically. */
export function orderGazeRooms(rooms) {
    const known = GAZE_SCREENS.map((s) => s.room);
    const set = new Set(rooms);
    const rest = [...set].filter((r) => !known.includes(r)).sort();
    return [...known.filter((r) => set.has(r)), ...rest];
}
