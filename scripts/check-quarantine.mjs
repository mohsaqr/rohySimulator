#!/usr/bin/env node
// The quarantine rules, enforced in the lint job.
//
//   node scripts/check-quarantine.mjs        # exit 1 on any violation
//
// A quarantined test is a Playwright test or describe whose title carries
// `@quarantine`, or a Vitest `describeQuarantine(...)` block
// (tests/utils/describeQuarantine.js). Each must sit directly under two
// comments:
//
//   // QUARANTINED: 2026-09-23
//   // PROVA-DEFECT: https://prova.lacarm.com/defects/12
//   test('the thing that flakes @quarantine', ...)
//
// PROVA-DEFECT on the line immediately above, naming the open defect that
// explains it; QUARANTINED on the line above that, the day it went in. A
// quarantine older than MAX_AGE_DAYS fails, so nothing stays quarantined by
// being forgotten: fix it, or renew it on purpose with a new date.
//
// Known limit: a Playwright title is read from the line the call starts on, so
// a title split across lines is not seen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The helper's own fixture quarantines a deliberately failing test with a
// fixed date; it is the helper's test, not a quarantine.
const SKIP_DIRS = new Set(['node_modules', path.join('tests', 'fixtures', 'quarantine')]);

const PLAYWRIGHT_CALL = /^\s*test(?:\.describe)?(?:\.(?:only|skip|fixme|serial|parallel))*\(\s*(['"`])((?:(?!\1).)*@quarantine(?:(?!\1).)*)\1/;
const VITEST_CALL = /^\s*describeQuarantine\(\s*(['"`])((?:(?!\1).)*)\1/;
const DEFECT = /^\s*\/\/\s*PROVA-DEFECT:\s*(https?:\/\/\S+)\s*$/;
const DATED = /^\s*\/\/\s*QUARANTINED:\s*(\d{4}-\d{2}-\d{2})\s*$/;

/**
 * Every quarantine rule broken in a set of files.
 *
 * @param {Array<{file: string, text: string}>} sources
 * @param {number} nowMs
 * @returns {Array<{file: string, line: number, title: string, problem: string}>}
 */
export function quarantineViolations(sources, nowMs) {
    return sources.flatMap(({ file, text }) => {
        const lines = text.split('\n');
        return lines.flatMap((line, i) => {
            const hit = line.match(PLAYWRIGHT_CALL) ?? line.match(VITEST_CALL);
            if (!hit) return [];
            const title = hit[2];
            const at = { file, line: i + 1, title };
            const defect = (lines[i - 1] ?? '').match(DEFECT);
            const dated = (lines[i - 2] ?? '').match(DATED);
            const problems = [];
            if (!defect) problems.push('no `// PROVA-DEFECT: <url>` on the line above');
            if (!dated) {
                problems.push('no `// QUARANTINED: YYYY-MM-DD` above the PROVA-DEFECT line');
            } else {
                const since = Date.parse(`${dated[1]}T00:00:00Z`);
                const ageDays = Math.floor((nowMs - since) / DAY_MS);
                if (!Number.isFinite(since)) problems.push(`QUARANTINED date ${dated[1]} is not a date`);
                else if (ageDays < 0) problems.push(`QUARANTINED date ${dated[1]} is in the future`);
                else if (ageDays > MAX_AGE_DAYS) {
                    problems.push(`quarantined ${ageDays} days ago (${dated[1]}); the limit is ${MAX_AGE_DAYS}`);
                }
            }
            return problems.map((problem) => ({ ...at, problem }));
        });
    });
}

function testFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel) ? [] : testFiles(full);
        return /\.(m?js|jsx)$/.test(entry.name) ? [rel] : [];
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = testFiles(path.join(REPO_ROOT, 'tests'))
        .filter((rel) => rel !== path.join('tests', 'utils', 'describeQuarantine.js'));
    const sources = files.map((file) => ({ file, text: fs.readFileSync(path.join(REPO_ROOT, file), 'utf8') }));
    const violations = quarantineViolations(sources, Date.now());
    const quarantined = sources.reduce((n, { text }) => n + text.split('\n')
        .filter((l) => PLAYWRIGHT_CALL.test(l) || VITEST_CALL.test(l)).length, 0);
    console.log(`[quarantine] ${files.length} test files, ${quarantined} quarantined`);
    violations.forEach((v) => console.error(`  ${v.file}:${v.line} "${v.title}": ${v.problem}`));
    process.exit(violations.length > 0 ? 1 : 0);
}
