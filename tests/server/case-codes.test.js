// Integration tests for the visible language-bearing case code (migration
// 0035 + server/shared/caseCode.js):
//
//   * Every case carries case_code = <LANG>-<zero-padded id>; the numeric
//     part is the integer PK, so codes are unique by construction. Boot
//     sweep (ensureCaseCodes) stamps seeder-inserted rows, which land AFTER
//     migrations run.
//   * Case language is IMMUTABLE: POST normalizes it to a concrete registry
//     code (absent/junk → 'en'); PUT and version-restore preserve the stored
//     value no matter what the client or an old snapshot says — so a code's
//     prefix never changes either.
//
// Spawns the real server against an EMPTY database (real boot path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const CODE_SHAPE = /^(EN|IT|FI|SV|DE|ES)-\d{4,}$/;

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
async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}
function authedFetch(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}
const json = (res) => res.json();

describe('case codes: stamping, uniqueness, immutable language', () => {
    let server;
    let admin;

    async function withDb(fn) {
        const db = await openDb(server.dbPath);
        try { return await fn(db); } finally { await closeDb(db); }
    }

    const fetchCase = async (id) => {
        const body = await json(await admin(`/api/cases/${id}`));
        return body.case ?? body; // tolerate either response shape
    };

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        admin = authedFetch(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
    }, 90_000);

    afterAll(async () => {
        if (server) {
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    // ---- Boot sweep over seeded rows ---------------------------------------
    it('every boot-seeded case has a well-formed, unique code and a concrete language', async () => {
        await withDb(async (db) => {
            const rows = await pAll(db, `SELECT id, case_code, config FROM cases`);
            expect(rows.length).toBeGreaterThan(0);
            const codes = rows.map((r) => r.case_code);
            expect(new Set(codes).size).toBe(codes.length);
            for (const row of rows) {
                expect(row.case_code, `case ${row.id}`).toMatch(CODE_SHAPE);
                // Numeric part IS the id.
                expect(Number(row.case_code.split('-')[1])).toBe(row.id);
                // The sweep pinned a concrete language into config.
                const config = JSON.parse(row.config);
                expect(['en', 'it', 'fi', 'sv', 'de', 'es']).toContain(config.case_language);
                expect(row.case_code.split('-')[0]).toBe(config.case_language.toUpperCase());
            }
        });
    });

    it('the partial unique index on case_code exists', async () => {
        await withDb(async (db) => {
            const idx = await pAll(
                db,
                `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_cases_case_code'`
            );
            expect(idx.length).toBe(1);
        });
    });

    // ---- Creation ------------------------------------------------------------
    it('POST /cases with an Italian case language stamps an IT- code', async () => {
        const created = await json(await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Dolore toracico',
                description: 'IT case',
                system_prompt: 'Sei un paziente.',
                config: { case_language: 'it', patient_name: 'Mario Rossi' },
            }),
        }));
        expect(created.case_code).toBe(`IT-${String(created.id).padStart(4, '0')}`);
        expect(created.config.case_language).toBe('it');

        const fetched = await fetchCase(created.id);
        expect(fetched.case_code).toBe(created.case_code);
    });

    it('POST /cases without a case language pins the default (en), never "follow"', async () => {
        const created = await json(await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Plain case',
                description: 'no language picked',
                system_prompt: 'You are a patient.',
                config: { patient_name: 'John Doe' },
            }),
        }));
        expect(created.config.case_language).toBe('en');
        expect(created.case_code).toBe(`EN-${String(created.id).padStart(4, '0')}`);
    });

    it('POST /cases ignores junk case languages and any client-sent case_code', async () => {
        const created = await json(await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Junk language case',
                description: 'junk',
                system_prompt: 'You are a patient.',
                case_code: 'ZZ-9999',
                config: { case_language: 'klingon' },
            }),
        }));
        expect(created.config.case_language).toBe('en');
        expect(created.case_code).toBe(`EN-${String(created.id).padStart(4, '0')}`);
    });

    // ---- Immutability ----------------------------------------------------------
    it('PUT /cases/:id cannot change the case language — code prefix never moves', async () => {
        const created = await json(await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Rintakipu',
                description: 'FI case',
                system_prompt: 'Olet potilas.',
                config: { case_language: 'fi' },
            }),
        }));
        expect(created.case_code).toMatch(/^FI-/);

        const updated = await json(await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: 'Rintakipu (edited)',
                description: 'attempted language switch',
                system_prompt: 'Olet potilas.',
                config: { case_language: 'sv' },
            }),
        }));
        expect(updated.config.case_language).toBe('fi');

        const fetched = await fetchCase(created.id);
        expect(fetched.config.case_language).toBe('fi');
        expect(fetched.case_code).toBe(created.case_code);
    });

    it('version restore keeps the current language even if the snapshot lacked one', async () => {
        const created = await json(await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Bröstsmärta',
                description: 'SV case v1',
                system_prompt: 'Du är en patient.',
                config: { case_language: 'sv' },
            }),
        }));

        // A second version so there is something to restore across.
        await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: 'Bröstsmärta v2',
                description: 'SV case v2',
                system_prompt: 'Du är en patient.',
                config: { case_language: 'sv', extra: true },
            }),
        });

        const { versions } = await json(await admin(`/api/cases/${created.id}/versions`));
        const first = versions[versions.length - 1];
        const restore = await admin(`/api/cases/${created.id}/restore/${first.id}`, { method: 'POST' });
        expect(restore.status).toBe(200);

        const fetched = await fetchCase(created.id);
        expect(fetched.config.case_language).toBe('sv');
        expect(fetched.case_code).toBe(created.case_code);
    });
});
