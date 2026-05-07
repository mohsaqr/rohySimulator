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

router.post('/interactions', authenticateToken, (req, res) => {
    const { session_id, role, content } = req.body;
    
    // Verify user owns the session
    dbAdapter.get('SELECT user_id FROM sessions WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [session_id, tenantId(req)], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sql = `INSERT INTO interactions (session_id, role, content, tenant_id) VALUES (?, ?, ?, ?)`;
        dbAdapter.run(sql, [session_id, role, content, tenantId(req)], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, session_id, role, content });
        });
    });
});

// GET /api/interactions/:session_id - Authenticated users can view their own
router.get('/interactions/:session_id', authenticateToken, (req, res) => {
    // Verify user owns the session or is admin
    dbAdapter.get('SELECT user_id FROM sessions WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.session_id, tenantId(req)], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sql = "SELECT * FROM interactions WHERE session_id = ? AND tenant_id = ? ORDER BY timestamp ASC";
        dbAdapter.all(sql, [req.params.session_id, tenantId(req)], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ interactions: rows });
        });
    });
});

// --- USER MANAGEMENT (Admin Only) ---

// GET /api/users - List all users (Admin only)

router.get('/analytics/sessions', authenticateToken, (req, res) => {
    let sql;
    let params;

    if (canReadAcrossUsers(req.user)) {
        // Reviewer+ sees all sessions
        sql = `
            SELECT s.*, c.name as case_name, u.username
            FROM sessions s
            LEFT JOIN cases c ON s.case_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.tenant_id = ? AND s.deleted_at IS NULL
            ORDER BY s.start_time DESC
        `;
        params = [tenantId(req)];
    } else {
        // Users see only their own sessions
        sql = `
            SELECT s.*, c.name as case_name
            FROM sessions s
            LEFT JOIN cases c ON s.case_id = c.id
            WHERE s.tenant_id = ? AND s.user_id = ? AND s.deleted_at IS NULL
            ORDER BY s.start_time DESC
        `;
        params = [tenantId(req), req.user.id];
    }

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sessions: redactRows(rows) });
    });
});

// GET /api/analytics/sessions/:id - Get session details with chat log
router.get('/analytics/sessions/:id', authenticateToken, (req, res) => {
    // First get session details
    const sessionSql = `
        SELECT s.*, c.name as case_name, c.description, u.username
        FROM sessions s
        LEFT JOIN cases c ON s.case_id = c.id
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.tenant_id = ?
    `;

    dbAdapter.get(sessionSql, [req.params.id, tenantId(req)], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Check permissions
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get interactions
        const interactionsSql = `SELECT * FROM interactions WHERE session_id = ? ORDER BY timestamp ASC`;
        dbAdapter.all(interactionsSql, [req.params.id], (err, interactions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ session: redactRow(session), interactions });
        });
    });
});

// GET /api/analytics/user-stats/:userId - Get user statistics
router.get('/analytics/user-stats/:userId', authenticateToken, (req, res) => {
    const userId = parseInt(req.params.userId);

    // Users can only view their own stats, admins can view anyone's
    if (req.user.id !== userId && !canReadAcrossUsers(req.user)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const sql = `
        SELECT 
            COUNT(*) as total_sessions,
            SUM(CASE WHEN duration IS NOT NULL THEN 1 ELSE 0 END) as completed_sessions,
            SUM(duration) as total_duration,
            AVG(duration) as avg_duration,
            COUNT(DISTINCT case_id) as unique_cases
        FROM sessions
        WHERE tenant_id = ? AND user_id = ?
    `;

    dbAdapter.get(sql, [tenantId(req), userId], (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Get interaction count
        const interactionSql = `
            SELECT COUNT(*) as total_interactions
            FROM interactions i
            JOIN sessions s ON i.session_id = s.id
            WHERE s.tenant_id = ? AND s.user_id = ?
        `;

        dbAdapter.get(interactionSql, [tenantId(req), userId], (err, interactionStats) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ 
                ...stats, 
                total_interactions: interactionStats.total_interactions 
            });
        });
    });
});

// --- SETTINGS LOGGING ---

// POST /api/settings/log - Log settings changes
router.post('/settings/log', authenticateToken, (req, res) => {
    const { session_id, case_id, setting_type, setting_name, old_value, new_value, settings_json } = req.body;
    
    const sql = `INSERT INTO settings_logs (
        user_id, session_id, case_id, setting_type, setting_name, 
        old_value, new_value, settings_json, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    dbAdapter.run(sql, [
        req.user.id, session_id, case_id, setting_type, setting_name,
        old_value, new_value, JSON.stringify(settings_json), tenantId(req)
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: 'Setting logged' });
    });
});

// GET /api/analytics/login-logs - Get login logs as JSON (Admin only)
router.get('/analytics/login-logs', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100 } = req.query;
    
    const sql = `
        SELECT ll.*, u.email, u.role
        FROM login_logs ll
        LEFT JOIN users u ON ll.user_id = u.id
        WHERE ll.tenant_id = ?
        ORDER BY ll.timestamp DESC
        LIMIT ?
    `;
    
    dbAdapter.all(sql, [tenantId(req), limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: redactRows(rows, { pii: 'allow', internal: 'allow' }) });
    });
});

// GET /api/analytics/settings-logs - Get settings logs as JSON (Admin only)
router.get('/analytics/settings-logs', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100 } = req.query;
    
    const sql = `
        SELECT sl.*, u.username, c.name as case_name
        FROM settings_logs sl
        LEFT JOIN users u ON sl.user_id = u.id
        LEFT JOIN cases c ON sl.case_id = c.id
        WHERE sl.tenant_id = ?
        ORDER BY sl.timestamp DESC
        LIMIT ?
    `;
    
    dbAdapter.all(sql, [tenantId(req), limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: redactRows(rows, { pii: 'allow', internal: 'allow' }) });
    });
});

// --- COMPREHENSIVE EXPORT ENDPOINTS ---

// GET /api/export/login-logs - Export login logs as CSV
router.get('/export/login-logs', authenticateToken, requireAdmin, (req, res) => {
    const { start_date, end_date } = req.query;
    let sql = `
        SELECT 
            ll.id, ll.user_id, ll.username, ll.action, 
            ll.ip_address, ll.user_agent, ll.timestamp,
            u.email, u.role
        FROM login_logs ll
        LEFT JOIN users u ON ll.user_id = u.id
    `;
    
    const params = [];
    if (start_date || end_date) {
        sql += ' WHERE 1=1';
        if (start_date) {
            sql += ' AND ll.timestamp >= ?';
            params.push(start_date);
        }
        if (end_date) {
            sql += ' AND ll.timestamp <= ?';
            params.push(end_date);
        }
    }
    sql += ' ORDER BY ll.timestamp DESC';

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Convert to CSV
        const csv = convertToCSV(redactRows(rows, { pii: 'allow', internal: 'allow' }));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=login_logs.csv');
        res.send(csv);
    });
});

// GET /api/export/chat-logs - Export chat logs as CSV
router.get('/export/chat-logs', authenticateToken, (req, res) => {
    const { session_id, case_id, start_date, end_date } = req.query;
    
    let sql = `
        SELECT 
            i.id, i.session_id, i.role, i.content, i.timestamp,
            s.case_id, s.user_id, s.student_name, s.start_time, s.duration,
            c.name as case_name, u.username, u.email
        FROM interactions i
        JOIN sessions s ON i.session_id = s.id
        JOIN cases c ON s.case_id = c.id
        JOIN users u ON s.user_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    
    // Users can only see their own, admins see all
    if (!canReadAcrossUsers(req.user)) {
        sql += ' AND s.user_id = ?';
        params.push(req.user.id);
    }
    
    if (session_id) {
        sql += ' AND i.session_id = ?';
        params.push(session_id);
    }
    if (case_id) {
        sql += ' AND s.case_id = ?';
        params.push(case_id);
    }
    if (start_date) {
        sql += ' AND i.timestamp >= ?';
        params.push(start_date);
    }
    if (end_date) {
        sql += ' AND i.timestamp <= ?';
        params.push(end_date);
    }
    
    sql += ' ORDER BY i.timestamp ASC';

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = convertToCSV(redactRows(rows, { pii: canReadAcrossUsers(req.user) ? 'allow' : 'redact' }));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=chat_logs.csv');
        res.send(csv);
    });
});

