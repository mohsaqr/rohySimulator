import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import {
    authenticateToken,
    requireAdmin,
    requireEducator,
    ROLE_RANKS,
    hasRoleAtLeast,
} from '../middleware/auth.js';




import { logger } from '../logger.js';
import {
    auditSuccess,
    canReadAcrossUsers,
    dbRun,
    redactRow,
    redactRows,
    resolveSessionTrinity,
    tenantId,
    verifySessionOwnership
} from './_helpers.js';

const radiologyLog = logger('radiology');
const routesAdminLog = logger('routes-agent-tna-admin');

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

        // Dual-write into learning_events so the unified Activity view sees
        // settings changes alongside session events.
        dbAdapter.run(
            `INSERT INTO learning_events (
                session_id, user_id, case_id, verb, object_type, object_id, object_name,
                component, result, context, severity, category, tenant_id
            ) VALUES (?, ?, ?, 'CHANGED_SETTING', 'setting', ?, ?, 'CONFIG_PANEL', ?, ?, 'INFO', 'CONFIGURATION', ?)`,
            [
                session_id || null,
                req.user.id,
                case_id || null,
                setting_type || null,
                setting_name || setting_type,
                new_value != null ? `${old_value ?? ''} → ${new_value}` : null,
                JSON.stringify({ setting_type, setting_name, old_value, new_value }),
                tenantId(req),
            ]
        );

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

// --- CSV EXPORT ENDPOINTS ---
//
// Four legacy per-table exports (login-logs, chat-logs, settings-logs,
// session-settings) were removed in the export-unification pass. Their
// content is now served by:
//   * /api/export/learning-events     — every student action (xAPI canonical)
//   * /api/export/system-log/:source  — admin firehose, source = auth | config
//                                       | chat | learning | alarm | llm | tts
//                                       | emotion | oyon | vitals | scenario
//                                       | client | admin (server-paged stream)
//   * /api/export/complete-session/:id — per-session CSV bundle (kept below)
//   * /api/export/questionnaire-responses — reflection questionnaire

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

