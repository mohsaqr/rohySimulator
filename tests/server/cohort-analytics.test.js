// Integration tests for Phase 10 — cohort-scoped analytics endpoints.
//
// Spawns the real server, seeds users + cohorts + sessions +
// learning_events, then drives /api/cohorts/:id/analytics/* over HTTP.
// The contract these MUST mirror (admin /api/analytics/*) is locked by
// analytics-tna.test.js; here we assert the things unique to the cohort
// scope: the loadOwnedCohort() authz boundary, member-set data scoping,
// the per-student filter, and that a non-member / cross-tenant id can
// never widen the result.
//
// IMPORTANT: no cohort MEMBER is ever logged in during setup — the auth
// dual-write emits a LOGGED_IN learning_events row for whoever logs in,
// which would make member event counts brittle. Only non-member
// educators / a non-member student authenticate.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CohortAnalyticsT1!';

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
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenant]);
    return r.lastID;
}
async function seedCase(db, { name, tenant = 1 }) {
    const r = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES (?, ?)`, [name, tenant]);
    return r.lastID;
}
async function seedSession(db, { userId, caseId, tenant = 1 }) {
    const r = await pRun(db,
        `INSERT INTO sessions (case_id, user_id, tenant_id, status, start_time)
         VALUES (?, ?, ?, 'completed', CURRENT_TIMESTAMP)`,
        [caseId, userId, tenant]);
    return r.lastID;
}
async function seedEvent(db, { sessionId, userId, caseId, tenant = 1, verb = 'CLICKED', ts }) {
    await pRun(db,
        `INSERT INTO learning_events
            (session_id, user_id, case_id, tenant_id, verb, object_type, object_id, object_name, component, severity, category, timestamp)
         VALUES (?, ?, ?, ?, ?, 'button', 'b1', 'b1', 'ChatInterface', 'INFO', 'NAVIGATION', ?)`,
        [sessionId, userId, caseId, tenant, verb, ts || new Date().toISOString()]);
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}
function authed(baseUrl, token) {
    return (path) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
}

describe('/api/cohorts/:id/analytics — Phase 10', () => {
    let server;
    let teacherA, teacherB, t2Teacher, nonMemberStudent;
    let cohortAId, cohortBId, ids = {}, caseAlpha, caseBeta;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            ids.tA = await seedUser(db, { username: 'ca-teacher-a', role: 'educator' });
            ids.tB = await seedUser(db, { username: 'ca-teacher-b', role: 'educator' });
            ids.s1 = await seedUser(db, { username: 'ca-student-1', role: 'student' });
            ids.s2 = await seedUser(db, { username: 'ca-student-2', role: 'student' });
            ids.sN = await seedUser(db, { username: 'ca-nonmember', role: 'student' });
            ids.sFree = await seedUser(db, { username: 'ca-free-student', role: 'student' });
            ids.t2 = await seedUser(db, { username: 'ca-t2-teacher', role: 'educator', tenant: 2 });
            ids.t2s = await seedUser(db, { username: 'ca-t2-student', role: 'student', tenant: 2 });

            caseAlpha = await seedCase(db, { name: 'Alpha Case' });
            caseBeta = await seedCase(db, { name: 'Beta Case' });
            const caseT2 = await seedCase(db, { name: 'T2 Case', tenant: 2 });

            let r = await pRun(db, `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES (?, ?, 1)`, ['Cohort A', ids.tA]);
            cohortAId = r.lastID;
            await pRun(db, `INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)`, [cohortAId, ids.s1]);
            await pRun(db, `INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)`, [cohortAId, ids.s2]);

            r = await pRun(db, `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES (?, ?, 1)`, ['Cohort B', ids.tB]);
            cohortBId = r.lastID;

            const t = (m) => new Date(2026, 4, 1, 9, m, 0).toISOString();
            // s1: Alpha session (OPENED + CLICKED) + Beta session (CLICKED).
            const s1a = await seedSession(db, { userId: ids.s1, caseId: caseAlpha });
            await seedEvent(db, { sessionId: s1a, userId: ids.s1, caseId: caseAlpha, verb: 'OPENED', ts: t(0) });
            await seedEvent(db, { sessionId: s1a, userId: ids.s1, caseId: caseAlpha, verb: 'CLICKED', ts: t(1) });
            const s1b = await seedSession(db, { userId: ids.s1, caseId: caseBeta });
            await seedEvent(db, { sessionId: s1b, userId: ids.s1, caseId: caseBeta, verb: 'CLICKED', ts: t(2) });
            // s2: Alpha session (CLICKED).
            const s2a = await seedSession(db, { userId: ids.s2, caseId: caseAlpha });
            await seedEvent(db, { sessionId: s2a, userId: ids.s2, caseId: caseAlpha, verb: 'CLICKED', ts: t(3) });
            // Non-member s1-tenant student with activity that must NOT leak in.
            const sNa = await seedSession(db, { userId: ids.sN, caseId: caseAlpha });
            await seedEvent(db, { sessionId: sNa, userId: ids.sN, caseId: caseAlpha, verb: 'ORDERED_LAB', ts: t(4) });
            // Tenant-2 activity that must NOT leak across tenants.
            const t2s = await seedSession(db, { userId: ids.t2s, caseId: caseT2, tenant: 2 });
            await seedEvent(db, { sessionId: t2s, userId: ids.t2s, caseId: caseT2, tenant: 2, verb: 'CLICKED', ts: t(5) });
        } finally {
            await closeDb(db);
        }
        teacherA = authed(server.baseUrl, await login(server.baseUrl, 'ca-teacher-a'));
        teacherB = authed(server.baseUrl, await login(server.baseUrl, 'ca-teacher-b'));
        t2Teacher = authed(server.baseUrl, await login(server.baseUrl, 'ca-t2-teacher'));
        nonMemberStudent = authed(server.baseUrl, await login(server.baseUrl, 'ca-free-student'));
    }, 30_000);

    afterAll(async () => { if (server) await server.close(); });

    it('summary is scoped to live members only (no non-member, no cross-tenant)', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/summary`);
        expect(res.status, await res.clone().text()).toBe(200);
        const body = await res.json();
        // s1: 3 events over 2 sessions; s2: 1 event over 1 session.
        // sN's ORDERED_LAB and tenant-2's CLICKED are excluded.
        expect(body.totalActivities).toBe(4);
        expect(body.uniqueUsers).toBe(2);
        expect(body.uniqueSessions).toBe(3);
    });

    it('per-student user_id filter narrows to that member', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/summary?user_id=${ids.s1}`);
        const body = await res.json();
        expect(body.totalActivities).toBe(3);
        expect(body.uniqueUsers).toBe(1);
        expect(body.uniqueSessions).toBe(2);
    });

    it('a non-member user_id yields zero rows — no leak, safe by construction', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/summary?user_id=${ids.sN}`);
        const body = await res.json();
        expect(body.totalActivities).toBe(0);
        expect(body.uniqueUsers).toBe(0);
    });

    it('non-owner educator gets 404 (loadOwnedCohort boundary, no existence leak)', async () => {
        const res = await teacherB(`/api/cohorts/${cohortAId}/analytics/summary`);
        expect(res.status).toBe(404);
    });

    it('cross-tenant educator gets 404 for a tenant-1 cohort', async () => {
        const res = await t2Teacher(`/api/cohorts/${cohortAId}/analytics/summary`);
        expect(res.status).toBe(404);
    });

    it('student role is blocked (requireEducator)', async () => {
        const res = await nonMemberStudent(`/api/cohorts/${cohortAId}/analytics/summary`);
        expect(res.status).toBe(403);
    });

    it('empty cohort returns zeros, never the whole tenant', async () => {
        const res = await teacherB(`/api/cohorts/${cohortBId}/analytics/summary`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.totalActivities).toBe(0);
        expect(body.uniqueUsers).toBe(0);
    });

    it('hourly-counts returns the dense 7×24 grid contract', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/hourly-counts`);
        const body = await res.json();
        expect(body.hourly).toHaveLength(7 * 24);
        expect(body.hourly[0]).toEqual({ dow: 0, hour: 0, count: expect.any(Number) });
    });

    it('stats returns scoped verb frequencies (CLICKED + OPENED, not ORDERED_LAB)', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/stats`);
        const body = await res.json();
        const verbs = new Map(body.verbs.map(v => [v.label, v.count]));
        expect(verbs.get('CLICKED')).toBe(3);
        expect(verbs.get('OPENED')).toBe(1);
        expect(verbs.has('ORDERED_LAB')).toBe(false); // sN is not a member
    });

    it('tna-sequences mirrors the admin contract, member-scoped', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/tna-sequences`);
        const body = await res.json();
        expect(Array.isArray(body.sequences)).toBe(true);
        expect(body.sequences.length).toBe(body.objectTypeSequences.length);
        // OPENED+CLICKED both merge to NAVIGATION; only s1's Alpha session
        // has ≥2 events → exactly one sequence. sN/tenant-2 excluded.
        expect(body.metadata.totalSequences).toBe(1);
        expect(body.metadata.totalEvents).toBe(4);
        expect(body.metadata.groupBy).toBe('actor-session');
    });

    it('filter-options surfaces the roster + member-touched cases only', async () => {
        const res = await teacherA(`/api/cohorts/${cohortAId}/analytics/filter-options`);
        const body = await res.json();
        expect(body.users.map(u => u.username).sort()).toEqual(['ca-student-1', 'ca-student-2']);
        expect(body.cases.map(c => c.title).sort()).toEqual(['Alpha Case', 'Beta Case']);
        expect(body.users.some(u => u.username === 'ca-nonmember')).toBe(false);
    });

    it('filter-options for non-owner is 404', async () => {
        const res = await teacherB(`/api/cohorts/${cohortAId}/analytics/filter-options`);
        expect(res.status).toBe(404);
    });
});
