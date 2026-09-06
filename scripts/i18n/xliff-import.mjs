#!/usr/bin/env node
// XLIFF 1.2 import — step 4 of the review pipeline (docs/integrator/i18n-review.md).
//
// Usage:
//   npm run i18n:xliff:import -- i18n/xliff/it/rohy-it-20260816.xlf --reviewer="M. Rossi"
//   npm run i18n:xliff:import -- file.xlf --dry-run        # validate + report, write nothing
//   --root=<dir> / ROHY_LOCALES_ROOT                        # other locale tree (tests)
//   --allow-missing-note                                    # import units that lost their
//                                                           #   <note from="rohy"> (capped at reviewed)
//
// The file is untrusted input. Its target-language must be a registry
// language (server/shared/languages.js) in canonical shape and every
// <file original> a namespace that exists in <root>/en/ — anything else is
// rejected before a byte is read from the tree, and every path is re-checked
// to sit under <root>/<lang>/ (no `x/../en`, no absolute paths).
//
// Per trans-unit: locate <ns>.<key>; require the rohy provenance note with the
// English hash it was exported against — a unit without one is SKIPPED (the
// hash is what makes stale detection and approval trustworthy; re-export), or
// with --allow-missing-note imported at most as `reviewed`, never `approved`,
// stamped with the current en hash. Skip if the hash no longer matches en (the
// English moved on — re-export); validate target non-empty, braces balanced,
// ICU compiles with the same argument set as en, glossary renderings present
// (fail on clinical keys, warn on low). Then write src/locales/<lang>/<ns>.json
// (sorted keys, 2-space, trailing newline) and the status entry (state from the
// XLIFF, reviewed_at, reviewer, src). Exit 1 on any hard violation — nothing is
// written when the file has one; exit 2 on a malformed file.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    parseArgs, resolveLocalesRoot, assertLocalesRoot, assertTargetLanguage, assertNamespaceFile, safeCataloguePath,
    listNamespaces, readCatalogue, writeCatalogue, readStatus, writeStatus,
    hash, riskForNamespace, loadGlossary, glossaryTermsIn, targetHasRendering, icuArgs, icuCompile,
    bracesBalanced, SOURCE_LANGUAGE
} from './lib.mjs';
import { parseXml, childElements, firstChild, textOf } from './xml.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
if (positional.length !== 1) {
    console.error('Usage: i18n:xliff:import <file.xlf> [--reviewer=name] [--dry-run] [--allow-missing-note]');
    process.exit(2);
}
const root = guard(() => assertLocalesRoot(resolveLocalesRoot(flags)));
const dryRun = Boolean(flags['dry-run']);
const allowMissingNote = Boolean(flags['allow-missing-note']);
const reviewer = typeof flags.reviewer === 'string' ? flags.reviewer : null;
const now = new Date().toISOString();
const glossary = loadGlossary();
const namespaces = new Set(listNamespaces(root));

const xlfPath = resolve(positional[0]);
const doc = parseXml(readFileSync(xlfPath, 'utf8'));
if (doc.name !== 'xliff') { console.error(`${xlfPath}: root element is <${doc.name}>, expected <xliff>`); process.exit(2); }

// ---- Pass 1: validate every unit, collect writes ---------------------------
const summary = {};   // ns → { imported, updated, skipped, violations, warnings }
const bump = (ns, k) => { (summary[ns] ??= { imported: 0, updated: 0, skipped: 0, violations: 0, warnings: 0 })[k] += 1; };
const messages = [];
const writes = [];    // { lang, ns, key, value, state }
let hardViolations = 0;
let importLang = null;

