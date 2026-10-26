// Regression lock: analytics routes read oyon_emotion_records with only "reviewer+ reads everyone" — reviewers got every learner's affect and gaze, educators kept it with educator view switched off, rows captured with a role's view off were shown, and educators read learners outside their courses (security audit 2026-10-26, F-03 / L7-01 / L2-12)
//
// Every Oyon read outside the Oyon router now goes through
// server/lib/oyonReadScope.js. Probed through GET /chat-log/turns (one turn
// per user message; the last turn owns every window of its session, so
// `windowCount` says whether the caller was given any affect windows),
// GET /learning-events/moments (emotion fields of a moment inside a window),
// and the admin system-log table view.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { asUser, closeDb, openDb, run, seedUser } from '../utils/authHttp.js';

describe('sec2 lane B — Oyon reads go through one policy', () => {
    let server;
    let db;
    const ids = {};
    const as = {};

    const windowCount = async (who, sessionId) => {
        const res = await as[who](`/api/chat-log/turns?session_id=${sessionId}`);
        expect(res.status, `${who} turns ${sessionId}`).toBe(200);
        const body = await res.json();
        return body.events.reduce((n, row) => n + (row.windowCount || 0), 0);
    };

    beforeAll(async () => {
        server = await startTestServer();
        db = await openDb(server.dbPath);
        ids.admin = await seedUser(db, { username: 'oy_admin', role: 'admin' });
        ids.eduA = await seedUser(db, { username: 'oy_edu_a', role: 'educator' });
        ids.eduB = await seedUser(db, { username: 'oy_edu_b', role: 'educator' });
        ids.reviewer = await seedUser(db, { username: 'oy_reviewer', role: 'reviewer' });
        ids.l1 = await seedUser(db, { username: 'oy_l1', role: 'student' });
        ids.l2 = await seedUser(db, { username: 'oy_l2', role: 'student' });

        ids.case = (await run(db, "INSERT INTO cases (name, system_prompt, config, tenant_id) VALUES ('Oyon case', 'p', '{}', 1)")).lastID;
        const session = async (userId) => (await run(db,
            "INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (?, ?, 'S', 'active', 1)",
            [ids.case, userId])).lastID;
        ids.s1 = await session(ids.l1);     // L1, every view flag on
        ids.s2 = await session(ids.l2);     // L2, not in educator A's course
        ids.s3 = await session(ids.l1);     // L1, captured with every view off

        // educator A owns a course with L1 as a student member.
        ids.course = (await run(db, "INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('Oyon course', ?, 1)", [ids.eduA])).lastID;
        await run(db, "INSERT INTO cohort_members (cohort_id, user_id, member_role, status) VALUES (?, ?, 'student', 'active')", [ids.course, ids.l1]);

        for (const sid of [ids.s1, ids.s2, ids.s3]) {
            await run(db, "INSERT INTO interactions (session_id, role, content, tenant_id, timestamp) VALUES (?, 'user', 'hello', 1, '2026-10-26T10:00:20.000Z')", [sid]);
            await run(db, `INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, tenant_id, timestamp)
                           SELECT id, user_id, case_id, 'EXAMINED', 'body_region', 1, '2026-10-26T10:00:05.000Z' FROM sessions WHERE id = ?`, [sid]);
        }
        const record = (sid, userId, { admin, educator, student }) => run(db,
            `INSERT INTO oyon_emotion_records (tenant_id, user_id, session_id, case_id, window_start, window_end,
                                               capture_mode, consent_version, dominant_emotion, valence, arousal,
                                               admin_can_view, educator_can_view, student_can_view)
             VALUES ('1', ?, ?, ?, '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:10.000Z', 'local-browser', 'v3', 'fear', -0.6, 0.7, ?, ?, ?)`,
            [String(userId), String(sid), ids.case, admin, educator, student]);
        await record(ids.s1, ids.l1, { admin: 1, educator: 1, student: 1 });
        await record(ids.s2, ids.l2, { admin: 1, educator: 1, student: 1 });
        await record(ids.s3, ids.l1, { admin: 0, educator: 0, student: 0 });

        for (const name of ['admin', 'eduA', 'eduB', 'reviewer', 'l1']) {
            as[name] = await asUser(server.baseUrl, { admin: 'oy_admin', eduA: 'oy_edu_a', eduB: 'oy_edu_b', reviewer: 'oy_reviewer', l1: 'oy_l1' }[name]);
        }
        // Materialise the tenant's settings row (every view flag on by default).
        await as.admin('/api/chat-log/turns?session_id=0');
        await run(db, "UPDATE oyon_settings SET admin_emotion_view_enabled = 1, educator_emotion_view_enabled = 1, student_emotion_view_enabled = 1 WHERE tenant_id = '1'");
    }, 120_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        await server?.close();
    });

    it('a reviewer gets no affect windows for any learner (Regression lock: reviewer read every learner)', async () => {
        expect(await windowCount('reviewer', ids.s1)).toBe(0);
        expect(await windowCount('reviewer', ids.s2)).toBe(0);
        const moments = await (await as.reviewer(`/api/learning-events/moments?session_id=${ids.s1}`)).json();
        expect(moments.moments.length).toBeGreaterThan(0);
        expect(moments.moments.every((m) => m.emotion == null && m.valence == null)).toBe(true);
    });

    it("an educator reads only learners of a course they teach (Regression lock: tenant-wide educator reads)", async () => {
        expect(await windowCount('eduA', ids.s1)).toBe(1);
        expect(await windowCount('eduA', ids.s2)).toBe(0);
        expect(await windowCount('eduB', ids.s1)).toBe(0);
        const moments = await (await as.eduA(`/api/learning-events/moments?session_id=${ids.s1}`)).json();
        expect(moments.moments.some((m) => m.emotion === 'fear')).toBe(true);
    });

    it('rows captured with a role view off stay hidden from that role (Regression lock: per-row *_can_view ignored)', async () => {
        expect(await windowCount('admin', ids.s1)).toBe(1);
        expect(await windowCount('admin', ids.s3)).toBe(0);
        expect(await windowCount('eduA', ids.s3)).toBe(0);
        const table = await (await as.admin('/api/system-log/table/oyon_emotion_records?limit=50')).json();
        const sessions = table.rows.map((r) => String(r.session_id));
        expect(sessions).toContain(String(ids.s1));
        expect(sessions).not.toContain(String(ids.s3));
    });

    it("a learner sees their own windows only while student view is on (Regression lock: self path ignored student view)", async () => {
        expect(await windowCount('l1', ids.s1)).toBe(1);
        expect(await windowCount('l1', ids.s3)).toBe(0);
        await run(db, "UPDATE oyon_settings SET student_emotion_view_enabled = 0 WHERE tenant_id = '1'");
        try {
            expect(await windowCount('l1', ids.s1)).toBe(0);
        } finally {
            await run(db, "UPDATE oyon_settings SET student_emotion_view_enabled = 1 WHERE tenant_id = '1'");
        }
    });

    it('educator view switched off gives an educator nothing (Regression lock: educator kept affect with view off)', async () => {
        await run(db, "UPDATE oyon_settings SET educator_emotion_view_enabled = 0 WHERE tenant_id = '1'");
        try {
            expect(await windowCount('eduA', ids.s1)).toBe(0);
            const moments = await (await as.eduA(`/api/learning-events/moments?session_id=${ids.s1}`)).json();
            expect(moments.moments.every((m) => m.emotion == null)).toBe(true);
        } finally {
            await run(db, "UPDATE oyon_settings SET educator_emotion_view_enabled = 1 WHERE tenant_id = '1'");
        }
    });

    it('admin view switched off blocks the admin Oyon export and table (Regression lock: admin feeds ignored admin view)', async () => {
        await run(db, "UPDATE oyon_settings SET admin_emotion_view_enabled = 0 WHERE tenant_id = '1'");
        try {
            expect((await as.admin('/api/system-log/table/oyon_emotion_records')).status).toBe(403);
            expect((await as.admin('/api/export/system-log/oyon')).status).toBe(403);
            expect(await windowCount('admin', ids.s1)).toBe(0);
        } finally {
            await run(db, "UPDATE oyon_settings SET admin_emotion_view_enabled = 1 WHERE tenant_id = '1'");
        }
    });
});
