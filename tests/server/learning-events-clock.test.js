// The learner's clock is kept, not trusted — RPS-1 §17.
//
// Regression lock. `/learning-events/batch` used to persist whatever the
// browser put in `timestamp`, unverified. Two things followed:
//
//   * A device with a wrong clock wrote its whole session hours away from the
//     server-stamped chat turns beside it, and nothing recorded that it had —
//     the corruption was indistinguishable from a real overnight resume.
//   * The value arrived as `…T…Z` while every server-stamped row in the same
//     column was sqlite's `2026-08-29 12:34:56`, and `ORDER BY timestamp` is a
//     string sort. On the development database that put 2169 of 3119 rows in
//     the wrong position.
//
// Now the server anchors on its own clock and keeps the device's reading in
// `client_time`, so skew becomes a measurable column rather than an invisible
// corruption.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { ISO_Z_RE, timeMs } from '../../server/shared/time.js';

const PASSWORD = 'ClockT3sts!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
const closeDb = (db) => new Promise((r) => db.close(() => r()));
const pRun = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
const pAll = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));

describe('learning-events: the server owns the clock', () => {
    let server, token, sessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(PASSWORD, 4);
            const u = await pRun(db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('clock-student', 'clock', 'clock@example.com', ?, 'admin', 1, 'active')`, [hash]);
            const c = await pRun(db,
                `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
                 VALUES ('Clock Case', '', 'p', '{}', 1)`);
            const s = await pRun(db,
                `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`,
                [c.lastID, u.lastID]);
            sessionId = s.lastID;
        } finally { await closeDb(db); }

        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'clock-student', password: PASSWORD }),
        });
        token = (await res.json()).token;
    });
    afterAll(async () => { await server?.close(); });

    const post = (events) => fetch(`${server.baseUrl}/api/learning-events/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ events }),
    });

    async function rows(verb) {
        const db = await openDb(server.dbPath);
        try {
            return await pAll(db,
                `SELECT verb, timestamp, client_time FROM learning_events WHERE verb = ? ORDER BY id`, [verb]);
        } finally { await closeDb(db); }
    }

    it('ignores a wildly wrong device clock and stamps its own', async () => {
        const before = Date.now();
        const res = await post([{
            session_id: sessionId, verb: 'STARTED_SESSION', object_type: 'session',
            // A device three years and three hours out.
            client_time: '2029-01-01T00:00:00.000Z',
            offset_ms: 0,
        }]);
        expect(res.status).toBe(200);
        const [row] = await rows('STARTED_SESSION');

        // Stamped now, by this server — not in 2029.
        expect(timeMs(row.timestamp)).toBeGreaterThanOrEqual(before - 1000);
        expect(timeMs(row.timestamp)).toBeLessThanOrEqual(Date.now() + 1000);
        // ...and the device's claim is kept, so the skew is measurable.
        expect(row.client_time).toBe('2029-01-01T00:00:00.000Z');
    });

    it('always writes the contract shape', async () => {
        await post([{ session_id: sessionId, verb: 'ENDED_SESSION', object_type: 'session', offset_ms: 1000 }]);
        const [row] = await rows('ENDED_SESSION');
        expect(row.timestamp).toMatch(ISO_Z_RE);
    });

    it('preserves the spacing between events flushed together', async () => {
        // Three events 10s apart on the device. Whatever the device clock said,
        // the GAPS must survive — time-on-task and TNA read the gaps, not the
        // absolute instants.
        await post([25_000, 15_000, 5_000].map((offset_ms) => ({
            session_id: sessionId, verb: 'VIEWED', object_type: 'component',
            object_name: `gap-${offset_ms}`, offset_ms,
        })));
        const got = (await rows('VIEWED')).map((r) => timeMs(r.timestamp));
        expect(got[1] - got[0]).toBe(10_000);
        expect(got[2] - got[1]).toBe(10_000);
    });

    it('accepts an event with no clock information at all', async () => {
        // Older clients still in a browser tab send neither field. They must
        // keep working — telemetry that cannot be placed perfectly is still
        // worth more than telemetry dropped.
        const res = await post([{ session_id: sessionId, verb: 'CLICKED', object_type: 'button' }]);
        expect(res.status).toBe(200);
        expect((await res.json()).inserted).toBe(1);
        const [row] = await rows('CLICKED');
        expect(row.timestamp).toMatch(ISO_Z_RE);
        expect(row.client_time).toBeNull();
    });

    it('falls back to a legacy client timestamp for client_time', async () => {
        // A client that has not been rebuilt yet still sends `timestamp`.
        // It is recorded as the CLIENT's reading, never as the row's own.
        await post([{
            session_id: sessionId, verb: 'SCROLLED', object_type: 'component',
            timestamp: '2020-05-05 06:00:00',
        }]);
        const [row] = await rows('SCROLLED');
        expect(row.client_time).toBe('2020-05-05T06:00:00.000Z');
        expect(timeMs(row.timestamp)).toBeGreaterThan(timeMs('2025-01-01T00:00:00.000Z'));
    });

    it('every row it wrote sorts correctly as a plain string', async () => {
        // The property the whole contract exists for: with one shape, the
        // cheap string ORDER BY the codebase already uses is chronological.
        const db = await openDb(server.dbPath);
        try {
            const byString = await pAll(db, `SELECT id, timestamp FROM learning_events ORDER BY timestamp, id`);
            const byTime = [...byString].sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp) || a.id - b.id);
            expect(byString.map((r) => r.id)).toEqual(byTime.map((r) => r.id));
        } finally { await closeDb(db); }
    });
});
