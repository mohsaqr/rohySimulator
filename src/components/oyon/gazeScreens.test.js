// gazeScreens: the picture behind each per-screen gaze map. The table must
// cover every room a window can be stamped with, and every entry must have
// its file under public/gaze-screens — a missing file is a blank grid with
// no error, which is exactly the silent gap this test exists to catch.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALWAYS_SHOWN_ROOMS, GAZE_SCREENS, gazeScreenFor, orderGazeRooms } from './gazeScreens.js';
import { CORE_ROOMS, PLUGIN_ROOMS } from '../../../server/shared/rooms.js';

const PUBLIC = join(process.cwd(), 'public', 'gaze-screens');

describe('gazeScreens', () => {
    it('names a picture for every core room and every plugin room', () => {
        const rooms = GAZE_SCREENS.map((s) => s.room);
        for (const key of [...Object.keys(CORE_ROOMS), ...Object.keys(PLUGIN_ROOMS)]) {
            expect(rooms, `room '${key}' has no gaze screen`).toContain(key);
        }
        for (const key of [...Object.keys(CORE_ROOMS), ...Object.keys(PLUGIN_ROOMS)]) {
            expect(ALWAYS_SHOWN_ROOMS, `room '${key}' is not always shown`).toContain(key);
        }
    });

    it('ships the file behind every entry', () => {
        for (const { room } of GAZE_SCREENS) {
            const { src } = gazeScreenFor(room);
            expect(src).toBe(`/gaze-screens/${room}.webp`);
            expect(existsSync(join(PUBLIC, `${room}.webp`)), `${src} is missing — run npm run website:gaze-screens`).toBe(true);
        }
    });

    it('returns null for a stamp with no picture, and never throws', () => {
        expect(gazeScreenFor('unassigned')).toBeNull();
        expect(gazeScreenFor('persona-editor')).toBeNull();
        expect(gazeScreenFor(null)).toBeNull();
        expect(gazeScreenFor(undefined)).toBeNull();
        expect(gazeScreenFor(42)).toBeNull();
    });

    it('orders known rooms by the table and appends unknown ones alphabetically', () => {
        expect(orderGazeRooms(['pacs', 'zzz', 'chat', 'aaa', 'chat', 'consultant']))
            .toEqual(['chat', 'pacs', 'consultant', 'aaa', 'zzz']);
    });
});
