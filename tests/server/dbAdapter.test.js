// tests/server/dbAdapter.test.js
//
// Stage E8 — Promise wrappers around the existing sqlite3 callback API.
//
// CONTRACT (locked from server/dbAdapter.js):
//   - The adapter operates on the SINGLETON sqlite3 handle exported by
//     server/db.js. To test it against a fresh DB, we set process.env.ROHY_DB
//     to a tempfile BEFORE the first import of server/dbAdapter.js (which
//     transitively imports server/db.js). The singleton then opens that
//     tempfile and runMigrations() builds the schema in it.
//   - get(sql, params)        -> Promise<row | null>   (NOT undefined; locked)
//   - all(sql, params)        -> Promise<row[]>        ([] when empty)
//   - run(sql, params)        -> Promise<{ lastID, changes, statement }>
//                                (statement is the sqlite3 RunResult `this`,
//                                 which carries lastID/changes/sql/etc.)
//   - serialize(work)         -> Promise; runs work() inside db.serialize.
//   - transaction(work)       -> wraps work in BEGIN/COMMIT, ROLLBACK on
//                                throw or rejection. Re-throws the error.
//                                Nested transactions: inner BEGIN throws
//                                "cannot start a transaction within a
//                                transaction" because there are no
//                                savepoints — locked here.
//   - prepare(sql)            -> { run, get, all, finalize, raw }, all
//                                Promise-returning except `raw` (the
//                                underlying sqlite3 Statement).
//   - now()                   -> exact string "datetime('now')"
//   - upsert(table, conflictCols, setCols)
//                             -> "INSERT INTO {table} ({conflictCols, setCols})
//                                 VALUES ({?...}) ON CONFLICT
//                                 ({conflictCols}) DO UPDATE SET
//                                 {col} = excluded.{col}, ..."
//                                Throws when args invalid.
//
// We don't mock sqlite. We point the adapter's singleton at a fresh
// migrated tempfile, then exercise it directly. We also separately open
// a second tempfile via createTestDb to verify isolation between handles.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';
import { createTestDb } from '../utils/seedDb.js';

// ---- Tempfile setup BEFORE importing the adapter --------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-dbadapter-'));
const adapterDbPath = path.join(tmpDir, 'adapter.sqlite');
process.env.ROHY_DB = adapterDbPath;

// Migrate the file the singleton is about to open. server/db.js itself runs
// migrations on connect via initDb(); we also run them up front so the file
// is a valid sqlite DB before the singleton even touches it (defensive).
async function premigrate(file) {
    const sqlite = sqlite3.verbose();
    const handle = await new Promise((resolve, reject) => {
        const h = new sqlite.Database(file, (err) => err ? reject(err) : resolve(h));
    });
    try {
        await runMigrations(handle);
    } finally {
        await new Promise((r) => handle.close(() => r()));
    }
}
await premigrate(adapterDbPath);

// Now import the adapter — its singleton db will open adapterDbPath.
const adapterModule = await import('../../server/dbAdapter.js');
const { dbReady } = await import('../../server/db.js');
await dbReady;

const {
    get,
    all,
    run,
    serialize,
    transaction,
    prepare,
    now,
    upsert,
} = adapterModule;

