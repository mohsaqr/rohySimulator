#!/usr/bin/env node
// Locale translation pass (docs/design/i18n-plan.md §7).
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
//   node scripts/translate-locales.mjs --accept-draft-glossary  # allow a language whose
//                                                     # clinical glossary is not yet native-reviewed
//   node scripts/translate-locales.mjs --force-stale  # retranslate reviewed/approved keys too
//                                                     # (never `locked` ones — those need i18n:lock --unlock)
// Env:
//   ROHY_BASE_URL (default http://localhost:3000)
//   ROHY_TOKEN, or ROHY_USERNAME + ROHY_PASSWORD
//
// The change-tracking sidecar (src/locales/.en-hashes.json) records the en
// value each translation was made from; when the en string changes, the key
// is re-translated even though the target already has a value.
//
// WRITTEN IN STONE: a key whose review status is reviewed/approved/locked is
// NOT the machine's to overwrite. The English moving underneath a human's
// translation is a reason to re-export it for review, never a licence to
// discard their words — so those keys are held back and reported instead.
// This pass also stamps its own writes into .status/<lang>.json (as machine,
// with a tgt hash) so `npm run i18n:verify` can detect a later overwrite.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../server/shared/languages.js';
import { hash, readStatus, writeStatus, isProtected, machineEntry, riskForNamespace, resolveLocalesRoot, parseArgs } from './i18n/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// --root / ROHY_LOCALES_ROOT, like every other script in the pipeline, so the
// hold-back logic can be tested against a throwaway tree instead of the real
// catalogues (scripts/i18n/lib.mjs header).
const LOCALES = resolveLocalesRoot(parseArgs(process.argv.slice(2)).flags);
const EN_DIR = join(LOCALES, DEFAULT_LANGUAGE);
const HASHES_PATH = join(LOCALES, '.en-hashes.json');
const GLOSSARY = JSON.parse(readFileSync(join(ROOT, 'scripts', 'i18n-glossary.json'), 'utf8'));
const BASE_URL = process.env.ROHY_BASE_URL || 'http://localhost:3000';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const forceStale = argv.includes('--force-stale');
const requestedLangs = parseArgs(argv).positional;
const targets = (requestedLangs.length ? requestedLangs : Object.keys(LANGUAGES))
    .filter(code => code !== DEFAULT_LANGUAGE && LANGUAGES[code]);

// hash(): sha256[:12] shared with the review pipeline (scripts/i18n/lib.mjs) so
// .en-hashes.json and .status/<lang>.json agree on what "the en value" hashes to.
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const namespaces = readdirSync(EN_DIR).filter(f => f.endsWith('.json'));

// ---- Delta detection -------------------------------------------------------

function computeDeltas() {
    const prevHashes = existsSync(HASHES_PATH) ? readJson(HASHES_PATH) : {};
    const deltas = {}; // { lang: { ns: { key: enValue } } }
    const held = {};   // { lang: { ns: [key] } } — protected, English moved under it
    const nextHashes = {};
    // One read per language, not one per key: the old shape re-read every
    // target catalogue inside the key loop (3,828 keys x 6 locales).
    const status = Object.fromEntries(targets.map(lang => [lang, readStatus(LOCALES, lang)]));
    for (const file of namespaces) {
        const ns = file.replace(/\.json$/, '');
        const en = readJson(join(EN_DIR, file));
        nextHashes[ns] = {};
        const catalogues = Object.fromEntries(targets.map(lang => {
            const targetPath = join(LOCALES, lang, file);
            return [lang, existsSync(targetPath) ? readJson(targetPath) : {}];
        }));
        for (const [key, value] of Object.entries(en)) {
            nextHashes[ns][key] = hash(value);
            for (const lang of targets) {
                const existing = catalogues[lang];
                const stale = prevHashes?.[ns]?.[key] !== hash(value);
                if (existing[key] !== undefined && !(stale && prevHashes?.[ns]?.[key] !== undefined)) continue;
                const entry = status[lang]?.[`${ns}.${key}`];
                // Never overwrite a human's text. --force-stale opts into
                // re-translating reviewed/approved keys; `locked` refuses even
                // then, because that is what the flag is for.
                if (existing[key] !== undefined && isProtected(entry) && (!forceStale || entry.locked === true)) {
                    ((held[lang] ??= {})[ns] ??= []).push(key);
                    continue;
                }
                deltas[lang] ??= {};
                deltas[lang][ns] ??= {};
                deltas[lang][ns][key] = value;
            }
        }
    }
    return { deltas, held, nextHashes };
}

