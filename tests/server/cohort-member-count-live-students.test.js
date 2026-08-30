// Regression lock: `member_count` means live enrolled STUDENTS on every
// cohort surface (UI swarm finding #25, v2.9.108).
//
// The course cards render `member_count` straight off GET /cohorts, which
// computed it as a raw `COUNT(*)` over live `cohort_members` — every row, any
// role. Every other surface of that same screen (the detail header, the
// roster, every report endpoint) counts `liveStudents()`:
// `member_role = 'student' AND users.role = 'student'`. So one course with one
// student and one co-teacher read "2 enrolled" on the card and "1 student"
// everywhere the educator clicked, on one screen, at the same moment.
//
// The fix is server-side — a single LIVE_STUDENT_PREDICATE shared by
// liveStudents(), memberCount() and the list subquery — because the client
// only renders the number it is handed.
//
// Fixture (one cohort): 1 student + 1 co-teacher + 1 educator enrolled as a
// student member + 1 soft-deleted student. The only live enrolled student is
// the first, so every surface must say 1. The un-fixed list endpoint says 3.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CohortCnt1!';

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

async function seedUser(db, username, role) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]
    );
    return r.lastID;
}

let server;
let db;
let ownerToken;
let cohortId;

beforeAll(async () => {
    server = await startTestServer();
    db = await openDb(server.dbPath);

    const ownerId = await seedUser(db, 'cnt-owner', 'educator');
    const studentId = await seedUser(db, 'cnt-student', 'student');
    const coteacherId = await seedUser(db, 'cnt-coteacher', 'educator');
    const educatorAsStudentId = await seedUser(db, 'cnt-edu-member', 'educator');
    const removedId = await seedUser(db, 'cnt-removed', 'student');

    const c = await pRun(
        db,
        `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('Counting course', ?, 1)`,
        [ownerId]
    );
    cohortId = c.lastID;

    const addMember = (userId, memberRole, deleted = false) =>
        pRun(
            db,
            `INSERT INTO cohort_members (cohort_id, user_id, member_role, deleted_at)
             VALUES (?, ?, ?, ?)`,
            [cohortId, userId, memberRole, deleted ? new Date().toISOString() : null]
        );

    await addMember(studentId, 'student');           // the only live enrolled student
    await addMember(coteacherId, 'teacher');         // a co-teacher, not a learner
    await addMember(educatorAsStudentId, 'student'); // educator-rank; not a student enrolment
    await addMember(removedId, 'student', true);     // removed from the course

    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'cnt-owner', password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    ownerToken = (await res.json()).token;
}, 90_000);

afterAll(async () => {
    if (db) await closeDb(db);
    if (server) await server.close();
});

const get = (path) =>
    fetch(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${ownerToken}` } });

describe('member_count is the role-filtered live-student count', () => {
    it('GET /cohorts (the course cards) counts only live enrolled students', async () => {
        const res = await get('/api/cohorts');
        expect(res.status).toBe(200);
        const { cohorts } = await res.json();
        const row = cohorts.find((c) => c.id === cohortId);
        expect(row).toBeDefined();
        // Un-fixed: 3 (student + co-teacher + educator-as-student member).
        expect(row.member_count).toBe(1);
    });

    it('GET /cohorts/:id agrees with the card', async () => {
        const res = await get(`/api/cohorts/${cohortId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.cohort.member_count).toBe(1);
    });

    it('agrees with the roster, which is liveStudents() itself', async () => {
        const card = await (await get('/api/cohorts')).json();
        const count = card.cohorts.find((c) => c.id === cohortId).member_count;

        const res = await get(`/api/cohorts/${cohortId}/roster`);
        expect(res.status).toBe(200);
        const { roster } = await res.json();
        // The card and the roster are the two surfaces the finding says
        // contradicted each other. Their identity IS the fix.
        expect(roster.length).toBe(count);
        expect(roster.map((r) => r.username)).toEqual(['cnt-student']);
    });

    it('agrees with the detail screen roster partition', async () => {
        const res = await get(`/api/cohorts/${cohortId}`);
        const body = await res.json();
        expect(body.teachers.map((t) => t.username)).toEqual(['cnt-coteacher']);
        // `students` deliberately partitions by MEMBERSHIP role, so the
        // educator enrolled as a student member appears there — but they are
        // not a live enrolled student and must not be counted as one.
        expect(body.students.map((s) => s.username).sort())
            .toEqual(['cnt-edu-member', 'cnt-student']);
        expect(body.cohort.member_count).toBe(1);
    });

    it('a newly created course reports 0 students, not its co-teacher tally', async () => {
        const res = await fetch(`${server.baseUrl}/api/cohorts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'Fresh course', coteachers: ['cnt-coteacher'] }),
        });
        expect(res.status).toBe(201);
        const { cohort } = await res.json();
        // Un-fixed: 1 — it reported the co-teacher it had just attached.
        expect(cohort.member_count).toBe(0);
    });
});