// GET /api/export/settings-logs - Export settings logs as CSV
router.get('/export/settings-logs', authenticateToken, requireAdmin, (req, res) => {
    const { start_date, end_date, setting_type } = req.query;
    
    let sql = `
        SELECT 
            sl.id, sl.user_id, sl.session_id, sl.case_id,
            sl.setting_type, sl.setting_name, sl.old_value, sl.new_value,
            sl.settings_json, sl.timestamp,
            u.username, u.email, c.name as case_name
        FROM settings_logs sl
        LEFT JOIN users u ON sl.user_id = u.id
        LEFT JOIN cases c ON sl.case_id = c.id
        WHERE 1=1
    `;
    
    const params = [];
    if (setting_type) {
        sql += ' AND sl.setting_type = ?';
        params.push(setting_type);
    }
    if (start_date) {
        sql += ' AND sl.timestamp >= ?';
        params.push(start_date);
    }
    if (end_date) {
        sql += ' AND sl.timestamp <= ?';
        params.push(end_date);
    }
    
    sql += ' ORDER BY sl.timestamp DESC';

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = convertToCSV(redactRows(rows, { pii: 'allow', internal: 'allow' }));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=settings_logs.csv');
        res.send(csv);
    });
});

// GET /api/export/session-settings - Export session settings as CSV
router.get('/export/session-settings', authenticateToken, (req, res) => {
    const { start_date, end_date, case_id } = req.query;
    
    let sql = `
        SELECT 
            ss.id, ss.session_id, ss.case_id, ss.user_id,
            ss.llm_provider, ss.llm_model, ss.llm_base_url,
            ss.monitor_hr, ss.monitor_rhythm, ss.monitor_spo2,
            ss.monitor_bp_sys, ss.monitor_bp_dia, ss.monitor_rr, ss.monitor_temp,
            ss.timestamp,
            u.username, u.email, c.name as case_name,
            s.start_time, s.end_time, s.duration
        FROM session_settings ss
        JOIN users u ON ss.user_id = u.id
        JOIN cases c ON ss.case_id = c.id
        JOIN sessions s ON ss.session_id = s.id
        WHERE 1=1
    `;
    
    const params = [];
    
    // Users can only see their own
    if (!canReadAcrossUsers(req.user)) {
        sql += ' AND ss.user_id = ?';
        params.push(req.user.id);
    }
    
    if (case_id) {
        sql += ' AND ss.case_id = ?';
        params.push(case_id);
    }
    if (start_date) {
        sql += ' AND ss.timestamp >= ?';
        params.push(start_date);
    }
    if (end_date) {
        sql += ' AND ss.timestamp <= ?';
        params.push(end_date);
    }
    
    sql += ' ORDER BY ss.timestamp DESC';

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = convertToCSV(redactRows(rows, { pii: canReadAcrossUsers(req.user) ? 'allow' : 'redact' }));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=session_settings.csv');
        res.send(csv);
    });
});

