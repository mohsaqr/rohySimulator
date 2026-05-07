import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';
import { runMigrations } from '../../server/migrationRunner.js';
import {
    appendAuditEntry,
    canonicalRow,
    computeEntryHash,
    verifyAuditChain,
} from '../../server/audit-chain.js';

const contexts = [];

function openDb(file) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, (err) => err ? reject(err) : resolve(db));
    });
}

function closeDb(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function done(err) {
            err ? reject(err) : resolve(this);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

async function freshCtx(label) {
    const ctx = await createTestDb({ label });
    contexts.push(ctx);
    return ctx;
}

describe('audit hash chain', () => {
    afterEach(async () => {
        while (contexts.length) {
            await contexts.pop().cleanup();
        }
    });

    it('validates entries inserted through appendAuditEntry', async () => {
        const ctx = await freshCtx('audit-chain');
        let lastId = null;
        for (let i = 0; i < 5; i += 1) {
            const inserted = await appendAuditEntry({
                tenantId: 1,
                userId: null,
                action: `ACTION_${i}`,
                resourceType: 'case',
                resourceId: String(i),
                metadata: { sequence: i },
            }, { database: ctx.db });
            lastId = inserted.id;
        }

        await expect(verifyAuditChain({ tenant_id: 1, database: ctx.db }))
            .resolves.toEqual({ ok: true, lastVerifiedId: lastId });
    });

    it('reports the first mutated row as brokenAt', async () => {
        const ctx = await freshCtx('audit-chain-mutate');
        const ids = [];
        for (let i = 0; i < 5; i += 1) {
            const inserted = await appendAuditEntry({
                tenantId: 1,
                action: `ACTION_${i}`,
                oldValue: { before: i },
            }, { database: ctx.db });
            ids.push(inserted.id);
        }

        await ctx.run(
            'UPDATE system_audit_log SET old_value = ? WHERE id = ?',
            [JSON.stringify({ before: 'tampered' }), ids[2]]
        );

        const result = await verifyAuditChain({ tenant_id: 1, database: ctx.db });
        expect(result.ok).toBe(false);
        expect(result.brokenAt).toBe(ids[2]);
        expect(result.expected).not.toBe(result.actual);
    });

    it('keeps tenant chains isolated', async () => {
        const ctx = await freshCtx('audit-chain-tenants');
        const tenantOne = await appendAuditEntry({
            tenantId: 1,
            action: 'TENANT_ONE',
            oldValue: { before: 1 },
        }, { database: ctx.db });
        await appendAuditEntry({
            tenantId: 2,
            action: 'TENANT_TWO',
            oldValue: { before: 2 },
        }, { database: ctx.db });

        await ctx.run(
            'UPDATE system_audit_log SET old_value = ? WHERE id = ?',
            [JSON.stringify({ before: 'tampered' }), tenantOne.id]
        );

        expect((await verifyAuditChain({ tenant_id: 1, database: ctx.db })).ok).toBe(false);
        expect(await verifyAuditChain({ tenant_id: 2, database: ctx.db }))
            .toEqual(expect.objectContaining({ ok: true }));
    });

    it('backfills legacy rows during migration 0008', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-audit-migration-'));
        const migrationsDir = path.join(dir, 'migrations');
        fs.mkdirSync(migrationsDir, { recursive: true });
        fs.writeFileSync(path.join(migrationsDir, '0001_initial.sql'), `
            CREATE TABLE system_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_id INTEGER,
                username TEXT,
                action TEXT NOT NULL,
                resource_type TEXT,
                resource_id TEXT,
                resource_name TEXT,
                old_value TEXT,
                new_value TEXT,
                ip_address TEXT,
                user_agent TEXT,
                session_id INTEGER,
                status TEXT DEFAULT 'success',
                error_message TEXT,
                metadata JSON,
                tenant_id INTEGER NOT NULL DEFAULT 1
            );
        `);
        const dbFile = path.join(dir, 'db.sqlite');
        const db = await openDb(dbFile);
        try {
            await runMigrations(db, { migrationsDir });
            await run(
                db,
                `INSERT INTO system_audit_log
                 (timestamp, user_id, action, resource_type, resource_id, metadata, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['2026-05-07T10:00:00.000Z', 1, 'LEGACY_ONE', 'case', '1', JSON.stringify({ n: 1 }), 1]
            );
            await run(
                db,
                `INSERT INTO system_audit_log
                 (timestamp, user_id, action, resource_type, resource_id, metadata, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['2026-05-07T10:01:00.000Z', 2, 'LEGACY_TWO', 'case', '2', JSON.stringify({ n: 2 }), 1]
            );

            fs.writeFileSync(path.join(migrationsDir, '0008_audit_hash_chain.sql'), `
                CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id_chain ON system_audit_log(tenant_id, id);
            `);
            await runMigrations(db, { migrationsDir });
            const rows = await all(db, 'SELECT * FROM system_audit_log ORDER BY id');
            let prevHash = null;
            for (const row of rows) {
                expect(row.prev_hash).toBe(prevHash);
                const expected = computeEntryHash(prevHash, canonicalRow(row));
                expect(row.entry_hash).toBe(expected);
                prevHash = expected;
            }
            expect(await verifyAuditChain({ tenant_id: 1, database: db }))
                .toEqual({ ok: true, lastVerifiedId: rows.at(-1).id });
        } finally {
            await closeDb(db);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
