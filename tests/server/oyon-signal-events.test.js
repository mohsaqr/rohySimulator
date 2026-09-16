// Oyon per-event state log (migration 0058): POST/GET /addons/oyon/signal-events.
//
// The events feed sequence analysis (Network, Patterns, Process Map, Clusters)
// for typing and voice. What must hold:
//   - only the session owner writes, and only under granted consent;
//   - a modality the accepted contract does not name is dropped and counted
//     (typing needs v2, voice v3) — never stored;
//   - `detail` keeps content-free scalars only, whatever a client sends;
//   - a retried batch stores nothing twice;
//   - reads honour role + tenant view flags and return captures in order.
//
// Real spawned server + sqlite, same pattern as oyon-signal-windows.test.js.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const SECRET = 'oyon-signal-events-tests-secret';

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
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
    );
}
function dbClose(db) { return new Promise((r) => db.close(() => r())); }
function tokenFor(user, jti) {
    return jwt.sign(user, SECRET, { expiresIn: '1h', jwtid: jti });
}

async function withDb(dbPath, work) {
    const db = await openDb(dbPath);
    try { return await work(db); } finally { await dbClose(db); }
}

let seq = 0;
function event(captureId, modality, state, extra = {}) {
    seq += 1;
    return {
        capture_id: captureId,
        sequence_index: seq,
        modality,
        state,
        source: 'user',
        timestamp: Date.now() - 30_000 + seq,
        ...extra,
    };
}

async function post(server, token, body) {
    const res = await fetch(`${server.baseUrl}/api/addons/oyon/signal-events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

async function get(server, token, query = '') {
    const res = await fetch(`${server.baseUrl}/api/addons/oyon/signal-events${query}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: await res.json() };
}