// --- EVENT LOG ENDPOINTS (legacy) ---
//
// POST /api/events/batch was retired in Phase 2 of PLAN_LOGGING.md (legacy
// event_log writer migration). All callers now use /api/learning-events/batch.
// The GET endpoint below remains for any read code still depending on the
// table; it is fed only by historical rows and is queued for removal once
// Phase 4's UI consolidation lands.

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
    // Instructor / case authoring
    'EDITED_LAB_VALUE',
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
//
// Trinity invariant (Phase 1 of PLAN_LOGGING.md): the server derives user_id
// and case_id from session_id via the sessions table. Client-supplied
// case_id is ignored; client-supplied user_id is irrelevant (auth principal
// is used for pre-session events). A stale/replayed POST cannot mislabel.
router.post('/learning-events', authenticateToken, async (req, res) => {
    const {
        session_id,
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
        message_role,
        room,
    } = req.body;

    if (!verb || !LEARNING_VERBS.includes(verb)) {
        return res.status(400).json({
            error: `Invalid verb. Must be one of: ${LEARNING_VERBS.join(', ')}`
        });
    }

    if (!object_type) {
        return res.status(400).json({ error: 'object_type is required' });
    }

    let user_id;
    let case_id;

    if (session_id) {
        const trinity = await resolveSessionTrinity(session_id, tenantId(req));
        if (!trinity.found) {
            return res.status(404).json({
                error: 'session not found in tenant',
                reason: trinity.reason,
            });
        }
        user_id = trinity.user_id;
        case_id = trinity.case_id;
    } else {
        // Pre-session telemetry (e.g. case browsing before session start).
        user_id = req.user.id;
        case_id = null;
    }

    const sql = `
        INSERT INTO learning_events (
            session_id, user_id, case_id, verb,
            object_type, object_id, object_name,
            component, parent_component,
            result, duration_ms, context,
            message_content, message_role, tenant_id,
            room
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    dbAdapter.run(sql, [
        session_id || null,
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
        tenantId(req),
        room || null,
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// POST /api/learning-events/batch - Log multiple events at once
//
// Trinity invariant (Phase 1 of PLAN_LOGGING.md): for each event the server
// derives user_id and case_id from the session_id via the sessions table.
// Client-supplied case_id is ignored; client-supplied user_id is unused.
// Trinity is cached per distinct session_id (one DB read per session, not
// per event).
//
// Response shape (tightened per Codex round-2):
//   {
//     inserted, dropped, total,
//     dropped_reasons: {
//       cross_tenant: <int>,
//       missing_required_field: <int>,
//       db_error: <int>,
//     }
//   }
router.post('/learning-events/batch', authenticateToken, async (req, res) => {
    const { events } = req.body;
    const reqTenantId = tenantId(req);
    const principalUserId = req.user.id;

    if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'events array is required' });
    }

    // Resolve trinity once per distinct session_id.
    const distinctSessionIds = [...new Set(events.map(e => e.session_id).filter(Boolean))];
    const trinityCache = new Map();
    await Promise.all(distinctSessionIds.map(async (sid) => {
        trinityCache.set(sid, await resolveSessionTrinity(sid, reqTenantId));
    }));

    const sql = `
        INSERT INTO learning_events (
            session_id, user_id, case_id, verb,
            object_type, object_id, object_name,
            component, parent_component,
            result, duration_ms, context,
            message_content, message_role, timestamp, tenant_id,
            vital_hr, vital_spo2, vital_bp_sys, vital_bp_dia,
            vital_rr, vital_temp, vital_etco2, vital_rhythm,
            room
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?, ?, ?,
                  ?)
    `;

    const stmt = dbAdapter.prepare(sql);
    let inserted = 0;
    let dropped = 0;
    const droppedReasons = {
        cross_tenant: 0,
        missing_required_field: 0,
        db_error: 0,
    };

    // Codex round-3 finding 2: prepare + finalize wrapped so a thrown
    // promise (DB error during a run, JSON.stringify on a circular
    // context, etc.) cannot leak the prepared statement nor leave the
    // request without a terminal response.
    try {
        const runPromises = [];
        for (const event of events) {
            if (!event.verb || !event.object_type) {
                dropped++;
                droppedReasons.missing_required_field++;
                continue;
            }

            let user_id;
            let case_id;
            if (event.session_id) {
                const trinity = trinityCache.get(event.session_id);
                if (!trinity || !trinity.found) {
                    dropped++;
                    droppedReasons.cross_tenant++;
                    continue;
                }
                user_id = trinity.user_id;
                case_id = trinity.case_id;
            } else {
                user_id = principalUserId;
                case_id = null;
            }

            runPromises.push(
                stmt.run([
                    event.session_id || null,
                    user_id,
                    case_id,
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
                    reqTenantId,
                    event.vital_hr ?? null,
                    event.vital_spo2 ?? null,
                    event.vital_bp_sys ?? null,
                    event.vital_bp_dia ?? null,
                    event.vital_rr ?? null,
                    event.vital_temp ?? null,
                    event.vital_etco2 ?? null,
                    event.vital_rhythm ?? null,
                    event.room || null,
                ]).then(() => { inserted++; }, () => {
                    dropped++;
                    droppedReasons.db_error++;
                })
            );
        }

        await Promise.all(runPromises);
    } finally {
        try { await stmt.finalize(); } catch { /* finalize errors don't change the response */ }
    }

    res.json({
        inserted,
        dropped,
        total: events.length,
        dropped_reasons: droppedReasons,
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

// GET /api/export/learning-events - Cohort xAPI CSV export (Phase 5 of PLAN_LOGGING.md)
//
// One row per learning_events record with the trinity (session_id, user_id,
// case_id) plus xAPI columns and joined username/case_name. Tenant-scoped.
// Non-admin callers see only their own rows; admins see tenant-wide.
//
// Filters (all optional): from, to (ISO date), user_id, case_id, session_id, verb.
//
// Row-cap policy (Codex round-2):
//   - Soft cap 50,000. Default request returns 413 if matched count > 50k.
//   - Hard ceiling 200,000 (admin override via ?confirm_large=1).
//   - Beyond 200k → 413 even with confirm_large; ask researcher to script
//     directly against SQLite or use date-range slicing.
const LEARNING_EVENTS_SOFT_CAP = 50_000;
const LEARNING_EVENTS_HARD_CAP = 200_000;

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    let s = typeof value === 'string' ? value : String(value);
    // Spreadsheet-injection guard (Codex round-3): cells starting with =,
    // +, -, @, or tab/CR are interpreted as formulas by Excel/Calc/Numbers.
    // Prefix a single quote to neutralise. We then still apply RFC 4180.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

router.get('/export/learning-events', authenticateToken, (req, res) => {
    const tenant_id = tenantId(req);
    // Aligned with /api/learning-events/all: reviewer+ can read across
    // users; non-reviewers see only their own rows. The "admin-only"
    // confirm_large override is a stricter cap, not the read scope.
    const canCross = canReadAcrossUsers(req.user);
    const isAdmin = hasRoleAtLeast(req.user, ROLE_RANKS.admin);
    const confirmLarge = req.query.confirm_large === '1';

    // Build WHERE
    const filters = ['le.tenant_id = ?'];
    const params = [tenant_id];

    if (!canCross) {
        filters.push('le.user_id = ?');
        params.push(req.user.id);
    }
    if (req.query.from) { filters.push('le.timestamp >= ?'); params.push(req.query.from); }
    if (req.query.to)   { filters.push('le.timestamp < date(?, "+1 day")'); params.push(req.query.to); }
    if (req.query.user_id)    { filters.push('le.user_id = ?');    params.push(req.query.user_id); }
    if (req.query.case_id)    { filters.push('le.case_id = ?');    params.push(req.query.case_id); }
    if (req.query.session_id) { filters.push('le.session_id = ?'); params.push(req.query.session_id); }
    if (req.query.verb)       { filters.push('le.verb = ?');       params.push(req.query.verb); }

    const whereClause = filters.join(' AND ');

    // Pre-flight: count rows so we can refuse oversize requests deterministically.
    const countSql = `SELECT COUNT(*) AS n FROM learning_events le WHERE ${whereClause}`;
    dbAdapter.get(countSql, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const count = row?.n || 0;

        if (count > LEARNING_EVENTS_HARD_CAP) {
            return res.status(413).json({
                error: 'export too large',
                count,
                hint: 'Narrow with ?from / ?to / ?user_id / ?case_id, or query the database directly.',
            });
        }
        if (count > LEARNING_EVENTS_SOFT_CAP && !(isAdmin && confirmLarge)) {
            return res.status(413).json({
                error: 'export exceeds soft cap',
                count,
                soft_cap: LEARNING_EVENTS_SOFT_CAP,
                hint: isAdmin
                    ? 'Add ?confirm_large=1 to override (admin only) or narrow filters.'
                    : 'Narrow filters with ?from / ?to / ?user_id / ?case_id.',
            });
        }

        // Stream rows in chunks. Joined columns make the CSV self-contained.
        // Tenant predicates on JOINs (Codex round-3 finding 4): if a
        // bug ever wrote a learning_events row pointing at a user/case in
        // another tenant, the LEFT JOIN without these predicates would
        // disclose the foreign tenant's name in the export. Belt-and-
        // braces — the WHERE le.tenant_id filter already scopes le, but
        // the joins should be scoped too.
        const dataSql = `
            SELECT
                le.timestamp, le.user_id, u.username, le.case_id, c.name AS case_name,
                le.session_id, le.verb, le.object_type, le.object_id, le.object_name,
                le.component, le.parent_component, le.result, le.duration_ms,
                le.message_role, le.message_content, le.severity, le.category, le.context
            FROM learning_events le
            LEFT JOIN users u ON le.user_id = u.id AND u.tenant_id = le.tenant_id
            LEFT JOIN cases c ON le.case_id = c.id AND c.tenant_id = le.tenant_id
            WHERE ${whereClause}
            ORDER BY le.timestamp ASC
        `;

        const filename = `learning-events_${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const headers = [
            'timestamp', 'user_id', 'username', 'case_id', 'case_name', 'session_id',
            'verb', 'object_type', 'object_id', 'object_name',
            'component', 'parent_component', 'result', 'duration_ms',
            'message_role', 'message_content', 'severity', 'category', 'context_json',
        ];
        res.write(headers.join(',') + '\n');

        // Memory bound: row count is already gated by the cap above
        // (50k soft / 200k hard), so loading via `all` is safe. Once a
        // streaming cursor lands in dbAdapter we can swap to `each`.
        dbAdapter.all(dataSql, params, (err2, rows) => {
            if (err2) {
                // Headers already sent; close cleanly.
                res.end();
                logger('analytics-routes').warn('learning-events export query failed', {
                    error: err2.message, expected: count,
                });
                return;
            }
            for (const r of rows) {
                const cells = [
                    r.timestamp, r.user_id, r.username, r.case_id, r.case_name, r.session_id,
                    r.verb, r.object_type, r.object_id, r.object_name,
                    r.component, r.parent_component, r.result, r.duration_ms,
                    r.message_role, r.message_content, r.severity, r.category, r.context,
                ].map(csvEscape);
                res.write(cells.join(',') + '\n');
            }
            res.end();
        });
    });
});

