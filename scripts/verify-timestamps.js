#!/usr/bin/env node
/**
 * Count rows whose time column does not carry the contract shape — UTC
 * ISO-8601, `T`, three decimals, `Z` (RPS-1 §17) — per (table, column).
 *
 * Every writer names its time column since 1.5, and migrations 0050–0052
 * rewrote the stored rows, so a non-zero count means one of two things: a
 * backup from before 0050 was restored, or a new writer fell through to a
 * column DEFAULT. Either way `ORDER BY <ts>` is a string sort on these
 * columns and a minority legacy shape scrambles the majority, which is why
 * this is a check and not a note.
 *
 *   node scripts/verify-timestamps.js [--json]
 *
 * Exit 0 when every column conforms, 1 otherwise. Read-only.
 */
import '../server/bootstrap-env.js';
import db, { dbReady } from '../server/db.js';

const COLUMNS = [
    ['learning_events', 'timestamp'],
    ['learning_events', 'client_time'],
    ['learning_events_rejected', 'received_at'],
    ['interactions', 'timestamp'],
    ['login_logs', 'timestamp'],
    ['settings_logs', 'timestamp'],
    ['alarm_events', 'triggered_at'],
    ['sessions', 'start_time'],
    ['sessions', 'end_time'],
    ['patient_record_events', 'created_at'],
];

// The contract shape as a sqlite GLOB (no regex in sqlite by default).
const ISO_Z_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z';

function get(sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
}

async function main() {
    await dbReady;
    const json = process.argv.includes('--json');
    const results = [];
    for (const [table, column] of COLUMNS) {
        const exists = await get(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`, [table]);
        if (!exists?.n) { results.push({ table, column, skipped: 'table missing' }); continue; }
        const row = await get(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN ${column} IS NOT NULL AND ${column} NOT GLOB ? THEN 1 ELSE 0 END) AS nonconforming
               FROM ${table}`,
            [ISO_Z_GLOB],
        );
        results.push({ table, column, total: row?.total ?? 0, nonconforming: row?.nonconforming ?? 0 });
    }
    const bad = results.filter((r) => r.nonconforming > 0);
    if (json) {
        console.log(JSON.stringify({ ok: bad.length === 0, results }, null, 2));
    } else {
        for (const r of results) {
            if (r.skipped) console.log(`  - ${r.table}.${r.column}: ${r.skipped}`);
            else console.log(`  ${r.nonconforming > 0 ? '✗' : '✓'} ${r.table}.${r.column}: ${r.nonconforming}/${r.total} non-conforming`);
        }
        console.log(bad.length === 0 ? 'timestamps: every column conforms' : `timestamps: ${bad.length} column(s) carry legacy shapes`);
    }
    process.exit(bad.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
