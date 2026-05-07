import express from 'express';
import { findDefaultAgent } from '../db.js';
import dbAdapter from '../dbAdapter.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'node:os';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import {
    authenticateToken,
    requireAdmin,
    requireAuth,
    requireEducator,
    requireReviewer,
    generateToken,
    recordActiveSession,
    revokeActiveSessionByHash,
    ROLE_RANKS,
    AUTH_COOKIE_NAME,
    getRoleRank,
    hasRoleAtLeast,
} from '../middleware/auth.js';
import {
    CSRF_COOKIE_NAME,
    csrfCookieOptions,
    generateCsrfToken,
} from '../middleware/csrf.js';
import * as labDb from '../services/labDatabase.js';
import { spawn } from 'node:child_process';
import { buildWavHeader } from '../services/wav.js';
import { EvenByteAligner } from '../lib/pcmAlign.js';
import {
    REDACTED,
    redactPlatformSettingRows,
} from '../redaction.js';
import { logger } from '../logger.js';
import { verifyAuditChain } from '../audit-chain.js';
import {
    auditSuccess,
    buildUserPurgePlan,
    canManageOwnedResource,
    canReadAcrossUsers,
    clampInitialVitals,
    createCaseVersion,
    dbGet,
    dbRun,
    executeUserPurge,
    isValidRole,
    logAudit,
    logAuditAsync,
    mergeScenarioSource,
    parseAuditJson,
    redactAuditSetting,
    redactRow,
    redactRows,
    resolveSessionCaseConfig,
    resolveSessionCaseScenario,
    roleForStorage,
    tenantId,
    validatePassword,
    verifySessionOwnership
} from './_helpers.js';

function authCookieOptions(maxAgeSeconds = 4 * 60 * 60) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds * 1000,
    };
}

const auditLog = logger('audit');
const authLog = logger('auth');
const radiologyLog = logger('radiology');
const routesAuthLog = logger('routes-auth-users-tenants');
const routesCasesLog = logger('routes-cases-sessions');
const routesOrdersLog = logger('routes-orders-labs-radiology');
const routesLlmLog = logger('routes-llm-tts');
const routesAdminLog = logger('routes-agent-tna-admin');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const clientLogLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 60,
    message: { error: 'Too many client log batches. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.user?.tenant_id || 'tenant'}:${req.user?.id || 'user'}`
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let radiologyDatabase = [];
try {
    const radiologyPath = path.join(__dirname, '../data/radiology_database.json');
    if (fs.existsSync(radiologyPath)) {
        const data = JSON.parse(fs.readFileSync(radiologyPath, 'utf8'));
        radiologyDatabase = data.studies || [];
        radiologyLog.info('radiology database loaded', { count: radiologyDatabase.length });
    }
} catch (err) {
    radiologyLog.error('radiology database load failed', { error: err.message });
}

const router = express.Router();

router.post('/users/create', authenticateToken, requireAdmin, async (req, res) => {
    const { username, name, email, password, role = 'student' } = req.body;
    const finalRole = roleForStorage(role);

    // Validation
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (!isValidRole(finalRole)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    if (getRoleRank(finalRole) > getRoleRank(req.user)) {
        return res.status(403).json({ error: 'Cannot grant a role higher than your own' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.errors.join('. ') });
    }

    try {
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert user
        const sql = `INSERT INTO users (username, name, email, password_hash, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`;
        dbAdapter.run(sql, [username, name || null, email, password_hash, finalRole, tenantId(req)], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: 'Failed to create user' });
            }

            auditSuccess(req, {
                action: 'admin_create_user',
                resourceType: 'user',
                resourceId: String(this.lastID),
                resourceName: username,
                newValue: { username, email, role: finalRole, tenant_id: tenantId(req) }
            });

            res.status(201).json({
                message: 'User created successfully',
                user: { id: this.lastID, username, name, email, role: finalRole, tenant_id: tenantId(req) }
            });
        });
    } catch (err) {
        (req.log || routesAuthLog).error('user create failed', { error: err.message });
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// POST /api/users/batch - Batch create users from CSV (Admin only)
router.post('/users/batch', authenticateToken, requireAdmin, async (req, res) => {
    const { users } = req.body;

    if (!users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ error: 'Users array is required' });
    }

    const results = {
        success: [],
        failed: []
    };

    for (const userData of users) {
        const { username, name, email, password, role = 'student' } = userData;
        const finalRole = roleForStorage(role);

        // Validation
        if (!username || !email || !password) {
            results.failed.push({ 
                username, 
                name,
                email, 
                error: 'Missing required fields' 
            });
            continue;
        }
        if (!isValidRole(finalRole)) {
            results.failed.push({
                username,
                name,
                email,
                error: 'Invalid role'
            });
            continue;
        }
        if (getRoleRank(finalRole) > getRoleRank(req.user)) {
            results.failed.push({
                username,
                name,
                email,
                error: 'Cannot grant a role higher than your own'
            });
            continue;
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            results.failed.push({
                username,
                name,
                email,
                error: passwordValidation.errors.join('. ')
            });
            continue;
        }

        try {
            // Hash password
            const password_hash = await bcrypt.hash(password, 10);

            // Insert user
            await new Promise((resolve, reject) => {
                const sql = `INSERT INTO users (username, name, email, password_hash, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`;
                dbAdapter.run(sql, [username, name || null, email, password_hash, finalRole, tenantId(req)], function (err) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            reject({ error: 'Username or email already exists' });
                        } else {
                            reject({ error: err.message });
                        }
                    } else {
                        resolve({ id: this.lastID, username, name, email, role: finalRole, tenant_id: tenantId(req) });
                    }
                });
            });

            results.success.push({ username, name, email, role: finalRole, tenant_id: tenantId(req) });
        } catch (err) {
            results.failed.push({ 
                username,
                name, 
                email, 
                error: err.error || 'Unknown error' 
            });
        }
    }

    auditSuccess(req, {
        action: 'admin_batch_create_users',
        resourceType: 'user_batch',
        resourceId: `batch-${Date.now()}`,
        newValue: {
            success: results.success.map(u => ({ username: u.username, email: u.email, role: u.role, tenant_id: u.tenant_id })),
            failed: results.failed.map(u => ({ username: u.username, email: u.email, error: u.error }))
        },
        metadata: { succeeded: results.success.length, failed: results.failed.length }
    });

    res.json({
        message: `Batch upload complete: ${results.success.length} succeeded, ${results.failed.length} failed`,
        results
    });
});