describe('Oyon signal events', () => {
    let server;
    let stuTok, otherTok, eduTok;
    let v3Session, v2Session;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        await withDb(server.dbPath, async (db) => {
            const pwd = await bcrypt.hash('x', 4);
            for (const [u, role] of [['ose_stu', 'student'], ['ose_other', 'student'], ['ose_edu', 'educator']]) {
                await dbRun(db,
                    `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                     VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                    [u, u, pwd, `${u}@example.com`, role]);
            }
            const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['ose_stu']);
            const other = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['ose_other']);
            const edu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['ose_edu']);

            const session = async (version) => {
                await dbRun(db,
                    `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                     VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [stu.id]);
                const row = await dbGet(db, 'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [stu.id]);
                await dbRun(db,
                    `INSERT INTO oyon_emotion_consents
                        (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
                     VALUES ('1', ?, ?, 1, ?, ?)`,
                    [String(stu.id), String(row.id), version, version]);
                return row.id;
            };
            v3Session = await session('oyon-consent-v3');
            v2Session = await session('oyon-consent-v2');

            await dbRun(db,
                `INSERT OR REPLACE INTO oyon_settings (
                    tenant_id, emotion_capture_enabled,
                    admin_emotion_view_enabled, educator_emotion_view_enabled, student_emotion_view_enabled,
                    model_profile, sample_interval_ms, window_ms,
                    min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence
                 ) VALUES ('1', 1, 1, 1, 0, 'hse-emotion-mtl', 500, 10000, 3, 0.28, 3000, 0.5)`);

            stuTok = tokenFor({ id: stu.id, username: 'ose_stu', role: 'student', tenant_id: 1 }, 'se-s');
            otherTok = tokenFor({ id: other.id, username: 'ose_other', role: 'student', tenant_id: 1 }, 'se-o');
            eduTok = tokenFor({ id: edu.id, username: 'ose_edu', role: 'educator', tenant_id: 1 }, 'se-e');
        });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('stores typing and voice events in order, with pause durations', async () => {
        const events = [
            event('cap-a', 'typing', 'start'),
            event('cap-a', 'typing', 'insert', { detail: { offset: 0, length: 1, op: 'insert' } }),
            event('cap-a', 'typing', 'pause', { detail: { duration_ms: 2400 } }),
            event('cap-a', 'voice', 'speech', { detail: { frame_index: 12 } }),
            event('cap-a', 'voice', 'pause', { detail: { frame_index: 40, silence_run_ms: 640 } }),
        ];
        const { status, body } = await post(server, stuTok, { session_id: String(v3Session), events });
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 5, skipped: 0, consent_blocked: 0 });

        const rows = await withDb(server.dbPath, (db) => dbAll(db,
            `SELECT state, modality, duration_ms FROM oyon_signal_events
             WHERE session_id = ? AND capture_id = 'cap-a' ORDER BY sequence_index`, [String(v3Session)]));
        expect(rows.map(r => r.state)).toEqual(['start', 'insert', 'pause', 'speech', 'pause']);
        expect(rows.map(r => r.duration_ms)).toEqual([null, null, 2400, null, 640]);
    });

    // Regression lock: nothing beyond the content-free scalars is ever persisted.
    it('keeps only whitelisted detail fields', async () => {
        const events = [event('cap-detail', 'typing', 'paste', {
            detail: { offset: 4, length: 12, op: 'paste', text: 'chest pain since noon', inserted_text: 'x', html: '<b>' },
        })];
        const { status } = await post(server, stuTok, { session_id: String(v3Session), events });
        expect(status).toBe(200);
        const row = await withDb(server.dbPath, (db) => dbGet(db,
            `SELECT detail_json FROM oyon_signal_events WHERE capture_id = 'cap-detail'`));
        expect(JSON.parse(row.detail_json)).toEqual({ offset: 4, length: 12, op: 'paste' });
    });

    it('drops voice under a v2 contract and counts it, while typing is kept', async () => {
        const events = [
            event('cap-v2', 'typing', 'insert'),
            event('cap-v2', 'voice', 'speech'),
            event('cap-v2', 'voice', 'silence'),
        ];
        const { status, body } = await post(server, stuTok, { session_id: String(v2Session), events });
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 1, consent_blocked: 2 });
        const voice = await withDb(server.dbPath, (db) => dbGet(db,
            `SELECT COUNT(*) AS n FROM oyon_signal_events WHERE capture_id = 'cap-v2' AND modality = 'voice'`));
        expect(voice.n).toBe(0);
    });

    it('stores a retried batch once', async () => {
        const events = [event('cap-retry', 'typing', 'insert'), event('cap-retry', 'typing', 'delete')];
        const first = await post(server, stuTok, { session_id: String(v3Session), events });
        const second = await post(server, stuTok, { session_id: String(v3Session), events });
        expect(first.body.inserted).toBe(2);
        expect(second.body).toMatchObject({ inserted: 0, skipped: 2 });
    });

    it('refuses a writer who does not own the session', async () => {
        const { status } = await post(server, otherTok, {
            session_id: String(v3Session), events: [event('cap-x', 'typing', 'insert')],
        });
        expect(status).toBe(403);
    });

    it('rejects unknown states, modalities and oversized batches', async () => {
        const bad = [
            [event('cap-bad', 'typing', 'speech')],
            [event('cap-bad', 'emotion', 'happy')],
            Array.from({ length: 501 }, () => event('cap-bad', 'typing', 'insert')),
            [],
        ];
        for (const events of bad) {
            const { status, body } = await post(server, stuTok, { session_id: String(v3Session), events });
            expect(status).toBe(400);
            expect(body.code).toBe('oyon_bad_event_batch');
        }
    });

    it('rejects an event timestamped outside the session', async () => {
        // Two days back, not hours: sessions.start_time is a zone-less sqlite
        // datetime that Date.parse reads as LOCAL time, so the bound shifts by
        // the machine's UTC offset (up to 14 h). Same check the window ingest uses.
        const events = [event('cap-old', 'typing', 'insert', { timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000 })];
        const { status } = await post(server, stuTok, { session_id: String(v3Session), events });
        expect(status).toBe(400);
    });

    it('lets an educator read events ordered by capture and position, filtered by modality', async () => {
        const { status, body } = await get(server, eduTok, `?session_id=${v3Session}&modality=typing`);
        expect(status).toBe(200);
        expect(body.events.every(e => e.modality === 'typing')).toBe(true);
        const capA = body.events.filter(e => e.capture_id === 'cap-a');
        expect(capA.map(e => e.state)).toEqual(['start', 'insert', 'pause']);
        expect(capA[1].detail).toEqual({ offset: 0, length: 1, op: 'insert' });
        expect(body.total).toBe(body.events.length);
    });

    it('refuses students on the read path', async () => {
        const { status } = await get(server, stuTok);
        expect(status).toBe(403);
    });
});