for (const file of childElements(doc, 'file')) {
    const lang = guard(() => assertTargetLanguage(file.attrs['target-language']));
    if (importLang && importLang !== lang) { console.error('One XLIFF file must address a single target language'); process.exit(2); }
    importLang = lang;
    const ns = guard(() => assertNamespaceFile(root, file.attrs.original));
    if (!namespaces.has(ns)) { console.error(`<file original="${file.attrs.original}">: not a namespace in ${root}/en`); process.exit(2); }
    guard(() => safeCataloguePath(root, lang, ns));
    const en = readCatalogue(root, SOURCE_LANGUAGE, ns);
    const target = readCatalogue(root, lang, ns);
    const status = readStatus(root, lang);
    const body = firstChild(file, 'body');
    for (const unit of childElements(body, 'trans-unit')) {
        const key = unit.attrs.resname || unit.attrs.id;
        const id = `${ns}.${key}`;
        const enValue = en[key];
        if (enValue === undefined) { messages.push(`SKIP ${id}: key no longer exists in en`); bump(ns, 'skipped'); continue; }
        const noteMeta = parseRohyNotes(childElements(unit, 'note'));
        const currentSrc = hash(enValue);
        // The rohy note's src= is the only proof of WHICH English the reviewer
        // saw. Without it stale detection is blind and approved="yes" would be
        // taken on faith — so a unit that lost its note is not imported unless
        // the operator opts in, and then never above `reviewed`.
        const missingNote = !noteMeta.src;
        if (missingNote && !allowMissingNote) {
            messages.push(`SKIP ${id}: no provenance note (<note from="rohy"> src=…) — re-export, or pass --allow-missing-note to import as reviewed`);
            bump(ns, 'skipped');
            continue;
        }
        if (!missingNote && noteMeta.src !== currentSrc) {
            messages.push(`SKIP ${id}: English changed since export (src ${noteMeta.src} → ${currentSrc}) — re-export`);
            bump(ns, 'skipped');
            continue;
        }
        const targetEl = firstChild(unit, 'target');
        const xState = targetEl?.attrs.state || 'new';
        const value = textOf(targetEl);
        const approvedAttr = unit.attrs.approved === 'yes';
        if (value === '') {
            if (xState === 'new' || xState === 'needs-translation') { bump(ns, 'skipped'); continue; }
            messages.push(`FAIL ${id}: empty target with state="${xState}"`);
            bump(ns, 'violations'); hardViolations += 1;
            continue;
        }
        const risk = status[id]?.risk || noteMeta.risk || riskForNamespace(ns);
        const problems = validateUnit(enValue, value, glossary[lang] || {});
        const hard = problems.filter(p => p.severity === 'fail' || (p.kind === 'glossary' && risk === 'clinical'));
        const soft = problems.filter(p => !hard.includes(p));
        for (const p of hard) messages.push(`FAIL ${id}: ${p.message}`);
        for (const p of soft) messages.push(`WARN ${id}: ${p.message}`);
        if (soft.length) bump(ns, 'warnings');
        if (hard.length) { bump(ns, 'violations'); hardViolations += hard.length; continue; }

        const changed = target[key] !== value;
        let nextState = statusFromXliff(xState, approvedAttr, changed, status[id]?.state);
        if (missingNote && nextState === 'approved') {
            messages.push(`WARN ${id}: no provenance note — imported as reviewed, not approved (current en hash stamped)`);
            bump(ns, 'warnings');
            nextState = 'reviewed';
        }
        const stateChanged = status[id]?.state !== nextState || status[id]?.src !== currentSrc;
        if (!changed && !stateChanged) { bump(ns, 'skipped'); continue; }
        writes.push({ lang, ns, key, id, value, changed, state: nextState, risk, src: currentSrc, existed: target[key] !== undefined });
        bump(ns, target[key] === undefined ? 'imported' : 'updated');
    }
}

// ---- Report + pass 2: write -----------------------------------------------
for (const m of messages) console.log(m);
console.log(`\n${dryRun ? '[dry-run] ' : ''}${importLang || '?'} ← ${xlfPath}`);
console.log('  namespace            imported  updated  skipped  violations  warnings');
for (const [ns, c] of Object.entries(summary)) {
    console.log(`  ${ns.padEnd(20)} ${String(c.imported).padStart(8)}  ${String(c.updated).padStart(7)}  ${String(c.skipped).padStart(7)}  ${String(c.violations).padStart(10)}  ${String(c.warnings).padStart(8)}`);
}

if (hardViolations) {
    console.error(`\n${hardViolations} hard violation(s) — nothing written. Fix the XLIFF and re-import.`);
    process.exit(1);
}
if (dryRun) { console.log('\nDry run — no files written.'); process.exit(0); }
if (!importLang) { console.log('No <file> elements — nothing to import.'); process.exit(0); }

