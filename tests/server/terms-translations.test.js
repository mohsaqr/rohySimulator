// Terms of use in the reader's language (3.0.0-rc.17): shipped machine translations of the default text, admin translations keyed to the master version they render, a fallback that never shows a stale translation as current, and an acceptance snapshot that records the language read.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { DEFAULT_TERMS_BODY, DEFAULT_TERMS_VERSION } from '../../server/shared/terms.js';
import { DEFAULT_TERMS_TRANSLATIONS } from '../../server/shared/termsTranslations.js';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../../server/shared/languages.js';

const PASSWORD = 'TermsTr4nslate!';
const kind = (line) => (line.startsWith('## ') ? 'heading' : line.startsWith('- ') ? 'list' : line.trim() === '' ? 'blank' : 'paragraph');
const boldCount = (line) => (line.match(/\*\*/g) || []).length;

describe('shipped translations of the default terms', () => {
    const english = DEFAULT_TERMS_BODY.split('\n');
    const languages = Object.keys(LANGUAGES).filter((code) => code !== DEFAULT_LANGUAGE);

    it('cover every UI language', () => {
        expect(Object.keys(DEFAULT_TERMS_TRANSLATIONS).sort()).toEqual([...languages].sort());
    });

    it.each(languages)('%s mirrors the English structure line for line', (lang) => {
        const { title, body } = DEFAULT_TERMS_TRANSLATIONS[lang];
        expect(title.trim().length).toBeGreaterThan(5);
        const lines = body.split('\n');
        expect(lines.length).toBe(english.length);
        expect(lines.map(kind)).toEqual(english.map(kind));
        expect(lines.map(boldCount)).toEqual(english.map(boldCount));
        expect(body).not.toBe(DEFAULT_TERMS_BODY);
    });
});

describe('terms of use API, per language', () => {
    let server; let adminToken; let studentToken; let studentId;
    const call = (path, { token, method = 'GET', body } = {}) => fetch(`${server.baseUrl}/api${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const withDb = async (fn) => {
        const db = await new Promise((resolve, reject) => { const d = new (sqlite3.verbose().Database)(server.dbPath, (e) => (e ? reject(e) : resolve(d))); });
        try { return await fn(db); } finally { await new Promise((r) => db.close(r)); }
    };
    const put = (body) => call('/platform-settings/terms', { token: adminToken, method: 'PUT', body });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash(PASSWORD, 4);
        await withDb(async (db) => {
            for (const [u, role] of [['tr-admin', 'admin'], ['tr-student', 'student']]) {
                await new Promise((resolve, reject) => db.run(
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, ?, 1, 'active')`,
                    [u, u, `${u}@example.com`, hash, role], (e) => (e ? reject(e) : resolve())));
            }
        });
        const login = async (username) => (await call('/auth/login', { method: 'POST', body: { username, password: PASSWORD } })).json();
        adminToken = (await login('tr-admin')).token;
        const student = await login('tr-student');
        studentToken = student.token;
        studentId = student.user.id;
    }, 90_000);
    afterAll(async () => { await server?.close(); });

    it('serves the shipped translation of the default text, and the master for English or an unknown language', async () => {
        const de = (await (await call('/terms?lang=de')).json()).terms;
        expect(de).toMatchObject({ lang: 'de', is_fallback: false, version: DEFAULT_TERMS_VERSION, title: DEFAULT_TERMS_TRANSLATIONS.de.title });
        expect(de.body).toBe(DEFAULT_TERMS_TRANSLATIONS.de.body);
        expect((await (await call('/terms?lang=de-AT')).json()).terms.lang).toBe('de');
        expect((await (await call('/terms?lang=en')).json()).terms).toMatchObject({ lang: 'en', is_fallback: false, body: DEFAULT_TERMS_BODY });
        expect((await (await call('/terms?lang=xx')).json()).terms).toMatchObject({ lang: 'en', is_fallback: false });
    });

    it('records the language read with the acceptance snapshot', async () => {
        await put({ required: true });
        const { terms } = await (await call('/terms/status?lang=fi', { token: studentToken })).json();
        expect(terms).toMatchObject({ lang: 'fi', pending: true });
        const res = await call('/terms/accept', { token: studentToken, method: 'POST', body: { version: terms.version, lang: 'fi' } });
        expect(res.status).toBe(200);
        const row = await withDb((db) => new Promise((resolve, reject) => db.get(
            'SELECT language, title, body FROM terms_acceptances WHERE user_id = ? AND version = ?', [studentId, DEFAULT_TERMS_VERSION], (e, r) => (e ? reject(e) : resolve(r)))));
        expect(row).toMatchObject({ language: 'fi', title: DEFAULT_TERMS_TRANSLATIONS.fi.title, body: DEFAULT_TERMS_TRANSLATIONS.fi.body });
    });

    it('a custom master falls back to it in every language until a translation renders its version', async () => {
        expect((await put({ version: '2.0', title: 'Custom terms', body: '## 1. Custom\n\nCustom text.' })).status).toBe(200);
        const de = (await (await call('/terms?lang=de')).json()).terms;
        expect(de).toMatchObject({ lang: 'en', is_fallback: true, title: 'Custom terms', version: '2.0' });
        const admin = await (await call('/platform-settings/terms', { token: adminToken })).json();
        expect(admin.translation_status.de).toEqual({ source: 'master', version: null });
    });

    it('serves an admin translation of the current version', async () => {
        const res = await put({ translations: { de: { title: 'Eigene Bedingungen', body: '## 1. Eigen\n\nEigener Text.', version: '2.0' } } });
        expect(res.status).toBe(200);
        expect((await res.json()).translation_status.de).toEqual({ source: 'stored', version: '2.0' });
        expect((await (await call('/terms?lang=de')).json()).terms).toMatchObject({ lang: 'de', is_fallback: false, title: 'Eigene Bedingungen', body: '## 1. Eigen\n\nEigener Text.' });
    });

    // Regression lock: a translation must never be shown as the current agreement once the master moves on — readers would accept text that no longer says what the version means.
    it('never shows a stale translation: a new master version sends readers back to the master', async () => {
        await put({ version: '2.1' });
        expect((await (await call('/terms?lang=de')).json()).terms).toMatchObject({ lang: 'en', is_fallback: true, version: '2.1', title: 'Custom terms' });
        const admin = await (await call('/platform-settings/terms', { token: adminToken })).json();
        expect(admin.translation_status.de).toEqual({ source: 'stale', version: '2.0' });
    });

    it('validates translations and removes one on null', async () => {
        for (const translations of [
            { en: { title: 'x', body: 'y', version: '2.1' } },
            { xx: { title: 'x', body: 'y', version: '2.1' } },
            { de: { title: 'x', body: '', version: '2.1' } },
            { de: { title: 'x', body: 'y', version: '' } },
            { de: 'text' },
            ['de'],
        ]) {
            const res = await put({ translations });
            expect(res.status, JSON.stringify(translations)).toBe(400);
        }
        expect((await put({ translations: { de: null } })).status).toBe(200);
        const admin = await (await call('/platform-settings/terms', { token: adminToken })).json();
        expect(admin.draft.translations.de).toBeUndefined();
    });

    it('lets only an admin edit translations', async () => {
        const res = await call('/platform-settings/terms', { token: studentToken, method: 'PUT', body: { translations: { de: null } } });
        expect(res.status).toBe(403);
    });
});
