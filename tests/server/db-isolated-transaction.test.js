// dbAdapter.isolatedTransaction — a write transaction on a connection of its own.
//
// Regression lock: a transaction on rohy's ONE shared sqlite connection takes in any other request's write issued while it is open, so a rollback undid a write whose request had already answered "saved" (Codex review of case packages, 2026-10-10)

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-isolated-tx-'));
const dbFile = path.join(tmpDir, 'isolated.sqlite');
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('dbAdapter.isolatedTransaction', () => {
    it('does not take another request\'s write with it when it rolls back', async () => {
        const other = (async () => {
            await sleep(20); // lands while the transaction is open
            await dbAdapter.run(
                "INSERT INTO platform_settings (setting_key, setting_value) VALUES ('isolation_probe', 'kept')",
                []
            );
        })();
        await expect(dbAdapter.isolatedTransaction(async (tx) => {
            await tx.run("INSERT INTO cases (name, tenant_id) VALUES ('Isolation case', 1)");
            await sleep(150);
            throw new Error('forced failure');
        })).rejects.toThrow('forced failure');
        await other;

        expect(await dbAdapter.get("SELECT setting_value FROM platform_settings WHERE setting_key = 'isolation_probe'", []))
            .toEqual({ setting_value: 'kept' });
        expect(await dbAdapter.get("SELECT id FROM cases WHERE name = 'Isolation case'", [])).toBeNull();
    });

    it('commits what it wrote, and reads inside see its own writes', async () => {
        const { id, seen } = await dbAdapter.isolatedTransaction(async (tx) => {
            const inserted = await tx.run("INSERT INTO cases (name, tenant_id) VALUES ('Committed case', 1)");
            const row = await tx.get('SELECT name FROM cases WHERE id = ?', [inserted.lastID]);
            return { id: inserted.lastID, seen: row };
        });
        expect(seen).toEqual({ name: 'Committed case' });
        expect(await dbAdapter.get('SELECT name FROM cases WHERE id = ?', [id])).toEqual({ name: 'Committed case' });
    });
});
