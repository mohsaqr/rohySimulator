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
import { originRequestHeaders } from '../lib/pluginOriginTokens.js';
import { pluginOrigins } from '../lib/pluginRemoteOrigins.js';
import { libraryDirs } from '../lib/pluginServerSlot.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';

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

// Above this many quarantined learning events in 24 h, readiness reports the
// ingest check as failing: a client (or a whole subsystem) is emitting rows
// the registry does not accept, which used to be invisible.
const REJECTED_ALERT_PER_DAY = Number(process.env.ROHY_REJECTED_EVENTS_ALERT || 1000);
// The RPS-1 §17 contract shape as a sqlite GLOB (the same one migration 0050 used).
const ISO_Z_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z';

router.get('/ready', async (req, res) => {
    const checks = { db: 'unknown', migrations: 'unknown', ingest: 'unknown', timestamps: 'unknown' };
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
        // Bounded and indexed: (tenant_id, received_at) covers the scan.
        adapterGet(`SELECT COUNT(*) AS n FROM learning_events_rejected
                     WHERE received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`)
            .then((row) => {
                const n = row?.n ?? 0;
                return { key: 'ingest', value: `${n} rejected/24h`, ok: n <= REJECTED_ALERT_PER_DAY };
            })
            .catch((err) => ({ key: 'ingest', value: `error: ${err.message}`, ok: false })),
        // A restored pre-0050 backup, or a writer that fell through to a
        // column DEFAULT, puts legacy-shaped instants back into a column that
        // is string-sorted. Bounded: learning_events.timestamp only, indexed.
        // `scripts/verify-timestamps.js` covers every column and fixes nothing;
        // readiness reports rather than blocks, so a cosmetic defect in a
        // restored backup is a warning, not an outage.
        adapterGet(`SELECT COUNT(*) AS n FROM learning_events
                     WHERE timestamp IS NOT NULL AND timestamp NOT GLOB ?`, [ISO_Z_GLOB])
            .then((row) => {
                const n = row?.n ?? 0;
                return { key: 'timestamps', value: n === 0 ? 'ok' : `${n} legacy-shaped`, ok: true };
            })
            .catch((err) => ({ key: 'timestamps', value: `error: ${err.message}`, ok: false })),
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
        checks.ingest = checks.ingest === 'unknown' ? `error: ${err.message}` : checks.ingest;
        checks.timestamps = checks.timestamps === 'unknown' ? `error: ${err.message}` : checks.timestamps;
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

// ---- Plugin content origins (RPS-1 §7a) ---------------------------------
//
// A plugin whose bulk content lives on another server is only as deployed as
// that origin. This probe is what turns "we set ROHY_PLUGIN_ORIGINS" into a
// verifiable fact: for every configured origin it fetches <origin>/content.json
// — the self-description every plugin content bundle serves at its root — and
// reports reachable / content version. The deploy hub's POST_VERIFY and
// scripts/tech-test.sh read this; an operator who forgot to ship the bundle,
// or pointed at the wrong port, finds out at deploy time rather than when a
// learner opens a slide.
//
// Server-side only: content.json is NOT proxied to learners (the proxy relays
// manifest paths only), and this endpoint never returns the origin's body.
const ORIGIN_PROBE_TIMEOUT_MS = 2500;

async function probeOrigin(origin, pluginId) {
    const started = Date.now();
    try {
        const res = await fetch(`${origin}/content.json`, {
            // The probe must authenticate too, or a correctly-configured
            // authenticated origin reports itself dark and an operator chases
            // a network fault that is really a missing credential.
            headers: originRequestHeaders(pluginId),
            redirect: 'manual',
            signal: AbortSignal.timeout(ORIGIN_PROBE_TIMEOUT_MS),
        });
        const ms = Date.now() - started;
        if (!res.ok) return { reachable: false, status: res.status, ms, error: `content.json returned ${res.status}` };
        let body = null;
        try { body = await res.json(); } catch { return { reachable: false, status: res.status, ms, error: 'content.json is not JSON' }; }
        // The catalog is optional (an origin may ship tiles for cases authored
        // elsewhere), but when the editor's library is empty this is the first
        // thing to look at.
        let hasCatalog = false;
        try {
            const head = await fetch(`${origin}/catalog.json`, {
                method: 'HEAD', redirect: 'manual',
                headers: originRequestHeaders(pluginId),
                signal: AbortSignal.timeout(ORIGIN_PROBE_TIMEOUT_MS),
            });
            hasCatalog = head.ok;
        } catch { hasCatalog = false; }
        return {
            reachable: true,
            status: res.status,
            ms,
            has_catalog: hasCatalog,
            content_version: typeof body?.version === 'string' ? body.version : null,
            content_plugin: typeof body?.plugin === 'string' ? body.plugin : null,
            file_count: Number.isInteger(body?.fileCount) ? body.fileCount : null,
        };
    } catch (err) {
        return { reachable: false, status: null, ms: Date.now() - started, error: err?.name === 'TimeoutError' ? `no answer within ${ORIGIN_PROBE_TIMEOUT_MS}ms` : String(err?.message || err) };
    }
}

/**
 * Counts for a plugin's managed asset library, or {} when it has none.
 *
 * Deliberately aggregate-only and unauthenticated-safe: /health/plugins is
 * public so `scripts/tech-test.sh` can gate a deploy on it without a token.
 *
 * @param {string} pluginId
 * @returns {Promise<{library?: object}>}
 */
async function libraryHealth(pluginId) {
    if (!libraryDirs().has(pluginId)) return {};
    try {
        const assets = await dbAdapter.all(
            `SELECT state, COUNT(*) AS n, COALESCE(SUM(disk_bytes), 0) AS bytes
               FROM plugin_assets WHERE plugin_id = ? GROUP BY state`,
            [pluginId]
        );
        const jobs = await dbAdapter.all(
            `SELECT state, COUNT(*) AS n FROM plugin_jobs WHERE plugin_id = ? GROUP BY state`,
            [pluginId]
        );
        const count = (rows, state) => Number(rows.find((r) => r.state === state)?.n ?? 0);
        return {
            library: {
                assets: assets.reduce((sum, r) => sum + Number(r.n), 0),
                ready: count(assets, 'ready'),
                needs_calibration: count(assets, 'needs_calibration'),
                failed: count(assets, 'failed'),
                bytes: assets.reduce((sum, r) => sum + Number(r.bytes), 0),
                queued: count(jobs, 'queued'),
                running: count(jobs, 'running'),
            },
        };
    } catch {
        // A missing table (a deployment mid-migration) must not turn a health
        // probe into a 500 — the probe's job is to report, not to fail.
        return { library: { error: 'unavailable' } };
    }
}

/**
 * The content INSTALLED on this host, as opposed to fetched from an origin.
 *
 * A deployment that ran `npm run setup:content` has no configured origin, so
 * the origin probe reports nothing and the response reads identically to a
 * deployment with no content at all. That is the one thing an operator
 * verifying an install most needs to tell apart.
 *
 * Counts and the content version only. This route is public so the deploy
 * verify needs no credentials, and a file listing is not public information.
 */
function starterHealth() {
    const root = process.env.ROHY_STARTER_CONTENT_DIR
        ? path.resolve(process.env.ROHY_STARTER_CONTENT_DIR)
        : path.resolve(fileURLToPath(new URL('../plugin-content', import.meta.url)));
    if (String(process.env.ROHY_STARTER_CONTENT ?? '').toLowerCase() === 'off') {
        return { refused: true };
    }
    let names;
    try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return {}; }

    const installed = {};
    names.filter((e) => e.isDirectory()).forEach((e) => {
        const stamp = path.join(root, e.name, 'content.json');
        if (!fs.existsSync(stamp)) return;
        try {
            const content = JSON.parse(fs.readFileSync(stamp, 'utf8'));
            installed[e.name] = {
                version: typeof content.version === 'string' ? content.version : null,
                file_count: Number.isInteger(content.fileCount) ? content.fileCount : null,
                kilobytes: Number.isInteger(content.kilobytes) ? content.kilobytes : null,
            };
        } catch {
            // A bundle whose stamp will not parse is reported as present and
            // broken rather than omitted: silence here reads as "not
            // installed", which would send an operator to reinstall something
            // that is already there and damaged.
            installed[e.name] = { version: null, error: 'content.json is unreadable' };
        }
    });
    return Object.keys(installed).length ? { installed } : {};
}

router.get('/health/plugins', async (req, res) => {
    // pluginOrigins() is a Map (plugin id → origin), parsed once at boot.
    const origins = pluginOrigins();
    const configured = [...origins.keys()];
    const entries = await Promise.all(configured.map(async (id) => {
        const manifest = PLUGIN_MANIFESTS.find((m) => m.id === id) || null;
        const probe = await probeOrigin(origins.get(id), id);
        // The origin must describe itself as THIS plugin's content: a bundle
        // for another plugin on the right port is the kind of mistake that
        // otherwise surfaces as "every slide is a 404".
        const mismatch = probe.reachable && probe.content_plugin && probe.content_plugin !== id
            ? `content.json says plugin '${probe.content_plugin}', expected '${id}'` : null;
        // Public like /health, so the deploy verify needs no credentials —
        // which is why the origin URL itself is NOT echoed: a LAN address
        // and port belong in the operator's env, not in a public probe.
        return [id, {
            known_plugin: Boolean(manifest),
            declared_paths: manifest?.remote?.paths ?? [],
            ...probe,
            ...(mismatch ? { reachable: false, error: mismatch } : {}),
            // The MANAGED half of the library (RPS-1 1.4). Counts only, no
            // labels or source hosts: this route is public so the deploy verify
            // needs no credentials, and what a tenant has imported is not
            // public information. A deployment with no library reports nothing
            // rather than zeroes, so "not configured" and "configured and
            // empty" stay distinguishable.
            ...(await libraryHealth(id)),
        }];
    }));
    const plugins = Object.fromEntries(entries);
    const unreachable = entries.filter(([, v]) => !v.reachable).map(([id]) => id);
    res.status(unreachable.length ? 503 : 200).json({
        status: unreachable.length ? 'degraded' : 'ok',
        configured: configured.length,
        unreachable,
        plugins,
        // What is installed locally. A deployment serving bundled content has
        // `configured: 0` and is perfectly healthy; without this the response
        // cannot say so.
        content: starterHealth(),
    });
});
