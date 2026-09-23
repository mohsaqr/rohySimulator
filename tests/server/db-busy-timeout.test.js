// SQLITE_BUSY on the shared sqlite handle.
//
// The database runs in WAL mode and the audit chain writes on its OWN
// connection (audit-chain.js). Three different failures share the one error
// code, and each has its own fix — locked here:
//   1. another connection holds the write lock → each attempt waits the busy
//      timeout (db.js, 1000 ms, explicit) and dbAdapter.run retries, so a lock
//      held longer than one timeout is still ridden out;
//   2. a deferred transaction reads, the audit connection commits, and the
//      transaction's write is refused at once → dbAdapter.transaction() opens
//      with BEGIN IMMEDIATE;
//   3. a statement on the shared handle is still reading (a pinned snapshot)
//      when another statement on it writes after an audit commit → refused at
//      once, whatever the timeout → dbAdapter.run retries, bounded.
// The third is the common one: it is what lost case-code stamps and
// standing-specialist attaches, and what `session agents list failed:
// SQLITE_BUSY` in CI logs was.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import { createTestDb } from '../utils/seedDb.js';

let testDb;
let dbModule;
let dbAdapter;
let dbAdapterModule;
let other;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openOther(dbPath) {
    return new Promise((resolve, reject) => {
        const conn = new (sqlite3.verbose()).Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
    });
}
const otherRun = (sql, params = []) => new Promise((resolve, reject) =>
    other.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));

beforeAll(async () => {
    testDb = await createTestDb({ seed: false, label: 'busy-timeout' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'busy-timeout-tests';
    process.env.ROHY_NO_AUTO_SEED = '1';
    dbModule = await import('../../server/db.js');
    await dbModule.dbReady;
    dbAdapterModule = await import('../../server/dbAdapter.js');
    dbAdapter = dbAdapterModule.default;

    // The second connection is set up the way audit-chain.js sets up its own.
    other = await openOther(testDb.dbPath);
    await otherRun('PRAGMA journal_mode=WAL');
    await otherRun('PRAGMA busy_timeout=5000');
    await dbAdapter.run('CREATE TABLE IF NOT EXISTS busy_probe (id INTEGER PRIMARY KEY, who TEXT NOT NULL)');
}, 60_000);

afterAll(async () => {
    await new Promise((resolve) => (other ? other.close(() => resolve()) : resolve()));
    delete process.env.ROHY_NO_AUTO_SEED;
    await testDb?.cleanup();
});

describe('the shared sqlite handle', () => {
    it('sets its busy timeout explicitly, at the driver default', () => {
        expect(dbModule.DB_BUSY_TIMEOUT_MS).toBe(1000);
    });

    it('rides out a write lock another connection holds for longer than one timeout', async () => {
        // 1500 ms: longer than one 1000 ms wait, so this passes only because
        // the failed attempt is retried.
        await otherRun('BEGIN IMMEDIATE');
        await otherRun(`INSERT INTO busy_probe (who) VALUES ('audit')`);
        const release = sleep(1500).then(() => otherRun('COMMIT'));

        const started = Date.now();
        await expect(dbAdapter.run(`INSERT INTO busy_probe (who) VALUES ('request')`)).resolves.toBeTruthy();
        const waited = Date.now() - started;
        await release;

        // Not vacuous: it really was blocked, and got through once the lock went.
        expect(waited).toBeGreaterThanOrEqual(1200);
        const rows = await dbAdapter.all(`SELECT who FROM busy_probe ORDER BY id`);
        expect(rows.map((r) => r.who)).toEqual(['audit', 'request']);
    });

    it('retries a write refused on a stale read snapshot, once the read is done', async () => {
        await dbAdapter.run('DELETE FROM busy_probe');
        await dbAdapter.run(`INSERT INTO busy_probe (who) VALUES ('seed'), ('seed')`);
        // A read left mid-step on the SHARED handle pins its snapshot...
        const stmt = dbModule.default.prepare('SELECT * FROM busy_probe');
        await new Promise((resolve, reject) => stmt.get((err) => (err ? reject(err) : resolve())));
        // ...the audit connection commits, which makes that snapshot stale...
        await otherRun(`INSERT INTO busy_probe (who) VALUES ('audit')`);
        // ...and the read finishes a moment later, as a real one does.
        const finished = sleep(60).then(() => new Promise((resolve) => stmt.finalize(resolve)));
        try {
            await expect(dbAdapter.run(`INSERT INTO busy_probe (who) VALUES ('request')`)).resolves.toBeTruthy();
        } finally {
            await finished;
        }
        const rows = await dbAdapter.all(`SELECT who FROM busy_probe WHERE who <> 'seed' ORDER BY id`);
        expect(rows.map((r) => r.who)).toEqual(['audit', 'request']);
    });

    it('gives up after the bounded retries rather than waiting forever', async () => {
        await dbAdapter.run(`INSERT INTO busy_probe (who) VALUES ('seed')`);
        const stmt = dbModule.default.prepare('SELECT * FROM busy_probe');
        await new Promise((resolve, reject) => stmt.get((err) => (err ? reject(err) : resolve())));
        await otherRun(`INSERT INTO busy_probe (who) VALUES ('audit')`);

        const started = Date.now();
        let took;
        try {
            await expect(dbAdapter.run(`INSERT INTO busy_probe (who) VALUES ('never')`))
                .rejects.toMatchObject({ code: 'SQLITE_BUSY' });
            took = Date.now() - started;
        } finally {
            // Always release the pinned snapshot, or every later test inherits it.
            await new Promise((resolve) => stmt.finalize(resolve));
        }

        const budget = dbAdapterModule.BUSY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
        expect(took).toBeGreaterThanOrEqual(budget);
        expect(took).toBeLessThan(budget + 1500);
    });

    it('keeps a read-then-write transaction when another connection commits mid-way', async () => {
        await dbAdapter.run('DELETE FROM busy_probe');
        let otherWrite;
        const result = dbAdapter.transaction(async () => {
            const before = await dbAdapter.get('SELECT COUNT(*) AS n FROM busy_probe');
            // The audit connection appends while this transaction is open. With
            // a deferred BEGIN it commits here, and the write below then fails
            // SQLITE_BUSY at once; with BEGIN IMMEDIATE it waits for our commit.
            otherWrite = otherRun(`INSERT INTO busy_probe (who) VALUES ('audit')`);
            await sleep(250);
            await dbAdapter.run(`INSERT INTO busy_probe (who) VALUES ('request')`);
            return before.n;
        });

        await expect(result).resolves.toBe(0);
        await expect(otherWrite).resolves.toBeTruthy();
        const rows = await dbAdapter.all(`SELECT who FROM busy_probe ORDER BY id`);
        expect(rows.map((r) => r.who)).toEqual(['request', 'audit']);
    });
});
