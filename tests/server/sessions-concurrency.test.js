// Concurrency test for POST /api/sessions.
//
// Original contract (audit follow-up) checked that N concurrent POSTs
// produced N distinct rowids. After the dedup window introduced in the
// PLAN_LOGGING follow-up — POST /sessions returns the existing active
// session for the same user×case if one was started in the last 30s —
// that contract no longer holds. The new contract:
//   - N concurrent POST /sessions calls all succeed (no 5xx).
//   - Every response carries an id (either freshly created OR the existing
//     dedup target).
//   - DB row count == the number of distinct ids returned (no orphan
//     UNIQUE-constraint failures, no double-creates).
//   - Under burst conditions inside the 30s window the dedup collapses
//     the burst to a small number of ids (typically 1).

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

    it('20 concurrent POST /sessions all succeed; dedup collapses to a small set; DB row count matches', async () => {
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

        // Every response should carry an id (no 5xx, no UNIQUE collisions).
        const ids = results.map(r => r.id).filter(Boolean);
        expect(ids).toHaveLength(N);

        // The 30s dedup window collapses the burst — distinct count is
        // small (typically 1; allow a couple in case the burst straddles
        // a millisecond boundary in CI).
        const uniq = new Set(ids);
        expect(uniq.size).toBeLessThanOrEqual(3);

        // DB row count matches the distinct id count exactly — no
        // orphan/leaked rows.
        const db = await openDb(server.dbPath);
        const rows = await dbAll(db,
            'SELECT id FROM sessions WHERE user_id = ? AND case_id = ?',
            [userId, caseId]);
        await dbClose(db);
        expect(rows.length).toBe(uniq.size);
    });
});
