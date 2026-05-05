#!/usr/bin/env node
import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dbPath = process.env.ROHY_DB || path.join(root, 'server', 'database.sqlite');
const sqlite = sqlite3.verbose();

const TABLES = [
    { table: 'event_log', column: 'timestamp' },
    { table: 'learning_events', column: 'timestamp' },
    { table: 'interactions', column: 'timestamp' },
    { table: 'system_audit_log', column: 'timestamp' },
    { table: 'alarm_events', column: 'triggered_at' },
    { table: 'llm_request_log', column: 'request_timestamp' }
];

const db = new sqlite.Database(dbPath);

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            err ? reject(err) : resolve(this);
        });
    });
}

async function resolveRetentionSeconds() {
    if (process.env.ROHY_RETENTION_SECONDS) return Number(process.env.ROHY_RETENTION_SECONDS);
    if (process.env.RETENTION_SECONDS) return Number(process.env.RETENTION_SECONDS);
    if (process.env.ROHY_RETENTION_DAYS) return Number(process.env.ROHY_RETENTION_DAYS) * 86400;
    if (process.env.RETENTION_DAYS) return Number(process.env.RETENTION_DAYS) * 86400;

    const row = await get(
        `SELECT setting_value FROM platform_settings
         WHERE setting_key IN ('retention_days', 'log_retention_days')
         ORDER BY CASE setting_key WHEN 'retention_days' THEN 0 ELSE 1 END
         LIMIT 1`
    ).catch(() => null);
    const days = row ? Number(row.setting_value) : 90;
    return Number.isFinite(days) && days >= 0 ? days * 86400 : 90 * 86400;
}

function cutoffExpression(seconds) {
    return `datetime('now', '-${Math.max(0, Math.floor(seconds))} seconds')`;
}

async function sweep() {
    const seconds = await resolveRetentionSeconds();
    if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error('Retention window must be a non-negative number');
    }

    const results = {};
    await run('BEGIN');
    try {
        for (const entry of TABLES) {
            const sql = `DELETE FROM ${entry.table} WHERE ${entry.column} < ${cutoffExpression(seconds)}`;
            const result = await run(sql);
            results[entry.table] = result.changes || 0;
        }

        await run(
            `INSERT INTO system_audit_log
             (user_id, username, action, resource_type, resource_id, resource_name,
              new_value, status, metadata, tenant_id)
             VALUES (NULL, 'retention-sweep', 'retention_sweep', 'retention', 'time_bounded_logs',
                     'Retention sweep', ?, 'success', ?, 1)`,
            [
                JSON.stringify({ deleted: results }),
                JSON.stringify({ retention_seconds: seconds, retention_days: seconds / 86400 })
            ]
        );
        await run('COMMIT');
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }

    return { retention_seconds: seconds, retention_days: seconds / 86400, deleted: results };
}

sweep()
    .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        db.close();
    })
    .catch((err) => {
        console.error(`[retention-sweep] ${err.message}`);
        db.close();
        process.exit(1);
    });
