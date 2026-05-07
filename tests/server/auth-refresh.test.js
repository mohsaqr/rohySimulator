// Tests for POST /api/auth/refresh — JWT rotation inside an active session.
//
// Spawns the real server (same pattern as tts-route.test.js) so the route
// is exercised end-to-end: cookies set, active_sessions row inserted,
// old row revoked, new JWT verified by authenticateToken on the next call.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-refresh-tests-secret';

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
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

describe('POST /api/auth/refresh', () => {
    let server;
    let userId;
    let oldToken;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });

        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['refresh_user', 'Refresh User', passwordHash, 'refresh@example.com'],
        );
        const row = await dbGet(db, 'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?', ['refresh_user']);
        userId = row.id;

        oldToken = jwt.sign(
            { id: row.id, username: row.username, email: row.email, role: 'admin', tenant_id: row.tenant_id || 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h' },
        );

        // Pre-seed an active_sessions row for oldToken so authenticateToken's
        // revocation check finds it as active.
        const crypto = await import('crypto');
        const oldHash = crypto.createHash('sha256').update(oldToken).digest('hex');
        await dbRun(
            db,
            `INSERT INTO active_sessions (user_id, token_hash, expires_at, tenant_id, is_active)
             VALUES (?, ?, datetime('now', '+1 hour'), 1, 1)`,
            [userId, oldHash],
        );
        await dbClose(db);
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('rotates the JWT and revokes the old active_sessions row', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/refresh`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${oldToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.token).toBeTypeOf('string');
        expect(body.token).not.toBe(oldToken);
        expect(body.user.id).toBe(userId);

        // The old session row is revoked; a new one exists for the new token.
        const db = await openDb(server.dbPath);
        const crypto = await import('crypto');
        const oldHash = crypto.createHash('sha256').update(oldToken).digest('hex');
        const newHash = crypto.createHash('sha256').update(body.token).digest('hex');

        const oldRow = await dbGet(db, 'SELECT is_active FROM active_sessions WHERE token_hash = ?', [oldHash]);
        const newRow = await dbGet(db, 'SELECT is_active FROM active_sessions WHERE token_hash = ?', [newHash]);
        await dbClose(db);

        expect(oldRow.is_active).toBe(0);
        expect(newRow.is_active).toBe(1);
    });

    it('the rotated token authenticates subsequent requests', async () => {
        // Use the rotated token from the prior test would be cleaner, but
        // tests should be independent. Re-issue a fresh starting token
        // and verify the rotated one works.
        const db = await openDb(server.dbPath);
        const crypto = await import('crypto');
        const userRow = await dbGet(db, 'SELECT * FROM users WHERE id = ?', [userId]);

        const startToken = jwt.sign(
            { id: userId, username: userRow.username, email: userRow.email, role: 'admin', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'rotated-test' },
        );
        const startHash = crypto.createHash('sha256').update(startToken).digest('hex');
        await dbRun(
            db,
            `INSERT INTO active_sessions (user_id, token_hash, expires_at, tenant_id, is_active)
             VALUES (?, ?, datetime('now', '+1 hour'), 1, 1)`,
            [userId, startHash],
        );
        await dbClose(db);

        const refresh = await fetch(`${server.baseUrl}/api/auth/refresh`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${startToken}` },
        });
        expect(refresh.status).toBe(200);
        const { token: rotated } = await refresh.json();

        // Use the rotated token to call /auth/verify.
        const verify = await fetch(`${server.baseUrl}/api/auth/verify`, {
            headers: { Authorization: `Bearer ${rotated}` },
        });
        expect(verify.status).toBe(200);
        const verifyBody = await verify.json();
        expect(verifyBody.valid).toBe(true);
        expect(verifyBody.user.id).toBe(userId);
    });

    it('rejects when no Authorization is provided', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/refresh`, { method: 'POST' });
        expect(res.status).toBe(401);
    });

    it('rejects a refresh attempt against a revoked token', async () => {
        const db = await openDb(server.dbPath);
        const crypto = await import('crypto');
        const userRow = await dbGet(db, 'SELECT * FROM users WHERE id = ?', [userId]);

        const deadToken = jwt.sign(
            { id: userId, username: userRow.username, email: userRow.email, role: 'admin', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'revoked-test' },
        );
        const deadHash = crypto.createHash('sha256').update(deadToken).digest('hex');
        // Insert a row and immediately revoke it.
        await dbRun(
            db,
            `INSERT INTO active_sessions (user_id, token_hash, expires_at, tenant_id, is_active)
             VALUES (?, ?, datetime('now', '+1 hour'), 1, 0)`,
            [userId, deadHash],
        );
        await dbClose(db);

        const res = await fetch(`${server.baseUrl}/api/auth/refresh`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${deadToken}` },
        });
        // authenticateToken catches this BEFORE /auth/refresh runs.
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('Session revoked');
    });
});
