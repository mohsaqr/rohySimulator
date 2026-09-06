#!/usr/bin/env node
// Plugin locale gate (layer 2 of the i18n resolution order).
//
// A plugin ships its own translations at src/plugins/<id>/locales/<lang>.json
// so it works on install without rohy translating anything. Those files are
// the plugin author's, not rohy's — which makes them exactly the kind of input
// that has to be checked before it renders to a student. This is where the
// expensive checks live, so server/shared/pluginRegistry.js (imported by both
// halves of the app) stays free of intl-messageformat.
//
// Checks, per plugin:
//   - the folder belongs to a real plugin, and every <lang> is a registry
//     language (server/shared/languages.js)
//   - en.json exists whenever any other language does — English is the key set
//     everything else is measured against, and the inline fallback's contract
//   - every non-English key exists in English (a translation for a key the
//     code never asks for can never render)
//   - braces balance, ICU compiles, and the argument set matches English
//     exactly — a plugin shipping a broken plural must fail the build, not
//     print `{count` to a learner
//   - no two plugins ship the same string in the same namespace
//
// It also REPORTS which plugin strings rohy already shadows in
// src/locales/<lang>/<ns>.json. That is not an error — rohy overriding a
// plugin is the intended act — but it is worth seeing.
//
// Usage:
//   node scripts/check-plugin-locales.mjs           # report
//   node scripts/check-plugin-locales.mjs --check   # exit 1 on any violation (CI)

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../server/shared/languages.js';
import { localeNamespaceOf, resolveLocaleLayers } from '../server/shared/pluginRegistry.js';
import { PLUGIN_MANIFESTS } from '../server/shared/plugins/manifests.generated.js';
import { REPO_ROOT, icuCompile, icuArgs, bracesBalanced } from './i18n/lib.mjs';

const checkOnly = process.argv.includes('--check');
const PLUGIN_DIR = join(REPO_ROOT, 'src', 'plugins');
const LOCALES = join(REPO_ROOT, 'src', 'locales');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const violations = [];
const notes = [];
const fail = (msg) => violations.push(msg);

const manifestById = new Map(PLUGIN_MANIFESTS.map(m => [m.id, m]));

/** [{ id, namespace, lang, table, file }] for every catalogue on disk. */
function discover() {
    if (!existsSync(PLUGIN_DIR)) return [];
    const out = [];
    for (const entry of readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(PLUGIN_DIR, entry.name, 'locales');
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
        const manifest = manifestById.get(entry.name);
        if (!manifest) {
            fail(`src/plugins/${entry.name}/locales/ exists but '${entry.name}' is not a registered plugin — run npm run plugins:gen`);
            continue;
        }
        for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
            const lang = file.replace(/\.json$/, '');
            if (lang !== DEFAULT_LANGUAGE && !Object.prototype.hasOwnProperty.call(LANGUAGES, lang)) {
                fail(`${entry.name}/locales/${file}: '${lang}' is not in the language registry (server/shared/languages.js)`);
                continue;
            }
            let table;
            try { table = readJson(join(dir, file)); }
            catch (err) { fail(`${entry.name}/locales/${file}: not valid JSON — ${err.message}`); continue; }
            if (typeof table !== 'object' || table === null || Array.isArray(table)) {
                fail(`${entry.name}/locales/${file}: must be a flat object of key → string`);
                continue;
            }
            out.push({ id: entry.name, namespace: localeNamespaceOf(manifest), lang, table, file: `${entry.name}/locales/${file}` });
        }
    }
    return out;
}

const catalogues = discover();
const byPlugin = new Map();
for (const c of catalogues) {
    if (!byPlugin.has(c.id)) byPlugin.set(c.id, new Map());
    byPlugin.get(c.id).set(c.lang, c);
}

