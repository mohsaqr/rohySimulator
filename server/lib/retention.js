/**
 * In-process retention scheduler (security audit 2026-10-26, F-33 / L7-06).
 *
 * Settings → Oyon → "Retention (days)" was stored and never applied: the only
 * caller of the Oyon sweep was a deprecated script run with `--apply`, nothing
 * scheduled it, and it covered one of the three Oyon measurement tables. An
 * administrator who set 30 days kept everything forever. And the identifier
 * logs (login attempts, login sessions, terms acceptances, registration
 * requests) had no retention at all.
 *
 * This module applies retention from inside the server, once a day:
 *
 *   Oyon (ON whenever a tenant has set retention_days > 0 — the setting already
 *   exists and says it deletes):
 *     oyon_emotion_records  by window_start
 *     oyon_signal_windows   by window_start
 *     oyon_signal_events    by occurred_at
 *
 *   Identifier logs (OFF unless the operator sets a horizon, in days):
 *     ROHY_RETENTION_LOGIN_LOGS_DAYS          login_logs older than N days
 *     ROHY_RETENTION_ACTIVE_SESSIONS_DAYS     ended or expired login sessions
 *                                             whose last activity is older than N
 *     ROHY_RETENTION_TERMS_ACCEPTANCES_DAYS   superseded acceptances older than N
 *                                             (each user's LATEST acceptance per
 *                                             tenant is always kept: it is the
 *                                             proof the current terms were accepted)
 *     ROHY_RETENTION_REGISTRATION_DAYS        decided registration requests older
 *                                             than N (pending ones are kept), and
 *                                             the IP of invite uses older than N
 *
 * Deletes run in batches (BATCH rows per statement) so no single statement
 * holds the database write lock for long. Every run logs one summary line, and
 * a run that removed anything appends one audit row (`retention_sweep`).
 *
 * The scheduler is started by server.js (startRetentionScheduler); set
 * ROHY_RETENTION_SCHEDULER=0 to leave retention to an external job.
 * system_audit_log is never swept: its rows form a hash chain.
 */
import dbAdapter from '../dbAdapter.js';
import { logAuditAsync } from '../routes/_helpers.js';
import { logger } from '../logger.js';

const log = logger('retention');

export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BATCH = 1000;
// Bound on batches per table per run: 1000 × 500 = 500k rows. A backlog larger
// than that finishes on the following days rather than in one long run.
const MAX_BATCHES = 500;

const OYON_TABLES = Object.freeze([
    { table: 'oyon_emotion_records', column: 'window_start' },
    { table: 'oyon_signal_windows', column: 'window_start' },
    { table: 'oyon_signal_events', column: 'occurred_at' },
]);

/** A positive whole number of days from env, or null (that retention is off). */
export function retentionDays(env, name) {
    const raw = env?.[name];
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Delete in batches: `DELETE … WHERE rowid IN (SELECT rowid … LIMIT BATCH)`
 * until a batch comes back short. `whereSql` is a trusted literal from this
 * module; every value is bound.
 */
async function deleteInBatches(store, table, whereSql, params) {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i += 1) {
        // Table and predicate are module constants (see callers), never input.
        const result = await store.run(
            `DELETE FROM ${table} WHERE rowid IN (
                 SELECT rowid FROM ${table} WHERE ${whereSql} LIMIT ${BATCH})`,
            params,
        );
        const changes = result?.changes || 0;
        total += changes;
        if (changes < BATCH) return total;
    }
    log.warn('retention batch bound reached; the rest is removed on the next run', { table, removed: total });
    return total;
}

/**
 * One retention pass.
 *
 * @param {object} [opts]
 * @param {{all: Function, run: Function}} [opts.store=dbAdapter]  `run` must resolve `{changes}`
 * @param {object} [opts.env=process.env]
 * @returns {Promise<{oyon: Record<string, Record<string, number>>, login_logs: number|null,
 *           active_sessions: number|null, terms_acceptances: number|null,
 *           registration_requests: number|null, registration_invite_uses_ip: number|null,
 *           removed: number}>}  null = that retention is off
 */
