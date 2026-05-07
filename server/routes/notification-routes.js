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

router.get('/notification-prefs', authenticateToken, (req, res) => {
    const userId = req.user.id;
    dbAdapter.get(
        `SELECT notification_settings FROM user_preferences WHERE user_id = ?`,
        [userId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            let prefs = {};
            if (row && row.notification_settings) {
                try { prefs = JSON.parse(row.notification_settings); } catch { prefs = {}; }
            }
            res.json({ prefs });
        }
    );
});

// Whitelist of pref keys the client is allowed to write. Mirrors
// src/notifications/defaults.js DEFAULT_PREFS plus the nested audioFrequencies.
// Anything else gets dropped silently — keeps a malicious client from
// stuffing the column with arbitrary blobs.
const ALLOWED_PREF_KEYS = new Set([
    'dnd', 'pausedUntil', 'minSeverity',
    'mutedSources', 'audioMuted', 'bannerMuted', 'consoleMuted',
    'snoozeDuration',
    'toastDedupeWindowMs', 'toastMaxVisible',
    'telemetryBatchSize', 'telemetryFlushIntervalMs',
    'audioFrequencies', 'audioVolume',
]);
const NOTIFICATION_PREFS_MAX_BYTES = 10 * 1024;   // 10 KB hard cap

router.put('/notification-prefs', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { prefs } = req.body || {};
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
        return res.status(400).json({ error: 'prefs object required' });
    }

    // Strip unknown keys.
    const filtered = {};
    for (const [k, v] of Object.entries(prefs)) {
        if (ALLOWED_PREF_KEYS.has(k)) filtered[k] = v;
    }

    const json = JSON.stringify(filtered);
    if (json.length > NOTIFICATION_PREFS_MAX_BYTES) {
        return res.status(413).json({
            error: `prefs exceed ${NOTIFICATION_PREFS_MAX_BYTES} byte limit`
        });
    }

    dbAdapter.get(`SELECT notification_settings FROM user_preferences WHERE user_id = ?`, [userId], (readErr, oldPrefs) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        // Upsert. user_preferences has UNIQUE(user_id) so ON CONFLICT works.
        dbAdapter.run(
            `INSERT INTO user_preferences (user_id, notification_settings, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
                 notification_settings = excluded.notification_settings,
                 updated_at = CURRENT_TIMESTAMP`,
            [userId, json],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                auditSuccess(req, {
                    action: 'update_notification_preferences',
                    resourceType: 'user_preferences',
                    resourceId: String(userId),
                    oldValue: { notification_settings: parseAuditJson(oldPrefs?.notification_settings) },
                    newValue: { notification_settings: filtered }
                });
                res.json({ ok: true });
            }
        );
    });
});

// --- INVESTIGATION ENDPOINTS ---

// GET /api/cases/:id/investigations - Get all investigations for a case

export default router;
