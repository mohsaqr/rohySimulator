import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireAdmin,
} from '../middleware/auth.js';




import { logger } from '../logger.js';
import {
    auditSuccess
} from './_helpers.js';

const radiologyLog = logger('radiology');
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

router.post('/tenants', authenticateToken, requireAdmin, (req, res) => {
    const { slug, name } = req.body || {};
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    const displayName = String(name || '').trim();

    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalizedSlug)) {
        return res.status(400).json({ error: 'Tenant slug must be 2-63 lowercase letters, numbers, or hyphens' });
    }
    if (!displayName) {
        return res.status(400).json({ error: 'Tenant name is required' });
    }

    dbAdapter.run(
        `INSERT INTO tenants (slug, name, is_default) VALUES (?, ?, 0)`,
        [normalizedSlug, displayName],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Tenant slug already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            auditSuccess(req, {
                action: 'create_tenant',
                resourceType: 'tenant',
                resourceId: String(this.lastID),
                resourceName: normalizedSlug,
                oldValue: { tenant_id: null },
                newValue: { tenant_id: this.lastID, slug: normalizedSlug, name: displayName }
            });
            res.status(201).json({ tenant: { id: this.lastID, slug: normalizedSlug, name: displayName, is_default: 0 } });
        }
    );
});

// POST /api/users/:id/tenant - Minimal assignment hook for tests/controlled
// admin use. Full migration tooling remains deferred because it must move or
// archive all resource ownership coherently.
router.post('/users/:id/tenant', authenticateToken, requireAdmin, (req, res) => {
    const targetUserId = req.params.id;
    const nextTenantId = Number(req.body?.tenant_id);
    if (!Number.isInteger(nextTenantId) || nextTenantId <= 0) {
        return res.status(400).json({ error: 'tenant_id must be a positive integer' });
    }

    dbAdapter.get('SELECT id, username, tenant_id FROM users WHERE id = ?', [targetUserId], (userErr, user) => {
        if (userErr) return res.status(500).json({ error: userErr.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        dbAdapter.get('SELECT id, slug, name FROM tenants WHERE id = ?', [nextTenantId], (tenantErr, tenant) => {
            if (tenantErr) return res.status(500).json({ error: tenantErr.message });
            if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

            dbAdapter.run('UPDATE users SET tenant_id = ? WHERE id = ?', [nextTenantId, targetUserId], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                auditSuccess(req, {
                    action: 'assign_user_tenant',
                    resourceType: 'user',
                    resourceId: String(targetUserId),
                    resourceName: user.username,
                    oldValue: { tenant_id: user.tenant_id },
                    newValue: { tenant_id: nextTenantId }
                });
                res.json({ user: { id: user.id, username: user.username, tenant_id: nextTenantId } });
            });
        });
    });
});

// POST /api/auth/login - Login user
//
// Account lockout: after MAX_FAILED_LOGINS consecutive failed attempts the
// account is locked for LOCKOUT_MINUTES. The columns (`failed_login_attempts`,
// `locked_until`) already exist on the schema; this is the missing logic.

export default router;
