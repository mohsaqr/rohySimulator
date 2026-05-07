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

router.post('/patient-record/sync', authenticateToken, async (req, res) => {
    try {
        const { session_id, record_id, events, document, patient_info, current_state, events_count } = req.body;

        if (!session_id || !record_id) {
            return res.status(400).json({ error: 'session_id and record_id are required' });
        }

        if (!await verifySessionOwnership(session_id, req.user, res)) return;

        // Insert new events
        if (events && events.length > 0) {
            const insertEvent = dbAdapter.prepare(`
                INSERT OR IGNORE INTO patient_record_events
                (session_id, record_id, event_id, verb, time_elapsed, category, region, source, item, content, finding, value, unit, abnormal, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const event of events) {
                insertEvent.run(
                    session_id,
                    record_id,
                    event.id,
                    event.verb,
                    event.time,
                    event.category || null,
                    event.region || null,
                    event.source || null,
                    event.item || null,
                    event.content || null,
                    event.finding || null,
                    event.value || null,
                    event.unit || null,
                    event.abnormal ? 1 : 0,
                    JSON.stringify(event)
                );
            }
            insertEvent.finalize();
        }

        // Upsert document
        await new Promise((resolve, reject) => {
            dbAdapter.run(`
                INSERT INTO patient_record_documents (session_id, record_id, patient_info, current_state, events_count, document, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id) DO UPDATE SET
                    current_state = excluded.current_state,
                    events_count = excluded.events_count,
                    document = excluded.document,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                session_id,
                record_id,
                JSON.stringify(patient_info),
                JSON.stringify(current_state),
                events_count || 0,
                JSON.stringify(document)
            ], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        res.json({
            success: true,
            message: 'Patient record synced',
            events_synced: events?.length || 0
        });
    } catch (err) {
        (req.log || routesAdminLog).error('patient record sync failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// GET /api/patient-record/:sessionId - Get patient record document
router.get('/patient-record/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

        const record = await new Promise((resolve, reject) => {
            dbAdapter.get(
                'SELECT * FROM patient_record_documents WHERE session_id = ?',
                [sessionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!record) {
            return res.status(404).json({ error: 'Patient record not found' });
        }

        res.json({
            session_id: record.session_id,
            record_id: record.record_id,
            patient_info: JSON.parse(record.patient_info || '{}'),
            current_state: JSON.parse(record.current_state || '{}'),
            events_count: record.events_count,
            document: JSON.parse(record.document || '{}'),
            created_at: record.created_at,
            updated_at: record.updated_at
        });
    } catch (err) {
        (req.log || routesAdminLog).error('patient record get failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// GET /api/patient-record/:sessionId/events - Get patient record events
router.get('/patient-record/:sessionId/events', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { verb } = req.query;

        if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

        let query = 'SELECT * FROM patient_record_events WHERE session_id = ?';
        const params = [sessionId];

        if (verb) {
            query += ' AND verb = ?';
            params.push(verb);
        }

        query += ' ORDER BY time_elapsed ASC, id ASC';

        const events = await new Promise((resolve, reject) => {
            dbAdapter.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Parse details JSON for each event
        const parsedEvents = events.map(e => ({
            ...e,
            details: JSON.parse(e.details || '{}'),
            abnormal: e.abnormal === 1
        }));

        res.json({ events: parsedEvents });
    } catch (err) {
        (req.log || routesAdminLog).error('patient record events get failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/patient-record/:sessionId - Delete patient record
router.delete('/patient-record/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

        // Delete events
        await new Promise((resolve, reject) => {
            dbAdapter.run('DELETE FROM patient_record_events WHERE session_id = ?', [sessionId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        // Delete document
        await new Promise((resolve, reject) => {
            dbAdapter.run('DELETE FROM patient_record_documents WHERE session_id = ?', [sessionId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        res.json({ success: true, message: 'Patient record deleted' });
    } catch (err) {
        (req.log || routesAdminLog).error('patient record delete failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// GET /api/patient-record/:sessionId/summary - Get patient record summary
router.get('/patient-record/:sessionId/summary', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

        // Get document
        const record = await new Promise((resolve, reject) => {
            dbAdapter.get(
                'SELECT * FROM patient_record_documents WHERE session_id = ?',
                [sessionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!record) {
            return res.status(404).json({ error: 'Patient record not found' });
        }

        // Get verb counts
        const verbCounts = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT verb, COUNT(*) as count FROM patient_record_events
                 WHERE session_id = ? GROUP BY verb`,
                [sessionId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const verbCountMap = {};
        verbCounts.forEach(v => {
            verbCountMap[v.verb] = v.count;
        });

        const document = JSON.parse(record.document || '{}');

        res.json({
            session_id: record.session_id,
            record_id: record.record_id,
            patient_name: document.patient?.name || 'Unknown',
            events_count: record.events_count,
            events_by_verb: verbCountMap,
            current_state: JSON.parse(record.current_state || '{}'),
            created_at: record.created_at,
            updated_at: record.updated_at
        });
    } catch (err) {
        (req.log || routesAdminLog).error('patient record summary failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// MULTI-AGENT SYSTEM ROUTES
// ============================================

// -------------------- AGENT TEMPLATES (Admin) --------------------

// GET /api/agents/templates - List all agent templates

export default router;
