// Oyon 3 signal settings contract (migration 0040).
//
// These flags exist so a tenant can DISABLE a signal. The <oyon-app> element's
// own DEFAULT_SETTINGS turns gaze/eye/facial/posture/respiration/heart-rate ON —
// the opposite of the library's OYON_DEFAULT_SETTINGS — and Rohy previously
// forwarded only seven numeric/model keys, so there was no way to switch any
// signal off from the platform.
//
// Regression lock: PUT /addons/oyon/settings is shared by every Oyon settings
// section, so the signal columns MUST be a key-presence merge. A full replace
// would let the capture-engine form silently zero every flag it doesn't render —
// the partial-update trap CLAUDE.md records for this endpoint.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { mintToken } from '../utils/authHttp.js';
import sqlite3 from 'sqlite3';

const SECRET = 'oyon-signal-settings-secret';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null)));
}
function dbClose(db) { return new Promise((r) => db.close(() => r())); }

describe('Oyon 3 signal settings', () => {
    let server, adminTok, studentTok;

    const getSettings = () => fetch(`${server.baseUrl}/api/addons/oyon/settings`, {
        headers: { Authorization: `Bearer ${adminTok}` },
    }).then(r => r.json());

    const putSettings = (body) => fetch(`${server.baseUrl}/api/addons/oyon/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        for (const [u, role] of [['oss_admin', 'admin'], ['oss_stu', 'student']]) {
            await dbRun(db,
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [u, u, pwd, `${u}@example.com`, role]);
        }
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oss_admin']);
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oss_stu']);
        await dbClose(db);
        // mintToken signs AND records the active_sessions row authenticateToken requires.
        adminTok = await mintToken(server.dbPath, { id: admin.id, username: 'oss_admin', role: 'admin', tenant_id: 1 }, SECRET, { jti: 'ss-a' });
        studentTok = await mintToken(server.dbPath, { id: stu.id, username: 'oss_stu', role: 'student', tenant_id: 1 }, SECRET, { jti: 'ss-s' });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('defaults preserve the element\'s behaviour, except posture', async () => {
        const { settings } = await getSettings();
        for (const key of ['facial_signals_enabled', 'heart_rate_enabled', 'respiration_enabled',
            'illumination_enabled', 'eye_tracking_enabled', 'gaze_tracking_enabled', 'enable_dynamics']) {
            expect(settings[key], key).toBe(true);
        }
        // Off by design: the pose model cannot be served same-origin, so leaving
        // it on makes the browser fetch it from a Google CDN, breaking the
        // air-gap contract. See migration 0040.
        expect(settings.posture_tracking_enabled).toBe(false);
    });

    it('exposes the flags to the capture client through GET /config', async () => {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/config`, {
            headers: { Authorization: `Bearer ${studentTok}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        // The client forwards these verbatim into the element's `settings`
        // attribute, so they must be real booleans, not 0/1.
        expect(body.runtime.heart_rate_enabled).toBe(true);
        expect(body.runtime.posture_tracking_enabled).toBe(false);
        expect(typeof body.runtime.gaze_tracking_enabled).toBe('boolean');
    });

    it('persists a disable, which is the capability that was missing', async () => {
        const res = await putSettings({ heart_rate_enabled: false, respiration_enabled: false });
        expect(res.status).toBe(200);
        const { settings } = await getSettings();
        expect(settings.heart_rate_enabled).toBe(false);
        expect(settings.respiration_enabled).toBe(false);
        // Untouched flags survive.
        expect(settings.facial_signals_enabled).toBe(true);
    });

    // Regression lock for the partial-update trap.
    it('is a key-presence merge: a PUT omitting the flags cannot zero them', async () => {
        await putSettings({ heart_rate_enabled: false, facial_signals_enabled: true });
        // A save from an unrelated settings section — capture-engine knobs only.
        const res = await putSettings({ window_ms: 12000, sample_interval_ms: 500 });
        expect(res.status).toBe(200);
        const { settings } = await getSettings();
        expect(settings.window_ms).toBe(12000);
        expect(settings.facial_signals_enabled).toBe(true);   // not zeroed
        expect(settings.heart_rate_enabled).toBe(false);      // explicit off preserved
        expect(settings.gaze_tracking_enabled).toBe(true);    // never mentioned, still on
    });

    it('fans one window_share switch out to every modality', async () => {
        await putSettings({ signal_window_share: false });
        const { settings } = await getSettings();
        expect(settings.signal_window_share).toBe(false);
        for (const key of ['facial_signals_window_share', 'posture_window_share',
            'heart_rate_window_share', 'respiration_window_share',
            'illumination_window_share', 'engagement_window_share', 'gaze_window_share']) {
            expect(settings[key], key).toBe(false);
        }
        await putSettings({ signal_window_share: true });
    });

    it('keeps the settings endpoint admin-only', async () => {
        const res = await fetch(`${server.baseUrl}/api/addons/oyon/settings`, {
            headers: { Authorization: `Bearer ${studentTok}` },
        });
        expect(res.status).toBe(403);
    });
});
