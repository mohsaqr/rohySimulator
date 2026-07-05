// Integration tests for Phase 8 — cohort entity (metadata, case assignment,
// co-teacher roster) + the widened loadOwnedCohort() access boundary.
//
// Spawns the real server, seeds users + cases directly into the isolated
// DB, then drives the new/extended endpoints over HTTP. The security suite
// proves the six invariants the phase brief calls out explicitly.
//
// Seeded (tenant 1 unless noted):
//   - ce-owner-a     educator   owns cohort A
//   - ce-owner-b     educator   owns cohort B (isolation target)
//   - ce-admin       admin
//   - ce-coteacher   educator   co-teacher of A
//   - ce-edu-student educator   enrolled in A as a *student* (must NOT
//                                gain owner access via membership)
//   - ce-student     student    plain student member of A
//   - ce-t2-owner    educator   tenant 2 (cross-tenant)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CeTests1!';

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
    const r = await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenant]
    );
    return r.lastID;
}
async function seedCase(db, { name, tenant = 1 }) {
    const r = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES (?, ?)`, [name, tenant]);
    return r.lastID;
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

describe('/api/cohorts/* Phase 8 entity + access boundary', () => {
    let server;
    let ownerA, ownerB, admin, coteacher, eduStudent, student, t2Owner;
    let ids = {};
    let caseAlpha, caseBeta, caseGamma, caseT2;
    let cohortA, cohortB;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            ids.oA = await seedUser(db, { username: 'ce-owner-a', role: 'educator' });
            ids.oB = await seedUser(db, { username: 'ce-owner-b', role: 'educator' });
            ids.adm = await seedUser(db, { username: 'ce-admin', role: 'admin' });
            ids.ct = await seedUser(db, { username: 'ce-coteacher', role: 'educator' });
            ids.es = await seedUser(db, { username: 'ce-edu-student', role: 'educator' });
            ids.st = await seedUser(db, { username: 'ce-student', role: 'student' });
            await seedUser(db, { username: 'ce-t2-owner', role: 'educator', tenant: 2 });
            caseAlpha = await seedCase(db, { name: 'Alpha' });
            caseBeta = await seedCase(db, { name: 'Beta' });
            caseGamma = await seedCase(db, { name: 'Gamma' });
            caseT2 = await seedCase(db, { name: 'T2Only', tenant: 2 });
        } finally {
            await closeDb(db);
        }
        ownerA = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-owner-a'));
        ownerB = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-owner-b'));
        admin = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-admin'));
        coteacher = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-coteacher'));
        eduStudent = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-edu-student'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-student'));
        t2Owner = authedFetch(server.baseUrl, await login(server.baseUrl, 'ce-t2-owner'));
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    // -------------------------------------------------------------------
    // Backward compatibility — minimal create still works exactly as before
    // -------------------------------------------------------------------
    it('minimal create {name} still works (backward compatible)', async () => {
        const res = await ownerA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'Minimal' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.cohort.name).toBe('Minimal');
        expect(body.cohort.member_count).toBe(0);
        expect(body.cohort.description ?? null).toBeNull();
    });

    // -------------------------------------------------------------------
    // Create with all fields
    // -------------------------------------------------------------------
    it('create with description, dates, settings, join_code, cases, co-teachers', async () => {
        const res = await ownerA('/api/cohorts', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Cohort A',
                description: 'full class',
                starts_at: '2026-01-01T00:00:00Z',
                ends_at: '2026-06-01T00:00:00Z',
                settings: { theme: 'dark', maxAttempts: 3 },
                join_code: true,
                case_ids: [caseAlpha, caseBeta],
                coteacher_identifiers: ['ce-coteacher'],
            }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        cohortA = body.cohort.id;
        expect(body.cohort.description).toBe('full class');
        expect(body.cohort.join_code).toMatch(/^[A-Z2-9]{8}$/);

        const got = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
        expect(JSON.parse(got.cohort.settings)).toEqual({ theme: 'dark', maxAttempts: 3 });
        expect(got.cases.map(c => c.name).sort()).toEqual(['Alpha', 'Beta']);
        expect(got.teachers.map(t => t.username)).toContain('ce-coteacher');
        expect(got.students.map(s => s.username)).not.toContain('ce-coteacher');
    });

    it('date validation: starts_at after ends_at → 400', async () => {
        const res = await ownerA('/api/cohorts', {
            method: 'POST',
            body: JSON.stringify({ name: 'BadDates', starts_at: '2026-06-01', ends_at: '2026-01-01' }),
        });
        expect(res.status).toBe(400);
    });

    it('date validation: non-ISO starts_at → 400', async () => {
        const res = await ownerA('/api/cohorts', {
            method: 'POST',
            body: JSON.stringify({ name: 'BadDate', starts_at: 'not-a-date' }),
        });
        expect(res.status).toBe(400);
    });

    it('settings must be a plain object (array → 400)', async () => {
        const res = await ownerA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'BadSettings', settings: [1, 2] }),
        });
        expect(res.status).toBe(400);
    });

    it('create with foreign-tenant case_id → 400, no cohort created', async () => {
        const before = (await (await ownerA('/api/cohorts')).json()).cohorts.length;
        const res = await ownerA('/api/cohorts', {
            method: 'POST', body: JSON.stringify({ name: 'Foreign', case_ids: [caseT2] }),
        });
        expect(res.status).toBe(400);
        const after = (await (await ownerA('/api/cohorts')).json()).cohorts.length;
        expect(after).toBe(before);
    });

    // -------------------------------------------------------------------
    // PATCH metadata
    // -------------------------------------------------------------------
    it('PATCH updates description, dates, settings (replace semantics)', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}`, {
            method: 'PATCH',
            body: JSON.stringify({
                name: 'Cohort A',
                description: 'updated',
                settings: { onlyKey: true },
            }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.cohort.description).toBe('updated');
        // replace, not merge: old keys (theme/maxAttempts) are gone
        expect(JSON.parse(body.cohort.settings)).toEqual({ onlyKey: true });
    });

    it('PATCH date validation enforced', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: 'Cohort A', starts_at: '2027-01-01', ends_at: '2026-01-01' }),
        });
        expect(res.status).toBe(400);
    });

    it('PATCH still requires non-empty name', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}`, {
            method: 'PATCH', body: JSON.stringify({ name: '  ' }),
        });
        expect(res.status).toBe(400);
    });

    // -------------------------------------------------------------------
    // Case assignment
    // -------------------------------------------------------------------
    it('POST /cases bulk-assigns (idempotent + revive)', async () => {
        const add = await ownerA(`/api/cohorts/${cohortA}/cases`, {
            method: 'POST', body: JSON.stringify({ case_ids: [caseGamma] }),
        });
        expect(add.status).toBe(201);
        expect(add.headers).toBeTruthy();
        const cases = (await add.json()).cases.map(c => c.name).sort();
        expect(cases).toEqual(['Alpha', 'Beta', 'Gamma']);

        // re-assign same case → idempotent, 200
        const again = await ownerA(`/api/cohorts/${cohortA}/cases`, {
            method: 'POST', body: JSON.stringify({ case_ids: [caseGamma] }),
        });
        expect(again.status).toBe(200);

        // detach then re-assign → revived (no unique clash)
        const del = await ownerA(`/api/cohorts/${cohortA}/cases/${caseGamma}`, { method: 'DELETE' });
        expect(del.status).toBe(200);
        const afterDel = (await (await ownerA(`/api/cohorts/${cohortA}`)).json()).cases.map(c => c.name);
        expect(afterDel).not.toContain('Gamma');
        const revive = await ownerA(`/api/cohorts/${cohortA}/cases`, {
            method: 'POST', body: JSON.stringify({ case_ids: [caseGamma] }),
        });
        expect(revive.status).toBe(201);
        const afterRevive = (await (await ownerA(`/api/cohorts/${cohortA}`)).json()).cases.map(c => c.name);
        expect(afterRevive).toContain('Gamma');
    });

    it('POST /cases rejects foreign-tenant case', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}/cases`, {
            method: 'POST', body: JSON.stringify({ case_ids: [caseT2] }),
        });
        expect(res.status).toBe(400);
    });

    it('DELETE /cases/:caseId of an unassigned case → 404', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}/cases/999999`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    // -------------------------------------------------------------------
    // Co-teacher roster
    // -------------------------------------------------------------------
    it('POST /teachers adds a new co-teacher; promotes an existing student', async () => {
        // ce-edu-student first joins A as a plain student
        const asStudent = await ownerA(`/api/cohorts/${cohortA}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'ce-edu-student' }),
        });
        expect([200, 201]).toContain(asStudent.status);
        let snap = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
        expect(snap.students.map(s => s.username)).toContain('ce-edu-student');

        // promote them to teacher — no duplicate row, moves to teachers list
        const promote = await ownerA(`/api/cohorts/${cohortA}/teachers`, {
            method: 'POST', body: JSON.stringify({ identifier: 'ce-edu-student' }),
        });
        expect(promote.status).toBe(200);
        expect((await promote.json()).promoted).toBe(true);
        snap = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
        expect(snap.teachers.map(t => t.username)).toContain('ce-edu-student');
        expect(snap.students.map(s => s.username)).not.toContain('ce-edu-student');
    });

    it('adding-as-student a live co-teacher does NOT demote (200 already_teacher)', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}/members`, {
            method: 'POST', body: JSON.stringify({ identifier: 'ce-coteacher' }),
        });
        expect(res.status).toBe(200);
        expect((await res.json()).already_teacher).toBe(true);
        const snap = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
        expect(snap.teachers.map(t => t.username)).toContain('ce-coteacher');
        expect(snap.students.map(s => s.username)).not.toContain('ce-coteacher');
    });

    it('DELETE /teachers/:userId soft-deletes; revivable', async () => {
        const del = await ownerA(`/api/cohorts/${cohortA}/teachers/${ids.es}`, { method: 'DELETE' });
        expect(del.status).toBe(200);
        let snap = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
        expect(snap.teachers.map(t => t.username)).not.toContain('ce-edu-student');
        const readd = await ownerA(`/api/cohorts/${cohortA}/teachers`, {
            method: 'POST', body: JSON.stringify({ identifier: 'ce-edu-student' }),
        });
        expect([200, 201]).toContain(readd.status);
        snap = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
        expect(snap.teachers.map(t => t.username)).toContain('ce-edu-student');
    });

    it('owner cannot be removed as a teacher (400)', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}/teachers/${ids.oA}`, { method: 'DELETE' });
        expect(res.status).toBe(400);
    });

    it('DELETE /teachers/:userId of a non-teacher → 404', async () => {
        const res = await ownerA(`/api/cohorts/${cohortA}/teachers/999999`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    // -------------------------------------------------------------------
    // SECURITY SUITE — the six invariants
    // -------------------------------------------------------------------
    describe('security invariants', () => {
        const MGMT = (id) => [
            { m: 'GET', p: `/api/cohorts/${id}` },
            { m: 'PATCH', p: `/api/cohorts/${id}`, b: { name: 'Cohort A' } },
            { m: 'POST', p: `/api/cohorts/${id}/members`, b: { identifier: 'ce-student' } },
            { m: 'POST', p: `/api/cohorts/${id}/cases`, b: { case_ids: [caseAlpha] } },
            { m: 'POST', p: `/api/cohorts/${id}/teachers`, b: { identifier: 'ce-student' } },
            { m: 'POST', p: `/api/cohorts/${id}/join-code` },
        ];
        const REPORTING = (id) => [
            `/api/cohorts/${id}/roster`,
            `/api/cohorts/${id}/grid`,
            `/api/cohorts/${id}/feed`,
            `/api/cohorts/${id}/export`,
            `/api/cohorts/${id}/student/${ids.st}`,
        ];

        it('co-teacher reaches ALL mgmt + ALL 5 reporting endpoints of their cohort', async () => {
            for (const e of MGMT(cohortA)) {
                const res = await coteacher(e.p, {
                    method: e.m, body: e.b ? JSON.stringify(e.b) : undefined,
                });
                expect(res.status, `${e.m} ${e.p}`).not.toBe(404);
                expect(res.status, `${e.m} ${e.p}`).not.toBe(403);
            }
            // The MGMT sweep above promoted ce-student to a teacher member
            // (POST /teachers {ce-student}). The reporting /student/:id check
            // below needs a live STUDENT member, so the owner restores
            // ce-student to a plain student before the reporting loop runs.
            await ownerA(`/api/cohorts/${cohortA}/teachers/${ids.st}`, { method: 'DELETE' });
            await ownerA(`/api/cohorts/${cohortA}/members`, {
                method: 'POST', body: JSON.stringify({ identifier: 'ce-student' }),
            });
            for (const p of REPORTING(cohortA)) {
                const res = await coteacher(p);
                expect(res.status, p).toBe(200);
            }
        });

        it('co-teacher of A gets 404 on cohort B (not owner/admin/teacher there)', async () => {
            const b = await ownerB('/api/cohorts', {
                method: 'POST', body: JSON.stringify({ name: 'Cohort B' }),
            });
            cohortB = (await b.json()).cohort.id;
            for (const p of REPORTING(cohortB)) {
                expect((await coteacher(p)).status, p).toBe(404);
            }
            expect((await coteacher(`/api/cohorts/${cohortB}`)).status).toBe(404);
        });

        it('removing the co-teacher revokes access immediately (next request 404)', async () => {
            // ce-coteacher currently a teacher of A; remove → 404 thereafter
            const ok = await coteacher(`/api/cohorts/${cohortA}/roster`);
            expect(ok.status).toBe(200);
            const del = await ownerA(`/api/cohorts/${cohortA}/teachers/${ids.ct}`, { method: 'DELETE' });
            expect(del.status).toBe(200);
            const after = await coteacher(`/api/cohorts/${cohortA}/roster`);
            expect(after.status).toBe(404);
            const afterGet = await coteacher(`/api/cohorts/${cohortA}`);
            expect(afterGet.status).toBe(404);
            // restore for any later assertions
            await ownerA(`/api/cohorts/${cohortA}/teachers`, {
                method: 'POST', body: JSON.stringify({ identifier: 'ce-coteacher' }),
            });
        });

        it('student-rank user is 403 on every mgmt + reporting endpoint (requireEducator blocks first)', async () => {
            for (const e of MGMT(cohortA)) {
                const res = await student(e.p, {
                    method: e.m, body: e.b ? JSON.stringify(e.b) : undefined,
                });
                expect(res.status, `${e.m} ${e.p}`).toBe(403);
            }
            for (const p of REPORTING(cohortA)) {
                expect((await student(p)).status, p).toBe(403);
            }
        });

        it('cross-tenant cohort is still 404', async () => {
            const t2 = await t2Owner('/api/cohorts', {
                method: 'POST', body: JSON.stringify({ name: 'T2 Cohort' }),
            });
            const t2Id = (await t2.json()).cohort.id;
            expect((await ownerA(`/api/cohorts/${t2Id}`)).status).toBe(404);
            expect((await coteacher(`/api/cohorts/${t2Id}`)).status).toBe(404);
        });

        it("an educator-rank user enrolled as a 'student' member does NOT get owner access", async () => {
            // ce-edu-student is educator-rank and a STUDENT member of A
            // (re-add as student after demoting from earlier teacher state).
            await ownerA(`/api/cohorts/${cohortA}/teachers/${ids.es}`, { method: 'DELETE' });
            const asStu = await ownerA(`/api/cohorts/${cohortA}/members`, {
                method: 'POST', body: JSON.stringify({ identifier: 'ce-edu-student' }),
            });
            expect([200, 201]).toContain(asStu.status);
            const snap = await (await ownerA(`/api/cohorts/${cohortA}`)).json();
            expect(snap.students.map(s => s.username)).toContain('ce-edu-student');
            // requireEducator passes (they ARE educator) but loadOwnedCohort
            // must still 404 — only member_role='teacher' grants access.
            expect((await eduStudent(`/api/cohorts/${cohortA}`)).status).toBe(404);
            expect((await eduStudent(`/api/cohorts/${cohortA}/roster`)).status).toBe(404);
            // owner & admin still reach it
            expect((await ownerA(`/api/cohorts/${cohortA}`)).status).toBe(200);
            expect((await admin(`/api/cohorts/${cohortA}`)).status).toBe(200);
        });
    });
});
