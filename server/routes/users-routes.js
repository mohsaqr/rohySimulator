import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import {
    authenticateToken,
    requireAdmin,
    getRoleRank,
} from '../middleware/auth.js';




import { logger } from '../logger.js';
import { verifyAuditChain } from '../audit-chain.js';
import {
    auditSuccess,
    buildUserPurgePlan,
    dbGet,
    ensureAutoEnrollMemberships,
    executeUserPurge,
    isValidRole,
    logAudit,
    logAuditAsync,
    redactAuditSetting,
    redactRow,
    redactRows,
    roleForStorage,
    tenantId,
    validatePassword
} from './_helpers.js';

const radiologyLog = logger('radiology');
const routesAuthLog = logger('routes-auth-users-tenants');
const routesAdminLog = logger('routes-agent-tna-admin');

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

// Idempotent, revive-aware enrol of a user into a cohort (local to import).
async function enrollUserInCohort(cohortId, userId) {
    const existing = await dbAdapter.get(
        `SELECT id, deleted_at FROM cohort_members WHERE cohort_id = ? AND user_id = ?
          ORDER BY (deleted_at IS NULL) DESC, id DESC LIMIT 1`,
        [cohortId, userId]
    );
    if (existing && existing.deleted_at == null) return 'already';
    if (existing) {
        // Fresh re-enrolment on revive (mirror upsertMember): reset lifecycle to
        // active + clear the window so access is actually restored.
        await dbAdapter.run(
            `UPDATE cohort_members SET deleted_at = NULL, status = 'active', enrolled_from = NULL, enrolled_until = NULL WHERE id = ?`,
            [existing.id]
        );
        return 'revived';
    }
    await dbAdapter.run(`INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)`, [cohortId, userId]);
    return 'enrolled';
}

