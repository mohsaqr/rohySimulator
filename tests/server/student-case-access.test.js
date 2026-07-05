import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'StudentCaseAccess1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}

function closeDb(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

async function seedUser(db, username, role = 'student') {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]
    );
    return r.lastID;
}

async function seedCase(db, { name, isDefault = false }) {
    const r = await pRun(
        db,
        `INSERT INTO cases (name, tenant_id, is_available, is_default) VALUES (?, 1, 1, ?)`,
        [name, isDefault ? 1 : 0]
    );
    return r.lastID;
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

function authed(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

describe('student case access', () => {
    let server;
    let student;
    let ids = {};

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            ids.teacher = await seedUser(db, 'sca-teacher', 'educator');
            ids.student = await seedUser(db, 'sca-student', 'student');
            ids.defaultCase = await seedCase(db, { name: 'Default assigned fallback', isDefault: true });
            ids.assignedCase = await seedCase(db, { name: 'Assigned course case' });
            ids.unassignedCase = await seedCase(db, { name: 'Available but unassigned' });
            const cohort = await pRun(
                db,
                `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('Access course', ?, 1)`,
                [ids.teacher]
            );
            ids.cohort = cohort.lastID;
            await pRun(
                db,
                `INSERT INTO cohort_members (cohort_id, user_id, member_role, status) VALUES (?, ?, 'student', 'active')`,
                [ids.cohort, ids.student]
            );
            await pRun(db, `INSERT INTO cohort_cases (cohort_id, case_id) VALUES (?, ?)`, [ids.cohort, ids.assignedCase]);
        } finally {
            await closeDb(db);
        }
        student = authed(server.baseUrl, await login(server.baseUrl, 'sca-student'));
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('students see only the default case and cases assigned through active course enrolment', async () => {
        const list = await student('/api/cases');
        expect(list.status).toBe(200);
        const visibleIds = (await list.json()).cases.map(c => c.id);
        expect(visibleIds).toContain(ids.defaultCase);
        expect(visibleIds).toContain(ids.assignedCase);
        expect(visibleIds).not.toContain(ids.unassignedCase);
    });

    it('students cannot directly read or launch an available but unassigned case', async () => {
        const read = await student(`/api/cases/${ids.unassignedCase}`);
        expect(read.status).toBe(404);

        const launch = await student('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ case_id: ids.unassignedCase, student_name: 'sca-student' }),
        });
        expect(launch.status).toBe(403);
    });
});
