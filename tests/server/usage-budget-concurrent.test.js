// Regression lock: production 2026-10-25 — voice mode synthesises sentences
// concurrently (rc.70), so two recordUsage() calls overlapped. Both ran
// dbAdapter.transaction() on the ONE shared connection, whose serialisation
// does not span awaits: the second BEGIN IMMEDIATE failed with "cannot start
// a transaction within a transaction" and the /api/tts request answered 500.
// recordUsage now uses isolatedTransaction (its own connection + the database
// write lock), so concurrent writers wait instead of colliding, and no
// increment is lost.

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-budget-concurrent-'));
const dbFile = path.join(tmpDir, 'budget.sqlite');
process.env.ROHY_DB = dbFile;
process.env.ROHY_NO_AUTO_SEED = '1';
await new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbFile, (err) => {
        if (err) return reject(err);
        runMigrations(handle).then(() => handle.close(resolve), reject);
    });
});
const dbAdapter = (await import('../../server/dbAdapter.js')).default;
await (await import('../../server/db.js')).dbReady;
const budget = await import('../../server/usage-budget.js');

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('usage budget under concurrent writers (real sqlite)', () => {
    it('twelve overlapping recordUsage calls all land, none throws "transaction within a transaction"', async () => {
        const calls = Array.from({ length: 12 }, (_, i) =>
            budget.recordUsage({ tenantId: 1, userId: 7, provider: 'tts-kokoro', metric: 'characters', amount: 10 + i }));
        await expect(Promise.all(calls)).resolves.toBeDefined();

        const expected = Array.from({ length: 12 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0);
        const user = await budget.getCurrentUsage({ tenantId: 1, userId: 7, provider: 'tts-kokoro', metric: 'characters' });
        const tenant = await budget.getCurrentUsage({ tenantId: 1, userId: null, provider: 'tts-kokoro', metric: 'characters' });
        expect(user.used).toBe(expected);
        expect(tenant.used).toBe(expected);
        // Exactly one bucket row per scope: the UPDATE-then-INSERT never raced into duplicates.
        const rows = await dbAdapter.all(
            `SELECT user_id, COUNT(*) AS n FROM usage_budget WHERE provider = 'tts-kokoro' GROUP BY user_id`, []);
        expect(rows.map((r) => r.n)).toEqual([1, 1]);
    });

    it('a shared-handle write issued while a budget write is open is not swallowed by it', async () => {
        const writer = budget.recordUsage({ tenantId: 1, userId: 8, provider: 'tts-kokoro', metric: 'characters', amount: 5 });
        await dbAdapter.run("INSERT INTO platform_settings (setting_key, setting_value) VALUES ('budget_probe', 'kept')", []);
        await writer;
        expect(await dbAdapter.get("SELECT setting_value FROM platform_settings WHERE setting_key = 'budget_probe'", []))
            .toEqual({ setting_value: 'kept' });
    });
});