// POST /api/tenants - Create a tenant shell for future enterprise deployments.
// E6 keeps admins tenant-local; cross-tenant super-admin views and bulk user
// migration tooling are explicitly deferred.

router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT id, username, name, email, role, tenant_id, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC`;
    dbAdapter.all(sql, [tenantId(req)], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ users: rows });
    });
});

// --- USER PREFERENCES (declared early) ---
//
// Stage-E5 fix: moved BEFORE /users/:id so Express matches /users/preferences
// directly. Pre-fix /users/:id (declared first, with requireAdmin) intercepted
// the request as id="preferences", returned 404 "User not found", and silently
// broke both reads and writes of user prefs. Stage 7's audit-auth.sh asserted
// the absence of the literal apiKey in the body, which was vacuously true
// for the 404 response — the bug only surfaced when audit-redaction.sh
// asserted [redacted] PRESENCE.
router.get('/users/preferences', authenticateToken, (req, res) => {
    dbAdapter.get(
        `SELECT * FROM user_preferences WHERE user_id = ? AND tenant_id = ?`,
        [req.user.id, tenantId(req)],
        (err, prefs) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!prefs) {
                return res.json({
                    theme: 'dark',
                    language: 'en',
                    notification_settings: null,
                    dashboard_layout: null,
                    default_llm_settings: null,
                    default_monitor_settings: null
                });
            }
            res.json(redactRow(prefs));
        }
    );
});

router.put('/users/preferences', authenticateToken, (req, res) => {
    const { theme, language, notification_settings, dashboard_layout, default_llm_settings, default_monitor_settings, accessibility_settings } = req.body;

    dbAdapter.get(`SELECT * FROM user_preferences WHERE user_id = ? AND tenant_id = ?`, [req.user.id, tenantId(req)], (readErr, oldPrefs) => {
        if (readErr) return res.status(500).json({ error: readErr.message });

        dbAdapter.run(
            `INSERT INTO user_preferences (user_id, theme, language, notification_settings, dashboard_layout, default_llm_settings, default_monitor_settings, accessibility_settings, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             theme = excluded.theme,
             language = excluded.language,
             notification_settings = excluded.notification_settings,
             dashboard_layout = excluded.dashboard_layout,
             default_llm_settings = excluded.default_llm_settings,
             default_monitor_settings = excluded.default_monitor_settings,
             accessibility_settings = excluded.accessibility_settings,
             updated_at = CURRENT_TIMESTAMP`,
            [
                req.user.id,
                theme || 'dark',
                language || 'en',
                notification_settings ? JSON.stringify(notification_settings) : null,
                dashboard_layout ? JSON.stringify(dashboard_layout) : null,
                default_llm_settings ? JSON.stringify(default_llm_settings) : null,
                default_monitor_settings ? JSON.stringify(default_monitor_settings) : null,
                accessibility_settings ? JSON.stringify(accessibility_settings) : null,
                tenantId(req)
            ],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                auditSuccess(req, {
                    action: 'update_user_preferences',
                    resourceType: 'user_preferences',
                    resourceId: String(req.user.id),
                    oldValue: oldPrefs,
                    newValue: {
                        theme: theme || 'dark',
                        language: language || 'en',
                        notification_settings,
                        dashboard_layout,
                        default_llm_settings: default_llm_settings ? redactAuditSetting('default_llm_settings', JSON.stringify(default_llm_settings)) : null,
                        default_monitor_settings,
                        accessibility_settings
                    }
                });
                res.json({ message: 'Preferences updated' });
            }
        );
    });
});

// GET /api/users/:id - Get user details (Admin only)
router.get('/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT id, username, name, email, role, tenant_id, created_at FROM users WHERE id = ? AND tenant_id = ?`;
    dbAdapter.get(sql, [req.params.id, tenantId(req)], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (String(req.params.id) !== String(req.user.id)) {
            auditSuccess(req, {
                action: 'read_user_profile_admin',
                resourceType: 'user',
                resourceId: String(req.params.id),
                resourceName: user.username,
                newValue: { fields: ['id', 'username', 'name', 'email', 'role', 'created_at'] }
            });
        }
        res.json({ user });
    });
});