const status = readStatus(root, importLang);
const byNs = new Map();
for (const w of writes) { if (!byNs.has(w.ns)) byNs.set(w.ns, []); byNs.get(w.ns).push(w); }
for (const [ns, ws] of byNs) {
    const target = readCatalogue(root, importLang, ns);
    for (const w of ws) {
        target[w.key] = w.value;
        const prev = status[w.id] || {};
        const reviewedNow = w.state !== 'machine' && (w.changed || w.state !== prev.state || prev.src !== w.src);
        status[w.id] = {
            src: w.src,
            // Hash the text we are about to write, not what was there before —
            // this is the value i18n:verify will hold the tree to.
            tgt: hash(w.value),
            state: w.state,
            origin: 'xliff',
            // A lock survives an import: it is the operator's standing
            // instruction, not a property of any one round-trip.
            locked: prev.locked === true,
            reviewed_at: reviewedNow ? now : (prev.reviewed_at ?? null),
            reviewer: reviewedNow ? (reviewer ?? prev.reviewer ?? null) : (prev.reviewer ?? null),
            risk: prev.risk || w.risk
        };
    }
    writeCatalogue(root, importLang, ns, target);
}
// Prune status entries whose key left en (the report step only reports them).
let pruned = 0;
for (const id of Object.keys(status)) {
    const dot = id.indexOf('.');
    const ns = id.slice(0, dot);
    const key = id.slice(dot + 1);
    if (!namespaces.has(ns) || readCatalogue(root, SOURCE_LANGUAGE, ns)[key] === undefined) { delete status[id]; pruned += 1; }
}
if (writes.length || pruned) writeStatus(root, importLang, status);
console.log(`\nWrote ${writes.length} value(s) into ${root}/${importLang}/` +
    (writes.length || pruned ? ` and updated ${root}/.status/${importLang}.json` : '') +
    (pruned ? ` (pruned ${pruned} removed entr${pruned === 1 ? 'y' : 'ies'})` : ''));

// ---- helpers ---------------------------------------------------------------

/** Run a validator; on failure print its message and exit 2 (malformed input, nothing written). */
function guard(fn) {
    try { return fn(); } catch (err) { console.error(err.message); process.exit(2); }
}

function parseRohyNotes(notes) {
    const meta = {};
    for (const n of notes) {
        if (n.attrs.from !== 'rohy') continue;
        for (const part of textOf(n).split(';')) {
            const [k, ...rest] = part.split('=');
            if (k && rest.length) meta[k.trim()] = rest.join('=').trim();
        }
    }
    return meta;
}

/** XLIFF target state → status state. `approved="yes"` or signed-off/final always wins. */
function statusFromXliff(xState, approvedAttr, changed, prevState) {
    if (approvedAttr || xState === 'signed-off' || xState === 'final') return 'approved';
    if (xState === 'translated') return 'reviewed';
    // needs-* / new with a non-empty target: a reviewer touched it if the text changed.
    if (changed) return 'reviewed';
    return prevState && prevState !== 'new' ? prevState : 'machine';
}

/** All problems with a target string against its English source. */
function validateUnit(enValue, value, glossaryForLang) {
    const problems = [];
    if (!bracesBalanced(value)) problems.push({ kind: 'braces', severity: 'fail', message: 'unbalanced {braces} in target' });
    const compiled = icuCompile(value);
    if (!compiled.ok) {
        problems.push({ kind: 'icu', severity: 'fail', message: `target is not valid ICU MessageFormat: ${compiled.error}` });
    } else {
        const enCompiled = icuCompile(enValue);
        if (enCompiled.ok) {
            const want = [...icuArgs(enValue)].sort();
            const have = [...icuArgs(value)].sort();
            if (JSON.stringify(want) !== JSON.stringify(have)) {
                problems.push({ kind: 'icu', severity: 'fail', message: `ICU arguments differ — source {${want.join(', ')}} vs target {${have.join(', ')}}` });
            }
        }
    }
    for (const { term, rendering } of glossaryTermsIn(enValue, glossaryForLang)) {
        if (!targetHasRendering(value, rendering)) {
            problems.push({ kind: 'glossary', severity: 'warn', message: `glossary: "${term}" must be rendered "${rendering}"` });
        }
    }
    return problems;
}
