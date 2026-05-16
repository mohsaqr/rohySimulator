// Bug 6 (16.5.2026 report): "Cervical Spine X-Ray and Lumbar Spine X-Ray in
// the Acute Stroke - Left MCA case never arrive."
//
// This test reproduces the exact report end-to-end against the real server:
// a case with instantResults + empty radiology config (the Acute Stroke
// case 5 shape), order the two spine X-rays by their master-DB ids
// (xray_cspine / xray_lspine), then read them back via the same GET the
// worklist polls. It asserts the orders are created AND returned (not
// silently skipped, not tenant-filtered out).
//
// It also runs the same flow on a NON-default tenant, because the
// order-radiology INSERTs omit tenant_id (column default 1) while the GET
// filters io.tenant_id = <session tenant> — so a tenant-2 session's
// radiology would be excluded ("never arrives").

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
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
function dbClose(db) { return new Promise((r) => db.close(() => r())); }

async function loginAs(server, username, password) {
    const r = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
    return (await r.json()).token;
}

// Acute-Stroke-shaped case config: instant results, no radiology config.
const STROKE_CONFIG = JSON.stringify({
    patient_name: 'Richard Thompson',
    investigations: { instantResults: true },
});

describe('POST order-radiology → GET radiology-orders (Bug 6)', () => {
    let server;
    let tokenT1;
    let tokenT2;

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);

        // Tenant 1 (default) user + case + session.
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (500, 'rad_t1', 'Rad T1', ?, 'rt1@example.com', 'student', 'active', 1)`, [hash]);
        await dbRun(db,
            `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
             VALUES (50, 'Acute Stroke - Left MCA', 'be a patient', ?, 1)`, [STROKE_CONFIG]);
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status, tenant_id)
             VALUES (600, 50, 500, 'Rad T1', 'active', 1)`);

        // Tenant 2 user + case + session (multi-tenant regression).
        await dbRun(db, `INSERT INTO tenants (id, name, slug) VALUES (2, 'T2', 't2')`)
            .catch(() => {}); // tenants table may seed differently; ignore if present
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (501, 'rad_t2', 'Rad T2', ?, 'rt2@example.com', 'student', 'active', 2)`, [hash]);
        await dbRun(db,
            `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
             VALUES (51, 'Acute Stroke - Left MCA', 'be a patient', ?, 2)`, [STROKE_CONFIG]);
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status, tenant_id)
             VALUES (601, 51, 501, 'Rad T2', 'active', 2)`);
        await dbClose(db);

        tokenT1 = await loginAs(server, 'rad_t1', 'correctpass');
        tokenT2 = await loginAs(server, 'rad_t2', 'correctpass');
    }, 30_000);

    afterAll(async () => { await server?.close(); });

    async function orderAndRead(sessionId, token) {
        const post = await fetch(`${server.baseUrl}/api/sessions/${sessionId}/order-radiology`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ radiology_ids: ['xray_cspine', 'xray_lspine'], instant: false, room: 'radiology' }),
        });
        const postBody = await post.json();
        const get = await fetch(`${server.baseUrl}/api/sessions/${sessionId}/radiology-orders`, {
            headers: { authorization: `Bearer ${token}` },
        });
        const getBody = await get.json();
        return { postStatus: post.status, postBody, getStatus: get.status, getBody };
    }

    it('tenant 1: both spine X-rays are created and returned by the worklist GET', async () => {
        const { postStatus, postBody, getStatus, getBody } = await orderAndRead(600, tokenT1);
        expect(postStatus).toBe(200);
        expect(postBody.orders?.length).toBe(2);
        expect(getStatus).toBe(200);
        const names = (getBody.orders || []).map((o) => o.test_name).sort();
        expect(names).toEqual(['Cervical Spine X-Ray', 'Lumbar Spine X-Ray']);
        // instantResults → should be ready immediately, not stuck pending.
        for (const o of getBody.orders) expect(o.is_ready).toBe(1);
    }, 20_000);

    it('tenant 2: spine X-rays must also be returned (no tenant_id exclusion)', async () => {
        const { postBody, getBody } = await orderAndRead(601, tokenT2);
        expect(postBody.orders?.length).toBe(2);
        const names = (getBody.orders || []).map((o) => o.test_name).sort();
        expect(names).toEqual(['Cervical Spine X-Ray', 'Lumbar Spine X-Ray']);
    }, 20_000);
});
