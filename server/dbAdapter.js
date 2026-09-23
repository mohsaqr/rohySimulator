import db from './db.js';
import { timeDbAdapterQuery } from './observability.js';
import { logger } from './logger.js';

const adapterLog = logger('dbAdapter');

// Routes use fire-and-forget `dbAdapter.run('BEGIN IMMEDIATE')` / `.run('COMMIT')`
// with no callback. Without a callback, sqlite3-driver errors vanish.
// If COMMIT silently fails (BUSY, constraint check, etc.), the
// connection stays in a pending transaction and the next BEGIN throws
// "cannot start a transaction within a transaction" — the cascade that
// caused the 2026-05-08 chat 502 incident.
//
// We catch this class at the adapter level: when the SQL is a TCL verb
// AND no callback was passed AND the call fails, log loudly with the
// SQL + error so on-call sees it instead of having to dig the cascade
// out of nginx error logs.
const TCL_VERB_RE = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
function isTclStatement(sql) {
    return typeof sql === 'string' && TCL_VERB_RE.test(sql);
}

/**
 * Stage E8 database portability adapter.
 *
 * This module is the future drop-in surface for a Postgres-backed adapter:
 * `get`, `all`, `run`, `serialize`, `transaction`, `prepare`, `now`, and
 * `upsert`. It deliberately reuses the existing sqlite3 handle exported by
 * `server/db.js` and does not open another connection. Existing route code
 * still calls the legacy sqlite3 callback API directly; migrating routes to
 * this Promise-returning adapter is out of scope for E8 and deferred. Actual
 * Postgres migration is also out of scope; E8 is the structural prerequisite.
 *
 * Future Postgres notes:
 * - `now()` maps from SQLite `datetime('now')` to Postgres `NOW()`.
 * - `INSERT OR IGNORE` should become `INSERT ... ON CONFLICT (...) DO NOTHING`.
 * - `INSERT OR REPLACE` should become explicit `INSERT ... ON CONFLICT (...)
 *   DO UPDATE SET ...`; avoid SQLite replacement semantics because they delete
 *   and reinsert rows.
 */

function normalizeParams(params) {
    return Array.isArray(params) ? params : [params];
}

function splitParamsAndCallback(params, callback) {
    if (typeof params === 'function') {
        return { params: [], callback: params };
    }
    // Throw on the variadic-args misuse — `.run(a, b, c, fn)` would
    // otherwise silently shift `b` into the callback slot and surface
    // later as an uncaught TypeError that crashes the whole process.
    if (callback != null && typeof callback !== 'function') {
        throw new TypeError(
            `dbAdapter callback must be a function or undefined; got ${typeof callback}. ` +
            'Likely cause: called .run(a, b, c, fn) instead of .run([a, b, c], fn). ' +
            'Pass parameters as an array.'
        );
    }
    return { params: params ?? [], callback };
}

export function get(sql, params = [], callback) {
    const args = splitParamsAndCallback(params, callback);
    const promise = timeDbAdapterQuery('adapter.get', sql, () => new Promise((resolve, reject) => {
        db.get(sql, normalizeParams(args.params), (err, row) => {
            err ? reject(err) : resolve(row || null);
        });
    }));
    if (args.callback) promise.then((row) => args.callback(null, row), args.callback);
    return promise;
}

export function all(sql, params = [], callback) {
    const args = splitParamsAndCallback(params, callback);
    const promise = timeDbAdapterQuery('adapter.all', sql, () => new Promise((resolve, reject) => {
        db.all(sql, normalizeParams(args.params), (err, rows) => {
            err ? reject(err) : resolve(rows || []);
        });
    }));
    if (args.callback) promise.then((rows) => args.callback(null, rows), args.callback);
    return promise;
}

// SQLITE_BUSY on the shared handle, and why a timeout does not cover it.
//
// The database runs in WAL mode, and the audit chain writes on its OWN
// connection (audit-chain.js). This handle runs statements in parallel, so one
// of them is often still reading — holding a read snapshot — when another
// statement on the same handle wants to write. If the audit connection
// committed in between, that snapshot is stale and sqlite refuses the write
// with SQLITE_BUSY AT ONCE: the busy timeout is not consulted, because
// waiting could never make a stale snapshot current. It clears as soon as the
// in-flight read finishes. Measured: 0 ms to fail with busy_timeout=5000, and
// the same write succeeds once the read is done.
//
// So a write that fails SQLITE_BUSY is retried here, briefly, with backoff —
// once, for every caller, instead of in each call site that happened to hit
// it (stampCaseCode, claimInviteUse and standingSpecialists each carried a
// copy). Retrying is safe: a statement that failed SQLITE_BUSY did not run.
// Transaction control (BEGIN/COMMIT/…) is never retried; write transactions
// open with BEGIN IMMEDIATE, which holds the write lock, so statements inside
// them do not hit this.
export const BUSY_RETRY_DELAYS_MS = Object.freeze([25, 50, 75, 100, 125]);

const isBusy = (err) => err?.code === 'SQLITE_BUSY' || /SQLITE_BUSY/.test(err?.message ?? '');

