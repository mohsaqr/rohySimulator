// Emitter coverage — the registry's `emitter` facet is a claim about the
// codebase, and this test makes it checkable.
//
// Forward: every verb a call site names is registered (the literal
// `'ADMINISTERED_MEDICATION'` typed into TreatmentPanel, and `VERBS.CREATED`
// — a constant that never existed — are exactly the bugs this catches).
//
// Reverse: every verb whose facet says `client` has a client emitter — either
// a direct `VERBS.X` / `'X'` reference outside the logger, or a call to the
// EventLogger helper that emits it; every `server` verb is named by a server
// writer; every `plugin` verb is named in a plugin's source. `planned` verbs
// are exempt and PRINTED, so the list cannot quietly grow.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { BASE_VERB_FACETS, VERB_FACETS, LEARNING_VERBS, VERB_ALIASES } from '../../server/shared/learningVerbs.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { checkPluginEmissions } from '../../scripts/check-plugin-emissions.mjs';

const ROOT = path.join(import.meta.dirname, '..', '..');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.(js|jsx|mjs)$/.test(entry) && !/\.test\.(js|jsx)$/.test(entry)) out.push(full);
    }
    return out;
}

const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f);

// Registry files declare verbs; they are not emitters.
const REGISTRY_FILES = new Set([
    'server/shared/learningVerbs.js', 'server/shared/learningVerbFacets.js', 'server/shared/eventFacets.js',
    'server/shared/learningObjectTypes.js', 'server/shared/plugins/manifests.generated.js',
    'server/lib/sessionReconcile.js', 'server/lib/learningEventIngest.js',
]);
const LOGGER = 'src/services/eventLogger.js';

const clientFiles = walk(path.join(ROOT, 'src')).filter((f) => rel(f) !== LOGGER);
const serverFiles = [...walk(path.join(ROOT, 'server', 'routes')), ...walk(path.join(ROOT, 'server', 'lib'))]
    .filter((f) => !REGISTRY_FILES.has(rel(f)));
const loggerSrc = read(path.join(ROOT, LOGGER));

// helper name → verbs it emits, from the logger's own source.
const HELPER_VERBS = new Map();
for (const m of loggerSrc.matchAll(/^\s{4}(\w+)\(([^)]*)\)\s*\{([\s\S]*?)\n\s{4}\}/gm)) {
    const [, name, , body] = m;
    const verbs = [...body.matchAll(/VERBS\.([A-Z_][A-Z0-9_]*)/g)].map((x) => x[1]);
    if (verbs.length) HELPER_VERBS.set(name, verbs);
}
for (const m of loggerSrc.matchAll(/^\s{4}(\w+)\([^)]*\)\s*\{[^\n]*this\.log\(VERBS\.([A-Z_][A-Z0-9_]*)/gm)) {
    const [, name, verb] = m;
    if (!HELPER_VERBS.has(name)) HELPER_VERBS.set(name, [verb]);
}

// A verb reference is `VERBS.X`, or a WHOLE upper-snake string literal in
// verb position (`.log('X'`, `verb: 'X'`). Requiring the closing quote is
// what keeps `console.log('Restored …')` from reading as a verb "R".
const VERB_REF = /(?:VERBS\.([A-Z][A-Z0-9_]+)\b|\.log\(\s*['"]([A-Z][A-Z0-9_]+)['"]|verb:\s*['"]([A-Z][A-Z0-9_]+)['"])/g;

function verbsNamedIn(files) {
    const found = new Map(); // verb → [file]
    for (const f of files) {
        const src = read(f);
        for (const m of src.matchAll(VERB_REF)) {
            const v = m[1] ?? m[2] ?? m[3];
            if (!found.has(v)) found.set(v, []);
            found.get(v).push(rel(f));
        }
    }
    return found;
}

const clientNamed = verbsNamedIn(clientFiles);
const serverNamed = verbsNamedIn(serverFiles);
const clientSrc = clientFiles.map(read).join('\n');

describe('forward: every verb a call site names is registered (or a historical alias)', () => {
    it('client', () => {
        const unknown = [...clientNamed.keys()].filter((v) => !LEARNING_VERBS.includes(v) && !VERB_ALIASES[v]);
        expect(unknown.map((v) => `${v} in ${clientNamed.get(v).join(', ')}`)).toEqual([]);
    });
    it('server', () => {
        const unknown = [...serverNamed.keys()].filter((v) => !LEARNING_VERBS.includes(v) && !VERB_ALIASES[v]);
        expect(unknown.map((v) => `${v} in ${serverNamed.get(v).join(', ')}`)).toEqual([]);
    });
    it('no client file names a historical alias as a verb to EMIT', () => {
        // Reading an alias (analytics, tests) is fine; emitting one means the
        // client is still writing a retired name.
        const emitting = [...clientNamed.keys()].filter((v) => VERB_ALIASES[v])
            .filter((v) => clientNamed.get(v).some((f) => !f.startsWith('src/components/analytics/')));
        expect(emitting.map((v) => `${v} in ${clientNamed.get(v).join(', ')}`)).toEqual([]);
    });
});

describe('reverse: every registered verb has the emitter its facet claims', () => {
    // A helper is "called" when client code invokes it — including the
    // window-lifecycle registrar inside eventLogger.js itself, which is the
    // only caller of focusLost/focusResumed/unload.
    const helperCalled = (helper) => new RegExp(`EventLogger\\.${helper}\\(`).test(clientSrc)
        || new RegExp(`EventLogger\\.${helper}\\(`).test(loggerSrc)
        || new RegExp(`\\b${helper}\\(`).test(clientSrc);

    it('client verbs are emitted by client code', () => {
        const missing = [];
        for (const [verb, f] of Object.entries(BASE_VERB_FACETS)) {
            if (f.emitter !== 'client') continue;
            const direct = clientNamed.has(verb);
            const viaHelper = [...HELPER_VERBS.entries()].some(([helper, verbs]) => verbs.includes(verb) && helperCalled(helper));
            if (!direct && !viaHelper) missing.push(verb);
        }
        expect(missing).toEqual([]);
    });

    it('server verbs are written by server code', () => {
        const missing = [];
        for (const [verb, f] of Object.entries(BASE_VERB_FACETS)) {
            if (f.emitter !== 'server') continue;
            if (!serverNamed.has(verb)) missing.push(verb);
        }
        expect(missing).toEqual([]);
    });

    it('plugin verbs are emitted by their plugin\'s source (RPS-1 R36 — the same check the build runs)', () => {
        // Naming a verb in a vocabulary file is not emitting it; the checker
        // reads helpers and their callers. Detail in plugin-emissions.test.js.
        const result = checkPluginEmissions(PLUGIN_MANIFESTS);
        expect(result.plugins.flatMap((p) => p.missing.map((v) => `${p.id}:${v}`))).toEqual([]);
    });

    it('planned verbs are listed, with a note, and the list only shrinks', () => {
        const planned = Object.entries(BASE_VERB_FACETS).filter(([, f]) => f.emitter === 'planned');
        // eslint-disable-next-line no-console
        console.log(`planned (no emitter yet): ${planned.map(([v, f]) => `${v} — ${f.emitterNote}`).join('\n  ')}`);
        for (const [verb, f] of planned) expect(f.emitterNote, verb).toMatch(/\S/);
        // Ratchet: the number of unemitted rohy verbs after the host emitter
        // pass. Lower it when you wire one; never raise it.
        expect(planned.length).toBeLessThanOrEqual(24);
    });

    it('every folded verb has a facet row', () => {
        for (const verb of LEARNING_VERBS) expect(VERB_FACETS[verb], verb).toBeTruthy();
    });
});
