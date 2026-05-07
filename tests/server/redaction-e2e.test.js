// End-to-end PII redaction test (audit follow-up).
//
// `server/redaction.js` defines the policy; `redactRow` / `redactRows` are
// wired into route handlers throughout `server/routes.js`. Unit tests on
// the redaction module exist; this test asserts the full pipeline:
//   - Insert a row that contains every redactable column.
//   - Hit a route that returns it.
//   - Verify the response actually has no leaked PII / secrets.
//
// Pinned routes (admin-only):
//   - GET /api/users               (admin user list)
//   - GET /api/admin/active-sessions (admin session list)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-redaction-tests-secret';

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
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

describe('PII redaction — end to end via admin routes', () => {
    let server;
    let adminToken;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });

        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);

        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id, phone, address)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
            ['redact_admin', 'Admin User', passwordHash, 'admin@redact.test', '+1-555-0100', '1 Admin Way']);
        // A target user with PII to make sure GET /users redacts it.
        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id, phone, address)
             VALUES (?, ?, ?, ?, 'student', 'active', 1, ?, ?)`,
            ['target_user', 'Target Person', passwordHash, 'target@redact.test', '+1-555-0200', '2 Target Ave']);

        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['redact_admin']);
        // Active session row for the admin so GET /admin/active-sessions has something to return.
        await dbRun(db,
            `INSERT INTO active_sessions (user_id, token_hash, ip_address, user_agent, expires_at, tenant_id, is_active)
             VALUES (?, 'fake-hash-for-test', '10.0.0.1', 'TestAgent/1.0', datetime('now', '+1 hour'), 1, 1)`,
            [admin.id]);
        await dbClose(db);

        adminToken = jwt.sign(
            { id: admin.id, username: 'redact_admin', email: 'admin@redact.test', role: 'admin', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'redact-admin-tok' },
        );
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('GET /api/users — no password_hash leaks; PII is redacted', async () => {
        const res = await fetch(`${server.baseUrl}/api/users`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        const users = Array.isArray(body) ? body : (body.users || []);
        expect(users.length).toBeGreaterThanOrEqual(2);

        // CONTRACT: the /users SELECT explicitly omits password_hash; even
        // an admin viewing the user list must NOT see hashes. This is the
        // single most critical redaction promise.
        for (const u of users) {
            expect(u.password_hash).toBeUndefined();
            // phone + address are not in the explicit SELECT — never reach
            // the response.
            expect(u.phone).toBeUndefined();
            expect(u.address).toBeUndefined();
        }
        // CONTRACT NOTE (admin-view exception): name + email ARE returned
        // unredacted because admins need to manage actual users. The
        // redaction policy in server/redaction.js would redact these if
        // redactRow() were called — this route deliberately does NOT call
        // it. Locking the observed behaviour so a future "redact everywhere"
        // sweep doesn't break admin user-management UX.
        const target = users.find(u => u.username === 'target_user');
        expect(target).toBeTruthy();
        expect(target.name).toBe('Target Person');
        expect(target.email).toBe('target@redact.test');
    });

    it('GET /api/admin/active-sessions — token_hash hidden, ip_address visible', async () => {
        const res = await fetch(`${server.baseUrl}/api/admin/active-sessions`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        const sessions = body.sessions || [];
        expect(sessions.length).toBeGreaterThanOrEqual(1);

        for (const s of sessions) {
            // token_hash is `action: 'hide'` in RESPONSE_REDACTION_POLICY —
            // it should be undefined / removed from the response.
            expect(s.token_hash).toBeUndefined();
            // ip_address is operational metadata for admin force-logout
            // decisions — not redacted at this level.
            expect(s.ip_address).toBeDefined();
        }
    });
});