export async function runRetentionSweep({ store = dbAdapter, env = process.env } = {}) {
    const summary = {
        oyon: {},
        login_logs: null,
        active_sessions: null,
        terms_acceptances: null,
        registration_requests: null,
        registration_invite_uses_ip: null,
        removed: 0,
    };

    // --- Oyon, per tenant ---------------------------------------------------
    const tenants = await store.all(
        `SELECT tenant_id, retention_days FROM oyon_settings
          WHERE retention_days IS NOT NULL AND retention_days > 0`,
    );
    for (const row of tenants) {
        const days = Math.floor(Number(row.retention_days));
        if (!Number.isFinite(days) || days <= 0) continue;
        const perTable = {};
        for (const { table, column } of OYON_TABLES) {
            // datetime() on the column: stored values are ISO-8601 with `T`/`Z`,
            // and comparing them to datetime('now') as text is off by a day.
            perTable[table] = await deleteInBatches(store, table,
                `tenant_id = ? AND datetime(${column}) < datetime('now', ?)`,
                [String(row.tenant_id), `-${days} days`]);
            summary.removed += perTable[table];
        }
        summary.oyon[String(row.tenant_id)] = perTable;
    }

    // --- identifier logs, when the operator set a horizon -------------------
    const loginDays = retentionDays(env, 'ROHY_RETENTION_LOGIN_LOGS_DAYS');
    if (loginDays) {
        summary.login_logs = await deleteInBatches(store, 'login_logs',
            `datetime(timestamp) < datetime('now', ?)`, [`-${loginDays} days`]);
        summary.removed += summary.login_logs;
    }

    const sessionDays = retentionDays(env, 'ROHY_RETENTION_ACTIVE_SESSIONS_DAYS');
    if (sessionDays) {
        summary.active_sessions = await deleteInBatches(store, 'active_sessions',
            `(is_active = 0 OR (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')))
             AND datetime(COALESCE(last_activity_at, login_at)) < datetime('now', ?)`,
            [`-${sessionDays} days`]);
        summary.removed += summary.active_sessions;
    }

    const termsDays = retentionDays(env, 'ROHY_RETENTION_TERMS_ACCEPTANCES_DAYS');
    if (termsDays) {
        summary.terms_acceptances = await deleteInBatches(store, 'terms_acceptances',
            `datetime(accepted_at) < datetime('now', ?)
             AND id NOT IN (SELECT MAX(id) FROM terms_acceptances GROUP BY tenant_id, user_id)`,
            [`-${termsDays} days`]);
        summary.removed += summary.terms_acceptances;
    }

    const registrationDays = retentionDays(env, 'ROHY_RETENTION_REGISTRATION_DAYS');
    if (registrationDays) {
        summary.registration_requests = await deleteInBatches(store, 'registration_requests',
            `status <> 'pending' AND datetime(COALESCE(decided_at, requested_at)) < datetime('now', ?)`,
            [`-${registrationDays} days`]);
        const ipResult = await store.run(
            `UPDATE registration_invite_uses SET ip_address = NULL
              WHERE ip_address IS NOT NULL AND datetime(used_at) < datetime('now', ?)`,
            [`-${registrationDays} days`],
        );
        summary.registration_invite_uses_ip = ipResult?.changes || 0;
        summary.removed += summary.registration_requests;
    }

    return summary;
}

/**
 * Run a sweep, log the summary, and record it in the audit chain when it
 * removed anything. Never throws: a failed run is logged and the next one
 * tries again.
 */
export async function runAndRecordRetention(opts = {}) {
    const started = Date.now();
    try {
        const summary = await runRetentionSweep(opts);
        log.info('retention sweep finished', { ...summary, duration_ms: Date.now() - started });
        if (summary.removed > 0 || (summary.registration_invite_uses_ip ?? 0) > 0) {
            try {
                await logAuditAsync({
                    action: 'retention_sweep',
                    resourceType: 'retention',
                    status: 'success',
                    metadata: summary,
                    tenantId: 1,
                });
            } catch (err) {
                log.warn('retention sweep audit write failed', { error: err.message });
            }
        }
        return summary;
    } catch (err) {
        log.error('retention sweep failed', { error: err.message, duration_ms: Date.now() - started });
        return null;
    }
}

/**
 * Start the daily sweep. The first run comes 5–20 minutes after boot (not at
 * once: boot is busy, and several processes started together should not all
 * sweep at the same moment), then every `intervalMs` with ±1 hour of jitter.
 * Timers are unref'd, so they never keep the process alive.
 *
 * @param {{intervalMs?: number, initialDelayMs?: number, env?: object, random?: () => number}} [opts]
 * @returns {{stop: () => void, enabled: boolean}}
 */
export function startRetentionScheduler({
    intervalMs = RETENTION_INTERVAL_MS,
    initialDelayMs,
    env = process.env,
    random = Math.random,
} = {}) {
    if (env.ROHY_RETENTION_SCHEDULER === '0') {
        log.info('retention scheduler disabled', { reason: 'ROHY_RETENTION_SCHEDULER=0' });
        return { stop() {}, enabled: false };
    }
    let timer = null;
    let stopped = false;
    const schedule = (delay) => {
        if (stopped) return;
        timer = setTimeout(async () => {
            await runAndRecordRetention({ env });
            const jitter = Math.round((random() * 2 - 1) * 60 * 60 * 1000);
            schedule(Math.max(60_000, intervalMs + jitter));
        }, delay);
        timer.unref?.();
    };
    const first = initialDelayMs ?? Math.round(5 * 60_000 + random() * 15 * 60_000);
    schedule(first);
    log.info('retention scheduler started', { first_run_in_ms: first, interval_ms: intervalMs });
    return {
        enabled: true,
        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
        },
    };
}
