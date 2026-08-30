// Regression lock: a session's stored `duration` must not carry the host's
// UTC offset (UI swarm finding #7, v2.9.108).
//
// The bug had two halves, and this file pins both:
//
//   1. WRITE. `INSERT INTO sessions (…)` named no time column, so sqlite's
//      `start_time DATETIME DEFAULT CURRENT_TIMESTAMP` stamped the legacy
//      naive shape — "2026-08-30 11:22:33", UTC but with nothing saying so —
//      into a column migration 0050 had already normalised to UTC ISO.
//   2. READ. `PUT /sessions/:id/end` computed the duration with
//      `new Date(session.start_time)`. V8 does not recognise that shape as
//      ISO, so it falls back to LOCAL-time parsing: on a UTC+3 host the start
//      instant lands three hours in the past and a 15-second session is
//      persisted as 3h00m15s. Every debrief, cohort report and time-on-task
//      figure downstream reads `sessions.duration`.
//
// The server child is deliberately spawned with TZ=Asia/Riyadh (UTC+3, no DST
// so the arithmetic is stable year-round). Against the un-fixed code the
// duration assertion below comes back ~10800 instead of ~0 — the test is only
// meaningful because the host is NOT UTC.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { ISO_Z_RE } from '../../server/shared/time.js';

const PASSWORD = 'DurTests1!';
const OFFSET_TZ = 'Asia/Riyadh'; // UTC+3, no daylight saving

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
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
    );
}

let server;
let db;
let token;
let caseId;

beforeAll(async () => {
    server = await startTestServer({ env: { TZ: OFFSET_TZ } });
    db = await openDb(server.dbPath);

    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES ('dur-student', 'dur', 'dur@example.com', ?, 'student', 1, 'active')`,
        [hash]
    );
    const c = await pRun(
        db,
        `INSERT INTO cases (name, tenant_id, is_available, is_default) VALUES ('Duration case', 1, 1, 1)`
    );
    caseId = c.lastID;

    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'dur-student', password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    token = (await res.json()).token;
}, 90_000);

afterAll(async () => {
    if (db) await closeDb(db);
    if (server) await server.close();
});

async function startSession() {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ case_id: caseId }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
}

describe('sessions.start_time is written in the one time shape', () => {
    it('stamps UTC ISO-8601 with a Z, not sqlite CURRENT_TIMESTAMP', async () => {
        const id = await startSession();
        const row = await pGet(db, 'SELECT start_time, updated_at FROM sessions WHERE id = ?', [id]);
        expect(row.start_time).toMatch(ISO_Z_RE);
        expect(row.updated_at).toMatch(ISO_Z_RE);
    });

    it('is the SERVER clock, not the host-local wall clock', async () => {
        const before = Date.now();
        const id = await startSession();
        const row = await pGet(db, 'SELECT start_time FROM sessions WHERE id = ?', [id]);
        // Within a minute of real "now". A naive stamp read as local time on
        // a UTC+3 host lands 3 h away and blows this window wide open.
        const stamped = Date.parse(row.start_time);
        expect(Math.abs(stamped - before)).toBeLessThan(60_000);
    });
});

describe('PUT /sessions/:id/end duration', () => {
    it('records seconds elapsed, not the host UTC offset', async () => {
        const id = await startSession();
        const res = await fetch(`${server.baseUrl}/api/sessions/${id}/end`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();

        // The whole point: on TZ=UTC+3 the un-fixed code answered ~10800.
        expect(body.duration).toBeLessThan(120);
        expect(body.duration).toBeGreaterThanOrEqual(0);

        const row = await pGet(db, 'SELECT duration, end_time FROM sessions WHERE id = ?', [id]);
        expect(row.duration).toBe(body.duration);
        expect(row.end_time).toMatch(ISO_Z_RE);
    });

    it('computes correctly for a row still holding the LEGACY naive shape', async () => {
        // A database restored from a pre-0052 backup still has naive
        // start_time values. timeMs() must pin those to UTC rather than
        // letting V8 read them as local time.
        const id = await startSession();
        await pRun(
            db,
            `UPDATE sessions SET start_time = strftime('%Y-%m-%d %H:%M:%S','now','-30 seconds') WHERE id = ?`,
            [id]
        );
        const res = await fetch(`${server.baseUrl}/api/sessions/${id}/end`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const { duration } = await res.json();
        expect(duration).toBeGreaterThanOrEqual(29);
        expect(duration).toBeLessThan(120);
    });
});

describe('the 30-second start dedup window', () => {
    // The dedup query compares start_time against a SQL "now - 30 seconds".
    // Both sides must be in the SAME shape: this is a TEXT column, so the
    // comparison is a string sort, and an ISO start_time ('…T…Z') always
    // sorts ABOVE a naive right-hand side ('… …') for the same date — which
    // would make every session started earlier the same day look "recent"
    // and get reused.
    it('reuses a session started seconds ago', async () => {
        const first = await startSession();
        const second = await startSession();
        expect(second).toBe(first);
    });

    it('does NOT reuse a session started well outside the window', async () => {
        const old = await startSession();
        await pRun(
            db,
            `UPDATE sessions SET start_time = strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours') WHERE id = ?`,
            [old]
        );
        const fresh = await startSession();
        expect(fresh).not.toBe(old);
    });
});