// GET /api/export/complete-session/:sessionId - Export complete session data
router.get('/export/complete-session/:sessionId', authenticateToken, (req, res) => {
    const sessionId = req.params.sessionId;
    
    // Verify ownership
    dbAdapter.get('SELECT user_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get complete session data
        const sql = `
            SELECT 
                s.id as session_id, s.start_time, s.end_time, s.duration,
                s.llm_settings, s.monitor_settings,
                u.username, u.email,
                c.name as case_name, c.description as case_description,
                ss.llm_provider, ss.llm_model, ss.monitor_hr, ss.monitor_rhythm,
                ss.monitor_spo2, ss.monitor_bp_sys, ss.monitor_bp_dia, ss.monitor_rr
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            JOIN cases c ON s.case_id = c.id
            LEFT JOIN session_settings ss ON s.id = ss.session_id
            WHERE s.id = ?
        `;

        dbAdapter.get(sql, [sessionId], (err, sessionData) => {
            if (err) return res.status(500).json({ error: err.message });

            // Get all interactions
            dbAdapter.all(
                'SELECT role, content, timestamp FROM interactions WHERE session_id = ? ORDER BY timestamp ASC',
                [sessionId],
                (err, interactions) => {
                    if (err) return res.status(500).json({ error: err.message });

                    // Combine data
                    const completeData = redactRow({
                        ...sessionData,
                        interactions
                    }, { pii: hasRoleAtLeast(req.user, ROLE_RANKS.educator) ? 'allow' : 'redact' });

                    // Convert to CSV format
                    const csv = convertCompleteSessionToCSV(completeData);
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename=session_${sessionId}_complete.csv`);
                    res.send(csv);
                }
            );
        });
    });
});

// Helper function to convert JSON to CSV
function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.map(h => `"${h}"`).join(','));
    
    // Add data rows
    for (const row of data) {
        const values = headers.map(header => {
            const val = row[header];
            const escaped = ('' + val).replace(/"/g, '""');
            return `"${escaped}"`;
        });
        csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
}

// Helper function to convert complete session to CSV
function convertCompleteSessionToCSV(data) {
    const { interactions, ...sessionInfo } = data;
    
    let csv = '=== SESSION INFORMATION ===\n';
    csv += convertToCSV([sessionInfo]) + '\n\n';
    csv += '=== CHAT LOG ===\n';
    csv += convertToCSV(interactions);
    
    return csv;
}

// --- EVENT LOG ENDPOINTS ---

// POST /api/events/batch - Log multiple events at once
router.post('/events/batch', authenticateToken, async (req, res) => {
    const { session_id, events } = req.body;
    const user_id = req.user.id;

    if (!session_id || !events || !Array.isArray(events)) {
        return res.status(400).json({ error: 'session_id and events array required' });
    }

    if (!await verifySessionOwnership(session_id, req.user, res, { requireSession: true })) return;

    const sql = `INSERT INTO event_log (session_id, user_id, event_type, description, vital_sign, old_value, new_value, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    const stmt = dbAdapter.prepare(sql);
    let inserted = 0;
    let runError = null;
    let pending = events.length;

    if (pending === 0) {
        stmt.finalize();
        return res.json({ message: '0 events logged' });
    }

    events.forEach(event => {
        stmt.run(
            session_id,
            user_id,
            event.event_type,
            event.description,
            event.vital_sign || null,
            event.old_value || null,
            event.new_value || null,
            event.timestamp,
            function(err) {
                if (err && !runError) {
                    runError = err;
                } else if (!err) {
                    inserted++;
                }
                pending--;
                if (pending === 0) {
                    stmt.finalize((finalizeErr) => {
                        if (runError) {
                            return res.status(500).json({ error: runError.message });
                        }
                        if (finalizeErr) {
                            return res.status(500).json({ error: finalizeErr.message });
                        }
                        res.json({ message: `${inserted} events logged` });
                    });
                }
            }
        );
    });
});

// GET /api/sessions/:id/events - Get all events for a session
router.get('/sessions/:id/events', authenticateToken, async (req, res) => {
    const sessionId = req.params.id;

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    const sql = `
        SELECT el.id, el.session_id, el.event_type, el.description,
               el.vital_sign, el.old_value, el.new_value, el.timestamp,
               el.user_id, u.username AS user_name, u.email AS user_email
        FROM event_log el
        LEFT JOIN users u ON el.user_id = u.id
        WHERE el.session_id = ?
        ORDER BY el.timestamp ASC
    `;

    dbAdapter.all(sql, [sessionId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ events: rows });
    });
});

// --- LEARNING ANALYTICS ENDPOINTS ---

// Standard xAPI-style verbs for learning analytics
const LEARNING_VERBS = [
    // Session lifecycle
    'STARTED_SESSION', 'ENDED_SESSION', 'RESUMED_SESSION', 'IDLE_TIMEOUT', 'UNLOAD',
    // Navigation
    'VIEWED', 'OPENED', 'CLOSED', 'NAVIGATED', 'SWITCHED_TAB',
    'SCROLLED', 'LOST_FOCUS', 'RESUMED_FOCUS',
    // Interactions
    'CLICKED', 'SELECTED', 'DESELECTED', 'TOGGLED', 'EXPANDED', 'COLLAPSED',
    // Lab/Investigation actions
    'ORDERED_LAB', 'CANCELLED_LAB', 'VIEWED_LAB_RESULT', 'SEARCHED_LABS',
    'FILTERED_LABS', 'LAB_RESULT_READY',
    // Medication/treatment actions
    'ORDERED_MEDICATION', 'ADMINISTERED_MEDICATION', 'CANCELLED_MEDICATION',
    'ORDERED_TREATMENT', 'PERFORMED_INTERVENTION', 'ORDERED_IV_FLUID',
    'STARTED_OXYGEN', 'STOPPED_OXYGEN', 'ORDERED_NURSING',
    'DISCONTINUED_TREATMENT', 'TREATMENT_EFFECT_STARTED',
    'TREATMENT_EFFECT_PEAKED', 'TREATMENT_EFFECT_ENDED',
    'CONTRAINDICATED_TREATMENT_ORDERED', 'EXPECTED_TREATMENT_GIVEN',
    'EXPECTED_TREATMENT_MISSED',
    // Physical examination
    'PERFORMED_PHYSICAL_EXAM', 'OPENED_EXAM_PANEL', 'CLOSED_EXAM_PANEL',
    // Chat interactions
    'SENT_MESSAGE', 'RECEIVED_MESSAGE', 'COPIED_MESSAGE',
    'EDITED_MESSAGE', 'STT_RESULT', 'STT_ERROR', 'TTS_PLAYED',
    // Monitor interactions
    'ADJUSTED_VITAL', 'ACKNOWLEDGED_ALARM', 'SILENCED_ALARM',
    'ALARM_TRIGGERED', 'VIEWED_TRENDS',
    // Patient record
    'VIEWED_PATIENT_SUMMARY', 'VIEWED_HISTORY', 'VIEWED_MEDICATIONS',
    'VIEWED_ALLERGIES',
    // Settings
    'CHANGED_SETTING', 'SAVED_SETTING', 'RESET_SETTING',
    // Case interactions
    'LOADED_CASE', 'VIEWED_PATIENT_INFO', 'VIEWED_RECORDS',
    'SAVED_CASE', 'EXPORTED_CASE',
    // Scenario interactions
    'STARTED_SCENARIO', 'PAUSED_SCENARIO', 'RESUMED_SCENARIO',
    'COMPLETED_SCENARIO', 'RESET_SCENARIO',
    // Submissions
    'SUBMITTED', 'ANSWERED', 'ATTEMPTED', 'CORRECT_ANSWER',
    'INCORRECT_ANSWER',
    // Emotion
    'EXPRESSED_EMOTION',
    // Errors
    'ERROR_OCCURRED', 'API_ERROR', 'VALIDATION_ERROR'
];

// POST /api/learning-events - Log a learning event
router.post('/learning-events', authenticateToken, async (req, res) => {
    const {
        session_id,
        case_id,
        verb,
        object_type,
        object_id,
        object_name,
        component,
        parent_component,
        result,
        duration_ms,
        context,
        message_content,
        message_role
    } = req.body;

    const user_id = req.user.id;

    // Validate verb
    if (!verb || !LEARNING_VERBS.includes(verb)) {
        return res.status(400).json({
            error: `Invalid verb. Must be one of: ${LEARNING_VERBS.join(', ')}`
        });
    }

    if (!object_type) {
        return res.status(400).json({ error: 'object_type is required' });
    }

    // session_id is optional on learning events (e.g. pre-session telemetry).
    // When present, verify ownership; when absent, allow.
    if (session_id && !await verifySessionOwnership(session_id, req.user, res)) return;

    const sql = `
        INSERT INTO learning_events (
            session_id, user_id, case_id, verb,
            object_type, object_id, object_name,
            component, parent_component,
            result, duration_ms, context,
            message_content, message_role, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    dbAdapter.run(sql, [
        session_id,
        user_id,
        case_id,
        verb,
        object_type,
        object_id || null,
        object_name || null,
        component || null,
        parent_component || null,
        result || null,
        duration_ms || null,
        context ? JSON.stringify(context) : null,
        message_content || null,
        message_role || null,
        tenantId(req)
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// POST /api/learning-events/batch - Log multiple events at once
router.post('/learning-events/batch', authenticateToken, async (req, res) => {
    const { events } = req.body;
    const user_id = req.user.id;

    if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'events array is required' });
    }

    // Verify ownership of every distinct session_id present in the batch.
    // Events without session_id are allowed (pre-session telemetry).
    // Educators/admins bypass ownership for supervised event capture.
    if (!hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
        const distinctSessionIds = [...new Set(events.map(e => e.session_id).filter(Boolean))];
        if (distinctSessionIds.length > 0) {
            const ownerships = await Promise.all(distinctSessionIds.map(sid => new Promise((resolve) => {
                dbAdapter.get('SELECT user_id FROM sessions WHERE id = ? AND tenant_id = ?', [sid, tenantId(req)], (err, row) => {
                    if (err || !row) return resolve(false);
                    resolve(row.user_id === user_id);
                });
            })));
            if (ownerships.some(ok => !ok)) {
                return res.status(403).json({ error: 'Batch contains session_id(s) not owned by user' });
            }
        }
    }

    const sql = `
        INSERT INTO learning_events (
            session_id, user_id, case_id, verb,
            object_type, object_id, object_name,
            component, parent_component,
            result, duration_ms, context,
            message_content, message_role, timestamp, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = dbAdapter.prepare(sql);
    let inserted = 0;

    events.forEach(event => {
        stmt.run([
            event.session_id,
            user_id,
            event.case_id,
            event.verb,
            event.object_type,
            event.object_id || null,
            event.object_name || null,
            event.component || null,
            event.parent_component || null,
            event.result || null,
            event.duration_ms || null,
            event.context ? JSON.stringify(event.context) : null,
            event.message_content || null,
            event.message_role || null,
            event.timestamp || new Date().toISOString(),
            tenantId(req)
        ], function(err) {
            if (!err) inserted++;
        });
    });

    stmt.finalize((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ inserted, total: events.length });
    });
});

const CLIENT_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function isIsoTimestamp(value) {
    if (typeof value !== 'string' || !value.includes('T')) return false;
    return !Number.isNaN(Date.parse(value));
}

function parseOptionalSessionHeader(req) {
    const raw = req.get('X-Rohy-Session-Id');
    if (raw == null || raw === '') return { ok: true, value: null };
    if (!/^\d+$/.test(String(raw))) {
        return { ok: false, error: 'X-Rohy-Session-Id must be an integer' };
    }
    return { ok: true, value: Number(raw) };
}

function validateClientLogEntry(entry, index) {
    if (!isPlainObject(entry)) return `entries[${index}] must be an object`;
    if (!CLIENT_LOG_LEVELS.has(entry.level)) return `entries[${index}].level is invalid`;
    if (typeof entry.component !== 'string' || entry.component.trim() === '') {
        return `entries[${index}].component is required`;
    }
    if (typeof entry.msg !== 'string') return `entries[${index}].msg is required`;
    if (entry.fields !== undefined && !isPlainObject(entry.fields)) {
        return `entries[${index}].fields must be an object`;
    }
    if (!isIsoTimestamp(entry.ts)) return `entries[${index}].ts must be an ISO8601 timestamp`;
    return null;
}

// POST /api/client-logs/batch - Persist client-side structured logs.
router.post('/client-logs/batch', authenticateToken, clientLogLimiter, async (req, res) => {
    const { entries } = req.body || {};
    if (!Array.isArray(entries)) {
        return res.status(400).json({ error: 'entries array is required' });
    }
    if (entries.length > 100) {
        return res.status(400).json({ error: 'entries must contain at most 100 items' });
    }

    const session = parseOptionalSessionHeader(req);
    if (!session.ok) return res.status(400).json({ error: session.error });

    for (let i = 0; i < entries.length; i += 1) {
        const error = validateClientLogEntry(entries[i], i);
        if (error) return res.status(400).json({ error });
    }

    const sql = `
        INSERT INTO client_logs (
            tenant_id, user_id, session_id, request_id,
            level, component, msg, fields_json, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        for (const entry of entries) {
            await dbRun(sql, [
                tenantId(req),
                req.user.id,
                session.value,
                req.request_id || req.requestId || null,
                entry.level,
                entry.component.trim(),
                entry.msg,
                entry.fields === undefined ? null : JSON.stringify(entry.fields),
                entry.ts,
            ]);
        }
        res.json({ accepted: entries.length, rejected: 0 });
    } catch (err) {
        req.log?.error('client log batch persist failed', { error: err.message });
        res.status(500).json({ error: 'Failed to persist client logs' });
    }
});

// GET /api/client-logs - Tenant-scoped replay for DiagnosticBar.
router.get('/client-logs', authenticateToken, requireEducator, (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 200);
    const params = [tenantId(req)];
    let sql = `SELECT id, tenant_id, user_id, session_id, request_id, level, component,
                      msg, fields_json, ts, received_at
                 FROM client_logs
                WHERE tenant_id = ?
                ORDER BY received_at DESC, id DESC
                LIMIT ?`;

    if (req.query.session_id !== undefined && req.query.session_id !== '') {
        if (!/^\d+$/.test(String(req.query.session_id))) {
            return res.status(400).json({ error: 'session_id must be an integer' });
        }
        sql = `SELECT id, tenant_id, user_id, session_id, request_id, level, component,
                      msg, fields_json, ts, received_at
                 FROM client_logs
                WHERE tenant_id = ? AND session_id = ?
                ORDER BY received_at DESC, id DESC
                LIMIT ?`;
        params.push(Number(req.query.session_id));
    }
    params.push(limit);

    dbAdapter.all(
        sql,
        params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ logs: rows || [] });
        }
    );
});

// GET /api/learning-events/session/:id - Get all learning events for a session
router.get('/learning-events/session/:id', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user.id;

    // Verify user owns session or is admin
    dbAdapter.get('SELECT user_id FROM sessions WHERE id = ? AND tenant_id = ?', [sessionId, tenantId(req)], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.user_id !== userId && !canReadAcrossUsers(req.user)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sql = `
            SELECT le.*, c.name as case_name
            FROM learning_events le
            LEFT JOIN cases c ON le.case_id = c.id
            WHERE le.session_id = ? AND le.tenant_id = ?
            ORDER BY le.timestamp ASC
        `;

        dbAdapter.all(sql, [sessionId, tenantId(req)], (err, events) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ events });
        });
    });
});

// GET /api/learning-events/user/:id - Get all learning events for a user (admin only)
router.get('/learning-events/user/:id', authenticateToken, (req, res) => {
    const targetUserId = req.params.id;

    // Only admin or the user themselves can view
    if (req.user.id !== parseInt(targetUserId) && !canReadAcrossUsers(req.user)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const { start_date, end_date, verb, case_id, limit = 1000 } = req.query;

    let sql = `
        SELECT le.*, s.start_time as session_start, c.name as case_name
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON le.case_id = c.id
        WHERE le.tenant_id = ? AND le.user_id = ?
    `;
    const params = [tenantId(req), targetUserId];

    if (start_date) {
        sql += ` AND le.timestamp >= ?`;
        params.push(start_date);
    }
    if (end_date) {
        sql += ` AND le.timestamp <= ?`;
        params.push(end_date);
    }
    if (verb) {
        sql += ` AND le.verb = ?`;
        params.push(verb);
    }
    if (case_id) {
        sql += ` AND le.case_id = ?`;
        params.push(case_id);
    }

    sql += ` ORDER BY le.timestamp DESC LIMIT ?`;
    params.push(parseInt(limit));

    dbAdapter.all(sql, params, (err, events) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ events });
    });
});

// GET /api/learning-events/analytics/summary - Get analytics summary
//
// Stage-8 audit: pre-fix the `session_id` branch had no ownership check —
// any authenticated user could query the verb/object frequency summary for
// any session by guessing the ID. The `user_id` branch was guarded; the
// `session_id` branch wasn't (a partial guard, the same pattern Stage 5 hit
// in the scenario engine). Now both branches verify ownership.
router.get('/learning-events/analytics/summary', authenticateToken, async (req, res) => {
    const { session_id, user_id, case_id } = req.query;
    const canReview = canReadAcrossUsers(req.user);

    let whereClause = '';
    const params = [];

    if (session_id) {
        // Verify the requester owns the session (or can review) before exposing summary.
        const session = await new Promise((resolve) => {
            dbAdapter.get('SELECT user_id FROM sessions WHERE id = ? AND tenant_id = ?', [session_id, tenantId(req)], (err, row) => {
                if (err) return resolve(null);
                resolve(row);
            });
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!canReview && session.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        whereClause = 'WHERE tenant_id = ? AND session_id = ?';
        params.push(tenantId(req), session_id);
    } else if (user_id) {
        if (req.user.id !== parseInt(user_id, 10) && !canReview) {
            return res.status(403).json({ error: 'Access denied' });
        }
        whereClause = 'WHERE tenant_id = ? AND user_id = ?';
        params.push(tenantId(req), user_id);
    } else if (!canReview) {
        whereClause = 'WHERE tenant_id = ? AND user_id = ?';
        params.push(tenantId(req), req.user.id);
    } else {
        whereClause = 'WHERE tenant_id = ?';
        params.push(tenantId(req));
    }

    if (case_id) {
        whereClause += whereClause ? ' AND case_id = ?' : 'WHERE case_id = ?';
        params.push(case_id);
    }

    const sql = `
        SELECT
            verb,
            object_type,
            COUNT(*) as count,
            AVG(duration_ms) as avg_duration_ms
        FROM learning_events
        ${whereClause}
        GROUP BY verb, object_type
        ORDER BY count DESC
    `;

    dbAdapter.all(sql, params, (err, summary) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ summary });
    });
});

// GET /api/learning-events/verbs - Get list of valid verbs
router.get('/learning-events/verbs', (req, res) => {
    res.json({ verbs: LEARNING_VERBS });
});

// GET /api/learning-events/recent - Get recent events across all sessions (for current user)
router.get('/learning-events/recent', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 200;

    const sql = `
        SELECT le.*, s.case_id, c.name as case_name
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        WHERE le.tenant_id = ? AND le.user_id = ?
        ORDER BY le.timestamp DESC
        LIMIT ?
    `;

    dbAdapter.all(sql, [tenantId(req), userId, limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse JSON fields
        const events = rows.map(row => ({
            ...row,
            context: row.context ? JSON.parse(row.context) : null
        }));

        res.json({ events });
    });
});

// GET /api/learning-events/all - Get ALL events across all users and sessions (admin) or user's events
router.get('/learning-events/all', authenticateToken, (req, res) => {
    const canReview = canReadAcrossUsers(req.user);
    const limit = parseInt(req.query.limit) || 500;

    // Reviewer+ sees all events, regular users see only their own
    const sql = canReview ? `
        SELECT le.*,
               s.case_id,
               c.name as case_name,
               u.username
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        LEFT JOIN users u ON le.user_id = u.id
        WHERE le.tenant_id = ?
        ORDER BY le.timestamp DESC
        LIMIT ?
    ` : `
        SELECT le.*,
               s.case_id,
               c.name as case_name,
               u.username
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        LEFT JOIN users u ON le.user_id = u.id
        WHERE le.tenant_id = ? AND le.user_id = ?
        ORDER BY le.timestamp DESC
        LIMIT ?
    `;

    const params = canReview ? [tenantId(req), limit] : [tenantId(req), req.user.id, limit];

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse JSON fields and add session info
        const events = rows.map(row => ({
            ...row,
            context: row.context ? JSON.parse(row.context) : null
        }));

        // Get unique sessions for filtering
        const sessions = [...new Map(events.filter(e => e.session_id).map(e => [
            e.session_id,
            { id: e.session_id, case_name: e.case_name, username: e.username }
        ])).values()];

        res.json({ events, sessions });
    });
});

// GET /api/learning-events/detailed/:sessionId - Get detailed events with lab workflow info
//
// Stage-8 audit: ownership check added. Pre-fix any authenticated user could
// dump another user's event log + lab orders + chat messages by passing
// their session ID. Same IDOR shape as the alarm-ack and orders-view fixes
// shipped in Stages 3 + pattern-sweep.
router.get('/learning-events/detailed/:sessionId', authenticateToken, async (req, res) => {
    const sessionId = req.params.sessionId;
    const canReview = canReadAcrossUsers(req.user);

    const session = await new Promise((resolve) => {
        dbAdapter.get('SELECT user_id FROM sessions WHERE id = ? AND tenant_id = ?', [sessionId, tenantId(req)], (err, row) => {
            if (err) return resolve(null);
            resolve(row);
        });
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canReview && session.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
    }
    if (canReview && session.user_id !== req.user.id) {
        auditSuccess(req, {
            action: 'read_learning_events_cross_user',
            resourceType: 'session',
            resourceId: sessionId,
            oldValue: null,
            newValue: { target_user_id: session.user_id }
        });
    }

    // Get all learning events for this session with full details
    const eventsSql = `
        SELECT le.*,
               u.username,
               c.name as case_name
        FROM learning_events le
        LEFT JOIN users u ON le.user_id = u.id
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        WHERE le.session_id = ? AND le.tenant_id = ?
        ORDER BY le.timestamp ASC
    `;

    // Get lab orders with timing info
    const labOrdersSql = `
        SELECT io.*, ci.test_name, ci.test_group,
               ROUND((julianday(io.available_at) - julianday(io.ordered_at)) * 24 * 60, 1) as wait_minutes,
               ROUND((julianday(io.viewed_at) - julianday(io.available_at)) * 24 * 60, 1) as view_delay_minutes
        FROM investigation_orders io
        LEFT JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ? AND io.tenant_id = ?
        ORDER BY io.ordered_at ASC
    `;

    // Get chat messages
    const chatSql = `
        SELECT * FROM interactions
        WHERE session_id = ? AND tenant_id = ?
        ORDER BY timestamp ASC
    `;

    dbAdapter.all(eventsSql, [sessionId, tenantId(req)], (err, events) => {
        if (err) return res.status(500).json({ error: err.message });

        dbAdapter.all(labOrdersSql, [sessionId, tenantId(req)], (err, labOrders) => {
            if (err) return res.status(500).json({ error: err.message });

            dbAdapter.all(chatSql, [sessionId, tenantId(req)], (err, chatMessages) => {
                if (err) return res.status(500).json({ error: err.message });

                // Parse JSON fields in events
                const parsedEvents = events.map(row => ({
                    ...row,
                    context: row.context ? JSON.parse(row.context) : null
                }));

                res.json({
                    events: parsedEvents,
                    labOrders,
                    chatMessages,
                    summary: {
                        totalEvents: parsedEvents.length,
                        totalLabsOrdered: labOrders.length,
                        totalMessages: chatMessages.length,
                        labsViewed: labOrders.filter(l => l.viewed_at).length,
                        avgLabWaitTime: labOrders.length > 0
                            ? (labOrders.reduce((sum, l) => sum + (l.wait_minutes || 0), 0) / labOrders.length).toFixed(1)
                            : 0
                    }
                });
            });
        });
    });
});

// --- ALARM ENDPOINTS ---

// POST /api/alarms/log - Log an alarm event
router.post('/alarms/log', authenticateToken, async (req, res) => {
    const { session_id, vital_sign, threshold_type, threshold_value, actual_value } = req.body;

    if (session_id && !await verifySessionOwnership(session_id, req.user, res)) return;

    const sql = `INSERT INTO alarm_events (session_id, vital_sign, threshold_type, threshold_value, actual_value, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    dbAdapter.run(sql, [session_id, vital_sign, threshold_type, threshold_value, actual_value, tenantId(req)], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// PUT /api/alarms/:id/acknowledge - Acknowledge an alarm
//
// Stage-3 audit: pre-fix this had no ownership check (any authenticated user
// could ack any alarm by ID — a textbook IDOR) AND re-stamped acknowledged_at
// on every call (network retries corrupted the audit trail). The fix folds
// both: JOIN to sessions to verify the requester owns the session (or admin),
// and only stamp if acknowledged_at IS NULL so retries return the original
// timestamp.
router.put('/alarms/:id/acknowledge', authenticateToken, (req, res) => {
    const alarmId = req.params.id;
    const canSupervise = hasRoleAtLeast(req.user, ROLE_RANKS.educator);

    const ownerSql = `
        SELECT a.id, a.acknowledged_at, s.user_id AS session_user_id
        FROM alarm_events a
        LEFT JOIN sessions s ON a.session_id = s.id
        WHERE a.id = ? AND a.tenant_id = ?
    `;
    dbAdapter.get(ownerSql, [alarmId, tenantId(req)], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Alarm not found' });

        // Bound to a session: only the session owner or educator/admin can ack.
        // Orphan alarms (no session_id) are educator/admin-only.
        const allowed = canSupervise || (row.session_user_id != null && row.session_user_id === req.user.id);
        if (!allowed) return res.status(403).json({ error: 'Access denied' });

        // Idempotent: if already acked, return the original timestamp.
        if (row.acknowledged_at) {
            return res.json({
                message: 'Alarm already acknowledged',
                acknowledged_at: row.acknowledged_at,
                already_acknowledged: true
            });
        }

        const updateSql = `UPDATE alarm_events SET acknowledged_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND acknowledged_at IS NULL`;
        dbAdapter.run(updateSql, [alarmId, tenantId(req)], function (updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            // Re-read the just-stamped value so the caller can record it.
            dbAdapter.get(`SELECT acknowledged_at FROM alarm_events WHERE id = ? AND tenant_id = ?`, [alarmId, tenantId(req)], (readErr, fresh) => {
                if (readErr) return res.status(500).json({ error: readErr.message });
                res.json({
                    message: 'Alarm acknowledged',
                    acknowledged_at: fresh?.acknowledged_at,
                    already_acknowledged: false
                });
            });
        });
    });
});

// GET /api/alarms/config - Get default alarm config
router.get('/alarms/config', authenticateToken, (req, res) => {
    const sql = `SELECT * FROM alarm_config WHERE tenant_id = ? AND user_id IS NULL`;
    
    dbAdapter.all(sql, [tenantId(req)], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ config: rows });
    });
});

// GET /api/alarms/config/:userId - Get alarm config for specific user
//
// Stage-3 audit: pre-fix this had no scope check, so any authenticated user
// could read any other user's alarm thresholds by guessing their ID. Now
// only the user themself or reviewer+ can read.
router.get('/alarms/config/:userId', authenticateToken, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'invalid userId' });
    }
    if (userId !== req.user.id && !canReadAcrossUsers(req.user)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const sql = `SELECT * FROM alarm_config WHERE tenant_id = ? AND user_id = ?`;
    dbAdapter.all(sql, [tenantId(req), userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ config: rows });
    });
});

