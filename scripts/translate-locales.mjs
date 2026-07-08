#!/usr/bin/env node
// Locale translation pass (I18N_PLAN.md §7).
//
// Diffs src/locales/en/*.json against each target locale and translates ONLY
// missing or en-changed keys through the app's own /api/proxy/llm, with the
// pinned clinical glossary (scripts/i18n-glossary.json) and ICU-syntax
// preservation instructions. Deterministic keys → re-runs touch only deltas,
// so native review stays a small git diff per PR, never a from-scratch
// spreadsheet.
//
// Usage:
//   node scripts/translate-locales.mjs            # all registry languages
//   node scripts/translate-locales.mjs it sv      # subset
//   node scripts/translate-locales.mjs --check    # exit 1 if any locale is missing keys (CI)
// Env:
//   ROHY_BASE_URL (default http://localhost:3000)
//   ROHY_TOKEN, or ROHY_USERNAME + ROHY_PASSWORD
//
// The change-tracking sidecar (src/locales/.en-hashes.json) records the en
// value each translation was made from; when the en string changes, the key
// is re-translated even though the target already has a value.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../server/shared/languages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = join(ROOT, 'src', 'locales');
const EN_DIR = join(LOCALES, DEFAULT_LANGUAGE);
const HASHES_PATH = join(LOCALES, '.en-hashes.json');
const GLOSSARY = JSON.parse(readFileSync(join(ROOT, 'scripts', 'i18n-glossary.json'), 'utf8'));
const BASE_URL = process.env.ROHY_BASE_URL || 'http://localhost:3000';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const requestedLangs = argv.filter(a => !a.startsWith('--'));
const targets = (requestedLangs.length ? requestedLangs : Object.keys(LANGUAGES))
    .filter(code => code !== DEFAULT_LANGUAGE && LANGUAGES[code]);

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const namespaces = readdirSync(EN_DIR).filter(f => f.endsWith('.json'));

// ---- Delta detection -------------------------------------------------------

function computeDeltas() {
    const prevHashes = existsSync(HASHES_PATH) ? readJson(HASHES_PATH) : {};
    const deltas = {}; // { lang: { ns: { key: enValue } } }
    const nextHashes = {};
    for (const file of namespaces) {
        const ns = file.replace(/\.json$/, '');
        const en = readJson(join(EN_DIR, file));
        nextHashes[ns] = {};
        for (const [key, value] of Object.entries(en)) {
            nextHashes[ns][key] = hash(value);
            for (const lang of targets) {
                const targetPath = join(LOCALES, lang, file);
                const existing = existsSync(targetPath) ? readJson(targetPath) : {};
                const stale = prevHashes?.[ns]?.[key] !== hash(value);
                if (existing[key] === undefined || (stale && prevHashes?.[ns]?.[key] !== undefined)) {
                    deltas[lang] ??= {};
                    deltas[lang][ns] ??= {};
                    deltas[lang][ns][key] = value;
                }
            }
        }
    }
    return { deltas, nextHashes };
}

// ---- LLM translation -------------------------------------------------------

async function getToken() {
    if (process.env.ROHY_TOKEN) return process.env.ROHY_TOKEN;
    const { ROHY_USERNAME: u, ROHY_PASSWORD: p } = process.env;
    if (!u || !p) {
        console.error('Set ROHY_TOKEN, or ROHY_USERNAME + ROHY_PASSWORD.');
        process.exit(2);
    }
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
    });
    if (!res.ok) { console.error(`Login failed: ${res.status}`); process.exit(2); }
    return (await res.json()).token;
}

function translationPrompt(lang, entries) {
    const glossary = Object.entries(GLOSSARY[lang] || {})
        .map(([en, tr]) => `  "${en}" → "${tr}"`).join('\n');
    return `You are translating UI strings for a medical patient-simulation app from English to ${LANGUAGES[lang].name} (${LANGUAGES[lang].native}).

RULES (all mandatory):
1. Output ONLY a JSON object mapping each key to its translated string. No commentary, no markdown fences.
2. Preserve ICU MessageFormat syntax EXACTLY: anything in {braces} (argument names, plural/select keywords like "plural", "one", "other", "#") must survive untouched; translate only the human-readable text between them.
3. Clinical glossary — use EXACTLY these renderings:
${glossary}
4. Keep clinical units and standard abbreviations unchanged (mmHg, bpm, SpO2, mg, ml).
5. Match the register of a clinical teaching tool: professional, concise, natural ${LANGUAGES[lang].name}.
6. Keep translations approximately as short as the English where possible — these are UI labels.

STRINGS TO TRANSLATE:
${JSON.stringify(entries, null, 2)}`;
}

async function translateBatch(token, lang, entries) {
    const res = await fetch(`${BASE_URL}/api/proxy/llm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
            messages: [{ role: 'user', content: translationPrompt(lang, entries) }],
            system_prompt: 'You are a precise software localization engine. You output only valid JSON.'
        })
    });
    if (!res.ok) throw new Error(`/proxy/llm ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(jsonText);
}

// ---- Main ------------------------------------------------------------------

const { deltas, nextHashes } = computeDeltas();

if (checkOnly) {
    const missing = Object.entries(deltas)
        .flatMap(([lang, nss]) => Object.entries(nss)
            .map(([ns, keys]) => `${lang}/${ns}: ${Object.keys(keys).length} key(s)`));
    if (missing.length) {
        console.error('Locales out of sync with en:\n  ' + missing.join('\n  '));
        process.exit(1);
    }
    console.log('All locales in sync.');
    process.exit(0);
}

if (!Object.keys(deltas).length) {
    console.log('Nothing to translate — all locales up to date.');
    writeFileSync(HASHES_PATH, JSON.stringify(nextHashes, null, 2) + '\n');
    process.exit(0);
}

const token = await getToken();
for (const [lang, nss] of Object.entries(deltas)) {
    mkdirSync(join(LOCALES, lang), { recursive: true });
    for (const [ns, entries] of Object.entries(nss)) {
        console.log(`Translating ${Object.keys(entries).length} key(s) → ${lang}/${ns}.json`);
        const translated = await translateBatch(token, lang, entries);
        const targetPath = join(LOCALES, lang, `${ns}.json`);
        const existing = existsSync(targetPath) ? readJson(targetPath) : {};
        const merged = Object.fromEntries(
            Object.entries({ ...existing, ...translated }).sort(([a], [b]) => a.localeCompare(b))
        );
        writeFileSync(targetPath, JSON.stringify(merged, null, 2) + '\n');
    }
}
writeFileSync(HASHES_PATH, JSON.stringify(nextHashes, null, 2) + '\n');
console.log('Done. Review the git diff — native sign-off is the release gate per language.');
