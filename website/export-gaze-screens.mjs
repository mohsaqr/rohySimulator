#!/usr/bin/env node
/**
 * export-gaze-screens.mjs — the pictures behind the Gaze tab's per-screen maps.
 *
 *   npm run website:gaze-screens        # after npm run website:shots
 *
 * Copies one 480 px miniature per room stamp from website/assets/screenshots/
 * mini/ into public/gaze-screens/<room>.webp, where the app reads them
 * (src/components/oyon/gazeScreens.js). The scene chosen for each room is the
 * room's resting state — the catalogue before an order, the body map before a
 * region is chosen — so the picture reads as "this screen", not "this moment".
 * Two rooms keep hand-taken pictures for now: Bedside (the patient model does
 * not render under software GL) and Pathology (no local case can open the room).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const MINI = path.join(repo, 'website', 'assets', 'screenshots', 'mini');
const OUT = path.join(repo, 'public', 'gaze-screens');

/** room stamp → miniature scene name */
export const ROOM_SCENES = Object.freeze({
    chat: 'patient-room',
    room3d: 'room-3d',
    examination: 'examination',
    lab: 'laboratory',
    radiology: 'radiology',
    ecg: 'ecg-room',
    pathology: 'pathology-slide',
    pacs: 'pacs',
    consultant: 'consultant',
    lessons: 'course',
    settings: 'settings-overview',
    tna: 'analytics',
});

export function exportGazeScreens({ mini = MINI, out = OUT } = {}) {
    fs.mkdirSync(out, { recursive: true });
    const copied = [];
    for (const [room, scene] of Object.entries(ROOM_SCENES)) {
        const src = path.join(mini, `${scene}.webp`);
        if (!fs.existsSync(src)) throw new Error(`no miniature for room '${room}': ${path.relative(repo, src)} is missing — run npm run website:shots`);
        fs.copyFileSync(src, path.join(out, `${room}.webp`));
        copied.push(room);
    }
    return copied;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const rooms = exportGazeScreens();
    console.log(`${rooms.length} gaze screens written to ${path.relative(repo, OUT)}: ${rooms.join(', ')}`);
}
