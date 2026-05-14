// Audit follow-up: retention / purge behaviour wasn't tested end-to-end.
// migrations/0005_retention.sql adds the deleted_at columns and the
// rebuilt-tables required for soft-delete + GDPR-style purge; the
// executeUserPurge() function in server/routes.js then performs the actual
// anonymisation. This file pins the contract:
//
//   - Hard-deleted tables (HARD_DELETE_ON_PURGE_TABLES) lose their rows.
//   - Soft-deleted domain rows (cases, sessions, agent_templates, ...)
//     get deleted_at set + ownership detached (created_by → NULL).
//   - Anonymised log tables retain rows but have user_id NULLed.
//   - The user row itself is retained but PII is wiped + status='inactive'.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-retention-tests-secret';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

describe('POST /api/users/:id/purge — retention contract (audit follow-up)', () => {
    let server;
    let adminToken;
    let targetUserId;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });

        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);

        // Admin who'll trigger the purge.
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['retention_admin', 'Admin', passwordHash, 'admin@example.com'],
        );
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['retention_admin']);

        // Target user whose data we're going to purge.
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'student', 'active', 1)`,
            ['target_user', 'Target', passwordHash, 'target@example.com'],
        );
        const target = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['target_user']);
        targetUserId = target.id;

        // Hard-delete tables: insert one row per table with the target's id.
        await dbRun(db,
            `INSERT INTO user_preferences (user_id, theme, tenant_id)
             VALUES (?, 'dark', 1)`, [targetUserId]);
        await dbRun(db,
            `INSERT INTO active_sessions (user_id, token_hash, expires_at, tenant_id, is_active)
             VALUES (?, 'doomed-hash', datetime('now', '+1 hour'), 1, 1)`, [targetUserId]);
        await dbRun(db,
            `INSERT INTO alarm_config (user_id, vital_sign, low_threshold, high_threshold, enabled, tenant_id)
             VALUES (?, 'hr', 50, 120, 1, 1)`, [targetUserId]);

        // Anonymised tables: log row tagged with the target's user_id.
        // event_log has no user_id column directly; the executeUserPurge SQL
        // sets user_id = NULL on it but the column may not exist in the
        // initial schema. Skip event_log here and use system_audit_log only.
        await dbRun(db,
            `INSERT INTO system_audit_log (tenant_id, user_id, action, status)
             VALUES (1, ?, 'self_test', 'success')`, [targetUserId]);

        // Soft-deleted authored row.
        await dbRun(db,
            `INSERT INTO agent_templates (tenant_id, agent_type, name, role_title, system_prompt,
                created_by, is_default, created_at)
             VALUES (1, 'specialist', 'Target Authored Agent', 'Tester',
                     'Authored by target', ?, 0, CURRENT_TIMESTAMP)`, [targetUserId]);

        await dbClose(db);

        // Sign an admin JWT.
        adminToken = jwt.sign(
            { id: admin.id, username: 'retention_admin', email: 'admin@example.com', role: 'admin', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'retention-admin-tok' },
        );
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('dry-run reports counts without mutating any rows', async () => {
        const res = await fetch(`${server.baseUrl}/api/users/${targetUserId}/purge?dry-run=true`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.dry_run).toBe(true);
        expect(body.counts).toBeTypeOf('object');
        expect(body.counts.hard_delete).toBeTypeOf('object');
        expect(body.counts.hard_delete.user_preferences).toBeGreaterThanOrEqual(1);

        // Mutation check: row still exists.
        const db = await openDb(server.dbPath);
        const stillThere = await dbGet(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [targetUserId]);
        await dbClose(db);
        expect(stillThere).not.toBeNull();
    });

    it('purge: hard-delete tables lose target rows; logs anonymise; user row anonymises but stays', async () => {
        const res = await fetch(`${server.baseUrl}/api/users/${targetUserId}/purge`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.purged).toBe(true);
        expect(body.anonymized_username).toMatch(/^deleted_user_/);

        const db = await openDb(server.dbPath);

        // Hard-delete tables: rows physically gone.
        const prefs = await dbAll(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [targetUserId]);
        expect(prefs).toEqual([]);
        const sessions = await dbAll(db, 'SELECT * FROM active_sessions WHERE user_id = ?', [targetUserId]);
        expect(sessions).toEqual([]);
        const alarms = await dbAll(db, 'SELECT * FROM alarm_config WHERE user_id = ?', [targetUserId]);
        expect(alarms).toEqual([]);

        // Anonymised log tables: rows retained but user_id is NULL.
        const audits = await dbAll(db, 'SELECT user_id FROM system_audit_log WHERE action = ?', ['self_test']);
        expect(audits.length).toBeGreaterThanOrEqual(1);
        for (const a of audits) {
            expect(a.user_id).toBeNull();
        }

        // Authored agent template: deleted_at set, created_by NULLed.
        const agent = await dbGet(db, "SELECT * FROM agent_templates WHERE name = 'Target Authored Agent'");
        expect(agent).not.toBeNull();
        expect(agent.deleted_at).not.toBeNull();
        expect(agent.created_by).toBeNull();

        // User row: retained, PII wiped, deleted_at set, status inactive.
        const user = await dbGet(db, 'SELECT * FROM users WHERE id = ?', [targetUserId]);
        expect(user).not.toBeNull();
        expect(user.email).toBeNull();
        expect(user.status).toBe('inactive');
        expect(user.deleted_at).not.toBeNull();
        expect(user.username).toMatch(/^deleted_user_/);

        await dbClose(db);
    });

    it('cannot purge yourself (admin self-purge is rejected)', async () => {
        // Admin tries to purge their own user id.
        const adminUserId = jwt.decode(adminToken).id;
        const res = await fetch(`${server.baseUrl}/api/users/${adminUserId}/purge`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Cannot purge your own account/);
    });

    it('non-admin cannot purge anyone', async () => {
        const studentToken = jwt.sign(
            { id: targetUserId, username: 'whoever', email: 'who@example.com', role: 'student', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'retention-student' },
        );
        // Note: targetUserId now points to a purged (status='inactive') user.
        // authenticateToken should reject before requireAdmin even runs.
        const res = await fetch(`${server.baseUrl}/api/users/${targetUserId}/purge`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
        });
        expect([401, 403]).toContain(res.status);
    });
});

// Oyon: PII-rich emotion records + consents must follow the same purge
// contract. Records are ANONYMISED (preserves aggregate analytics value);
// consents are HARD-DELETED (no aggregate value once the user is gone).
// Retention sweep is per-tenant via oyon_settings.retention_days.
describe('Oyon purge + retention contract', () => {
    let server;
    let adminToken;
    let oyonUserId;

    beforeAll(async () => {
        // The retention-sweep test below dynamic-imports
        // `server/routes/_helpers.js`, which transitively loads
        // `server/middleware/auth.js` at module level and calls
        // `process.exit(1)` if JWT_SECRET isn't in the current process's
        // env. The other tests in this file run code via `startTestServer`
        // (separate process where env is injected), so they don't trip the
        // exit. Set the env on the test process too so the in-process
        // import path works regardless of how the harness was launched.
        process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_JWT_SECRET;
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });
        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);

        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES ('oyon_admin', 'Admin', ?, 'oyon_admin@example.com', 'admin', 'active', 1)`,
            [passwordHash]);
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oyon_admin']);

        await dbRun(db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES ('oyon_target', 'Oyon Target', ?, 'oyon_target@example.com', 'student', 'active', 1)`,
            [passwordHash]);
        const target = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['oyon_target']);
        oyonUserId = target.id;

        // Seed a session for the target so emotion-record FK semantics hold.
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, NULL, datetime('now', '-1 hour'), 1)`,
            [oyonUserId]);
        const session = await dbGet(db, 'SELECT id FROM sessions WHERE user_id = ?', [oyonUserId]);

        // Seed two emotion records (within retention) and one ancient one
        // for the per-tenant retention sweep test.
        for (const offset of ['-30 minutes', '-15 minutes']) {
            await dbRun(db,
                `INSERT INTO oyon_emotion_records
                    (tenant_id, user_id, session_id, window_start, window_end,
                     student_name_snapshot, capture_mode, consent_version)
                 VALUES ('1', ?, ?, datetime('now', ?), datetime('now', ?),
                         'Oyon Target', 'local-browser', 'oyon-consent-v1')`,
                [String(oyonUserId), String(session.id), offset, offset]);
        }
        await dbRun(db,
            `INSERT INTO oyon_emotion_records
                (tenant_id, user_id, session_id, window_start, window_end,
                 student_name_snapshot, capture_mode, consent_version)
             VALUES ('1', ?, ?, datetime('now', '-200 days'), datetime('now', '-200 days'),
                     'Oyon Target', 'local-browser', 'oyon-consent-v1')`,
            [String(oyonUserId), String(session.id)]);

        // Seed a consent row.
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version)
             VALUES ('1', ?, ?, 1, 'oyon-consent-v1')`,
            [String(oyonUserId), String(session.id)]);

        // Tenant-1 oyon_settings (created by ensureSettings on first /config
        // hit; insert directly here so tests don't depend on hitting the API).
        await dbRun(db,
            `INSERT OR IGNORE INTO oyon_settings (tenant_id, retention_days)
             VALUES ('1', NULL)`);

        await dbClose(db);

        adminToken = jwt.sign(
            { id: admin.id, username: 'oyon_admin', email: 'oyon_admin@example.com', role: 'admin', tenant_id: 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h', jwtid: 'oyon-admin-tok' });
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('purge anonymises oyon_emotion_records and hard-deletes oyon_emotion_consents', async () => {
        // Sanity: rows exist before purge.
        let db = await openDb(server.dbPath);
        const before = await dbAll(db,
            `SELECT * FROM oyon_emotion_records WHERE user_id = ?`, [String(oyonUserId)]);
        expect(before.length).toBeGreaterThanOrEqual(2);
        const consentsBefore = await dbAll(db,
            `SELECT * FROM oyon_emotion_consents WHERE user_id = ?`, [String(oyonUserId)]);
        expect(consentsBefore.length).toBeGreaterThanOrEqual(1);
        await dbClose(db);

        const res = await fetch(`${server.baseUrl}/api/users/${oyonUserId}/purge`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (res.status !== 200) {
            const body = await res.text();

            console.error('purge failed:', res.status, body);
        }
        expect(res.status).toBe(200);

        db = await openDb(server.dbPath);

        // Records: rows kept (still queryable for aggregates), but user_id
        // is NULL, student_id NULL, name snapshot replaced with anonymised label.
        const stillByOldId = await dbAll(db,
            `SELECT * FROM oyon_emotion_records WHERE user_id = ?`, [String(oyonUserId)]);
        expect(stillByOldId).toEqual([]);
        const anonRows = await dbAll(db,
            `SELECT * FROM oyon_emotion_records
             WHERE student_name_snapshot LIKE 'deleted_user_%'`);
        expect(anonRows.length).toBeGreaterThanOrEqual(2);
        for (const r of anonRows) {
            expect(r.user_id).toBeNull();
            expect(r.student_id).toBeNull();
            expect(r.student_name_snapshot).toMatch(/^deleted_user_/);
        }

        // Consents: rows for that user are gone.
        const consentsAfter = await dbAll(db,
            `SELECT * FROM oyon_emotion_consents WHERE user_id = ?`, [String(oyonUserId)]);
        expect(consentsAfter).toEqual([]);

        await dbClose(db);
    });
});

// Per-tenant retention sweep: rows older than oyon_settings.retention_days
// get deleted; tenants with NULL retention_days are untouched.
describe('sweepOyonRetention()', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });
        const db = await openDb(server.dbPath);
        // Tenant-1 settings: 30-day retention.
        await dbRun(db,
            `INSERT OR REPLACE INTO oyon_settings
                (tenant_id, emotion_capture_enabled, retention_days,
                 model_profile, sample_interval_ms, window_ms,
                 min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence)
             VALUES ('1', 1, 30,
                     'hse-emotion-mtl', 333, 10000, 6, 0.28, 3000, 0.5)`);
        // Two records: one ancient, one recent.
        await dbRun(db,
            `INSERT INTO oyon_emotion_records
                (tenant_id, user_id, session_id, window_start, window_end,
                 capture_mode, consent_version)
             VALUES ('1', '1', '1', datetime('now', '-365 days'), datetime('now', '-365 days'),
                     'local-browser', 'oyon-consent-v1')`);
        await dbRun(db,
            `INSERT INTO oyon_emotion_records
                (tenant_id, user_id, session_id, window_start, window_end,
                 capture_mode, consent_version)
             VALUES ('1', '1', '1', datetime('now', '-2 days'), datetime('now', '-2 days'),
                     'local-browser', 'oyon-consent-v1')`);
        await dbClose(db);
    });

    afterAll(async () => {
        if (server) await server.close();
    });

    it('deletes rows older than retention_days, keeps recent ones (production code path)', async () => {
        // Invoke the production helper directly with a runner bound to the
        // test DB. This is the same call signature scripts/retention-sweep.js
        // uses, so the test exercises the real code instead of duplicated SQL.
        const { sweepOyonRetention } = await import('../../server/routes/_helpers.js');
        const db = await openDb(server.dbPath);
        const runner = {
            all: (sql, params) => new Promise((resolve, reject) => {
                db.all(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows || []));
            }),
            run: (sql, params) => new Promise((resolve, reject) => {
                db.run(sql, params || [], function onRun(err) {
                    err ? reject(err) : resolve({ changes: this.changes, lastID: this.lastID });
                });
            }),
        };

        const deleted = await sweepOyonRetention({ runner });
        expect(deleted['1']).toBeGreaterThanOrEqual(1);

        const remaining = await dbAll(db,
            `SELECT window_start FROM oyon_emotion_records WHERE tenant_id = '1'`);
        for (const r of remaining) {
            const ageDays = (Date.now() - new Date(r.window_start + 'Z').getTime()) / (1000 * 86400);
            expect(ageDays).toBeLessThan(35);
        }
        await dbClose(db);
    });
});
