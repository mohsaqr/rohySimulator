import db from './db.js';
import { timeDbAdapterQuery } from './observability.js';

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
    // Defensive: catch the variadic-args misuse pattern where a caller
    // writes `.run(a, b, c, fn)` instead of `.run([a, b, c], fn)`. Without
    // this guard the legacy code path silently mangles the call (params
    // becomes `a`, callback becomes `b`) and then crashes the WHOLE
    // process with `TypeError: args.callback.call is not a function`.
    // Prefer a thrown error here — the route-level error handler catches
    // it as a request-scope failure instead of an uncaught exception that
    // takes the process down. See 2026-05-08 incident for the symptom
    // (TTS 502s caused by patient-record-sync silently mangling args).
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

export function run(sql, params = [], callback) {
    const args = splitParamsAndCallback(params, callback);
    const promise = timeDbAdapterQuery('adapter.run', sql, () => new Promise((resolve, reject) => {
        db.run(sql, normalizeParams(args.params), function onRun(err) {
            err ? reject(err) : resolve({
                lastID: this.lastID,
                changes: this.changes,
                statement: this
            });
        });
    }));
    if (args.callback) promise.then((result) => args.callback.call(result.statement, null), (err) => args.callback(err));
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

export async function transaction(work) {
    return serialize(async () => {
        await run('BEGIN');
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
