// First-run setup backend (todo/first-run-setup-spec.md):
//   - GET/PUT /platform-settings/language (public read — the login page needs
//     the platform default before any token exists; admin-only write)
//   - GET /setup/status (admin-only derived checklist status)
//   - PUT /platform-settings/setup (completion flag; Finish and Dismiss both
//     write it)
//   - user_preferences.onboarding_settings: shallow-merge semantics — a
//     single-key write (consent flip) must not erase sibling keys, and an
//     onboarding-only write must not clobber the language preference.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'FirstRun1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

async function seedUser(db, { username, role }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]
    );
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
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

describe('first-run setup backend', () => {
    let server;
    let admin, student;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'fr-admin', role: 'admin' });
            await seedUser(db, { username: 'fr-student', role: 'student' });
        } finally {
            await closeDb(db);
        }
        admin = authedFetch(server.baseUrl, await login(server.baseUrl, 'fr-admin'));
        student = authedFetch(server.baseUrl, await login(server.baseUrl, 'fr-student'));
    }, 60_000);

    afterAll(async () => {
        await server?.close();
    });

    describe('/platform-settings/language', () => {
        it('GET is public and defaults to en', async () => {
            const res = await fetch(`${server.baseUrl}/api/platform-settings/language`);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ default_ui_language: 'en' });
        });

        it('PUT requires admin', async () => {
            const res = await student('/api/platform-settings/language', {
                method: 'PUT',
                body: JSON.stringify({ default_ui_language: 'de' }),
            });
            expect(res.status).toBe(403);
        });

        it('PUT rejects unknown language codes loudly', async () => {
            const res = await admin('/api/platform-settings/language', {
                method: 'PUT',
                body: JSON.stringify({ default_ui_language: 'xx' }),
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/default_ui_language/);
        });

        it('PUT stores a valid code and the public GET reflects it', async () => {
            const put = await admin('/api/platform-settings/language', {
                method: 'PUT',
                body: JSON.stringify({ default_ui_language: 'de' }),
            });
            expect(put.status).toBe(200);
            const res = await fetch(`${server.baseUrl}/api/platform-settings/language`);
            expect(await res.json()).toEqual({ default_ui_language: 'de' });
        });
    });

    describe('/setup/status', () => {
        it('is admin-only', async () => {
            const res = await student('/api/setup/status');
            expect(res.status).toBe(403);
        });

        it('returns the derived checklist status', async () => {
            const res = await admin('/api/setup/status');
            expect(res.status).toBe(200);
            const status = await res.json();
            expect(status.setup_completed).toBe(false);
            // Fresh install seeds the local LM Studio defaults.
            expect(status.llm.provider).toBe('lmstudio');
            expect(typeof status.llm.key_present).toBe('boolean');
            expect(typeof status.cases.total).toBe('number');
            expect(Array.isArray(status.cases.list)).toBe(true);
            expect(status.cases.by_language).toHaveProperty('en');
            // Boot seeds only the English default voice; the others are the
            // deliberate loud-fail gaps the wizard should surface.
            expect(status.voice.languages_missing_default_voice).not.toContain('en');
            expect(status.voice.languages_missing_default_voice).toContain('de');
            // The PUT above changed the platform default language.
            expect(status.language.default_ui_language).toBe('de');
            expect(typeof status.oyon.enabled).toBe('boolean');
            expect(status.affect.enabled).toBe(false);
        });
    });

    describe('/platform-settings/setup (completion flag)', () => {
        it('requires admin', async () => {
            const res = await student('/api/platform-settings/setup', {
                method: 'PUT',
                body: JSON.stringify({ completed: true }),
            });
            expect(res.status).toBe(403);
        });

        it('persists and shows up in /setup/status', async () => {
            const put = await admin('/api/platform-settings/setup', {
                method: 'PUT',
                body: JSON.stringify({ completed: true }),
            });
            expect(put.status).toBe(200);
            expect(await put.json()).toEqual({ completed: true });
            const status = await (await admin('/api/setup/status')).json();
            expect(status.setup_completed).toBe(true);
        });
    });

    describe('user_preferences.onboarding_settings', () => {
        const parse = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);

        it('round-trips through the merge PUT', async () => {
            const put = await student('/api/users/preferences', {
                method: 'PUT',
                body: JSON.stringify({
                    language: 'es',
                    onboarding_settings: { first_run_done: 1, voice_mode: true, oyon_consent: false },
                }),
            });
            expect(put.status).toBe(200);
            const prefs = await (await student('/api/users/preferences')).json();
            expect(prefs.language).toBe('es');
            expect(parse(prefs.onboarding_settings)).toEqual({
                first_run_done: 1, voice_mode: true, oyon_consent: false,
            });
        });

        it('shallow-merges keys: a single-key write keeps its siblings', async () => {
            const put = await student('/api/users/preferences', {
                method: 'PUT',
                body: JSON.stringify({ onboarding_settings: { oyon_consent: true } }),
            });
            expect(put.status).toBe(200);
            const prefs = await (await student('/api/users/preferences')).json();
            expect(parse(prefs.onboarding_settings)).toEqual({
                first_run_done: 1, voice_mode: true, oyon_consent: true,
            });
            // The merge PUT also left the unrelated language field alone.
            expect(prefs.language).toBe('es');
        });

        it('a PUT without onboarding_settings leaves them untouched', async () => {
            const put = await student('/api/users/preferences', {
                method: 'PUT',
                body: JSON.stringify({ theme: 'dark' }),
            });
            expect(put.status).toBe(200);
            const prefs = await (await student('/api/users/preferences')).json();
            expect(parse(prefs.onboarding_settings)).toEqual({
                first_run_done: 1, voice_mode: true, oyon_consent: true,
            });
        });
    });
});
