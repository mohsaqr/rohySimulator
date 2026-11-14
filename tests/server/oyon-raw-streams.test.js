// Oyon 3.5.11 per-sample streams, raw-only envelopes and split windows
// (migration 0076, server/shared/oyonRawParts.js, server/lib/oyonRawValidation.js).
//
// Regression lock: before 0076 a window's `raw_streams` had no column and the
// whole event was refused once it outgrew MAX_EMOTION_EVENT_JSON_LENGTH; a
// raw-only envelope (`modality: 'raw'`) was refused as an unknown modality; and
// a continuation part keyed on its window's span would have been dropped as a
// duplicate of that window. Each of those loses rows the learner consented to.
//
// Runs against the vendored OyonR, whatever its version: the seam test at the
// bottom states which validator handled the raw payloads.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { mintToken } from '../utils/authHttp.js';
import { enrollInSensingCourse } from '../utils/oyonCourse.js';
import {
    OYON_MAX_BATCH_EVENTS, OYON_PERSIST_TARGET_BYTES, filterRawStreams, joinRawParts, packPersistBatches,
} from '../../server/shared/oyonRawParts.js';
import { OYON_VALIDATES_RAW } from '../../server/lib/oyonRawValidation.js';

const SECRET = 'oyon-raw-streams-tests-secret';

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
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null)));
}
function dbClose(db) { return new Promise((r) => db.close(() => r())); }

async function countRows(dbPath, table) {
    const db = await openDb(dbPath);
    const row = await dbGet(db, `SELECT COUNT(*) AS n FROM ${table}`);
    await dbClose(db);
    return Number(row?.n) || 0;
}

let windowSeq = 0;
function windowBounds() {
    windowSeq += 1;
    const start = new Date(Date.now() - (1_800_000 - windowSeq * 20_000));
    const end = new Date(start.getTime() + 10_000);
    return { window_start: start.toISOString(), window_end: end.toISOString() };
}

const ENVELOPE = { capture_mode: 'local-browser', consent_version: 'oyon-consent-v1' };
const AFFECT = ['ts_ms', 'ts_group_ms', 'valence', 'arousal', 'confidence', 'label', 'face_present'];

function affectRows(startMs, n) {
    return Array.from({ length: n }, (_, i) => [startMs + i * 250, null, 0.1, 0.2, 0.9, 'happy', 1]);
}

function emotionWindow(sessionId, bounds = windowBounds(), extra = {}) {
    return {
        ...ENVELOPE,
        ...bounds,
        session_id: String(sessionId),
        dominant_emotion: 'happy',
        probabilities: { happy: 1 },
        confidence: 0.9,
        valid_frames: 8,
        missing_face_ratio: 0,
        ...extra,
    };
}

/** A raw-only envelope as EmotionRuntime._sendRawOnly emits it (context + envelope). */
function rawOnly(sessionId, reason, bounds = windowBounds(), extra = {}) {
    return {
        ...ENVELOPE,
        ...bounds,
        session_id: String(sessionId),
        modality: 'raw',
        window_kind: 'interval',
        raw_reason: reason,
        raw_streams: { affect: { fields: AFFECT, rows: affectRows(Date.parse(bounds.window_start), 3) } },
        ...extra,
    };
}

async function postBatch(server, token, events) {
    const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_version: 'oyon-window-batch-v4', events }),
    });
    return { status: res.status, body: await res.json() };
}