// POST /api/alarms/config - Save alarm config (global default or per-user)
//
// Admin-only because the only client today (useAlarms.saveConfig) writes
// global defaults (user_id: null), which affect every user. Without this
// guard, any authenticated student could overwrite the global thresholds.
// The PatientMonitor UI already hides the Save button for non-admins; this
// closes the corresponding server-side gap.
router.post('/alarms/config', authenticateToken, requireAdmin, (req, res) => {
    const { user_id, vital_sign, high_threshold, low_threshold, enabled } = req.body;
    
    // Check if config exists
    const checkSql = `SELECT * FROM alarm_config WHERE tenant_id = ? AND user_id ${user_id ? '= ?' : 'IS NULL'} AND vital_sign = ?`;
    const checkParams = user_id ? [tenantId(req), user_id, vital_sign] : [tenantId(req), vital_sign];
    
    dbAdapter.get(checkSql, checkParams, (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (row) {
            // Update existing
            const updateSql = `UPDATE alarm_config SET high_threshold = ?, low_threshold = ?, enabled = ? WHERE id = ? AND tenant_id = ?`;
            dbAdapter.run(updateSql, [high_threshold, low_threshold, enabled ? 1 : 0, row.id, tenantId(req)], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                auditSuccess(req, {
                    action: 'update_alarm_config',
                    resourceType: 'alarm_config',
                    resourceId: String(row.id),
                    resourceName: vital_sign,
                    oldValue: row,
                    newValue: { user_id: user_id || null, vital_sign, high_threshold, low_threshold, enabled: enabled ? 1 : 0 }
                });
                res.json({ message: 'Alarm config updated' });
            });
        } else {
            // Insert new
            const insertSql = `INSERT INTO alarm_config (user_id, vital_sign, high_threshold, low_threshold, enabled, tenant_id) 
                               VALUES (?, ?, ?, ?, ?, ?)`;
            dbAdapter.run(insertSql, [user_id, vital_sign, high_threshold, low_threshold, enabled ? 1 : 0, tenantId(req)], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                auditSuccess(req, {
                    action: 'create_alarm_config',
                    resourceType: 'alarm_config',
                    resourceId: String(this.lastID),
                    resourceName: vital_sign,
                    newValue: { user_id: user_id || null, vital_sign, high_threshold, low_threshold, enabled: enabled ? 1 : 0 }
                });
                res.json({ id: this.lastID });
            });
        }
    });
});

