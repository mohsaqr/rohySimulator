#!/usr/bin/env node
// Translation integrity check — "written in stone" enforcement.
//
// The status sidecar records `tgt`, the hash of the translation itself, next
// to `src`, the hash of the English it was made from. `src` tells you the
// English moved; `tgt` tells you THE TRANSLATION moved. Without the second
// one, a reviewed string could be overwritten — by the LLM pass, a bad merge,
// a stray edit — and nothing in the tree would know.
//
// Usage:
//   npm run i18n:verify                    # every target language
//   npm run i18n:verify -- it de           # subset
//   npm run i18n:verify -- --json
//   npm run i18n:verify -- --backfill      # stamp tgt on entries that predate it
//   npm run i18n:verify -- --strict        # drift on machine entries also fails
//   --root=<dir> / ROHY_LOCALES_ROOT       # another locale tree (tests)
//
// Exit 1 when a PROTECTED string (reviewed / approved / locked) no longer
// matches its recorded hash. A machine string that changed is reported as
// drift, not failure — that is usually a hand edit, and the fix is to record
// it with `npm run i18n:lock`, not to revert it.

import {
    parseArgs, resolveLocalesRoot, assertLocalesRoot, listTargetLanguages, listNamespaces,
    readCatalogue, readStatus, writeStatus, isProtected, hash
} from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
let root;
try { root = assertLocalesRoot(resolveLocalesRoot(flags)); }
catch (err) { console.error(err.message); process.exit(2); }

const backfill = Boolean(flags.backfill);
const strict = Boolean(flags.strict);
let langs;
try { langs = listTargetLanguages(root, positional); }
catch (err) { console.error(err.message); process.exit(2); }

const report = {};

for (const lang of langs) {
    const status = readStatus(root, lang);
    const tampered = [];   // protected, text no longer matches — a defect
    const drifted = [];    // machine, text changed — probably a hand edit
    const unstamped = [];  // entry predates `tgt`
    let stamped = 0;

    for (const ns of listNamespaces(root)) {
        const target = readCatalogue(root, lang, ns);
        for (const [key, value] of Object.entries(target)) {
            const id = `${ns}.${key}`;
            const entry = status[id];
            if (!entry) continue;
            const actual = hash(value);
            if (entry.tgt === null || entry.tgt === undefined) {
                unstamped.push(id);
                // Backfill records what is on disk NOW as the baseline. It can
                // only ever be honest about the present — it cannot vouch for
                // text written before anything was hashing it.
                if (backfill) { status[id] = { ...entry, tgt: actual }; stamped += 1; }
                continue;
            }
            if (entry.tgt === actual) continue;
            (isProtected(entry) ? tampered : drifted).push({ id, state: entry.state, origin: entry.origin, locked: entry.locked === true });
        }
    }

    if (backfill && stamped) writeStatus(root, lang, status);
    report[lang] = { tampered, drifted, unstamped: unstamped.length, stamped };
}

if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    for (const [lang, r] of Object.entries(report)) {
        console.log(`\n== ${lang} ==`);
        console.log(`  protected mismatches : ${r.tampered.length}`);
        console.log(`  machine drift        : ${r.drifted.length}`);
        console.log(`  unstamped (no tgt)   : ${r.unstamped}${r.stamped ? ` — backfilled ${r.stamped}` : ''}`);
        for (const t of r.tampered.slice(0, 20)) {
            console.log(`    TAMPERED ${t.id} (${t.state}${t.locked ? ', locked' : ''}, origin ${t.origin})`);
        }
        if (r.tampered.length > 20) console.log(`    … and ${r.tampered.length - 20} more`);
        if (r.drifted.length) {
            console.log(`    drift: ${r.drifted.slice(0, 10).map(d => d.id).join(', ')}${r.drifted.length > 10 ? ' …' : ''}`);
            console.log(`    → these look hand-edited. Record them: npm run i18n:lock -- ${lang} --all-changed --reviewer="you"`);
        }
    }
}

const failing = Object.entries(report).filter(([, r]) => r.tampered.length || (strict && r.drifted.length));
if (failing.length) {
    console.error(`\ni18n:verify FAILED — ` + failing
        .map(([lang, r]) => `${lang}=${r.tampered.length}${strict && r.drifted.length ? `+${r.drifted.length} drift` : ''}`)
        .join(', '));
    console.error('A reviewed translation was overwritten. Restore it from git, or re-review and re-lock it.');
    process.exit(1);
}
console.log('\ni18n:verify passed — every recorded translation still matches its hash.');
