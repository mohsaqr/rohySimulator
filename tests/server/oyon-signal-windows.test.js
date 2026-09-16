// Oyon 3 modality-scoped window ingest + read contract (migration 0039).
//
// Regression lock: enabling Oyon 3's new camera modalities makes
// EmotionRuntime.sendWindows() emit standalone `facial_only` / `posture_only` /
// `heart_rate_only` windows that carry NO emotion data. They inherit
// capture_mode + consent_version from the same context spread, so they pass
// validateServerEvent() and — before this change — landed in
// oyon_emotion_records as `dominant_emotion IS NULL` rows. That silently
// shifted every existing row count and emotion distribution (Windows/Students/
// Cases views, the Affect/Attention/Sessions tabs, the emotion TNA sequences).
//
// The lock below fails against the un-fixed ingest: it posts a mixed batch and
// asserts oyon_emotion_records grew by EXACTLY the number of emotion windows.
//
// Uses the real spawned server + sqlite seed pattern from oyon-routes.test.js.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { TypingAggregator } from '../../OyonR/src/aggregation/TypingAggregator.js';
import { TYPING_MAX_INTERVALS } from '../../src/components/oyon/useSignalCapture.js';

const SECRET = 'oyon-signal-windows-tests-secret';

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
function dbClose(db) { return new Promise((r) => db.close(() => r())); }
function tokenFor(user, jti) {
    return jwt.sign(user, SECRET, { expiresIn: '1h', jwtid: jti });
}

async function setOyonViewFlags(dbPath, { admin = 1, educator = 1, student = 1 } = {}) {
    const db = await openDb(dbPath);
    await dbRun(db,
        `INSERT OR REPLACE INTO oyon_settings (
            tenant_id, emotion_capture_enabled,
            admin_emotion_view_enabled, educator_emotion_view_enabled, student_emotion_view_enabled,
            model_profile, sample_interval_ms, window_ms,
            min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence
         ) VALUES ('1', 1, ?, ?, ?,
                   'hse-emotion-mtl', 500, 10000, 3, 0.28, 3000, 0.5)`,
        [admin, educator, student]);
    await dbClose(db);
}

async function countRows(dbPath, table) {
    const db = await openDb(dbPath);
    const row = await dbGet(db, `SELECT COUNT(*) AS n FROM ${table}`);
    await dbClose(db);
    return Number(row?.n) || 0;
}

// Distinct window bounds per call so legitimately different windows hash apart.
let windowSeq = 0;
function windowBounds() {
    windowSeq += 1;
    const start = new Date(Date.now() - (600_000 - windowSeq * 20_000));
    const end = new Date(start.getTime() + 10_000);
    return { window_start: start.toISOString(), window_end: end.toISOString() };
}

const ENVELOPE = { capture_mode: 'local-browser', consent_version: 'oyon-consent-v1' };

function emotionWindow(sessionId) {
    return {
        ...ENVELOPE,
        ...windowBounds(),
        session_id: String(sessionId),
        dominant_emotion: 'happy',
        probabilities: { happy: 1 },
        confidence: 0.9,
        valid_frames: 8,
        missing_face_ratio: 0,
    };
}

/*
 * A camera modality-only window in the legacy `<x>_only` shape v3 still emits.
 *
 * Faithful to EmotionRuntime.sendWindows(): the modality block is NESTED and
 * carries its own valid_frames/duration_ms (see FacialSignalAggregator.flush),
 * so nothing supplies a TOP-LEVEL valid_frames. That is precisely what broke the
 * un-fixed ingest — binding undefined into `valid_frames NOT NULL`. Adding a
 * top-level valid_frames here would make the fixture unfaithful AND hide the bug.
 */
function modalityOnlyWindow(sessionId, flag, block, bounds = windowBounds()) {
    return {
        ...ENVELOPE,
        ...bounds,
        session_id: String(sessionId),
        [flag]: true,
        ...block,
    };
}

