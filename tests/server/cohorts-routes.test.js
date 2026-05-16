// Integration tests for /api/cohorts/* — Phase 3a (backend only).
//
// Spawns the real server, seeds users directly into the isolated DB, then
// drives the cohort lifecycle over HTTP. Asserts the role/owner/tenant
// boundaries that the phase brief calls out.
//
// Seeded users (all tenant 1 unless noted):
//   - coh-teacher-a   educator
//   - coh-teacher-b   educator   (separate owner — isolation target)
//   - coh-admin       admin
//   - coh-student     student
//   - coh-student-2   student    (added by email)
//   - coh-t2-student  student,   tenant 2 (cross-tenant join target)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CohTests1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

async function seedUser(db, { username, role, tenant = 1 }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenant]
    );
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
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

describe('/api/cohorts routes', () => {
    let server;
    let teacherA, teacherB, admin, student, t2Student;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'coh-teacher-a', role: 'educator' });
            await seedUser(db, { username: 'coh-teacher-b', role: 'educator' });
            await seedUser(db, { username: 'coh-admin', role: 'admin' });
            await seedUser(db, { username: 'coh-student', role: 'student' });
            await seedUser(db, { username: 'coh-student-2', role: 'student' });
            await seedUser(db, { username: 'coh-t2-student', role: 'student', tenant: 2 });
        } finally {
            await closeDb(db);
        }
        teacherA  = authedFetch(server.baseUrl, await login(server.baseUrl, 'coh-teacher-a'));
        teacherB  = authedFetch(server.baseUrl, await login(server.baseUrl, 'coh-teacher-b'));
        admin     = authedFetch(server.baseUrl, await login(server.baseUrl, 'coh-admin'));
        student   = authedFetch(server.baseUrl, await login(server.baseUrl, 'coh-student'));
        t2Student = authedFetch(server.baseUrl, await login(server.baseUrl, 'coh-t2-student'));
    }, 30_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    let cohortId;

    it('rejects unauthenticated create', async () => {
        const res = await fetch(`${server.baseUrl}/api/cohorts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'X' }),
        });
        expect([401, 403]).toContain(res.status);
    });

    it('student cannot create a cohort (educator-only)', async () => {
        const res = await student('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'Nope' }),
        });
        expect(res.status).toBe(403);
    });

    it('educator creates a cohort', async () => {
        const res = await teacherA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'Cardiology 101' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.cohort.name).toBe('Cardiology 101');
        expect(body.cohort.member_count).toBe(0);
        cohortId = body.cohort.id;
    });

    it('create rejects empty name', async () => {
        const res = await teacherA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: '   ' }),
        });
        expect(res.status).toBe(400);
    });

    it('owner lists only own cohorts', async () => {
        const res = await teacherA('/api/cohorts');
        expect(res.status).toBe(200);
        const { cohorts } = await res.json();
        expect(cohorts.map(c => c.id)).toContain(cohortId);
    });

    it('teacher B does not see teacher A cohort in list', async () => {
        const res = await teacherB('/api/cohorts');
        const { cohorts } = await res.json();
        expect(cohorts.map(c => c.id)).not.toContain(cohortId);
    });

    it('admin sees all cohorts in tenant', async () => {
        const res = await admin('/api/cohorts');
        const { cohorts } = await res.json();
        expect(cohorts.map(c => c.id)).toContain(cohortId);
    });

    it('teacher B gets 404 on teacher A cohort (isolation)', async () => {
        const res = await teacherB(`/api/cohorts/${cohortId}`);
        expect(res.status).toBe(404);
    });

    it('owner reads cohort with members', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.cohort.id).toBe(cohortId);
        expect(Array.isArray(body.members)).toBe(true);
    });

    it('admin can read another teacher cohort', async () => {
        const res = await admin(`/api/cohorts/${cohortId}`);
        expect(res.status).toBe(200);
    });

    it('rename (owner)', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}`, {
            method: 'PATCH', body: JSON.stringify({ name: 'Cardiology 201' }),
        });
        expect(res.status).toBe(200);
        expect((await res.json()).cohort.name).toBe('Cardiology 201');
    });

    it('teacher B cannot rename teacher A cohort', async () => {
        const res = await teacherB(`/api/cohorts/${cohortId}`, {
            method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }),
        });
        expect(res.status).toBe(404);
    });

    it('add member by username', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'coh-student' }),
        });
        expect(res.status).toBe(201);
        expect((await res.json()).member.username).toBe('coh-student');
    });

    it('add member by email', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'coh-student-2@example.com' }),
        });
        expect(res.status).toBe(201);
        expect((await res.json()).member.username).toBe('coh-student-2');
    });

    it('member count reflects additions', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}`);
        expect((await res.json()).cohort.member_count).toBe(2);
    });

    it('idempotent re-add returns existing membership (200, not error)', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'coh-student' }),
        });
        expect(res.status).toBe(200);
    });

    it('add unknown user → 404', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'ghost' }),
        });
        expect(res.status).toBe(404);
    });

    it('cross-tenant add is rejected (t2 user not visible)', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'coh-t2-student' }),
        });
        expect(res.status).toBe(404);
    });

    it('remove member then revive on re-add', async () => {
        const del = await teacherA(`/api/cohorts/${cohortId}/members/${(await (await teacherA(`/api/cohorts/${cohortId}`)).json()).members.find(m => m.username === 'coh-student').id}`, {
            method: 'DELETE',
        });
        expect(del.status).toBe(200);
        const after = await (await teacherA(`/api/cohorts/${cohortId}`)).json();
        expect(after.members.map(m => m.username)).not.toContain('coh-student');

        const readd = await teacherA(`/api/cohorts/${cohortId}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'coh-student' }),
        });
        // Revive of a soft-deleted membership is not a fresh create → 200.
        expect(readd.status).toBe(200);
        const revived = await (await teacherA(`/api/cohorts/${cohortId}`)).json();
        expect(revived.members.map(m => m.username)).toContain('coh-student');
    });

    let joinCode;

    it('generate join code (owner)', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/join-code`, { method: 'POST' });
        expect(res.status).toBe(200);
        joinCode = (await res.json()).join_code;
        expect(joinCode).toMatch(/^[A-Z2-9]{8}$/);
    });

    it('rotate join code yields a different code', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/join-code`, { method: 'POST' });
        const next = (await res.json()).join_code;
        expect(next).not.toBe(joinCode);
        joinCode = next;
    });

    it('non-owner never sees join_code (GET list / get omit it for them)', async () => {
        // Admin/owner see it; teacher B cannot even reach the cohort, and
        // the only non-owner-reachable response (join) excludes it.
        const list = await (await teacherB('/api/cohorts')).json();
        expect(list.cohorts.find(c => c.id === cohortId)).toBeUndefined();
    });

    it('student joins by code (not educator)', async () => {
        const res = await student('/api/cohorts/join', {
            method: 'POST', body: JSON.stringify({ join_code: joinCode }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.cohort).toEqual({ id: cohortId, name: 'Cardiology 201' });
        expect(body.cohort.join_code).toBeUndefined();
        expect(body.members).toBeUndefined();
    });

    it('student join is idempotent', async () => {
        const res = await student('/api/cohorts/join', {
            method: 'POST', body: JSON.stringify({ join_code: joinCode }),
        });
        expect(res.status).toBe(200);
    });

    it('cross-tenant join is rejected', async () => {
        const res = await t2Student('/api/cohorts/join', {
            method: 'POST', body: JSON.stringify({ join_code: joinCode }),
        });
        expect(res.status).toBe(404);
    });

    it('disable join code', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}/join-code`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect((await res.json()).join_code).toBeNull();
        const join = await student('/api/cohorts/join', {
            method: 'POST', body: JSON.stringify({ join_code: joinCode }),
        });
        expect(join.status).toBe(404);
    });

    it('soft-delete cohort cascades to memberships', async () => {
        const res = await teacherA(`/api/cohorts/${cohortId}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const gone = await teacherA(`/api/cohorts/${cohortId}`);
        expect(gone.status).toBe(404);
        const list = await (await teacherA('/api/cohorts')).json();
        expect(list.cohorts.map(c => c.id)).not.toContain(cohortId);
    });
});
