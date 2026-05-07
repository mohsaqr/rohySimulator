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