async function getJson(server, token, path) {
    const res = await fetch(`${server.baseUrl}/api/addons/oyon${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: await res.json() };
}

describe('Oyon raw streams ingest and read-back (migration 0076)', () => {
    let server;
    let studentTok;
    let adminTok;
    let sessionId;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        for (const [u, role] of [['raw_stu', 'student'], ['raw_admin', 'admin']]) {
            await dbRun(db,
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [u, u, pwd, `${u}@example.com`, role]);
        }
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['raw_stu']);
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['raw_admin']);
        await enrollInSensingCourse(db, stu.id);
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [stu.id]);
        sessionId = (await dbGet(db, 'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [stu.id])).id;
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
             VALUES ('1', ?, ?, 1, 'oyon-consent-v1', 'oyon-consent-v1')`,
            [String(stu.id), String(sessionId)]);
        // Heart rate switched OFF for the tenant: its raw streams must be left
        // out exactly as its window block is.
        await dbRun(db,
            `INSERT OR REPLACE INTO oyon_settings (
                tenant_id, emotion_capture_enabled,
                admin_emotion_view_enabled, educator_emotion_view_enabled, student_emotion_view_enabled,
                model_profile, sample_interval_ms, window_ms,
                min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence,
                heart_rate_enabled
             ) VALUES ('1', 1, 1, 1, 1, 'hse-emotion-mtl', 500, 10000, 3, 0.28, 3000, 0.5, 0)`);
        await dbClose(db);
        studentTok = await mintToken(server.dbPath, { id: stu.id, username: 'raw_stu', role: 'student', tenant_id: 1 }, SECRET, { jti: 'raw-s' });
        adminTok = await mintToken(server.dbPath, { id: admin.id, username: 'raw_admin', role: 'admin', tenant_id: 1 }, SECRET, { jti: 'raw-a' });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('stores a 3.3.3-shaped batch exactly as before, with no raw rows', async () => {
        const rawBefore = await countRows(server.dbPath, 'oyon_raw_streams');
        const { status, body } = await postBatch(server, studentTok, [emotionWindow(sessionId)]);
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 1, skipped: 0, raw_inserted: 0, raw_skipped: 0, raw_streams_dropped: 0 });
        expect(await countRows(server.dbPath, 'oyon_raw_streams')).toBe(rawBefore);
    });

    // Regression lock: a window with raw_streams larger than the event JSON
    // bound (20 000 chars) was refused whole.
    it('keeps a window\'s raw_streams beside its emotion record, and drops a switched-off stream', async () => {
        const bounds = windowBounds();
        const t0 = Date.parse(bounds.window_start);
        const win = emotionWindow(sessionId, bounds, {
            raw_streams: {
                affect: { fields: AFFECT, rows: affectRows(t0, 600) },
                heart_rate: { fields: ['ts_ms', 'ts_group_ms', 'bpm', 'snr', 'confidence'], rows: [[t0, null, 72, 3, 0.6]] },
            },
        });
        expect(JSON.stringify(win).length).toBeGreaterThan(20_000);
        const emotionsBefore = await countRows(server.dbPath, 'oyon_emotion_records');
        const { status, body } = await postBatch(server, studentTok, [win]);
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 1, raw_inserted: 1, raw_streams_dropped: 1 });
        expect(await countRows(server.dbPath, 'oyon_emotion_records')).toBe(emotionsBefore + 1);

        const db = await openDb(server.dbPath);
        const row = await dbGet(db, `SELECT * FROM oyon_raw_streams WHERE window_start = ? AND owner_kind = 'emotion'`, [bounds.window_start]);
        await dbClose(db);
        expect(row.modality).toBe('emotion');
        expect(row.row_count).toBe(600);
        expect(Object.keys(JSON.parse(row.streams_json))).toEqual(['affect']);
    });

    // Regression lock: a continuation part shares its window's span; keyed on
    // the span alone it was a duplicate and its rows were lost.
    it('stores a split window as two rows and reads it back joined', async () => {
        const bounds = windowBounds();
        const t0 = Date.parse(bounds.window_start);
        const head = emotionWindow(sessionId, bounds, {
            raw_part: { id: 'rp-split-1', index: 0, count: 2 },
            raw_streams: { affect: { fields: AFFECT, rows: affectRows(t0, 3) } },
        });
        const part = {
            ...ENVELOPE, ...bounds, session_id: String(sessionId),
            modality: 'raw', window_kind: 'interval', raw_reason: 'continuation', raw_parent_modality: 'emotion',
            raw_part: { id: 'rp-split-1', index: 1, count: 2 },
            raw_streams: { affect: { fields: AFFECT, rows: affectRows(t0 + 750, 2) } },
        };
        const emotionsBefore = await countRows(server.dbPath, 'oyon_emotion_records');
        const signalsBefore = await countRows(server.dbPath, 'oyon_signal_windows');
        const rawBefore = await countRows(server.dbPath, 'oyon_raw_streams');

        const { status, body } = await postBatch(server, studentTok, [head, part]);
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 1, signals_inserted: 0, raw_inserted: 2 });
        expect(await countRows(server.dbPath, 'oyon_emotion_records')).toBe(emotionsBefore + 1);
        expect(await countRows(server.dbPath, 'oyon_signal_windows')).toBe(signalsBefore);
        expect(await countRows(server.dbPath, 'oyon_raw_streams')).toBe(rawBefore + 2);

        // A retry re-chunks with a NEW part id: it must collapse onto the rows stored.
        const retry = await postBatch(server, studentTok, [
            { ...head, raw_part: { ...head.raw_part, id: 'rp-split-retry' } },
            { ...part, raw_part: { ...part.raw_part, id: 'rp-split-retry' } },
        ]);
        expect(retry.body).toMatchObject({ inserted: 0, skipped: 1, raw_inserted: 0, raw_skipped: 2 });

        const { status: readStatus, body: read } = await getJson(server, adminTok, `/raw-streams?session_id=${sessionId}`);
        expect(readStatus).toBe(200);
        const joined = read.windows.find((w) => w.raw_part?.id === 'rp-split-1');
        expect(joined.owner_kind).toBe('emotion');
        expect(joined.raw_part.joined).toBe(2);
        expect(joined.raw_streams.affect.rows.map((r) => r[0])).toEqual([t0, t0 + 250, t0 + 500, t0 + 750, t0 + 1000]);
        expect(read.raw_only.some((w) => w.raw_part?.id === 'rp-split-1')).toBe(false);
    });

    it('stores raw-only envelopes outside every window count, and exports them', async () => {
        const emotionsBefore = await countRows(server.dbPath, 'oyon_emotion_records');
        const signalsBefore = await countRows(server.dbPath, 'oyon_signal_windows');
        const listBefore = (await getJson(server, adminTok, `/emotion-records?session_id=${sessionId}`)).body.total;
        const stopBounds = windowBounds();
        const { status, body } = await postBatch(server, studentTok, [
            rawOnly(sessionId, 'stop', stopBounds),
            // Same span, another reason: a distinct payload, not a duplicate.
            rawOnly(sessionId, 'row_bound', stopBounds),
        ]);
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 0, signals_inserted: 0, raw_inserted: 2 });
        expect(await countRows(server.dbPath, 'oyon_emotion_records')).toBe(emotionsBefore);
        expect(await countRows(server.dbPath, 'oyon_signal_windows')).toBe(signalsBefore);
        expect((await getJson(server, adminTok, `/emotion-records?session_id=${sessionId}`)).body.total).toBe(listBefore);

        const { body: read } = await getJson(server, adminTok, `/raw-streams?session_id=${sessionId}`);
        const reasons = read.raw_only.filter((w) => w.window_start === stopBounds.window_start).map((w) => w.raw_reason).sort();
        expect(reasons).toEqual(['row_bound', 'stop']);
        expect(read.raw_only.every((w) => w.modality === 'raw')).toBe(true);
        expect(read.windows.every((w) => w.owner_kind !== 'raw')).toBe(true);

        // Replaying the stop envelope stores nothing new.
        const again = await postBatch(server, studentTok, [rawOnly(sessionId, 'stop', stopBounds)]);
        expect(again.body).toMatchObject({ raw_inserted: 0, raw_skipped: 1 });
    });

    it('refuses malformed raw payloads with the validator\'s 400', async () => {
        const badFields = emotionWindow(sessionId, windowBounds(), {
            raw_streams: { affect: { fields: ['valence', 'ts_ms'], rows: [[0.1, 1]] } },
        });
        expect((await postBatch(server, studentTok, [badFields])).status).toBe(400);
        const noTime = rawOnly(sessionId, 'stop', windowBounds(), { window_start: 'not a time' });
        expect((await postBatch(server, studentTok, [noTime])).status).toBe(400);
        // raw_part is Rohy's own storage contract, checked whatever OyonR is vendored.
        const badPart = rawOnly(sessionId, 'continuation', windowBounds(), { raw_part: { id: 'x', index: 2, count: 2 } });
        expect((await postBatch(server, studentTok, [badPart])).status).toBe(400);
    });

    it('accepts one long window over the general 256 KB body limit on this route', async () => {
        const bounds = windowBounds();
        const win = emotionWindow(sessionId, bounds, {
            raw_streams: { affect: { fields: AFFECT, rows: affectRows(Date.parse(bounds.window_start), 8000) } },
        });
        expect(JSON.stringify(win).length).toBeGreaterThan(256 * 1024);
        const { status, body } = await postBatch(server, studentTok, [win]);
        expect(status).toBe(200);
        expect(body).toMatchObject({ inserted: 1, raw_inserted: 1 });
    });

    it('agrees with the client on the batch size: OYON_MAX_BATCH_EVENTS + 1 is refused', async () => {
        const events = Array.from({ length: OYON_MAX_BATCH_EVENTS + 1 }, () => emotionWindow(sessionId));
        const { status, body } = await postBatch(server, studentTok, events);
        expect(status).toBe(400);
        expect(JSON.stringify(body.details)).toContain(`at most ${OYON_MAX_BATCH_EVENTS}`);
    });

    it('reads raw streams only for staff with a view', async () => {
        expect((await getJson(server, studentTok, `/raw-streams?session_id=${sessionId}`)).status).toBe(403);
        expect((await getJson(server, adminTok, '/raw-streams')).status).toBe(400);
    });

    it('states which validator handled the raw payloads (the re-vendor seam)', () => {
        // OyonR 3.3.3: false — server/lib/oyonRawValidation.js checks raw-only
        // envelopes and raw_streams. After the ≥ 3.5.11 re-vendor: true, and the
        // fallback there is dead code to delete.
        expect(typeof OYON_VALIDATES_RAW).toBe('boolean');
    });
});