for (const [id, langs] of byPlugin) {
    const source = langs.get(DEFAULT_LANGUAGE);
    if (!source) {
        fail(`${id} ships ${[...langs.keys()].join(', ')} but no ${DEFAULT_LANGUAGE}.json — English is the key set the others are checked against`);
        continue;
    }
    for (const [key, value] of Object.entries(source.table)) {
        if (typeof value !== 'string') { fail(`${source.file}: key '${key}' is ${typeof value}, not a string`); continue; }
        if (!bracesBalanced(value)) fail(`${source.file}: '${key}' has unbalanced {braces}`);
        const compiled = icuCompile(value);
        if (!compiled.ok) fail(`${source.file}: '${key}' is not valid ICU — ${compiled.error}`);
    }
    for (const [lang, cat] of langs) {
        if (lang === DEFAULT_LANGUAGE) continue;
        for (const [key, value] of Object.entries(cat.table)) {
            if (typeof value !== 'string') { fail(`${cat.file}: key '${key}' is ${typeof value}, not a string`); continue; }
            const en = source.table[key];
            if (en === undefined) {
                fail(`${cat.file}: translates '${key}', which ${id}/locales/${DEFAULT_LANGUAGE}.json does not define`);
                continue;
            }
            if (!bracesBalanced(value)) { fail(`${cat.file}: '${key}' has unbalanced {braces}`); continue; }
            const compiled = icuCompile(value);
            if (!compiled.ok) { fail(`${cat.file}: '${key}' is not valid ICU — ${compiled.error}`); continue; }
            if (!icuCompile(en).ok) continue;   // already reported against English
            const want = [...icuArgs(en)].sort();
            const have = [...icuArgs(value)].sort();
            if (JSON.stringify(want) !== JSON.stringify(have)) {
                fail(`${cat.file}: '${key}' ICU arguments differ — English {${want.join(', ')}} vs {${have.join(', ')}}`);
            }
        }
        const missing = Object.keys(source.table).filter(k => cat.table[k] === undefined);
        if (missing.length) {
            notes.push(`${cat.file}: ${missing.length} key(s) untranslated — they fall through to English`);
        }
    }
}

// Two plugins fighting over one string has no principled winner.
for (const lang of new Set(catalogues.map(c => c.lang))) {
    try { resolveLocaleLayers(catalogues.filter(c => c.lang === lang)); }
    catch (err) { fail(err.message); }
}

// Informational: what rohy shadows. Not a violation — that is layer 1's job.
for (const c of catalogues) {
    const rohyPath = join(LOCALES, c.lang, `${c.namespace}.json`);
    if (!existsSync(rohyPath)) continue;
    const rohy = readJson(rohyPath);
    const shadowed = Object.keys(c.table).filter(k => rohy[k] !== undefined);
    if (shadowed.length) notes.push(`${c.file}: rohy overrides ${shadowed.length} of ${Object.keys(c.table).length} string(s)`);
}

// Cross-namespace duplicates. A plugin's namespace is self-contained, so a
// generic word it also defines ('close', 'cancel') is fine — each namespace
// stands alone. But a key rohy CONSUMES from common/app (a manifest
// `labelKey`, a room subtitle, a document summary) has its plugin-namespace
// copy read by nobody: RoomNavigator resolves `t(room.labelKey)` against
// common. That copy is inert, and it will drift from the one that renders.
// Reported, not failed — telling the two apart needs a human.
{
    const hostOwned = {};
    for (const ns of ['common', 'app']) {
        const p = join(LOCALES, DEFAULT_LANGUAGE, `${ns}.json`);
        if (existsSync(p)) Object.keys(readJson(p)).forEach(k => { hostOwned[k] = ns; });
    }
    for (const c of catalogues.filter(x => x.lang === DEFAULT_LANGUAGE)) {
        const dup = Object.keys(c.table).filter(k => hostOwned[k]);
        if (dup.length) {
            notes.push(`${c.file}: ${dup.length} key(s) also defined in rohy's `
                + `${[...new Set(dup.map(k => hostOwned[k]))].join('/')} — ${dup.slice(0, 8).join(', ')}`
                + `${dup.length > 8 ? ' …' : ''}. If rohy reads one from there (a manifest labelKey, a room `
                + `subtitle, a summary), the copy here renders for nobody and will drift.`);
        }
    }
}

const plugins = [...byPlugin.keys()];
console.log(plugins.length
    ? `Checked ${catalogues.length} catalogue(s) across ${plugins.length} plugin(s): ${plugins.join(', ')}`
    : 'No plugin ships locales yet.');
for (const n of notes) console.log(`  note: ${n}`);
for (const v of violations) console.error(`  FAIL: ${v}`);

if (violations.length) {
    console.error(`\n${violations.length} plugin locale violation(s).`);
    process.exit(checkOnly ? 1 : 1);
}
console.log('Plugin locales OK.');