// POST /api/users/import - Wizard commit: create users AND enrol them into a
// class, with a validate-only `dryRun`. Reuses the batch validation rules and
// leaves /users/batch untouched. A per-row `class` (name or join_code) overrides
// the top-level `cohortId`. Returns per-row created/enrolled/skipped/failed so
// the client can build a downloadable error report.
router.post('/users/import', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { rows, cohortId, dryRun } = req.body || {};
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'rows must be a non-empty array' });
        }
        const tid = tenantId(req);
        const results = { created: [], enrolled: [], skipped: [], failed: [] };

        const existingUsers = await dbAdapter.all(
            `SELECT id, username, email FROM users WHERE tenant_id = ? AND deleted_at IS NULL`, [tid]
        );
        const byUsername = new Map(existingUsers.map(u => [String(u.username).toLowerCase(), u]));
        const byEmail = new Map(existingUsers.map(u => [String(u.email).toLowerCase(), u]));
        const seenInFile = new Set();

        let topCohort = null;
        if (cohortId) {
            topCohort = await dbAdapter.get(
                `SELECT id, name FROM cohorts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [cohortId, tid]
            );
            if (!topCohort) return res.status(400).json({ error: 'cohortId is not a valid class in this tenant' });
        }

        for (let i = 0; i < rows.length; i++) {
            const raw = rows[i] || {};
            const username = String(raw.username || '').trim();
            const email = String(raw.email || '').trim();
            const name = String(raw.name || '').trim();
            const password = raw.password || '';
            const finalRole = roleForStorage(raw.role || 'student');
            const className = String(raw.class || raw.cohort || '').trim();
            const rowNo = i + 1;
            const fail = (error) => results.failed.push({ row: rowNo, username, email, role: raw.role || 'student', class: className, error });

            if (!username || !email) { fail('Missing username or email'); continue; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail('Invalid email format'); continue; }
            if (!isValidRole(finalRole)) { fail('Invalid role'); continue; }
            if (getRoleRank(finalRole) > getRoleRank(req.user)) { fail('Cannot grant a role higher than your own'); continue; }

            const uKey = username.toLowerCase();
            const eKey = email.toLowerCase();
            if (seenInFile.has(uKey) || seenInFile.has(eKey)) { fail('Duplicate row in file'); continue; }
            seenInFile.add(uKey); seenInFile.add(eKey);

            let cohort = topCohort;
            if (className) {
                cohort = await dbAdapter.get(
                    `SELECT id, name FROM cohorts WHERE (name = ? OR join_code = ?) AND tenant_id = ? AND deleted_at IS NULL
                      ORDER BY (name = ?) DESC LIMIT 1`,
                    [className, className, tid, className]
                );
                if (!cohort) { fail(`Unknown class "${className}"`); continue; }
            }

            const existing = byUsername.get(uKey) || byEmail.get(eKey);
            if (existing) {
                if (!cohort) { results.skipped.push({ row: rowNo, username, email, reason: 'already exists (no class to enrol into)' }); continue; }
                if (dryRun) { results.enrolled.push({ row: rowNo, username: existing.username, class: cohort.name, existing: true }); continue; }
                const outcome = await enrollUserInCohort(cohort.id, existing.id);
                results.enrolled.push({ row: rowNo, username: existing.username, class: cohort.name, existing: true, outcome });
                continue;
            }

            if (!password) { fail('Password required for a new user'); continue; }
            const pv = validatePassword(password);
            if (!pv.valid) { fail(pv.errors.join('. ')); continue; }

            if (dryRun) { results.created.push({ row: rowNo, username, email, role: finalRole, class: cohort?.name || null }); continue; }

            try {
                const password_hash = await bcrypt.hash(password, 10);
                const newId = await new Promise((resolve, reject) => {
                    dbAdapter.run(
                        `INSERT INTO users (username, name, email, password_hash, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
                        [username, name || null, email, password_hash, finalRole, tid],
                        function (err) {
                            if (err) return reject(err.message?.includes('UNIQUE') ? new Error('Username or email already exists') : err);
                            resolve(this.lastID);
                        }
                    );
                });
                results.created.push({ row: rowNo, id: newId, username, email, role: finalRole, class: cohort?.name || null });
                await ensureAutoEnrollMemberships(newId, tid);
                if (cohort) {
                    const outcome = await enrollUserInCohort(cohort.id, newId);
                    results.enrolled.push({ row: rowNo, username, class: cohort.name, outcome });
                }
                byUsername.set(uKey, { id: newId, username, email });
                byEmail.set(eKey, { id: newId, username, email });
            } catch (err) {
                fail(err.message || 'Insert failed');
            }
        }

        if (!dryRun) {
            auditSuccess(req, {
                action: 'admin_import_users', resourceType: 'user_batch', resourceId: `import-${Date.now()}`,
                metadata: {
                    created: results.created.length, enrolled: results.enrolled.length,
                    skipped: results.skipped.length, failed: results.failed.length, cohort_id: cohortId || null,
                },
            });
        }
        res.json({ dryRun: !!dryRun, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tenants - Create a tenant shell for future enterprise deployments.
// E6 keeps admins tenant-local; cross-tenant super-admin views and bulk user
// migration tooling are explicitly deferred.

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    // Additive: extra columns (status, last_login, department, deleted_at) plus
    // an opt-in `?include=memberships` join. The WHERE clause is unchanged so
    // existing consumers (PeoplePicker, cohortsService.listTenantUsers) see the
    // same row set, just with more fields.
    try {
        const users = await dbAdapter.all(
            `SELECT id, username, name, email, role, status, last_login, department, tenant_id, created_at, deleted_at
               FROM users WHERE tenant_id = ? ORDER BY created_at DESC`,
            [tenantId(req)]
        );
        const includeMemberships = String(req.query.include || '').split(',').includes('memberships');
        if (includeMemberships && users.length) {
            const rows = await dbAdapter.all(
                `SELECT cm.user_id, co.id AS cohort_id, co.name AS cohort_name,
                        cm.member_role, cm.status AS enrollment_status
                   FROM cohort_members cm
                   JOIN cohorts co ON co.id = cm.cohort_id AND co.deleted_at IS NULL
                  WHERE cm.deleted_at IS NULL AND co.tenant_id = ?
                  ORDER BY co.name ASC`,
                [tenantId(req)]
            );
            const byUser = new Map();
            for (const r of rows) {
                if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
                byUser.get(r.user_id).push({
                    cohort_id: r.cohort_id, name: r.cohort_name,
                    member_role: r.member_role, enrollment_status: r.enrollment_status,
                });
            }
            for (const u of users) u.memberships = byUser.get(u.id) || [];
        }
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
                // language: null (not 'en') — "no preference stored" must stay
                // distinguishable from a deliberate English pick, or the client
                // overwrites the user's pre-login localStorage choice with 'en'
                // on every refresh (LanguageContext falls back correctly on null).
                return res.json({
                    theme: 'dark',
                    language: null,
                    notification_settings: null,
                    dashboard_layout: null,
                    default_llm_settings: null,
                    default_monitor_settings: null,
                    onboarding_settings: null
                });
            }
            res.json(redactRow(prefs));
        }
    );
});

