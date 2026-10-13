// @vitest-environment node
// (i18next-parser pulls in esbuild, whose TextEncoder invariant fails under
// jsdom; this test only reads files, so it needs no DOM.)
// The lessons module was ported from LAILA, where every t() key lived in
// LAILA's own `teaching` / `navigation` / `courses` catalogues. rohy never
// shipped those namespaces (src/locales/en has no teaching.json), and the
// module is excluded from i18n extraction, so its strings come from the
// `{ defaultValue: '…' }` each call carries. A call with neither a
// defaultValue nor a key in a namespace rohy actually has renders the key
// itself: an admin opening Lessons → Surveys → Create survey saw
// "create_survey", "title_label", "survey_title_placeholder", …
//
// This walks every lessons source with the same lexer `npm run i18n:check`
// uses (i18next-parser's JsxLexer), so multi-line calls and JSX text are
// handled by a real parser rather than a regex.
import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import { JsxLexer } from 'i18next-parser';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EN_DIR = path.resolve(HERE, '../../locales/en');

function sourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.jsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
    }
    return out;
}

// Every namespace a file's useTranslation() calls name. i18next searches all
// of them in order, so a key in any one of them resolves. (A union over the
// file is slightly generous when a file holds two components with different
// lists; it can only miss a raw key, never invent one.)
function namespacesOf(src) {
    const out = new Set();
    for (const m of src.matchAll(/useTranslation\(([^)]*)\)/g)) {
        for (const s of m[1].matchAll(/['"]([\w-]+)['"]/g)) out.add(s[1]);
    }
    return out.size ? [...out] : ['common'];
}

describe('lessons module i18n', () => {
    let i18n;
    beforeAll(async () => {
        const resources = {};
        for (const f of fs.readdirSync(EN_DIR).filter(n => n.endsWith('.json'))) {
            resources[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(EN_DIR, f), 'utf8'));
        }
        i18n = i18next.createInstance();
        await i18n.init({
            lng: 'en', fallbackLng: 'en', resources: { en: resources },
            ns: Object.keys(resources), defaultNS: 'common', returnEmptyString: false,
        });
    });

    // Regression lock: PRV-54 survey screen showed raw i18n keys
    it('every t() call has text: a defaultValue or a key in a catalogue rohy ships', () => {
        const lexer = new JsxLexer({ functions: ['t'] });
        const offenders = [];
        let calls = 0;
        for (const file of sourceFiles(HERE)) {
            const src = fs.readFileSync(file, 'utf8');
            const ns = namespacesOf(src);
            for (const entry of lexer.extract(src, file)) {
                calls += 1;
                if (typeof entry.defaultValue === 'string' && entry.defaultValue.trim()) continue;
                if (i18n.exists(entry.key, { ns })) continue;
                offenders.push(`${path.relative(HERE, file)}: t('${entry.key}')`);
            }
        }
        // Guard the guard: if the lexer stopped finding calls, an empty
        // offender list would pass for the wrong reason.
        expect(calls).toBeGreaterThan(200);
        expect(offenders, 'add { defaultValue: "…" } — these render as the raw key').toEqual([]);
    });

    it('rohy ships no `teaching` catalogue, so a bare key renders as itself', () => {
        // Pins the premise above: if a teaching.json ever lands, this fails
        // and the defaultValue idiom can be revisited.
        const t = i18n.getFixedT('en', ['teaching', 'common', 'navigation']);
        expect(t('create_survey')).toBe('create_survey');
        expect(t('create_survey', { defaultValue: 'Create survey' })).toBe('Create survey');
    });
});