describe('server/dbAdapter.js — Stage E8 Promise wrappers', () => {
    let isolatedDb;

    beforeAll(async () => {
        // Make a small playground table the adapter can scribble in. Use
        // a unique name so we don't trample any migrated schema row.
        await run(`CREATE TABLE IF NOT EXISTS adapter_probe (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value INTEGER
        )`);
        await run('DELETE FROM adapter_probe');

        // Second, completely independent sqlite handle for isolation tests.
        isolatedDb = await createTestDb({ label: 'dbadapter-iso' });
        await isolatedDb.run(`CREATE TABLE adapter_probe (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value INTEGER
        )`);
    });

    afterAll(async () => {
        if (isolatedDb) await isolatedDb.cleanup();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    // ---- get() -----------------------------------------------------------
    it('get() resolves a single row when the query matches', async () => {
        await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['alpha', 1]);
        const row = await get('SELECT name, value FROM adapter_probe WHERE name = ?', ['alpha']);
        expect(row).toMatchObject({ name: 'alpha', value: 1 });
    });

    it('get() resolves to null (NOT undefined) when no row matches', async () => {
        const row = await get('SELECT * FROM adapter_probe WHERE name = ?', ['__nope__']);
        expect(row).toBeNull();
    });

    it('get() rejects on SQL syntax / schema errors', async () => {
        await expect(get('SELECT * FROM no_such_table_xyz')).rejects.toThrow();
    });

    // ---- all() -----------------------------------------------------------
    it('all() returns an array of rows', async () => {
        await run('DELETE FROM adapter_probe');
        await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['a', 1]);
        await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['b', 2]);
        const rows = await all('SELECT name FROM adapter_probe ORDER BY name');
        expect(rows).toHaveLength(2);
        expect(rows[0].name).toBe('a');
        expect(rows[1].name).toBe('b');
    });

    it('all() resolves to [] when nothing matches', async () => {
        const rows = await all('SELECT * FROM adapter_probe WHERE 1=0');
        expect(Array.isArray(rows)).toBe(true);
        expect(rows).toEqual([]);
    });

    it('all() rejects on a bad query', async () => {
        await expect(all('SELECT FROM nothing_here')).rejects.toThrow();
    });

    // ---- run() -----------------------------------------------------------
    it('run() resolves with { lastID, changes, statement } on insert', async () => {
        await run('DELETE FROM adapter_probe');
        const result = await run(
            'INSERT INTO adapter_probe (name, value) VALUES (?, ?)',
            ['runshape', 42]
        );
        expect(result).toBeTypeOf('object');
        expect(result.changes).toBe(1);
        expect(typeof result.lastID).toBe('number');
        expect(result.lastID).toBeGreaterThan(0);
        // The third key is the sqlite3 RunResult `this`. We don't pin its
        // exact identity but we lock that the key exists and is non-null.
        expect(result).toHaveProperty('statement');
        expect(result.statement).not.toBeNull();
    });

    it('run() reports changes accurately for UPDATE and DELETE', async () => {
        await run('DELETE FROM adapter_probe');
        await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['x', 1]);
        await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['y', 2]);
        const upd = await run('UPDATE adapter_probe SET value = value + 1');
        expect(upd.changes).toBe(2);
        const del = await run('DELETE FROM adapter_probe WHERE name = ?', ['x']);
        expect(del.changes).toBe(1);
    });

    it('run() rejects on schema errors', async () => {
        await expect(run('INSERT INTO no_such_table (a) VALUES (?)', [1])).rejects.toThrow();
    });

    it('run() accepts a single non-array param and normalises it', async () => {
        await run('DELETE FROM adapter_probe');
        // Source uses normalizeParams: a non-array becomes [params].
        const r = await run('INSERT INTO adapter_probe (name, value) VALUES (?, 0)', 'scalar-param');
        expect(r.changes).toBe(1);
        const row = await get('SELECT name FROM adapter_probe WHERE name = ?', ['scalar-param']);
        expect(row.name).toBe('scalar-param');
    });

    // ---- serialize() -----------------------------------------------------
    it('serialize() runs work in order and resolves with its return value', async () => {
        await run('DELETE FROM adapter_probe');
        const result = await serialize(async () => {
            await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['s1', 1]);
            await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['s2', 2]);
            return 'serialized-ok';
        });
        expect(result).toBe('serialized-ok');
        const rows = await all('SELECT name FROM adapter_probe ORDER BY id');
        expect(rows.map((r) => r.name)).toEqual(['s1', 's2']);
    });

    it('serialize() propagates rejection from the inner work', async () => {
        await expect(serialize(async () => {
            throw new Error('serialize-boom');
        })).rejects.toThrow('serialize-boom');
    });

    // ---- transaction() ---------------------------------------------------
    it('transaction() commits on success', async () => {
        await run('DELETE FROM adapter_probe');
        const result = await transaction(async () => {
            await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['tx-ok', 7]);
            return 'committed';
        });
        expect(result).toBe('committed');
        const row = await get('SELECT value FROM adapter_probe WHERE name = ?', ['tx-ok']);
        expect(row).not.toBeNull();
        expect(row.value).toBe(7);
    });

    it('transaction() rolls back when work throws synchronously', async () => {
        await run('DELETE FROM adapter_probe');
        await expect(transaction(async () => {
            await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['tx-throw', 1]);
            throw new Error('rollback-please');
        })).rejects.toThrow('rollback-please');

        const row = await get('SELECT * FROM adapter_probe WHERE name = ?', ['tx-throw']);
        expect(row).toBeNull();
    });

    it('transaction() rolls back when work returns a rejected promise', async () => {
        await run('DELETE FROM adapter_probe');
        await expect(transaction(async () => {
            await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['tx-reject', 9]);
            return Promise.reject(new Error('async-reject'));
        })).rejects.toThrow('async-reject');

        const row = await get('SELECT * FROM adapter_probe WHERE name = ?', ['tx-reject']);
        expect(row).toBeNull();
    });

    it('transaction() does NOT support nesting (sqlite has no savepoints here) — locked behaviour', async () => {
        // Locked: the adapter issues raw BEGIN. Inside an active txn, a
        // second BEGIN raises "cannot start a transaction within a
        // transaction". The outer transaction then attempts ROLLBACK.
        await run('DELETE FROM adapter_probe');
        await expect(transaction(async () => {
            await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['outer', 1]);
            await transaction(async () => {
                await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['inner', 2]);
            });
        })).rejects.toThrow(/transaction/i);

        // Both rows should be rolled back.
        const rows = await all('SELECT name FROM adapter_probe WHERE name IN (?, ?)', ['outer', 'inner']);
        expect(rows).toEqual([]);
    });

    // ---- prepare() -------------------------------------------------------
    it('prepare() returns an object with run/get/all/finalize/raw', async () => {
        const stmt = prepare('SELECT 1 AS one');
        try {
            expect(typeof stmt.run).toBe('function');
            expect(typeof stmt.get).toBe('function');
            expect(typeof stmt.all).toBe('function');
            expect(typeof stmt.finalize).toBe('function');
            expect(stmt.raw).toBeTypeOf('object');
        } finally {
            await stmt.finalize();
        }
    });

    it('prepare().run/get/all all return promises and finalize resolves', async () => {
        await run('DELETE FROM adapter_probe');
        const ins = prepare('INSERT INTO adapter_probe (name, value) VALUES (?, ?)');
        const r1 = await ins.run(['p1', 100]);
        const r2 = await ins.run(['p2', 200]);
        expect(r1.changes).toBe(1);
        expect(r2.changes).toBe(1);
        expect(typeof r1.lastID).toBe('number');
        await ins.finalize();

        // Regression lock: 2026-05-08 incident. Calling prepare(sql).run(a, b)
        // (variadic, sqlite3-style) instead of .run([a, b]) used to silently
        // mangle params, then crash the WHOLE process with `TypeError:
        // args.callback.call is not a function` because b was treated as
        // the callback. Now: throws a clear TypeError synchronously, kept
        // as a route-scope error rather than an uncaught exception.
        const ins2 = prepare('INSERT INTO adapter_probe (name, value) VALUES (?, ?)');
        try {
            expect(() => ins2.run('p3', 300)).toThrow(/dbAdapter callback must be a function/);
            // And the same misuse via top-level run() also throws — same
            // splitParamsAndCallback gate.
            expect(() => run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', 'p4', 400)).toThrow(
                /dbAdapter callback must be a function/
            );
        } finally {
            await ins2.finalize();
        }

        const sel = prepare('SELECT name, value FROM adapter_probe WHERE name = ?');
        const row = await sel.get(['p1']);
        expect(row).toMatchObject({ name: 'p1', value: 100 });
        await sel.finalize();

        const selAll = prepare('SELECT name FROM adapter_probe ORDER BY name');
        const rows = await selAll.all([]);
        expect(rows.map((r) => r.name)).toEqual(['p1', 'p2']);
        await selAll.finalize();
    });

    // ---- now() -----------------------------------------------------------
    it("now() returns the exact SQL fragment \"datetime('now')\"", () => {
        // Locked literal — Postgres port will swap this for "NOW()".
        expect(now()).toBe("datetime('now')");
    });

    it('now() embedded in SQL produces a real ISO-ish timestamp at runtime', async () => {
        const row = await get(`SELECT ${now()} AS ts`);
        expect(row).toBeTypeOf('object');
        expect(typeof row.ts).toBe('string');
        // SQLite datetime('now') format: 'YYYY-MM-DD HH:MM:SS'
        expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    // ---- upsert() --------------------------------------------------------
    it('upsert() builds INSERT ... ON CONFLICT ... DO UPDATE for a single conflict column', () => {
        const sql = upsert('platform_settings', ['setting_key'], ['setting_value', 'updated_at']);
        expect(sql).toBe(
            'INSERT INTO platform_settings (setting_key, setting_value, updated_at) ' +
            'VALUES (?, ?, ?) ON CONFLICT (setting_key) DO UPDATE SET ' +
            'setting_value = excluded.setting_value, updated_at = excluded.updated_at'
        );
    });

    it('upsert() supports multi-column conflict targets', () => {
        const sql = upsert('case_agents', ['case_id', 'agent_id'], ['config_override']);
        expect(sql).toBe(
            'INSERT INTO case_agents (case_id, agent_id, config_override) ' +
            'VALUES (?, ?, ?) ON CONFLICT (case_id, agent_id) DO UPDATE SET ' +
            'config_override = excluded.config_override'
        );
    });

    it('upsert() throws when conflictCols or setCols are missing/empty', () => {
        expect(() => upsert('t', [], ['a'])).toThrow();
        expect(() => upsert('t', ['a'], [])).toThrow();
        expect(() => upsert('t', null, ['a'])).toThrow();
        expect(() => upsert('', ['a'], ['b'])).toThrow();
    });

    it('upsert() output executes against a real table and round-trips data', async () => {
        await run(`CREATE TABLE IF NOT EXISTS adapter_kv (
            k TEXT PRIMARY KEY,
            v TEXT
        )`);
        await run('DELETE FROM adapter_kv');

        const sql = upsert('adapter_kv', ['k'], ['v']);
        await run(sql, ['theme', 'dark']);
        await run(sql, ['theme', 'light']); // conflict -> update
        const rows = await all('SELECT k, v FROM adapter_kv');
        expect(rows).toEqual([{ k: 'theme', v: 'light' }]);
    });

    // ---- isolation between handles --------------------------------------
    it('writes through the adapter do not leak into an independent sqlite handle', async () => {
        await run('DELETE FROM adapter_probe');
        await run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['only-singleton', 999]);

        const fromIsolated = await isolatedDb.get(
            'SELECT * FROM adapter_probe WHERE name = ?',
            ['only-singleton']
        );
        expect(fromIsolated).toBeNull();

        // And vice-versa: writes to isolatedDb must not appear via adapter.
        await isolatedDb.run('INSERT INTO adapter_probe (name, value) VALUES (?, ?)', ['only-isolated', 1]);
        const fromAdapter = await get('SELECT * FROM adapter_probe WHERE name = ?', ['only-isolated']);
        expect(fromAdapter).toBeNull();
    });
});
