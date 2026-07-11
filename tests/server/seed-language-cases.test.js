// Fresh-database seed contract for the native language CASES
// (server/seedLanguageCases.js).
//
// The app ships ONE default course ("Basic course") that holds one case per
// app language: the English default (STEMI) plus the German / Spanish / Italian
// cases. Language is a property of the case, not the course — so this pins that
// on a fresh boot the three native cases exist (available, non-default, correct
// language + language-bearing code) and are linked into the single default
// course, that NO per-language course is created, and that an enrolled student
// sees them.
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

// (expected case language, expected case_code prefix)
const LANGUAGE_CASES = [
    { lang: 'de', prefix: 'DE' },
    { lang: 'es', prefix: 'ES' },
    { lang: 'it', prefix: 'IT' },
];

describe('fresh-DB seed: native language cases in the single default course', () => {
    let server;

    async function withDb(fn) {
        const db = await openDb(server.dbPath);
        try { return await fn(db); } finally { await closeDb(db); }
    }

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    it.each(LANGUAGE_CASES)(
        'seeds an available, non-default $lang case with a $prefix-… code, linked to the default Basic course',
        async ({ lang, prefix }) => {
            await withDb(async (db) => {
                const kase = await pGet(
                    db,
                    `SELECT * FROM cases
                      WHERE case_code LIKE ? AND deleted_at IS NULL LIMIT 1`,
                    [`${prefix}-%`]
                );
                expect(kase, `a ${prefix} case should be seeded`).toBeTruthy();
                expect(kase.is_available).toBe(1);
                expect(kase.is_default).toBe(0);
                expect(kase.case_code).toMatch(new RegExp(`^${prefix}-\\d{4,}$`));
                expect(JSON.parse(kase.config).case_language).toBe(lang);

                // Linked into the single default "Basic course".
                const link = await pGet(
                    db,
                    `SELECT co.name FROM cohort_cases cc
                       JOIN cohorts co ON co.id = cc.cohort_id AND co.deleted_at IS NULL
                      WHERE cc.case_id = ? AND cc.deleted_at IS NULL`,
                    [kase.id]
                );
                expect(link?.name).toBe('Basic course');
            });
        }
    );

    it('creates NO per-language course — there is one default course only', async () => {
        await withDb(async (db) => {
            const rogue = await pAll(
                db,
                `SELECT name FROM cohorts
                  WHERE deleted_at IS NULL
                    AND name IN ('Deutscher Kurs', 'Curso de Español', 'Corso di Italiano',
                                 'English Course', 'German Course', 'Spanish Course', 'Italian Course')`
            );
            expect(rogue).toEqual([]);
        });
    });

    it('an enrolled student sees the default case plus all three language cases', async () => {
        const login = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'student', password: 'student123' }),
        });
        expect(login.ok).toBe(true);
        const token = (await login.json()).token;

        const res = await fetch(`${server.baseUrl}/api/cases`, {
            headers: { authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        const langs = body.cases.map((c) => c.config?.case_language).filter(Boolean);
        // The default course carries one case per language: en (the default
        // STEMI) plus de / es / it.
        for (const lang of ['en', ...LANGUAGE_CASES.map((c) => c.lang)]) {
            expect(langs).toContain(lang);
        }
    });
});
