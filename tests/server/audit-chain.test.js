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

    it('verifies a row written with a numeric resource id', async () => {
        // Regression lock: a numeric resourceId was hashed as a number but stored as text in the TEXT column, so verification failed on every such row (29 rows in production)
        const ctx = await freshCtx('audit-chain-numeric-id');
        const first = await appendAuditEntry({ tenantId: 1, action: 'learning_event_rejected', resourceType: 'session', resourceId: 42 }, { database: ctx.db });
        const second = await appendAuditEntry({ tenantId: 1, action: 'ORDERED_TREATMENT', resourceType: 'treatment_order', resourceId: 7, resourceName: 12 }, { database: ctx.db });
        const stored = await all(ctx.db, 'SELECT resource_id, resource_name FROM system_audit_log ORDER BY id');
        expect(stored).toEqual([{ resource_id: '42', resource_name: null }, { resource_id: '7', resource_name: '12' }]);
        // New rows carry the CANONICAL hash of what is stored, not only one the
        // verifier's legacy allowance would accept.
        for (const row of await all(ctx.db, 'SELECT * FROM system_audit_log ORDER BY id')) {
            expect(row.entry_hash).toBe(computeEntryHash(row.prev_hash, canonicalRow(row)));
        }
        await expect(verifyAuditChain({ tenant_id: 1, database: ctx.db }))
            .resolves.toEqual({ ok: true, lastVerifiedId: second.id });
        expect(first.id).toBeLessThan(second.id);
    });

    it('verifies a legacy row hashed with a numeric id, and still catches it being changed', async () => {
        const ctx = await freshCtx('audit-chain-legacy-numeric');
        // Written as the pre-fix writer did: hashed with the number, stored as text.
        const row = { action: 'ORDERED_TREATMENT', resourceType: 'treatment_order', resourceId: 103, tenantId: 1, timestamp: '2026-05-07T18:28:40.264Z' };
        const legacyHash = computeEntryHash(null, JSON.stringify(JSON.parse(canonicalRow({ ...row, resourceId: '103' })), (key, value) => (key === 'resourceId' ? 103 : value)));
        await ctx.run(
            `INSERT INTO system_audit_log (timestamp, action, resource_type, resource_id, status, tenant_id, prev_hash, entry_hash)
             VALUES (?, ?, ?, ?, 'success', 1, NULL, ?)`,
            [row.timestamp, row.action, row.resourceType, '103', legacyHash]);
        const next = await appendAuditEntry({ tenantId: 1, action: 'AFTER', resourceId: '1' }, { database: ctx.db });
        await expect(verifyAuditChain({ tenant_id: 1, database: ctx.db }))
            .resolves.toEqual({ ok: true, lastVerifiedId: next.id });

        await ctx.run("UPDATE system_audit_log SET resource_id = '104' WHERE resource_id = '103'");
        const tampered = await verifyAuditChain({ tenant_id: 1, database: ctx.db });
        expect(tampered.ok).toBe(false);
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

    // Regression lock: production hit "SQLITE_ERROR: cannot start a
    // transaction within a transaction" when 4 fire-and-forget audit
    // appends (one per voice setting saved) collided on BEGIN IMMEDIATE.
    // The mutex in audit-chain.js serializes appends so concurrent callers
    // queue cleanly; this test fires 8 in parallel and asserts every one
    // succeeds AND the resulting chain verifies end-to-end.
    it('serializes concurrent appends without nested-transaction errors', async () => {
        const ctx = await freshCtx('audit-chain-concurrent');
        const N = 8;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) =>
                appendAuditEntry({
                    tenantId: 1,
                    action: `CONCURRENT_${i}`,
                    resourceType: 'platform_setting',
                    resourceId: `key_${i}`,
                    newValue: { value: `v${i}` },
                }, { database: ctx.db })
            )
        );
        expect(results).toHaveLength(N);
        // Every append got a real id — no swallowed errors, no rollbacks.
        results.forEach(r => {
            expect(r.id).toBeGreaterThan(0);
            expect(typeof r.entryHash).toBe('string');
            expect(r.entryHash.length).toBeGreaterThan(0);
        });
        // The resulting chain still verifies — appends were properly
        // ordered and each row's prev_hash points at a real predecessor.
        await expect(verifyAuditChain({ tenant_id: 1, database: ctx.db }))
            .resolves.toEqual(expect.objectContaining({ ok: true }));
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

    // Regression lock: route-side BEGIN/COMMIT poisoning the connection
    // must not corrupt audit appends. Pre-fix, this test reproduces the
    // 2026-05-08 "are you from here" 502 cascade — appendAuditEntry
    // throws "cannot start a transaction within a transaction" because
    // the test passes the same handle a route already left mid-BEGIN.
    // Post-fix, the self-healing ROLLBACK in audit-chain clears the
    // orphan transaction and the audit append succeeds.
    it('recovers when the injected handle is stuck in a stale transaction', async () => {
        const ctx = await freshCtx('audit-chain-stuck-tx');

        // Simulate a route that opened BEGIN and never reached COMMIT
        // (e.g. a fire-and-forget COMMIT that silently failed).
        await run(ctx.db, 'BEGIN');

        // Audit append on the SAME handle would normally throw
        // SQLITE_ERROR: cannot start a transaction within a transaction.
        // The self-healing layer should detect that, ROLLBACK, and retry.
        const result = await appendAuditEntry({
            tenantId: 1,
            userId: null,
            action: 'TEST_RECOVERY',
            resourceType: 'case',
            resourceId: '99',
            metadata: { reason: 'simulated stuck route transaction' },
        }, { database: ctx.db });

        expect(result.id).toBeGreaterThan(0);

        // The audit row should be visible and chain-valid.
        const verify = await verifyAuditChain({ tenant_id: 1, database: ctx.db });
        expect(verify.ok).toBe(true);

        // And the connection should now be in a clean state — no
        // dangling transaction. A fresh BEGIN/COMMIT must succeed.
        await run(ctx.db, 'BEGIN');
        await run(ctx.db, 'COMMIT');
    });
});
