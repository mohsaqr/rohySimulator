// Oyon route contract tests.
//
// Pins three things the Codex adversarial review flagged as gaps:
//   - assertOyonReadAccess gates every educator+ Oyon read path with role +
//     per-role tenant view-enabled flag together; older code only checked one
//     of the two on /admin/live and let educators through unconditionally on
//     /emotion-records, which both blocked intended users and leaked data.
//   - Filter additions on /emotion-records (from/to/q/dominant/min_confidence/
//     max_missing_face_ratio) are parameterised against SQL injection.
//   - Analytics endpoints (/analytics/students, /analytics/cases,
//     /analytics/session/:id) sit behind the same helper.
//
// Tests use the real spawned server + sqlite seed pattern from
// retention-purge.test.js — no in-process app surgery.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const SECRET = 'oyon-routes-tests-secret';

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
                   'hse-emotion-mtl', 333, 10000, 6, 0.28, 3000, 0.5)`,
        [admin, educator, student]);
    await dbClose(db);
}

describe('assertOyonReadAccess across Oyon read endpoints', () => {
    let server;
    let adminTok, educatorTok, studentTok;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });

        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        for (const [u, role] of [['oroute_admin', 'admin'], ['oroute_edu', 'educator'], ['oroute_stu', 'student']]) {
            await dbRun(db,
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [u, u, pwd, `${u}@example.com`, role]);
        }
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_admin']);
        const edu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_edu']);
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_stu']);
        await dbClose(db);

        adminTok = tokenFor({ id: admin.id, username: 'oroute_admin', role: 'admin', tenant_id: 1 }, 'a');
        educatorTok = tokenFor({ id: edu.id, username: 'oroute_edu', role: 'educator', tenant_id: 1 }, 'e');
        studentTok = tokenFor({ id: stu.id, username: 'oroute_stu', role: 'student', tenant_id: 1 }, 's');
    });

    afterAll(async () => { if (server) await server.close(); });

    describe('GET /api/addons/oyon/emotion-records', () => {
        it('admin with admin_view_enabled=0 → 403', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 0, educator: 1, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.code).toBe('oyon_view_disabled');
        });

        it('educator with educator_view_enabled=0 → 403', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 0, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(res.status).toBe(403);
        });

        it('educator with educator_view_enabled=1 → 200', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(res.status).toBe(200);
        });

        it('student → 403 (must use /student/me instead)', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                headers: { Authorization: `Bearer ${studentTok}` },
            });
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.code).toBe('oyon_role_required');
        });
    });

    describe('GET /api/addons/oyon/emotion-records — filters + total + injection safety', () => {
        beforeAll(async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const db = await openDb(server.dbPath);
            // Seed a session and three records: recent happy, recent angry, ancient happy.
            await dbRun(db,
                `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                 VALUES (1, 1, datetime('now', '-1 hour'), 1)`);
            const sess = await dbGet(db, `SELECT id FROM sessions WHERE user_id = 1 ORDER BY id DESC LIMIT 1`);
            const seed = async (offset, dom, conf, missing, name = 'Alpha', caseTitle = 'Sepsis Case') => {
                await dbRun(db,
                    `INSERT INTO oyon_emotion_records
                        (tenant_id, user_id, session_id, window_start, window_end,
                         dominant_emotion, confidence, missing_face_ratio,
                         student_name_snapshot, case_title_snapshot,
                         capture_mode, consent_version)
                     VALUES ('1', '1', ?, datetime('now', ?), datetime('now', ?),
                             ?, ?, ?, ?, ?, 'local-browser', 'oyon-consent-v1')`,
                    [String(sess.id), offset, offset, dom, conf, missing, name, caseTitle]);
            };
            await seed('-30 minutes', 'happy', 0.9, 0.1);
            await seed('-25 minutes', 'angry', 0.7, 0.5, 'Beta', 'Trauma Case');
            await seed('-200 days', 'happy', 0.85, 0.05, 'Alpha', 'Sepsis Case');
            await dbClose(db);
        });

        it('returns {records, total} with total reflecting full filtered count', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?limit=2`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toHaveProperty('records');
            expect(body).toHaveProperty('total');
            expect(typeof body.total).toBe('number');
            expect(body.total).toBeGreaterThanOrEqual(3);
            expect(body.records.length).toBeLessThanOrEqual(2);
        });

        it('from/to narrow window_start range', async () => {
            const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?from=${encodeURIComponent(yesterdayIso)}&limit=100`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            // Ancient (-200 days) row excluded.
            for (const r of body.records) {
                expect(new Date(r.window_start + 'Z').getTime()).toBeGreaterThan(Date.parse(yesterdayIso));
            }
        });

        it("date-only `to=YYYY-MM-DD` includes records timestamped later that same day (Codex audit finding #3)", async () => {
            // Seed an extra record at 23:59 today, then ask for to=today.
            // String-LE bug would drop it; exclusive next-day fix keeps it.
            const db = await openDb(server.dbPath);
            const todayIso = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const sess = await dbGet(db, `SELECT id FROM sessions WHERE user_id = 1 ORDER BY id DESC LIMIT 1`);
            await dbRun(db,
                `INSERT INTO oyon_emotion_records
                    (tenant_id, user_id, session_id, window_start, window_end,
                     dominant_emotion, confidence, missing_face_ratio,
                     student_name_snapshot, case_title_snapshot,
                     capture_mode, consent_version)
                 VALUES ('1', '1', ?, ?, ?,
                         'happy', 0.95, 0.05, 'EndDay', 'EndDay Case',
                         'local-browser', 'oyon-consent-v1')`,
                [String(sess.id), `${todayIso}T23:59:00.000Z`, `${todayIso}T23:59:09.000Z`]);
            await dbClose(db);

            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?to=${todayIso}&q=EndDay&limit=10`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            const found = body.records.find(r => r.student_name_snapshot === 'EndDay');
            expect(found).toBeDefined();
        });

        it('q LIKE-matches student_name_snapshot', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?q=Beta&limit=50`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            const body = await res.json();
            expect(body.records.length).toBeGreaterThanOrEqual(1);
            for (const r of body.records) {
                const hit = r.student_name_snapshot?.includes('Beta')
                    || r.case_title_snapshot?.includes('Beta')
                    || r.username?.includes('Beta')
                    || r.dominant_emotion?.includes('Beta');
                expect(hit).toBe(true);
            }
        });

        it('q with SQL-injection payload returns zero rows (parameterised)', async () => {
            const payload = encodeURIComponent("' OR 1=1 --");
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?q=${payload}&limit=100`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            // If parameterisation worked, no row should match the literal needle.
            expect(body.records.length).toBe(0);
        });

        it('dominant filter restricts to allowlisted values', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?dominant=happy&limit=100`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            const body = await res.json();
            for (const r of body.records) {
                expect(r.dominant_emotion).toBe('happy');
            }
        });

        it('min_confidence filters out low-signal rows', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?min_confidence=0.8&limit=100`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            const body = await res.json();
            for (const r of body.records) {
                expect(r.confidence).toBeGreaterThanOrEqual(0.8);
            }
        });

        it('max_missing_face_ratio filters out high-missingness rows', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?max_missing_face_ratio=0.2&limit=100`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            const body = await res.json();
            for (const r of body.records) {
                expect(r.missing_face_ratio).toBeLessThanOrEqual(0.2);
            }
        });
    });

    describe('GET /api/addons/oyon/analytics/*', () => {
        beforeAll(async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
        });

        it('students aggregate returns sane shape and means', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/analytics/students`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body.students)).toBe(true);
            expect(body.students.length).toBeGreaterThanOrEqual(1);
            for (const s of body.students) {
                expect(s).toHaveProperty('window_count');
                expect(s.window_count).toBeGreaterThanOrEqual(1);
                expect(s).toHaveProperty('sessions_count');
                expect(s).toHaveProperty('cases_count');
                if (s.mean_valence !== null) expect(s.mean_valence).toBeGreaterThanOrEqual(-1);
                if (s.mean_confidence !== null) expect(s.mean_confidence).toBeLessThanOrEqual(1.001);
            }
        });

        it('cases aggregate distribution sums equal window_count per case', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/analytics/cases`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body.cases)).toBe(true);
            for (const c of body.cases) {
                expect(c).toHaveProperty('dominant_estimate_distribution');
                const distSum = Object.values(c.dominant_estimate_distribution || {})
                    .reduce((a, b) => a + Number(b), 0);
                // Distribution counts only rows with dominant_emotion non-null
                // — must be ≤ window_count.
                expect(distSum).toBeLessThanOrEqual(c.window_count);
            }
        });

        it('session detail returns {session, oyon_windows} — Oyon-only, no learning_events join', async () => {
            // Reuse the seeded session from the filter tests.
            const db = await openDb(server.dbPath);
            const sess = await dbGet(db, `SELECT id FROM sessions WHERE user_id = 1 ORDER BY id DESC LIMIT 1`);
            await dbClose(db);
            expect(sess).not.toBeNull();
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/analytics/session/${sess.id}`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toHaveProperty('session');
            expect(body).toHaveProperty('oyon_windows');
            // Deliberately NO `events` key — the unifying keys (session_id,
            // user_id, case_id) are already on every window so researchers
            // can join with Rohy session data offline. Server doesn't carry
            // the load.
            expect(body).not.toHaveProperty('events');
            expect(Array.isArray(body.oyon_windows)).toBe(true);
            expect(body.oyon_windows.length).toBeGreaterThanOrEqual(1);
            // Spot-check the unifying keys are present on every window.
            for (const w of body.oyon_windows) {
                expect(w).toHaveProperty('session_id');
                expect(w).toHaveProperty('user_id');
                expect(w).toHaveProperty('case_id');
            }
        });

        it('session detail 404 for unknown session', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/analytics/session/9999999`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(404);
        });

        it('analytics endpoints respect assertOyonReadAccess (admin view off → 403)', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 0, educator: 1, student: 1 });
            const paths = ['/api/addons/oyon/analytics/students', '/api/addons/oyon/analytics/cases'];
            for (const p of paths) {
                const res = await fetch(`${server.baseUrl}${p}`, {
                    headers: { Authorization: `Bearer ${adminTok}` },
                });
                expect(res.status).toBe(403);
            }
            // Restore for subsequent tests.
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
        });
    });

    describe('GET /api/addons/oyon/admin/live', () => {
        it('admin with admin_view_enabled=0 → 403', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 0, educator: 1, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/admin/live`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(403);
        });

        it('educator with educator_view_enabled=1 → 200', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/admin/live`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(res.status).toBe(200);
        });

        it('student → 403', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/admin/live`, {
                headers: { Authorization: `Bearer ${studentTok}` },
            });
            expect(res.status).toBe(403);
        });
    });

    // Trust boundary on Oyon writes: educators/admins have read access to a
    // student's session (via canReadSession) but MUST NOT be able to grant
    // consent or insert emotion records for that session — that's the
    // student's identity surface. These tests pin the 403 the route returns
    // when a non-owner attempts a write.
    describe('write ownership: only the session owner can POST consent / emotion-records', () => {
        let studentSessionId;

        beforeAll(async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const db = await openDb(server.dbPath);
            // Seed a session OWNED BY THE STUDENT user.
            const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_stu']);
            await dbRun(db,
                `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                 VALUES (?, NULL, datetime('now', '-30 minutes'), 1)`,
                [stu.id]);
            const sess = await dbGet(db,
                `SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
                [stu.id]);
            studentSessionId = sess.id;
            await dbClose(db);
        });

        it('educator POST /consent on student session → 403', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/consent`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${educatorTok}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ session_id: studentSessionId, consent_granted: true }),
            });
            expect(res.status).toBe(403);
        });

        it('educator POST /emotion-records on student session → 403', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${educatorTok}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: studentSessionId,
                    events: [{
                        session_id: String(studentSessionId),
                        record_id: 'edu-bogus-1',
                        window_start: new Date(Date.now() - 5000).toISOString(),
                        window_end: new Date().toISOString(),
                        capture_mode: 'local-browser',
                        consent_version: 'oyon-consent-v1',
                        valid_frames: 5,
                        missing_face_ratio: 0.1,
                        confidence: 0.8,
                        dominant_emotion: 'neutral',
                    }],
                }),
            });
            expect(res.status).toBe(403);
        });

        it('admin POST /consent on student session → 403', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/consent`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${adminTok}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ session_id: studentSessionId, consent_granted: true }),
            });
            expect(res.status).toBe(403);
        });
    });

    // Idempotent ingestion: replayed batches MUST NOT inflate analytics.
    // Migration 0016 adds a partial unique index on
    // (tenant_id, session_id, record_id) and the route uses
    // INSERT ... ON CONFLICT DO NOTHING. Second POST should report
    // inserted: 0, skipped: N.
    describe('idempotent ingestion: duplicate record_id batches dedupe', () => {
        let studentSessionId;
        const recordIds = ['dedup-rec-1', 'dedup-rec-2'];

        beforeAll(async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const db = await openDb(server.dbPath);
            const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_stu']);
            await dbRun(db,
                `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                 VALUES (?, NULL, datetime('now', '-30 minutes'), 1)`,
                [stu.id]);
            const sess = await dbGet(db,
                `SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
                [stu.id]);
            studentSessionId = sess.id;

            // Pre-grant consent for the student.
            await dbRun(db,
                `INSERT INTO oyon_emotion_consents
                    (tenant_id, user_id, student_id, session_id,
                     consent_granted, consent_version)
                 VALUES ('1', ?, ?, ?, 1, 'oyon-consent-v1')`,
                [String(stu.id), String(stu.id), String(studentSessionId)]);
            await dbClose(db);
        });

        function buildBatch() {
            const now = Date.now();
            return {
                session_id: studentSessionId,
                events: recordIds.map((rid, i) => ({
                    session_id: String(studentSessionId),
                    record_id: rid,
                    window_start: new Date(now - 10000 + i * 1000).toISOString(),
                    window_end: new Date(now - 5000 + i * 1000).toISOString(),
                    capture_mode: 'local-browser',
                    consent_version: 'oyon-consent-v1',
                    valid_frames: 5,
                    missing_face_ratio: 0.1,
                    confidence: 0.8,
                    dominant_emotion: 'neutral',
                })),
            };
        }

        it('first POST inserts all events, skipped=0', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${studentTok}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildBatch()),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.ok).toBe(true);
            expect(body.inserted).toBe(recordIds.length);
            expect(body.skipped).toBe(0);
        });

        it('replayed POST with same record_ids reports inserted=0, skipped=N', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${studentTok}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildBatch()),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.inserted).toBe(0);
            expect(body.skipped).toBe(recordIds.length);
        });
    });

    // Codex audit finding (post-agent): the previous idempotency fix only
    // engaged when the client sent record_id, but the runtime/widget path
    // doesn't supply one. Server now derives a stable id from
    // (tenant, session, window_start, window_end). Replay without record_id
    // must dedupe just like with one.
    describe('idempotent ingestion: server-derives record_id when client omits it', () => {
        let sessionForNoIdTest;

        beforeAll(async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const db = await openDb(server.dbPath);
            const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_stu']);
            await dbRun(db,
                `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                 VALUES (?, NULL, datetime('now', '-30 minutes'), 1)`,
                [stu.id]);
            const sess = await dbGet(db,
                `SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
                [stu.id]);
            sessionForNoIdTest = sess.id;
            await dbRun(db,
                `INSERT INTO oyon_emotion_consents
                    (tenant_id, user_id, student_id, session_id,
                     consent_granted, consent_version)
                 VALUES ('1', ?, ?, ?, 1, 'oyon-consent-v1')`,
                [String(stu.id), String(stu.id), String(sessionForNoIdTest)]);
            await dbClose(db);
        });

        // Pinned timestamps so two POSTs hash to the same derived record_id.
        const t0 = Date.now();
        const buildBatchNoId = () => ({
            session_id: sessionForNoIdTest,
            events: [0, 1].map(i => ({
                session_id: String(sessionForNoIdTest),
                window_start: new Date(t0 - 10000 + i * 1000).toISOString(),
                window_end: new Date(t0 - 5000 + i * 1000).toISOString(),
                capture_mode: 'local-browser',
                consent_version: 'oyon-consent-v1',
                valid_frames: 5,
                missing_face_ratio: 0.1,
                confidence: 0.8,
                dominant_emotion: 'neutral',
            })),
        });

        it('first POST inserts even when client did not send record_id', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${studentTok}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBatchNoId()),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.inserted).toBe(2);
            expect(body.skipped).toBe(0);
        });

        it('replayed POST with same window timestamps and no record_id is fully deduped', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${studentTok}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBatchNoId()),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.inserted).toBe(0);
            expect(body.skipped).toBe(2);
        });
    });

    describe('full window persistence: runtime metadata survives storage', () => {
        let metadataSessionId;
        const baseTime = Date.now();
        const fullWindow = {
            session_id: null,
            record_id: 'full-window-metadata-1',
            window_start: new Date(baseTime - 12000).toISOString(),
            window_end: new Date(baseTime - 2000).toISOString(),
            duration_ms: 10000,
            expected_samples: 21,
            dominant_emotion: 'happy',
            probabilities: {
                neutral: 0.1,
                happy: 0.58,
                sad: 0.05,
                surprise: 0.08,
                anger: 0.07,
                fear: 0.06,
                disgust: 0.06,
            },
            valence: 0.42,
            valence_std: 0.11,
            valence_min: 0.2,
            valence_max: 0.61,
            arousal: 0.22,
            arousal_std: 0.07,
            arousal_min: 0.08,
            arousal_max: 0.31,
            confidence: 0.58,
            confidence_std: 0.04,
            entropy: 1.2,
            entropy_std: 0.15,
            stability_score: 0.88,
            label_switch_count: 2,
            valid_frames: 18,
            missing_face_ratio: 0.1,
            quality: { meanFaceAreaRatio: 0.24, totalFrames: 20 },
            model_name: 'hse-emotion-mtl',
            model_version: '1',
            model_profile: 'hse-emotion-mtl',
            settings_hash: 'fnv1a32:testhash',
            settings_snapshot: {
                schema_version: 'oyon-settings-v1',
                model_profile: 'hse-emotion-mtl',
                sample_interval_ms: 500,
                aggregate_window_ms: 10000,
                settings_hash: 'fnv1a32:testhash',
            },
            dynamics: {
                schema_version: 'oyon-dynamics-v1',
                affect_speed: 0.032,
                instability_score: 0.18,
                phase_quadrant: 'positive-activated',
                transition_from: 'neutral',
                transition_to: 'happy',
                label_changed: true,
            },
            capture_mode: 'local-browser',
            consent_version: 'oyon-consent-v1',
        };

        beforeAll(async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const db = await openDb(server.dbPath);
            const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oroute_stu']);
            await dbRun(db,
                `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
                 VALUES (?, NULL, datetime('now', '-30 minutes'), 1)`,
                [stu.id]);
            const sess = await dbGet(db,
                `SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
                [stu.id]);
            metadataSessionId = sess.id;
            await dbRun(db,
                `INSERT INTO oyon_emotion_consents
                    (tenant_id, user_id, student_id, session_id,
                     consent_granted, consent_version)
                 VALUES ('1', ?, ?, ?, 1, 'oyon-consent-v1')`,
                [String(stu.id), String(stu.id), String(metadataSessionId)]);
            await dbClose(db);
        });

        it('stores the full aggregate window fields needed by the analytics/logs dashboard', async () => {
            const event = { ...fullWindow, session_id: String(metadataSessionId) };
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${studentTok}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: metadataSessionId, events: [event] }),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toMatchObject({ inserted: 1, skipped: 0 });

            const db = await openDb(server.dbPath);
            const row = await dbGet(db,
                `SELECT duration_ms, expected_samples, valence_std, arousal_max,
                        confidence_std, entropy_std, stability_score,
                        label_switch_count, model_profile, settings_hash,
                        settings_snapshot_json, dynamics_json
                   FROM oyon_emotion_records
                  WHERE session_id = ? AND record_id = ?`,
                [String(metadataSessionId), event.record_id]);
            await dbClose(db);

            expect(row).toMatchObject({
                duration_ms: 10000,
                expected_samples: 21,
                valence_std: 0.11,
                arousal_max: 0.31,
                confidence_std: 0.04,
                entropy_std: 0.15,
                stability_score: 0.88,
                label_switch_count: 2,
                model_profile: 'hse-emotion-mtl',
                settings_hash: 'fnv1a32:testhash',
            });
            expect(JSON.parse(row.settings_snapshot_json)).toMatchObject({
                model_profile: 'hse-emotion-mtl',
                sample_interval_ms: 500,
            });
            expect(JSON.parse(row.dynamics_json)).toMatchObject({
                phase_quadrant: 'positive-activated',
                label_changed: true,
            });
        });

        it('hydrates settings_snapshot and dynamics on read', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records?session_id=${metadataSessionId}&limit=10`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            const record = body.records.find(r => r.record_id === fullWindow.record_id);
            expect(record).toBeDefined();
            expect(record.duration_ms).toBe(10000);
            expect(record.expected_samples).toBe(21);
            expect(record.settings_snapshot).toMatchObject({ settings_hash: 'fnv1a32:testhash' });
            expect(record.dynamics).toMatchObject({ transition_to: 'happy' });
        });
    });
});