/** An emotion window carrying the v3 shared blocks (`*_window_share` default). */
function emotionWindowWithSharedBlocks(sessionId) {
    return {
        ...emotionWindow(sessionId),
        facial: { head_pose_mean: { yaw: 2 }, facing_screen_ratio: 0.9, valid_frames: 8 },
        posture: { slump_ratio: 0.15, valid_frames: 8 },
        heart_rate: { bpm: 74, bpm_robust: 73, confidence: 0.62 },
        respiration: { brpm: 13, confidence: 0.51 },
        illumination: { mean_luma: 0.38 },
        capture_quality: { decoded_fps: 15.8 },
    };
}

/** A v4 window declaring `modality` explicitly. */
function modalityWindow(sessionId, modality, payload, windowKind = 'interval') {
    return {
        ...ENVELOPE,
        ...windowBounds(),
        session_id: String(sessionId),
        modality,
        window_kind: windowKind,
        [modality]: payload,
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

describe('Oyon 3 modality-scoped window ingest', () => {
    let server;
    let studentTok, educatorTok, adminTok;
    let sessionId;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });

        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        for (const [u, role] of [['osw_stu', 'student'], ['osw_edu', 'educator'], ['osw_admin', 'admin']]) {
            await dbRun(db,
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [u, u, pwd, `${u}@example.com`, role]);
        }
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['osw_stu']);
        const edu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['osw_edu']);
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['osw_admin']);

        // Session owned by the student — POST requires the session owner.
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`,
            [stu.id]);
        const sess = await dbGet(db,
            'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [stu.id]);
        sessionId = sess.id;

        // Granted consent — ingest refuses without one. accepted_version is v2
        // so this block can exercise the host-driven modalities; the consent
        // GATE itself is covered by its own describe below, against a session
        // that accepted only v1.
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
             VALUES ('1', ?, ?, 1, 'oyon-consent-v2', 'oyon-consent-v2')`,
            [String(stu.id), String(sessionId)]);
        await dbClose(db);

        studentTok = tokenFor({ id: stu.id, username: 'osw_stu', role: 'student', tenant_id: 1 }, 'sw-s');
        educatorTok = tokenFor({ id: edu.id, username: 'osw_edu', role: 'educator', tenant_id: 1 }, 'sw-e');
        adminTok = tokenFor({ id: admin.id, username: 'osw_admin', role: 'admin', tenant_id: 1 }, 'sw-a');

        await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
    });

    afterAll(async () => { if (server) await server.close(); });

    // Regression lock: modality-only windows must NOT reach oyon_emotion_records.
    it('routes a mixed batch so emotion records grow by exactly the emotion count', async () => {
        const emotionsBefore = await countRows(server.dbPath, 'oyon_emotion_records');
        const signalsBefore = await countRows(server.dbPath, 'oyon_signal_windows');

        const { status, body } = await postBatch(server, studentTok, [
            emotionWindow(sessionId),
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 3, frontal_ratio: 0.8 } }),
            modalityOnlyWindow(sessionId, 'heart_rate_only', { heart_rate: { bpm: 72, confidence: 0.6 } }),
            modalityOnlyWindow(sessionId, 'posture_only', { posture: { slump_ratio: 0.2 } }),
        ]);

        expect(status).toBe(200);
        expect(body.inserted).toBe(1);            // emotion windows only
        expect(body.signals_inserted).toBe(3);    // facial + heart_rate + posture

        const emotionsAfter = await countRows(server.dbPath, 'oyon_emotion_records');
        const signalsAfter = await countRows(server.dbPath, 'oyon_signal_windows');
        expect(emotionsAfter - emotionsBefore).toBe(1);
        expect(signalsAfter - signalsBefore).toBe(3);
    });

    // Regression lock: no NULL-emotion rows may ever appear in the emotion table.
    it('never writes a dominant_emotion IS NULL row into oyon_emotion_records', async () => {
        await postBatch(server, studentTok, [
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 1 } }),
            modalityOnlyWindow(sessionId, 'engagement_only', { engagement: { focus_score: 0.7 } }),
            modalityOnlyWindow(sessionId, 'gaze_only', { gaze: { n_points: 40, dispersion: 0.05 } }),
        ]);
        const db = await openDb(server.dbPath);
        const row = await dbGet(db,
            'SELECT COUNT(*) AS n FROM oyon_emotion_records WHERE dominant_emotion IS NULL');
        await dbClose(db);
        expect(Number(row.n)).toBe(0);
    });

    // Regression lock for shape 1: the DEFAULT path. Every `*_window_share`
    // setting defaults true, so these blocks ride on the emotion window — and
    // before 0039 there were no columns for them, so they were silently dropped
    // exactly as v1 dropped gaze/engagement (see migration 0028).
    it('persists the window-shared blocks that ride on an emotion window', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            emotionWindowWithSharedBlocks(sessionId),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.signals_inserted).toBe(0); // it IS an emotion window

        const db = await openDb(server.dbPath);
        const row = await dbGet(db,
            `SELECT facial_json, posture_json, heart_rate_json, respiration_json,
                    illumination_json, capture_quality_json
             FROM oyon_emotion_records ORDER BY id DESC LIMIT 1`);
        await dbClose(db);
        expect(JSON.parse(row.facial_json)).toMatchObject({ facing_screen_ratio: 0.9 });
        expect(JSON.parse(row.posture_json)).toMatchObject({ slump_ratio: 0.15 });
        expect(JSON.parse(row.heart_rate_json)).toMatchObject({ bpm: 74, bpm_robust: 73 });
        expect(JSON.parse(row.respiration_json)).toMatchObject({ brpm: 13 });
        expect(JSON.parse(row.illumination_json)).toMatchObject({ mean_luma: 0.38 });
        expect(JSON.parse(row.capture_quality_json)).toMatchObject({ decoded_fps: 15.8 });
    });

    it('hydrates the shared blocks back out through GET /emotion-records', async () => {
        const res = await fetch(
            `${server.baseUrl}/api/addons/oyon/emotion-records?session_id=${sessionId}`,
            { headers: { Authorization: `Bearer ${adminTok}` } });
        const body = await res.json();
        const withBlocks = body.records.find(r => r.heart_rate != null);
        expect(withBlocks).toBeDefined();
        expect(withBlocks.heart_rate).toMatchObject({ bpm: 74 });
        expect(withBlocks.facial).toMatchObject({ facing_screen_ratio: 0.9 });
    });

    it('accepts v4 windows that declare `modality` explicitly, including episodes', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(sessionId, 'typing', { keystrokes: 120, mean_iki_ms: 180 }, 'episode'),
            modalityWindow(sessionId, 'respiration', { brpm: 14, confidence: 0.5 }),
            modalityWindow(sessionId, 'illumination', { mean_luma: 0.42 }),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(0);
        expect(body.signals_inserted).toBe(3);

        const db = await openDb(server.dbPath);
        const episode = await dbGet(db,
            `SELECT modality, window_kind, payload_json FROM oyon_signal_windows
             WHERE modality = 'typing' ORDER BY id DESC LIMIT 1`);
        await dbClose(db);
        expect(episode.window_kind).toBe('episode');
        expect(JSON.parse(episode.payload_json)).toMatchObject({ keystrokes: 120, mean_iki_ms: 180 });
    });

    // Regression lock: a 20 KB ceiling for every window rejected any typing
    // episode over ~180 keystrokes — and the whole batch with it. The window
    // here is produced by Oyon's real aggregator at rohy's retention cap, with
    // more keystrokes than the cap, so it is the largest window a client sends.
    it('accepts the largest typing window the client can produce', async () => {
        const aggregator = new TypingAggregator({ maxIntervals: TYPING_MAX_INTERVALS });
        let t = 1000;
        aggregator.start({ timestamp: t });
        for (let i = 0; i < TYPING_MAX_INTERVALS + 500; i += 1) {
            t += 90 + (i % 7) * 20;
            aggregator.record({
                timestamp: t, wallTimestamp: 1.79e12 + t, inputType: 'insertText',
                previousGraphemes: i, currentGraphemes: i + 1, caretOffset: i + 1,
                previousWords: Math.floor(i / 5), currentWords: Math.floor((i + 1) / 5),
                boundaryContext: i % 5 === 0 ? 'word_boundary' : 'mid_word',
            });
        }
        const { typing } = aggregator.finalize({ timestamp: t + 400, reason: 'submitted' });
        // Own bounds, not windowBounds(): that shared counter steps 20 s per call
        // and later tests in this file rely on staying inside their sessions.
        const start = Date.now() - 5 * 60_000;
        const window = {
            ...ENVELOPE,
            session_id: String(sessionId),
            modality: 'typing',
            window_kind: 'episode',
            window_start: new Date(start).toISOString(),
            window_end: new Date(start + 250_000).toISOString(),
            typing,
        };
        expect(JSON.stringify(window).length).toBeGreaterThan(200_000);

        const { status, body } = await postBatch(server, studentTok, [window]);
        expect(status, JSON.stringify(body).slice(0, 300)).toBe(200);
        expect(body.signals_inserted).toBe(1);
    });

    // Oyon's own validateEmotionBatch rejects an unrecognised `modality` at the
    // boundary, so the batch never reaches resolveModality — the handler's
    // unknown-modality guard is defence-in-depth behind it, not the active path.
    // What matters here is the observable contract: rejected, and nothing stored.
    it('rejects an unknown modality rather than storing it', async () => {
        const before = await countRows(server.dbPath, 'oyon_signal_windows');
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(sessionId, 'telepathy', { vibes: 1 }),
        ]);
        expect(status).toBe(400);
        expect(JSON.stringify(body)).toMatch(/modality/i);
        expect(await countRows(server.dbPath, 'oyon_signal_windows')).toBe(before);
    });

    // The dedup key includes modality precisely because of this collision.
    it('keeps an emotion window and a same-bounds facial window as separate rows', async () => {
        const bounds = windowBounds();
        const { status, body } = await postBatch(server, studentTok, [
            { ...ENVELOPE, ...bounds, session_id: String(sessionId), dominant_emotion: 'sad',
              probabilities: { sad: 1 }, confidence: 0.8, valid_frames: 6, missing_face_ratio: 0 },
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 9 } }, bounds),
            modalityOnlyWindow(sessionId, 'posture_only', { posture: { slump_ratio: 0.4 } }, bounds),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.signals_inserted).toBe(2); // same bounds, different modalities
    });

    it('is idempotent on replay — a repeated batch inserts nothing new', async () => {
        const events = [
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 5 } }),
            modalityWindow(sessionId, 'interaction', { clicks: 12, scroll_px: 900 }),
        ];
        const first = await postBatch(server, studentTok, events);
        expect(first.body.signals_inserted).toBe(2);

        const before = await countRows(server.dbPath, 'oyon_signal_windows');
        const replay = await postBatch(server, studentTok, events);
        expect(replay.body.signals_inserted).toBe(0);
        expect(replay.body.signals_skipped).toBe(2);
        expect(await countRows(server.dbPath, 'oyon_signal_windows')).toBe(before);
    });

    describe('GET /api/addons/oyon/signal-windows', () => {
        it('applies the same access policy as /emotion-records', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const asStudent = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows`, {
                headers: { Authorization: `Bearer ${studentTok}` },
            });
            expect(asStudent.status).toBe(403);
            expect((await asStudent.json()).code).toBe('oyon_role_required');

            const asEducator = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(asEducator.status).toBe(200);

            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 0, student: 1 });
            const educatorOff = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(educatorOff.status).toBe(403);
            expect((await educatorOff.json()).code).toBe('oyon_view_disabled');
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
        });

        it('filters by modality and reports which modalities hold data', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows?modality=facial`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.windows.length).toBeGreaterThan(0);
            expect(body.windows.every(w => w.modality === 'facial')).toBe(true);
            expect(body.windows[0].payload).toBeTypeOf('object');
            expect(body.modalities).toEqual([{ modality: 'facial', count: body.total }]);
        });

        it('rejects an unknown modality filter', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows?modality=telepathy`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('oyon_unknown_modality');
        });
    });

    // The whole point of the separate table: existing surfaces cannot shift.
    it('leaves GET /emotion-records unable to see modality windows', async () => {
        const res = await fetch(
            `${server.baseUrl}/api/addons/oyon/emotion-records?session_id=${sessionId}`,
            { headers: { Authorization: `Bearer ${adminTok}` } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.records.length).toBeGreaterThan(0);
        expect(body.records.every(r => r.dominant_emotion != null)).toBe(true);
        expect(body.records.every(r => r.modality === undefined)).toBe(true);
    });
});

// Consent v2 gate (migration 0041).
//
// typing/interaction/discourse/ai_assist are new CATEGORIES of personal data —
// keystroke timing, page-wide pointer telemetry, message-text analysis — not
// more camera-derived affect. `oyon-consent-v1` describes none of them, so a
// learner who accepted v1 has not agreed to them. Enforced on INGEST, not just
// at the client prompt, so a stale client cannot deposit them anyway.
describe('consent v2 gate for host-driven modalities', () => {
    let server, studentTok, v1Session, v2Session;

    async function seedSession(db, userId, acceptedVersion) {
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [userId]);
        const s = await dbGet(db,
            'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
             VALUES ('1', ?, ?, 1, 'oyon-consent-v2', ?)`,
            [String(userId), String(s.id), acceptedVersion]);
        return s.id;
    }

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES ('cg_stu', 'cg_stu', ?, 'cg@example.com', 'student', 'active', 1)`, [pwd]);
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['cg_stu']);
        v1Session = await seedSession(db, stu.id, 'oyon-consent-v1');
        v2Session = await seedSession(db, stu.id, 'oyon-consent-v2');
        await dbClose(db);
        studentTok = tokenFor({ id: stu.id, username: 'cg_stu', role: 'student', tenant_id: 1 }, 'cg-s');
        await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('drops v2-only modalities for a learner who accepted only v1', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(v1Session, 'typing', { keystrokes: 40 }, 'episode'),
            modalityWindow(v1Session, 'interaction', { clicks: 3 }),
            modalityWindow(v1Session, 'discourse', { moves: 2 }),
        ]);
        expect(status).toBe(200);
        expect(body.signals_inserted).toBe(0);
        // Reported, not silent — a client seeing this knows its prompt is stale.
        expect(body.signals_consent_blocked).toBe(3);
    });

    // The gate must be narrow: v1 still fully covers camera-derived affect.
    it('still accepts camera modalities under v1 consent', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityOnlyWindow(v1Session, 'facial_only', { facial: { head_yaw_deg: 2 } }),
            modalityWindow(v1Session, 'illumination', { mean_luma: 0.4 }),
        ]);
        expect(status).toBe(200);
        expect(body.signals_inserted).toBe(2);
        expect(body.signals_consent_blocked).toBe(0);
    });

    it('accepts v2-only modalities once the learner has accepted v2', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(v2Session, 'typing', { keystrokes: 40 }, 'episode'),
            modalityWindow(v2Session, 'interaction', { clicks: 3 }),
        ]);
        expect(status).toBe(200);
        expect(body.signals_inserted).toBe(2);
        expect(body.signals_consent_blocked).toBe(0);
    });

    // A mixed batch must still store what IS permitted.
    it('drops only the uncovered windows, keeping the rest of the batch', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            emotionWindow(v1Session),
            modalityOnlyWindow(v1Session, 'heart_rate_only', { heart_rate: { bpm: 70 } }),
            modalityWindow(v1Session, 'typing', { keystrokes: 12 }, 'episode'),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(1);              // emotion window kept
        expect(body.signals_inserted).toBe(1);      // heart_rate kept (v1 covers it)
        expect(body.signals_consent_blocked).toBe(1); // typing dropped
    });

    // A pre-0041 consent row has no accepted_version; it must read as v1, never
    // as "whatever the tenant advertises now".
    it('treats a legacy consent row with no accepted_version as v1', async () => {
        const db = await openDb(server.dbPath);
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['cg_stu']);
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [stu.id]);
        const s = await dbGet(db,
            'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [stu.id]);
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version)
             VALUES ('1', ?, ?, 1, 'oyon-consent-v2')`,
            [String(stu.id), String(s.id)]);
        await dbClose(db);

        const { body } = await postBatch(server, studentTok, [
            modalityWindow(s.id, 'typing', { keystrokes: 5 }, 'episode'),
        ]);
        expect(body.signals_inserted).toBe(0);
        expect(body.signals_consent_blocked).toBe(1);
    });
});

