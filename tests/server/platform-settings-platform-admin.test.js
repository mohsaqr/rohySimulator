// Regression lock: security audit 2026-10-24, finding 9 — platform_settings
// has no tenant_id, so the two settings routes outside admin-routes.js
// (terms, case packages) must also refuse an admin of a non-default tenant.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'Password123!';
let server;
let tenant1Admin;
let tenant2Admin;

const openDb = (p) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(p, (err) => (err ? reject(err) : resolve(db)));
});
const closeDb = (db) => new Promise((resolve) => db.close(() => resolve()));
const pRun = (db, sql, params) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));

const call = (path, { token, method = 'GET', body } = {}) => fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
});

beforeAll(async () => {
    server = await startTestServer({ seed: false });
    const db = await openDb(server.dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        await pRun(db, `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'second', 'Second tenant')`, []);
        for (const [u, tenant] of [['psa-platform-admin', 1], ['psa-tenant2-admin', 2]]) {
            await pRun(db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES (?, ?, ?, ?, 'admin', ?, 'active')`, [u, u, `${u}@example.com`, hash, tenant]);
        }
    } finally { await closeDb(db); }
    const login = async (username) => {
        const r = await call('/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
        if (!r.ok) throw new Error(`login ${username} → ${r.status}`);
        return (await r.json()).token;
    };
    tenant1Admin = await login('psa-platform-admin');
    tenant2Admin = await login('psa-tenant2-admin');
});

afterAll(async () => { await server?.close(); });

describe('platform-wide settings outside admin-routes are platform-admin only', () => {
    it('PUT /platform-settings/case-packages: tenant-2 admin 403, default-tenant admin 200', async () => {
        const denied = await call('/platform-settings/case-packages', { token: tenant2Admin, method: 'PUT', body: { enabled: true } });
        expect(denied.status).toBe(403);
        expect((await denied.json()).code).toBe('platform_admin_required');

        const allowed = await call('/platform-settings/case-packages', { token: tenant1Admin, method: 'PUT', body: { enabled: true } });
        expect(allowed.status).toBe(200);
    });

    it('PUT /platform-settings/terms: tenant-2 admin 403, default-tenant admin still validated (400 on empty body)', async () => {
        const denied = await call('/platform-settings/terms', { token: tenant2Admin, method: 'PUT', body: { required: false } });
        expect(denied.status).toBe(403);
        expect((await denied.json()).code).toBe('platform_admin_required');

        const reached = await call('/platform-settings/terms', { token: tenant1Admin, method: 'PUT', body: {} });
        expect(reached.status).toBe(400);
    });
});
