#!/usr/bin/env node
// The English source of the vendored lessons module's strings.
//
// src/components/lessons/** came from LAILA with its own i18n: every t() call
// carries its English as `{ defaultValue: '…' }` and names LAILA's namespaces
// (`teaching`, `courses`, `navigation`, `common`, `authoring_lessons`). rohy's
// extractor skips the module (i18next-parser.config.js), so its English is not
// in src/locales/en. Translations live beside the module, one file per
// language: src/components/lessons/locales/<lang>.json, shaped
// { "<namespace>": { "<key>": "<ICU message>" } }, layered UNDER rohy's own
// catalogues at runtime (src/components/lessons/locales/index.js).
//
// This walks the module with the same lexer i18n:check uses and returns, per
// namespace, every key the module needs translated and its English. A key that
// rohy's own catalogue already resolves for the file (e.g. `common:loading`) is
// left out: rohy's translation wins at runtime anyway.
//
//   node scripts/i18n/lessons-catalogue.mjs            # print the English source as JSON
//   node scripts/i18n/lessons-catalogue.mjs --missing  # keys each locale lacks / has extra

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsxLexer } from 'i18next-parser';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const LESSONS_DIR = path.join(ROOT, 'src/components/lessons');
export const LESSONS_LOCALES_DIR = path.join(LESSONS_DIR, 'locales');
const ROHY_EN_DIR = path.join(ROOT, 'src/locales/en');

// A helper that receives `t` from its caller (surveyOptionTools.js gets
// SurveyManager's) has no useTranslation of its own; its caller's first
// namespace is `teaching`.
const DEFAULT_NAMESPACE = 'teaching';

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'locales' ? [] : sourceFiles(full);
        return /\.jsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : [];
    });
}

/** The namespaces of a file's first useTranslation(), in lookup order. */
function fileNamespaces(src) {
    const first = src.match(/useTranslation\(([^)]*)\)/);
    if (!first) return [DEFAULT_NAMESPACE];
    const names = [...first[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]);
    return names.length ? names : ['common'];
}

function readRohyEnglish() {
    const out = {};
    for (const file of fs.readdirSync(ROHY_EN_DIR).filter((n) => n.endsWith('.json'))) {
        out[file.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(ROHY_EN_DIR, file), 'utf8'));
    }
    return out;
}

/**
 * Every message the lessons module renders that rohy does not already own.
 * @returns {{messages: Record<string, Record<string, string>>, calls: number}}
 */
export function extractLessonsMessages() {
    const rohy = readRohyEnglish();
    const messages = {};
    let calls = 0;
    for (const file of sourceFiles(LESSONS_DIR)) {
        const src = fs.readFileSync(file, 'utf8');
        const lookup = fileNamespaces(src);
        // A fresh lexer per file: JsxLexer carries the last useTranslation()
        // namespace across files otherwise.
        for (const entry of new JsxLexer({ functions: ['t'] }).extract(src, file)) {
            calls += 1;
            const [ns, key] = entry.key.includes(':')
                ? entry.key.split(/:(.*)/s, 2)
                : [lookup[0], entry.key];
            const searched = entry.key.includes(':') ? [ns] : lookup;
            if (searched.some((n) => rohy[n] && typeof rohy[n][key] === 'string')) continue;
            const english = typeof entry.defaultValue === 'string' ? entry.defaultValue : '';
            messages[ns] ??= {};
            // Two call sites may phrase the same key differently; the first
            // wins, as one catalogue entry serves both.
            if (!(key in messages[ns])) messages[ns][key] = english;
        }
    }
    const sorted = Object.fromEntries(Object.keys(messages).sort().map((ns) => [
        ns, Object.fromEntries(Object.keys(messages[ns]).sort().map((k) => [k, messages[ns][k]])),
    ]));
    return { messages: sorted, calls };
}

/** Languages that ship a lessons catalogue (file names under locales/). */
export function lessonsLocaleFiles() {
    return fs.readdirSync(LESSONS_LOCALES_DIR)
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.replace(/\.json$/, ''))
        .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { messages } = extractLessonsMessages();
    if (process.argv.includes('--missing')) {
        for (const lang of lessonsLocaleFiles()) {
            const table = JSON.parse(fs.readFileSync(path.join(LESSONS_LOCALES_DIR, `${lang}.json`), 'utf8'));
            const missing = [];
            const extra = [];
            for (const [ns, keys] of Object.entries(messages)) {
                for (const key of Object.keys(keys)) if (!(table[ns] && key in table[ns])) missing.push(`${ns}:${key}`);
            }
            for (const [ns, keys] of Object.entries(table)) {
                for (const key of Object.keys(keys)) if (!(messages[ns] && key in messages[ns])) extra.push(`${ns}:${key}`);
            }
            console.log(`${lang}: ${missing.length} missing, ${extra.length} extra`);
            missing.forEach((k) => console.log(`  - ${k}`));
            extra.forEach((k) => console.log(`  + ${k}`));
        }
    } else {
        process.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
    }
}
