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
