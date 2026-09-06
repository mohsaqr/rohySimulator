#!/usr/bin/env node
// Clinical glossary adherence, checked against catalogues on disk.
//
// `xliff-import.mjs` validates glossary renderings on the way in, but a
// translation written straight into src/locales/<lang>/<ns>.json never passes
// through it — and that is exactly the path a machine pass (or an agent)
// takes. This runs the same two validators over what is actually on disk.
//
// A clinical namespace VIOLATES; a low-risk one WARNS. That split mirrors
// xliff-import: getting "dose" wrong in `orders` can change what a learner
// administers, getting it wrong in `help` cannot.
//
// Usage:
//   npm run i18n:glossary -- it
//   npm run i18n:glossary                  # every language with a glossary
//   npm run i18n:glossary -- fr --check    # exit 1 on any clinical violation
//   npm run i18n:glossary -- it --json
//   --root=<dir> / ROHY_LOCALES_ROOT

import {
    parseArgs, resolveLocalesRoot, assertLocalesRoot, listTargetLanguages, listNamespaces,
    readCatalogue, loadGlossary, unreviewedGlossaries, glossaryTermsIn, targetHasRendering, riskForNamespace, SOURCE_LANGUAGE
} from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
let root;
try { root = assertLocalesRoot(resolveLocalesRoot(flags)); }
catch (err) { console.error(err.message); process.exit(2); }

const glossary = loadGlossary();
const draftLanguages = new Set(unreviewedGlossaries());
let langs;
try { langs = listTargetLanguages(root, positional).filter(l => glossary[l]); }
catch (err) { console.error(err.message); process.exit(2); }

const report = {};
for (const lang of langs) {
    const terms = glossary[lang] || {};
    const violations = [];
    const warnings = [];
    for (const ns of listNamespaces(root)) {
        const en = readCatalogue(root, SOURCE_LANGUAGE, ns);
        const target = readCatalogue(root, lang, ns);
        const risk = riskForNamespace(ns);
        for (const [key, enValue] of Object.entries(en)) {
            const value = target[key];
            if (typeof value !== 'string' || value === '') continue;
            for (const { term, rendering } of glossaryTermsIn(enValue, terms)) {
                if (targetHasRendering(value, rendering)) continue;
                (risk === 'clinical' ? violations : warnings)
                    .push({ id: `${ns}.${key}`, term, rendering, got: value });
            }
        }
    }
    report[lang] = { violations, warnings, draft: draftLanguages.has(lang) };
}

if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    for (const [lang, r] of Object.entries(report)) {
        console.log(`\n== ${lang} ==${r.draft ? '  (glossary is a DRAFT — not native-reviewed)' : ''}`);
        console.log(`  clinical violations : ${r.violations.length}`);
        console.log(`  low-risk warnings   : ${r.warnings.length}`);
        for (const v of r.violations.slice(0, 15)) {
            console.log(`    ${v.id}: "${v.term}" must read "${v.rendering}" — got ${JSON.stringify(v.got.slice(0, 70))}`);
        }
        if (r.violations.length > 15) console.log(`    … and ${r.violations.length - 15} more`);
    }
}

if (flags.check) {
    const failing = Object.entries(report).filter(([, r]) => r.violations.length);
    if (failing.length) {
        console.error(`\ni18n:glossary --check FAILED — ` + failing.map(([l, r]) => `${l}=${r.violations.length}`).join(', '));
        console.error('A pinned clinical term was not used in a clinical namespace. Fix the translation, or change the glossary deliberately.');
        process.exit(1);
    }
    console.log('\ni18n:glossary --check passed — every pinned clinical term is honoured.');
}