// PUT /api/users/:id - Update user (Admin only)
//
// Stage-7 audit: log password resets and role changes. Pre-fix admins
// could rotate passwords or escalate roles silently — no audit trail for
// incident response.
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { username, name, email, role, password } = req.body;
    const targetUserId = req.params.id;
    const requestedRole = roleForStorage(role, null);

    // Read prior state so we can record what changed.
    const prior = await new Promise((resolve) => {
        dbAdapter.get('SELECT username, role, tenant_id FROM users WHERE id = ? AND tenant_id = ?', [targetUserId, tenantId(req)], (err, row) => {
            if (err) return resolve(null);
            resolve(row);
        });
    });

    const logUserChange = ({ passwordReset, roleChanged }) => {
        if (!passwordReset && !roleChanged) return;
        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: passwordReset && roleChanged
                ? 'admin_user_password_and_role_change'
                : passwordReset ? 'admin_user_password_reset' : 'admin_user_role_change',
            targetType: 'user',
            targetId: targetUserId,
            oldValue: prior ? { role: prior.role } : null,
            newValue: { role: requestedRole ?? prior?.role }
        });
    };

    try {
        if (!prior) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (requestedRole && !isValidRole(requestedRole)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        if (requestedRole && getRoleRank(requestedRole) > getRoleRank(req.user)) {
            return res.status(403).json({ error: 'Cannot grant a role higher than your own' });
        }
        const finalRole = requestedRole || prior.role;

        // If password is provided, validate and hash it
        if (password) {
            const passwordValidation = validatePassword(password);
            if (!passwordValidation.valid) {
                return res.status(400).json({ error: passwordValidation.errors.join('. ') });
            }
            const password_hash = await bcrypt.hash(password, 10);
            const sql = `UPDATE users SET username = ?, name = ?, email = ?, role = ?, password_hash = ? WHERE id = ? AND tenant_id = ?`;
            dbAdapter.run(sql, [username, name || null, email, finalRole, password_hash, targetUserId, tenantId(req)], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: 'Failed to update user' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                logUserChange({ passwordReset: true, roleChanged: prior.role !== finalRole });
                res.json({ message: 'User updated successfully', id: targetUserId });
            });
        } else {
            // Update without changing password
            const sql = `UPDATE users SET username = ?, name = ?, email = ?, role = ? WHERE id = ? AND tenant_id = ?`;
            dbAdapter.run(sql, [username, name || null, email, finalRole, targetUserId, tenantId(req)], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: 'Failed to update user' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                logUserChange({ passwordReset: false, roleChanged: prior.role !== finalRole });
                res.json({ message: 'User updated successfully', id: targetUserId });
            });
        }
    } catch (err) {
        (req.log || routesAuthLog).error('user update failed', { error: err.message });
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// POST /api/users/:id/purge - GDPR-style same-tenant purge (Admin only)
router.post('/users/:id/purge', authenticateToken, requireAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    // Use bracket notation: req.query.dry-run is parsed as a subtraction expression in JS.
    const dryRun = String(req.query['dry-run'] || req.query.dry_run || '').toLowerCase() === 'true';

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'Invalid user id' });
    }
    if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot purge your own account' });
    }

    try {
        const targetUser = await dbGet(
            'SELECT id, username, email, role, tenant_id, deleted_at FROM users WHERE id = ? AND tenant_id = ?',
            [userId, tenantId(req)]
        );
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { plan, authoredCaseIds } = await buildUserPurgePlan(userId, tenantId(req));
        const responsePlan = {
            target_user_id: userId,
            tenant_id: tenantId(req),
            dry_run: dryRun,
            policy: {
                soft_delete: 'Strict erasure: user-authored domain rows are hidden with deleted_at and nullable owner ids are detached.',
                hard_delete: 'Ephemeral preferences/session/config rows are physically deleted on purge.',
                retained_logs: 'Time-bounded logs keep operational rows but target user_id is anonymized to NULL until retention sweep deletes by age.',
                user_row: 'The user ownership row is retained, deactivated, and PII is nulled.'
            },
            counts: plan
        };

        if (dryRun) {
            return res.json(responsePlan);
        }

        const anonymizedUsername = `deleted_user_${userId}`;
        const passwordHash = await bcrypt.hash(`purged-${userId}-${Date.now()}`, 10);

        await logAuditAsync({
            userId: req.user.id,
            username: req.user.username,
            action: 'purge_user',
            resourceType: 'user',
            resourceId: String(userId),
            resourceName: targetUser.username,
            oldValue: {
                id: targetUser.id,
                username: targetUser.username,
                email_present: Boolean(targetUser.email),
                role: targetUser.role
            },
            newValue: {
                username: anonymizedUsername,
                email: null,
                status: 'inactive',
                deleted_at: 'CURRENT_TIMESTAMP',
                counts: plan
            },
            metadata: {
                dry_run: false,
                authored_case_ids: authoredCaseIds
            },
            tenantId: tenantId(req),
            ipAddress: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers?.['user-agent']
        });

        await executeUserPurge({
            userId,
            tenant_id: tenantId(req),
            anonymizedUsername,
            passwordHash,
            authoredCaseIds
        });

        res.json({ ...responsePlan, purged: true, anonymized_username: anonymizedUsername });
    } catch (err) {
        (req.log || routesAuthLog).error('user purge failed', { error: err.message });
        res.status(500).json({ error: 'Failed to purge user', details: err.message });
    }
});

