/**
 * The plugin job runner (RPS-1 1.4, the server slot).
 *
 * A plugin's server module registers handlers by job kind; the host owns the
 * queue, the worker, the persistence and the lifecycle. A plugin never spawns
 * its own timer, never touches `plugin_jobs`, and never decides how many things
 * run at once — those are deployment properties, and a plugin that could set
 * them could starve the box rohy is running on.
 *
 * WHY EXACTLY ONE WORKER
 *
 * Measured, not guessed: `vips openslideload --level 2` on a 2.1 GB NDPI peaks
 * at ~252 MB RSS and `dzsave` at ~299 MB (2026-08-29, vips 8.18.6). The target
 * server is budgeted at 3 GB total. One worker leaves an order of magnitude of
 * headroom; four workers turn a comfortable margin into an OOM kill under a
 * batch import, and an OOM-killed tiler leaves a partial pyramid on disk that
 * nothing distinguishes from a complete one. Concurrency is not a knob in v1
 * for that reason — it is a decision that needs a disk-state design first.
 *
 * WHY A JOB FOUND 'running' AT BOOT IS NOT RESUMED IN PLACE
 *
 * The process that owned it is gone, so its phase is the last phase it
 * ANNOUNCED, not the phase it reached. Files may be half-written. So boot does
 * not continue such a job: it requeues it from the start (the handler is
 * required to be idempotent over its own asset directory) or, past the attempt
 * limit, fails it with a message saying so. The alternative — trusting a stale
 * `phase` — is how a half-downloaded file gets tiled.
 *
 * CANCELLATION IS COOPERATIVE, AND CHECKED AT PHASE BOUNDARIES
 *
 * `cancel_requested` is a flag the worker reads between phases, not a signal
 * that kills a child mid-write. Killing `vips` halfway through `dzsave` leaves
 * a directory of tiles that looks exactly like a finished one; a phase boundary
 * is the one place the on-disk state is known and cleanable.
 */
import { randomUUID } from 'node:crypto';
import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';

const log = logger('plugin-jobs');

/** Job kind → handler, registered by a plugin's server module at mount time. */
const handlers = new Map();

/** How many times a job is requeued after its process died before giving up. */
const MAX_ATTEMPTS = 3;

let running = false;      // is the single worker currently in a job?
let stopped = false;      // set by stop(), so tests and shutdown can drain
let pumpQueued = false;   // coalesces concurrent pump() calls into one

/**
 * Register a handler for a job kind.
 *
 * @param {string}   kind    namespaced by the caller, e.g. 'pathology:import_slide'
 * @param {function} handler async (job, api) => result. `api` carries
 *                           `{ setPhase, setProgress, cancelled, log }`.
 */
export function registerJobHandler(kind, handler) {
    if (typeof handler !== 'function') {
        throw new Error(`Job handler for '${kind}' is not a function`);
    }
    if (handlers.has(kind)) {
        throw new Error(`Duplicate job handler for kind '${kind}'`);
    }
    handlers.set(kind, handler);
}

/** Test seam — drop every registration. */
export function resetJobHandlers() { handlers.clear(); }

/**
 * Enqueue a job.
 *
 * @param {object} spec
 * @param {number} spec.tenantId
 * @param {string} spec.pluginId
 * @param {string} spec.kind
 * @param {object} [spec.payload]
 * @param {string} [spec.assetId]
 * @param {number} [spec.userId]
 * @returns {Promise<string>} the job id
 */
