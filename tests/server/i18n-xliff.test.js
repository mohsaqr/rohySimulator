// i18n review pipeline: status sidecar + XLIFF 1.2 export/import
// (docs/integrator/i18n-review.md; scripts/i18n/*).
//
// Every CLI test runs against a throwaway copy of a mini locale tree via
// --root, so the real catalogues under src/locales are never written. The
// last describe block is a read-only smoke test over the real tree that
// locks the committed status bootstrap.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, icuArgs, bracesBalanced, glossaryTermsIn, targetHasRendering, computeStatus, readStatus } from '../../scripts/i18n/lib.mjs';
import { parseXml, childElements, firstChild, textOf, escapeText, escapeAttr } from '../../scripts/i18n/xml.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(REPO, 'scripts', 'i18n');
const REAL_LOCALES = join(REPO, 'src', 'locales');

const EN = {
    chat: {
        bp_label: 'Blood pressure: {value} mmHg',
        items: '{count, plural, one {# message} other {# messages}} from {name}',
        new_key: 'Only in English',
        plain: 'Say hello'
    },
    common: {
        patient_count: '{count, plural, one {# patient} other {# patients}}',
        save: 'Save & close (< 5 s)'
    }
};
const IT = {
    chat: {
        bp_label: 'Pressione arteriosa: {value} mmHg',
        items: '{count, plural, one {# messaggio} other {# messaggi}} da {name}',
        plain: "Di' ciao"
    },
    common: {
        patient_count: '{count, plural, one {# paziente} other {# pazienti}}',
        save: 'Salva & chiudi (< 5 s)'
    }
};

const writeJson = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function makeTree() {
    const root = mkdtempSync(join(tmpdir(), 'rohy-i18n-'));
    for (const [lang, nss] of [['en', EN], ['it', IT]]) {
        mkdirSync(join(root, lang));
        for (const [ns, obj] of Object.entries(nss)) writeJson(join(root, lang, `${ns}.json`), obj);
    }
    return root;
}

/** Run a scripts/i18n CLI; returns { code, stdout, stderr } instead of throwing. */
function run(script, args, root) {
    try {
        const stdout = execFileSync(process.execPath, [join(SCRIPTS, script), ...args, `--root=${root}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
    } catch (err) {
        return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
}

const units = (xlf, ns) => {
    const doc = parseXml(readFileSync(xlf, 'utf8'));
    const file = childElements(doc, 'file').find(f => f.attrs.original === `${ns}.json`);
    return file ? childElements(firstChild(file, 'body'), 'trans-unit') : [];
};
const unitById = (xlf, ns, id) => units(xlf, ns).find(u => u.attrs.id === id);
const targetOf = (u) => firstChild(u, 'target');
const notesOf = (u) => childElements(u, 'note').map(textOf);

let root;
beforeEach(() => { root = makeTree(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------

describe('lib.mjs helpers', () => {
    it('hash matches translate-locales.mjs (sha256[:12])', () => {
        expect(hash('Save')).toMatch(/^[0-9a-f]{12}$/);
        // Stable, not salted:
        expect(hash('Blood pressure: {value} mmHg')).toBe(hash('Blood pressure: {value} mmHg'));
        expect(hash('a')).not.toBe(hash('b'));
    });

    it('icuArgs collects argument names through plural/select branches', () => {
        expect([...icuArgs('{count, plural, one {# item} other {# items}} for {name}')].sort()).toEqual(['count', 'name']);
        expect([...icuArgs('plain text')]).toEqual([]);
    });

    it('bracesBalanced ignores ICU-quoted literal braces', () => {
        expect(bracesBalanced('{x} and {y}')).toBe(true);
        expect(bracesBalanced("literal '{' brace {x}")).toBe(true);
        expect(bracesBalanced('{x')).toBe(false);
        expect(bracesBalanced('x}')).toBe(false);
    });

    it('glossary matching: lowercase terms are case-insensitive, abbreviations exact; renderings tolerate inflection', () => {
        const g = { 'blood pressure': 'pressione arteriosa', BP: 'PA', patient: 'paziente' };
        expect(glossaryTermsIn('Check the Blood Pressure of the patients', g).map(t => t.term)).toEqual(['blood pressure', 'patient']);
        expect(glossaryTermsIn('bp is fine', g)).toEqual([]);
        expect(glossaryTermsIn('BP is fine', g).map(t => t.term)).toEqual(['BP']);
        expect(targetHasRendering('Controlla la pressione arteriosa dei pazienti', 'paziente')).toBe(true);
        expect(targetHasRendering('Farmaco somministrato', 'somministrare')).toBe(true);
        expect(targetHasRendering('Farmaco dato', 'somministrare')).toBe(false);
        expect(targetHasRendering('Controlla la PA', 'pressione arteriosa')).toBe(false);
    });
});

describe('xml.mjs mini parser', () => {
    it('parses elements, attributes, entities, CDATA and comments; escapes round-trip', () => {
        const doc = parseXml(`<?xml version="1.0"?>\n<!-- c --><a x="1" y='q&quot;'>t&amp;&lt;<b/><c><![CDATA[<raw>]]></c>&#233;&#x41;</a>`);
        expect(doc.name).toBe('a');
        expect(doc.attrs).toEqual({ x: '1', y: 'q"' });
        expect(textOf(doc)).toBe('t&<<raw>éA');
        expect(childElements(doc).map(c => c.name)).toEqual(['b', 'c']);
        const s = 'a & b < c > "d"';
        expect(textOf(parseXml(`<t>${escapeText(s)}</t>`))).toBe(s);
        expect(parseXml(`<t v="${escapeAttr(s)}"/>`).attrs.v).toBe(s);
    });

    it('rejects malformed input', () => {
        expect(() => parseXml('<a><b></a>')).toThrow(/unexpected/);
        expect(() => parseXml('<a>')).toThrow(/unclosed/);
        expect(() => parseXml('<a x=1/>')).toThrow(/attribute/);
        expect(() => parseXml('<a/><b/>')).toThrow(/multiple root/);
    });
});

