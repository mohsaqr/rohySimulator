// Locale catalogue integrity (I18N_PLAN.md §6 CI checks).
//
// Locks in the contract every language must satisfy:
//   1. Same namespaces as English (en is canonical).
//   2. Same key set per namespace — a missing key silently falls back to
//      English at runtime; this test makes the drift visible per PR instead.
//   3. Every string compiles as ICU MessageFormat (i18next-icu is on for all
//      messages, so a syntax error would throw at render time).
//   4. ICU arguments match English exactly in both directions — a translator
//      dropping {count} or typo-ing {name} breaks interpolation silently.
//   5. No empty values.
//
// The en-XA pseudo-locale is generated (npm run i18n:pseudo), not translated,
// but must satisfy the same contract — it's how QA finds hardcoded strings.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@formatjs/icu-messageformat-parser';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'locales');
const TRANSLATED = ['it', 'fi', 'sv', 'de', 'es'];
const GENERATED = ['en-XA'];

const readNs = (lng, file) => JSON.parse(readFileSync(join(LOCALES_DIR, lng, file), 'utf8'));
const enFiles = readdirSync(join(LOCALES_DIR, 'en')).filter(f => f.endsWith('.json'));

// Collect the set of ICU argument identifiers used in a message.
function icuArgs(message) {
    const args = new Set();
    const walk = (elements) => {
        for (const el of elements) {
            if (el.value && typeof el.value === 'string' && el.type !== 0) args.add(el.value);
            if (el.options) Object.values(el.options).forEach(opt => walk(opt.value));
            if (el.children) walk(el.children);
        }
    };
    walk(parse(message));
    return args;
}

describe('English canonical catalogues', () => {
    it('exist and are non-trivial', () => {
        expect(enFiles.length).toBeGreaterThanOrEqual(12);
    });

    it.each(enFiles)('%s: parses as ICU with no empty values', (file) => {
        for (const [key, value] of Object.entries(readNs('en', file))) {
            expect(value, `en/${file}#${key} is empty`).not.toBe('');
            expect(() => parse(value), `en/${file}#${key} ICU error`).not.toThrow();
        }
    });
});

describe.each([...TRANSLATED, ...GENERATED])('locale %s', (lng) => {
    it('has every English namespace', () => {
        for (const file of enFiles) {
            expect(existsSync(join(LOCALES_DIR, lng, file)), `${lng}/${file} missing`).toBe(true);
        }
    });

    it.each(enFiles)('%s: key set identical to en', (file) => {
        const en = Object.keys(readNs('en', file)).sort();
        const target = Object.keys(readNs(lng, file)).sort();
        expect(target).toEqual(en);
    });

    it.each(enFiles)('%s: every string compiles as ICU with en-matching arguments', (file) => {
        const en = readNs('en', file);
        const target = readNs(lng, file);
        for (const [key, value] of Object.entries(target)) {
            expect(value, `${lng}/${file}#${key} is empty`).not.toBe('');
            expect(() => parse(value), `${lng}/${file}#${key} ICU error`).not.toThrow();
            const expected = [...icuArgs(en[key])].sort();
            const actual = [...icuArgs(value)].sort();
            expect(actual, `${lng}/${file}#${key} ICU args drifted`).toEqual(expected);
        }
    });
});
