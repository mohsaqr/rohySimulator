#!/usr/bin/env node
// Mark translations as human-owned — "written in stone".
//
// The XLIFF round-trip (export → translator → import) is the formal review
// path, but it is not the only way a string becomes a person's words: someone
// edits src/locales/it/chat.json directly, or fixes a phrase in review. Those
// edits left no trace — the sidecar still said `machine`, and the next
// translation pass would overwrite them. This is how you say "this one is
// mine" without a round-trip.
//
// Usage:
//   npm run i18n:lock -- it chat.send_button common.save --reviewer="M. Saqr"
//   npm run i18n:lock -- it --all-changed --reviewer="M. Saqr"   # every key whose
//                                                                 # text moved since it was stamped
//   npm run i18n:lock -- it --all-changed --dry-run
//   npm run i18n:lock -- it chat.send_button --unlock            # release it to the machine again
//   npm run i18n:lock -- it common.save --state=approved
//   --root=<dir> / ROHY_LOCALES_ROOT
//
// A locked entry is refused by translate-locales.mjs even under --force-stale,
// and its text is held to its hash by i18n:verify.

import {
    parseArgs, resolveLocalesRoot, assertLocalesRoot, listNamespaces, readCatalogue, readStatus,
    writeStatus, riskForNamespace, hash, STATES, SOURCE_LANGUAGE, assertTargetLanguage
} from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [lang, ...ids] = positional;

let root;
try {
    root = assertLocalesRoot(resolveLocalesRoot(flags));
    assertTargetLanguage(lang);
} catch (err) { console.error(err.message); process.exit(2); }

const allChanged = Boolean(flags['all-changed']);
const unlock = Boolean(flags.unlock);
const dryRun = Boolean(flags['dry-run']);
const reviewer = typeof flags.reviewer === 'string' ? flags.reviewer : null;
const state = typeof flags.state === 'string' ? flags.state : null;

if (!ids.length && !allChanged) {
    console.error('Usage: i18n:lock <lang> <ns.key…> | <lang> --all-changed  [--reviewer=name] [--state=reviewed|approved] [--unlock] [--dry-run]');
    process.exit(2);
}
if (state && !['reviewed', 'approved'].includes(state)) {
    console.error(`--state must be reviewed or approved (got "${state}"; STATES are ${STATES.join(', ')})`);
    process.exit(2);
}

const status = readStatus(root, lang);
const now = new Date().toISOString();

/** ns.key → { ns, key } for every key that exists in both en and the target. */
function locateAll() {
    const found = new Map();
    for (const ns of listNamespaces(root)) {
        const en = readCatalogue(root, SOURCE_LANGUAGE, ns);
        const target = readCatalogue(root, lang, ns);
        for (const key of Object.keys(target)) {
            if (en[key] !== undefined) found.set(`${ns}.${key}`, { ns, key, en: en[key], target: target[key] });
        }
    }
    return found;
}

const all = locateAll();
let selected;
if (allChanged) {
    // "Changed" means the text on disk no longer matches what the sidecar
    // recorded — i.e. a human edited it after the machine wrote it. An entry
    // with no tgt at all predates hashing and is not evidence of an edit.
    selected = [...all.keys()].filter(id => {
        const entry = status[id];
        return entry && typeof entry.tgt === 'string' && entry.tgt !== hash(all.get(id).target);
    });
    if (!selected.length) {
        console.log(`${lang}: nothing changed since the last stamp — nothing to lock.`);
        console.log('(Run npm run i18n:verify -- --backfill first if the entries have no tgt recorded yet.)');
        process.exit(0);
    }
} else {
    const missing = ids.filter(id => !all.has(id));
    if (missing.length) {
        console.error(`Not a translated key in ${lang}: ${missing.join(', ')}`);
        process.exit(2);
    }
    selected = ids;
}

const changes = selected.map(id => {
    const { ns, key, en, target } = all.get(id);
    const prev = status[id] || {};
    const nextState = unlock ? (prev.state ?? 'machine') : (state || (prev.state === 'approved' ? 'approved' : 'reviewed'));
    return {
        id, ns, key, from: `${prev.state ?? 'none'}${prev.locked ? '+locked' : ''}`,
        to: `${nextState}${unlock ? '' : '+locked'}`,
        entry: {
            src: hash(en),
            tgt: hash(target),
            state: nextState,
            // The point of this command: the text is a person's, not the LLM's.
            origin: unlock ? (prev.origin ?? 'machine') : 'human',
            locked: !unlock,
            reviewed_at: unlock ? (prev.reviewed_at ?? null) : now,
            reviewer: reviewer ?? prev.reviewer ?? null,
            risk: prev.risk || riskForNamespace(ns)
        }
    };
});

for (const c of changes.slice(0, 40)) console.log(`  ${c.id}: ${c.from} → ${c.to}`);
if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);

if (dryRun) {
    console.log(`\n[dry-run] ${changes.length} entr${changes.length === 1 ? 'y' : 'ies'} would change in ${root}/.status/${lang}.json`);
    process.exit(0);
}
for (const c of changes) status[c.id] = c.entry;
writeStatus(root, lang, status);
console.log(`\n${unlock ? 'Unlocked' : 'Locked'} ${changes.length} entr${changes.length === 1 ? 'y' : 'ies'} in ${root}/.status/${lang}.json`
    + (reviewer ? ` (reviewer: ${reviewer})` : ' — pass --reviewer to record who'));
