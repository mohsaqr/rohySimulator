// @vitest-environment node
// (i18next-parser pulls in esbuild, whose TextEncoder invariant fails under
// jsdom; this test only reads files, so it needs no DOM.)
//
// The lessons module's catalogues (./<lang>.json) against the module's own
// t() calls. They are maintained by hand (the module is excluded from rohy's
// extractor), so nothing else notices a key added to the code and not to the
// catalogues — the screen would quietly fall back to English again
// (FI-0010 review F08).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { IntlMessageFormat } from 'intl-messageformat';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../../../../server/shared/languages.js';
import { extractLessonsMessages } from '../../../../scripts/i18n/lessons-catalogue.mjs';
import { applyLessonsLocales, lessonsLocaleLanguages } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (lang) => JSON.parse(fs.readFileSync(path.join(HERE, `${lang}.json`), 'utf8'));
const variables = (message) => [...new Set([...message.matchAll(/\{\s*(\w+)/g)].map((m) => m[1]))].sort();
const SAMPLE = {
    count: 2, title: 'T', n: 1, number: 1, from: 1, to: 2, total: 3, name: 'N',
    limit: '1 MB', list: 'L', course: 'C', caseName: 'K', i: 1, c: 1,
};

let english;
beforeAll(() => { english = extractLessonsMessages(); });

describe('lessons module catalogues', () => {
    it('exist for every UI language rohy offers, and for the pseudo-locale', () => {
        const expected = [...Object.keys(LANGUAGES).filter((l) => l !== DEFAULT_LANGUAGE), 'en-XA'].sort();
        expect(lessonsLocaleLanguages()).toEqual(expected);
    });

    it('found the module strings (guard the guard)', () => {
        expect(english.calls).toBeGreaterThan(250);
        expect(Object.keys(english.messages.teaching).length).toBeGreaterThan(200);
    });

    it.each(lessonsLocaleLanguages())('%s carries exactly the keys the module uses', (lang) => {
        const table = read(lang);
        const missing = [];
        const extra = [];
        for (const [ns, keys] of Object.entries(english.messages)) {
            for (const key of Object.keys(keys)) {
                if (typeof table[ns]?.[key] !== 'string' || !table[ns][key].trim()) missing.push(`${ns}:${key}`);
            }
        }
        for (const [ns, keys] of Object.entries(table)) {
            for (const key of Object.keys(keys)) if (!(key in (english.messages[ns] ?? {}))) extra.push(`${ns}:${key}`);
        }
        expect(missing, 'translate these, or run `npm run i18n:pseudo` for en-XA').toEqual([]);
        expect(extra, 'no longer used by the module').toEqual([]);
    });

    it.each(lessonsLocaleLanguages())('%s: every message compiles as ICU and keeps the English placeholders', (lang) => {
        const table = read(lang);
        const problems = [];
        for (const [ns, keys] of Object.entries(english.messages)) {
            for (const [key, source] of Object.entries(keys)) {
                const message = table[ns]?.[key];
                if (typeof message !== 'string') continue;
                try {
                    new IntlMessageFormat(message, lang === 'en-XA' ? 'en' : lang).format(SAMPLE);
                } catch (err) {
                    problems.push(`${ns}:${key} does not compile: ${err.message}`);
                }
                if (/\{\{/.test(message)) problems.push(`${ns}:${key} uses {{…}}: ICU takes single braces`);
                if (variables(message).join() !== variables(source).join()) {
                    problems.push(`${ns}:${key} placeholders ${variables(message)} ≠ English ${variables(source)}`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    it('Finnish counts take the partitive after numbers other than one', () => {
        const fi = read('fi').teaching;
        const fmt = (key, count) => new IntlMessageFormat(fi[key], 'fi').format({ count });
        expect(fmt('room_lessons_count', 1)).toBe('1 oppitunti');
        expect(fmt('room_lessons_count', 6)).toBe('6 oppituntia');
        expect(fmt('room_sections_count', 3)).toBe('3 osiota');
        expect(fmt('responses_stat', 1)).toBe('1 vastaus');
    });
});

describe('applyLessonsLocales', () => {
    async function instance() {
        const inst = i18next.createInstance();
        await inst.use(ICU).init({
            lng: 'fi', fallbackLng: 'en',
            resources: { fi: { common: { delete: 'rohyn oma' } }, en: {} },
            interpolation: { escapeValue: false },
        });
        return inst;
    }

    it('adds the module namespaces, under what rohy already has', async () => {
        const inst = await instance();
        expect(await applyLessonsLocales(inst, 'fi')).toBe(true);
        const t = inst.getFixedT('fi', ['teaching', 'common']);
        expect(t('lesson_mark_complete', { defaultValue: 'Mark complete' })).toBe('Merkitse suoritetuksi');
        // rohy's reviewed string wins over the module's for a shared namespace.
        expect(t('common:delete', { defaultValue: 'Delete' })).toBe('rohyn oma');
        expect(t('common:create', { defaultValue: 'Create' })).toBe('Luo');
    });

    it('does nothing for English, whose text is the inline default', async () => {
        const inst = await instance();
        expect(await applyLessonsLocales(inst, 'en')).toBe(false);
    });
});
