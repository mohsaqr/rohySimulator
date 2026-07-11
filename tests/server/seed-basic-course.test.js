// Fresh-database seed contract for the Basic course (server/seedStemiCourse.js).
//
// Migration 0031 no-ops on a fresh install (it runs before any users exist),
// so the Basic course and its test content are created by the boot sequence:
// runSeeders (users + cases) → seedStemiCourse (cohort + STEMI lesson with
// the 10-question MCQ block + the clinical-reasoning survey + default-case
// link). This test pins that contract: an empty DB booted through the real
// server must end up with all of it, and login must auto-enrol users.
//
// Spawns the real server against an EMPTY database (real boot path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );
}
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))
    );
}

describe('fresh-DB seed: Basic course with its test content', () => {
    let server;
    let basic;

    async function withDb(fn) {
        const db = await openDb(server.dbPath);
        try { return await fn(db); } finally { await closeDb(db); }
    }

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        basic = await withDb((db) =>
            pGet(db, `SELECT * FROM cohorts WHERE name = 'Basic course' AND deleted_at IS NULL`)
        );
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    it('creates the Basic course cohort with auto-enrol on', () => {
        expect(basic).toBeTruthy();
        expect(basic.auto_enroll).toBe(1);
        expect(basic.owner_user_id).toBeTruthy();
    });

    it('seeds the published STEMI lesson with overview + MCQ sections', async () => {
        await withDb(async (db) => {
            const lesson = await pGet(
                db,
                `SELECT * FROM lessons
                  WHERE cohort_id = ? AND title = 'STEMI: Recognition & Management'
                    AND deleted_at IS NULL`,
                [basic.id]
            );
            expect(lesson).toBeTruthy();
            expect(lesson.is_published).toBe(1);

            const sections = await pAll(
                db,
                `SELECT title, content FROM lesson_sections
                  WHERE lesson_id = ? ORDER BY order_index ASC`,
                [lesson.id]
            );
            expect(sections.map((s) => s.title)).toEqual(['Overview', 'Check your knowledge']);

            // The knowledge check is a single lecture-mcq block with 10 questions.
            const mcq = sections[1].content;
            expect(mcq).toContain('<lecture-mcq');
            const encoded = mcq.match(/data-questions='([^']*)'/)[1];
            const questions = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
            expect(questions.length).toBe(10);
        });
    });

    it('seeds the published clinical-reasoning survey with 3 questions, attached to the course', async () => {
        await withDb(async (db) => {
            const survey = await pGet(
                db,
                `SELECT * FROM surveys WHERE title = 'Clinical Reasoning in STEMI' AND deleted_at IS NULL`
            );
            expect(survey).toBeTruthy();
            expect(survey.is_published).toBe(1);

            const questions = await pAll(
                db,
                `SELECT question_type FROM survey_questions WHERE survey_id = ? ORDER BY order_index ASC`,
                [survey.id]
            );
            expect(questions.length).toBe(3);

            const attached = await pGet(
                db,
                `SELECT 1 AS ok FROM cohort_surveys WHERE cohort_id = ? AND survey_id = ?`,
                [basic.id, survey.id]
            );
            expect(attached).toBeTruthy();
        });
    });

    it('links the tenant default case plus the seeded language cases into the Basic course', async () => {
        await withDb(async (db) => {
            const links = await pAll(
                db,
                `SELECT cc.case_id, c.is_default, c.case_code FROM cohort_cases cc
                   JOIN cases c ON c.id = cc.case_id
                  WHERE cc.cohort_id = ? AND cc.deleted_at IS NULL`,
                [basic.id]
            );
            // The single default course carries the English default case and the
            // three native language cases (one course, one case per language).
            expect(links.filter((l) => l.is_default === 1).length).toBe(1);
            const prefixes = links.map((l) => l.case_code.split('-')[0]).sort();
            expect(prefixes).toEqual(['DE', 'EN', 'ES', 'IT']);
        });
    });

    it('login auto-enrols a user into the Basic course', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'student', password: 'student123' }),
        });
        expect(res.ok).toBe(true);

        await withDb(async (db) => {
            const membership = await pGet(
                db,
                `SELECT cm.id FROM cohort_members cm
                   JOIN users u ON u.id = cm.user_id
                  WHERE u.username = 'student' AND cm.cohort_id = ? AND cm.deleted_at IS NULL`,
                [basic.id]
            );
            expect(membership).toBeTruthy();
        });
    });
});