describe('server/shared/oyonRawParts.js', () => {
    const F = ['ts_ms', 'ts_group_ms', 'v'];

    it('joinRawParts merges parts onto index 0 in index order, unions fields, keeps orphans and raw-only', () => {
        const head = { id: 'h', raw_part: { id: 'p', index: 0, count: 3 }, raw_streams: { a: { fields: F, rows: [[1, null, 1]] } } };
        const p2 = { id: 'p2', modality: 'raw', raw_part: { id: 'p', index: 2, count: 3 }, raw_streams: { a: { fields: [...F, 'w'], rows: [[3, null, 3, 9]] } } };
        const p1 = { id: 'p1', modality: 'raw', raw_part: { id: 'p', index: 1, count: 3 }, raw_streams: { a: { fields: F, rows: [[2, null, 2]] } } };
        const orphan = { id: 'o', modality: 'raw', raw_part: { id: 'q', index: 1, count: 2 }, raw_streams: {} };
        const stop = { id: 's', modality: 'raw', raw_reason: 'stop', raw_streams: {} };
        const out = joinRawParts([head, p2, stop, p1, orphan]);
        expect(out.map((w) => w.id)).toEqual(['h', 's', 'o']);
        expect(out[0].raw_part.joined).toBe(3);
        expect(out[0].raw_streams.a.fields).toEqual([...F, 'w']);
        expect(out[0].raw_streams.a.rows).toEqual([[1, null, 1, null], [2, null, 2, null], [3, null, 3, 9]]);
        expect(head.raw_streams.a.rows).toHaveLength(1); // input untouched
        expect(() => joinRawParts(null)).toThrow(TypeError);
    });

    it('packPersistBatches keeps order, never exceeds the event limit, and sends an oversized event alone', () => {
        const small = Array.from({ length: 150 }, (_, i) => ({ i }));
        const batches = packPersistBatches(small);
        expect(batches.every((b) => b.length <= OYON_MAX_BATCH_EVENTS)).toBe(true);
        expect(batches.flat().map((e) => e.i)).toEqual(small.map((e) => e.i));

        const big = { i: 'big', pad: 'x'.repeat(OYON_PERSIST_TARGET_BYTES + 10) };
        const mixed = packPersistBatches([{ i: 1 }, big, { i: 2 }]);
        expect(mixed.map((b) => b.map((e) => e.i))).toEqual([[1], ['big'], [2]]);
        expect(() => packPersistBatches('x')).toThrow(TypeError);
    });

    it('filterRawStreams leaves out streams whose modality is not allowed', () => {
        const streams = { affect: { fields: F, rows: [] }, ibi: { fields: F, rows: [] }, au: { fields: F, rows: [] } };
        const { streams: kept, dropped } = filterRawStreams(streams, (m) => m !== 'heart_rate');
        expect(Object.keys(kept)).toEqual(['affect', 'au']);
        expect(dropped).toEqual(['ibi']);
        expect(filterRawStreams(null, () => true)).toEqual({ streams: null, dropped: [] });
    });
});