// PUT is a MERGE, not a replace: fields absent from the body keep their
// stored value. Until 2026-07-08 this was a full-replace upsert, so the
// profile panel saving only { default_llm_settings } silently reset
// language and theme back to defaults on every AI-settings save.
router.put('/users/preferences', authenticateToken, (req, res) => {
    const { theme, language, notification_settings, dashboard_layout, default_llm_settings, default_monitor_settings, accessibility_settings, onboarding_settings } = req.body;

    dbAdapter.get(`SELECT * FROM user_preferences WHERE user_id = ? AND tenant_id = ?`, [req.user.id, tenantId(req)], (readErr, oldPrefs) => {
        if (readErr) return res.status(500).json({ error: readErr.message });

        // JSON columns are stored (and arrive in oldPrefs) as strings;
        // body values arrive as objects. undefined = "not in this PUT".
        const keepOrJson = (incoming, stored) =>
            incoming !== undefined
                ? (incoming ? JSON.stringify(incoming) : null)
                : (stored ?? null);

        // Stored JSON string → object, tolerating NULL and legacy garbage.
        const parseStored = (stored) => {
            try { return JSON.parse(stored || '{}') || {}; } catch { return {}; }
        };

        const merged = {
            theme: theme !== undefined ? (theme || 'dark') : (oldPrefs?.theme || 'dark'),
            // NULL, never a fabricated 'en': a first-ever PUT that only carries
            // default_llm_settings must not mint a row claiming the user chose
            // English (that row would defeat the GET null-language fallback).
            language: language !== undefined ? (language || null) : (oldPrefs?.language ?? null),
            notification_settings: keepOrJson(notification_settings, oldPrefs?.notification_settings),
            dashboard_layout: keepOrJson(dashboard_layout, oldPrefs?.dashboard_layout),
            default_llm_settings: keepOrJson(default_llm_settings, oldPrefs?.default_llm_settings),
            default_monitor_settings: keepOrJson(default_monitor_settings, oldPrefs?.default_monitor_settings),
            accessibility_settings: keepOrJson(accessibility_settings, oldPrefs?.accessibility_settings),
            // Onboarding keys are SHALLOW-MERGED, not replaced: the first-run
            // screen writes { first_run_done, voice_mode, oyon_consent } once,
            // but later single-key writes (a consent flip in Settings → Oyon)
            // must not erase the sibling keys.
            onboarding_settings: onboarding_settings !== undefined
                ? JSON.stringify({
                    ...parseStored(oldPrefs?.onboarding_settings),
                    ...(onboarding_settings && typeof onboarding_settings === 'object' ? onboarding_settings : {})
                  })
                : (oldPrefs?.onboarding_settings ?? null)
        };

        dbAdapter.run(
            `INSERT INTO user_preferences (user_id, theme, language, notification_settings, dashboard_layout, default_llm_settings, default_monitor_settings, accessibility_settings, onboarding_settings, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             theme = excluded.theme,
             language = excluded.language,
             notification_settings = excluded.notification_settings,
             dashboard_layout = excluded.dashboard_layout,
             default_llm_settings = excluded.default_llm_settings,
             default_monitor_settings = excluded.default_monitor_settings,
             accessibility_settings = excluded.accessibility_settings,
             onboarding_settings = excluded.onboarding_settings,
             updated_at = CURRENT_TIMESTAMP`,
            [
                req.user.id,
                merged.theme,
                merged.language,
                merged.notification_settings,
                merged.dashboard_layout,
                merged.default_llm_settings,
                merged.default_monitor_settings,
                merged.accessibility_settings,
                merged.onboarding_settings,
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
                        ...merged,
                        default_llm_settings: merged.default_llm_settings ? redactAuditSetting('default_llm_settings', merged.default_llm_settings) : null
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

// GET /api/users/:id/detail - Rich user detail for the admin workspace drawer:
// profile + class memberships + inherited (class-assigned) cases + session count.
router.get('/users/:id/detail', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const tid = tenantId(req);
        const user = await dbAdapter.get(
            `SELECT id, username, name, email, role, status, last_login, department, institution,
                    tenant_id, created_at
               FROM users WHERE id = ? AND tenant_id = ?`,
            [id, tid]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        const memberships = await dbAdapter.all(
            `SELECT co.id AS cohort_id, co.name, cm.member_role, cm.status AS enrollment_status
               FROM cohort_members cm
               JOIN cohorts co ON co.id = cm.cohort_id AND co.deleted_at IS NULL
              WHERE cm.user_id = ? AND cm.deleted_at IS NULL AND co.tenant_id = ?
              ORDER BY co.name ASC`,
            [id, tid]
        );
        const inherited = await dbAdapter.all(
            `SELECT DISTINCT ca.id, ca.name
               FROM cohort_members cm
               JOIN cohorts co ON co.id = cm.cohort_id AND co.deleted_at IS NULL
               JOIN cohort_cases cc ON cc.cohort_id = co.id AND cc.deleted_at IS NULL
               JOIN cases ca ON ca.id = cc.case_id AND ca.deleted_at IS NULL
              WHERE cm.user_id = ? AND cm.deleted_at IS NULL AND cm.status = 'active' AND co.tenant_id = ?
              ORDER BY ca.name ASC`,
            [id, tid]
        );
        const sc = await dbAdapter.get(
            `SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
            [id, tid]
        );
        if (String(id) !== String(req.user.id)) {
            auditSuccess(req, { action: 'read_user_detail_admin', resourceType: 'user', resourceId: String(id), resourceName: user.username });
        }
        res.json({ user, memberships, inherited_cases: inherited, session_count: sc?.n || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/users/:id/status - Set account status (active|inactive|suspended).
router.patch('/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const status = req.body?.status;
        if (!['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({ error: "status must be 'active', 'inactive', or 'suspended'" });
        }
        if (String(id) === String(req.user.id) && status !== 'active') {
            return res.status(400).json({ error: 'You cannot deactivate your own account' });
        }
        const target = await dbAdapter.get(
            'SELECT id, username, role, status FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [id, tenantId(req)]
        );
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (getRoleRank(target.role) >= getRoleRank(req.user.role)) {
            return res.status(403).json({ error: 'Cannot modify a user at or above your role' });
        }
        await dbAdapter.run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?', [status, id, tenantId(req)]);
        auditSuccess(req, {
            action: 'admin_user_status_change', resourceType: 'user', resourceId: String(id),
            resourceName: target.username, oldValue: { status: target.status }, newValue: { status },
        });
        res.json({ updated: true, status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/bulk-action - Apply role/suspend/reactivate to many users.
// Delete is intentionally excluded (single DELETE /users/:id keeps the hard
// cascade + case-version protection). Each row guarded (no self, rank ceiling).
router.post('/users/bulk-action', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { action, ids, value } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids must be a non-empty array' });
        }
        if (!['role', 'suspend', 'reactivate'].includes(action)) {
            return res.status(400).json({ error: "action must be 'role', 'suspend', or 'reactivate'" });
        }
        const tid = tenantId(req);
        const results = { success: [], failed: [] };
        for (const rawId of ids) {
            const id = Number(rawId);
            try {
                if (String(id) === String(req.user.id)) { results.failed.push({ id, error: 'cannot act on self' }); continue; }
                const target = await dbAdapter.get('SELECT id, username, role FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tid]);
                if (!target) { results.failed.push({ id, error: 'not found' }); continue; }
                if (getRoleRank(target.role) >= getRoleRank(req.user.role)) { results.failed.push({ id, error: 'at or above your role' }); continue; }
                if (action === 'role') {
                    const newRole = roleForStorage(value, null);
                    if (!newRole || !isValidRole(newRole)) { results.failed.push({ id, error: 'invalid role' }); continue; }
                    if (getRoleRank(newRole) > getRoleRank(req.user.role)) { results.failed.push({ id, error: 'cannot grant a role above your own' }); continue; }
                    await dbAdapter.run('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?', [newRole, id, tid]);
                } else if (action === 'suspend') {
                    await dbAdapter.run("UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?", [id, tid]);
                } else {
                    await dbAdapter.run("UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?", [id, tid]);
                }
                results.success.push({ id, username: target.username });
            } catch (err) {
                results.failed.push({ id, error: err.message });
            }
        }
        auditSuccess(req, {
            action: `admin_bulk_${action}`, resourceType: 'user',
            metadata: { count: ids.length, success: results.success.length, failed: results.failed.length, value: action === 'role' ? value : undefined },
        });
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/users/:id - Update user (Admin only)
//
// Stage-7 audit: log password resets and role changes. Pre-fix admins
// could rotate passwords or escalate roles silently — no audit trail for
// incident response.
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const body = req.body || {};
    const targetUserId = req.params.id;
    const requestedRole = roleForStorage(body.role, null);

    try {
        // Read the full prior row so unspecified fields are preserved (read-merge)
        // and so we can audit role/password/status changes.
        const prior = await dbAdapter.get(
            `SELECT username, name, email, role, tenant_id, status,
                    department, institution, address, phone, alternative_email, education, grade
               FROM users WHERE id = ? AND tenant_id = ?`,
            [targetUserId, tenantId(req)]
        );
        if (!prior) return res.status(404).json({ error: 'User not found' });

        if (requestedRole && !isValidRole(requestedRole)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        if (requestedRole && getRoleRank(requestedRole) > getRoleRank(req.user)) {
            return res.status(403).json({ error: 'Cannot grant a role higher than your own' });
        }
        const finalRole = requestedRole || prior.role;

        let finalStatus = prior.status;
        if (body.status !== undefined) {
            if (!['active', 'inactive', 'suspended'].includes(body.status)) {
                return res.status(400).json({ error: "status must be 'active', 'inactive', or 'suspended'" });
            }
            if (String(targetUserId) === String(req.user.id) && body.status !== 'active') {
                return res.status(400).json({ error: 'You cannot deactivate your own account' });
            }
            finalStatus = body.status;
        }

        // Only overwrite a field when the caller sent it; empty string clears to
        // NULL. Unspecified fields keep their prior value.
        const merge = (k) => (body[k] !== undefined ? (body[k] === '' ? null : body[k]) : prior[k]);
        const username = body.username !== undefined ? body.username : prior.username;
        const name = body.name !== undefined ? (body.name || null) : prior.name;
        const email = body.email !== undefined ? body.email : prior.email;

        let password_hash = null;
        if (body.password) {
            const pv = validatePassword(body.password);
            if (!pv.valid) return res.status(400).json({ error: pv.errors.join('. ') });
            password_hash = await bcrypt.hash(body.password, 10);
        }

        // Fixed column list (no SQL interpolation). Two statements so the
        // password hash is only written when a new password was supplied.
        const cols = [username, name, email, finalRole, finalStatus,
            merge('department'), merge('institution'), merge('address'),
            merge('phone'), merge('alternative_email'), merge('education'), merge('grade')];
        let result;
        try {
            if (password_hash) {
                result = await dbAdapter.run(
                    `UPDATE users SET username=?, name=?, email=?, role=?, status=?,
                            department=?, institution=?, address=?, phone=?, alternative_email=?, education=?, grade=?,
                            password_hash=?, updated_at=CURRENT_TIMESTAMP
                       WHERE id=? AND tenant_id=?`,
                    [...cols, password_hash, targetUserId, tenantId(req)]
                );
            } else {
                result = await dbAdapter.run(
                    `UPDATE users SET username=?, name=?, email=?, role=?, status=?,
                            department=?, institution=?, address=?, phone=?, alternative_email=?, education=?, grade=?,
                            updated_at=CURRENT_TIMESTAMP
                       WHERE id=? AND tenant_id=?`,
                    [...cols, targetUserId, tenantId(req)]
                );
            }
        } catch (err) {
            if (String(err.message).includes('UNIQUE')) {
                return res.status(409).json({ error: 'Username or email already exists' });
            }
            throw err;
        }
        if (!result || result.changes === 0) return res.status(404).json({ error: 'User not found' });

        const roleChanged = prior.role !== finalRole;
        const statusChanged = prior.status !== finalStatus;
        if (password_hash || roleChanged || statusChanged) {
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: password_hash ? 'admin_user_password_and_profile_change' : 'admin_user_profile_change',
                targetType: 'user',
                targetId: targetUserId,
                oldValue: { role: prior.role, status: prior.status },
                newValue: { role: finalRole, status: finalStatus, password_reset: !!password_hash },
            });
        }
        res.json({ message: 'User updated successfully', id: targetUserId });
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
