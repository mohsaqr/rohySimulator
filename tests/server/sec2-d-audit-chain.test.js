// Security fix pass 2026-10-26, lane D — audit chain.
//
// Regression lock: the chain's hash left out username, status, error_message and session_id, so those four could be rewritten without verification noticing (L6-07). New rows are hashed under scheme 2 (hash_version = 2, migration 0073); scheme-1 rows keep verifying.
// Regression lock: new audit rows stored raw e-mail addresses and full IPs in a log that can never be erased (F-32 / L7-05); they now store a keyed digest and a /24 or /48 network.
// Regression lock: the in-process append queue was unbounded, so one flooding caller could grow it without limit (F-05 / L8-01); past AUDIT_MAX_PENDING an append is refused with AuditQueueFullError.
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';
import {
    appendAuditEntry,
    verifyAuditChain,
    canonicalRow,
    computeEntryHash,
    auditEmailDigest,
    truncateIp,
    AUDIT_MAX_PENDING,
    AuditQueueFullError,
} from '../../server/audit-chain.js';

const contexts = [];
async function freshCtx(label) {
    const ctx = await createTestDb({ label });
    contexts.push(ctx);
    return ctx;
}

describe('audit chain, lane D', () => {
    afterEach(async () => {
        while (contexts.length) await contexts.pop().cleanup();
    });

    it('hashes new rows under scheme 2, which covers username, status, error_message and session_id', async () => {
        const ctx = await freshCtx('d-audit-v2');
        await appendAuditEntry({ tenantId: 1, userId: null, username: 'alice', action: 'login', status: 'failure', errorMessage: 'bad password', sessionId: '12' }, { database: ctx.db });
        const row = await ctx.get('SELECT * FROM system_audit_log ORDER BY id DESC LIMIT 1');
        expect(row.hash_version).toBe(2);
        expect(row.entry_hash).toBe(computeEntryHash(row.prev_hash, canonicalRow(row)));
        expect((await verifyAuditChain({ tenant_id: 1, database: ctx.db })).ok).toBe(true);

        for (const [column, value] of [['username', 'mallory'], ['status', 'success'], ['error_message', null], ['session_id', 99]]) {
            const original = row[column];
            await ctx.run(`UPDATE system_audit_log SET ${column} = ? WHERE id = ?`, [value, row.id]);
            const verdict = await verifyAuditChain({ tenant_id: 1, database: ctx.db });
            expect(verdict.ok, column).toBe(false);
            expect(verdict.brokenAt).toBe(row.id);
            await ctx.run(`UPDATE system_audit_log SET ${column} = ? WHERE id = ?`, [original, row.id]);
        }
        expect((await verifyAuditChain({ tenant_id: 1, database: ctx.db })).ok).toBe(true);
    });

    it('a downgrade of hash_version to scheme 1 is caught', async () => {
        const ctx = await freshCtx('d-audit-downgrade');
        await appendAuditEntry({ tenantId: 1, username: 'bob', action: 'x', status: 'success' }, { database: ctx.db });
        await ctx.run('UPDATE system_audit_log SET hash_version = NULL, username = ? WHERE id = (SELECT MAX(id) FROM system_audit_log)', ['eve']);
        expect((await verifyAuditChain({ tenant_id: 1, database: ctx.db })).ok).toBe(false);
    });

    it('scheme-1 rows already in a chain keep verifying beside scheme-2 rows', async () => {
        const ctx = await freshCtx('d-audit-mixed');
        // A row written the pre-rc.89 way: scheme-1 hash, hash_version NULL.
        const ts = '2026-10-01T10:00:00.000Z';
        const legacy = { tenantId: 1, userId: null, action: 'legacy', resourceType: 'case', resourceId: '1', ts, username: 'old', status: 'success' };
        const hash = computeEntryHash(null, canonicalRow(legacy, 1));
        await ctx.run(
            `INSERT INTO system_audit_log (timestamp, username, action, resource_type, resource_id, status, tenant_id, prev_hash, entry_hash)
             VALUES (?, 'old', 'legacy', 'case', '1', 'success', 1, NULL, ?)`, [ts, hash]);
        await appendAuditEntry({ tenantId: 1, action: 'new', username: 'new' }, { database: ctx.db });
        const verdict = await verifyAuditChain({ tenant_id: 1, database: ctx.db });
        expect(verdict.ok).toBe(true);
        const rows = await ctx.all('SELECT hash_version FROM system_audit_log ORDER BY id');
        expect(rows.map((r) => r.hash_version)).toEqual([null, 2]);
    });

    it('stores an e-mail as a keyed digest and the IP as its network', async () => {
        const ctx = await freshCtx('d-audit-pii');
        await appendAuditEntry({
            tenantId: 1, action: 'create_user',
            newValue: JSON.stringify({ username: 'carol', email: 'Carol@Example.org', nested: { alternative_email: 'c2@example.org' } }),
            ipAddress: '203.0.113.77',
        }, { database: ctx.db });
        await appendAuditEntry({ tenantId: 1, action: 'login', ipAddress: '2001:db8:abcd:12::1' }, { database: ctx.db });
        await appendAuditEntry({ tenantId: 1, action: 'login', ipAddress: '::ffff:198.51.100.9' }, { database: ctx.db });
        const rows = await ctx.all('SELECT new_value, ip_address FROM system_audit_log ORDER BY id');
        expect(rows[0].new_value).not.toContain('Carol@Example.org');
        expect(rows[0].new_value).not.toContain('c2@example.org');
        const stored = JSON.parse(rows[0].new_value);
        expect(stored.email).toBe(auditEmailDigest('carol@example.org'));
        expect(stored.username).toBe('carol');
        expect(rows.map((r) => r.ip_address)).toEqual(['203.0.113.0', '2001:db8:abcd::', '198.51.100.0']);
        expect((await verifyAuditChain({ tenant_id: 1, database: ctx.db })).ok).toBe(true);
    });

    it('truncateIp keeps non-IP text and nulls empties', () => {
        expect(truncateIp(null)).toBeNull();
        expect(truncateIp('')).toBeNull();
        expect(truncateIp('unknown')).toBe('unknown');
        expect(truncateIp('::1')).toBe('0:0:0::');
    });

    it('refuses appends past AUDIT_MAX_PENDING instead of growing the queue without bound', async () => {
        const ctx = await freshCtx('d-audit-queue');
        const extra = 25;
        const results = await Promise.allSettled(Array.from({ length: AUDIT_MAX_PENDING + extra }, (_, i) =>
            appendAuditEntry({ tenantId: 1, action: 'flood', resourceId: String(i) }, { database: ctx.db })));
        const refused = results.filter((r) => r.status === 'rejected');
        expect(refused.length).toBeGreaterThanOrEqual(extra);
        expect(refused.every((r) => r.reason instanceof AuditQueueFullError && r.reason.code === 'audit_queue_full')).toBe(true);
        const kept = await ctx.get("SELECT COUNT(*) AS n FROM system_audit_log WHERE action = 'flood'");
        expect(kept.n).toBe(results.length - refused.length);
        expect((await verifyAuditChain({ tenant_id: 1, database: ctx.db })).ok).toBe(true);
        // The queue drains: a later append succeeds.
        await expect(appendAuditEntry({ tenantId: 1, action: 'after' }, { database: ctx.db })).resolves.toBeTruthy();
    }, 120_000);
});
