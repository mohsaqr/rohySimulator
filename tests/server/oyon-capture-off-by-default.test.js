// Regression lock: owner decision 2026-10-25 — a fresh Rohy install must not
// start sensing. Migration 0011 gave oyon_settings.emotion_capture_enabled a
// column DEFAULT of 1, so a new tenant's row was created with capture ON and
// every learner who ticked consent was measured before any administrator had
// chosen to run Oyon. ensureSettings() now names it 0; the switch gates every
// modality through /addons/oyon/config `enabled`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { mintToken } from '../utils/authHttp.js';

const SECRET = 'oyon-default-off-secret';
const openDb = (p) => new Promise((resolve, reject) => {
    const db = new (sqlite3.verbose().Database)(p, (err) => (err ? reject(err) : resolve(db)));
});
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))));
const close = (db) => new Promise((r) => db.close(() => r()));

describe('Oyon capture on a fresh install', () => {
    let server;
    let studentTok;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        await run(db, 'DELETE FROM oyon_settings'); // a tenant that has never configured Oyon
        await run(db, `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                       VALUES ('fresh_stu', 'fresh_stu', ?, 'fresh_stu@example.com', 'student', 'active', 1)`, [await bcrypt.hash('x', 4)]);
        const id = (await get(db, "SELECT id FROM users WHERE username = 'fresh_stu'")).id;
        await close(db);
        studentTok = await mintToken(server.dbPath, { id, username: 'fresh_stu', role: 'student', tenant_id: 1 }, SECRET, { jti: 'fresh' });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('reports capture disabled, and stores the tenant row with capture off', async () => {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/config`, { headers: { Authorization: `Bearer ${studentTok}` } });
        expect(res.status).toBe(200);
        expect((await res.json()).enabled).toBe(false);

        const db = await openDb(server.dbPath);
        const row = await get(db, "SELECT emotion_capture_enabled FROM oyon_settings WHERE tenant_id = '1'");
        await close(db);
        expect(row).toEqual({ emotion_capture_enabled: 0 });
    });
});
