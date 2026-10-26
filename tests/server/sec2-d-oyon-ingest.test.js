// Security fix pass 2026-10-26, lane D — Oyon ingest.
//
// Regression lock: heart rate and respiration (rPPG) defaulted ON and were stored under the camera consent, which names neither (F-04). Fresh tenants start with both off, and ingest stores them only with the tenant switch on AND the learner's separate physiological consent (onboarding_settings.oyon_consent_physio).
// Regression lock: the per-modality switches reached only the browser; ingest stored every block and window a client sent (F-34 / L7-07).
// Regression lock: the course sensing gate asked "is the learner in ANY sensing course", so course A's choice reached course B's cases, and course_id / cohort_id were taken from the client (L7-08).
// Regression lock: a consent GRANT was recorded whatever the account's own consent record said, so a previous user's browser flag opened capture for the next person (L5-03); and a withdrawal in Settings did not stop ingest for a still-open session (L7-16).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, seedUser, mintToken } from '../utils/authHttp.js';

const SECRET = 'sec2-d-oyon-secret';
const GATE = 'sensing_not_enabled_for_course';

describe('Oyon ingest policy (lane D)', () => {
    let server;
    let stuId, stuTok;
    let courseA, sessionA, sessionB;
    let seq = 0;

    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const call = async (method, path, body) => {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon${path}`, {
            method,
            headers: { Authorization: `Bearer ${stuTok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() };
    };
    const setPrefs = (onboarding) => withDb(async (db) => {
        await run(db, 'DELETE FROM user_preferences WHERE user_id = ?', [stuId]);
        await run(db, 'INSERT INTO user_preferences (user_id, tenant_id, onboarding_settings) VALUES (?, 1, ?)', [stuId, JSON.stringify(onboarding)]);
    });
    const bounds = () => {
        seq += 1;
        const start = Date.now() - 20 * 60_000 + seq * 15_000;
        return { window_start: new Date(start).toISOString(), window_end: new Date(start + 10_000).toISOString() };
    };
    const emotionWindow = (sid, extra = {}) => ({
        capture_mode: 'local-browser', consent_version: 'oyon-consent-v3', ...bounds(),
        session_id: String(sid), record_id: `d-oyon-${seq}`,
        dominant_emotion: 'neutral', probabilities: { neutral: 1 }, confidence: 0.8, valid_frames: 8, missing_face_ratio: 0,
        ...extra,
    });
    const recordById = (recordId) => withDb((db) => get(db, 'SELECT * FROM oyon_emotion_records WHERE record_id = ?', [recordId]));

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        await withDb(async (db) => {
            stuId = await seedUser(db, { username: 'd_oy_stu' });
            const caseA = (await run(db, `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES ('A', '', 'p', '{}', 1)`)).lastID;
            const caseB = (await run(db, `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES ('B', '', 'p', '{}', 1)`)).lastID;
            courseA = (await run(db, `INSERT INTO cohorts (name, owner_user_id, tenant_id, settings) VALUES ('Course A', ?, 1, ?)`,
                [stuId, JSON.stringify({ oyon_sensing_enabled: true })])).lastID;
            const courseB = (await run(db, `INSERT INTO cohorts (name, owner_user_id, tenant_id, settings) VALUES ('Course B', ?, 1, ?)`,
                [stuId, JSON.stringify({ oyon_sensing_enabled: false })])).lastID;
            for (const [cohort, cs] of [[courseA, caseA], [courseB, caseB]]) {
                await run(db, 'INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)', [cohort, stuId]);
                await run(db, 'INSERT INTO cohort_cases (cohort_id, case_id) VALUES (?, ?)', [cohort, cs]);
            }
            const session = async (cs) => {
                const id = (await run(db, `INSERT INTO sessions (user_id, case_id, start_time, tenant_id) VALUES (?, ?, datetime('now', '-1 hour'), 1)`, [stuId, cs])).lastID;
                await run(db, `INSERT INTO oyon_emotion_consents (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
                               VALUES ('1', ?, ?, 1, 'oyon-consent-v3', 'oyon-consent-v3')`, [String(stuId), String(id)]);
                return id;
            };
            sessionA = await session(caseA);
            sessionB = await session(caseB);
        });
        stuTok = await mintToken(server.dbPath, { id: stuId, username: 'd_oy_stu', role: 'student', tenant_id: 1 }, SECRET);
        await setPrefs({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' });
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('F-04: a fresh tenant starts with heart rate and respiration off', async () => {
        const cfg = await call('GET', '/config');
        expect(cfg.status).toBe(200);
        expect(cfg.body.runtime.heart_rate_enabled).toBe(false);
        expect(cfg.body.runtime.respiration_enabled).toBe(false);
        // Now switch capture on (and heart rate, to test the consent half), posture stays off.
        await withDb((db) => run(db, `UPDATE oyon_settings SET emotion_capture_enabled = 1, heart_rate_enabled = 1, respiration_enabled = 1,
                                        posture_tracking_enabled = 0, typing_enabled = 0 WHERE tenant_id = '1'`));
    });

    it('F-04: heart rate and respiration are dropped without the physiological consent, even with the switch on', async () => {
        const w = emotionWindow(sessionA, { heart_rate: { bpm: 74, confidence: 0.6 }, respiration: { brpm: 13 }, posture: { slump_ratio: 0.2 } });
        const res = await call('POST', '/emotion-records', {
            session_id: sessionA,
            events: [w, { capture_mode: 'local-browser', consent_version: 'oyon-consent-v3', ...bounds(), session_id: String(sessionA), heart_rate_only: true, heart_rate: { bpm: 70 } }],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.inserted).toBe(1);
        expect(res.body.signals_inserted).toBe(0);
        expect(res.body.signals_modality_blocked).toBe(1);
        const row = await recordById(w.record_id);
        expect(row.heart_rate_json).toBeNull();
        expect(row.respiration_json).toBeNull();
        expect(row.posture_json).toBeNull();          // F-34: posture switch is off
        expect(row.dominant_emotion).toBe('neutral'); // the record itself is kept
    });

    it('F-04: with the physiological consent on record they are stored', async () => {
        await setPrefs({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v3', oyon_consent_physio: true });
        const w = emotionWindow(sessionA, { heart_rate: { bpm: 71, confidence: 0.6 } });
        const res = await call('POST', '/emotion-records', { session_id: sessionA, events: [w] });
        expect(res.status).toBe(200);
        expect(JSON.parse((await recordById(w.record_id)).heart_rate_json)).toMatchObject({ bpm: 71 });
        await setPrefs({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' });
    });

    it('L7-08: the course is the server\'s resolution of the session, never the client\'s ids', async () => {
        const w = emotionWindow(sessionA, { course_id: 999, cohort_id: 998, course_title: 'Forged', cohort_title: 'Forged' });
        const res = await call('POST', '/emotion-records', { session_id: sessionA, events: [w] });
        expect(res.status).toBe(200);
        const row = await recordById(w.record_id);
        expect(row.course_id).toBe(String(courseA));
        expect(row.cohort_id).toBe(String(courseA));
        expect(row.course_title_snapshot).toBe('Course A');
    });

    it('L7-08: a session whose case is taught in a course without sensing is refused, though another course enables it', async () => {
        const before = await withDb((db) => get(db, 'SELECT COUNT(*) AS n FROM oyon_emotion_records WHERE session_id = ?', [String(sessionB)]));
        const res = await call('POST', '/emotion-records', { session_id: sessionB, events: [emotionWindow(sessionB)] });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe(GATE);
        const after = await withDb((db) => get(db, 'SELECT COUNT(*) AS n FROM oyon_emotion_records WHERE session_id = ?', [String(sessionB)]));
        expect(after.n).toBe(before.n);
        const consent = await call('POST', '/consent', { session_id: sessionB, consent_granted: true });
        expect(consent.status).toBe(403);
        expect(consent.body.code).toBe(GATE);
    });

    it('F-34: signal events of a switched-off modality are dropped and counted', async () => {
        const res = await call('POST', '/signal-events', {
            session_id: String(sessionA),
            events: [{ capture_id: 'd-cap-1', sequence_index: 0, modality: 'typing', state: 'insert', source: 'user', timestamp: Date.now() - 60_000 }],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toMatchObject({ inserted: 0, modality_blocked: 1 });
    });

    // Regression lock: the educator/admin `q` search put the text into LIKE unescaped, so `%` matched every row (L7-18).
    it('L7-18: % and _ in the search text are literal, not wildcards', async () => {
        const adminTok = await withDb(async (db) => {
            const id = await seedUser(db, { username: 'd_oy_admin', role: 'admin' });
            return mintToken(db, { id, username: 'd_oy_admin', role: 'admin', tenant_id: 1 }, SECRET);
        });
        const search = async (q) => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${adminTok}` } });
            expect(res.status).toBe(200);
            return (await res.json()).total;
        };
        expect(await search('neutral')).toBeGreaterThan(0);
        expect(await search('%')).toBe(0);
        expect(await search('neutr_l')).toBe(0);   // unescaped, _ would match 'neutral'
    });

    it('L5-03: a consent grant is refused when the account has not consented', async () => {
        await setPrefs({ first_run_done: 1 });
        const res = await call('POST', '/consent', { session_id: sessionA, consent_granted: true });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('oyon_consent_not_on_record');
        // A withdrawal is always recorded.
        const no = await call('POST', '/consent', { session_id: sessionA, consent_granted: false });
        expect(no.status).toBe(200);
        expect(no.body.consent_granted).toBe(false);
    });

    it('L7-16: a withdrawal in the account settings stops ingest for a session still marked granted', async () => {
        await withDb((db) => run(db, `INSERT INTO oyon_emotion_consents (tenant_id, user_id, session_id, consent_granted, consent_version, accepted_version)
                                      VALUES ('1', ?, ?, 1, 'oyon-consent-v3', 'oyon-consent-v3')`, [String(stuId), String(sessionA)]));
        await setPrefs({ oyon_consent: false });
        const rec = await call('POST', '/emotion-records', { session_id: sessionA, events: [emotionWindow(sessionA)] });
        expect(rec.status).toBe(403);
        expect(rec.body.code).toBe('oyon_consent_withdrawn');
        const ev = await call('POST', '/signal-events', {
            session_id: String(sessionA),
            events: [{ capture_id: 'd-cap-2', sequence_index: 0, modality: 'typing', state: 'insert', source: 'user', timestamp: Date.now() - 60_000 }],
        });
        expect(ev.status).toBe(403);
        expect(ev.body.code).toBe('oyon_consent_withdrawn');
    });
});
