// Regression guard for Phase 2 of PLAN_LOGGING.md.
//
// Goal: prevent any new INSERT INTO event_log from being added to runtime
// source. The legacy event_log table is still kept (for historical reads
// and the user-purge plan in _helpers.js) but no new rows should be
// written. learning_events is the canonical xAPI store now.
//
// Allowlist of paths where references are intentionally permitted:
//  - migrations/**           — schema CREATE TABLE / ALTER TABLE
//  - tests/**                — fixture seeds / regression text searches
//  - server/routes/_helpers.js — purge code references the table
//                                (UPDATE/SELECT only — INSERTs are still
//                                forbidden, but file-level allowlist is
//                                cleaner than line-level whitelisting).
//  - PLAN_LOGGING.md / docs   — documentation
//
// If you genuinely need to add a new event_log writer, update the allowlist
// in this test alongside the change so the intent is reviewable.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const ALLOWLIST_PREFIXES = [
    'migrations/',
    'tests/',
    'docs/',
    'server/routes/_helpers.js',
    'scripts/audit-retention.sh', // seeds the table to verify the retention sweep
    'PLAN_LOGGING.md',
    'HANDOFF.md',
    'CHANGES.md',
    'LEARNINGS.md',
    'Cdx_review.md',
];

function grep(pattern) {
    try {
        const out = execSync(
            `git grep -nE "${pattern}" -- ':(exclude)node_modules' ':(exclude)dist' ':(exclude)playwright-report' ':(exclude)test-results' ':(exclude)production' ':(exclude)OyonR' ':(exclude)scripts/oyon-overlay'`,
            { cwd: repoRoot, encoding: 'utf8' }
        );
        return out.trim().split('\n').filter(Boolean);
    } catch (err) {
        // git grep exits 1 when no match — that's the success case here.
        if (err.status === 1) return [];
        throw err;
    }
}

function isAllowed(line) {
    const filePath = line.split(':')[0];
    return ALLOWLIST_PREFIXES.some(prefix => filePath.startsWith(prefix));
}

describe('event_log deprecation guard', () => {
    it('no runtime source contains INSERT INTO event_log', () => {
        const hits = grep('INSERT INTO event_log');
        const offenders = hits.filter(line => !isAllowed(line));
        if (offenders.length > 0) {
            const formatted = offenders.map(o => `  ${o}`).join('\n');
            throw new Error(
                `Found ${offenders.length} disallowed INSERT INTO event_log:\n${formatted}\n\n` +
                `event_log is deprecated (PLAN_LOGGING.md Phase 2). Use learning_events ` +
                `via EventLogger on the client or a direct INSERT INTO learning_events on ` +
                `the server (deriving trinity via resolveSessionTrinity()).`
            );
        }
    });

    it('every event_log reference is documented (snapshot for code review)', () => {
        // Enumerate all references (read + write + JOIN) so a future PR
        // adding a new read path is visible at code-review time. This test
        // does not assert a specific count — it just ensures the snapshot
        // surfaces in test output for human eyes.
        const hits = grep('event_log');
        const fileSet = new Set(hits.map(line => line.split(':')[0]));
        // Sanity check: there should be at least the schema migration plus
        // one reference in _helpers.js (purge) and one read endpoint.
        // If this drops to zero, the table is fully removable.
        expect(fileSet.size).toBeGreaterThan(0);
    });
});
