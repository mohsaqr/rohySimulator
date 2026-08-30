// The lessons module was ported from LAILA, which used plain i18next
// interpolation (`{{x}}`). rohy runs i18next-icu for ALL messages
// (src/i18n/index.js:40) because Finnish and Swedish plurals need it — and ICU
// does not recognise `{{x}}`, so it emits the braces verbatim.
//
// A learner saw the result as "Q{{I}} OF {{N}}" in a Self-check header
// (reported against v2.9.82). One key was reported; ten were broken.
import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import ICU from 'i18next-icu';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function jsxFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsxFiles(full));
        else if (/\.(jsx?|tsx?)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
    }
    return out;
}

describe('lessons i18n uses the ICU dialect', () => {
    // Regression lock. A defaultValue with `{{x}}` renders the braces to the
    // user; the parser cannot warn, because to ICU it is simply literal text.
    it('no defaultValue anywhere in the module uses i18next double braces', () => {
        const offenders = [];
        for (const file of jsxFiles(HERE)) {
            const src = fs.readFileSync(file, 'utf8');
            for (const [i, line] of src.split('\n').entries()) {
                if (/defaultValue:\s*['"`][^'"`]*\{\{/.test(line)) {
                    offenders.push(`${path.relative(HERE, file)}:${i + 1}`);
                }
            }
        }
        expect(offenders, 'use ICU single braces: {x}, not {{x}}').toEqual([]);
    });
});

describe('the ICU parser against the strings we actually ship', () => {
    let t;
    beforeAll(async () => {
        // A private instance configured exactly as src/i18n/index.js does:
        // ICU on, empty catalogue so every lookup falls through to the
        // defaultValue the component ships.
        const inst = i18next.createInstance();
        await inst.use(ICU).init({
            lng: 'en', fallbackLng: 'en', resources: { en: { teaching: {} } },
            interpolation: { escapeValue: false },
        });
        t = inst.getFixedT('en', 'teaching');
    });

    it('resolves the reported Self-check header', () => {
        expect(t('mcq_q_of_n', { defaultValue: 'Q{i} of {n}', i: 1, n: 5 })).toBe('Q1 of 5');
    });

    it('resolves the shared table footer, en-dash intact', () => {
        expect(t('showing_range', { defaultValue: 'Showing {from}–{to} of {total}', from: 1, to: 10, total: 99 }))
            .toBe('Showing 1–10 of 99');
    });

    it('pluralises the folder file count instead of saying "file(s)"', () => {
        const msg = '{count, plural, one {# file} other {# files}}';
        expect(t('folder_files_count', { defaultValue: msg, count: 1 })).toBe('1 file');
        expect(t('folder_files_count2', { defaultValue: msg, count: 3 })).toBe('3 files');
    });

    it('keeps double quotes literal in the delete confirmation', () => {
        expect(t('delete_confirm', {
            defaultValue: 'Delete "{title}"? This will remove all of its content.',
            title: 'Week 1',
        })).toBe('Delete "Week 1"? This will remove all of its content.');
    });

    it('proves the old dialect really was broken', () => {
        // If this ever passes with interpolated values, ICU has been turned off
        // and this whole conversion is moot — which is worth knowing loudly.
        expect(t('legacy', { defaultValue: 'Q{{i}} of {{n}}', i: 1, n: 5 })).toBe('Q{{i}} of {{n}}');
    });
});
