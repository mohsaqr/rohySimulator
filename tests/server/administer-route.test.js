// Regression lock: production hit an nginx 502 administering acetaminophen.
// Root cause: synchronous throws inside callback bodies left res.json never
// firing, so nginx eventually 504'd → client saw the raw HTML page.
//
// Fixed by wrapping every callback in try/catch + sendError, coercing every
// numeric DB read via num(), and guarding optional chaining on string ops.
//
// These tests fire the route against a malformed treatment_effects row (the
// shape we suspect leaked into prod) and assert that:
//   1. the response always arrives as JSON within a few seconds (no hang),
//   2. it's a 200, not a 5xx,
//   3. the response payload has the expected shape.
//
// If you re-introduce an unguarded `.includes` / NaN / etc. into the route,
// these tests will hang or 500 and the regression lock fails.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

async function loginAs(server, username, password) {
    const r = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    return j.token;
}

describe('POST /api/sessions/:sessionId/administer/:orderId — hardened', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (100, 'tx_user', 'Tx User', ?, 'tx@example.com', 'student', 'active', 1)`,
            [hash]
        );
        await dbRun(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (10, 'Tx case', 'be a patient', 1)`);
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status)
             VALUES (200, 10, 100, 'Tx User', 'active')`);
        await dbClose(db);
        token = await loginAs(server, 'tx_user', 'correctpass');
    }, 30_000);

    afterAll(async () => { await server?.close(); });

    async function makeOrder({ name = 'Acetaminophen', dose_value = 500, type = 'medication' } = {}) {
        const db = await openDb(server.dbPath);
        const r = await dbRun(db,
            `INSERT INTO treatment_orders (session_id, treatment_type, treatment_item, dose_value, status)
             VALUES (?, ?, ?, ?, 'ordered')`,
            [200, type, name, dose_value]
        );
        await dbClose(db);
        return r.lastID;
    }

    async function seedEffect(row) {
        const db = await openDb(server.dbPath);
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(', ');
        await dbRun(db,
            `INSERT INTO treatment_effects (${cols.join(', ')}) VALUES (${placeholders})`,
            cols.map(k => row[k])
        );
        await dbClose(db);
    }

    it('responds with JSON 200 for a normal acetaminophen administration', async () => {
        await seedEffect({
            treatment_type: 'medication',
            treatment_name: 'Acetaminophen',
            onset_minutes: 30, peak_minutes: 60, duration_minutes: 240,
            hr_effect: 0, bp_sys_effect: 0, bp_dia_effect: 0, rr_effect: 0, spo2_effect: 0,
            temp_effect: -0.5, dose_dependent: 1, base_dose: 500, max_effect_multiplier: 2.0,
            is_active: 1,
        });
        const orderId = await makeOrder();
        const r = await fetch(`${server.baseUrl}/api/sessions/200/administer/${orderId}`, {
            method: 'POST',
            headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        });
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.message).toBe('Treatment administered');
        expect(j.effect_active).toBe(true);
    }, 10_000);

    it('does not hang or 5xx when treatment_effects has NULL numeric columns', async () => {
        // The exact failure mode that 502'd in prod — every effect column NULL.
        await seedEffect({
            treatment_type: 'medication',
            treatment_name: 'Mystery Med',
            onset_minutes: 5, peak_minutes: 15, duration_minutes: 60,
            // hr_effect, bp_*, rr_*, spo2_*, temp_effect intentionally omitted (NULL)
            dose_dependent: 0,
            is_active: 1,
        });
        const orderId = await makeOrder({ name: 'Mystery Med' });
        const r = await fetch(`${server.baseUrl}/api/sessions/200/administer/${orderId}`, {
            method: 'POST',
            headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        });
        expect(r.status).toBe(200);
        const j = await r.json();
        // NULL effects coerce to 0 — administered successfully, no crash.
        expect(j.effect_details.hr_effect).toBe(0);
        expect(j.effect_details.bp_sys_effect).toBe(0);
    }, 10_000);

    it('does not crash when no treatment_effects row exists for the order', async () => {
        const orderId = await makeOrder({ name: 'Unmatched Drug' });
        const r = await fetch(`${server.baseUrl}/api/sessions/200/administer/${orderId}`, {
            method: 'POST',
            headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        });
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.message).toMatch(/no effect data/);
        expect(j.effect_active).toBe(false);
    }, 10_000);

    it('responds 400 when the order is not in "ordered" status (instead of crashing)', async () => {
        const db = await openDb(server.dbPath);
        const r = await dbRun(db,
            `INSERT INTO treatment_orders (session_id, treatment_type, treatment_item, dose_value, status)
             VALUES (?, 'medication', 'Already Done', 100, 'administered')`,
            [200]
        );
        await dbClose(db);
        const orderId = r.lastID;
        const resp = await fetch(`${server.baseUrl}/api/sessions/200/administer/${orderId}`, {
            method: 'POST',
            headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        });
        expect(resp.status).toBe(400);
        const j = await resp.json();
        expect(j.error).toMatch(/Cannot administer/);
    }, 10_000);
});
