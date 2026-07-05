// Regression lock for Bug 5 (16.5.2026 report): default-database labs never
// arrived unless ordered "instantly".
//
// Root cause: server/routes/orders-routes.js passed a hardcoded
// getTurnaround(30) for the `default_<name>` lab path, so every such order
// got available_at = ordered_at + 30 minutes (and the new case_investigations
// row was stamped turnaround_minutes = 30). In a normal session the result
// effectively never appeared; only the instant path (turnaround_override = 0)
// worked — exactly the reported symptom.
//
// Fix: the default-lab path now calls getTurnaround() with no per-test value
// so it falls through to the case default / DEFAULT_TURNAROUND_MINUTES (and
// still honours an educator's instantResults / defaultTurnaround).
//
// This test orders a default lab over HTTP with NO override on a plain case
// (no instantResults / defaultTurnaround) and asserts the persisted
// available_at − ordered_at is the documented compressed-pacing default,
// not 30. If the hardcoded 30 (or any >5 literal) is reintroduced, the span
// assertion fails.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { DEFAULT_TURNAROUND_MINUTES } from '../../server/lib/turnaround.js';

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
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
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
    return (await r.json()).token;
}

describe('POST /api/sessions/:id/order-labs — default-lab turnaround (Bug 5)', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (300, 'lab_user', 'Lab User', ?, 'lab@example.com', 'student', 'active', 1)`,
            [hash]
        );
        // Plain case: no investigations config → no instantResults /
        // defaultTurnaround, so the resolver must fall back to the default.
        await dbRun(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (30, 'Lab case', 'be a patient', 1)`);
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status)
             VALUES (400, 30, 300, 'Lab User', 'active')`);
        await dbClose(db);
        token = await loginAs(server, 'lab_user', 'correctpass');
    }, 90_000);

    afterAll(async () => { await server?.close(); });

    it('orders a default lab with the compressed-pacing default, not a 30-minute wait', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/400/order-labs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            // `default_<name>` resolves via labDb.getGenderSpecificTest;
            // Hemoglobin is a core CBC test always present in the lab DB.
            body: JSON.stringify({ lab_ids: ['default_Hemoglobin'] }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.orders?.length).toBeGreaterThan(0);

        // Inspect the persisted row directly — the wire 'is_ready' is a
        // derived field; the bug lives in the stored available_at span.
        const db = await openDb(server.dbPath);
        const row = await dbGet(db,
            `SELECT (julianday(available_at) - julianday(ordered_at)) * 24 * 60 AS span_min
             FROM investigation_orders WHERE session_id = 400 ORDER BY id DESC LIMIT 1`);
        await dbClose(db);

        expect(row).toBeTruthy();
        // The exact contract: with no override and a plain case, the default
        // lab gets DEFAULT_TURNAROUND_MINUTES. Allow a 1-minute slack for
        // clock granularity between the two datetime('now') calls.
        expect(row.span_min).toBeGreaterThanOrEqual(0);
        expect(row.span_min).toBeLessThanOrEqual(DEFAULT_TURNAROUND_MINUTES + 1);
        // Hard ceiling — proves the hardcoded 30 (the bug) is gone.
        expect(row.span_min).toBeLessThan(10);
    }, 20_000);
});
