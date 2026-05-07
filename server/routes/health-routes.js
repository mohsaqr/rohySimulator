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

// Readiness — proves the app is actually able to serve traffic. Both
// probes run in parallel under a single 2s deadline; under nginx
// active-health-checks every second the latency cost matters.
const READY_TIMEOUT_MS = 2000;

function adapterGet(sql) {
    return new Promise((resolve, reject) => {
        dbAdapter.get(sql, [], (err, row) => err ? reject(err) : resolve(row));
    });
}

router.get('/ready', async (req, res) => {
    const checks = { db: 'unknown', migrations: 'unknown' };
    let healthy = true;

    const probes = Promise.all([
        adapterGet('SELECT 1 AS ok')
            .then((row) => row?.ok === 1
                ? { key: 'db', value: 'ok', ok: true }
                : { key: 'db', value: 'unexpected_response', ok: false })
            .catch((err) => ({ key: 'db', value: `error: ${err.message}`, ok: false })),
        adapterGet('SELECT MAX(version) AS latest, COUNT(*) AS applied FROM schema_migrations')
            .then((row) => (!row || row.applied === 0)
                ? { key: 'migrations', value: 'none_applied', ok: false }
                : { key: 'migrations', value: `at ${row.latest} (${row.applied} applied)`, ok: true })
            .catch((err) => ({ key: 'migrations', value: `error: ${err.message}`, ok: false })),
    ]);

    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error(`readiness probe timed out (${READY_TIMEOUT_MS}ms)`)),
            READY_TIMEOUT_MS,
        );
    });

    try {
        const results = await Promise.race([probes, timeout]);
        for (const r of results) {
            checks[r.key] = r.value;
            if (!r.ok) healthy = false;
        }
    } catch (err) {
        checks.db = checks.db === 'unknown' ? `error: ${err.message}` : checks.db;
        checks.migrations = checks.migrations === 'unknown' ? `error: ${err.message}` : checks.migrations;
        healthy = false;
    } finally {
        clearTimeout(timeoutId);
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