// --- CASE VERSIONS ---

// GET /api/cases/:caseId/versions - Get version history for a case

const TNA_VERB_MERGE_MAP = {
    // Navigation
    'VIEWED': 'NAVIGATION',
    'OPENED': 'NAVIGATION',
    'CLOSED': 'NAVIGATION',
    'NAVIGATED': 'NAVIGATION',
    'SWITCHED_TAB': 'NAVIGATION',
    'CLICKED': 'NAVIGATION',
    'SELECTED': 'NAVIGATION',
    'DESELECTED': 'NAVIGATION',
    'TOGGLED': 'NAVIGATION',
    'EXPANDED': 'NAVIGATION',
    'COLLAPSED': 'NAVIGATION',
    'SCROLLED': 'NAVIGATION',
    // Lab/Investigation
    'ORDERED_LAB': 'ORDERED_LAB',
    'SEARCHED_LABS': 'ORDERED_LAB',
    'FILTERED_LABS': 'ORDERED_LAB',
    'CANCELLED_LAB': 'ORDERED_LAB',
    // Lab results
    'VIEWED_LAB_RESULT': 'VIEWED_LAB_RESULT',
    'LAB_RESULT_READY': 'VIEWED_LAB_RESULT',
    // Treatment
    'ORDERED_MEDICATION': 'TREATMENT',
    'ADMINISTERED_MEDICATION': 'TREATMENT',
    'CANCELLED_MEDICATION': 'TREATMENT',
    'ORDERED_TREATMENT': 'TREATMENT',
    'PERFORMED_INTERVENTION': 'TREATMENT',
    'ORDERED_IV_FLUID': 'TREATMENT',
    'STARTED_OXYGEN': 'TREATMENT',
    'STOPPED_OXYGEN': 'TREATMENT',
    'ORDERED_NURSING': 'TREATMENT',
    'DISCONTINUED_TREATMENT': 'TREATMENT',
    'CONTRAINDICATED_TREATMENT_ORDERED': 'TREATMENT',
    'EXPECTED_TREATMENT_GIVEN': 'TREATMENT',
    'EXPECTED_TREATMENT_MISSED': 'TREATMENT',
    // Examination
    'PERFORMED_PHYSICAL_EXAM': 'EXAMINATION',
    'OPENED_EXAM_PANEL': 'EXAMINATION',
    'CLOSED_EXAM_PANEL': 'EXAMINATION',
    // Communication
    'SENT_MESSAGE': 'SENT_MESSAGE',
    'RECEIVED_MESSAGE': 'RECEIVED_MESSAGE',
    'COPIED_MESSAGE': 'SENT_MESSAGE',
    'EDITED_MESSAGE': 'SENT_MESSAGE',
    // Monitoring
    'ADJUSTED_VITAL': 'MONITORING',
    'VIEWED_TRENDS': 'MONITORING',
    // Alarm response
    'ACKNOWLEDGED_ALARM': 'ALARM_RESPONSE',
    'SILENCED_ALARM': 'ALARM_RESPONSE',
    'ALARM_TRIGGERED': 'ALARM_RESPONSE',
    // Patient records
    'VIEWED_PATIENT_SUMMARY': 'REVIEWED_RECORDS',
    'VIEWED_HISTORY': 'REVIEWED_RECORDS',
    'VIEWED_MEDICATIONS': 'REVIEWED_RECORDS',
    'VIEWED_ALLERGIES': 'REVIEWED_RECORDS',
    'VIEWED_PATIENT_INFO': 'REVIEWED_RECORDS',
    'VIEWED_RECORDS': 'REVIEWED_RECORDS',
    // System/config verbs excluded (mapped to null)
    'STARTED_SESSION': null,
    'ENDED_SESSION': null,
    'RESUMED_SESSION': null,
    'IDLE_TIMEOUT': null,
    'CHANGED_SETTING': null,
    'SAVED_SETTING': null,
    'RESET_SETTING': null,
    'LOADED_CASE': null,
    'STARTED_SCENARIO': null,
    'PAUSED_SCENARIO': null,
    'RESUMED_SCENARIO': null,
    'SUBMITTED': null,
    'ANSWERED': null,
    'ATTEMPTED': null,
    'TREATMENT_EFFECT_STARTED': null,
    'TREATMENT_EFFECT_PEAKED': null,
    'TREATMENT_EFFECT_ENDED': null,
};

