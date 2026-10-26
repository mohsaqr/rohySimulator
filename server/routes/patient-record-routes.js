import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
} from '../middleware/auth.js';




import { logger } from '../logger.js';
import {
    tenantId,
    verifySessionOwnership
} from './_helpers.js';
import { loadOwnSessionForWrite } from '../lib/sessionWriteGuard.js';

const radiologyLog = logger('radiology');
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

router.post('/patient-record/sync', authenticateToken, async (req, res) => {
    try {
        const { session_id, record_id, events, document, patient_info, current_state, events_count } = req.body;

        if (!session_id || !record_id) {
            return res.status(400).json({ error: 'session_id and record_id are required' });
        }

        // Owner only, and closed once the session ended (+ a short grace for
        // the last periodic sync): see lib/sessionWriteGuard.js (audit
        // 2026-10-26, L8-12 / L2-13).
        if (!await loadOwnSessionForWrite(req, res, session_id, tenantId(req))) return;
        const tenant = tenantId(req);

        // Insert new events
        if (events && events.length > 0) {
            const insertEvent = dbAdapter.prepare(`
                INSERT OR IGNORE INTO patient_record_events
                (session_id, record_id, event_id, verb, time_elapsed, category, region, source, item, content, finding, value, unit, abnormal, details, tenant_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const event of events) {
                insertEvent.run([
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
                    JSON.stringify(event),
                    // tenant_id: persona and agent-situation readers filter
                    // on it, so a row filed under the column default (1) was
                    // invisible to every other tenant's session (F-18).
                    tenant
                ]);
            }
            insertEvent.finalize();
        }

        // Upsert document
        await new Promise((resolve, reject) => {
            dbAdapter.run(`
                INSERT INTO patient_record_documents (session_id, record_id, patient_info, current_state, events_count, document, tenant_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                JSON.stringify(document),
                tenant
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

        // The record is the evidence the debrief and analytics read: only its
        // owner may clear it, and not once the session has ended (L8-12).
        if (!await loadOwnSessionForWrite(req, res, sessionId, tenantId(req))) return;

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
