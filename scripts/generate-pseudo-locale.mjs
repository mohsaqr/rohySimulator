#!/usr/bin/env node
// Pseudo-locale generator (I18N_PLAN.md §6): builds src/locales/en-XA/ from
// src/locales/en/ with accented characters and ~40% length padding.
//
// Running the app with ?pseudo=1 then renders en-XA everywhere a real
// translation would go — any string that still reads as plain ASCII English
// is hardcoded (missed extraction), and any truncated/overflowing layout
// will break the same way under Finnish/Swedish (~30% longer than English)
// BEFORE translation money is spent.
//
// ICU-safe: text inside {…} argument syntax (placeholders, plural/select
// clauses' argument names) is preserved verbatim; only translatable text is
// transformed. Regenerate after every extraction: npm run i18n:pseudo.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EN_DIR = join(ROOT, 'src', 'locales', 'en');
const XA_DIR = join(ROOT, 'src', 'locales', 'en-XA');

const ACCENTS = {
    a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ğ', h: 'ĥ', i: 'í',
    j: 'ĵ', k: 'ķ', l: 'ĺ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: ' q', r: 'ŕ',
    s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
    A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ğ', H: 'Ĥ', I: 'Í',
    J: 'Ĵ', K: 'Ķ', L: 'Ĺ', M: 'M', N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Q', R: 'Ŕ',
    S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž'
};

function pseudoize(value) {
    let out = '';
    let depth = 0; // ICU {…} nesting — never transform inside
    let letters = 0;
    for (const ch of value) {
        if (ch === '{') { depth += 1; out += ch; continue; }
        if (ch === '}') { depth = Math.max(0, depth - 1); out += ch; continue; }
        if (depth > 0) { out += ch; continue; }
        if (ACCENTS[ch]) { letters += 1; out += ACCENTS[ch]; continue; }
        out += ch;
    }
    // ~40% padding, proportional to translatable length (Finnish/Swedish
    // run ~30% longer; 40% gives margin).
    const pad = Math.ceil(letters * 0.4 / 2);
    return pad > 0 ? `[${out}${'·'.repeat(pad)}]` : out;
}

function walk(node) {
    if (typeof node === 'string') return pseudoize(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
}

mkdirSync(XA_DIR, { recursive: true });
const files = readdirSync(EN_DIR).filter(f => f.endsWith('.json'));
for (const file of files) {
    const en = JSON.parse(readFileSync(join(EN_DIR, file), 'utf8'));
    writeFileSync(join(XA_DIR, file), JSON.stringify(walk(en), null, 2) + '\n');
}
console.log(`Generated ${files.length} en-XA namespace(s) in src/locales/en-XA/`);