// GET /api/analytics/tna-sequences — LAILA-shaped TNA sequence builder
//
// Returns parallel arrays { sequences[][], objectTypeSequences[][] } so the
// client can flip between verb-only, object-only, combined-state, and raw
// verb:object views without re-fetching. Mirrors the contract of
// LAILA-v3 server/src/services/activityLog.service.ts:getTnaSequences().
//
// Pipeline (in order):
//   1. SELECT learning_events filtered by case_id / user_id / date / session
//   2. Optional verb merge via TNA_VERB_MERGE_MAP (skipMerges=true bypasses;
//      client-side resolver chain handles the same job in the new dashboard)
//   3. Count verb frequencies; rare verbs (< minVerbPct) become 'OTHER'
//   4. Group by ('actor' = user_id) or ('actor-session' = user_id::session_id)
//   5. Min-length filter: drop sequences with fewer than minSequenceLength events
//   6. P95 chunking: split sequences longer than the 95th-percentile length
//      into non-overlapping chunks (prevents one runaway tab from blowing up
//      the distance matrix in the Clusters tab)
router.get('/analytics/tna-sequences', authenticateToken, requireAdmin, (req, res) => {
    const {
        case_id, user_id, start_date, end_date,
        min_sequence_length = '2',
        min_verb_pct = '0.05',
        skip_merges,
        group_by = 'actor-session',
    } = req.query;
    const minLen = Math.max(2, parseInt(min_sequence_length, 10) || 2);
    const minVerbPct = Math.max(0, parseFloat(min_verb_pct) || 0);
    const skipMerges = String(skip_merges) === 'true';
    const grouping = group_by === 'actor' ? 'actor' : 'actor-session';

    let sql = `
        SELECT le.user_id, le.session_id, le.verb, le.object_type, le.timestamp,
               c.name AS case_title
          FROM learning_events le
          LEFT JOIN cases c ON c.id = le.case_id
         WHERE 1=1`;
    const params = [];
    if (case_id)    { sql += ' AND le.case_id = ?';    params.push(case_id); }
    if (user_id)    { sql += ' AND le.user_id = ?';    params.push(user_id); }
    if (start_date) { sql += ' AND le.timestamp >= ?'; params.push(start_date); }
    if (end_date)   { sql += ' AND le.timestamp <= ?'; params.push(end_date); }
    sql += ' ORDER BY le.user_id ASC, le.timestamp ASC LIMIT 50000';

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) {
            (req.log || routesAdminLog).error('tna sequences query failed', { error: err.message });
            return res.status(500).json({ error: err.message });
        }
        if (!rows || rows.length === 0) {
            return res.json({
                sequences: [], objectTypeSequences: [],
                metadata: {
                    totalSequences: 0, totalEvents: 0, groupBy: grouping,
                    uniqueVerbs: [], uniqueObjectTypes: [],
                    caseTitle: null, dateRange: null,
                },
            });
        }

        // 1. Apply verb merge unless skipped. Null mapping means "drop event".
        const merged = [];
        for (const row of rows) {
            let v = row.verb;
            if (!skipMerges && Object.prototype.hasOwnProperty.call(TNA_VERB_MERGE_MAP, v)) {
                v = TNA_VERB_MERGE_MAP[v];
                if (v === null) continue;
            }
            merged.push({ ...row, verb: v });
        }

        // 2. Rare-verb collapsing.
        const verbCounts = Object.create(null);
        for (const m of merged) verbCounts[m.verb] = (verbCounts[m.verb] || 0) + 1;
        const totalEvents = merged.length;
        const rareVerbs = new Set();
        if (minVerbPct > 0 && totalEvents > 0) {
            for (const [v, count] of Object.entries(verbCounts)) {
                if (count / totalEvents < minVerbPct) rareVerbs.add(v);
            }
        }

        // 3. Group into sequences. session_id may be null for events logged
        //    outside a session — fall back to actor for those.
        const seqMap = Object.create(null);
        const objMap = Object.create(null);
        for (const m of merged) {
            const key = grouping === 'actor-session' && m.session_id
                ? `${m.user_id}::${m.session_id}`
                : String(m.user_id);
            if (!seqMap[key]) { seqMap[key] = []; objMap[key] = []; }
            seqMap[key].push(rareVerbs.has(m.verb) ? 'OTHER' : m.verb);
            objMap[key].push(m.object_type || '');
        }

        // 4. Min-length filter.
        const rawSeqs = [];
        const rawObjSeqs = [];
        for (const key of Object.keys(seqMap)) {
            if (seqMap[key].length >= minLen) {
                rawSeqs.push(seqMap[key]);
                rawObjSeqs.push(objMap[key]);
            }
        }

        // 5. P95 chunking. The cap = max(p95Length, 2 × minLen) so we don't
        //    chop normal sessions just because one user left a tab open.
        const sequences = [];
        const objectTypeSequences = [];
        if (rawSeqs.length > 0) {
            const lens = rawSeqs.map((s) => s.length).sort((a, b) => a - b);
            const p95Idx = Math.floor(lens.length * 0.95);
            const p95 = lens[Math.min(p95Idx, lens.length - 1)];
            const maxLen = Math.max(p95, minLen * 2);

            for (let i = 0; i < rawSeqs.length; i++) {
                if (rawSeqs[i].length <= maxLen) {
                    sequences.push(rawSeqs[i]);
                    objectTypeSequences.push(rawObjSeqs[i]);
                } else {
                    for (let s = 0; s < rawSeqs[i].length; s += maxLen) {
                        const chunk = rawSeqs[i].slice(s, s + maxLen);
                        const objChunk = rawObjSeqs[i].slice(s, s + maxLen);
                        if (chunk.length >= minLen) {
                            sequences.push(chunk);
                            objectTypeSequences.push(objChunk);
                        }
                    }
                }
            }
        }

        // 6. Metadata.
        const uniqueVerbs = new Set();
        const uniqueObjectTypes = new Set();
        for (let i = 0; i < sequences.length; i++) {
            for (const v of sequences[i]) uniqueVerbs.add(v);
            for (const o of objectTypeSequences[i]) if (o) uniqueObjectTypes.add(o);
        }
        const caseTitle = rows.find((r) => r.case_title)?.case_title || null;
        const dateRange = rows.length
            ? { start: rows[0].timestamp, end: rows[rows.length - 1].timestamp }
            : null;

        res.json({
            sequences,
            objectTypeSequences,
            metadata: {
                totalSequences: sequences.length,
                totalEvents,
                groupBy: grouping,
                uniqueVerbs: [...uniqueVerbs].sort(),
                uniqueObjectTypes: [...uniqueObjectTypes].sort(),
                caseTitle,
                dateRange,
            },
        });
    });
});

