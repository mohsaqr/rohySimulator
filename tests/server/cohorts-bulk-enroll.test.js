import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, run, get, asUser } from '../utils/authHttp.js';

describe('cohort bulk enrollment operations', () => {
    let server;
    let db;
    let admin;
    let outsider;
    let cohortId;
    let studentId;
    let teacherId;
    let foreignId;
    const bulk = async (actor, action, userIds, cohortIds = [cohortId]) => {
        const response = await actor('/api/cohorts/bulk-enroll', {
            method: 'POST', json: { action, user_ids: userIds, cohort_ids: cohortIds },
        });
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        return body;
    };
    beforeAll(async () => {
        server = await startTestServer({ env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        db = await openDb(server.dbPath);
        const adminId = await seedUser(db, { username: 'bulk-admin', role: 'admin' });
        studentId = await seedUser(db, { username: 'bulk-student' });
        teacherId = await seedUser(db, { username: 'bulk-teacher', role: 'educator' });
        await seedUser(db, { username: 'bulk-outsider', role: 'educator' });
        await run(db, "INSERT INTO tenants (id, slug, name) VALUES (2, 'bulk-test', 'Synthetic bulk tenant')");
        foreignId = await seedUser(db, { username: 'bulk-foreign', tenantId: 2 });
        cohortId = (await run(db, "INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('Synthetic bulk cohort', ?, 1)", [adminId])).lastID;
        await run(db, "INSERT INTO cohort_members (cohort_id, user_id, member_role) VALUES (?, ?, 'teacher')", [cohortId, teacherId]);
        admin = await asUser(server.baseUrl, 'bulk-admin');
        outsider = await asUser(server.baseUrl, 'bulk-outsider');
    });
    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    it('deduplicates targets and reports foreign users and missing courses without enrolling them', async () => {
        const body = await bulk(admin, 'enroll', [studentId, studentId, foreignId], [cohortId, cohortId, 999999]);
        expect(body.summary).toMatchObject({ enrolled: 1, user_not_found: 1, cohort_denied: 1 });
        expect(body.results).toHaveLength(3);
        expect(await get(db, 'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, foreignId])).toBeUndefined();
    });

    it('keeps existing student enrollment idempotent and never demotes a live co-teacher', async () => {
        const body = await bulk(admin, 'enroll', [studentId, teacherId]);
        expect(body.summary).toMatchObject({ enrolled: 0, already: 2 });
        expect((await get(db, 'SELECT member_role FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, teacherId])).member_role).toBe('teacher');
        expect((await get(db, 'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, studentId])).n).toBe(1);
    });

    it('unenrolls once and revives the same row with expired lifecycle windows cleared', async () => {
        const prior = await get(db, 'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?', [cohortId, studentId]);
        expect((await bulk(admin, 'unenroll', [studentId])).summary.unenrolled).toBe(1);
        expect((await bulk(admin, 'unenroll', [studentId])).summary.not_member).toBe(1);
        await run(db, "UPDATE cohort_members SET status = 'completed', enrolled_from = '2000-01-01', enrolled_until = '2000-01-02' WHERE id = ?", [prior.id]);
        expect((await bulk(admin, 'enroll', [studentId])).summary.revived).toBe(1);
        expect(await get(db, 'SELECT id, status, deleted_at, enrolled_from, enrolled_until FROM cohort_members WHERE id = ?', [prior.id]))
            .toMatchObject({ id: prior.id, status: 'active', deleted_at: null, enrolled_from: null, enrolled_until: null });
    });

    it('refuses a course to an educator who is neither owner nor co-teacher', async () => {
        const before = await get(db, 'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ? AND deleted_at IS NULL', [cohortId]);
        expect((await bulk(outsider, 'unenroll', [studentId])).summary.cohort_denied).toBe(1);
        expect(await get(db, 'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ? AND deleted_at IS NULL', [cohortId])).toEqual(before);
    });
});
