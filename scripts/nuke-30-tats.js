#!/usr/bin/env node
// Reset stale 30-minute turnaround defaults in case_investigations to the
// canonical 3-minute floor used by server/lib/turnaround.js.
//
// Background: until 2026-05-14 several code paths silently defaulted to
// `turnaround_minutes = 30` when a save payload omitted the field. That
// poisoned the case_investigations table on every case authored or edited
// through the affected upsert. The TAT resolver puts per-test ABOVE the
// case-level default, so the rogue 30 always beat the educator's
// "1-5 minutes system-wide" setting.
//
// Strategy: any row sitting at exactly 30 came from the default, not from
// authored intent (authored intent would land at 1/3/5/15 — the preset
// buttons in LabInvestigationEditor never offered 30 to be picked
// directly until the same fix; the preset existed but was rarely the
// authored choice for the sim's compressed pacing). We reset 30 → 3.
//
// Idempotent: re-running after the sweep is a no-op (no rows match 30
// any more, the WHERE clause matches zero rows).
//
// Usage:
//   node scripts/nuke-30-tats.js          # apply
//   node scripts/nuke-30-tats.js --check  # report only, no writes
//
// Respects ROHY_DB env var, same as retention-sweep.

import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dbPath = process.env.ROHY_DB || path.join(root, 'server', 'database.sqlite');

const TARGET_VALUE = 3; // mirrors server/lib/turnaround.js DEFAULT_TURNAROUND_MINUTES
const STALE_VALUE = 30;

const sqlite = sqlite3.verbose();
const db = new sqlite.Database(dbPath);

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            err ? reject(err) : resolve(this);
        });
    });
}

async function main() {
    const check = process.argv.includes('--check');

    const matches = await all(
        `SELECT id, case_id, tenant_id, investigation_type, test_name
         FROM case_investigations
         WHERE turnaround_minutes = ? AND deleted_at IS NULL
         ORDER BY tenant_id, case_id, investigation_type, test_name`,
        [STALE_VALUE]
    );

    if (matches.length === 0) {
        console.log(`No rows with turnaround_minutes = ${STALE_VALUE}. Nothing to do.`);
        return;
    }

    console.log(`Found ${matches.length} rows with turnaround_minutes = ${STALE_VALUE}:`);
    for (const row of matches) {
        console.log(`  tenant=${row.tenant_id} case=${row.case_id} ${row.investigation_type}/${row.test_name} (id=${row.id})`);
    }

    if (check) {
        console.log(`\n(--check: would set these to ${TARGET_VALUE}; no writes performed)`);
        return;
    }

    const result = await run(
        `UPDATE case_investigations
         SET turnaround_minutes = ?
         WHERE turnaround_minutes = ? AND deleted_at IS NULL`,
        [TARGET_VALUE, STALE_VALUE]
    );

    console.log(`\nUpdated ${result.changes} row(s) to turnaround_minutes = ${TARGET_VALUE}.`);
}

main()
    .catch(err => {
        console.error('nuke-30-tats failed:', err);
        process.exitCode = 1;
    })
    .finally(() => db.close());
