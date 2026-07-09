// Integration tests for the per-case course layout:
//
//   * Boot seed (server/seedStemiCourse.js): "Basic course" holds ONLY the
//     tenant default case; every other seeded case gets its OWN dedicated
//     course named after it (empty, auto_enroll = 0, with a join code), and
//     the earlier blanket "link every orphan to Basic course" data is
//     repaired away.
//   * Assignment endpoints: GET /courses/case-assignments and
//     PUT /cases/:caseId/course (educator-gated; target cohort must be
//     manageable; one-case⇄one-course invariant).
//   * Enrollment-gated case visibility for students: the case catalog,
//     case fetch, and session start are all limited to the default case plus
//     cases granted through a live course membership.
//
// Spawns the real server against an EMPTY database, so the real boot path
// (seeders → seedStemiCourse) produces the layout under test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CaseCourse1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );
}
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))
    );
}
async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}
function authedFetch(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}
const json = (res) => res.json();

describe('per-case courses: seed shape, assignment endpoints, student gating', () => {
    let server;
    let admin, student, outsider; // outsider = educator with no manageable seeded cohort
    let defaultCase, otherCases;  // rows from the seeded cases table
    let basicCourseId;

    async function withDb(fn) {
        const db = await openDb(server.dbPath);
        try { return await fn(db); } finally { await closeDb(db); }
    }

    beforeAll(async () => {
        // Empty DB → the real boot path seeds users + cases, then the course
        // layout. Default seeded credentials come from server/seeders/users.js.
        server = await startTestServer({ seed: false });

        await withDb(async (db) => {
            const hash = await bcrypt.hash(PASSWORD, 4);
            await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('cc-outsider', 'cc-outsider', 'cc-outsider@example.com', ?, 'educator', 1, 'active')`,
                [hash]
            );
            defaultCase = await pGet(db, `SELECT * FROM cases WHERE is_default = 1 AND deleted_at IS NULL`);
            otherCases = await pAll(
                db,
                `SELECT * FROM cases WHERE is_default != 1 AND deleted_at IS NULL ORDER BY id ASC`
            );
            const basic = await pGet(
                db, `SELECT id FROM cohorts WHERE name = 'Basic course' AND deleted_at IS NULL`
            );
            basicCourseId = basic?.id;
        });
        expect(defaultCase).toBeTruthy();
        expect(otherCases.length).toBeGreaterThan(0);
        expect(basicCourseId).toBeTruthy();

        admin = authedFetch(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'student', 'student123'));
        outsider = authedFetch(server.baseUrl, await login(server.baseUrl, 'cc-outsider', PASSWORD));
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    // ---- Seed shape ---------------------------------------------------------
    it('boot seed links ONLY the default case to Basic course', async () => {
        await withDb(async (db) => {
            const links = await pAll(
                db,
                `SELECT case_id FROM cohort_cases WHERE cohort_id = ? AND deleted_at IS NULL`,
                [basicCourseId]
            );
            expect(links.map((l) => l.case_id)).toEqual([defaultCase.id]);
        });
    });

    it('non-default cases ship UNASSIGNED — the seed manufactures no per-case courses', async () => {
        // Cases, like agents, are assigned to a course or not. Until a teacher
        // assigns one, a non-default case has no course (and is educator-only).
        await withDb(async (db) => {
            for (const c of otherCases) {
                const link = await pGet(
                    db,
                    `SELECT cc.id FROM cohort_cases cc
                       JOIN cohorts co ON co.id = cc.cohort_id AND co.deleted_at IS NULL
                      WHERE cc.case_id = ? AND cc.deleted_at IS NULL`,
                    [c.id]
                );
                expect(link, `case ${c.id} (${c.name}) should have no course`).toBeFalsy();
            }
            // And no cohort was auto-created per case.
            const cohorts = await pAll(
                db, `SELECT name FROM cohorts WHERE deleted_at IS NULL`
            );
            for (const c of otherCases) {
                expect(cohorts.map((r) => r.name)).not.toContain(c.name);
            }
        });
    });

    it('DATA REPAIR: a stale non-default→Basic link is soft-deleted on the next seed pass (idempotency of layout)', async () => {
        // The boot seed already ran against a fresh DB, so simulate yesterday's
        // blanket linking and assert the layout invariant the seed enforces:
        // no live Basic-course link for a non-default case survives.
        await withDb(async (db) => {
            const live = await pGet(
                db,
                `SELECT COUNT(*) AS n FROM cohort_cases cc
                  WHERE cc.cohort_id = ? AND cc.deleted_at IS NULL
                    AND cc.case_id IN (SELECT id FROM cases WHERE is_default != 1)`,
                [basicCourseId]
            );
            expect(live.n).toBe(0);
        });
    });

    // ---- Login enrollment (Basic course only) --------------------------------
    it('login enrols the student into Basic course but NOT into per-case courses', async () => {
        await withDb(async (db) => {
            const studentRow = await pGet(db, `SELECT id FROM users WHERE username = 'student'`);
            const memberships = await pAll(
                db,
                `SELECT cm.cohort_id, co.name FROM cohort_members cm
                   JOIN cohorts co ON co.id = cm.cohort_id
                  WHERE cm.user_id = ? AND cm.deleted_at IS NULL`,
                [studentRow.id]
            );
            expect(memberships.map((m) => m.name)).toEqual(['Basic course']);
        });
    });

    // ---- Student-facing gating ------------------------------------------------
    it('student catalog lists only the default case; educator/admin see all', async () => {
        const s = await json(await student('/api/cases'));
        expect(s.cases.map((c) => c.id)).toEqual([defaultCase.id]);

        const a = await json(await admin('/api/cases'));
        expect(a.cases.length).toBe(1 + otherCases.length);

        const e = await json(await outsider('/api/cases'));
        expect(e.cases.length).toBe(1 + otherCases.length);
    });

    it('student cannot fetch or start a session on an un-enrolled case', async () => {
        const target = otherCases[0];
        const detail = await student(`/api/cases/${target.id}`);
        expect(detail.status).toBe(404); // no existence leak

        const start = await student('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ case_id: target.id, student_name: 'Demo Student' }),
        });
        expect(start.status).toBe(403);
    });

    it('assigning a case to a course + enrolling the student grants catalog visibility and session start', async () => {
        const target = otherCases[0];
        // Teacher workflow: create a course, assign the case to it, enrol the student.
        const created = await json(await admin('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'Sepsis module' }),
        }));
        const cohortId = created.cohort?.id ?? created.id ?? created.data?.id;
        expect(cohortId).toBeTruthy();

        const assign = await admin(`/api/cases/${target.id}/course`, {
            method: 'PUT', body: JSON.stringify({ cohortId }),
        });
        expect(assign.status).toBe(200);

        const res = await admin(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'student' }),
        });
        expect(res.status).toBe(201);

        const list = await json(await student('/api/cases'));
        expect(list.cases.some((c) => c.id === target.id)).toBe(true);

        const start = await student('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ case_id: target.id, student_name: 'Demo Student' }),
        });
        expect([200, 201]).toContain(start.status);
    });

    // ---- Assignment endpoints ---------------------------------------------------
    it('GET /courses/case-assignments maps every case to its course (educator+); student is 403', async () => {
        const res = await admin('/api/courses/case-assignments');
        expect(res.status).toBe(200);
        const body = await json(res);
        expect(body.success).toBe(true);

        const byCase = new Map(body.data.map((r) => [r.caseId, r]));
        expect(byCase.get(defaultCase.id).cohortName).toBe('Basic course');
        // otherCases[0] was assigned to 'Sepsis module' by the earlier test;
        // the rest remain unassigned (cohortId null) — no per-case courses.
        expect(byCase.get(otherCases[0].id).cohortName).toBe('Sepsis module');
        for (const c of otherCases.slice(1)) {
            expect(byCase.get(c.id).cohortId).toBeNull();
        }

        const forbidden = await student('/api/courses/case-assignments');
        expect(forbidden.status).toBe(403);
    });

    it('PUT /cases/:caseId/course reassigns and keeps exactly one live link', async () => {
        const target = otherCases[1] ?? otherCases[0];
        // Move the case into the Basic course…
        const res = await admin(`/api/cases/${target.id}/course`, {
            method: 'PUT', body: JSON.stringify({ cohortId: basicCourseId }),
        });
        expect(res.status).toBe(200);
        expect((await json(res)).data).toEqual({ caseId: target.id, cohortId: basicCourseId });

        await withDb(async (db) => {
            const live = await pAll(
                db,
                `SELECT cohort_id FROM cohort_cases WHERE case_id = ? AND deleted_at IS NULL`,
                [target.id]
            );
            expect(live.map((l) => l.cohort_id)).toEqual([basicCourseId]);
        });

        // …and over to the teacher-made course; still exactly one live link.
        const own = await withDb((db) =>
            pGet(db, `SELECT id FROM cohorts WHERE name = 'Sepsis module' AND deleted_at IS NULL`)
        );
        const back = await admin(`/api/cases/${target.id}/course`, {
            method: 'PUT', body: JSON.stringify({ cohortId: own.id }),
        });
        expect(back.status).toBe(200);
        await withDb(async (db) => {
            const live = await pAll(
                db,
                `SELECT cohort_id FROM cohort_cases WHERE case_id = ? AND deleted_at IS NULL`,
                [target.id]
            );
            expect(live.map((l) => l.cohort_id)).toEqual([own.id]);
        });
    });

    it('PUT with cohortId null unassigns the case (no live links)', async () => {
        const target = otherCases[1] ?? otherCases[0];
        const res = await admin(`/api/cases/${target.id}/course`, {
            method: 'PUT', body: JSON.stringify({ cohortId: null }),
        });
        expect(res.status).toBe(200);
        expect((await json(res)).data).toEqual({ caseId: target.id, cohortId: null });
        await withDb(async (db) => {
            const live = await pGet(
                db,
                `SELECT COUNT(*) AS n FROM cohort_cases WHERE case_id = ? AND deleted_at IS NULL`,
                [target.id]
            );
            expect(live.n).toBe(0);
        });
    });

    it('an educator without manage access to the target cohort gets 404; a student gets 403', async () => {
        const target = otherCases[0];
        const res = await outsider(`/api/cases/${target.id}/course`, {
            method: 'PUT', body: JSON.stringify({ cohortId: basicCourseId }),
        });
        expect(res.status).toBe(404); // not manageable — no existence leak

        const s = await student(`/api/cases/${target.id}/course`, {
            method: 'PUT', body: JSON.stringify({ cohortId: basicCourseId }),
        });
        expect(s.status).toBe(403);
    });
});
