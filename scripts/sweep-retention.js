#!/usr/bin/env node
/**
 * Retention sweep — deletes time-bounded log rows older than the configured
 * retention horizon. Pair with cron / a scheduled job. The audit's
 * "Time-bounded logs keep operational rows but the retention sweep deletes
 * by age" line is what this script implements.
 *
 * Usage:
 *   node scripts/sweep-retention.js                    # dry-run (default)
 *   node scripts/sweep-retention.js --apply            # actually delete
 *   node scripts/sweep-retention.js --days 90 --apply  # custom horizon
 *   node scripts/sweep-retention.js --json             # machine-readable
 *
 * Default horizon: 365 days (matching what we documented as the current
 * behaviour — see docs/OBSERVABILITY.md). Operators can shorten via the
 * --days flag without code changes.
 *
 * Cron example (weekly, Sunday 04:23):
 *   23 4 * * 0 cd /path/to/rohy && node scripts/sweep-retention.js \
 *              --apply --json | logger -t rohy-retention
 *
 * Tables swept (each by its own ts column):
 *   - event_log              (timestamp)
 *   - learning_events        (timestamp)
 *   - interactions           (timestamp)
 *   - alarm_events           (triggered_at)
 *   - llm_request_log        (request_timestamp)
 *   - client_logs            (received_at)
 *
 * NOT swept here:
 *   - system_audit_log — the hash chain depends on row continuity. Pruning
 *     would break verification. If audit log retention becomes a
 *     compliance requirement, design a "checkpoint and snapshot" strategy
 *     first.
 */

import { dbReady } from '../server/db.js';
import db from '../server/db.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const jsonMode = args.includes('--json');
const daysIdx = args.indexOf('--days');
const horizonDays = daysIdx !== -1 ? Number(args[daysIdx + 1]) : 365;

if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
    console.error('--days must be a positive number');
    process.exit(1);
}

const SWEEP_TABLES = [
    { table: 'event_log',        ts: 'timestamp' },
    { table: 'learning_events',  ts: 'timestamp' },
    { table: 'interactions',     ts: 'timestamp' },
    { table: 'alarm_events',     ts: 'triggered_at' },
    { table: 'llm_request_log',  ts: 'request_timestamp' },
    { table: 'client_logs',      ts: 'received_at' },
];

function dbScalar(sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row?.count ?? 0))
    );
}
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

async function main() {
    await dbReady;
    const cutoff = `datetime('now', ?)`;
    const cutoffArg = `-${horizonDays} days`;

    const results = [];
    let totalDeleted = 0;
    for (const { table, ts } of SWEEP_TABLES) {
        // Table existence check — schema may be missing in older DBs.
        const exists = await dbScalar(
            `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name = ?`,
            [table]
        );
        if (!exists) {
            results.push({ table, skipped: 'table missing' });
            continue;
        }
        const count = await dbScalar(
            `SELECT COUNT(*) AS count FROM ${table} WHERE ${ts} < ${cutoff}`,
            [cutoffArg]
        );
        if (apply && count > 0) {
            const result = await dbRun(
                `DELETE FROM ${table} WHERE ${ts} < ${cutoff}`,
                [cutoffArg]
            );
            results.push({ table, ts, deleted: result.changes });
            totalDeleted += result.changes;
        } else {
            results.push({ table, ts, would_delete: count, dry_run: !apply });
        }
    }

    if (jsonMode) {
        console.log(JSON.stringify({ apply, horizon_days: horizonDays, totalDeleted, results }));
    } else {
        console.log(`Retention sweep — horizon: ${horizonDays} days${apply ? '' : ' (DRY RUN)'}`);
        for (const r of results) {
            if (r.skipped) {
                console.log(`  ${r.table}: ${r.skipped}`);
            } else if (apply) {
                console.log(`  ${r.table} (${r.ts}): deleted ${r.deleted} rows`);
            } else {
                console.log(`  ${r.table} (${r.ts}): would delete ${r.would_delete} rows`);
            }
        }
        if (apply) console.log(`Total deleted: ${totalDeleted}`);
        else console.log('Pass --apply to actually delete.');
    }
    process.exit(0);
}

main().catch((err) => {
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: err.message }));
    else console.error(`retention sweep failed: ${err.message}`);
    process.exit(1);
});
