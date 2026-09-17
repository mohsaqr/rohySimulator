// Terms of use: /api/terms, /api/terms/status, /api/terms/accept and the admin
// /api/platform-settings/terms pair (migration 0060).
//
// Contracts:
//   - the agreement is readable without signing in, and off by default;
//   - acceptance is recorded once per person per version, snapshotting the text;
//   - accepting a version other than the current one is refused (409), so
//     nobody is recorded as accepting text they were not shown;
//   - publishing a new version makes acceptance pending again;
//   - only admins edit, and edits are validated;
//   - the shared parser renders only the documented markdown subset.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { DEFAULT_TERMS_TITLE, DEFAULT_TERMS_VERSION, inlineSegments, parseTermsBody, termsVersionError } from '../../server/shared/terms.js';

const PASSWORD = 'TermsT3sts!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
const closeDb = (db) => new Promise((r) => db.close(() => r()));
const pRun = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
const pAll = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

describe('terms parser', () => {
    it('reads headings, paragraphs, lists and bold, and nothing else', () => {
        const blocks = parseTermsBody('Intro line one\nline two\n\n## 1. Title\n\n- **a** item\n- b\n\n<script>x</script>');
        expect(blocks).toEqual([
            { type: 'paragraph', text: 'Intro line one line two' },
            { type: 'heading', text: '1. Title' },
            { type: 'list', items: ['**a** item', 'b'] },
            { type: 'paragraph', text: '<script>x</script>' },
        ]);
        expect(inlineSegments('**a** item')).toEqual([{ text: 'a', bold: true }, { text: ' item', bold: false }]);
    });

    it('validates versions', () => {
        expect(termsVersionError('')).toMatch(/required/);
        expect(termsVersionError('1.1')).toBeNull();
        expect(termsVersionError('<b>')).toMatch(/letters/);
    });
});

describe('terms of use API', () => {
    let server;
    let adminToken;
    let studentToken;
    let studentId;

    const call = (path, { token, method = 'GET', body } = {}) => fetch(`${server.baseUrl}/api${path}`, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(PASSWORD, 4);
            for (const [u, role] of [['terms-admin', 'admin'], ['terms-student', 'student']]) {
                await pRun(db,
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                     VALUES (?, ?, ?, ?, ?, 1, 'active')`, [u, u, `${u}@example.com`, hash, role]);
            }
        } finally { await closeDb(db); }
        const login = async (username) => {
            const r = await call('/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
            if (!r.ok) throw new Error(`login ${username} → ${r.status}`);
            return r.json();
        };
        adminToken = (await login('terms-admin')).token;
        const student = await login('terms-student');
        studentToken = student.token;
        studentId = student.user.id;
    });

    afterAll(async () => { await server?.close(); });

    it('serves the default agreement publicly, not required', async () => {
        const r = await call('/terms');
        expect(r.status).toBe(200);
        const { terms } = await r.json();
        expect(terms).toMatchObject({ required: false, title: DEFAULT_TERMS_TITLE, version: DEFAULT_TERMS_VERSION, is_default: true });
        expect(terms.body).toMatch(/Your privacy is guaranteed/);
    });

    it('is not pending while not required', async () => {
        const { terms } = await (await call('/terms/status', { token: studentToken })).json();
        expect(terms).toMatchObject({ accepted: false, pending: false });
    });

    it('lets only admins edit, and validates the edit', async () => {
        expect((await call('/platform-settings/terms', { token: studentToken, method: 'PUT', body: { required: true } })).status).toBe(403);
        expect((await call('/platform-settings/terms', { token: adminToken, method: 'PUT', body: { version: '' } })).status).toBe(400);
        expect((await call('/platform-settings/terms', { token: adminToken, method: 'PUT', body: { required: 'yes' } })).status).toBe(400);
        expect((await call('/platform-settings/terms', { token: adminToken, method: 'PUT', body: {} })).status).toBe(400);
    });

    it('makes acceptance pending once required, records it once, and snapshots the text', async () => {
        const put = await call('/platform-settings/terms', { token: adminToken, method: 'PUT', body: { required: true } });
        expect(put.status).toBe(200);
        const before = (await put.json()).adoption;
        expect(before.accepted).toBe(0);
        expect(before.eligible).toBeGreaterThanOrEqual(2); // the test server seeds accounts of its own

        expect((await (await call('/terms/status', { token: studentToken })).json()).terms.pending).toBe(true);

        for (let i = 0; i < 2; i += 1) {
            const acc = await call('/terms/accept', { token: studentToken, method: 'POST', body: { version: DEFAULT_TERMS_VERSION } });
            expect(acc.status).toBe(200);
            expect((await acc.json()).terms).toMatchObject({ accepted: true, pending: false });
        }
        const db = await openDb(server.dbPath);
        try {
            const rows = await pAll(db, 'SELECT user_id, version, title, body FROM terms_acceptances WHERE user_id = ?', [studentId]);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ version: DEFAULT_TERMS_VERSION, title: DEFAULT_TERMS_TITLE });
            expect(rows[0].body).toMatch(/Your privacy is guaranteed/);
            const audits = await pAll(db, "SELECT action FROM system_audit_log WHERE action LIKE 'terms.%'");
            expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['terms.update', 'terms.accept']));
        } finally { await closeDb(db); }

        const settings = await (await call('/platform-settings/terms', { token: adminToken })).json();
        expect(settings.adoption).toEqual({ accepted: 1, eligible: before.eligible });
    });

    // Regression lock: never record acceptance of text the person was not shown.
    it('refuses to accept a version that is not the current one', async () => {
        const r = await call('/terms/accept', { token: studentToken, method: 'POST', body: { version: '0.9' } });
        expect(r.status).toBe(409);
        expect(await r.json()).toMatchObject({ code: 'terms_version_changed', version: DEFAULT_TERMS_VERSION });
    });

    it('asks again when a new version is published, and keeps the old acceptance', async () => {
        const put = await call('/platform-settings/terms', {
            token: adminToken, method: 'PUT', body: { version: '1.1', title: 'Rohy terms, revised', body: '## 1. New\n\nNew text.' },
        });
        expect(put.status).toBe(200);
        const { terms } = await (await call('/terms/status', { token: studentToken })).json();
        expect(terms).toMatchObject({ version: '1.1', title: 'Rohy terms, revised', accepted: false, pending: true, is_default: false });

        const acc = await call('/terms/accept', { token: studentToken, method: 'POST', body: { version: '1.1' } });
        expect(acc.status).toBe(200);
        const db = await openDb(server.dbPath);
        try {
            const rows = await pAll(db, 'SELECT version, body FROM terms_acceptances WHERE user_id = ? ORDER BY id', [studentId]);
            expect(rows.map((r) => r.version)).toEqual([DEFAULT_TERMS_VERSION, '1.1']);
            expect(rows[1].body).toBe('## 1. New\n\nNew text.');
            expect(rows[0].body).toMatch(/Your privacy is guaranteed/);
        } finally { await closeDb(db); }
    });

    it('requires sign-in to see status or accept', async () => {
        expect((await call('/terms/status')).status).toBe(401);
        expect((await call('/terms/accept', { method: 'POST', body: { version: '1.1' } })).status).toBe(401);
    });
});