// GET /api/analytics/daily-counts — events per calendar day for the timeline.
router.get('/analytics/daily-counts', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, user_id, start_date, end_date } = req.query;
    let sql = `SELECT date(timestamp) AS day, COUNT(*) AS n
                 FROM learning_events WHERE 1=1`;
    const params = [];
    if (case_id)    { sql += ' AND case_id = ?';    params.push(case_id); }
    if (user_id)    { sql += ' AND user_id = ?';    params.push(user_id); }
    if (start_date) { sql += ' AND timestamp >= ?'; params.push(start_date); }
    if (end_date)   { sql += ' AND timestamp <= ?'; params.push(end_date); }
    sql += ' GROUP BY day ORDER BY day';
    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ daily: rows.map((r) => ({ date: r.day, count: r.n })) });
    });
});

// GET /api/analytics/hourly-counts — day-of-week × hour-of-day grid.
//
// Returns the shape LAILA's ActivityHeatmap component expects:
// `[{ dow: 0..6, hour: 0..23, count }]`. SQLite's strftime('%w', ...)
// returns 0 (Sunday) through 6 (Saturday) — same convention as JS
// Date.getDay(). Unobserved cells are returned with count=0 so the
// heatmap renders a full grid even on sparse data.
router.get('/analytics/hourly-counts', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, user_id, start_date, end_date } = req.query;
    let sql = `SELECT CAST(strftime('%w', timestamp) AS INTEGER) AS dow,
                      CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
                      COUNT(*) AS n
                 FROM learning_events WHERE 1=1`;
    const params = [];
    if (case_id)    { sql += ' AND case_id = ?';    params.push(case_id); }
    if (user_id)    { sql += ' AND user_id = ?';    params.push(user_id); }
    if (start_date) { sql += ' AND timestamp >= ?'; params.push(start_date); }
    if (end_date)   { sql += ' AND timestamp <= ?'; params.push(end_date); }
    sql += ' GROUP BY dow, hour ORDER BY dow, hour';
    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Build the dense 7×24 grid LAILA's heatmap expects.
        const grid = [];
        const observed = new Map();
        for (const r of rows) {
            if (Number.isInteger(r.dow) && Number.isInteger(r.hour)) {
                observed.set(`${r.dow}:${r.hour}`, r.n);
            }
        }
        for (let dow = 0; dow < 7; dow++) {
            for (let hour = 0; hour < 24; hour++) {
                grid.push({ dow, hour, count: observed.get(`${dow}:${hour}`) || 0 });
            }
        }
        res.json({ hourly: grid });
    });
});

// GET /api/analytics/timeline-series — verb-broken-out daily counts in
// the shape LAILA's ActivityTimelineChart expects:
//   { days: ['YYYY-MM-DD', ...], verbs: ['ORDERED_LAB', ...],
//     series: { ORDERED_LAB: [n_for_day0, n_for_day1, ...], ... } }
// Limits to the top 10 verbs by total count and folds the rest into a
// synthetic 'OTHER' series so the legend stays readable.
router.get('/analytics/timeline-series', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, user_id, start_date, end_date } = req.query;
    let sql = `SELECT date(timestamp) AS day, verb, COUNT(*) AS n
                 FROM learning_events WHERE 1=1`;
    const params = [];
    if (case_id)    { sql += ' AND case_id = ?';    params.push(case_id); }
    if (user_id)    { sql += ' AND user_id = ?';    params.push(user_id); }
    if (start_date) { sql += ' AND timestamp >= ?'; params.push(start_date); }
    if (end_date)   { sql += ' AND timestamp <= ?'; params.push(end_date); }
    sql += ' GROUP BY day, verb ORDER BY day, verb';
    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows.length) return res.json({ days: [], verbs: [], series: {} });

        const dayIdx = new Map();
        const days = [];
        const verbTotals = new Map();
        for (const r of rows) {
            if (!dayIdx.has(r.day)) { dayIdx.set(r.day, days.length); days.push(r.day); }
            verbTotals.set(r.verb, (verbTotals.get(r.verb) || 0) + r.n);
        }

        // Top 10 verbs by total count, rest into 'OTHER'.
        const TOP = 10;
        const sortedVerbs = [...verbTotals.entries()].sort((a, b) => b[1] - a[1]);
        const topVerbs = new Set(sortedVerbs.slice(0, TOP).map(([v]) => v));
        const verbs = [...topVerbs];
        if (sortedVerbs.length > TOP) verbs.push('OTHER');

        const series = {};
        for (const v of verbs) series[v] = Array(days.length).fill(0);
        for (const r of rows) {
            const i = dayIdx.get(r.day);
            const bucket = topVerbs.has(r.verb) ? r.verb : 'OTHER';
            if (series[bucket]) series[bucket][i] += r.n;
        }
        res.json({ days, verbs, series });
    });
});

// GET /api/analytics/summary — top-line stat-card numbers.
router.get('/analytics/summary', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, user_id, start_date, end_date } = req.query;
    let where = ' WHERE 1=1';
    const params = [];
    if (case_id)    { where += ' AND case_id = ?';    params.push(case_id); }
    if (user_id)    { where += ' AND user_id = ?';    params.push(user_id); }
    if (start_date) { where += ' AND timestamp >= ?'; params.push(start_date); }
    if (end_date)   { where += ' AND timestamp <= ?'; params.push(end_date); }

    const sql = `SELECT COUNT(*) AS totalActivities,
                        COUNT(DISTINCT user_id) AS uniqueUsers,
                        COUNT(DISTINCT session_id) AS uniqueSessions
                   FROM learning_events ${where}`;
    dbAdapter.get(sql, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = row?.totalActivities || 0;
        const users = row?.uniqueUsers || 0;
        res.json({
            totalActivities: total,
            uniqueUsers: users,
            uniqueSessions: row?.uniqueSessions || 0,
            avgPerUser: users > 0 ? Math.round(total / users) : 0,
        });
    });
});

