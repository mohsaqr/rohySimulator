// Prove that every `covers:` pattern in rohy-cases.yaml points at a Playwright
// test that actually exists.
//
//   ROHY_PW_PROJECTS=all npx playwright test --list --reporter=./prova/dump-check-keys.mjs
//   node prova/check-coverage-links.mjs
//
// Why this is a separate check: Prova validates a coverage pattern's SYNTAX when
// the catalogue is imported, but it cannot know whether any check key matches it.
// A renamed test, or a typo in a pattern, therefore imports cleanly and covers
// nothing — and the case goes on looking automated in the coverage matrix while
// no machine is watching it. That is a worse state than having no pattern at all.
//
// Matching follows Prova's own rule (server/lib/checks.mjs): an exact key, or a
// prefix ending in a single trailing `*`.
//
// Exits non-zero when a pattern matches nothing, so it can gate a commit.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const keysFile = path.join(here, 'check-keys.txt');
const catalogueFile = path.join(here, 'rohy-cases.yaml');

if (!fs.existsSync(keysFile)) {
    console.error(`${path.relative(process.cwd(), keysFile)} is missing — generate it first:\n`
        + '  ROHY_PW_PROJECTS=all npx playwright test --list --reporter=./prova/dump-check-keys.mjs');
    process.exit(2);
}

const keys = fs.readFileSync(keysFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const source = fs.readFileSync(catalogueFile, 'utf8');

// Pull `covers:` entries in both the block form and the inline form, keeping the
// case id they belong to so a failure names the case a human has to fix.
const found = [];
for (const chunk of source.split('\n    - id: ').slice(1)) {
    const caseId = chunk.split('\n')[0].trim();
    for (const m of chunk.matchAll(/\n {8}- "([^"]+)"/g)) found.push([caseId, m[1]]);
    for (const m of chunk.matchAll(/\n {6}covers: \[([^\]]*)\]/g)) {
        for (const p of m[1].matchAll(/"([^"]+)"/g)) found.push([caseId, p[1]]);
    }
}

const matches = (pattern) => (pattern.endsWith('*')
    ? keys.some((k) => k.startsWith(pattern.slice(0, -1)))
    : keys.includes(pattern));

const orphans = found.filter(([, pattern]) => !matches(pattern));

console.log(`check keys in the suite : ${keys.length}`);
console.log(`coverage patterns       : ${found.length}`);
console.log(`matching a real test    : ${found.length - orphans.length}`);
console.log(`matching NOTHING        : ${orphans.length}`);

if (orphans.length) {
    console.error('\nThese patterns match no test — the case claims automated coverage it does not have:');
    for (const [caseId, pattern] of orphans) console.error(`  ${caseId}\n    ${pattern}`);
    process.exit(1);
}

// The other direction is information, not a failure: a check no case covers is
// fine early on, but it is what Prova's "unmapped checks" view exists to shrink.
const covered = new Set();
for (const [, pattern] of found) {
    for (const k of keys) {
        if (pattern.endsWith('*') ? k.startsWith(pattern.slice(0, -1)) : k === pattern) covered.add(k);
    }
}
console.log(`\nchecks mapped to a case : ${covered.size} of ${keys.length}`);
