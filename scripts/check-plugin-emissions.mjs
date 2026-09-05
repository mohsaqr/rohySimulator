#!/usr/bin/env node
/**
 * RPS-1 R36 — every verb a plugin declares is EMITTED by its source, or is
 * server-only, or is planned with a note saying what would emit it.
 *
 * A manifest is a claim about the codebase. Before 1.6 the vendored packages
 * declared 46 verbs and emitted 12; the other 34 sat in every analytics
 * legend as things a learner could do and never did. This check reads the
 * plugin's source (its vendored package folder and its adapter under
 * src/plugins/<id>/) and refuses a declared verb nothing produces.
 *
 * How "emitted" is decided, per verb:
 *   1. a component names it — `'VERB'` / `"VERB"` / `SOMETHING.VERB` — in any
 *      source file that is not a vocabulary file; or
 *   2. the package's logger factory (its `*Events.js`) has a helper whose body
 *      names the verb, and a component calls that helper (`.helper(`). A
 *      helper that picks its verb from a kind map (Pathoyon's
 *      ANNOTATION_VERB_BY_KIND) counts for every verb the map names.
 *
 *   node scripts/check-plugin-emissions.mjs [--check] [--json]
 *
 * Exit 0 when every plugin is clean, 1 otherwise (with --check). Read-only.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDORED } from './vendor-plugins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files that DECLARE a vocabulary rather than emit it. */
const VOCABULARY_FILE = /(Events|States|manifest)\.js$/;
const SKIP_FILE = /(\.test\.[jt]sx?|\.md|\.json|\.css)$/;

function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (!SKIP_FILE.test(entry)) out.push(full);
    }
    return out;
}

/** Where a plugin's source lives: its adapter folder plus every vendored folder of its package. */
export function pluginSourceDirs(pluginId, vendored = VENDORED) {
    const dirs = [path.join(ROOT, 'src', 'plugins', pluginId)];
    for (const entry of vendored) {
        if (entry.id === pluginId || entry.id.startsWith(`${pluginId}-`)) dirs.push(path.join(ROOT, entry.into));
    }
    return dirs;
}

/**
 * helper name → verbs its body can emit, read from a logger factory source.
 * A helper is `    name: (…) =>` at 4–8 spaces of indent inside the factory's
 * returned object; its body runs to the next helper at the same indent.
 */
export function helperVerbMap(source, declared) {
    const starts = [...source.matchAll(/^( {4,8})(\w+): \(/gm)];
    const kindMapVerbs = [...(source.match(/VERB_BY_KIND = \{[\s\S]*?\};/)?.[0] ?? '').matchAll(/'([A-Z][A-Z0-9_]+)'/g)]
        .map((m) => m[1]).filter((v) => declared.has(v));
    const map = new Map();
    starts.forEach((m, i) => {
        const body = source.slice(m.index, starts[i + 1]?.index ?? source.length);
        const verbs = new Set([...body.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)].map((x) => x[1]).filter((v) => declared.has(v)));
        if (/VERB_BY_KIND/.test(body)) kindMapVerbs.forEach((v) => verbs.add(v));
        if (verbs.size) map.set(m[2], [...verbs]);
    });
    return map;
}

/**
 * @param {object[]} manifests  the generated manifests
 * @returns {{ok: boolean, plugins: Array<{id: string, declared: number, emitted: string[], missing: string[], planned: Array<{verb: string, note: string}>, serverOnly: string[]}>}}
 */
export function checkPluginEmissions(manifests, { vendored = VENDORED } = {}) {
    const plugins = manifests.map((m) => {
        const verbs = m.vocabulary?.verbs ?? {};
        const declared = new Set(Object.keys(verbs));
        const serverOnly = new Set(m.vocabulary?.serverOnlyVerbs ?? []);
        const files = pluginSourceDirs(m.id, vendored).flatMap((d) => walk(d));
        const vocabularySources = files.filter((f) => VOCABULARY_FILE.test(f)).map((f) => readFileSync(f, 'utf8'));
        const componentSource = files.filter((f) => !VOCABULARY_FILE.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
        const helpers = new Map();
        vocabularySources.forEach((src) => helperVerbMap(src, declared).forEach((v, k) => helpers.set(k, v)));
        const calledHelpers = new Set([...helpers.keys()].filter((h) => new RegExp(`\\.${h}\\(`).test(componentSource)));

        const emitted = [];
        const missing = [];
        const planned = [];
        for (const verb of declared) {
            if (serverOnly.has(verb)) continue;
            const direct = new RegExp(`(['"]${verb}['"]|\\.${verb}\\b)`).test(componentSource);
            const viaHelper = [...helpers.entries()].some(([h, vs]) => vs.includes(verb) && calledHelpers.has(h));
            if (direct || viaHelper) emitted.push(verb);
            else if (verbs[verb]?.emitter === 'planned') planned.push({ verb, note: verbs[verb].emitterNote ?? '' });
            else missing.push(verb);
        }
        return { id: m.id, declared: declared.size, emitted, missing, planned, serverOnly: [...serverOnly] };
    });
    return { ok: plugins.every((p) => p.missing.length === 0 && p.planned.every((x) => x.note.trim())), plugins };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const { PLUGIN_MANIFESTS } = await import('../server/shared/plugins/manifests.generated.js');
    const result = checkPluginEmissions(PLUGIN_MANIFESTS);
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        for (const p of result.plugins) {
            const mark = p.missing.length ? '✗' : '✓';
            console.log(`  ${mark} ${p.id}: ${p.emitted.length}/${p.declared} verbs emitted`
                + (p.serverOnly.length ? `, ${p.serverOnly.length} server-only` : '')
                + (p.planned.length ? `, ${p.planned.length} planned` : ''));
            p.planned.forEach((x) => console.log(`      planned ${x.verb} — ${x.note || '(no note!)'}`));
            p.missing.forEach((v) => console.log(`      MISSING ${v}: declared, never emitted, not server-only, not planned`));
        }
        console.log(result.ok ? 'plugins:emissions OK' : 'plugins:emissions FAILED — every declared verb must be emitted, server-only, or planned with a note (RPS-1 R36)');
    }
    if (process.argv.includes('--check') && !result.ok) process.exit(1);
}
