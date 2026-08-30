// Locale catalogue integrity (docs/design/i18n-plan.md §6 CI checks).
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

// ---------------------------------------------------------------------------
// Untranslated-leftover locks (2026-08-30 UI review, findings #23 / #39).
//
// The key-set check above catches a MISSING key. It cannot catch a key that is
// present but still holds the English string — that ships as "translated" and
// is invisible until a pilot user reads it. The PACS worklist and 24 other
// strings read English in all six languages for exactly that reason.
//
// Two shapes of that bug are never a coincidence, so they are locked here.
// (Plenty of values legitimately match English — "EtCO2", "PACS", "{value}/min"
// — so a blanket "must differ" rule would be noise. These two are not that.)

/** Keys whose English value contains an ICU plural. */
function pluralKeys(file) {
    return Object.entries(readNs('en', file))
        .filter(([, v]) => /\{\s*\w+\s*,\s*plural/.test(v))
        .map(([k]) => k);
}

// Prose that a pilot reported reading in English: PACS chrome, the help
// drawer, the auth error set, the exam/debrief summary, plugin + pathology
// settings, the chat failure bubble, profile field labels. None of these can
// legitimately be identical to English in any of the five languages.
const MUST_BE_TRANSLATED = {
    'auth.json': ['error_invalid_credentials', 'error_account_locked', 'password_req_met'],
    'authoring_config.json': ['plugin_settings_library_empty', 'pathology_settings_imports', 'plugin_settings_save'],
    'chat.json': ['llm_error_cannot_connect', 'llm_error_service_unavailable'],
    'common.json': [
        'radoyon_worklist_empty', 'radoyon_author_intro', 'radoyon_studies_count',
        'radoyon_tools_label', 'radoyon_status_pending', 'room_pacs_sub', 'room_pacs_author',
        'error_boundary_title', 'oyon_press_camera',
    ],
    'discussion.json': ['tutor_reply_failed'],
    'examination.json': ['section_demographics', 'no_labs_returned', 'debrief_total_points'],
    'first_run.json': ['case_card_error'],
    'help.json': ['drawer_title', 'tour_student_welcome_body', 'article_getting_started', 'group_using', 'support_intro'],
    'investigations.json': ['radiologist_credentials'],
    'profile.json': ['field_label_name', 'field_label_grade'],
};

describe.each(TRANSLATED)('locale %s carries no English leftovers', (lng) => {
    it('no ICU plural is a byte-identical copy of the English message', () => {
        // Plural morphology differs from English in all five languages, so an
        // identical plural message is a copied English shell — the shape that
        // put "# imaging study / # imaging studies" into the fi and sv
        // catalogues.
        const en = {};
        const offenders = [];
        for (const file of enFiles) {
            en[file] = readNs('en', file);
            const target = readNs(lng, file);
            for (const key of pluralKeys(file)) {
                if (target[key] === en[file][key]) offenders.push(`${file}#${key}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the prose the 2026-08-30 pass translated is not English again', () => {
        const offenders = [];
        for (const [file, keys] of Object.entries(MUST_BE_TRANSLATED)) {
            const en = readNs('en', file);
            const target = readNs(lng, file);
            for (const key of keys) {
                expect(en[key], `en/${file}#${key} vanished — update this list`).toBeTypeOf('string');
                if (target[key] === en[key]) offenders.push(`${file}#${key}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
