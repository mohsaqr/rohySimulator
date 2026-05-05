import db from './db.js';

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

export function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, normalizeParams(params), (err, row) => {
            err ? reject(err) : resolve(row || null);
        });
    });
}

export function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, normalizeParams(params), (err, rows) => {
            err ? reject(err) : resolve(rows || []);
        });
    });
}

export function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, normalizeParams(params), function onRun(err) {
            err ? reject(err) : resolve({
                lastID: this.lastID,
                changes: this.changes,
                statement: this
            });
        });
    });
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
        run(params = []) {
            return new Promise((resolve, reject) => {
                stmt.run(normalizeParams(params), function onPreparedRun(err) {
                    err ? reject(err) : resolve({
                        lastID: this.lastID,
                        changes: this.changes,
                        statement: this
                    });
                });
            });
        },
        get(params = []) {
            return new Promise((resolve, reject) => {
                stmt.get(normalizeParams(params), (err, row) => {
                    err ? reject(err) : resolve(row || null);
                });
            });
        },
        all(params = []) {
            return new Promise((resolve, reject) => {
                stmt.all(normalizeParams(params), (err, rows) => {
                    err ? reject(err) : resolve(rows || []);
                });
            });
        },
        finalize() {
            return new Promise((resolve, reject) => {
                stmt.finalize((err) => err ? reject(err) : resolve());
            });
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