// --- CHAT LOG (every chat-related event, admin only) ---
//
// One feed for everything that touches the conversation: raw chat rows,
// SENT/RECEIVED/COPIED/EDITED/STT/TTS verbs, every LLM API call (with
// prompt/response/tokens/latency), TTS playbacks, and student emotion
// samples. Rows are normalised to:
//   { ts, user_id, username, case_id, case_name, session_id, source,
//     role, content, tokens_in, tokens_out, latency_ms, model, extra }
router.get('/chat-log/feed', authenticateToken, requireAdmin, (req, res) => {
    const tenant = tenantId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 10000);
    const sessionId = req.query.session_id || null;

    const dateFrom = req.query.from || null;
    const dateTo = req.query.to || null;
    const dateFilter = (col) => {
        const parts = []; const params = [];
        if (dateFrom) { parts.push(`${col} >= ?`); params.push(dateFrom); }
        if (dateTo)   { parts.push(`${col} < date(?, '+1 day')`); params.push(dateTo); }
        return { clause: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
    };
    const sessionWhere = (col) => sessionId ? ` AND ${col} = ?` : '';
    const sessionParam = () => sessionId ? [sessionId] : [];

    const tableExists = (name) => new Promise((resolve) => {
        dbAdapter.get(
            `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
            [name], (err, row) => resolve(err ? false : !!row)
        );
    });
    const allP = (sql, params) => new Promise((resolve) => {
        dbAdapter.all(sql, params, (err, rows) => resolve(err ? [] : (rows || [])));
    });

    const queries = [];

    // 1. interactions → raw chat (full content, untruncated).
    queries.push(async () => {
        if (!await tableExists('interactions')) return [];
        const f = dateFilter('i.timestamp');
        return allP(`
            SELECT i.timestamp AS ts,
                   s.user_id, u.username,
                   s.case_id, c.name AS case_name,
                   i.session_id,
                   'interaction' AS source,
                   i.role AS role,
                   i.content AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   NULL AS latency_ms, NULL AS model,
                   NULL AS extra
            FROM interactions i
            LEFT JOIN sessions s ON i.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN cases c ON s.case_id = c.id
            WHERE i.tenant_id = ? ${f.clause} ${sessionWhere('i.session_id')}
            ORDER BY i.timestamp DESC LIMIT ?
        `, [tenant, ...f.params, ...sessionParam(), limit]);
    });

    // 2. learning_events for everything chat/voice/affect/audio related.
    // Catches COMMUNICATION category plus stragglers (STT_ERROR is in ERROR
    // category) and voice/audio object_types.
    queries.push(async () => {
        const f = dateFilter('le.timestamp');
        return allP(`
            SELECT le.timestamp AS ts,
                   le.user_id, u.username,
                   le.case_id, c.name AS case_name,
                   le.session_id,
                   'event' AS source,
                   COALESCE(le.message_role, le.verb) AS role,
                   COALESCE(le.message_content, le.object_name, le.result, le.verb) AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   le.duration_ms AS latency_ms,
                   le.component AS model,
                   le.verb AS extra
            FROM learning_events le
            LEFT JOIN users u ON le.user_id = u.id
            LEFT JOIN cases c ON le.case_id = c.id
            WHERE le.tenant_id = ?
              AND (
                  le.category = 'COMMUNICATION'
                  OR le.verb IN ('EXPRESSED_EMOTION', 'STT_RESULT', 'STT_ERROR', 'TTS_PLAYED', 'SENT_MESSAGE', 'RECEIVED_MESSAGE', 'COPIED_MESSAGE', 'EDITED_MESSAGE')
                  OR le.object_type IN ('voice', 'audio', 'message', 'chat')
              )
              ${f.clause} ${sessionWhere('le.session_id')}
            ORDER BY le.timestamp DESC LIMIT ?
        `, [tenant, ...f.params, ...sessionParam(), limit]);
    });

    // 2b. agent_conversations → multi-agent chat threads (consultant, lab,
    // pharmacy, etc.). Each agent_type has its own role + content stream.
    queries.push(async () => {
        if (!await tableExists('agent_conversations')) return [];
        const f = dateFilter('ac.created_at');
        return allP(`
            SELECT ac.created_at AS ts,
                   s.user_id, u.username,
                   s.case_id, c.name AS case_name,
                   ac.session_id,
                   'agent' AS source,
                   ac.role AS role,
                   ac.content AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   NULL AS latency_ms,
                   ac.agent_type AS model,
                   ac.agent_type AS extra
            FROM agent_conversations ac
            LEFT JOIN sessions s ON ac.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN cases c ON s.case_id = c.id
            WHERE ac.tenant_id = ? ${f.clause} ${sessionWhere('ac.session_id')}
            ORDER BY ac.created_at DESC LIMIT ?
        `, [tenant, ...f.params, ...sessionParam(), limit]);
    });

    // 2c. team_communications_log → end-of-handoff summaries from each
    // agent type. Per-session "what was discussed" key points.
    queries.push(async () => {
        if (!await tableExists('team_communications_log')) return [];
        const f = dateFilter('tcl.created_at');
        return allP(`
            SELECT tcl.created_at AS ts,
                   s.user_id, u.username,
                   s.case_id, c.name AS case_name,
                   tcl.session_id,
                   'team' AS source,
                   'summary' AS role,
                   tcl.key_points AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   NULL AS latency_ms,
                   tcl.agent_type AS model,
                   tcl.agent_type AS extra
            FROM team_communications_log tcl
            LEFT JOIN sessions s ON tcl.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN cases c ON s.case_id = c.id
            WHERE tcl.tenant_id = ? ${f.clause} ${sessionWhere('tcl.session_id')}
            ORDER BY tcl.created_at DESC LIMIT ?
        `, [tenant, ...f.params, ...sessionParam(), limit]);
    });

    // 3. llm_request_log → every LLM API call with prompt/response/tokens.
    queries.push(async () => {
        if (!await tableExists('llm_request_log')) return [];
        // Schema varies — discover columns once and adapt.
        const cols = await new Promise((resolve) => {
            dbAdapter.all(`PRAGMA table_info("llm_request_log")`, [], (err, rows) =>
                resolve(err ? [] : (rows || []).map(r => r.name)));
        });
        const has = (n) => cols.includes(n);
        const inTok  = has('prompt_tokens')     ? 'lrl.prompt_tokens'     : has('input_tokens')  ? 'lrl.input_tokens'  : 'NULL';
        const outTok = has('completion_tokens') ? 'lrl.completion_tokens' : has('output_tokens') ? 'lrl.output_tokens' : 'NULL';
        const latency= has('latency_ms')        ? 'lrl.latency_ms'        : has('duration_ms')   ? 'lrl.duration_ms'   : 'NULL';
        const sessCol= has('session_id') ? 'lrl.session_id' : 'NULL';
        const f = dateFilter('lrl.request_timestamp');
        return allP(`
            SELECT lrl.request_timestamp AS ts,
                   lrl.user_id, u.username,
                   NULL AS case_id, NULL AS case_name,
                   ${sessCol} AS session_id,
                   'llm' AS source,
                   COALESCE(lrl.status, 'request') AS role,
                   COALESCE(lrl.error_message, lrl.model) AS content,
                   ${inTok} AS tokens_in, ${outTok} AS tokens_out,
                   ${latency} AS latency_ms,
                   lrl.model AS model,
                   lrl.status AS extra
            FROM llm_request_log lrl
            LEFT JOIN users u ON lrl.user_id = u.id
            WHERE lrl.tenant_id = ? ${f.clause}
                  ${sessionId && has('session_id') ? `AND lrl.session_id = ?` : ''}
            ORDER BY lrl.request_timestamp DESC LIMIT ?
        `, [tenant, ...f.params, ...(sessionId && has('session_id') ? [sessionId] : []), limit]);
    });

    // 4. tts_usage → every TTS playback.
    queries.push(async () => {
        if (!await tableExists('tts_usage')) return [];
        const f = dateFilter('tu.created_at');
        return allP(`
            SELECT tu.created_at AS ts,
                   tu.user_id, u.username,
                   NULL AS case_id, NULL AS case_name,
                   NULL AS session_id,
                   'tts' AS source,
                   tu.voice AS role,
                   tu.provider || COALESCE(' / ' || tu.voice, '') AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   NULL AS latency_ms,
                   tu.provider AS model,
                   NULL AS extra
            FROM tts_usage tu
            LEFT JOIN users u ON tu.user_id = u.id
            WHERE tu.tenant_id = ? ${f.clause}
            ORDER BY tu.created_at DESC LIMIT ?
        `, [tenant, ...f.params, limit]);
    });

    // 5b. oyon_emotion_records → camera-based facial emotion samples.
    queries.push(async () => {
        if (!await tableExists('oyon_emotion_records')) return [];
        const f = dateFilter('oer.window_start');
        return allP(`
            SELECT oer.window_start AS ts,
                   oer.user_id, oer.student_name_snapshot AS username,
                   oer.case_id, oer.case_title_snapshot AS case_name,
                   oer.session_id,
                   'oyon' AS source,
                   'face' AS role,
                   COALESCE(oer.dominant_emotion, 'unknown') AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   NULL AS latency_ms,
                   'face-cam' AS model,
                   oer.dominant_emotion AS extra
            FROM oyon_emotion_records oer
            WHERE oer.tenant_id = ? ${f.clause}
                  ${sessionId ? 'AND oer.session_id = ?' : ''}
            ORDER BY oer.window_start DESC LIMIT ?
        `, [String(tenant), ...f.params, ...(sessionId ? [String(sessionId)] : []), limit]);
    });

    // 5. emotion_logs → student emotion samples (self-report).
    queries.push(async () => {
        if (!await tableExists('emotion_logs')) return [];
        const f = dateFilter('el.created_at');
        return allP(`
            SELECT el.created_at AS ts,
                   s.user_id, u.username,
                   s.case_id, c.name AS case_name,
                   el.session_id,
                   'emotion' AS source,
                   'student' AS role,
                   el.emotion AS content,
                   NULL AS tokens_in, NULL AS tokens_out,
                   NULL AS latency_ms, NULL AS model,
                   NULL AS extra
            FROM emotion_logs el
            LEFT JOIN sessions s ON el.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN cases c ON s.case_id = c.id
            WHERE el.tenant_id = ? ${f.clause} ${sessionWhere('el.session_id')}
            ORDER BY el.created_at DESC LIMIT ?
        `, [tenant, ...f.params, ...sessionParam(), limit]);
    });

    Promise.all(queries.map(q => q())).then((results) => {
        const flat = results.flat();
        const events = flat
            .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
            .slice(0, limit);
        const sources = {};
        for (const r of flat) sources[r.source] = (sources[r.source] || 0) + 1;
        res.json({ events, sources });
    }).catch((e) => res.status(500).json({ error: e.message }));
});

// --- SYSTEM LOG per-source CSV export (admin only) ---
//
// One source → one CSV download, streamed page-by-page from SQLite so a
// 2M-row table doesn't blow the server. Not built client-side — the user
// clicks a chip's download button and the browser saves the file as it
// arrives. Optional ?from / ?to for date filtering.
//
// Each entry below pins (table, dateColumn, columns to export, tenant
// scoping). The :source param is matched against this map; anything not
// listed returns 404.
const EXPORT_SOURCES = {
    auth: {
        table: 'login_logs',
        dateCol: 'timestamp',
        tenant: true,
    },
    admin: {
        table: 'system_audit_log',
        dateCol: 'timestamp',
        tenant: false, // system_audit_log isn't tenant-scoped today
    },
    config: {
        table: 'settings_logs',
        dateCol: 'timestamp',
        tenant: true,
    },
    learning: {
        table: 'learning_events',
        dateCol: 'timestamp',
        tenant: true,
    },
    chat: {
        table: 'interactions',
        dateCol: 'timestamp',
        tenant: true,
    },
    alarm: {
        table: 'alarm_events',
        dateCol: 'triggered_at',
        tenant: true,
    },
    llm: {
        table: 'llm_request_log',
        dateCol: 'request_timestamp',
        tenant: true,
    },
    tts: {
        table: 'tts_usage',
        dateCol: 'created_at',
        tenant: true,
    },
    emotion: {
        table: 'emotion_logs',
        dateCol: 'created_at',
        tenant: true,
    },
    oyon: {
        table: 'oyon_emotion_records',
        dateCol: 'window_start',
        tenant: true,
    },
    vitals: {
        table: 'session_vitals',
        dateCol: 'recorded_at',
        tenant: false,
    },
    scenario: {
        table: 'scenario_events',
        dateCol: 'created_at',
        tenant: false,
    },
    client: {
        table: 'client_logs',
        dateCol: 'created_at',
        tenant: true,
    },
};

function csvCellEscape(value) {
    if (value === null || value === undefined) return '';
    let s = typeof value === 'string' ? value : String(value);
    // Spreadsheet-injection guard.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

router.get('/export/system-log/:source', authenticateToken, requireAdmin, async (req, res) => {
    const source = String(req.params.source || '').toLowerCase();
    const cfg = EXPORT_SOURCES[source];
    if (!cfg) return res.status(404).json({ error: `Unknown source: ${source}` });

    // Verify the table actually exists on this database. Older schemas may
    // not have every optional table.
    const exists = await new Promise((resolve) => {
        dbAdapter.get(
            `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
            [cfg.table], (err, row) => resolve(err ? false : !!row)
        );
    });
    if (!exists) return res.status(404).json({ error: `Table not in this DB: ${cfg.table}` });

    // Discover columns dynamically — schema varies across migrations.
    const cols = await new Promise((resolve, reject) => {
        dbAdapter.all(`PRAGMA table_info("${cfg.table}")`, [], (err, rows) => {
            err ? reject(err) : resolve((rows || []).map(r => r.name));
        });
    });

    // Build the WHERE clause.
    const where = [];
    const params = [];
    if (cfg.tenant && cols.includes('tenant_id')) {
        where.push('tenant_id = ?');
        params.push(tenantId(req));
    }
    if (req.query.from) {
        where.push(`"${cfg.dateCol}" >= ?`);
        params.push(req.query.from);
    }
    if (req.query.to) {
        where.push(`"${cfg.dateCol}" < date(?, '+1 day')`);
        params.push(req.query.to);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Stream-friendly headers.
    const filename = `${source}_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.write(cols.join(',') + '\n');

    // Page through SQLite so we never hold the whole result set in memory.
    // 5,000 rows per page is a reasonable trade-off between query overhead
    // and memory peak (~1 MB per page at typical row sizes).
    const PAGE = 5000;
    let offset = 0;
    let total = 0;

    try {
        while (true) {
            const sql = `SELECT * FROM "${cfg.table}" ${whereClause} ORDER BY "${cfg.dateCol}" ASC LIMIT ? OFFSET ?`;
            const rows = await new Promise((resolve, reject) => {
                dbAdapter.all(sql, [...params, PAGE, offset], (err, r) => err ? reject(err) : resolve(r || []));
            });
            if (rows.length === 0) break;
            for (const r of rows) {
                res.write(cols.map(c => csvCellEscape(r[c])).join(',') + '\n');
            }
            total += rows.length;
            if (rows.length < PAGE) break;
            offset += PAGE;
            // Yield to the event loop between pages so the server stays
            // responsive to other requests during a multi-million-row export.
            await new Promise(r => setImmediate(r));
        }
        res.end();
        logger('analytics-routes').info('system-log export complete', {
            source, table: cfg.table, rows: total,
        });
    } catch (err) {
        // Headers already sent; we can't switch to a JSON error. Log and
        // close cleanly so the partial CSV is what the client gets.
        logger('analytics-routes').warn('system-log export errored mid-stream', {
            source, error: err.message, written: total,
        });
        res.end();
    }
});

// --- SYSTEM LOG (firehose, admin only) ---
//
// Every timestamped event in the database, unioned and sorted. Coughs and
// birds included. Rows are normalised to one shape:
//   { ts, user_id, username, component, event, description,
//     origin, ip, ref_type, ref_id, status }
router.get('/system-log/feed', authenticateToken, requireAdmin, (req, res) => {
    const tenant = tenantId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 10000);
    // Per-source cap defaults to the total cap so we never artificially
    // drop a recent row from one source to make room for an older row
    // from another. Override with ?per_source=N if you want the old
    // "fair representation across sources" behaviour.
    const perSource = Math.min(parseInt(req.query.per_source, 10) || limit, limit);
    const dateFrom = req.query.from || null;
    const dateTo = req.query.to || null;

    const dateFilter = (col) => {
        const parts = [];
        const params = [];
        if (dateFrom) { parts.push(`${col} >= ?`); params.push(dateFrom); }
        if (dateTo)   { parts.push(`${col} < date(?, '+1 day')`); params.push(dateTo); }
        return { clause: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
    };

    // Helper: probes sqlite_master so the feed degrades gracefully when a
    // table doesn't exist on this tenant's schema (older DB, etc.).
    const tableExists = (name) => new Promise((resolve) => {
        dbAdapter.get(
            `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
            [name], (err, row) => resolve(err ? false : !!row)
        );
    });

    const allP = (sql, params) => new Promise((resolve) => {
        dbAdapter.all(sql, params, (err, rows) => resolve(err ? [] : (rows || [])));
    });

    // ---- Every source. Each emits the canonical row shape. -----------
    // Per-source LIMIT is enforced at the SQL level so a giant table can't
    // starve sibling sources; the merged feed is sorted client-side and
    // capped at `limit`.

    const queries = [];

    // 1. system_audit_log → 'admin'
    queries.push(async () => {
        const f = dateFilter('sal.timestamp');
        return allP(`
            SELECT sal.timestamp AS ts, sal.user_id, sal.username,
                   'admin' AS component, sal.action AS event,
                   COALESCE(sal.resource_name,
                       CASE WHEN sal.resource_type IS NOT NULL
                            THEN sal.resource_type || ' #' || sal.resource_id
                            ELSE sal.action END) AS description,
                   'web' AS origin, sal.ip_address AS ip,
                   sal.resource_type AS ref_type, sal.resource_id AS ref_id,
                   sal.status AS status
            FROM system_audit_log sal
            WHERE 1=1 ${f.clause}
            ORDER BY sal.timestamp DESC LIMIT ?
        `, [...f.params, perSource]);
    });

    // 2. ALL learning_events → 'learning' (verb tells you what)
    queries.push(async () => {
        const f = dateFilter('le.timestamp');
        return allP(`
            SELECT le.timestamp AS ts, le.user_id, u.username,
                   'learning' AS component, le.verb AS event,
                   COALESCE(le.object_name,
                            le.message_content,
                            le.result,
                            le.verb) AS description,
                   'web' AS origin,
                   json_extract(le.context, '$.ip') AS ip,
                   le.object_type AS ref_type,
                   le.object_id AS ref_id,
                   le.severity AS status
            FROM learning_events le
            LEFT JOIN users u ON le.user_id = u.id
            WHERE le.tenant_id = ? ${f.clause}
            ORDER BY le.timestamp DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 3. ALL client_logs → 'client' (every level, not just error/warn)
    queries.push(async () => {
        const f = dateFilter('cl.created_at');
        return allP(`
            SELECT cl.created_at AS ts, cl.user_id, u.username,
                   'client' AS component, cl.level AS event,
                   cl.message AS description,
                   'web' AS origin, NULL AS ip,
                   cl.context AS ref_type, NULL AS ref_id,
                   cl.level AS status
            FROM client_logs cl
            LEFT JOIN users u ON cl.user_id = u.id
            WHERE cl.tenant_id = ? ${f.clause}
            ORDER BY cl.created_at DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 4. login_logs → 'auth' (raw, before the dual-write into learning_events)
    queries.push(async () => {
        const f = dateFilter('ll.timestamp');
        return allP(`
            SELECT ll.timestamp AS ts, ll.user_id, ll.username,
                   'auth' AS component, ll.action AS event,
                   ll.username || ' ' || ll.action AS description,
                   'web' AS origin, ll.ip_address AS ip,
                   NULL AS ref_type, NULL AS ref_id,
                   CASE WHEN ll.action = 'failed_login' THEN 'failure' ELSE 'success' END AS status
            FROM login_logs ll
            WHERE ll.tenant_id = ? ${f.clause}
            ORDER BY ll.timestamp DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 5. settings_logs → 'config' (raw)
    queries.push(async () => {
        const f = dateFilter('sl.timestamp');
        return allP(`
            SELECT sl.timestamp AS ts, sl.user_id, u.username,
                   'config' AS component, sl.setting_type AS event,
                   COALESCE(sl.setting_name, sl.setting_type) ||
                   COALESCE(': ' || sl.old_value || ' → ' || sl.new_value, '') AS description,
                   'web' AS origin, NULL AS ip,
                   sl.setting_type AS ref_type, sl.case_id AS ref_id,
                   'success' AS status
            FROM settings_logs sl
            LEFT JOIN users u ON sl.user_id = u.id
            WHERE sl.tenant_id = ? ${f.clause}
            ORDER BY sl.timestamp DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 6. interactions (raw chat rows) → 'chat'
    queries.push(async () => {
        if (!await tableExists('interactions')) return [];
        const f = dateFilter('i.timestamp');
        return allP(`
            SELECT i.timestamp AS ts, s.user_id, u.username,
                   'chat' AS component, i.role AS event,
                   substr(i.content, 1, 200) AS description,
                   'web' AS origin, NULL AS ip,
                   'session' AS ref_type, CAST(i.session_id AS TEXT) AS ref_id,
                   'success' AS status
            FROM interactions i
            LEFT JOIN sessions s ON i.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE i.tenant_id = ? ${f.clause}
            ORDER BY i.timestamp DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 7. alarm_events → 'alarm'
    queries.push(async () => {
        if (!await tableExists('alarm_events')) return [];
        const f = dateFilter('ae.triggered_at');
        return allP(`
            SELECT ae.triggered_at AS ts, s.user_id, u.username,
                   'alarm' AS component,
                   ae.vital_sign || ' ' || ae.threshold_type AS event,
                   ae.vital_sign || ' ' || ae.threshold_type ||
                   COALESCE(' = ' || ae.actual_value, '') AS description,
                   'web' AS origin, NULL AS ip,
                   'session' AS ref_type, CAST(ae.session_id AS TEXT) AS ref_id,
                   CASE WHEN ae.acknowledged_at IS NOT NULL THEN 'acked' ELSE 'active' END AS status
            FROM alarm_events ae
            LEFT JOIN sessions s ON ae.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE ae.tenant_id = ? ${f.clause}
            ORDER BY ae.triggered_at DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 8. llm_request_log → 'llm'
    queries.push(async () => {
        if (!await tableExists('llm_request_log')) return [];
        const f = dateFilter('lrl.request_timestamp');
        return allP(`
            SELECT lrl.request_timestamp AS ts, lrl.user_id, u.username,
                   'llm' AS component, lrl.model AS event,
                   lrl.model || ' ' || COALESCE(lrl.status, '') AS description,
                   'api' AS origin, NULL AS ip,
                   'model' AS ref_type, lrl.model AS ref_id,
                   lrl.status AS status
            FROM llm_request_log lrl
            LEFT JOIN users u ON lrl.user_id = u.id
            WHERE lrl.tenant_id = ? ${f.clause}
            ORDER BY lrl.request_timestamp DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 9. tts_usage → 'tts'
    queries.push(async () => {
        if (!await tableExists('tts_usage')) return [];
        const f = dateFilter('tu.created_at');
        return allP(`
            SELECT tu.created_at AS ts, tu.user_id, u.username,
                   'tts' AS component, tu.provider AS event,
                   tu.provider || COALESCE(' / ' || tu.voice, '') AS description,
                   'api' AS origin, NULL AS ip,
                   'voice' AS ref_type, tu.voice AS ref_id,
                   'success' AS status
            FROM tts_usage tu
            LEFT JOIN users u ON tu.user_id = u.id
            WHERE tu.tenant_id = ? ${f.clause}
            ORDER BY tu.created_at DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 10. emotion_logs → 'emotion'
    queries.push(async () => {
        if (!await tableExists('emotion_logs')) return [];
        const f = dateFilter('el.created_at');
        return allP(`
            SELECT el.created_at AS ts, s.user_id, u.username,
                   'emotion' AS component, el.emotion AS event,
                   el.emotion AS description,
                   'web' AS origin, NULL AS ip,
                   'session' AS ref_type, CAST(el.session_id AS TEXT) AS ref_id,
                   'info' AS status
            FROM emotion_logs el
            LEFT JOIN sessions s ON el.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE el.tenant_id = ? ${f.clause}
            ORDER BY el.created_at DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 11. oyon_emotion_records → 'oyon'
    queries.push(async () => {
        if (!await tableExists('oyon_emotion_records')) return [];
        const f = dateFilter('oer.window_start');
        return allP(`
            SELECT oer.window_start AS ts, oer.user_id, u.username,
                   'oyon' AS component,
                   COALESCE(oer.dominant, 'sample') AS event,
                   COALESCE(oer.dominant, 'unknown') ||
                   COALESCE(' (' || ROUND(oer.confidence, 2) || ')', '') AS description,
                   'web' AS origin, NULL AS ip,
                   'session' AS ref_type, CAST(oer.session_id AS TEXT) AS ref_id,
                   'info' AS status
            FROM oyon_emotion_records oer
            LEFT JOIN users u ON oer.user_id = u.id
            WHERE oer.tenant_id = ? ${f.clause}
            ORDER BY oer.window_start DESC LIMIT ?
        `, [tenant, ...f.params, perSource]);
    });

    // 12. session_vitals → 'vitals' (every monitor sample)
    queries.push(async () => {
        if (!await tableExists('session_vitals')) return [];
        const f = dateFilter('sv.recorded_at');
        return allP(`
            SELECT sv.recorded_at AS ts, s.user_id, u.username,
                   'vitals' AS component, 'sample' AS event,
                   'HR ' || COALESCE(CAST(sv.hr AS TEXT), '?') ||
                   ' SpO2 ' || COALESCE(CAST(sv.spo2 AS TEXT), '?') AS description,
                   'web' AS origin, NULL AS ip,
                   'session' AS ref_type, CAST(sv.session_id AS TEXT) AS ref_id,
                   'info' AS status
            FROM session_vitals sv
            LEFT JOIN sessions s ON sv.session_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE 1=1 ${f.clause}
            ORDER BY sv.recorded_at DESC LIMIT ?
        `, [...f.params, perSource]);
    });

    // 13. scenario_events → 'scenario'
    queries.push(async () => {
        if (!await tableExists('scenario_events')) return [];
        const f = dateFilter('se.created_at');
        return allP(`
            SELECT se.created_at AS ts, NULL AS user_id, NULL AS username,
                   'scenario' AS component,
                   COALESCE(se.event_type, 'event') AS event,
                   COALESCE(se.description, se.event_type) AS description,
                   'engine' AS origin, NULL AS ip,
                   'scenario' AS ref_type, CAST(se.scenario_id AS TEXT) AS ref_id,
                   'info' AS status
            FROM scenario_events se
            WHERE 1=1 ${f.clause}
            ORDER BY se.created_at DESC LIMIT ?
        `, [...f.params, perSource]);
    });

    Promise.all(queries.map(q => q())).then((results) => {
        const flat = results.flat();
        const events = flat
            .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
            .slice(0, limit);
        // Per-source counts so you can see what fired and what was empty.
        const sources = {};
        for (const r of flat) {
            sources[r.component] = (sources[r.component] || 0) + 1;
        }
        res.json({ events, sources });
    }).catch((e) => res.status(500).json({ error: e.message }));
});

// --- SYSTEM LOG (raw DB reflection, admin only) ---
//
// Goal: an obsessive raw view of every table in the database. No curation,
// no joins — just one table at a time. The endpoint validates the
// requested table name against sqlite_master so callers can't smuggle
// arbitrary SQL through ":name". Tenant scoping is applied when the
// target table has a tenant_id column.

// GET /api/system-log/tables — list every table with its row count.
router.get('/system-log/tables', authenticateToken, requireAdmin, (req, res) => {
    dbAdapter.all(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
        [],
        async (err, tables) => {
            if (err) return res.status(500).json({ error: err.message });
            try {
                const out = await Promise.all(tables.map(t => new Promise((resolve) => {
                    dbAdapter.get(
                        `SELECT COUNT(*) AS n FROM "${t.name}"`,
                        [],
                        (e2, row) => resolve({ name: t.name, count: e2 ? null : (row?.n ?? 0) })
                    );
                })));
                res.json({ tables: out });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        }
    );
});

// GET /api/system-log/table/:name — return rows from a single table.
// Validated against sqlite_master before any SQL is built.
router.get('/system-log/table/:name', authenticateToken, requireAdmin, (req, res) => {
    const { name } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
    const offset = parseInt(req.query.offset, 10) || 0;

    dbAdapter.get(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [name],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: `Unknown table: ${name}` });

            // Discover columns + tenant_id presence.
            dbAdapter.all(`PRAGMA table_info("${name}")`, [], (err2, cols) => {
                if (err2) return res.status(500).json({ error: err2.message });
                const colNames = cols.map(c => c.name);
                const hasTenant = colNames.includes('tenant_id');
                const orderCol = colNames.includes('id') ? 'id' :
                                 colNames.includes('timestamp') ? 'timestamp' :
                                 colNames.includes('created_at') ? 'created_at' : null;

                const where = hasTenant ? `WHERE tenant_id = ?` : '';
                const orderClause = orderCol ? `ORDER BY "${orderCol}" DESC` : '';
                const sql = `SELECT * FROM "${name}" ${where} ${orderClause} LIMIT ? OFFSET ?`;
                const params = hasTenant
                    ? [tenantId(req), limit, offset]
                    : [limit, offset];

                dbAdapter.all(sql, params, (err3, rows) => {
                    if (err3) return res.status(500).json({ error: err3.message });
                    res.json({
                        table: name,
                        columns: colNames,
                        rows,
                        limit,
                        offset,
                        total_returned: rows.length,
                    });
                });
            });
        }
    );
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

function isDateOnly(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildLearningEventWhere(req, { alias = '', includeUser = true } = {}) {
    const { case_id, user_id, start_date, end_date } = req.query || {};
    const prefix = alias && alias.endsWith('.') ? alias : alias ? `${alias}.` : '';
    const column = (name) => `${prefix}${name}`;
    const clauses = [`${column('tenant_id')} = ?`];
    const params = [tenantId(req)];

    if (case_id) {
        clauses.push(`${column('case_id')} = ?`);
        params.push(case_id);
    }
    if (includeUser && user_id) {
        clauses.push(`${column('user_id')} = ?`);
        params.push(user_id);
    }
    if (start_date) {
        clauses.push(`${column('timestamp')} >= ?`);
        params.push(start_date);
    }
    if (end_date) {
        if (isDateOnly(end_date)) {
            clauses.push(`${column('timestamp')} < date(?, '+1 day')`);
        } else {
            clauses.push(`${column('timestamp')} <= ?`);
        }
        params.push(end_date);
    }

    return {
        where: `WHERE ${clauses.join(' AND ')}`,
        params,
    };
}

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
        min_sequence_length = '2',
        min_verb_pct = '0.05',
        skip_merges,
        group_by = 'actor-session',
    } = req.query;
    const minLen = Math.max(2, parseInt(min_sequence_length, 10) || 2);
    const minVerbPct = Math.max(0, parseFloat(min_verb_pct) || 0);
    const skipMerges = String(skip_merges) === 'true';
    const grouping = group_by === 'actor' ? 'actor' : 'actor-session';
    const filters = buildLearningEventWhere(req, { alias: 'le.' });

    let sql = `
        SELECT le.user_id, le.session_id, le.verb, le.object_type, le.timestamp,
               c.name AS case_title
          FROM learning_events le
          LEFT JOIN cases c ON c.id = le.case_id AND c.tenant_id = le.tenant_id
          ${filters.where}
         ORDER BY le.user_id ASC, le.session_id ASC, le.timestamp ASC, le.id ASC
         LIMIT 50000`;

    dbAdapter.all(sql, filters.params, (err, rows) => {
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
    const filters = buildLearningEventWhere(req);
    let sql = `SELECT date(timestamp) AS day, COUNT(*) AS n
                 FROM learning_events ${filters.where}`;
    const params = filters.params;
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
    const filters = buildLearningEventWhere(req);
    let sql = `SELECT CAST(strftime('%w', timestamp) AS INTEGER) AS dow,
                      CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
                      COUNT(*) AS n
                 FROM learning_events ${filters.where}`;
    const params = filters.params;
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
    const filters = buildLearningEventWhere(req);
    let sql = `SELECT date(timestamp) AS day, verb, COUNT(*) AS n
                 FROM learning_events ${filters.where}`;
    const params = filters.params;
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
    const { where, params } = buildLearningEventWhere(req);

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
    const { where, params } = buildLearningEventWhere(req);

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
    const { limit = '10' } = req.query;
    const filters = buildLearningEventWhere(req);
    let sql = `SELECT object_type, object_name, COUNT(*) AS n
                 FROM learning_events
                ${filters.where}
                  AND object_name IS NOT NULL AND object_name != ''`;
    const params = filters.params;
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
        `SELECT id, name AS title FROM cases WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name`,
        [tenantId(req)],
        (err1, cases) => {
            if (err1) return res.status(500).json({ error: err1.message });
            dbAdapter.all(
                `SELECT DISTINCT u.id, u.username, u.name AS fullname, u.email
                   FROM users u
                   JOIN learning_events le ON le.user_id = u.id AND le.tenant_id = ?
                  WHERE u.tenant_id = ?
                  ORDER BY u.username`,
                [tenantId(req), tenantId(req)],
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
