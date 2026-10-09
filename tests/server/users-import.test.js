import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, run, get, asUser, TEST_PASSWORD } from '../utils/authHttp.js';

describe('admin user import behavior', () => {
    let server;
    let db;
    let admin;
    let cohortId;
    let existingId;
    let otherId;
    const importRows = async (rows, options = {}) => {
        const response = await admin('/api/users/import', { method: 'POST', json: { rows, ...options } });
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        return body.results;
    };
    beforeAll(async () => {
        server = await startTestServer({ env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        db = await openDb(server.dbPath);
        const adminId = await seedUser(db, { username: 'import-admin', role: 'admin' });
        existingId = await seedUser(db, { username: 'import-existing' });
        otherId = await seedUser(db, { username: 'import-other' });
        cohortId = (await run(db,
            "INSERT INTO cohorts (name, owner_user_id, tenant_id, join_code) VALUES ('Synthetic Ä CLASS', ?, 1, 'ABCD2345')",
            [adminId]
        )).lastID;
        admin = await asUser(server.baseUrl, 'import-admin');
    });
    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    it('dry-run previews creation and enrolment without changing users or memberships', async () => {
        const result = await importRows([
            { username: 'import-preview', email: 'preview@example.com', password: TEST_PASSWORD, class: 'abcd2345' },
            { username: 'import-existing', email: 'import-existing@example.com', class: 'synthetic ä class' },
        ], { dryRun: true });
        expect(result.failed).toEqual([]);
        expect(result.created).toHaveLength(1);
        expect(result.enrolled).toHaveLength(1);
        expect(await get(db, "SELECT id FROM users WHERE username = 'import-preview'")).toBeUndefined();
        expect((await get(db, 'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ?', [cohortId])).n).toBe(0);
    });

    it('creates a user and enrols them using a case-insensitive join code', async () => {
        const result = await importRows([
            { username: 'import-created', email: 'created@example.com', password: TEST_PASSWORD, class: 'abcd2345' },
        ]);
        expect(result.failed).toEqual([]);
        expect(result.created).toHaveLength(1);
        expect(result.enrolled).toHaveLength(1);
        const user = await get(db, "SELECT id, tenant_id FROM users WHERE username = 'import-created'");
        expect(user.tenant_id).toBe(1);
        expect(await get(db, 'SELECT status, deleted_at FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, user.id]))
            .toMatchObject({ status: 'active', deleted_at: null });
        expect((await asUser(server.baseUrl, 'import-created')).token).toBeTruthy();
    });

    it('enrols an existing user by a folded non-ASCII class name, then revives their membership', async () => {
        const row = { username: 'import-existing', email: 'import-existing@example.com', class: 'synthetic ä class' };
        const first = await importRows([row]);
        expect(first.failed).toEqual([]);
        expect(first.created).toEqual([]);
        expect(first.enrolled[0]).toMatchObject({ existing: true });
        const membership = await get(db, 'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, existingId]);
        await run(db, "UPDATE cohort_members SET deleted_at = CURRENT_TIMESTAMP, status = 'dropped' WHERE id = ?", [membership.id]);
        const revived = await importRows([row]);
        expect(revived.failed).toEqual([]);
        expect(await get(db, 'SELECT id, status, deleted_at FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, existingId]))
            .toMatchObject({ id: membership.id, status: 'active', deleted_at: null });
    });

    it('rejects conflicting username/email identities in preview and commit without enrolling either', async () => {
        await run(db, 'DELETE FROM cohort_members WHERE cohort_id = ? AND user_id IN (?, ?)', [cohortId, existingId, otherId]);
        const row = { username: 'import-existing', email: 'import-other@example.com', class: 'ABCD2345' };
        for (const dryRun of [true, false]) {
            const result = await importRows([row], { dryRun });
            expect(result.created).toEqual([]);
            expect(result.enrolled).toEqual([]);
            expect(result.failed[0].error).toMatch(/different existing users/);
            expect((await get(db, 'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ?', [cohortId])).n).toBe(1);
        }
    });

    it('reports invalid and duplicate rows without creating accounts', async () => {
        const valid = { username: 'import-dedup', email: 'dedup@example.com', password: TEST_PASSWORD };
        const result = await importRows([
            valid, valid,
            { username: 'import-invalid', email: 'invalid@example.com', password: 'weak' },
        ], { dryRun: true });
        expect(result.created).toHaveLength(1);
        expect(result.failed.map(row => row.row)).toEqual([2, 3]);
        expect((await get(db, "SELECT COUNT(*) AS n FROM users WHERE username IN ('import-dedup', 'import-invalid')")).n).toBe(0);
    });
});
