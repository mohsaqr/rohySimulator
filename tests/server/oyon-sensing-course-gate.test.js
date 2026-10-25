// Oyon course gate (owner decision 2026-10-25): sensing is controlled per
// COURSE by the teacher. A learner may be sensed only when the tenant switch
// is on AND they are an active member of a live, in-window course in their own
// tenant whose settings say `oyon_sensing_enabled: true`. Staff keep the
// tenant switch only. Rule: server/lib/oyonSensingGate.js.
//
// Regression lock: GET /config `enabled` follows the rule for learners; every
// learner write endpoint (emotion records, signal events, consent grant)
// refuses with 403 sensing_not_enabled_for_course BEFORE writing; the
// own-data read/delete is never gated; a course in another tenant never opens
// the gate.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { mintToken, openDb, closeDb, run, get } from '../utils/authHttp.js';
import { enrollInSensingCourse } from '../utils/oyonCourse.js';

const SECRET = 'oyon-course-gate-tests-secret';
const GATE = 'sensing_not_enabled_for_course';

describe('Oyon course gate', () => {
    let server;
    let stuTok, eduTok;
    let stuId, eduId;
    let sessionId;
    let seq = 0;

    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const sql = (q, p = []) => withDb((db) => run(db, q, p));
    const call = async (tok, method, path, body) => {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon${path}`, {
            method,
            headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() };
    };
    const config = async (tok = stuTok) => (await call(tok, 'GET', '/config')).body;
    const counts = () => withDb(async (db) => ({
        records: (await get(db, 'SELECT COUNT(*) AS n FROM oyon_emotion_records WHERE user_id = ?', [String(stuId)])).n,
        windows: (await get(db, 'SELECT COUNT(*) AS n FROM oyon_signal_windows WHERE user_id = ?', [String(stuId)])).n,
        events: (await get(db, 'SELECT COUNT(*) AS n FROM oyon_signal_events WHERE user_id = ?', [String(stuId)])).n,
        consents: (await get(db, 'SELECT COUNT(*) AS n FROM oyon_emotion_consents WHERE user_id = ?', [String(stuId)])).n,
    }));

    const emotionBatch = () => {
        seq += 1;
        const now = Date.now();
        return {
            session_id: sessionId,
            events: [{
                session_id: String(sessionId),
                record_id: `gate-rec-${seq}`,
                window_start: new Date(now - 10000).toISOString(),
                window_end: new Date(now - 5000).toISOString(),
                capture_mode: 'local-browser',
                consent_version: 'oyon-consent-v3',
                valid_frames: 5,
                missing_face_ratio: 0.1,
                confidence: 0.8,
                dominant_emotion: 'neutral',
            }],
        };
    };
    const signalBatch = () => {
        seq += 1;
        return {
            session_id: String(sessionId),
            events: [{ capture_id: `gate-cap-${seq}`, sequence_index: 1, modality: 'typing', state: 'insert', source: 'user', timestamp: Date.now() - 30_000 }],
        };
    };

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        await withDb(async (db) => {
            const pwd = await bcrypt.hash('x', 4);
            await run(db, `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'other', 'Other tenant')`);
            for (const [u, role] of [['gate_stu', 'student'], ['gate_edu', 'educator']]) {
                await run(db, `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                               VALUES (?, ?, ?, ?, ?, 'active', 1)`, [u, u, pwd, `${u}@example.com`, role]);
            }
            stuId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['gate_stu'])).id;
            eduId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['gate_edu'])).id;
            await run(db, `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                           VALUES (?, 1, datetime('now', '-1 hour'), 1)`, [stuId]);
            sessionId = (await get(db, 'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [stuId])).id;
            await run(db, `INSERT INTO oyon_emotion_consents
                               (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
                           VALUES ('1', ?, ?, 1, 'oyon-consent-v3', 'oyon-consent-v3')`, [String(stuId), String(sessionId)]);
            // Tenant switch ON with every modality the batches use.
            await run(db, `INSERT OR REPLACE INTO oyon_settings (tenant_id, emotion_capture_enabled, admin_emotion_view_enabled,
                               educator_emotion_view_enabled, student_emotion_view_enabled, model_profile, sample_interval_ms, window_ms,
                               min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence, typing_enabled)
                           VALUES ('1', 1, 1, 1, 1, 'hse-emotion-mtl', 500, 10000, 3, 0.28, 3000, 0.5, 1)`);
            // Seeded noise that must NOT open the gate: a course in ANOTHER
            // tenant enabling sensing (same user id), and a course in this
            // tenant that does not enable it.
            await enrollInSensingCourse(db, stuId, { tenant: 2, name: 'foreign-course' });
            await enrollInSensingCourse(db, stuId, { settings: { oyon_sensing_enabled: false }, name: 'plain-course' });
        });
        stuTok = await mintToken(server.dbPath, { id: stuId, username: 'gate_stu', role: 'student', tenant_id: 1 }, SECRET, { jti: 'gs' });
        eduTok = await mintToken(server.dbPath, { id: eduId, username: 'gate_edu', role: 'educator', tenant_id: 1 }, SECRET, { jti: 'ge' });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('config: a learner with the tenant on but no enabling course is not sensed (other-tenant course ignored)', async () => {
        const cfg = await config();
        expect(cfg.enabled).toBe(false);
        expect(cfg.course_sensing_required).toBe(true);
        expect(cfg.course_sensing_enabled).toBe(false);
    });

    it('config: staff keep the tenant switch only', async () => {
        const cfg = await config(eduTok);
        expect(cfg.enabled).toBe(true);
        expect(cfg.course_sensing_required).toBe(false);
        expect(cfg.course_sensing_enabled).toBeNull();
    });

    it('every learner write endpoint refuses with sensing_not_enabled_for_course and writes nothing', async () => {
        const before = await counts();
        const rec = await call(stuTok, 'POST', '/emotion-records', emotionBatch());
        expect(rec.status).toBe(403);
        expect(rec.body.code).toBe(GATE);
        const ev = await call(stuTok, 'POST', '/signal-events', signalBatch());
        expect(ev.status).toBe(403);
        expect(ev.body.code).toBe(GATE);
        const consent = await call(stuTok, 'POST', '/consent', { session_id: sessionId, consent_granted: true });
        expect(consent.status).toBe(403);
        expect(consent.body.code).toBe(GATE);
        expect(await counts()).toEqual(before);
    });

    it('a consent WITHDRAWAL is still recorded while the gate is closed', async () => {
        const before = await counts();
        const res = await call(stuTok, 'POST', '/consent', { session_id: sessionId, consent_granted: false });
        expect(res.status).toBe(200);
        expect((await counts()).consents).toBe(before.consents + 1);
        // Re-grant directly so later ingest has a granted consent as the latest row.
        await sql(`INSERT INTO oyon_emotion_consents
                       (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
                   VALUES ('1', ?, ?, 1, 'oyon-consent-v3', 'oyon-consent-v3')`, [String(stuId), String(sessionId)]);
    });

    it('own-data read and delete are never gated', async () => {
        const read = await call(stuTok, 'GET', '/student/me/data');
        expect(read.status).toBe(200);
        expect(read.body).toHaveProperty('total');
        const del = await call(stuTok, 'DELETE', '/student/me/data', { confirm: true });
        expect(del.status).toBe(200);
    });

    describe('once enrolled in an active course that enables sensing', () => {
        let courseId;
        beforeAll(async () => {
            courseId = await withDb((db) => enrollInSensingCourse(db, stuId, { ownerId: eduId, name: 'sensing-course' }));
        });

        it('config opens and every write endpoint accepts', async () => {
            const cfg = await config();
            expect(cfg.enabled).toBe(true);
            expect(cfg.course_sensing_enabled).toBe(true);
            expect((await call(stuTok, 'POST', '/emotion-records', emotionBatch())).status).toBe(200);
            expect((await call(stuTok, 'POST', '/signal-events', signalBatch())).status).toBe(200);
            expect((await call(stuTok, 'POST', '/consent', { session_id: sessionId, consent_granted: true })).status).toBe(200);
        });

        it('closes again when the course has ended, and reopens with the window', async () => {
            await sql(`UPDATE cohorts SET ends_at = '2020-01-01' WHERE id = ?`, [courseId]);
            expect((await config()).enabled).toBe(false);
            expect((await call(stuTok, 'POST', '/signal-events', signalBatch())).body.code).toBe(GATE);
            await sql(`UPDATE cohorts SET ends_at = NULL, starts_at = datetime('now', '+7 days') WHERE id = ?`, [courseId]);
            expect((await config()).enabled).toBe(false);
            await sql(`UPDATE cohorts SET starts_at = NULL WHERE id = ?`, [courseId]);
            expect((await config()).enabled).toBe(true);
        });

        it('closes when the course is deleted', async () => {
            await sql(`UPDATE cohorts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [courseId]);
            expect((await config()).enabled).toBe(false);
            await sql(`UPDATE cohorts SET deleted_at = NULL WHERE id = ?`, [courseId]);
            expect((await config()).enabled).toBe(true);
        });

        it('closes when the teacher turns sensing off in the course', async () => {
            await sql(`UPDATE cohorts SET settings = ? WHERE id = ?`, [JSON.stringify({ oyon_sensing_enabled: false }), courseId]);
            expect((await config()).enabled).toBe(false);
            await sql(`UPDATE cohorts SET settings = ? WHERE id = ?`, [JSON.stringify({ oyon_sensing_enabled: true }), courseId]);
            expect((await config()).enabled).toBe(true);
        });

        it('closes when the tenant switch is off, course or not', async () => {
            await sql(`UPDATE oyon_settings SET emotion_capture_enabled = 0 WHERE tenant_id = '1'`);
            const cfg = await config();
            expect(cfg.enabled).toBe(false);
            expect(cfg.course_sensing_enabled).toBe(true);
            await sql(`UPDATE oyon_settings SET emotion_capture_enabled = 1 WHERE tenant_id = '1'`);
        });

        it('closes when the learner is removed from the course', async () => {
            await sql(`UPDATE cohort_members SET deleted_at = CURRENT_TIMESTAMP WHERE cohort_id = ? AND user_id = ?`, [courseId, stuId]);
            expect((await config()).enabled).toBe(false);
            const before = await counts();
            expect((await call(stuTok, 'POST', '/emotion-records', emotionBatch())).body.code).toBe(GATE);
            expect(await counts()).toEqual(before);
        });
    });
});
