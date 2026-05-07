// Concurrency test for POST /api/sessions.
//
// Audit follow-up: the audit didn't ask about a session_id collision under
// parallel creation, but the race exists in principle — two tabs that
// click "Start" simultaneously could either both create distinct rows
// (good — last write wins on the client side) or one could 500 due to
// a UNIQUE constraint collision.
//
// SQLite uses an INTEGER PRIMARY KEY AUTOINCREMENT for sessions.id, so
// distinct rowids are guaranteed. The contract this test pins:
//   - N concurrent POST /sessions calls all succeed.
//   - Every returned session id is distinct.
//   - The DB row count after the burst equals N.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-sessions-concurrency-secret';

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

describe('POST /api/sessions — concurrency', () => {
    let server;
    let token;
    let userId;
    let caseId;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });
        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);

        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'student', 'active', 1)`,
            ['concurrent_user', 'Concurrent User', passwordHash, 'c@example.com']);
        const u = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['concurrent_user']);
        userId = u.id;

        // Create a case for the sessions to attach to.
        await dbRun(db,
            `INSERT INTO cases (name, description, config, created_by, tenant_id)
             VALUES (?, ?, ?, ?, 1)`,
            ['Concurrency Test Case', 'For session race tests', '{}', userId]);
        const c = await dbGet(db, "SELECT id FROM cases WHERE name = 'Concurrency Test Case'");
        caseId = c.id;

        await dbClose(db);

        token = jwt.sign(
            { id: userId, username: 'concurrent_user', email: 'c@example.com', role: 'student', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'concurrent-session-tok' },
        );
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('20 concurrent POST /sessions return 20 distinct session ids', async () => {
        const N = 20;
        const promises = Array.from({ length: N }, () =>
            fetch(`${server.baseUrl}/api/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ case_id: caseId, student_name: 'Stud' }),
            }).then(r => r.json())
        );
        const results = await Promise.all(promises);

        // Every response should carry an id.
        const ids = results.map(r => r.id).filter(Boolean);
        expect(ids).toHaveLength(N);

        // All ids distinct.
        const uniq = new Set(ids);
        expect(uniq.size).toBe(N);

        // DB has exactly N rows for this user × case.
        const db = await openDb(server.dbPath);
        const rows = await dbAll(db,
            'SELECT id FROM sessions WHERE user_id = ? AND case_id = ?',
            [userId, caseId]);
        await dbClose(db);
        expect(rows.length).toBe(N);
    });
});