async function retryingBusy(sql, exec) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await exec();
        } catch (err) {
            if (!isBusy(err) || attempt >= BUSY_RETRY_DELAYS_MS.length) {
                if (isBusy(err)) {
                    adapterLog.warn('write still SQLITE_BUSY after retries', {
                        sql: sql.trim().slice(0, 80), attempts: attempt + 1,
                    });
                }
                throw err;
            }
            // Sequential by design: each retry waits for the previous one.
            await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAYS_MS[attempt]));
        }
    }
}

export function run(sql, params = [], callback) {
    const args = splitParamsAndCallback(params, callback);
    const exec = () => timeDbAdapterQuery('adapter.run', sql, () => new Promise((resolve, reject) => {
        db.run(sql, normalizeParams(args.params), function onRun(err) {
            err ? reject(err) : resolve({
                lastID: this.lastID,
                changes: this.changes,
                statement: this
            });
        });
    }));
    const promise = isTclStatement(sql) ? exec() : retryingBusy(sql, exec);
    if (args.callback) {
        promise.then((result) => args.callback.call(result.statement, null), (err) => args.callback(err));
    } else if (isTclStatement(sql)) {
        // Fire-and-forget transaction-control with no callback. If it
        // fails, log loudly. Callers that want to handle the error
        // should pass a callback or `await` the returned promise.
        promise.catch((err) => {
            adapterLog.error('fire-and-forget TCL statement failed', {
                sql: sql.trim().slice(0, 80),
                error: err.message,
                hint: 'Pass a callback or await the promise to handle this error in the route.',
            });
        });
    }
    return promise;
}

export function serialize(work) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            Promise.resolve()
                .then(() => work())
                .then(resolve, reject);
        });
    });
}

// BEGIN IMMEDIATE, not a deferred BEGIN: the database runs in WAL mode (set
// by the audit chain's connection), and a deferred transaction that reads and
// then writes fails with SQLITE_BUSY WITHOUT waiting when another connection
// committed in between — sqlite skips the busy timeout there to avoid a
// deadlock. Taking the write lock up front makes the wait apply.
export async function transaction(work) {
    return serialize(async () => {
        await run('BEGIN IMMEDIATE');
        try {
            const result = await work();
            await run('COMMIT');
            return result;
        } catch (err) {
            await run('ROLLBACK').catch(() => {});
            throw err;
        }
    });
}

export function prepare(sql) {
    const stmt = db.prepare(sql);
    return {
        run(params = [], callback) {
            const args = splitParamsAndCallback(params, callback);
            return timeDbAdapterQuery('adapter.prepare.run', sql, () => new Promise((resolve, reject) => {
                stmt.run(normalizeParams(args.params), function onPreparedRun(err) {
                    err ? reject(err) : resolve({
                        lastID: this.lastID,
                        changes: this.changes,
                        statement: this
                    });
                });
            })).then((result) => {
                if (args.callback) args.callback.call(result.statement, null);
                return result;
            }, (err) => {
                if (args.callback) args.callback(err);
                if (!args.callback) throw err;
                return undefined;
            });
        },
        get(params = [], callback) {
            const args = splitParamsAndCallback(params, callback);
            return timeDbAdapterQuery('adapter.prepare.get', sql, () => new Promise((resolve, reject) => {
                stmt.get(normalizeParams(args.params), (err, row) => {
                    err ? reject(err) : resolve(row || null);
                });
            })).then((row) => {
                if (args.callback) args.callback(null, row);
                return row;
            }, (err) => {
                if (args.callback) args.callback(err);
                if (!args.callback) throw err;
                return undefined;
            });
        },
        all(params = [], callback) {
            const args = splitParamsAndCallback(params, callback);
            return timeDbAdapterQuery('adapter.prepare.all', sql, () => new Promise((resolve, reject) => {
                stmt.all(normalizeParams(args.params), (err, rows) => {
                    err ? reject(err) : resolve(rows || []);
                });
            })).then((rows) => {
                if (args.callback) args.callback(null, rows);
                return rows;
            }, (err) => {
                if (args.callback) args.callback(err);
                if (!args.callback) throw err;
                return undefined;
            });
        },
        finalize(callback) {
            const promise = new Promise((resolve, reject) => {
                stmt.finalize((err) => err ? reject(err) : resolve());
            });
            if (callback) promise.then(() => callback(null), callback);
            return promise;
        },
        raw: stmt
    };
}

export function now() {
    return "datetime('now')";
}

export function upsert(table, conflictCols, setCols) {
    if (!table || !Array.isArray(conflictCols) || conflictCols.length === 0 || !Array.isArray(setCols) || setCols.length === 0) {
        throw new Error('upsert(table, conflictCols, setCols) requires non-empty conflictCols and setCols arrays');
    }

    const columns = conflictCols.concat(setCols);
    const placeholders = columns.map(() => '?').join(', ');
    const conflictTarget = conflictCols.join(', ');
    const updateSet = setCols.map((col) => `${col} = excluded.${col}`).join(', ');

    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateSet}`;
}

export default {
    get,
    all,
    run,
    serialize,
    transaction,
    prepare,
    now,
    upsert
};