// DELETE /api/users/:id - Delete user (Admin only)
router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
    // Prevent deleting yourself
    if (parseInt(req.params.id) === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const userId = req.params.id;

    dbAdapter.get('SELECT id, username, email, role, tenant_id FROM users WHERE id = ? AND tenant_id = ?', [userId, tenantId(req)], (targetErr, targetUser) => {
        if (targetErr) return res.status(500).json({ error: targetErr.message });
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

    dbAdapter.get('SELECT COUNT(*) as count FROM case_versions WHERE changed_by = ?', [userId], (versionErr, versionRow) => {
        if (versionErr) return res.status(500).json({ error: versionErr.message });
        if ((versionRow?.count || 0) > 0) {
            return res.status(409).json({
                error: 'Cannot delete user with immutable case-version audit history',
                deferred_stage: 'E7'
            });
        }

        dbAdapter.serialize(() => {
            dbAdapter.run('BEGIN');
            const cleanupSteps = [
                ['DELETE FROM active_sessions WHERE user_id = ?', [userId]],
                ['DELETE FROM user_preferences WHERE user_id = ?', [userId]],
                ['DELETE FROM session_notes WHERE user_id = ?', [userId]],
                ['DELETE FROM questionnaire_responses WHERE user_id = ?', [userId]],
                ['DELETE FROM alarm_config WHERE user_id = ?', [userId]],
                ['DELETE FROM clinical_notes WHERE user_id = ?', [userId]],
                ['DELETE FROM export_records WHERE user_id = ?', [userId]],
                ['DELETE FROM llm_usage WHERE user_id = ?', [userId]],
                ['DELETE FROM tts_usage WHERE user_id = ?', [userId]],
                ['UPDATE sessions SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE event_log SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE login_logs SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE settings_logs SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE session_settings SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE learning_events SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE physical_exam_findings SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE system_audit_log SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE lab_definitions SET created_by = NULL WHERE created_by = ?', [userId]],
                ['UPDATE platform_settings SET updated_by = NULL WHERE updated_by = ?', [userId]],
                ['UPDATE scenarios SET created_by = NULL WHERE created_by = ?', [userId]],
                ['UPDATE scenario_templates SET created_by = NULL WHERE created_by = ?', [userId]],
                ['UPDATE agent_templates SET created_by = NULL WHERE created_by = ?', [userId]],
                ['UPDATE cases SET created_by = NULL WHERE created_by = ?', [userId]],
                ['UPDATE cases SET last_modified_by = NULL WHERE last_modified_by = ?', [userId]],
                ['UPDATE scenario_events SET acknowledged_by = NULL WHERE acknowledged_by = ?', [userId]],
                ['UPDATE emotion_logs SET user_id = NULL WHERE user_id = ?', [userId]],
                ['UPDATE llm_request_log SET user_id = NULL WHERE user_id = ?', [userId]]
            ];

            const runCleanup = (idx) => {
                if (idx >= cleanupSteps.length) {
                    dbAdapter.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
                        if (err) {
                            dbAdapter.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                        }
                        if (this.changes === 0) {
                            dbAdapter.run('ROLLBACK');
                            return res.status(404).json({ error: 'User not found' });
                        }
                        dbAdapter.run('COMMIT');
                        auditSuccess(req, {
                            action: 'admin_delete_user',
                            resourceType: 'user',
                            resourceId: userId,
                            resourceName: targetUser.username,
                            oldValue: targetUser
                        });
                        return res.json({ message: 'User deleted successfully', id: userId });
                    });
                    return;
                }

                const [sql, params] = cleanupSteps[idx];
                dbAdapter.run(sql, params, (err) => {
                    if (err) {
                        dbAdapter.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    runCleanup(idx + 1);
                });
            };

            runCleanup(0);
        });
    });
    });
});

