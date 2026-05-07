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

router.get('/sessions/:sessionId/discussion-notes', authenticateToken, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isInteger(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;
    dbAdapter.get(
        `SELECT note_text, updated_at FROM session_notes WHERE session_id = ? AND user_id = ?`,
        [sessionId, req.user.id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ note_text: row?.note_text || '', updated_at: row?.updated_at || null });
        }
    );
});

// PUT /sessions/:sessionId/discussion-notes — upsert current user's note
router.put('/sessions/:sessionId/discussion-notes', authenticateToken, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isInteger(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;
    const noteText = typeof req.body?.note_text === 'string' ? req.body.note_text : '';
    dbAdapter.run(
        `INSERT INTO session_notes (session_id, user_id, note_text, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id, user_id) DO UPDATE SET
            note_text = excluded.note_text,
            updated_at = CURRENT_TIMESTAMP`,
        [sessionId, req.user.id, noteText],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ok: true, note_text: noteText });
        }
    );
});



export default router;
