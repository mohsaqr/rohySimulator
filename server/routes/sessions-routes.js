import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    ROLE_RANKS,
    hasRoleAtLeast,
} from '../middleware/auth.js';




import { logger } from '../logger.js';
import {
    canReadAcrossUsers,
    redactRow,
    tenantId,
    verifySessionOwnership
} from './_helpers.js';

const radiologyLog = logger('radiology');
const routesCasesLog = logger('routes-cases-sessions');
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

router.post('/sessions', authenticateToken, async (req, res) => {
    const { case_id, student_name, llm_settings, monitor_settings } = req.body;
    const user_id = req.user.id;

    // If no llm_settings provided, check user preferences for default settings
    let effectiveLlmSettings = llm_settings || {};
    if (!llm_settings || Object.keys(llm_settings).length === 0) {
        try {
            const userPrefs = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT default_llm_settings FROM user_preferences WHERE user_id = ? AND tenant_id = ?', [user_id, tenantId(req)], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (userPrefs?.default_llm_settings) {
                try {
                    effectiveLlmSettings = JSON.parse(userPrefs.default_llm_settings);
                    (req.log || routesCasesLog).info('using user default llm settings', { user_id });
                } catch {
                    (req.log || routesCasesLog).warn('user default llm settings parse failed');
                }
            }
        } catch (err) {
            (req.log || routesCasesLog).warn('user preferences fetch failed', { error: err.message });
        }
    }

    // Build the case snapshot from the live cases row at session-start time.
    // Once written, runtime readers (labs / treatments / vitals / scenario)
    // pull from this snapshot rather than the live cases row, so admin edits
    // mid-session don't bleed into the running session.
    const caseRow = await new Promise((resolve, reject) => {
        dbAdapter.get('SELECT id, name, system_prompt, config, scenario FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [case_id, tenantId(req)], (err, row) => {
            if (err) reject(err); else resolve(row || null);
        });
    });
    let caseSnapshot = null;
    if (caseRow) {
        let parsedConfig = {};
        let parsedScenario = null;
        try { parsedConfig = caseRow.config ? JSON.parse(caseRow.config) : {}; } catch (e) {
            (req.log || routesCasesLog).warn('session start case config json parse failed', { error: e.message });
        }
        try { parsedScenario = caseRow.scenario ? JSON.parse(caseRow.scenario) : null; } catch (e) {
            (req.log || routesCasesLog).warn('session start case scenario json parse failed', { error: e.message });
        }
        // Stage-4 audit: include `system_prompt` in the snapshot. Pre-fix
        // the chat persona was rebuilt every render from the live
        // activeCase.system_prompt, so an admin renaming or re-prompting a
        // case mid-session shifted the patient's voice for the in-progress
        // chat. With it captured here, ChatInterface can rebuild from the
        // snapshot and stay stable for the session's lifetime.
        caseSnapshot = JSON.stringify({
            case_id: caseRow.id,
            name: caseRow.name,
            system_prompt: caseRow.system_prompt || null,
            config: parsedConfig,
            scenario: parsedScenario,
            snapshot_at: new Date().toISOString()
        });
    }

    if (!caseRow) {
        return res.status(404).json({ error: 'Case not found' });
    }

    // Dedup: React StrictMode (dev) double-fires effects, and parent
    // re-renders with a new activeCase reference cause the start-session
    // effect to re-run. Without this guard you get 2-3 sessions per real
    // start, all clustered at the same second. Return any active session
    // for the same (user, case) started in the last 30 seconds.
    const recent = await new Promise((resolve) => {
        dbAdapter.get(
            `SELECT id FROM sessions
             WHERE user_id = ? AND case_id = ? AND tenant_id = ?
               AND end_time IS NULL
               AND start_time > datetime('now', '-30 seconds')
             ORDER BY id DESC LIMIT 1`,
            [user_id, case_id, tenantId(req)],
            (err, row) => resolve(err ? null : row)
        );
    });
    if (recent) {
        (req.log || routesCasesLog).info('reusing recent active session', { id: recent.id, user_id, case_id });
        return res.json({ id: recent.id, message: 'Reused recent active session' });
    }

    const sql = `INSERT INTO sessions (case_id, user_id, student_name, llm_settings, monitor_settings, case_snapshot, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    dbAdapter.run(sql, [
        case_id,
        user_id,
        student_name || req.user.username,
        JSON.stringify(effectiveLlmSettings),
        JSON.stringify(monitor_settings || {}),
        caseSnapshot,
        tenantId(req)
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        const sessionId = this.lastID;

        // Create session settings snapshot
        const settingsSnapshotSql = `
            INSERT INTO session_settings (
                session_id, case_id, user_id, 
                llm_provider, llm_model, llm_base_url,
                monitor_hr, monitor_rhythm, monitor_spo2,
                monitor_bp_sys, monitor_bp_dia, monitor_rr, monitor_temp,
                settings_snapshot, tenant_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        dbAdapter.run(settingsSnapshotSql, [
            sessionId, case_id, user_id,
            effectiveLlmSettings?.provider, effectiveLlmSettings?.model, effectiveLlmSettings?.baseUrl,
            monitor_settings?.hr, monitor_settings?.rhythm, monitor_settings?.spo2,
            monitor_settings?.bp_sys, monitor_settings?.bp_dia, monitor_settings?.rr, monitor_settings?.temp,
            JSON.stringify({ llm: effectiveLlmSettings, monitor: monitor_settings }),
            tenantId(req)
        ]);

        // Log case load event
        dbAdapter.run(
            `INSERT INTO settings_logs (user_id, session_id, case_id, setting_type, settings_json, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [user_id, sessionId, case_id, 'case_load', JSON.stringify({ case_id, timestamp: new Date().toISOString() }), tenantId(req)]
        );

        res.json({ 
            id: sessionId, 
            case_id, 
            user_id, 
            student_name: student_name || req.user.username 
            ,
            tenant_id: tenantId(req)
        });
    });
});

// GET /api/sessions/:id - Get session details for validation
router.get('/sessions/:id', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user.id;

    const sql = `
        SELECT s.*, c.name as case_name
        FROM sessions s
        LEFT JOIN cases c ON s.case_id = c.id
        WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL
    `;

    dbAdapter.get(sql, [sessionId, tenantId(req)], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Check ownership (users can only access their own sessions, admins can access all)
        if (session.user_id !== userId && !canReadAcrossUsers(req.user)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ session: redactRow(session) });
    });
});

// PUT /api/sessions/:id/end - Mark session as ended
// Idempotent: a re-call on an already-ended session returns the original
// end_time/duration instead of overwriting them. Without this guard a
// second /end (eg. learner reload + re-end) silently resets the duration
// to ~0s and corrupts analytics.
router.put('/sessions/:id/end', authenticateToken, (req, res) => {
    const sessionId = req.params.id;

    dbAdapter.get('SELECT start_time, end_time, duration, user_id FROM sessions WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [sessionId, tenantId(req)], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (session.end_time) {
            return res.json({
                message: 'Session already ended',
                duration: session.duration,
                end_time: session.end_time,
                already_ended: true
            });
        }

        const endTime = new Date();
        const startTime = new Date(session.start_time);
        const duration = Math.floor((endTime - startTime) / 1000);

        // Also flip status to 'completed' so queries filtering on the
        // CHECK-constrained status field actually return ended sessions
        // (the column existed but was never transitioned).
        const sql = `UPDATE sessions SET end_time = ?, duration = ?, status = 'completed' WHERE id = ? AND tenant_id = ? AND end_time IS NULL`;
        dbAdapter.run(sql, [endTime.toISOString(), duration, sessionId, tenantId(req)], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Session ended', duration, end_time: endTime.toISOString() });
        });
    });
});

// --- SESSION VITALS (trend persistence) ---
//
// Vitals are streamed to the client by the monitor's scenario engine and
// adjusted by the learner; without persistence, a tab refresh wipes the
// trend and the chart restarts from baseline. We log on meaningful change
// (scenario beat, learner edit, alarm trigger) — not as a raw 250 Hz feed —
// so a session generates tens of rows per minute, not thousands.

// POST /api/sessions/:id/vitals - record a vital change
router.post('/sessions/:id/vitals', authenticateToken, async (req, res) => {
    const sessionId = req.params.id;
    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    const { elapsed_ms, hr, rhythm, spo2, bp_sys, bp_dia, rr, temp, etco2, source } = req.body || {};
    const sql = `INSERT INTO session_vitals
        (session_id, elapsed_ms, hr, rhythm, spo2, bp_sys, bp_dia, rr, temp, etco2, source, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    dbAdapter.run(sql, [
        sessionId,
        Number.isFinite(elapsed_ms) ? elapsed_ms : null,
        Number.isFinite(hr) ? hr : null,
        rhythm || null,
        Number.isFinite(spo2) ? spo2 : null,
        Number.isFinite(bp_sys) ? bp_sys : null,
        Number.isFinite(bp_dia) ? bp_dia : null,
        Number.isFinite(rr) ? rr : null,
        Number.isFinite(temp) ? temp : null,
        Number.isFinite(etco2) ? etco2 : null,
        source || 'unknown',
        tenantId(req)
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// GET /api/sessions/:id/vitals - return the trend in chronological order
router.get('/sessions/:id/vitals', authenticateToken, async (req, res) => {
    const sessionId = req.params.id;
    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    dbAdapter.all(
        `SELECT id, timestamp, elapsed_ms, hr, rhythm, spo2, bp_sys, bp_dia, rr, temp, etco2, source
           FROM session_vitals WHERE session_id = ? AND tenant_id = ? ORDER BY id ASC`,
        [sessionId, tenantId(req)],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ vitals: rows || [] });
        }
    );
});

// --- INTERACTIONS ---

// POST /api/interactions - Authenticated users only

router.post('/sessions/:sessionId/vitals', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    const { vital_sign, value, unit, is_alarm_triggered, alarm_type, source } = req.body;

    if (!vital_sign || value === undefined) {
        return res.status(400).json({ error: 'vital_sign and value are required' });
    }

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    dbAdapter.run(
        `INSERT INTO vital_sign_history (session_id, vital_sign, value, unit, is_alarm_triggered, alarm_type, source, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, vital_sign, value, unit || null, is_alarm_triggered ? 1 : 0, alarm_type || null, source || 'system', tenantId(req)],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Vital sign recorded' });
        }
    );
});

// GET /api/sessions/:sessionId/vitals - Get vital sign history for a session
router.get('/sessions/:sessionId/vitals', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    const { vital_sign, limit = 1000 } = req.query;

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    let sql = `SELECT * FROM vital_sign_history WHERE session_id = ? AND tenant_id = ?`;
    const params = [sessionId, tenantId(req)];

    if (vital_sign) {
        sql += ` AND vital_sign = ?`;
        params.push(vital_sign);
    }

    sql += ` ORDER BY recorded_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    dbAdapter.all(sql, params, (err, vitals) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ vitals });
    });
});

// --- CLINICAL NOTES ---

// POST /api/sessions/:sessionId/notes - Add a clinical note

export default router;