// --- ANALYTICS ---

// GET /api/analytics/sessions - Get sessions (Admin: all, User: their own)

function handleSystemAuditLogRequest(req, res) {
    const { limit = 100, offset = 0, action, resource_type, user_id, from_date, to_date } = req.query;

    let sql = `SELECT sal.*, u.username as user_username
               FROM system_audit_log sal
               LEFT JOIN users u ON sal.user_id = u.id
               WHERE sal.tenant_id = ?`;
    const params = [tenantId(req)];

    if (action) {
        sql += ` AND sal.action = ?`;
        params.push(action);
    }
    if (resource_type) {
        sql += ` AND sal.resource_type = ?`;
        params.push(resource_type);
    }
    if (user_id) {
        sql += ` AND sal.user_id = ?`;
        params.push(user_id);
    }
    if (from_date) {
        sql += ` AND sal.timestamp >= ?`;
        params.push(from_date);
    }
    if (to_date) {
        sql += ` AND sal.timestamp <= ?`;
        params.push(to_date);
    }

    sql += ` ORDER BY sal.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    dbAdapter.all(sql, params, (err, logs) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: redactRows(logs, { pii: 'allow', internal: 'allow' }) });
    });
}

// GET /api/admin/audit-log - Get system audit log (Admin only)
router.get('/admin/audit-log', authenticateToken, requireAdmin, (req, res) => {
    handleSystemAuditLogRequest(req, res);
});

// GET /api/admin/audit/verify - Verify tenant-scoped audit hash chain.
router.get('/admin/audit/verify', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await verifyAuditChain({ tenant_id: tenantId(req) });
        res.json({
            ok: result.ok,
            lastVerifiedId: result.lastVerifiedId,
            brokenAt: result.brokenAt,
        });
    } catch (err) {
        (req.log || routesAdminLog).error('audit chain verify failed', { error: err.message });
        res.status(500).json({ error: 'Failed to verify audit chain' });
    }
});

// GET /api/system-audit-log - Alias for audit scripts and enterprise integrations.
router.get('/system-audit-log', authenticateToken, requireAdmin, handleSystemAuditLogRequest);

// --- VITAL SIGN HISTORY ---

// POST /api/sessions/:sessionId/vitals - Record a vital sign reading

router.get('/admin/active-sessions', authenticateToken, requireAdmin, (req, res) => {
    dbAdapter.all(
        `SELECT acs.*, u.username, u.email, u.role
         FROM active_sessions acs
         LEFT JOIN users u ON acs.user_id = u.id
         WHERE acs.tenant_id = ? AND acs.is_active = 1 AND (acs.expires_at IS NULL OR acs.expires_at > datetime('now'))
         ORDER BY acs.last_activity_at DESC`,
        [tenantId(req)],
        (err, sessions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ sessions: redactRows(sessions, { pii: 'allow', internal: 'allow' }) });
        }
    );
});

// DELETE /api/admin/active-sessions/:id - Force logout a session (Admin only)
router.delete('/admin/active-sessions/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress;

    dbAdapter.run(
        `UPDATE active_sessions SET is_active = 0 WHERE id = ? AND tenant_id = ?`,
        [id, tenantId(req)],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Session not found' });
            }

            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'FORCE_LOGOUT',
                resourceType: 'active_session',
                resourceId: id,
                ipAddress,
                status: 'success'
            });

            res.json({ message: 'Session terminated' });
        }
    );
});

// --- DATABASE STATISTICS ---

// GET /api/admin/database-stats - Get database statistics (Admin only)

router.get('/user/profile', authenticateToken, (req, res) => {
    dbAdapter.get(
        `SELECT id, username, name, email, role, department, institution, address, phone,
                alternative_email, education, grade, created_at, updated_at, last_login
         FROM users WHERE id = ? AND deleted_at IS NULL`,
        [req.user.id],
        (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(404).json({ error: 'User not found' });
            res.json({ user });
        }
    );
});

// PUT /api/user/profile - Update current user's profile
router.put('/user/profile', authenticateToken, (req, res) => {
    const { name, institution, address, phone, alternative_email, education, grade } = req.body;

    // Note: username and email cannot be changed by the user
    dbAdapter.run(
        `UPDATE users SET
            name = COALESCE(?, name),
            institution = ?,
            address = ?,
            phone = ?,
            alternative_email = ?,
            education = ?,
            grade = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deleted_at IS NULL`,
        [name, institution, address, phone, alternative_email, education, grade, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'User not found' });

            // Return updated profile
            dbAdapter.get(
                `SELECT id, username, name, email, role, department, institution, address, phone,
                        alternative_email, education, grade, created_at, updated_at
                 FROM users WHERE id = ?`,
                [req.user.id],
                (err, user) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Profile updated', user });
                }
            );
        }
    );
});

// PUT /api/user/password - Change current user's password
router.put('/user/password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.errors.join('. ') });
    }

    try {
        // Get current user
        const user = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password (using bcrypt imported at top of file)
        const isValid = await bcrypt.compare(current_password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const newHash = await bcrypt.hash(new_password, 10);

        // Update password
        dbAdapter.run(
            'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newHash, req.user.id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                // Stage-7 audit: log every password change. Other sensitive
                // mutations (case edits, agent edits, session ends) all call
                // logAudit() — password changes were the gap. Don't log the
                // password itself, only the action + user identity.
                logAudit({
                    userId: req.user.id,
                    username: req.user.username,
                    action: 'change_password_self',
                    targetType: 'user',
                    targetId: req.user.id
                });
                res.json({ message: 'Password changed successfully' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PLATFORM SETTINGS - USER FIELD CONFIGURATION
// ============================================

// Default user field configuration

export default router;
