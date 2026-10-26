// Regression lock: a student holding a teacher membership got the staff view of a course, a co-teacher could delete the owner's course, learners received case authoring titles on analytics routes, limit=-1 meant "everything", staff and ended sessions could still write a learner's transcript and record, and erased sessions stayed readable (security audit 2026-10-26, F-20, F-21, L8-10, L8-12, L2-13, L2-14, L2-17)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { asUser, closeDb, get, openDb, run, seedUser } from '../utils/authHttp.js';

const TITLE = 'LS-Title-Names-The-Diagnosis';
const DESCRIPTION = 'LS-Description-States-The-Answer';

describe('sec2 lane B — learner-facing surface', () => {
    let server;
    let db;
    const ids = {};
    const as = {};

    beforeAll(async () => {
        server = await startTestServer();
        db = await openDb(server.dbPath);
        ids.owner = await seedUser(db, { username: 'ls_owner', role: 'educator' });
        ids.coteacher = await seedUser(db, { username: 'ls_coteacher', role: 'educator' });
        ids.stu = await seedUser(db, { username: 'ls_stu', role: 'student' });
        ids.stuTeacher = await seedUser(db, { username: 'ls_stu_teacher', role: 'student' });
        ids.other = await seedUser(db, { username: 'ls_other', role: 'student' });

        ids.case = (await run(db, "INSERT INTO cases (name, description, system_prompt, config, tenant_id, is_available, case_code) VALUES (?, ?, 'p', '{}', 1, 1, 'EN-LS01')", [TITLE, DESCRIPTION])).lastID;
        const session = async (userId, extra = '') => (await run(db,
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id${extra ? ', end_time' : ''}) VALUES (?, ?, 'S', ?, 1${extra ? ', ?' : ''})`,
            extra ? [ids.case, userId, 'completed', extra] : [ids.case, userId, 'active'])).lastID;
        ids.live = await session(ids.stu);
        ids.ended = await session(ids.stu, new Date(Date.now() - 60 * 60 * 1000).toISOString());
        ids.justEnded = await session(ids.stu, new Date(Date.now() - 10 * 1000).toISOString());
        ids.erased = (await run(db, "INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id, deleted_at) VALUES (?, ?, 'S', 'active', 1, CURRENT_TIMESTAMP)", [ids.case, ids.stu])).lastID;
        await run(db, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30)
                       INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, tenant_id)
                       SELECT ?, ?, ?, 'EXAMINED', 'body_region', 1 FROM n`, [ids.live, ids.stu, ids.case]);

        ids.course = (await run(db, "INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('LS course', ?, 1)", [ids.owner])).lastID;
        await run(db, "INSERT INTO cohort_members (cohort_id, user_id, member_role, status) VALUES (?, ?, 'teacher', 'active')", [ids.course, ids.coteacher]);
        // A student holding a teacher row (added by mistake, or demoted since).
        await run(db, "INSERT INTO cohort_members (cohort_id, user_id, member_role, status) VALUES (?, ?, 'teacher', 'active')", [ids.course, ids.stuTeacher]);
        await run(db, "INSERT INTO lessons (cohort_id, tenant_id, title, is_published) VALUES (?, 1, 'LS-unpublished-draft', 0)", [ids.course]);
        await run(db, "INSERT INTO lessons (cohort_id, tenant_id, title, is_published) VALUES (?, 1, 'LS-published', 1)", [ids.course]);

        for (const name of ['owner', 'coteacher', 'stu', 'stuTeacher', 'other']) {
            as[name] = await asUser(server.baseUrl, { owner: 'ls_owner', coteacher: 'ls_coteacher', stu: 'ls_stu', stuTeacher: 'ls_stu_teacher', other: 'ls_other' }[name]);
        }
    }, 120_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    it('F-20: a teacher membership never gives a student the staff view (Regression lock: unpublished lessons to a student co-teacher)', async () => {
        const body = JSON.stringify(await (await as.stuTeacher(`/api/courses/modules/${ids.course}/lectures`)).json());
        expect(body).toContain('LS-published');
        expect(body).not.toContain('LS-unpublished-draft');
        const staff = JSON.stringify(await (await as.coteacher(`/api/courses/modules/${ids.course}/lectures`)).json());
        expect(staff).toContain('LS-unpublished-draft');
    });

    it('F-20: a student cannot be made a co-teacher (Regression lock: POST /teachers took any rank)', async () => {
        const res = await as.owner(`/api/cohorts/${ids.course}/teachers`, { method: 'POST', json: { identifier: 'ls_other' } });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('coteacher_rank');
        const created = await as.owner('/api/cohorts', { method: 'POST', json: { name: 'LS bad', coteacher_identifiers: ['ls_other'] } });
        expect(created.status).toBe(400);
    });

    it("L2-17: a co-teacher cannot delete the owner's course; learners cannot add repository scenarios (Regression lock)", async () => {
        const del = await as.coteacher(`/api/cohorts/${ids.course}`, { method: 'DELETE' });
        expect(del.status).toBe(403);
        expect((await get(db, 'SELECT deleted_at FROM cohorts WHERE id = ?', [ids.course])).deleted_at).toBeNull();
        const scenario = await as.stu('/api/scenarios', { method: 'POST', json: { name: 'x', timeline: [], duration_minutes: 5, is_public: 1 } });
        expect(scenario.status).toBe(403);
    });

    it('F-21: learner analytics carry the case code, never the title or description (Regression lock: 7 routes + complete-session)', async () => {
        const paths = [
            `/api/learning-events/session/${ids.live}`,
            `/api/learning-events/user/${ids.stu}`,
            '/api/learning-events/recent',
            `/api/learning-events/detailed/${ids.live}`,
            '/api/analytics/events',
            `/api/export/complete-session/${ids.live}`,
        ];
        for (const p of paths) {
            const res = await as.stu(p);
            expect(res.status, p).toBe(200);
            const text = await res.text();
            expect(text, p).not.toContain(TITLE);
            expect(text, p).not.toContain(DESCRIPTION);
        }
        const ownSession = await (await as.stu(`/api/learning-events/session/${ids.live}`)).json();
        expect(ownSession.events[0].case_name).toBe('EN-LS01');
    });

    it('L8-10: a negative limit is a small page, not the whole table (Regression lock: LIMIT -1)', async () => {
        const recent = await (await as.stu('/api/learning-events/recent?limit=-1')).json();
        expect(recent.events.length).toBe(1);
        const allEvents = await (await as.stu('/api/learning-events/all?limit=-1')).json();
        expect((allEvents.events || []).length).toBe(1);
    });

    it('L2-14: an erased session is gone from the hand-rolled lookups (Regression lock: deleted_at missing)', async () => {
        expect((await as.stu(`/api/learning-events/session/${ids.erased}`)).status).toBe(404);
        expect((await as.stu(`/api/learning-events/detailed/${ids.erased}`)).status).toBe(404);
        expect((await as.stu(`/api/learning-events/analytics/summary?session_id=${ids.erased}`)).status).toBe(404);
    });

    it('L8-12: transcript turns are the owner\'s, while the session is open, as user/assistant only (Regression lock: forged/after-end turns)', async () => {
        const turn = (who, sessionId, role = 'user') => as[who]('/api/interactions', { method: 'POST', json: { session_id: sessionId, role, content: 'hi' } });
        expect((await turn('stu', ids.live)).status).toBe(200);
        expect((await turn('stu', ids.live, 'assistant')).status).toBe(200);
        expect((await turn('stu', ids.live, 'system')).status).toBe(400);
        expect((await turn('stu', ids.justEnded, 'assistant')).status).toBe(200); // grace for the streaming reply
        const after = await turn('stu', ids.ended);
        expect(after.status).toBe(409);
        expect((await after.json()).code).toBe('SESSION_ENDED');
        const staff = await turn('owner', ids.live);
        expect(staff.status).toBe(403);
        expect((await staff.json()).code).toBe('NOT_SESSION_OWNER');
    });

    it('L8-12: the encounter record is closed after the session ends and is the owner\'s to write (Regression lock)', async () => {
        const sync = (who, sessionId) => as[who]('/api/patient-record/sync', {
            method: 'POST',
            json: { session_id: sessionId, record_id: `r-${sessionId}`, events: [], patient_info: {}, current_state: {}, events_count: 0, document: {} },
        });
        expect((await sync('stu', ids.live)).status).toBe(200);
        expect((await sync('stu', ids.ended)).status).toBe(409);
        expect((await sync('owner', ids.live)).status).toBe(403);
        expect((await as.stu(`/api/patient-record/${ids.ended}`, { method: 'DELETE' })).status).toBe(409);
        expect((await as.owner(`/api/patient-record/${ids.live}`, { method: 'DELETE' })).status).toBe(403);
    });

    it("L2-13: staff cannot order into a learner's session (Regression lock: orders recorded as the learner)", async () => {
        const labs = await as.owner(`/api/sessions/${ids.live}/order-labs`, { method: 'POST', json: { lab_ids: ['default_Hemoglobin'] } });
        expect(labs.status).toBe(403);
        expect((await labs.json()).code).toBe('NOT_SESSION_OWNER');
        const tx = await as.owner(`/api/sessions/${ids.live}/order-treatment`, { method: 'POST', json: { treatment_type: 'medication', treatment_name: 'Aspirin' } });
        expect(tx.status).toBe(403);
        expect((await tx.json()).code).toBe('NOT_SESSION_OWNER');
        const rad = await as.owner(`/api/sessions/${ids.live}/order-radiology`, { method: 'POST', json: { radiology_ids: ['x'] } });
        expect(rad.status).toBe(403);
        expect((await rad.json()).code).toBe('NOT_SESSION_OWNER');
        const orders = await get(db, 'SELECT COUNT(*) AS n FROM treatment_orders WHERE session_id = ?', [ids.live]);
        expect(orders.n).toBe(0);
    });
});
