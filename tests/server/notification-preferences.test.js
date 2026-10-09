import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'NotifyPrefs1!';
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

describe('notification preferences account persistence', () => {
    let server;
    let db;
    let token;
    let userId;
    const request = (path, body) => fetch(`${server.baseUrl}/api/${path}`, {
        method: body ? 'PUT' : 'GET',
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    beforeAll(async () => {
        server = await startTestServer({ env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        db = await new Promise((resolve, reject) => {
            const connection = new sqlite3.Database(server.dbPath, err => err ? reject(err) : resolve(connection));
        });
        await run(db, "INSERT INTO tenants (id, slug, name) VALUES (2, 'notification-test', 'Synthetic notification tenant')");
        userId = (await run(db,
            `INSERT INTO users (username, email, password_hash, role, status, tenant_id)
             VALUES ('notify-tenant-two', 'notify-two@example.com', ?, 'student', 'active', 2)`,
            [await bcrypt.hash(PASSWORD, 4)]
        )).lastID;
        const login = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'notify-tenant-two', password: PASSWORD }),
        });
        expect(login.status).toBe(200);
        token = (await login.json()).token;
    });
    afterAll(async () => {
        if (db) await new Promise(resolve => db.close(resolve));
        await server?.close();
    });

    it('persists alarm speech without accepting arbitrary preference keys', async () => {
        const prefs = { avatarAlarmSpeechEnabled: false, dnd: true, unrecognisedSyntheticKey: 'discard' };
        expect((await request('notification-prefs', { prefs })).status).toBe(200);
        const result = await request('notification-prefs');
        expect(result.status).toBe(200);
        expect((await result.json()).prefs).toEqual({ avatarAlarmSpeechEnabled: false, dnd: true });
        const row = await get(db, 'SELECT tenant_id FROM user_preferences WHERE user_id = ?', [userId]);
        expect(row.tenant_id).toBe(2);
        const common = await request('users/preferences');
        expect(common.status).toBe(200);
        expect(JSON.parse((await common.json()).notification_settings)).toMatchObject({ avatarAlarmSpeechEnabled: false, dnd: true });
    });

    it('repairs a historical notification-first row assigned to the default tenant', async () => {
        await run(db, 'UPDATE user_preferences SET tenant_id = 1 WHERE user_id = ?', [userId]);
        expect((await request('notification-prefs')).status).toBe(200);
        expect((await (await request('notification-prefs')).json()).prefs).toEqual({});
        expect((await request('notification-prefs', { prefs: { avatarAlarmSpeechEnabled: true } })).status).toBe(200);
        expect((await get(db, 'SELECT tenant_id FROM user_preferences WHERE user_id = ?', [userId])).tenant_id).toBe(2);
        expect((await (await request('notification-prefs')).json()).prefs.avatarAlarmSpeechEnabled).toBe(true);
    });
});
