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
    let admin;
    let ids = {};

    // Flip the `enforce_cohort_case_access` platform flag through the admin API
    // rather than writing platform_settings directly: the route also busts the
    // 15s in-process cache, so the next student request sees the new value.
    async function setEnforcement(enabled) {
        const res = await admin('/api/platform-settings/cohort-case-enforcement', {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
        });
        if (!res.ok) throw new Error(`setEnforcement(${enabled}) -> ${res.status}: ${await res.text()}`);
        expect((await res.json()).enabled).toBe(enabled);
    }

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            ids.admin = await seedUser(db, 'sca-admin', 'admin');
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
        admin = authed(server.baseUrl, await login(server.baseUrl, 'sca-admin'));
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    // The flag ships OFF, and an install that never opts in must behave exactly
    // as it did before cohort-case enforcement existed: any available case is
    // visible and launchable. Enforcement used to apply to every student
    // regardless of the flag, which silently locked down all existing installs
    // and made the admin toggle a no-op.
    describe('with enforcement OFF (the shipped default)', () => {
        beforeAll(async () => {
            await setEnforcement(false);
        });

        it('students see every available case, assigned or not', async () => {
            const list = await student('/api/cases');
            expect(list.status).toBe(200);
            const visibleIds = (await list.json()).cases.map(c => c.id);
            expect(visibleIds).toContain(ids.defaultCase);
            expect(visibleIds).toContain(ids.assignedCase);
            expect(visibleIds).toContain(ids.unassignedCase);
        });

        it('students can read and launch an unassigned case', async () => {
            const read = await student(`/api/cases/${ids.unassignedCase}`);
            expect(read.status).toBe(200);

            const launch = await student('/api/sessions', {
                method: 'POST',
                body: JSON.stringify({ case_id: ids.unassignedCase, student_name: 'sca-student' }),
            });
            expect(launch.status).toBe(200);
        });
    });

    describe('with enforcement ON', () => {
        beforeAll(async () => {
            await setEnforcement(true);
        });

        afterAll(async () => {
            await setEnforcement(false);
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

        it('educators keep full visibility while enforcement is on', async () => {
            const teacher = authed(server.baseUrl, await login(server.baseUrl, 'sca-teacher'));
            const list = await teacher('/api/cases');
            expect(list.status).toBe(200);
            const visibleIds = (await list.json()).cases.map(c => c.id);
            expect(visibleIds).toContain(ids.unassignedCase);
        });
    });
});
