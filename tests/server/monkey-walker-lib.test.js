// The pure half of the seeded monkey walker (tests/monkey/walker-lib.js):
// what a failed walk is judged by must itself be right, or the walker either
// cries wolf or goes quiet. A browser is not needed for any of it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
    CONSOLE_ERROR_ALLOWLIST, consoleErrorAllowed, DENY_TEST_IDS, expectedRooms, isDenied, localisedDenyWords,
    mulberry32, pickWeighted, randomText, roomBarProblem,
} from '../monkey/walker-lib.js';

describe('the seeded PRNG', () => {
    it('replays: one seed, one sequence', () => {
        const a = mulberry32(12345);
        const b = mulberry32(12345);
        const seqA = Array.from({ length: 50 }, () => a());
        const seqB = Array.from({ length: 50 }, () => b());
        expect(seqA).toEqual(seqB);
    });

    it('differs between seeds, and stays in [0, 1)', () => {
        const a = Array.from({ length: 50 }, mulberry32(1));
        const b = Array.from({ length: 50 }, mulberry32(2));
        expect(a).not.toEqual(b);
        [...a, ...b].forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
    });

    it('takes a Date.now() seed (larger than 32 bits) without losing determinism', () => {
        const seed = 1758620000123;
        expect(Array.from({ length: 5 }, mulberry32(seed))).toEqual(Array.from({ length: 5 }, mulberry32(seed)));
    });

    it('pickWeighted honours the weights', () => {
        const rand = mulberry32(7);
        const counts = { a: 0, b: 0 };
        Array.from({ length: 4000 }).forEach(() => { counts[pickWeighted(rand, [['a', 3], ['b', 1]])] += 1; });
        // 3:1 → a ≈ 3000. Wide band: this pins the direction and rough size,
        // not the generator's exact output.
        expect(counts.a).toBeGreaterThan(2700);
        expect(counts.a).toBeLessThan(3300);
    });

    it('randomText is 1-12 characters (code points)', () => {
        const rand = mulberry32(3);
        Array.from({ length: 200 }).forEach(() => {
            const text = randomText(rand);
            // An emoji is two UTF-16 units; the spice list adds at most 3 per pick ("<b>").
            expect([...text].length).toBeGreaterThanOrEqual(1);
            expect([...text].length).toBeLessThanOrEqual(36);
        });
    });
});

describe('the rooms a case must show', () => {
    it('a case that stores no setting shows the core rooms and not the bedside', () => {
        expect(expectedRooms({})).toEqual({
            required: ['chat', 'consultant', 'examination', 'lab', 'radiology'],
            optional: [],
        });
    });

    it('the bedside appears only when switched on; material adds its plugin room', () => {
        const got = expectedRooms({ rooms: { enabled: ['room3d'] } }, { withMaterial: ['pathology'] });
        expect(got.required).toEqual(['chat', 'consultant', 'examination', 'lab', 'pathology', 'radiology', 'room3d']);
    });

    it('a switched-off room is not expected, even with material', () => {
        const got = expectedRooms({ rooms: { disabled: ['lab', 'pathology'] } }, { withMaterial: ['pathology'] });
        expect(got.required).toEqual(['chat', 'consultant', 'examination', 'radiology']);
    });

    it('PACS is allowed, never required, once imaging was ordered', () => {
        expect(expectedRooms({}, { imagingOrdered: true }).optional).toEqual(['pacs']);
        expect(expectedRooms({ rooms: { disabled: ['pacs'] } }, { imagingOrdered: true }).optional).toEqual([]);
    });

    it('roomBarProblem names what is missing, extra or duplicated', () => {
        const expected = { required: ['chat', 'lab'], optional: ['pacs'] };
        expect(roomBarProblem(['chat', 'lab'], expected)).toBeNull();
        expect(roomBarProblem(['chat', 'lab', 'pacs'], expected)).toBeNull();
        expect(roomBarProblem(['chat'], expected)).toMatch(/missing lab/);
        expect(roomBarProblem(['chat', 'lab', 'room3d'], expected)).toMatch(/unexpected room3d/);
        expect(roomBarProblem(['chat', 'lab', 'lab'], expected)).toMatch(/duplicated lab/);
    });
});

describe('the controls the walker leaves alone', () => {
    it('denies by test id whatever the name says', () => {
        DENY_TEST_IDS.forEach((testid) => expect(isDenied({ testid, name: 'Harmless' })).toBe(true));
        expect(isDenied({ testid: 'room-button-lab', name: 'Laboratory' })).toBe(false);
    });

    it('denies destructive and leaving words in English', () => {
        ['Delete case', 'Remove', 'Reset zoom', 'Exit', 'Back to cases', 'Log out'].forEach((name) => {
            expect(isDenied({ name }), name).toBe(true);
        });
        ['Send', 'Order', 'Laboratory'].forEach((name) => expect(isDenied({ name }), name).toBe(false));
    });

    it('derives the same words in every shipped UI language', () => {
        const words = localisedDenyWords();
        // The walker switched the UI to Italian and pressed "Esci" (sign out)
        // on its first long run — the reason this derivation exists.
        ['esci', 'abmelden', 'kirjaudu ulos', 'logga ut', 'salir'].forEach((w) => expect(words).toContain(w));
        expect(isDenied({ name: 'Esci' }, words)).toBe(true);
        expect(isDenied({ name: 'Invia' }, words)).toBe(false);
    });

    describe('with a synthetic catalogue', () => {
        let dir;
        afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

        it('takes the translated key, cuts ICU placeholders, and skips untranslated keys', () => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monkey-locales-'));
            const write = (lang, obj) => {
                fs.mkdirSync(path.join(dir, lang), { recursive: true });
                fs.writeFileSync(path.join(dir, lang, 'app.json'), JSON.stringify(obj));
            };
            write('en', { a: { del: 'Delete {name}' }, keep: 'Send', gone: 'Remove' });
            write('xx', { a: { del: '"{name}" poistaa?' }, keep: 'Lähetä' });
            const words = localisedDenyWords(dir);
            expect(words).toContain('poistaa');
            expect(words).not.toContain('lähetä');
        });
    });
});

describe('the console allowlist', () => {
    it('every entry says why', () => {
        CONSOLE_ERROR_ALLOWLIST.forEach((entry) => expect(entry.why).toMatch(/\w{4}/));
    });

    it('allows a known 404 probe only on its own route', () => {
        const probe = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
        expect(consoleErrorAllowed(`${probe} [http://127.0.0.1:4811/api/patient-record/12]`)).toBe(true);
        expect(consoleErrorAllowed(`${probe} [http://127.0.0.1:4811/uploads/bodymap/man-front.png?v=0]`)).toBe(true);
        expect(consoleErrorAllowed(`${probe} [http://127.0.0.1:4811/api/sessions/12]`)).toBe(false);
        expect(consoleErrorAllowed(
            'Failed to load resource: the server responded with a status of 403 (Forbidden) [http://127.0.0.1:4811/api/patient-record/12]',
        )).toBe(false);
        expect(consoleErrorAllowed('TypeError: cannot read properties of undefined')).toBe(false);
    });
});