export async function enqueueJob({ tenantId, pluginId, kind, payload = {}, assetId = null, userId = null }) {
    if (!handlers.has(kind)) {
        // Refused rather than queued. A job nothing can run is a row that sits
        // at 'queued' forever and reads to an admin as "the worker is stuck".
        throw new Error(`No handler is registered for job kind '${kind}'`);
    }
    const id = randomUUID();
    await dbAdapter.run(
        `INSERT INTO plugin_jobs (id, tenant_id, plugin_id, kind, state, payload, asset_id, created_by)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
        [id, tenantId, pluginId, kind, JSON.stringify(payload), assetId, userId]
    );
    pump();
    return id;
}

/**
 * Ask for a job to stop. Honoured at the next phase boundary.
 *
 * @param {string} jobId
 * @param {number} tenantId  tenant scope — a cancel is a mutation like any other
 * @returns {Promise<boolean>} false when no such live job exists
 */
export async function cancelJob(jobId, tenantId) {
    const res = await dbAdapter.run(
        `UPDATE plugin_jobs SET cancel_requested = 1
          WHERE id = ? AND tenant_id = ? AND state IN ('queued', 'running')`,
        [jobId, tenantId]
    );
    // A queued job can be cancelled outright — nothing has touched the disk yet.
    await dbAdapter.run(
        `UPDATE plugin_jobs SET state = 'cancelled', finished_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND state = 'queued'`,
        [jobId, tenantId]
    );
    return (res?.changes ?? 0) > 0;
}

/**
 * Requeue jobs whose process died, and fail the ones that have used up their
 * attempts. Called once at boot, before the worker starts.
 *
 * @returns {Promise<{requeued: number, failed: number}>}
 */
export async function recoverInterruptedJobs() {
    const orphans = await dbAdapter.all(
        `SELECT id, attempts FROM plugin_jobs WHERE state = 'running'`
    );
    let requeued = 0;
    let failed = 0;
    for (const job of orphans) {
        if (job.attempts >= MAX_ATTEMPTS) {
            await dbAdapter.run(
                `UPDATE plugin_jobs SET state = 'failed', phase = NULL, finished_at = CURRENT_TIMESTAMP,
                        error = ? WHERE id = ?`,
                [`abandoned after ${job.attempts} interrupted attempts`, job.id]
            );
            failed += 1;
        } else {
            // Back to the START, not to the recorded phase — see the header.
            await dbAdapter.run(
                `UPDATE plugin_jobs SET state = 'queued', phase = NULL, progress = 0, started_at = NULL WHERE id = ?`,
                [job.id]
            );
            requeued += 1;
        }
    }
    if (orphans.length > 0) {
        log.warn('recovered interrupted plugin jobs', { requeued, failed });
    }
    return { requeued, failed };
}

/** Claim the oldest queued job, or null. */
async function claimNext() {
    const job = await dbAdapter.get(
        `SELECT * FROM plugin_jobs WHERE state = 'queued' ORDER BY created_at, rowid LIMIT 1`
    );
    if (!job) return null;
    // Guarded by the state in the WHERE clause so a second claimant cannot take
    // the same row, even though v1 runs one worker — the guard costs nothing and
    // is what makes adding a second worker a scheduling change rather than a
    // correctness one.
    const res = await dbAdapter.run(
        `UPDATE plugin_jobs SET state = 'running', started_at = CURRENT_TIMESTAMP,
                attempts = attempts + 1, progress = 0
          WHERE id = ? AND state = 'queued'`,
        [job.id]
    );
    if ((res?.changes ?? 0) === 0) return null;
    return { ...job, attempts: job.attempts + 1 };
}

async function finish(jobId, state, { error = null, result = null } = {}) {
    await dbAdapter.run(
        `UPDATE plugin_jobs SET state = ?, phase = NULL, finished_at = CURRENT_TIMESTAMP,
                error = ?, result = ? WHERE id = ?`,
        [state, error, result === null ? null : JSON.stringify(result), jobId]
    );
}

/** Has a cancel been requested for this job? Read fresh — that is the point. */
async function cancelRequested(jobId) {
    const row = await dbAdapter.get('SELECT cancel_requested FROM plugin_jobs WHERE id = ?', [jobId]);
    return Boolean(row?.cancel_requested);
}

async function runOne(job) {
    const handler = handlers.get(job.kind);
    if (!handler) {
        // Possible after a deploy that removed a plugin while work was queued.
        await finish(job.id, 'failed', { error: `no handler for job kind '${job.kind}'` });
        return;
    }
    const jobLog = logger(`plugin-job:${job.plugin_id}`);
    const api = {
        /** Announce a phase AND take the cancellation checkpoint at the same
         *  point — the two belong together, so a handler cannot advance a phase
         *  without giving the operator a place to stop it. */
        async setPhase(phase) {
            if (await cancelRequested(job.id)) {
                const err = new Error('cancelled');
                err.code = 'plugin_job_cancelled';
                throw err;
            }
            await dbAdapter.run('UPDATE plugin_jobs SET phase = ? WHERE id = ?', [phase, job.id]);
        },
        async setProgress(percent) {
            const clamped = Math.max(0, Math.min(100, Math.round(percent)));
            await dbAdapter.run('UPDATE plugin_jobs SET progress = ? WHERE id = ?', [clamped, job.id]);
        },
        cancelled: () => cancelRequested(job.id),
        log: jobLog,
    };
    try {
        const result = await handler({ ...job, payload: JSON.parse(job.payload || '{}') }, api);
        await finish(job.id, 'done', { result: result ?? null });
    } catch (err) {
        if (err?.code === 'plugin_job_cancelled') {
            await finish(job.id, 'cancelled');
            jobLog.info('plugin job cancelled', { jobId: job.id, kind: job.kind });
            return;
        }
        // Logged with the kind and id, never re-thrown: an unhandled rejection
        // in the worker would take down a process that is otherwise serving.
        jobLog.error('plugin job failed', { jobId: job.id, kind: job.kind, error: err?.message });
        await finish(job.id, 'failed', { error: String(err?.message ?? err).slice(0, 2000) });
    }
}

/**
 * Run queued jobs until none are left. Idempotent and re-entrant-safe: calling
 * it while a job is running sets a flag rather than starting a second worker.
 */
export function pump() {
    if (running || stopped) { pumpQueued = true; return; }
    running = true;
    pumpQueued = false;
    void (async () => {
        try {
            for (;;) {
                if (stopped) break;
                const job = await claimNext();
                if (!job) break;
                await runOne(job);
            }
        } finally {
            running = false;
            if (pumpQueued && !stopped) pump();
        }
    })();
}

/** Await the current job and refuse to start more. For shutdown and tests. */
export async function drain({ timeoutMs = 30_000 } = {}) {
    stopped = true;
    const deadline = Date.now() + timeoutMs;
    while (running && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
    }
    return !running;
}

/** Test seam — allow pumping again after drain(). */
export function resume() { stopped = false; }

/**
 * Delete finished job rows older than `days`. Assets are never touched: a job
 * row is a record of WORK and an asset is a record of a THING, and sweeping the
 * former must not disturb the latter.
 *
 * @param {number} days
 * @returns {Promise<number>} rows removed
 */
export async function sweepFinishedJobs(days) {
    const res = await dbAdapter.run(
        `DELETE FROM plugin_jobs
          WHERE state IN ('done', 'failed', 'cancelled')
            AND finished_at IS NOT NULL
            AND finished_at < datetime('now', ?)`,
        [`-${Math.max(1, Math.floor(days))} days`]
    );
    return res?.changes ?? 0;
}