/** Report the keys this pass refused to touch, and why that is not an error. */
function reportHeld(held) {
    const langs = Object.entries(held);
    if (!langs.length) return;
    const total = langs.reduce((n, [, nss]) => n + Object.values(nss).reduce((m, ks) => m + ks.length, 0), 0);
    console.log(`\nHeld back ${total} key(s) — reviewed/approved/locked translations whose English changed:`);
    for (const [lang, nss] of langs) {
        const per = Object.entries(nss).map(([ns, ks]) => `${ns}(${ks.length})`).join(' ');
        console.log(`  ${lang}: ${per}`);
    }
    console.log('  Re-export these for review (npm run i18n:xliff:export) rather than retranslating.');
    console.log('  To retranslate anyway: --force-stale (still refuses locked keys).');
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

// A large namespace (authoring_config has ~600 keys) translated in one call
// makes the LLM run past the proxy's upstream timeout. Split into sub-batches
// small enough to complete reliably; results merge back into one namespace
// file. The de/it/fi/sv locales never hit this because they grew a few keys at
// a time as the app evolved — es is the first from-scratch full translation.
const MAX_KEYS_PER_BATCH = 50;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chunkEntries(entries, size) {
    const keys = Object.keys(entries);
    const chunks = [];
    for (let i = 0; i < keys.length; i += size) {
        chunks.push(Object.fromEntries(keys.slice(i, i + size).map(k => [k, entries[k]])));
    }
    return chunks;
}

async function translateBatch(token, lang, entries, attempt = 0) {
    let res;
    try {
        res = await fetch(`${BASE_URL}/api/proxy/llm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                messages: [{ role: 'user', content: translationPrompt(lang, entries) }],
                system_prompt: 'You are a precise software localization engine. You output only valid JSON.'
            })
        });
    } catch (err) {
        // Network-level failure (socket hangup, DNS) — retry a couple of times.
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); return translateBatch(token, lang, entries, attempt + 1); }
        throw err;
    }
    if (!res.ok) {
        const body = await res.text();
        // 429/5xx (incl. upstream_timeout) are transient — back off and retry.
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
            await sleep(2000 * (attempt + 1));
            return translateBatch(token, lang, entries, attempt + 1);
        }
        throw new Error(`/proxy/llm ${res.status}: ${body}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(jsonText);
}

// ---- Main ------------------------------------------------------------------

const { deltas, held, nextHashes } = computeDeltas();

if (checkOnly) {
    reportHeld(held);
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
    reportHeld(held);
    console.log('Nothing to translate — all locales up to date.');
    writeFileSync(HASHES_PATH, JSON.stringify(nextHashes, null, 2) + '\n');
    process.exit(0);
}

// A glossary is what constrains every other string in a language, so an
// unreviewed one quietly poisons the whole pass. Say so before spending
// anything, and make the operator opt in.
const unreviewed = (GLOSSARY._unreviewed || []).filter(lang => Object.keys(deltas).includes(lang));
if (unreviewed.length) {
    console.warn(`\nWARNING: the clinical glossary for ${unreviewed.join(', ')} is a DRAFT — no native clinician has signed it off.`);
    console.warn('  Every translation below inherits its choices. Have it reviewed (scripts/i18n-glossary.json),');
    console.warn('  then remove the language from "_unreviewed" in the same change.');
    if (!argv.includes('--accept-draft-glossary')) {
        console.error('\nRefusing to translate into a language with an unreviewed glossary. Pass --accept-draft-glossary to proceed anyway.');
        process.exit(3);
    }
}

const token = await getToken();
for (const [lang, nss] of Object.entries(deltas)) {
    mkdirSync(join(LOCALES, lang), { recursive: true });
    for (const [ns, entries] of Object.entries(nss)) {
        const total = Object.keys(entries).length;
        const chunks = chunkEntries(entries, MAX_KEYS_PER_BATCH);
        const targetPath = join(LOCALES, lang, `${ns}.json`);
        for (let i = 0; i < chunks.length; i++) {
            const label = chunks.length > 1 ? ` [batch ${i + 1}/${chunks.length}]` : '';
            console.log(`Translating ${Object.keys(chunks[i]).length}/${total} key(s) → ${lang}/${ns}.json${label}`);
            const translated = await translateBatch(token, lang, chunks[i]);
            // Merge + write after every chunk so a mid-namespace failure is
            // resumable — a re-run skips keys already on disk.
            const existing = existsSync(targetPath) ? readJson(targetPath) : {};
            const merged = Object.fromEntries(
                Object.entries({ ...existing, ...translated }).sort(([a], [b]) => a.localeCompare(b))
            );
            writeFileSync(targetPath, JSON.stringify(merged, null, 2) + '\n');
            // Record what we wrote, so i18n:verify can tell a later overwrite
            // from an honest machine pass. Risk overrides already on the entry
            // are preserved — they are a reviewer's judgement, not ours.
            const status = readStatus(LOCALES, lang);
            for (const key of Object.keys(translated)) {
                if (merged[key] === undefined || entries[key] === undefined) continue;
                const id = `${ns}.${key}`;
                status[id] = { ...machineEntry(entries[key], ns, merged[key]), risk: status[id]?.risk || riskForNamespace(ns) };
            }
            writeStatus(LOCALES, lang, status);
        }
    }
}
writeFileSync(HASHES_PATH, JSON.stringify(nextHashes, null, 2) + '\n');
reportHeld(held);
console.log('Done. Review the git diff — native sign-off is the release gate per language.');
