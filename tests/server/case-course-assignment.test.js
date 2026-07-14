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
//     cases granted through a live course membership. This gating is OPT-IN
//     (`enforce_cohort_case_access`, shipped OFF), so these tests turn it on
//     through the admin toggle first; the last test covers the OFF default.
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
    let languageCases, legacyOtherCases; // otherCases split: seeded-into-the-default-course vs unassigned
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

            // Split the non-default cases: the seeded language cases (shipped
            // inside the single default "Basic course") vs the legacy ones that
            // ship unassigned.
            const basicLinks = await pAll(
                db,
                `SELECT cc.case_id FROM cohort_cases cc
                  WHERE cc.cohort_id = ? AND cc.deleted_at IS NULL`,
                [basicCourseId]
            );
            const basicCaseIds = new Set(basicLinks.map((l) => l.case_id));
            languageCases = otherCases.filter((c) => basicCaseIds.has(c.id));
            legacyOtherCases = otherCases.filter((c) => !basicCaseIds.has(c.id));
        });
        expect(defaultCase).toBeTruthy();
        expect(otherCases.length).toBeGreaterThan(0);
        expect(languageCases.length).toBe(3);      // de / es / it
        expect(legacyOtherCases.length).toBeGreaterThan(0);
        expect(basicCourseId).toBeTruthy();

        admin = authedFetch(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'student', 'student123'));
        outsider = authedFetch(server.baseUrl, await login(server.baseUrl, 'cc-outsider', PASSWORD));

        // Course-scoped case access is OPT-IN (`enforce_cohort_case_access`,
        // shipped OFF). The gating assertions below describe an install that has
        // opted in, so turn it on through the real admin toggle — which also
        // busts the 15s flag cache. The final test covers the shipped default.
        await setEnforcement(true);
    }, 90_000);

    // Flip the platform enforcement flag through the admin API.
    async function setEnforcement(enabled) {
        const res = await admin('/api/platform-settings/cohort-case-enforcement', {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
        });
        if (!res.ok) throw new Error(`setEnforcement(${enabled}) → ${res.status}: ${await res.text()}`);
        expect((await res.json()).enabled).toBe(enabled);
    }

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    // ---- Seed shape ---------------------------------------------------------
    it('boot seed links the default case PLUS the language cases into the single Basic course', async () => {
        await withDb(async (db) => {
            const links = await pAll(
                db,
                `SELECT case_id FROM cohort_cases WHERE cohort_id = ? AND deleted_at IS NULL`,
                [basicCourseId]
            );
            const linked = links.map((l) => l.case_id).sort((a, b) => a - b);
            const expected = [defaultCase.id, ...languageCases.map((c) => c.id)].sort((a, b) => a - b);
            expect(linked).toEqual(expected);
        });
    });

    it('legacy non-default cases ship UNASSIGNED; seeded language cases ship in the default Basic course', async () => {
        // Legacy non-default cases, like agents, are assigned to a course or
        // not — until a teacher assigns one they have no course (educator-only).
        // The seeded language cases are the exception: each ships already linked
        // to the single default "Basic course".
        await withDb(async (db) => {
            for (const c of legacyOtherCases) {
                const link = await pGet(
                    db,
                    `SELECT cc.id FROM cohort_cases cc
                       JOIN cohorts co ON co.id = cc.cohort_id AND co.deleted_at IS NULL
                      WHERE cc.case_id = ? AND cc.deleted_at IS NULL`,
                    [c.id]
                );
                expect(link, `case ${c.id} (${c.name}) should have no course`).toBeFalsy();
            }
            for (const c of languageCases) {
                const link = await pGet(
                    db,
                    `SELECT co.name FROM cohort_cases cc
                       JOIN cohorts co ON co.id = cc.cohort_id AND co.deleted_at IS NULL
                      WHERE cc.case_id = ? AND cc.deleted_at IS NULL`,
                    [c.id]
                );
                expect(link, `language case ${c.id} (${c.name}) should be in the default course`).toBeTruthy();
                expect(link.name).toBe('Basic course');
            }
            // No cohort was auto-created *named after a case* — there is one
            // default course, not a course per case/language.
            const cohorts = await pAll(
                db, `SELECT name FROM cohorts WHERE deleted_at IS NULL`
            );
            for (const c of otherCases) {
                expect(cohorts.map((r) => r.name)).not.toContain(c.name);
            }
        });
    });

    // ---- Login enrollment (the single default course) ------------------------
    it('login enrols the student into the default Basic course', async () => {
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
    it('student catalog lists the default case plus the language cases in the default course', async () => {
        const s = await json(await student('/api/cases'));
        const expected = [defaultCase.id, ...languageCases.map((c) => c.id)].sort((a, b) => a - b);
        expect(s.cases.map((c) => c.id).sort((a, b) => a - b)).toEqual(expected);

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

    // ---- Course annotation on the catalog ---------------------------------------
    it('GET /cases carries each case\'s course (course_name) for grouping', async () => {
        const a = await json(await admin('/api/cases'));
        const byId = new Map(a.cases.map((c) => [c.id, c]));

        expect(byId.get(defaultCase.id).course_name).toBe('Basic course');
        // otherCases[0] (a legacy case) was assigned to 'Sepsis module' by the
        // previous test.
        expect(byId.get(otherCases[0].id).course_name).toBe('Sepsis module');
        // The seeded language cases live in the single default Basic course.
        for (const c of languageCases) {
            expect(byId.get(c.id).course_name).toBe('Basic course');
        }
        // The remaining LEGACY cases ship unassigned → null course.
        for (const c of legacyOtherCases.slice(1)) {
            expect(byId.get(c.id).course_name).toBeNull();
        }

        // The enforced student sees only cases whose course they belong to —
        // never a null-course (unassigned) case.
        const s = await json(await student('/api/cases'));
        expect(s.cases.length).toBeGreaterThan(0);
        for (const c of s.cases) {
            expect(c.course_name).not.toBeNull();
        }
    });

    // ---- The shipped default ------------------------------------------------
    // Everything above describes an install that opted in. With the flag OFF —
    // which is what a fresh install actually ships — course membership must not
    // restrict anything: an unassigned case is visible and launchable. The three
    // gating sites used to ignore the flag entirely, so this was silently false.
    it('with enforcement OFF (the shipped default) a student sees and can launch an unassigned case', async () => {
        await setEnforcement(false);

        const unassigned = legacyOtherCases[legacyOtherCases.length - 1];
        const list = await json(await student('/api/cases'));
        expect(list.cases.some((c) => c.id === unassigned.id)).toBe(true);

        const detail = await student(`/api/cases/${unassigned.id}`);
        expect(detail.status).toBe(200);

        const start = await student('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ case_id: unassigned.id, student_name: 'Demo Student' }),
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
        // otherCases[0] (legacy) was assigned to 'Sepsis module' by the earlier
        // test; the seeded language cases map to the default Basic course; the
        // rest of the legacy cases remain unassigned (cohortId null).
        expect(byCase.get(otherCases[0].id).cohortName).toBe('Sepsis module');
        for (const c of languageCases) {
            expect(byCase.get(c.id).cohortName).toBe('Basic course');
        }
        for (const c of legacyOtherCases.slice(1)) {
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