// Consent v3 gate for voice (migration 0057).
//
// Regression lock: 0041 put `voice` and `ai_assist` in the consent-v2 set, but
// the v2 card lists only typing, interaction and discourse. Accepting v2 therefore
// authorized microphone capture from a card that never mentions audio. Each
// modality now maps to the oldest contract that NAMES it, and voice needs v3.
describe('consent v3 gate for voice', () => {
    let server, studentTok, v2Session, v3Session;

    async function seedSession(db, userId, acceptedVersion) {
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [userId]);
        const s = await dbGet(db,
            'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
             VALUES ('1', ?, ?, 1, ?, ?)`,
            [String(userId), String(s.id), acceptedVersion, acceptedVersion]);
        return s.id;
    }

    // Sets both host-driven flags that raise the contract to v3, so a test
    // controls exactly one variable. setOyonViewFlags uses INSERT OR REPLACE
    // with a partial column list, which rebuilds the row from COLUMN defaults
    // (ai_assist_enabled DEFAULT 1) — bypassing ensureSettings entirely.
    async function setV3Flags({ voice, aiAssist = false }) {
        const db = await openDb(server.dbPath);
        await dbRun(db,
            'UPDATE oyon_settings SET voice_enabled = ?, ai_assist_enabled = ? WHERE tenant_id = ?',
            [voice ? 1 : 0, aiAssist ? 1 : 0, '1']);
        await dbClose(db);
    }

    async function getConfig() {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/config`, {
            headers: { Authorization: `Bearer ${studentTok}` },
        });
        return res.json();
    }

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES ('v3_stu', 'v3_stu', ?, 'v3@example.com', 'student', 'active', 1)`, [pwd]);
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['v3_stu']);
        v2Session = await seedSession(db, stu.id, 'oyon-consent-v2');
        v3Session = await seedSession(db, stu.id, 'oyon-consent-v3');
        await dbClose(db);
        studentTok = tokenFor({ id: stu.id, username: 'v3_stu', role: 'student', tenant_id: 1 }, 'v3-s');
        await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('refuses voice for a learner who accepted only v2', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(v2Session, 'voice', { speech_ratio: 0.6, pitch_median_hz: 180 }, 'episode'),
        ]);
        expect(status).toBe(200);
        expect(body.signals_inserted).toBe(0);
        expect(body.signals_consent_blocked).toBe(1);
    });

    // The split must be narrow: v2 still fully covers what its card names.
    it('still accepts typing, interaction and discourse under v2', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(v2Session, 'typing', { keystrokes: 40 }, 'episode'),
            modalityWindow(v2Session, 'interaction', { clicks: 3 }),
            modalityWindow(v2Session, 'discourse', { moves: 2 }),
        ]);
        expect(status).toBe(200);
        expect(body.signals_inserted).toBe(3);
        expect(body.signals_consent_blocked).toBe(0);
    });

    it('accepts voice once the learner has accepted v3', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(v3Session, 'voice', { speech_ratio: 0.6, pitch_median_hz: 180 }, 'episode'),
        ]);
        expect(status).toBe(200);
        expect(body.signals_inserted).toBe(1);
        expect(body.signals_consent_blocked).toBe(0);
    });

    // The v3 card promises the audio recording is never kept. Oyon's own raw-media
    // denylist names video and image fields and no audio field, so this is the
    // only thing that enforces that promise on the server.
    it('rejects a voice window that carries raw audio, even under v3', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(v3Session, 'voice', { speech_ratio: 0.6, waveform: [0.01, -0.02, 0.03] }, 'episode'),
        ]);
        expect(status).toBe(400);
        expect(body.code).toBe('oyon_raw_audio_forbidden');
        expect(body.field).toBe('waveform');
    });

    // A tenant asks for the contract its ENABLED modalities need, so the prompt
    // always names what will actually be captured.
    it('asks for v2 while voice is off, and v3 once an admin turns voice on', async () => {
        await setV3Flags({ voice: false });
        expect((await getConfig()).consent_version).toBe('oyon-consent-v2');

        await setV3Flags({ voice: true });
        expect((await getConfig()).consent_version).toBe('oyon-consent-v3');
    });

    it('asks for v3 when ai_assist is on, since v2 does not name it either', async () => {
        await setV3Flags({ voice: false, aiAssist: true });
        expect((await getConfig()).consent_version).toBe('oyon-consent-v3');
        await setV3Flags({ voice: false });
    });

    // The admin toggle has to work through the real PUT, and PUT /settings is a
    // KEY-PRESENCE merge for signal flags: sending only voice_enabled must turn
    // voice on and leave every other signal exactly as it was.
    it('lets an admin turn voice on without disturbing the other signals', async () => {
        const adminTok = tokenFor({ id: 1, username: 'admin', role: 'admin', tenant_id: 1 }, 'v3-admin');
        await setV3Flags({ voice: false });
        const db0 = await openDb(server.dbPath);
        await dbRun(db0, 'UPDATE oyon_settings SET typing_enabled = 1 WHERE tenant_id = ?', ['1']);
        await dbClose(db0);

        const res = await fetch(`${server.baseUrl}/api/addons/oyon/settings`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ emotion_capture_enabled: true, voice_enabled: true }),
        });
        expect(res.status).toBe(200);

        const db = await openDb(server.dbPath);
        const row = await dbGet(db, 'SELECT voice_enabled, typing_enabled FROM oyon_settings WHERE tenant_id = ?', ['1']);
        await dbClose(db);
        expect(row.voice_enabled).toBe(1);
        expect(row.typing_enabled).toBe(1);
        expect((await getConfig()).consent_version).toBe('oyon-consent-v3');
        await setV3Flags({ voice: false });
    });

    // Regression lock: 0057's UPDATE only turns off rows that EXIST. A tenant
    // row created afterwards takes ai_assist_enabled's column DEFAULT of 1 — so
    // ensureSettings names both flags explicitly. Delete the row and let the
    // real inserter (via /config) recreate it, exactly as a fresh tenant would.
    it('creates a fresh tenant with voice off and ai_assist off', async () => {
        let db = await openDb(server.dbPath);
        await dbRun(db, 'DELETE FROM oyon_settings WHERE tenant_id = ?', ['1']);
        await dbClose(db);

        const config = await getConfig();

        db = await openDb(server.dbPath);
        const row = await dbGet(db,
            'SELECT voice_enabled, ai_assist_enabled FROM oyon_settings WHERE tenant_id = ?', ['1']);
        await dbClose(db);
        expect(row.voice_enabled).toBe(0);
        expect(row.ai_assist_enabled).toBe(0);
        // …and so a fresh tenant asks only for what its card can name.
        expect(config.consent_version).not.toBe('oyon-consent-v3');
    });
});

// Regression lock: the session consent row records what the SERVER holds.
//
// POST /consent used to store `accepted_version` from the request body, which
// the client fills from localStorage. A learner who accepted v2 on one device
// and opened Rohy on another sent nothing, was recorded as v1, and had every
// typing window silently dropped — while the client gate, reading server
// preferences, kept capturing. And a client that SENT a version was believed.
describe('session consent row is server-authoritative', () => {
    let server, tok, userId;

    // Explicit, recent bounds. The file-wide windowBounds() computes
    // `now - (600_000 - windowSeq * 20_000)` from a counter every call bumps, so
    // after ~30 windows its start moves INTO THE FUTURE and the server rejects
    // the window as outside the session. Tests added at the end of this file
    // inherit that drift; pin the bounds instead of depending on call order.
    function recentWindow(sessionId, modality, payload) {
        const start = new Date(Date.now() - 60_000);
        return {
            ...modalityWindow(sessionId, modality, payload, 'episode'),
            window_start: start.toISOString(),
            window_end: new Date(start.getTime() + 10_000).toISOString(),
        };
    }

    async function setPrefs(onboarding) {
        const db = await openDb(server.dbPath);
        await dbRun(db, 'DELETE FROM user_preferences WHERE user_id = ?', [userId]);
        await dbRun(db,
            'INSERT INTO user_preferences (user_id, tenant_id, onboarding_settings) VALUES (?, 1, ?)',
            [userId, JSON.stringify(onboarding)]);
        await dbClose(db);
    }

    async function newSession() {
        const db = await openDb(server.dbPath);
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [userId]);
        const s = await dbGet(db, 'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        await dbClose(db);
        return s.id;
    }

    async function postConsent(sessionId, body = {}) {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/consent`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: String(sessionId), consent_granted: true, ...body }),
        });
        expect(res.status).toBe(200);
    }

    async function recordedVersion(sessionId) {
        const db = await openDb(server.dbPath);
        const row = await dbGet(db,
            'SELECT accepted_version FROM oyon_emotion_consents WHERE session_id = ? ORDER BY id DESC LIMIT 1',
            [String(sessionId)]);
        await dbClose(db);
        return row.accepted_version;
    }

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES ('xd_stu', 'xd_stu', ?, 'xd@example.com', 'student', 'active', 1)`, [pwd]);
        userId = (await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['xd_stu'])).id;
        await dbClose(db);
        tok = tokenFor({ id: userId, username: 'xd_stu', role: 'student', tenant_id: 1 }, 'xd-s');
        await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('records v2 on a device that sends no version, and keeps its typing', async () => {
        await setPrefs({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' });
        const sid = await newSession();
        await postConsent(sid);                 // a fresh device: no accepted_version in the body

        expect(await recordedVersion(sid)).toBe('oyon-consent-v2');
        const { status, body } = await postBatch(server, tok, [
            recentWindow(sid, 'typing', { keystrokes: 30 }),
        ]);
        expect(status, JSON.stringify(body)).toBe(200);
        expect(body.signals_inserted).toBe(1);
        expect(body.signals_consent_blocked).toBe(0);
    });

    it('ignores a version the client claims but the learner never accepted', async () => {
        await setPrefs({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' });
        const sid = await newSession();
        await postConsent(sid, { accepted_version: 'oyon-consent-v3' });

        expect(await recordedVersion(sid)).toBe('oyon-consent-v1');
        const { body } = await postBatch(server, tok, [
            recentWindow(sid, 'voice', { speech_ratio: 0.5 }),
        ]);
        expect(body.signals_inserted).toBe(0);
        expect(body.signals_consent_blocked).toBe(1);
    });

    it('records camera-only for a learner who has not said yes', async () => {
        await setPrefs({ oyon_consent: false });
        const sid = await newSession();
        await postConsent(sid, { accepted_version: 'oyon-consent-v2' });
        expect(await recordedVersion(sid)).toBe('oyon-consent-v1');
    });
});
