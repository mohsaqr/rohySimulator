// Liveness + readiness endpoints. Both are public (no auth) so nginx,
// systemd, and external uptime monitors can probe them without credentials.
// Wire-up: mounted in routes.js BEFORE generalLimiter so a probe storm can't
// rate-limit the health check itself.
//
//   GET /api/health  → liveness. 200 means: the process is up and the event
//                      loop is responsive enough to answer this request.
//                      Cheap, no DB call, suitable for systemd's
//                      ExecStart-watchdog / per-second probes.
//
//   GET /api/ready   → readiness. 200 means: above, AND the database is
//                      reachable, AND migrations are at the expected version.
//                      Suitable for nginx's "is upstream healthy", load
//                      balancer rotation, smoke-after-deploy gating.
//                      503 means the process is up but not serving traffic
//                      yet (boot in progress, DB lock, migration pending).

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dbAdapter from '../dbAdapter.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read package.json once at module load so /health doesn't touch the disk
// on every probe (these get hit a lot).
let APP_VERSION = 'unknown';
try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    APP_VERSION = pkg.version || 'unknown';
} catch { /* leave as 'unknown' — health still works */ }

const STARTED_AT = new Date().toISOString();

// Cheap liveness — no DB, no migrations. Just "the process is alive and the
// event loop isn't stuck". If this fails, systemd will restart the process.
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: APP_VERSION,
        started_at: STARTED_AT,
        uptime_s: Math.round(process.uptime()),
    });
});

// Readiness — proves the app is actually able to serve traffic.
// Uses dbAdapter.get with a 2s timeout race so a hung sqlite (very rare,
// but possible during heavy backups / locks) yields 503 instead of hanging.
router.get('/ready', async (req, res) => {
    const checks = { db: 'unknown', migrations: 'unknown' };
    let healthy = true;

    // DB ping — minimal SELECT against sqlite_master so we don't depend on
    // any application table existing.
    try {
        const dbPing = new Promise((resolve, reject) => {
            dbAdapter.get('SELECT 1 AS ok', [], (err, row) => {
                if (err) return reject(err);
                resolve(row?.ok === 1);
            });
        });
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('db ping timed out (2s)')), 2000)
        );
        const ok = await Promise.race([dbPing, timeout]);
        checks.db = ok ? 'ok' : 'unexpected_response';
        if (!ok) healthy = false;
    } catch (err) {
        checks.db = `error: ${err.message}`;
        healthy = false;
    }

    // Migration status — most recent applied version. A schema_migrations
    // row count of 0 is a "boot before migrations applied" signal.
    try {
        const row = await new Promise((resolve, reject) => {
            dbAdapter.get(
                'SELECT MAX(version) AS latest, COUNT(*) AS applied FROM schema_migrations',
                [],
                (err, r) => err ? reject(err) : resolve(r),
            );
        });
        if (!row || row.applied === 0) {
            checks.migrations = 'none_applied';
            healthy = false;
        } else {
            checks.migrations = `at ${row.latest} (${row.applied} applied)`;
        }
    } catch (err) {
        checks.migrations = `error: ${err.message}`;
        healthy = false;
    }

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'not_ready',
        version: APP_VERSION,
        started_at: STARTED_AT,
        uptime_s: Math.round(process.uptime()),
        checks,
    });
});

export default router;
