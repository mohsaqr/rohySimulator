// The pure half of the seeded monkey walker (tests/monkey/walker.spec.js).
//
// Kept apart from the spec so the parts a failed walk is judged by — the
// PRNG a seed replays, the rooms a case must show, the controls the walker
// must never press, the console noise it may ignore — are unit-tested in
// tests/server/monkey-walker-lib.test.js without a browser.
//
// Node-importable, no Playwright import: the Vitest server project loads it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { disabledRooms } from '../../server/shared/caseRooms.js';
import { CORE_ROOM_KEYS } from '../../server/shared/pluginRegistry.js';

/**
 * mulberry32: a 32-bit seeded PRNG. Tiny, fast and good enough to choose the
 * next click; what matters is that one seed always yields one sequence, so a
 * failed walk can be replayed with MONKEY_SEED.
 *
 * @param {number} seed any finite number; truncated to 32 bits
 * @returns {() => number} a generator of floats in [0, 1)
 */
export function mulberry32(seed) {
    let a = Number(seed) >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A random integer in [0, n). */
export const pickIndex = (rand, n) => Math.floor(rand() * n);

/** One element of a non-empty list. */
export const pickOne = (rand, list) => list[pickIndex(rand, list.length)];

/**
 * A weighted choice: `weights` is `[[name, weight], ...]`, weights positive.
 *
 * @returns {string} the chosen name
 */
export function pickWeighted(rand, weights) {
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    let roll = rand() * total;
    for (const [name, w] of weights) {
        roll -= w;
        if (roll < 0) return name;
    }
    return weights[weights.length - 1][0];
}

// Short strings a learner might type, plus the shapes that break naive code:
// accents, a right-to-left letter, an emoji (a surrogate pair), markup and a
// lone quote. Short on purpose — the walker is looking for crashes, not
// exercising the composer's length limits.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz ABCXYZ0123456789';
const SPICE = ['ä', 'ö', 'ñ', 'é', 'ש', '😀', '<b>', '"', "'", '&', '%', '\\', '{', '}'];

/** A random string of 1-12 characters. */
export function randomText(rand) {
    const length = 1 + pickIndex(rand, 12);
    return Array.from({ length }, () => (rand() < 0.15 ? pickOne(rand, SPICE) : pickOne(rand, [...ALPHABET])))
        .join('');
}

/**
 * Controls the walker must never press, because pressing them ends the walk
 * rather than exercising the case: ending the case, leaving its rooms for a
 * full-page surface, signing out, or destroying something.
 *
 * By TEST ID first, because the walker switches the UI language (the language
 * items in the settings menu are fair game) and every accessible name is
 * translated. The test ids are the contract; the words below are the net for
 * a control nobody gave one.
 */
export const DENY_TEST_IDS = Object.freeze([
    'end-session',          // End & Debrief: ends the case
    'end-session-confirm',  // its confirmation, if a dialog is already up
    'logout',               // both sign-out buttons (TopBarControls)
    // Settings-menu items and the room bar's Course button: each opens a
    // full-page surface that replaces the room bar (App.jsx's surface
    // booleans), where the rest of the walk would wander another application.
    'room-course',
    'menu-cases', 'menu-profile', 'menu-settings', 'menu-help', 'menu-lessons',
    'menu-emotion-analytics', 'menu-oyon-dashboard', 'menu-case-analytics', 'menu-setup',
]);

/** English words that mark a control as destructive or as a way out. */
export const DENY_WORDS = Object.freeze([
    'delete', 'remove', 'purge', 'reset',
    'exit', 'back to cases',
    'log out', 'logout', 'sign out',
    'end & debrief', 'end and debrief',
]);

const flatten = (obj, prefix = '') => Object.entries(obj ?? {}).flatMap(([key, value]) => (
    value !== null && typeof value === 'object'
        ? flatten(value, `${prefix}${key}.`)
        : [[`${prefix}${key}`, value]]));

// A catalogue value as a matchable phrase: its longest literal run with ICU
// placeholders cut out and edge punctuation trimmed
// ('"{name}" löschen?' → "löschen"). Null when no run holds three letters.
const phraseOf = (value) => String(value)
    .split(/\{[^}]*\}/)
    .map((part) => part.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((part) => (part.match(/\p{L}/gu) ?? []).length >= 3)
    .sort((a, b) => b.length - a.length)[0] ?? null;

/**
 * The deny words in every UI language: for each English catalogue string that
 * contains a deny word, the same key's value in each other locale. Derived
 * from src/locales so a new translation, or a new language, is covered
 * without anyone editing this file.
 *
 * @param {string} localesDir path to src/locales
 * @returns {string[]} lower-case phrases, English included
 */
export function localisedDenyWords(localesDir = fileURLToPath(new URL('../../src/locales/', import.meta.url))) {
    const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
    const namespaces = fs.readdirSync(path.join(localesDir, 'en')).filter((f) => f.endsWith('.json'));
    const langs = fs.readdirSync(localesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'en')
        .map((d) => d.name);
    const denyRe = new RegExp(`\\b(${DENY_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')).join('|')})\\b`, 'i');
    const phrases = new Set(DENY_WORDS);
    namespaces.forEach((ns) => {
        const deniedKeys = flatten(readJson(path.join(localesDir, 'en', ns)))
            .filter(([, value]) => typeof value === 'string' && denyRe.test(value))
            .map(([key]) => key);
        if (deniedKeys.length === 0) return;
        langs.forEach((lang) => {
            const file = path.join(localesDir, lang, ns);
            if (!fs.existsSync(file)) return;
            const values = new Map(flatten(readJson(file)));
            deniedKeys.forEach((key) => {
                const phrase = values.has(key) ? phraseOf(values.get(key)) : null;
                if (phrase) phrases.add(phrase);
            });
        });
    });
    return [...phrases].sort();
}

/**
 * Is this control one the walker must leave alone?
 *
 * @param {{testid?: string, name?: string}} control
 * @param {string[]} words deny phrases, lower case (localisedDenyWords())
 * @returns {boolean}
 */
export function isDenied({ testid = '', name = '' } = {}, words = DENY_WORDS) {
    if (DENY_TEST_IDS.includes(testid)) return true;
    const lower = String(name).toLowerCase();
    return words.some((word) => lower.includes(word));
}

/**
 * The rooms a case's room bar must show, and the rooms it MAY show.
 *
 * Mirrors App.jsx's `enabledRooms` without importing the client plugin
 * registry (which is JSX): core rooms the case keeps, plus
 *   - room3d (the bedside) whenever it is switched on: its gate is "a case is
 *     running";
 *   - each plugin room the spec authored material for (`withMaterial`) — the
 *     spec knows what it put on the case, the walker should not re-derive the
 *     plugins' own document judgements;
 *   - PACS, OPTIONALLY, once the learner has ordered imaging: that order is a
 *     second way PACS has something to open (src/plugins/pacs/index.jsx), and
 *     the client learns of it on a 15 s poll, so it may lag the order.
 *
 * @param {object} config the case config as authored
 * @param {{ withMaterial?: string[], imagingOrdered?: boolean }} facts
 * @returns {{ required: string[], optional: string[] }} sorted room keys
 */
export function expectedRooms(config, { withMaterial = [], imagingOrdered = false } = {}) {
    const off = disabledRooms(config);
    const required = [
        ...CORE_ROOM_KEYS,
        'room3d',
        ...withMaterial,
    ].filter((key) => !off.includes(key));
    const optional = imagingOrdered && !off.includes('pacs') && !required.includes('pacs') ? ['pacs'] : [];
    return { required: [...new Set(required)].sort(), optional };
}

/**
 * Does the room bar show what the case offers? Every required room, any of the
 * optional ones, nothing else.
 *
 * @param {string[]} shown room keys read off the bar
 * @param {{ required: string[], optional: string[] }} expected
 * @returns {string|null} null when it matches, else a sentence naming the difference
 */
export function roomBarProblem(shown, { required, optional }) {
    const missing = required.filter((key) => !shown.includes(key));
    const extra = shown.filter((key) => !required.includes(key) && !optional.includes(key));
    const duplicated = shown.filter((key, i) => shown.indexOf(key) !== i);
    if (missing.length === 0 && extra.length === 0 && duplicated.length === 0) return null;
    const parts = [];
    if (missing.length) parts.push(`missing ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected ${extra.join(', ')}`);
    if (duplicated.length) parts.push(`duplicated ${duplicated.join(', ')}`);
    return `room bar shows [${shown.join(', ')}]: ${parts.join('; ')}`;
}

// console.error lines the walker tolerates. Each entry is a known,
// understood message that is not a defect of the page under test; each says
// why. Anything else logged at error level fails the walk.
//
// Chrome logs every failed resource load as a console error whose text names
// only the status; the walker appends the URL in brackets, and the patterns
// match on both. A 4xx is therefore allowlisted per route, never wholesale —
// an unexpected 403 from a room the case switched off is exactly what the
// walker is for.
export const CONSOLE_ERROR_ALLOWLIST = Object.freeze([
    {
        // PatientRecordProvider probes GET /patient-record/:session first and
        // creates the record on 404 (loadPatientRecord returns null on 404) —
        // before the first sync there is nothing to load. Designed, and the
        // provider no longer loops on it (PatientRecordContext.jsx).
        pattern: /status of 404 .*\[[^\]]*\/api\/patient-record\/\d+\]$/,
        why: 'patient record probe before its first sync',
    },
    {
        // useBodyImage walks uploaded .png → uploaded .svg → the bundled
        // silhouette through <img onError>, because a reader cannot know
        // whether an admin uploaded one or with which extension. On an
        // install with no upload the first two are 404 by design.
        pattern: /status of 404 .*\[[^\]]*\/uploads\/bodymap\/(man|woman)-(front|back)\.(png|svg)\?v=\d+\]$/,
        why: 'body-map silhouette upload-first fallback',
    },
]);

/**
 * Is this console.error text allowlisted?
 *
 * @param {string} text
 * @returns {boolean}
 */
export function consoleErrorAllowed(text) {
    return CONSOLE_ERROR_ALLOWLIST.some(({ pattern }) => pattern.test(String(text)));
}