// ---------------------------------------------------------------------------

describe('i18n:status', () => {
    it('--bootstrap writes machine entries for every translated key with the current en hash and namespace risk', () => {
        const res = run('status.mjs', ['--bootstrap'], root);
        expect(res.code).toBe(0);
        const status = readJson(join(root, '.status', 'it.json'));
        expect(Object.keys(status)).toEqual(['chat.bp_label', 'chat.items', 'chat.plain', 'common.patient_count', 'common.save']);
        expect(status['chat.bp_label']).toEqual({
            src: hash(EN.chat.bp_label),
            tgt: hash(IT.chat.bp_label),
            state: 'machine',
            origin: 'machine',
            locked: false,
            reviewed_at: null,
            reviewer: null,
            risk: 'clinical'
        });
        expect(status['common.save'].risk).toBe('low');
        // Idempotent and preserves per-key overrides.
        status['common.save'].risk = 'clinical';
        writeJson(join(root, '.status', 'it.json'), status);
        run('status.mjs', ['--bootstrap'], root);
        expect(readJson(join(root, '.status', 'it.json'))['common.save'].risk).toBe('clinical');
    });

    it('classifies new / stale / machine / reviewed / approved / removed and prints a table', () => {
        run('status.mjs', ['--bootstrap'], root);
        const status = readJson(join(root, '.status', 'it.json'));
        status['chat.plain'].state = 'reviewed';
        status['common.save'].state = 'approved';
        status['chat.items'].src = 'deadbeef0000';         // en moved on → stale
        status['chat.gone'] = { ...status['chat.plain'] };  // key left en → removed
        writeJson(join(root, '.status', 'it.json'), status);

        const { totals, byNs } = computeStatus(root, 'it');
        expect(totals).toEqual({ new: 1, stale: 1, machine: 2, reviewed: 1, approved: 1, removed: 1 });
        expect(byNs.chat).toEqual({ new: 1, stale: 1, machine: 1, reviewed: 1, approved: 0, removed: 1 });

        const res = run('status.mjs', ['it'], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toMatch(/TOTAL\s+1\s+1\s+2\s+1\s+1\s+1/);
        const json = JSON.parse(run('status.mjs', ['--json'], root).stdout);
        expect(json.it.totals.stale).toBe(1);
        expect(json.it.clinical_gaps.map(g => g.id).sort()).toEqual(['chat.items', 'chat.new_key']);
    });

    it('--check exits 1 only while a clinical key is new or stale', () => {
        run('status.mjs', ['--bootstrap'], root);
        expect(run('status.mjs', ['--check'], root).code).toBe(1); // chat.new_key is new + clinical
        const it = readJson(join(root, 'it', 'chat.json'));
        it.new_key = 'Solo in inglese';
        writeJson(join(root, 'it', 'chat.json'), it);
        expect(run('status.mjs', ['--check'], root).code).toBe(0); // untracked → machine, not a gap
    });
});

// ---------------------------------------------------------------------------

describe('i18n:xliff:export', () => {
    it('writes valid XLIFF 1.2 with one file per namespace, correct states, notes and glossary header', () => {
        const out = join(root, 'out.xlf');
        const res = run('xliff-export.mjs', ['it', '--date=20260816', `--out=${out}`], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('6 unit(s) in 2 file(s)');
        const doc = parseXml(readFileSync(out, 'utf8'));
        expect(doc.name).toBe('xliff');
        expect(doc.attrs.version).toBe('1.2');
        expect(doc.attrs.xmlns).toBe('urn:oasis:names:tc:xliff:document:1.2');
        const files = childElements(doc, 'file');
        expect(files.map(f => f.attrs.original)).toEqual(['chat.json', 'common.json']);
        expect(files[0].attrs).toMatchObject({ 'source-language': 'en', 'target-language': 'it', datatype: 'plaintext', 'product-name': 'rohy', date: '2026-08-16T00:00:00Z' });
        expect(files[0].attrs['product-version']).toBe(readJson(join(REPO, 'package.json')).version);
        expect(textOf(firstChild(firstChild(files[0], 'header'), 'note'))).toContain('"blood pressure" → "pressione arteriosa"');

        const newUnit = unitById(out, 'chat', 'new_key');
        expect(newUnit.attrs.approved).toBe('no');
        expect(targetOf(newUnit).attrs.state).toBe('new');
        expect(textOf(targetOf(newUnit))).toBe('');
        expect(notesOf(newUnit)).toEqual([`risk=clinical; icu=no; src=${hash(EN.chat.new_key)}`]);

        const icuUnit = unitById(out, 'chat', 'items');
        expect(targetOf(icuUnit).attrs.state).toBe('needs-review-translation');
        expect(textOf(targetOf(icuUnit))).toBe(IT.chat.items);
        expect(firstChild(icuUnit, 'source').attrs['xml:space']).toBe('preserve');
        expect(notesOf(icuUnit)).toEqual([`risk=clinical; icu=yes; src=${hash(EN.chat.items)}`, 'icu-args=count, name']);

        const saveUnit = unitById(out, 'common', 'save');
        expect(textOf(firstChild(saveUnit, 'source'))).toBe('Save & close (< 5 s)');
        expect(readFileSync(out, 'utf8')).toContain('Save &amp; close (&lt; 5 s)');
        expect(notesOf(saveUnit)[0]).toContain('risk=low');

        // Export registered the untracked machine keys in the status file.
        expect(Object.keys(readStatus(root, 'it'))).toHaveLength(5);
    });

    it('--only and --ns filter; reviewed/approved carry translated/signed-off states; removed entries are pruned', () => {
        run('status.mjs', ['--bootstrap'], root);
        const status = readJson(join(root, '.status', 'it.json'));
        status['chat.plain'].state = 'reviewed';
        status['common.save'].state = 'approved';
        status['chat.gone'] = { ...status['chat.plain'] };
        writeJson(join(root, '.status', 'it.json'), status);

        const out = join(root, 'a.xlf');
        run('xliff-export.mjs', ['it', '--date=20260816', `--out=${out}`], root);
        expect(units(out, 'chat').map(u => u.attrs.id)).toEqual(['bp_label', 'items', 'new_key']); // plain is reviewed → excluded
        expect(units(out, 'common').map(u => u.attrs.id)).toEqual(['patient_count']);
        expect(readStatus(root, 'it')['chat.gone']).toBeUndefined();

        const full = join(root, 'b.xlf');
        run('xliff-export.mjs', ['it', '--date=20260816', `--out=${full}`, '--only=new,stale,machine,reviewed,approved', '--ns=chat'], root);
        expect(units(full, 'common')).toEqual([]);
        expect(targetOf(unitById(full, 'chat', 'plain')).attrs.state).toBe('translated');

        const onlyNew = join(root, 'c.xlf');
        run('xliff-export.mjs', ['it', '--date=20260816', `--out=${onlyNew}`, '--only=new'], root);
        expect(units(onlyNew, 'chat').map(u => u.attrs.id)).toEqual(['new_key']);

        const approvedOnly = join(root, 'd.xlf');
        run('xliff-export.mjs', ['it', '--date=20260816', `--out=${approvedOnly}`, '--only=approved'], root);
        const saveUnit = unitById(approvedOnly, 'common', 'save');
        expect(saveUnit.attrs.approved).toBe('yes');
        expect(targetOf(saveUnit).attrs.state).toBe('signed-off');
    });

    it('defaults to i18n/xliff/<lang>/rohy-<lang>-<date>.xlf under the repo root', () => {
        // Only checks the path is reported; --out is used everywhere else so the repo stays clean.
        const res = run('xliff-export.mjs', ['it', '--date=20991231', `--out=${join(root, 'x.xlf')}`], root);
        expect(res.stdout).toContain('x.xlf');
        expect(run('xliff-export.mjs', ['it', '--date=bad', `--out=${join(root, 'y.xlf')}`], root).code).toBe(2);
        expect(run('xliff-export.mjs', [], root).code).toBe(2);
    });
});

// ---------------------------------------------------------------------------

/** Export, then rewrite targets/states like a reviewer would; returns the edited file path. */
function reviewedXliff(edit) {
    const out = join(root, 'export.xlf');
    run('xliff-export.mjs', ['it', '--date=20260816', `--out=${out}`], root);
    const reviewed = join(root, 'reviewed.xlf');
    writeFileSync(reviewed, edit(readFileSync(out, 'utf8')));
    return reviewed;
}

describe('i18n:xliff:import', () => {
    it('round-trips: writes JSON (sorted, 2-space, trailing newline) and status; --dry-run writes nothing', () => {
        const file = reviewedXliff(x => x
            .replace('<target state="new" xml:space="preserve"></target>', '<target state="translated" xml:space="preserve">Solo in inglese</target>')
            .replace('<trans-unit id="bp_label" resname="bp_label" approved="no">', '<trans-unit id="bp_label" resname="bp_label" approved="yes">')
            .replace('needs-review-translation" xml:space="preserve">Pressione arteriosa', 'signed-off" xml:space="preserve">Pressione arteriosa')
            .replace("Di' ciao</target>", 'Saluta</target>'));

        const before = readFileSync(join(root, 'it', 'chat.json'), 'utf8');
        const dry = run('xliff-import.mjs', [file, '--reviewer=M. Rossi', '--dry-run'], root);
        expect(dry.code).toBe(0);
        expect(dry.stdout).toContain('Dry run');
        expect(readFileSync(join(root, 'it', 'chat.json'), 'utf8')).toBe(before);
        expect(readStatus(root, 'it')['chat.new_key']).toBeUndefined();

        const res = run('xliff-import.mjs', [file, '--reviewer=M. Rossi'], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toMatch(/chat\s+1\s+2\s+1\s+0\s+0/);
        const raw = readFileSync(join(root, 'it', 'chat.json'), 'utf8');
        expect(raw).toBe(JSON.stringify({
            bp_label: 'Pressione arteriosa: {value} mmHg',
            items: IT.chat.items,
            new_key: 'Solo in inglese',
            plain: 'Saluta'
        }, null, 2) + '\n');
        const status = readStatus(root, 'it');
        expect(status['chat.bp_label']).toMatchObject({ state: 'approved', reviewer: 'M. Rossi', src: hash(EN.chat.bp_label) });
        expect(status['chat.bp_label'].reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(status['chat.new_key']).toMatchObject({ state: 'reviewed', reviewer: 'M. Rossi', risk: 'clinical' });
        expect(status['chat.plain']).toMatchObject({ state: 'reviewed' });          // needs-review + changed text
        expect(status['chat.items']).toMatchObject({ state: 'machine', reviewer: null }); // needs-review + unchanged
        expect(Object.keys(status)).toEqual([...Object.keys(status)].sort());
        // Common namespace untouched on disk.
        expect(readJson(join(root, 'it', 'common.json'))).toEqual(IT.common);
        // Status now reports the reviewed/approved split.
        expect(computeStatus(root, 'it').totals).toMatchObject({ new: 0, reviewed: 2, approved: 1, machine: 3 });
    });

    it('rejects a dropped ICU argument: exit 1, nothing written', () => {
        const file = reviewedXliff(x => x
            .replace('one {# messaggio} other {# messaggi}} da {name}', 'one {# messaggio} other {# messaggi}} da qualcuno'));
        const before = readFileSync(join(root, 'it', 'chat.json'), 'utf8');
        const res = run('xliff-import.mjs', [file], root);
        expect(res.code).toBe(1);
        expect(res.stdout).toContain('FAIL chat.items: ICU arguments differ');
        expect(res.stderr).toContain('nothing written');
        expect(readFileSync(join(root, 'it', 'chat.json'), 'utf8')).toBe(before);
    });

    it('rejects broken ICU / unbalanced braces and empty non-new targets', () => {
        const file = reviewedXliff(x => x
            .replace('one {# paziente} other {# pazienti}}', 'one {# paziente} other {# pazienti}')
            .replace("Di' ciao</target>", '</target>'));
        const res = run('xliff-import.mjs', [file], root);
        expect(res.code).toBe(1);
        expect(res.stdout).toContain('FAIL common.patient_count: unbalanced {braces}');
        expect(res.stdout).toContain('FAIL chat.plain: empty target');
    });

    it('glossary: missing rendering fails on a clinical key, warns on a low-risk key', () => {
        // chat (clinical): "blood pressure" → "pressione arteriosa" dropped.
        const clinical = reviewedXliff(x => x.replace('Pressione arteriosa: {value} mmHg', 'Pressione: {value} mmHg'));
        const res1 = run('xliff-import.mjs', [clinical], root);
        expect(res1.code).toBe(1);
        expect(res1.stdout).toContain('FAIL chat.bp_label: glossary: "blood pressure" must be rendered "pressione arteriosa"');

        // common (low): "patient" → "paziente" dropped → warn, still imports.
        const low = reviewedXliff(x => x.replace('one {# paziente} other {# pazienti}}', 'one {# persona} other {# persone}}'));
        const res2 = run('xliff-import.mjs', [low], root);
        expect(res2.code).toBe(0);
        expect(res2.stdout).toContain('WARN common.patient_count: glossary: "patient" must be rendered "paziente"');
        expect(readJson(join(root, 'it', 'common.json')).patient_count).toBe('{count, plural, one {# persona} other {# persone}}');
    });

    it('skips units whose English changed since export (stale src hash) and unknown keys', () => {
        const file = reviewedXliff(x => x.replace("Di' ciao</target>", 'Saluta</target>'));
        const en = readJson(join(root, 'en', 'chat.json'));
        en.plain = 'Say hi';                     // moved on after the export
        delete en.items;                         // removed after the export
        writeJson(join(root, 'en', 'chat.json'), en);
        expect(computeStatus(root, 'it').totals.removed).toBe(1); // export registered chat.items; en dropped it
        const res = run('xliff-import.mjs', [file], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('SKIP chat.plain: English changed since export');
        expect(res.stdout).toContain('SKIP chat.items: key no longer exists in en');
        expect(readJson(join(root, 'it', 'chat.json')).plain).toBe("Di' ciao");
        // A removed key's status entry is reported by status and pruned by import/export.
        expect(readStatus(root, 'it')['chat.items']).toBeUndefined();
        expect(computeStatus(root, 'it').totals.removed).toBe(0);
    });

    // Regression lock: adversarial review #4 — target-language was trusted as a
    // path component; `x/../en` passed the literal-"en" check and
    // path.join(root, lang, ns.json) landed in the English source.
    describe('path traversal guards', () => {
        const snapshot = () => Object.fromEntries(
            ['en', 'it'].flatMap(l => readdirSync(join(root, l)).map(f => [`${l}/${f}`, readFileSync(join(root, l, f), 'utf8')]))
        );

        it('target-language="x/../en" → exit 2, nothing written anywhere in the tree', () => {
            const file = reviewedXliff(x => x.replaceAll('target-language="it"', 'target-language="x/../en"').replace("Di' ciao</target>", 'PWNED</target>'));
            const before = snapshot();
            const statusBefore = readFileSync(join(root, '.status', 'it.json'), 'utf8'); // written by the export step
            const res = run('xliff-import.mjs', [file], root);
            expect(res.code).toBe(2);
            expect(res.stderr).toMatch(/target-language "x\/\.\.\/en" is not a language code/);
            expect(snapshot()).toEqual(before);
            expect(readFileSync(join(root, '.status', 'it.json'), 'utf8')).toBe(statusBefore);
            expect(existsSync(join(root, 'x'))).toBe(false);
            expect(readdirSync(join(root, '.status'))).toEqual(['it.json']);
        });

        it('rejects a well-shaped language that is not in the registry, and the English source itself', () => {
            const unknown = reviewedXliff(x => x.replaceAll('target-language="it"', 'target-language="xx"'));
            const r1 = run('xliff-import.mjs', [unknown], root);
            expect(r1.code).toBe(2);
            expect(r1.stderr).toContain('not in the language registry');
            expect(existsSync(join(root, 'xx'))).toBe(false);

            const en = reviewedXliff(x => x.replaceAll('target-language="it"', 'target-language="en"'));
            const r2 = run('xliff-import.mjs', [en], root);
            expect(r2.code).toBe(2);
            expect(r2.stderr).toContain('is the English source');
        });

        it('rejects a namespace name that is not <ns>.json or does not exist under en/', () => {
            const before = snapshot();
            const traversal = reviewedXliff(x => x.replace('original="chat.json"', 'original="../en/chat.json"'));
            const r1 = run('xliff-import.mjs', [traversal], root);
            expect(r1.code).toBe(2);
            expect(r1.stderr).toContain('is not a namespace file name');

            const ghost = reviewedXliff(x => x.replace('original="chat.json"', 'original="ghost.json"'));
            const r2 = run('xliff-import.mjs', [ghost], root);
            expect(r2.code).toBe(2);
            expect(r2.stderr).toContain('no such namespace');
            expect(snapshot()).toEqual(before);
            expect(existsSync(join(root, 'it', 'ghost.json'))).toBe(false);
        });

        it('--root must be a locale tree (has en/); a bogus root exits 2', () => {
            const file = reviewedXliff(x => x);
            const res = run('xliff-import.mjs', [file], join(root, 'nope'));
            expect(res.code).toBe(2);
            expect(res.stderr).toContain('is not a locale tree');
        });
    });

    // Regression lock: adversarial review #5 — a unit without <note from="rohy">
    // skipped the en-hash check entirely, so a stripped note could smuggle a
    // stale or forged approved="yes" unit past stale detection.
    describe('missing provenance note', () => {
        const stripNotes = (x) => x
            .replace(/<note from="rohy">[^<]*<\/note>/g, '')
            .replace('<trans-unit id="bp_label" resname="bp_label" approved="no">', '<trans-unit id="bp_label" resname="bp_label" approved="yes">')
            .replace('needs-review-translation" xml:space="preserve">Pressione arteriosa', 'signed-off" xml:space="preserve">Pressione arteriosa')
            .replace("Di' ciao</target>", 'Saluta</target>');

        it('is SKIPPED by default even when approved="yes"; nothing changes', () => {
            const file = reviewedXliff(stripNotes);
            expect(readFileSync(file, 'utf8')).not.toContain('from="rohy"');
            const before = readFileSync(join(root, 'it', 'chat.json'), 'utf8');
            const res = run('xliff-import.mjs', [file, '--reviewer=M. Rossi'], root);
            expect(res.code).toBe(0);
            expect(res.stdout).toContain('SKIP chat.bp_label: no provenance note');
            expect(res.stdout).toContain('SKIP chat.plain: no provenance note');
            expect(res.stdout).toContain('re-export');
            expect(readFileSync(join(root, 'it', 'chat.json'), 'utf8')).toBe(before);
            expect(readStatus(root, 'it')['chat.bp_label']).toMatchObject({ state: 'machine' });
        });

        it('--allow-missing-note imports it capped at reviewed (never approved) with the current en hash stamped', () => {
            const file = reviewedXliff(stripNotes);
            const res = run('xliff-import.mjs', [file, '--reviewer=M. Rossi', '--allow-missing-note'], root);
            expect(res.code).toBe(0);
            expect(res.stdout).toContain('WARN chat.bp_label: no provenance note — imported as reviewed, not approved');
            expect(readJson(join(root, 'it', 'chat.json')).plain).toBe('Saluta');
            const status = readStatus(root, 'it');
            expect(status['chat.bp_label']).toMatchObject({ state: 'reviewed', reviewer: 'M. Rossi', src: hash(EN.chat.bp_label) });
            expect(status['chat.plain']).toMatchObject({ state: 'reviewed', src: hash(EN.chat.plain) });
            expect(Object.values(status).some(e => e.state === 'approved')).toBe(false);
        });

        it('a note without src= counts as missing', () => {
            const file = reviewedXliff(x => x.replace(/<note from="rohy">risk=([a-z]+); icu=(yes|no); src=[0-9a-f]{12}<\/note>/g, '<note from="rohy">risk=$1; icu=$2</note>')
                .replace("Di' ciao</target>", 'Saluta</target>'));
            const res = run('xliff-import.mjs', [file], root);
            expect(res.code).toBe(0);
            expect(res.stdout).toContain('SKIP chat.plain: no provenance note');
            expect(readJson(join(root, 'it', 'chat.json')).plain).toBe("Di' ciao");
        });
    });

    it('refuses a non-XLIFF root or a missing file argument', () => {
        const bad = join(root, 'bad.xlf');
        writeFileSync(bad, '<nope/>');
        expect(run('xliff-import.mjs', [bad], root).code).toBe(2);
        expect(run('xliff-import.mjs', [], root).code).toBe(2);
    });
});

// ---------------------------------------------------------------------------

describe('real locale tree (read-only smoke)', () => {
    const TRANSLATED = ['de', 'es', 'it', 'fi', 'sv'];

    it('i18n:status --json parses and covers every translated language', () => {
        const res = run('status.mjs', ['--json'], REAL_LOCALES);
        expect(res.code).toBe(0);
        const json = JSON.parse(res.stdout);
        for (const lang of TRANSLATED) {
            expect(json[lang], `${lang} missing from report`).toBeDefined();
            expect(json[lang].totals.machine + json[lang].totals.reviewed + json[lang].totals.approved).toBeGreaterThan(1000);
        }
    });

    it.each(TRANSLATED)('%s: every translated key has a committed status entry (bootstrap lock)', (lang) => {
        const status = readStatus(REAL_LOCALES, lang);
        expect(Object.keys(status).length, `src/locales/.status/${lang}.json missing or empty`).toBeGreaterThan(0);
        const missing = [];
        for (const file of readdirSync(join(REAL_LOCALES, 'en')).filter(f => f.endsWith('.json'))) {
            const ns = file.replace(/\.json$/, '');
            const en = readJson(join(REAL_LOCALES, 'en', file));
            const targetPath = join(REAL_LOCALES, lang, file);
            if (!existsSync(targetPath)) continue;
            for (const key of Object.keys(readJson(targetPath))) {
                if (en[key] !== undefined && !status[`${ns}.${key}`]) missing.push(`${ns}.${key}`);
            }
        }
        expect(missing, `run: npm run i18n:status -- --bootstrap ${lang}  (missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''})`).toEqual([]);
        for (const [id, e] of Object.entries(status)) {
            expect(e.src, id).toMatch(/^[0-9a-f]{12}$/);
            expect(['new', 'machine', 'reviewed', 'approved'], id).toContain(e.state);
            expect(['low', 'clinical'], id).toContain(e.risk);
        }
    });
});

// ---------------------------------------------------------------------------
// Phase 0 — "written in stone": tgt hashing, i18n:lock, i18n:verify, and the
// hold-back that stops the machine pass overwriting a human's translation.

/** Run scripts/translate-locales.mjs (one level up from scripts/i18n). */
function runTranslate(args, root) {
    try {
        const stdout = execFileSync(process.execPath, [join(REPO, 'scripts', 'translate-locales.mjs'), ...args, `--root=${root}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
    } catch (err) {
        return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
}

const statusOf = (root, lang = 'it') => readJson(join(root, '.status', `${lang}.json`));
const putStatus = (root, status, lang = 'it') => writeJson(join(root, '.status', `${lang}.json`), status);

describe('i18n:verify', () => {
    beforeEach(() => { run('status.mjs', ['--bootstrap'], root); });

    it('passes on an untouched tree and records tgt for every bootstrapped key', () => {
        const res = run('verify.mjs', ['it'], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('every recorded translation still matches its hash');
        expect(statusOf(root)['chat.plain'].tgt).toBe(hash(IT.chat.plain));
    });

    it('FAILS when an approved translation is overwritten, and names the key', () => {
        const status = statusOf(root);
        status['chat.plain'] = { ...status['chat.plain'], state: 'approved', reviewer: 'M. Rossi' };
        putStatus(root, status);
        const cat = readJson(join(root, 'it', 'chat.json'));
        cat.plain = 'Testo sostituito dalla macchina';
        writeJson(join(root, 'it', 'chat.json'), cat);

        const res = run('verify.mjs', ['it'], root);
        expect(res.code).toBe(1);
        expect(res.stdout).toContain('TAMPERED chat.plain');
        expect(res.stderr).toContain('i18n:verify FAILED');
    });

    it('reports an edited machine string as drift, not failure, and points at i18n:lock', () => {
        const cat = readJson(join(root, 'it', 'chat.json'));
        cat.plain = 'Ciao a tutti';
        writeJson(join(root, 'it', 'chat.json'), cat);

        const res = run('verify.mjs', ['it'], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('machine drift        : 1');
        expect(res.stdout).toContain('npm run i18n:lock');
    });

    it('--backfill stamps entries written before tgt existed', () => {
        const status = statusOf(root);
        delete status['chat.plain'].tgt;          // an entry from the old shape
        putStatus(root, status);

        expect(run('verify.mjs', ['it'], root).stdout).toContain('unstamped (no tgt)   : 1');
        const res = run('verify.mjs', ['it', '--backfill'], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('backfilled 1');
        expect(statusOf(root)['chat.plain'].tgt).toBe(hash(IT.chat.plain));
    });
});

describe('i18n:lock', () => {
    beforeEach(() => { run('status.mjs', ['--bootstrap'], root); });

    it('marks named keys human + locked at the current text, recording the reviewer', () => {
        const res = run('lock.mjs', ['it', 'chat.plain', '--reviewer=M. Rossi'], root);
        expect(res.code).toBe(0);
        const entry = statusOf(root)['chat.plain'];
        expect(entry).toMatchObject({
            state: 'reviewed', origin: 'human', locked: true, reviewer: 'M. Rossi',
            src: hash(EN.chat.plain), tgt: hash(IT.chat.plain)
        });
        expect(entry.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('--all-changed picks up hand edits and nothing else', () => {
        const cat = readJson(join(root, 'it', 'chat.json'));
        cat.plain = 'Salve!';
        writeJson(join(root, 'it', 'chat.json'), cat);

        const res = run('lock.mjs', ['it', '--all-changed', '--reviewer=M. Rossi'], root);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('chat.plain');
        const status = statusOf(root);
        expect(status['chat.plain']).toMatchObject({ origin: 'human', locked: true, tgt: hash('Salve!') });
        expect(status['chat.bp_label'].locked).toBe(false);   // untouched key stays machine
    });

    it('--dry-run writes nothing; --unlock releases the key again', () => {
        const before = JSON.stringify(statusOf(root));
        expect(run('lock.mjs', ['it', 'chat.plain', '--dry-run'], root).stdout).toContain('[dry-run]');
        expect(JSON.stringify(statusOf(root))).toBe(before);

        run('lock.mjs', ['it', 'chat.plain', '--state=approved'], root);
        expect(statusOf(root)['chat.plain']).toMatchObject({ state: 'approved', locked: true });
        run('lock.mjs', ['it', 'chat.plain', '--unlock'], root);
        expect(statusOf(root)['chat.plain'].locked).toBe(false);
    });

    it('rejects an unknown key and a language outside the registry', () => {
        expect(run('lock.mjs', ['it', 'chat.nope'], root).code).toBe(2);
        expect(run('lock.mjs', ['zz', 'chat.plain'], root).code).toBe(2);
    });
});

describe('translate-locales: protected keys are never overwritten', () => {
    /** en moves under an existing translation — the case that used to clobber it. */
    function moveEnglishUnder(key = 'plain') {
        run('status.mjs', ['--bootstrap'], root);
        // .en-hashes.json records the en each translation was made from.
        const hashes = {};
        for (const [ns, obj] of Object.entries(EN)) {
            hashes[ns] = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, hash(v)]));
        }
        writeJson(join(root, '.en-hashes.json'), hashes);
        const en = readJson(join(root, 'en', 'chat.json'));
        en[key] = `${EN.chat[key]} (reworded)`;
        writeJson(join(root, 'en', 'chat.json'), en);
    }

    // Regression lock: an approved translation must survive the English moving.
    // Before this, computeDeltas() sent the key back to the LLM and the
    // reviewer's words were overwritten on disk with no trace.
    it('holds back an approved key instead of queueing it for retranslation', () => {
        moveEnglishUnder();
        const status = statusOf(root);
        status['chat.plain'] = { ...status['chat.plain'], state: 'approved', reviewer: 'M. Rossi' };
        putStatus(root, status);

        const res = runTranslate(['it', '--check'], root);
        expect(res.stdout).toContain('Held back 1 key(s)');
        expect(res.stdout).toContain('it: chat(1)');
        // chat.new_key is genuinely absent from IT and stays a delta; the point
        // is that chat.plain did NOT join it.
        expect(res.stderr).toContain('it/chat: 1 key(s)');
    });

    it('queues the same key when it is only machine-translated', () => {
        moveEnglishUnder();
        const res = runTranslate(['it', '--check'], root);
        expect(res.stdout).not.toContain('Held back');
        expect(res.stderr).toContain('it/chat: 2 key(s)');   // new_key + plain
    });

    it('--force-stale releases reviewed keys but still refuses a locked one', () => {
        moveEnglishUnder();
        run('lock.mjs', ['it', 'chat.plain'], root);          // reviewed + locked
        expect(runTranslate(['it', '--check', '--force-stale'], root).stdout).toContain('Held back 1 key(s)');

        run('lock.mjs', ['it', 'chat.plain', '--unlock'], root);  // reviewed, not locked
        const res = runTranslate(['it', '--check', '--force-stale'], root);
        expect(res.stdout).not.toContain('Held back');
        expect(res.stderr).toContain('it/chat: 2 key(s)');
    });
});

describe('translate-locales: unreviewed clinical glossary', () => {
    // A glossary constrains every other string in a language. Shipping ~4,400
    // strings built on renderings no clinician has agreed is the expensive
    // mistake, and it is not visible in any diff — so the pass refuses.
    it('refuses a language whose glossary is still a draft, before spending anything', () => {
        mkdirSync(join(root, 'fr'), { recursive: true });
        writeJson(join(root, 'fr', 'chat.json'), {});
        const res = runTranslate(['fr'], root);
        expect(res.code).toBe(3);
        expect(res.stderr).toContain('Refusing to translate into a language with an unreviewed glossary');
        expect(res.stdout + res.stderr).toContain('DRAFT');
    });

    it('--accept-draft-glossary proceeds past the refusal (and then needs credentials)', () => {
        mkdirSync(join(root, 'fr'), { recursive: true });
        writeJson(join(root, 'fr', 'chat.json'), {});
        const res = runTranslate(['fr', '--accept-draft-glossary'], root);
        // Past the glossary gate; stops at the token step, which is the next
        // thing a real run needs. Exit 3 would mean the gate never opened.
        expect(res.code).toBe(2);
        expect(res.stderr).toContain('ROHY_TOKEN');
    });

    it('a reviewed-glossary language is not gated', () => {
        const res = runTranslate(['it', '--check'], root);
        expect(res.stdout + res.stderr).not.toContain('unreviewed glossary');
    });
});
