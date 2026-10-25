// A learner can see how much Oyon data is stored under their account and
// delete all of it themselves (GDPR Art. 17 in the product). Owner request,
// 2026-10-25: "an option in Rohy so users can delete their sensor data".
//
// Contract:
//   - GET  /addons/oyon/student/me/data → per-table counts + total, own rows only
//   - DELETE needs { confirm: true } (400 confirmation_required otherwise)
//   - DELETE removes the caller's rows from emotion records, signal windows
//     and signal events — never another user's, never another tenant's
//   - consent rows are kept (the record that consent was given/withdrawn)
//   - works whatever the tenant's student view flag is
//   - audited with counts only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { mintToken } from '../utils/authHttp.js';

const SECRET = 'oyon-own-data-tests-secret';

const openDb = (p) => new Promise((resolve, reject) => {
    const db = new (sqlite3.verbose().Database)(p, (err) => (err ? reject(err) : resolve(db)));
});
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))));
const close = (db) => new Promise((r) => db.close(() => r()));

describe('learner deletes own Oyon data', () => {
    let server;
    let meTok;
    let meId;
    let otherId;
    let foreignId;

    async function seedRows(db, userId, tenant, n) {
        for (let i = 0; i < n; i++) {
            await run(db, `INSERT INTO oyon_emotion_records (tenant_id, user_id, session_id, case_id, window_start, window_end, dominant_emotion, capture_mode, consent_version)
                           VALUES (?, ?, 1, 1, '2026-10-25T10:00:00Z', '2026-10-25T10:00:10Z', 'neutral', 'local-browser', 'v1')`, [tenant, String(userId)]);
            await run(db, `INSERT INTO oyon_signal_windows (tenant_id, user_id, session_id, modality, window_kind, window_start, window_end, payload_json, consent_version)
                           VALUES (?, ?, 1, 'typing', 'summary', '2026-10-25T10:00:00Z', '2026-10-25T10:00:10Z', '{}', 'v2')`, [tenant, String(userId)]);
            await run(db, `INSERT INTO oyon_signal_events (tenant_id, user_id, session_id, capture_id, sequence_index, modality, state, source, state_vocabulary, occurred_at, consent_version)
                           VALUES (?, ?, 1, ?, ?, 'voice', 'speaking', 'user', 'voice_activity', '2026-10-25T10:00:00Z', 'v3')`, [tenant, String(userId), `cap-${userId}-${tenant}`, i]);
        }
        await run(db, `INSERT INTO oyon_emotion_consents (tenant_id, user_id, session_id, case_id, consent_granted, consent_version)
                       VALUES (?, ?, 1, 1, 1, 'v1')`, [tenant, String(userId)]);
    }

    const counts = async (userId, tenant) => {
        const db = await openDb(server.dbPath);
        const out = {};
        for (const t of ['oyon_emotion_records', 'oyon_signal_windows', 'oyon_signal_events', 'oyon_emotion_consents']) {
            out[t] = (await get(db, `SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ? AND user_id = ?`, [tenant, String(userId)])).n;
        }
        await close(db);
        return out;
    };

    const call = (method, path, body) => fetch(`${server.baseUrl}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${meTok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        await run(db, `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'other', 'Other tenant')`);
        for (const [u, tenant] of [['own_me', 1], ['own_other', 1], ['own_foreign', 2]]) {
            await run(db, `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                           VALUES (?, ?, ?, ?, 'student', 'active', ?)`, [u, u, pwd, `${u}@example.com`, tenant]);
        }
        meId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['own_me'])).id;
        otherId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['own_other'])).id;
        foreignId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['own_foreign'])).id;
        await seedRows(db, meId, 1, 3);
        await seedRows(db, otherId, 1, 2);
        // A row in ANOTHER tenant that happens to carry the caller's user id.
        await seedRows(db, meId, 2, 1);
        await seedRows(db, foreignId, 2, 1);
        // Student view switched OFF: erasure must not depend on it.
        await run(db, `INSERT OR REPLACE INTO oyon_settings (tenant_id, emotion_capture_enabled, admin_emotion_view_enabled,
                       educator_emotion_view_enabled, student_emotion_view_enabled, model_profile, sample_interval_ms, window_ms,
                       min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence)
                       VALUES ('1', 1, 1, 1, 0, 'hse-emotion-mtl', 333, 10000, 6, 0.28, 3000, 0.5)`);
        await close(db);
        meTok = await mintToken(server.dbPath, { id: meId, username: 'own_me', role: 'student', tenant_id: 1 }, SECRET, { jti: 'me' });
    });

    afterAll(async () => { if (server) await server.close(); });

    it('reports how much is stored under the caller, and nobody else', async () => {
        const res = await call('GET', '/addons/oyon/student/me/data');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.counts).toEqual({ oyon_emotion_records: 3, oyon_signal_windows: 3, oyon_signal_events: 3 });
        expect(body.total).toBe(9);
    });

    it('refuses a DELETE without explicit confirmation and deletes nothing', async () => {
        const res = await call('DELETE', '/addons/oyon/student/me/data', {});
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('confirmation_required');
        expect((await counts(meId, 1)).oyon_emotion_records).toBe(3);
    });

    it('deletes every Oyon measurement of the caller, keeps consents, and touches no other user or tenant', async () => {
        const res = await call('DELETE', '/addons/oyon/student/me/data', { confirm: true });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            deleted: { oyon_emotion_records: 3, oyon_signal_windows: 3, oyon_signal_events: 3 },
            total: 9,
        });

        expect(await counts(meId, 1)).toEqual({ oyon_emotion_records: 0, oyon_signal_windows: 0, oyon_signal_events: 0, oyon_emotion_consents: 1 });
        expect(await counts(otherId, 1)).toEqual({ oyon_emotion_records: 2, oyon_signal_windows: 2, oyon_signal_events: 2, oyon_emotion_consents: 1 });
        expect(await counts(meId, 2)).toEqual({ oyon_emotion_records: 1, oyon_signal_windows: 1, oyon_signal_events: 1, oyon_emotion_consents: 1 });
        expect(await counts(foreignId, 2)).toEqual({ oyon_emotion_records: 1, oyon_signal_windows: 1, oyon_signal_events: 1, oyon_emotion_consents: 1 });

        const after = await (await call('GET', '/addons/oyon/student/me/data')).json();
        expect(after.total).toBe(0);
    });

    it('records the deletion in the audit log with counts only', async () => {
        const db = await openDb(server.dbPath);
        let row = null;
        for (let i = 0; i < 60 && !row; i++) {
            row = await get(db, `SELECT action, metadata FROM system_audit_log WHERE action = 'oyon.own_data_deleted' AND user_id = ?`, [meId]);
            if (!row) await new Promise((r) => setTimeout(r, 50));
        }
        await close(db);
        expect(row).not.toBeNull();
        expect(JSON.parse(row.metadata)).toMatchObject({ total: 9 });
    });
});