// GET /api/analytics/stats — verb + object type frequency for donut charts.
router.get('/analytics/stats', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, start_date, end_date } = req.query;
    let where = ' WHERE 1=1';
    const params = [];
    if (case_id)    { where += ' AND case_id = ?';    params.push(case_id); }
    if (start_date) { where += ' AND timestamp >= ?'; params.push(start_date); }
    if (end_date)   { where += ' AND timestamp <= ?'; params.push(end_date); }

    const verbsSql = `SELECT verb AS label, COUNT(*) AS count FROM learning_events ${where} GROUP BY verb ORDER BY count DESC`;
    const objsSql  = `SELECT object_type AS label, COUNT(*) AS count FROM learning_events ${where} GROUP BY object_type ORDER BY count DESC`;
    dbAdapter.all(verbsSql, params, (err1, verbs) => {
        if (err1) return res.status(500).json({ error: err1.message });
        dbAdapter.all(objsSql, params, (err2, objs) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ verbs: verbs || [], objectTypes: objs || [] });
        });
    });
});

// GET /api/analytics/top-resources — most-touched object_id+name (the
// simulator equivalent of LAILA's top resources). Useful to spot which
// labs / treatments / patients the cohort gravitates to.
router.get('/analytics/top-resources', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, user_id, start_date, end_date, limit = '10' } = req.query;
    let sql = `SELECT object_type, object_name, COUNT(*) AS n
                 FROM learning_events
                WHERE object_name IS NOT NULL AND object_name != ''`;
    const params = [];
    if (case_id)    { sql += ' AND case_id = ?';    params.push(case_id); }
    if (user_id)    { sql += ' AND user_id = ?';    params.push(user_id); }
    if (start_date) { sql += ' AND timestamp >= ?'; params.push(start_date); }
    if (end_date)   { sql += ' AND timestamp <= ?'; params.push(end_date); }
    sql += ' GROUP BY object_type, object_name ORDER BY n DESC LIMIT ?';
    params.push(Math.min(parseInt(limit, 10) || 10, 100));
    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ resources: rows || [] });
    });
});

// GET /api/analytics/filter-options — courses + students for dropdown filters.
router.get('/analytics/filter-options', authenticateToken, requireAdmin, (req, res) => {
    dbAdapter.all(
        `SELECT id, name AS title FROM cases WHERE deleted_at IS NULL ORDER BY name`,
        [],
        (err1, cases) => {
            if (err1) return res.status(500).json({ error: err1.message });
            dbAdapter.all(
                `SELECT DISTINCT u.id, u.username, u.name AS fullname, u.email
                   FROM users u
                   JOIN learning_events le ON le.user_id = u.id
                  ORDER BY u.username`,
                [],
                (err2, users) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ cases: cases || [], users: users || [] });
                }
            );
        }
    );
});

// ============================================================
// EMOTION LOGS
// ============================================================

// POST /api/emotion-logs - Log a doctor emotion during a session
router.post('/emotion-logs', authenticateToken, (req, res) => {
    const { session_id, case_id, emotion } = req.body;
    const user_id = req.user.id;

    if (!emotion || typeof emotion !== 'string' || !emotion.trim()) {
        return res.status(400).json({ error: 'emotion is required' });
    }

    dbAdapter.run(
        `INSERT INTO emotion_logs (session_id, user_id, case_id, emotion) VALUES (?, ?, ?, ?)`,
        [session_id || null, user_id, case_id || null, emotion.trim()],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

// GET /api/emotion-logs - Retrieve all emotion logs (admin only)
router.get('/emotion-logs', authenticateToken, requireAdmin, (req, res) => {
    const sql = `
        SELECT
            el.id,
            el.timestamp,
            el.emotion,
            el.session_id,
            el.case_id,
            u.username,
            u.name AS student_name,
            u.email,
            c.name AS case_name
        FROM emotion_logs el
        LEFT JOIN users u ON el.user_id = u.id
        LEFT JOIN cases c ON el.case_id = c.id
        ORDER BY el.timestamp DESC
        LIMIT 2000
    `;
    dbAdapter.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ─── Reflection Questionnaire ────────────────────────────────────────────────

// GET /api/export/questionnaire-responses - Export questionnaire responses as CSV (admin only)
router.get('/export/questionnaire-responses', authenticateToken, requireAdmin, (req, res) => {
    const { start_date, end_date } = req.query;

    let sql = `
        SELECT
            qr.id,
            qr.session_id,
            qr.user_id,
            u.username,
            u.email,
            qr.case_id,
            c.name AS case_name,
            qr.submitted_at,
            qr.responses
        FROM questionnaire_responses qr
        LEFT JOIN users u ON qr.user_id = u.id
        LEFT JOIN cases c ON qr.case_id = c.id
        WHERE 1=1
    `;
    const params = [];
    if (start_date) { sql += ' AND qr.submitted_at >= ?'; params.push(start_date); }
    if (end_date)   { sql += ' AND qr.submitted_at <= ?'; params.push(end_date); }
    sql += ' ORDER BY qr.submitted_at DESC';

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Flatten responses JSON into individual columns
        const flat = rows.map(row => {
            let resp = {};
            try { resp = typeof row.responses === 'string' ? JSON.parse(row.responses) : (row.responses || {}); } catch {}
            const arrToStr = v => Array.isArray(v) ? v.join('; ') : (v !== null && v !== undefined ? String(v) : '');
            return {
                id: row.id,
                session_id: row.session_id ?? '',
                user_id: row.user_id,
                username: row.username ?? '',
                email: row.email ?? '',
                case_id: row.case_id ?? '',
                case_name: row.case_name ?? '',
                submitted_at: row.submitted_at,
                diagnosis: arrToStr(resp.diagnosis),
                diagnosis_confidence: resp.diagnosisConfidence !== undefined ? resp.diagnosisConfidence : '',
                how_decision_was_made: arrToStr(resp.decisionProcess),
                key_factors: arrToStr(resp.keyFactors),
                possible_treatment: arrToStr(resp.treatment),
                treatment_confidence: resp.treatmentConfidence !== undefined ? resp.treatmentConfidence : '',
                areas_to_improve: arrToStr(resp.improvements),
                would_do_differently: arrToStr(resp.doDifferently),
            };
        });

        const HEADERS = [
            'id','session_id','user_id','username','email','case_id','case_name','submitted_at',
            'diagnosis','diagnosis_confidence','how_decision_was_made','key_factors',
            'possible_treatment','treatment_confidence','areas_to_improve','would_do_differently',
        ];
        const csv = flat.length > 0
            ? convertToCSV(flat)
            : HEADERS.map(h => `"${h}"`).join(',');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=questionnaire_responses.csv');
        res.send(csv);
    });
});

// POST /api/questionnaire-responses - Save a questionnaire submission
router.post('/questionnaire-responses', authenticateToken, (req, res) => {
    const { session_id, case_id, responses } = req.body;
    const user_id = req.user.id;

    if (!responses || typeof responses !== 'object') {
        return res.status(400).json({ error: 'responses is required and must be an object' });
    }

    const sql = `
        INSERT INTO questionnaire_responses (session_id, user_id, case_id, responses)
        VALUES (?, ?, ?, ?)
    `;
    dbAdapter.run(sql, [session_id || null, user_id, case_id || null, JSON.stringify(responses)], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// GET /api/questionnaire-responses - Get questionnaire responses (admin: all; user: own)
router.get('/questionnaire-responses', authenticateToken, (req, res) => {
    let sql, params;

    if (canReadAcrossUsers(req.user)) {
        sql = `
            SELECT qr.id, qr.session_id, qr.case_id, qr.submitted_at, qr.responses,
                   u.username, u.email,
                   c.name as case_name
            FROM questionnaire_responses qr
            LEFT JOIN users u ON qr.user_id = u.id
            LEFT JOIN cases c ON qr.case_id = c.id
            ORDER BY qr.submitted_at DESC
        `;
        params = [];
    } else {
        sql = `
            SELECT qr.id, qr.session_id, qr.case_id, qr.submitted_at, qr.responses,
                   c.name as case_name
            FROM questionnaire_responses qr
            LEFT JOIN cases c ON qr.case_id = c.id
            WHERE qr.user_id = ?
            ORDER BY qr.submitted_at DESC
        `;
        params = [req.user.id];
    }

    dbAdapter.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsed = rows.map(r => ({
            ...r,
            responses: typeof r.responses === 'string' ? JSON.parse(r.responses) : r.responses,
        }));
        res.json({ responses: parsed });
    });
});

// ==================== DISCUSSION NOTES ====================
// Free-form notes the learner writes during the case-debrief discussion screen.
// Per-user scoped: each user gets their own row per session. Distinct from
// clinical_notes (charted patient notes) which uses a separate /notes route.

// GET /sessions/:sessionId/discussion-notes — current user's discussion note

export default router;
