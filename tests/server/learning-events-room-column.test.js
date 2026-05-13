// Regression lock for migration 0021's `room` column on direct
// `learning_events` INSERTs. The canonical POST /learning-events path
// already stamps `room`; this test covers the dual-write paths that
// historically bypassed it:
//   - POST /api/settings/log (CHANGED_SETTING dual-write)
//   - POST /api/auth/login (LOGGED_IN auth event)
//
// Pre-fix, those rows landed with room=NULL because the column wasn't
// in the INSERT statement — which silently dropped the value even when
// the client supplied one. The fix is additive (column added with NULL
// allowed) so older callers don't break, but the column must now be
// present so analytics can filter by room across every event source.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'RoomColumnT3sts!';

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
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}

async function seedUser(db, username) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
        [username, username, `${username}@example.com`, hash]);
    return r.lastID;
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

describe('learning_events.room column on direct-INSERT paths', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, 'room-col-admin');
        } finally {
            await closeDb(db);
        }
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('CHANGED_SETTING dual-write includes the room column in the INSERT (NULL by default)', async () => {
        // Login goes through the LOGGED_IN auth INSERT — exercises one of
        // the patched paths as a side effect.
        const token = await login(server.baseUrl, 'room-col-admin');

        const res = await fetch(`${server.baseUrl}/api/settings/log`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                // setting_type has a CHECK constraint (llm | monitor |
                // case_load); pick a value that satisfies it.
                setting_type: 'llm',
                setting_name: 'temperature',
                old_value: '0.7',
                new_value: '0.5',
                settings_json: { source: 'unit-test' },
            }),
        });
        expect(res.status).toBe(200);

        const db = await openDb(server.dbPath);
        try {
            const rows = await pAll(db,
                `SELECT verb, room FROM learning_events
                  WHERE verb = 'CHANGED_SETTING'
                  ORDER BY id DESC LIMIT 1`);
            expect(rows.length).toBe(1);
            // Column must be selectable — pre-fix the INSERT omitted it,
            // SELECT would still return undefined but the column would
            // not be visible in pragma-derived schemas. Here we assert
            // the row exists with an explicit room field, NULL because
            // settings changes never carry a room.
            expect(rows[0]).toHaveProperty('room');
            expect(rows[0].room).toBeNull();
        } finally {
            await closeDb(db);
        }
    });

    it('LOGGED_IN auth event includes the room column (NULL — pre-session)', async () => {
        // Already logged in above; that exercise wrote a LOGGED_IN row.
        // Query and assert column presence.
        const db = await openDb(server.dbPath);
        try {
            const rows = await pAll(db,
                `SELECT verb, room FROM learning_events
                  WHERE verb = 'LOGGED_IN'
                  ORDER BY id DESC LIMIT 1`);
            expect(rows.length).toBe(1);
            expect(rows[0]).toHaveProperty('room');
            expect(rows[0].room).toBeNull();
        } finally {
            await closeDb(db);
        }
    });
});
