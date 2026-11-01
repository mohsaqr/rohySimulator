// A course's registration code (cohorts.join_code) works at sign-up (PRV-68)
// and as a link (PRV-67).
//
// The teacher's course page calls the join code a "Registration code", and a
// teacher hands it to students who do not have an account yet. Until 3.1.0
// POST /auth/register only knew registration_invites tokens, so a course code
// typed into the register form's code field came back "That invite code is not
// valid" — in every registration mode. The code is now resolved in two steps:
// a registration invite first, then a live course's join code. A course code
// makes the newcomer a STUDENT of that course in the course's tenant, and it
// does NOT open a door the platform policy keeps shut (closed / invite-only),
// nor skip the approval queue — it says where the person goes, not whether
// they may come in.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import {
    openDb, closeDb, run, get, all, seedUser, asUser, register,
} from '../utils/authHttp.js';

const ENV = { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' };
const PASSWORD = 'CourseCode1';

describe('registering with a course registration code', () => {
    let server;
    let db;
    let admin;
    const ids = {};

    async function setMode(mode) {
        const res = await admin('/api/platform-settings/registration', {
            method: 'PUT', json: { mode, email_domains: [], message: '' },
        });
        expect(res.status).toBe(200);
    }

    function signUp(username, extra = {}) {
        return register(server.baseUrl, {
            username, email: `${username}@example.com`, password: PASSWORD, ...extra,
        });
    }

    async function memberships(username) {
        return all(db,
            `SELECT m.cohort_id FROM cohort_members m JOIN users u ON u.id = m.user_id
              WHERE u.username = ? AND m.deleted_at IS NULL ORDER BY m.cohort_id`,
            [username]);
    }

    beforeAll(async () => {
        server = await startTestServer({ env: ENV });
        db = await openDb(server.dbPath);
        ids.admin = await seedUser(db, { username: 'cc-admin', role: 'admin' });
        ids.teacher = await seedUser(db, { username: 'cc-teacher', role: 'educator' });
        ids.teacher2 = await seedUser(db, { username: 'cc-teacher-t2', role: 'educator', tenantId: 2 });
        const fi = await run(db,
            `INSERT INTO cohorts (name, owner_user_id, tenant_id, join_code) VALUES ('Suomi', ?, 1, 'FNKRS2QZ')`,
            [ids.teacher]);
        ids.finnish = fi.lastID;
        const t2 = await run(db,
            `INSERT INTO cohorts (name, owner_user_id, tenant_id, join_code) VALUES ('Tenant two', ?, 2, 'TWTNNT22')`,
            [ids.teacher2]);
        ids.tenantTwo = t2.lastID;
        const gone = await run(db,
            `INSERT INTO cohorts (name, owner_user_id, tenant_id, join_code, deleted_at)
             VALUES ('Closed course', ?, 1, 'CSDCRS34', CURRENT_TIMESTAMP)`,
            [ids.teacher]);
        ids.closed = gone.lastID;
        admin = await asUser(server.baseUrl, 'cc-admin');
        // An unseeded test DB is a fresh install with its own default mode;
        // these tests start from `open` and switch per test.
        await setMode('open');
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    it('creates a student account enrolled in the course (open mode)', async () => {
        // Regression lock: a course registration code at sign-up was refused as
        // "That invite code is not valid" (PRV-68).
        const r = await signUp('fi-student', { invite: 'FNKRS2QZ' });
        expect(r.status).toBe(201);
        expect(r.body.user.role).toBe('student');
        expect(r.body.user.tenant_id).toBe(1);
        // In the course — and ONLY there: the default course is for people who
        // registered without being sent to a course.
        expect(await memberships('fi-student')).toEqual([{ cohort_id: ids.finnish }]);
    });

    it('accepts the code however it was retyped (case, hyphen, spaces)', async () => {
        const r = await signUp('fi-student-typed', { invite: 'fnkr-s2 qz' });
        expect(r.status).toBe(201);
        expect(await memberships('fi-student-typed')).toEqual([{ cohort_id: ids.finnish }]);
    });

    it("puts the newcomer in the course's tenant", async () => {
        const r = await signUp('t2-student', { invite: 'TWTNNT22' });
        expect(r.status).toBe(201);
        expect(r.body.user.tenant_id).toBe(2);
        const row = await get(db, `SELECT tenant_id FROM users WHERE username = ?`, ['t2-student']);
        expect(row.tenant_id).toBe(2);
        expect(await memberships('t2-student')).toEqual([{ cohort_id: ids.tenantTwo }]);
    });

    it('never grants more than student, whatever the body asks for', async () => {
        const r = await signUp('fi-wannabe', { invite: 'FNKRS2QZ', role: 'educator' });
        expect(r.status).toBe(403);
        expect(await get(db, `SELECT id FROM users WHERE username = ?`, ['fi-wannabe'])).toBeUndefined();
    });

    it('records the course in the audit row of the registration', async () => {
        await signUp('fi-audited', { invite: 'FNKRS2QZ' });
        let row;
        for (let i = 0; i < 50 && !row; i++) {
            row = await get(db,
                `SELECT new_value FROM system_audit_log WHERE action = 'register_user_self' AND resource_name = ?`,
                ['fi-audited']);
            if (!row) await new Promise((r) => setTimeout(r, 100));
        }
        expect(row).toBeTruthy();
        expect(JSON.parse(row.new_value).via_course).toBe(ids.finnish);
    });

    it('refuses an unknown code and creates nobody', async () => {
        // Regression lock: a bad code must stay an error, not a silent plain signup.
        const r = await signUp('nobody-1', { invite: 'ZZZZZZZZ' });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('invite_not_found');
        expect(await get(db, `SELECT id FROM users WHERE username = ?`, ['nobody-1'])).toBeUndefined();
    });

    it("refuses a closed course's code as withdrawn", async () => {
        const r = await signUp('nobody-2', { invite: 'CSDCRS34' });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('invite_revoked');
        expect(await get(db, `SELECT id FROM users WHERE username = ?`, ['nobody-2'])).toBeUndefined();
    });

    it('refuses a code the teacher has disabled', async () => {
        const c = await run(db,
            `INSERT INTO cohorts (name, owner_user_id, tenant_id, join_code) VALUES ('Short-lived', ?, 1, 'SHRTVD45')`,
            [ids.teacher]);
        const teacher = await asUser(server.baseUrl, 'cc-teacher');
        expect((await teacher(`/api/cohorts/${c.lastID}/join-code`, { method: 'DELETE' })).status).toBe(200);
        const r = await signUp('nobody-3', { invite: 'SHRTVD45' });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('invite_not_found');
    });

    it('previews a course code for the register screen, naming the course', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/invite/fnkrs2qz`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            valid: true, kind: 'course', role: 'student', cohort_name: 'Suomi',
            expires_at: null, email_domain: null, uses_left: null,
        });
        const closed = await (await fetch(`${server.baseUrl}/api/auth/invite/CSDCRS34`)).json();
        expect(closed).toEqual({ valid: false, reason: 'revoked' });
    });

    it('keeps the platform email allowlist (a course code does not override it)', async () => {
        const res = await admin('/api/platform-settings/registration', {
            method: 'PUT', json: { mode: 'open', email_domains: ['uef.fi'], message: '' },
        });
        expect(res.status).toBe(200);
        try {
            const r = await signUp('fi-outsider', { invite: 'FNKRS2QZ' });
            expect(r.status).toBe(400);
            expect(r.body.code).toBe('email_domain_not_allowed');
        } finally {
            await setMode('open');
        }
    });

    it('queues the applicant in approval mode, and approval enrols them in the course', async () => {
        await setMode('approval');
        try {
            const r = await signUp('fi-applicant', { invite: 'FNKRS2QZ' });
            expect(r.status).toBe(202);
            expect(r.body.code).toBe('approval_pending');
            expect(await get(db, `SELECT id FROM users WHERE username = ?`, ['fi-applicant'])).toBeUndefined();
            const req = await get(db,
                `SELECT id, cohort_id, tenant_id FROM registration_requests WHERE username = ?`, ['fi-applicant']);
            expect(req.cohort_id).toBe(ids.finnish);
            expect(req.tenant_id).toBe(1);

            const list = await (await admin('/api/registration-requests')).json();
            const shown = list.requests.find((q) => q.username === 'fi-applicant');
            expect(shown.cohort_name).toBe('Suomi');

            const approve = await admin(`/api/registration-requests/${req.id}/approve`, { method: 'POST', json: {} });
            expect(approve.status).toBe(201);
            expect(await memberships('fi-applicant')).toEqual([{ cohort_id: ids.finnish }]);
        } finally {
            await setMode('open');
        }
    });

    it('does not open a closed platform', async () => {
        await setMode('closed');
        try {
            const r = await signUp('nobody-4', { invite: 'FNKRS2QZ' });
            expect(r.status).toBe(403);
            expect(r.body.code).toBe('registration_closed');
        } finally {
            await setMode('open');
        }
    });

    it('is not an invite on an invite-only platform, and says so', async () => {
        await setMode('invite');
        try {
            const r = await signUp('nobody-5', { invite: 'FNKRS2QZ' });
            expect(r.status).toBe(403);
            expect(r.body.code).toBe('course_code_not_invite');
            expect(await get(db, `SELECT id FROM users WHERE username = ?`, ['nobody-5'])).toBeUndefined();
        } finally {
            await setMode('open');
        }
    });

    it('lets a signed-in student join with the same code (the link, signed in)', async () => {
        await seedUser(db, { username: 'cc-existing' });
        const student = await asUser(server.baseUrl, 'cc-existing');
        const res = await student('/api/cohorts/join', { method: 'POST', json: { join_code: 'FNKRS2QZ' } });
        expect(res.status).toBe(200);
        expect((await res.json()).cohort.id).toBe(ids.finnish);
    });
});
