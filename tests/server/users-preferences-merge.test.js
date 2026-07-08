// Regression tests for PUT /api/users/preferences MERGE semantics
// (I18N_PLAN.md §3, fixed 2026-07-08).
//
// Until then the PUT was a full-replace upsert: the profile panel saving
// only { default_llm_settings } silently reset `language` and `theme` back
// to their defaults. With the language preference now user-facing, that
// replace would have wiped a student's language choice on every unrelated
// preferences save. Fields absent from the body must keep their stored
// value; fields present must update.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'PrefsMerge1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}

function closeDb(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); });
    });
}

async function seedUser(db, { username, role, tenantId = 1 }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenantId]
    );
    return r.lastID;
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

function authed(baseUrl, token) {
    return (path, init = {}) => fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(init.headers || {}),
        },
    });
}

describe('PUT /api/users/preferences — merge, not replace', () => {
    let server;
    let db;
    let studentFetch;

    const putPrefs = (body) => studentFetch('/api/users/preferences', {
        method: 'PUT',
        body: JSON.stringify(body),
    });
    const getPrefs = async () => (await studentFetch('/api/users/preferences')).json();

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        db = await openDb(server.dbPath);
        await seedUser(db, { username: 'prefs-student', role: 'student' });
        studentFetch = authed(server.baseUrl, await login(server.baseUrl, 'prefs-student'));
    }, 30_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    it('persists a language-only PUT', async () => {
        const res = await putPrefs({ language: 'it' });
        expect(res.status).toBe(200);
        const prefs = await getPrefs();
        expect(prefs.language).toBe('it');
    });

    it('regression: a later partial PUT does not reset language', async () => {
        // The exact write UserProfilePanel's "Save AI settings" performs.
        const res = await putPrefs({ default_llm_settings: { provider: 'openai', model: 'gpt-4o' } });
        expect(res.status).toBe(200);
        const prefs = await getPrefs();
        expect(prefs.language).toBe('it');
        expect(JSON.parse(prefs.default_llm_settings).model).toBe('gpt-4o');
    });

    it('keeps unrelated fields while updating the one sent', async () => {
        await putPrefs({ theme: 'light' });
        const prefs = await getPrefs();
        expect(prefs.theme).toBe('light');
        expect(prefs.language).toBe('it');
        expect(JSON.parse(prefs.default_llm_settings).provider).toBe('openai');
    });

    it('explicit null clears a JSON field without touching the rest', async () => {
        await putPrefs({ default_llm_settings: null });
        const prefs = await getPrefs();
        expect(prefs.default_llm_settings).toBeNull();
        expect(prefs.language).toBe('it');
        expect(prefs.theme).toBe('light');
    });
});
