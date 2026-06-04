import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
    canManageOwnedResource,
    canReadAcrossUsers,
    clampInitialVitals,
    createCaseVersion,
    logAudit,
    mergeScenarioSource,
    parseAuditJson,
    redactRow,
    tenantId,
    verifySessionOwnership
} from './_helpers.js';

const radiologyLog = logger('radiology');
const routesCasesLog = logger('routes-cases-sessions');
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

router.get('/cases', authenticateToken, (req, res) => {
    const canReview = canReadAcrossUsers(req.user);

    // Students only see available cases; reviewer+ can inspect all cases.
    const sql = canReview
        ? "SELECT * FROM cases WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC"
        : "SELECT * FROM cases WHERE tenant_id = ? AND deleted_at IS NULL AND is_available = 1 ORDER BY is_default DESC, created_at DESC";

    dbAdapter.all(sql, [tenantId(req)], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse JSON fields
        const cases = rows.map(row => ({
            ...row,
            config: row.config ? JSON.parse(row.config) : {},
            scenario: row.scenario ? JSON.parse(row.scenario) : null,
            is_available: Boolean(row.is_available),
            is_default: Boolean(row.is_default)
        }));

        // Annotate each case with `active_session_count` so the editor
        // can warn admins that mid-session edits will be live to learners
        // (the runtime reads case config fresh from the DB each request).
        // One round-trip with a GROUP BY rather than N+1 queries.
        dbAdapter.all(
            `SELECT case_id, COUNT(*) AS n
             FROM sessions
             WHERE tenant_id = ? AND end_time IS NULL
             GROUP BY case_id`,
            [tenantId(req)],
            (sErr, sessRows) => {
                if (sErr) {
                    (req.log || routesCasesLog).warn('case active session count failed', { error: sErr.message });
                    return res.json({ cases });
                }
                const counts = new Map(sessRows.map(r => [r.case_id, r.n]));
                const annotated = cases.map(c => ({ ...c, active_session_count: counts.get(c.id) || 0 }));
                res.json({ cases: annotated });
            }
        );
    });
});

// GET /api/cases/:id - Authenticated users can read a live case in their tenant
router.get('/cases/:id', authenticateToken, (req, res) => {
    const sql = canReadAcrossUsers(req.user)
        ? `SELECT * FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
        : `SELECT * FROM cases WHERE id = ? AND tenant_id = ? AND is_available = 1 AND deleted_at IS NULL`;
    dbAdapter.get(sql, [req.params.id, tenantId(req)], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Case not found' });
        res.json({
            ...row,
            config: row.config ? JSON.parse(row.config) : {},
            scenario: row.scenario ? JSON.parse(row.scenario) : null,
            is_available: Boolean(row.is_available),
            is_default: Boolean(row.is_default)
        });
    });
});

// PUT /api/cases/:id/availability - Toggle case availability (Admin only)
router.put('/cases/:id/availability', authenticateToken, requireEducator, (req, res) => {
    const { is_available } = req.body;
    dbAdapter.get('SELECT id, name, is_available FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, tenantId(req)], (readErr, oldCase) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        if (!oldCase) return res.status(404).json({ error: 'Case not found' });
        dbAdapter.run(
            "UPDATE cases SET is_available = ? WHERE id = ? AND tenant_id = ?",
            [is_available ? 1 : 0, req.params.id, tenantId(req)],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Case not found' });
                auditSuccess(req, {
                    action: 'update_case_availability',
                    resourceType: 'case',
                    resourceId: req.params.id,
                    resourceName: oldCase.name,
                    oldValue: { is_available: Boolean(oldCase.is_available) },
                    newValue: { is_available: Boolean(is_available) }
                });
                res.json({ success: true, is_available: Boolean(is_available) });
            }
        );
    });
});

// PUT /api/cases/:id/default - Set case as default (Admin only)
router.put('/cases/:id/default', authenticateToken, requireEducator, (req, res) => {
    const { is_default } = req.body;
    dbAdapter.get('SELECT id, name, is_default FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, tenantId(req)], (readErr, oldCase) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        if (!oldCase) return res.status(404).json({ error: 'Case not found' });

    // If setting as default, first clear any existing defaults
    if (is_default) {
        dbAdapter.run("UPDATE cases SET is_default = 0 WHERE tenant_id = ?", [tenantId(req)], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            dbAdapter.run(
                "UPDATE cases SET is_default = 1, is_available = 1 WHERE id = ? AND tenant_id = ?",
                [req.params.id, tenantId(req)],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Case not found' });
                    auditSuccess(req, {
                        action: 'update_case_default',
                        resourceType: 'case',
                        resourceId: req.params.id,
                        resourceName: oldCase.name,
                        oldValue: { is_default: Boolean(oldCase.is_default) },
                        newValue: { is_default: true, is_available: true }
                    });
                    res.json({ success: true, is_default: true });
                }
            );
        });
    } else {
        dbAdapter.run(
            "UPDATE cases SET is_default = 0 WHERE id = ? AND tenant_id = ?",
            [req.params.id, tenantId(req)],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                auditSuccess(req, {
                    action: 'update_case_default',
                    resourceType: 'case',
                    resourceId: req.params.id,
                    resourceName: oldCase.name,
                    oldValue: { is_default: Boolean(oldCase.is_default) },
                    newValue: { is_default: false }
                });
                res.json({ success: true, is_default: false });
            }
        );
    }
    });
});

// POST /api/cases - Admin only
router.post('/cases', authenticateToken, requireEducator, (req, res) => {
    const { name, description, system_prompt, config, scenario,
            scenario_template, scenario_from_repository, scenario_duration } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Extract patient info from config for denormalized storage. The case
    // editor writes the patient name to `config.patient_name` and the chief
    // complaint to `config.structuredHistory.chiefComplaint`; older/top-level
    // shapes (`demographics.name`, `config.chiefComplaint`) are kept as
    // fallbacks. Reading only the legacy paths left these columns null for
    // editor-created cases — which made the debrief fall back to the case
    // description and show the patient name as the chief complaint (bug #2).
    const patientGender = config?.demographics?.gender || null;
    const patientAge = config?.demographics?.age || null;
    const patientName = config?.patient_name || config?.demographics?.name || null;
    const chiefComplaint = config?.structuredHistory?.chiefComplaint || config?.chiefComplaint || null;
    const difficultyLevel = config?.difficulty_level || null;

    // Tuck the scenario provenance ({template_id|repository_id, name, duration})
    // into the scenario JSON so it survives the round-trip. The wizard sends
    // these as top-level fields; without this merge they were silently dropped.
    const scenarioWithSource = mergeScenarioSource(scenario, { scenario_template, scenario_from_repository, scenario_duration });
    const safeConfig = clampInitialVitals(config || {});

    const sql = `INSERT INTO cases (name, description, system_prompt, config, scenario,
                 patient_name, patient_gender, patient_age, chief_complaint, difficulty_level,
                 created_by, last_modified_by, version, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`;
    const params = [
        name,
        description,
        system_prompt,
        JSON.stringify(safeConfig),
        scenarioWithSource ? JSON.stringify(scenarioWithSource) : null,
        patientName,
        patientGender,
        patientAge,
        chiefComplaint,
        difficultyLevel,
        req.user.id,
        req.user.id,
        tenantId(req)
    ];

    dbAdapter.run(sql, params, function (err) {
        if (err) {
            (req.log || routesCasesLog).error('case save failed', { error: err.message });
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'CREATE_CASE',
                resourceType: 'case',
                status: 'failure',
                errorMessage: err.message,
                ipAddress,
                userAgent
            });
            return res.status(500).json({ error: err.message });
        }

        const caseId = this.lastID;

        // Log audit trail
        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'CREATE_CASE',
            resourceType: 'case',
            resourceId: String(caseId),
            resourceName: name,
            newValue: { name, description, config, tenant_id: tenantId(req) },
            tenantId: tenantId(req),
            ipAddress,
            userAgent,
            status: 'success'
        });

        // Create initial version snapshot
        createCaseVersion(caseId, req.user.id, 'created', 'Initial case creation', {
            name, description, system_prompt, config, scenario, tenant_id: tenantId(req)
        });

        res.json({ id: caseId, ...req.body });
    });
});

// PUT /api/cases/:id - Admin only
router.put('/cases/:id', authenticateToken, requireEducator, (req, res) => {
    const { name, description, system_prompt, config, scenario,
            scenario_template, scenario_from_repository, scenario_duration } = req.body;
    const caseId = req.params.id;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Extract patient info from config for denormalized storage. Mirror the
    // POST handler: prefer the editor's `config.patient_name` /
    // `config.structuredHistory.chiefComplaint`, fall back to legacy paths.
    const patientGender = config?.demographics?.gender || null;
    const patientAge = config?.demographics?.age || null;
    const patientName = config?.patient_name || config?.demographics?.name || null;
    const chiefComplaint = config?.structuredHistory?.chiefComplaint || config?.chiefComplaint || null;
    const difficultyLevel = config?.difficulty_level || null;

    // Same scenario-source merge as the POST handler — see comment there.
    const scenarioWithSource = mergeScenarioSource(scenario, { scenario_template, scenario_from_repository, scenario_duration });
    const safeConfig = clampInitialVitals(config || {});

    // First, get the old case data for audit trail
    dbAdapter.get(`SELECT * FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [caseId, tenantId(req)], (err, oldCase) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const sql = `UPDATE cases SET
                     name = ?, description = ?, system_prompt = ?, config = ?, scenario = ?,
                     patient_name = ?, patient_gender = ?, patient_age = ?, chief_complaint = ?, difficulty_level = ?,
                     last_modified_by = ?, updated_at = CURRENT_TIMESTAMP, version = COALESCE(version, 0) + 1
                     WHERE id = ? AND tenant_id = ?`;
        const params = [
            name,
            description,
            system_prompt,
            JSON.stringify(safeConfig),
            scenarioWithSource ? JSON.stringify(scenarioWithSource) : null,
            patientName,
            patientGender,
            patientAge,
            chiefComplaint,
            difficultyLevel,
            req.user.id,
            caseId,
            tenantId(req)
        ];

        dbAdapter.run(sql, params, function (err) {
            if (err) {
                (req.log || routesCasesLog).error('case update failed', { error: err.message });
                logAudit({
                    userId: req.user.id,
                    username: req.user.username,
                    action: 'UPDATE_CASE',
                    resourceType: 'case',
                    resourceId: caseId,
                    status: 'failure',
                    errorMessage: err.message,
                    ipAddress,
                    userAgent
                });
                return res.status(500).json({ error: err.message });
            }

            // Log audit trail
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'UPDATE_CASE',
                resourceType: 'case',
                resourceId: caseId,
                resourceName: name,
                oldValue: oldCase ? { name: oldCase.name, description: oldCase.description } : null,
                newValue: { name, description, tenant_id: tenantId(req) },
                ipAddress,
                userAgent,
                tenantId: tenantId(req),
                status: 'success'
            });

            // Create version snapshot
            createCaseVersion(caseId, req.user.id, 'updated', 'Case configuration updated', {
                name, description, system_prompt, config, scenario, tenant_id: tenantId(req)
            });

            res.json({ id: caseId, ...req.body });
        });
    });
});

// DELETE /api/cases/:id - Admin only (soft delete)
router.delete('/cases/:id', authenticateToken, requireEducator, (req, res) => {
    const caseId = req.params.id;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Get case name for audit before deleting
    dbAdapter.get(`SELECT name FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [caseId, tenantId(req)], (err, caseData) => {
        if (err) return res.status(500).json({ error: err.message });

        // Soft delete - set deleted_at timestamp
        const sql = `UPDATE cases SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`;
        dbAdapter.run(sql, [caseId, tenantId(req)], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Case not found or already deleted' });
            }

            // Log audit trail
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'DELETE_CASE',
                resourceType: 'case',
                resourceId: caseId,
                resourceName: caseData?.name,
                ipAddress,
                userAgent,
                status: 'success'
                ,
                tenantId: tenantId(req)
            });

            res.json({ message: 'Case deleted successfully', id: caseId });
        });
    });
});

// --- SESSIONS ---

// POST /api/sessions - Authenticated users only

router.get('/scenarios', authenticateToken, (req, res) => {
    const userId = req.user?.id;
    
    const query = `
        SELECT s.*, u.username as created_by_username 
        FROM scenarios s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (s.is_public = 1 OR s.created_by = ?)
        ORDER BY s.created_at DESC
    `;
    
    dbAdapter.all(query, [tenantId(req), userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Parse JSON timeline
        const scenarios = rows.map(row => ({
            ...redactRow(row, { internal: hasRoleAtLeast(req.user, ROLE_RANKS.admin) ? 'allow' : 'redact' }),
            timeline: JSON.parse(row.timeline || '[]')
        }));
        
        res.json({ scenarios });
    });
});

// Get single scenario
router.get('/scenarios/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    dbAdapter.get('SELECT * FROM scenarios WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        res.json({
            ...redactRow(row, { internal: hasRoleAtLeast(req.user, ROLE_RANKS.admin) ? 'allow' : 'redact' }),
            timeline: JSON.parse(row.timeline || '[]')
        });
    });
});

// Create scenario
// Stage-5 audit: validate every timeline frame on write so the runtime
// engine doesn't have to defend against malformed scenarios. Pre-fix
// `params: {hr: "invalid"}` or `rhythm: "ASYSTOLE_TYPO"` were accepted
// and JSON.stringify'd into the DB; PatientMonitor's interpolator then
// produced NaN or hit an unknown rhythm in the ECG generator.
const KNOWN_RHYTHMS = new Set(['NSR', 'AFIB', 'AFib', 'VTach', 'VFib', 'Asystole', 'PVC', 'AFlutter', 'PEA', 'SVT', 'BradySinus', 'JunctionalEscape']);
function validateScenarioTimeline(timeline) {
    if (!Array.isArray(timeline)) return 'timeline must be an array';
    for (let i = 0; i < timeline.length; i++) {
        const frame = timeline[i];
        if (!frame || typeof frame !== 'object') return `frame[${i}] is not an object`;
        if (!Number.isFinite(frame.time) || frame.time < 0) {
            return `frame[${i}].time must be a non-negative number`;
        }
        if (frame.params !== undefined && frame.params !== null) {
            if (typeof frame.params !== 'object') return `frame[${i}].params must be an object`;
            for (const [k, v] of Object.entries(frame.params)) {
                if (v !== null && v !== undefined && !Number.isFinite(Number(v))) {
                    return `frame[${i}].params.${k} must be numeric`;
                }
            }
        }
        if (frame.conditions !== undefined && frame.conditions !== null && typeof frame.conditions !== 'object') {
            return `frame[${i}].conditions must be an object`;
        }
        if (frame.rhythm !== undefined && frame.rhythm !== null && frame.rhythm !== '') {
            // Don't be strict about case; accept anything reasonably named.
            // The known list is informational — log a warning for unknowns
            // rather than reject (admins occasionally invent rhythm names).
            if (typeof frame.rhythm !== 'string') return `frame[${i}].rhythm must be a string`;
        }
    }
    return null;
}

router.post('/scenarios', authenticateToken, (req, res) => {
    const { name, description, duration_minutes, category, timeline, is_public } = req.body;
    const created_by = req.user.id;

    if (!name || !timeline || !duration_minutes) {
        return res.status(400).json({ error: 'Name, timeline, and duration are required' });
    }
    const tlError = validateScenarioTimeline(timeline);
    if (tlError) {
        return res.status(400).json({ error: `Invalid scenario timeline: ${tlError}` });
    }

    const query = `
        INSERT INTO scenarios (name, description, duration_minutes, category, timeline, created_by, is_public, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    dbAdapter.run(
        query,
        [name, description, duration_minutes, category, JSON.stringify(timeline), created_by, is_public ? 1 : 0, tenantId(req)],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            auditSuccess(req, {
                action: 'create_scenario',
                resourceType: 'scenario',
                resourceId: String(this.lastID),
                resourceName: name,
                newValue: { name, description, duration_minutes, category, timeline, is_public: is_public ? 1 : 0 }
            });
            
            res.json({ 
                id: this.lastID,
                message: 'Scenario created successfully' 
            });
        }
    );
});

// Update scenario
router.put('/scenarios/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name, description, duration_minutes, category, timeline, is_public } = req.body;

    // Stage-5 audit: validate timeline shape before persisting (mirrors POST).
    if (timeline !== undefined) {
        const tlError = validateScenarioTimeline(timeline);
        if (tlError) {
            return res.status(400).json({ error: `Invalid scenario timeline: ${tlError}` });
        }
    }
    
    // Check ownership or educator/admin
    dbAdapter.get('SELECT * FROM scenarios WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        if (!canManageOwnedResource(row.created_by, req.user)) {
            return res.status(403).json({ error: 'Not authorized to edit this scenario' });
        }
        
        const query = `
            UPDATE scenarios 
            SET name = ?, description = ?, duration_minutes = ?, category = ?, timeline = ?, is_public = ?
            WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
        `;
        
        dbAdapter.run(
            query,
            [name, description, duration_minutes, category, JSON.stringify(timeline), is_public ? 1 : 0, id, tenantId(req)],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                auditSuccess(req, {
                    action: 'update_scenario',
                    resourceType: 'scenario',
                    resourceId: id,
                    resourceName: name || row.name,
                    oldValue: { ...row, timeline: parseAuditJson(row.timeline) },
                    newValue: { name, description, duration_minutes, category, timeline, is_public: is_public ? 1 : 0 }
                });
                res.json({ message: 'Scenario updated successfully' });
            }
        );
    });
});

// Delete scenario
router.delete('/scenarios/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    // Check ownership or educator/admin
    dbAdapter.get('SELECT * FROM scenarios WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        if (!canManageOwnedResource(row.created_by, req.user)) {
            return res.status(403).json({ error: 'Not authorized to delete this scenario' });
        }
        
        dbAdapter.run('UPDATE scenarios SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, tenantId(req)], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            auditSuccess(req, {
                action: 'delete_scenario',
                resourceType: 'scenario',
                resourceId: id,
                resourceName: row.name,
                oldValue: { ...row, timeline: parseAuditJson(row.timeline) }
            });
            res.json({ message: 'Scenario deleted successfully' });
        });
    });
});

// Seed default scenarios (admin only)
router.post('/scenarios/seed', authenticateToken, requireAdmin, (req, res) => {
    const defaultScenarios = [
        {
            name: "STEMI Progression",
            description: "Acute MI progressing to cardiogenic shock - late stage",
            duration_minutes: 40,
            category: "Cardiac",
            timeline: [
                { time: 0, label: "Initial presentation", params: { hr: 80, spo2: 98, rr: 16, bpSys: 125, bpDia: 82, temp: 37.0, etco2: 38 }, conditions: { stElev: 0 }, rhythm: "NSR" },
                { time: 600, label: "STEMI develops", params: { hr: 110, spo2: 96, rr: 22, bpSys: 145, bpDia: 95, temp: 37.0, etco2: 40 }, conditions: { stElev: 2.0 } },
                { time: 1500, label: "Worsening ischemia", params: { hr: 125, spo2: 92, rr: 26, bpSys: 100, bpDia: 60, temp: 37.0, etco2: 42 }, conditions: { stElev: 2.5, pvc: true } },
                { time: 2400, label: "Late stage", params: { hr: 135, spo2: 85, rr: 28, bpSys: 70, bpDia: 45, temp: 37.0, etco2: 44 }, conditions: { stElev: 2.5, pvc: true, noise: 2 } }
            ]
        },
        {
            name: "Septic Shock Progression",
            description: "Vasodilation leading to severe hypotension - late stage",
            duration_minutes: 40,
            category: "Sepsis",
            timeline: [
                { time: 0, label: "Early sepsis", params: { hr: 95, spo2: 94, rr: 20, bpSys: 110, bpDia: 70, temp: 38.5, etco2: 35 }, conditions: { stElev: 0 }, rhythm: "NSR" },
                { time: 900, label: "Progressive shock", params: { hr: 115, spo2: 90, rr: 26, bpSys: 90, bpDia: 50, temp: 39.5, etco2: 32 }, conditions: { noise: 1 } },
                { time: 1800, label: "Severe shock", params: { hr: 135, spo2: 85, rr: 32, bpSys: 70, bpDia: 35, temp: 39.5, etco2: 28 }, conditions: { noise: 2 } },
                { time: 2400, label: "Late stage", params: { hr: 145, spo2: 80, rr: 36, bpSys: 60, bpDia: 25, temp: 39.8, etco2: 26 }, conditions: { noise: 3 } }
            ]
        },
        {
            name: "Respiratory Failure",
            description: "Gradual onset of hypoxia and hypercapnia - late stage",
            duration_minutes: 30,
            category: "Respiratory",
            timeline: [
                { time: 0, label: "Early distress", params: { hr: 90, spo2: 93, rr: 24, bpSys: 125, bpDia: 80, temp: 37.0, etco2: 42 }, rhythm: "NSR" },
                { time: 600, label: "Worsening hypoxia", params: { hr: 100, spo2: 88, rr: 32, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 48 }, conditions: { noise: 1 } },
                { time: 1200, label: "Severe hypoxia", params: { hr: 115, spo2: 82, rr: 36, bpSys: 140, bpDia: 90, temp: 37.5, etco2: 54 }, conditions: { noise: 2 } },
                { time: 1800, label: "Late stage", params: { hr: 125, spo2: 78, rr: 38, bpSys: 145, bpDia: 92, temp: 37.5, etco2: 60 }, conditions: { noise: 3 } }
            ]
        },
        {
            name: "Hypertensive Crisis",
            description: "Rapid increase in blood pressure - late stage",
            duration_minutes: 45,
            category: "Cardiovascular",
            timeline: [
                { time: 0, label: "Baseline", params: { hr: 75, spo2: 99, rr: 14, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 38 }, rhythm: "NSR" },
                { time: 900, label: "BP rising", params: { hr: 90, spo2: 98, rr: 18, bpSys: 180, bpDia: 110, temp: 37.0, etco2: 40 } },
                { time: 1800, label: "Crisis peak", params: { hr: 105, spo2: 96, rr: 22, bpSys: 220, bpDia: 130, temp: 37.0, etco2: 42 }, conditions: { stElev: -1.0 } },
                { time: 2700, label: "Late stage", params: { hr: 115, spo2: 94, rr: 24, bpSys: 240, bpDia: 150, temp: 37.0, etco2: 45 } }
            ]
        },
        {
            name: "Anaphylactic Shock",
            description: "Rapid onset of severe allergic reaction - late stage",
            duration_minutes: 10,
            category: "Allergic",
            timeline: [
                { time: 0, label: "Initial exposure", params: { hr: 85, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37.0, etco2: 38 }, rhythm: "NSR" },
                { time: 120, label: "Rapid onset", params: { hr: 115, spo2: 92, rr: 28, bpSys: 100, bpDia: 65, temp: 37.0, etco2: 42 }, conditions: { noise: 2 } },
                { time: 300, label: "Severe reaction", params: { hr: 135, spo2: 85, rr: 35, bpSys: 75, bpDia: 45, temp: 37.0, etco2: 48 }, conditions: { noise: 3 } },
                { time: 600, label: "Late stage", params: { hr: 150, spo2: 80, rr: 36, bpSys: 60, bpDia: 35, temp: 36.5, etco2: 50 }, conditions: { pvc: true, noise: 3 } }
            ]
        },
        {
            name: "Post-Resuscitation Recovery",
            description: "Patient recovering after successful resuscitation",
            duration_minutes: 30,
            category: "Recovery",
            timeline: [
                { time: 0, label: "Post-ROSC", params: { hr: 130, spo2: 85, rr: 30, bpSys: 80, bpDia: 50, temp: 35.0, etco2: 30 }, conditions: { noise: 1 }, rhythm: "NSR" },
                { time: 900, label: "Stabilizing", params: { hr: 110, spo2: 92, rr: 20, bpSys: 100, bpDia: 60, temp: 36.0, etco2: 35 }, conditions: { noise: 0 } },
                { time: 1800, label: "Improving", params: { hr: 90, spo2: 96, rr: 16, bpSys: 120, bpDia: 75, temp: 37.0, etco2: 38 } }
            ]
        }
    ];
    
    let inserted = 0;
    let errors = 0;
    
    defaultScenarios.forEach(scenario => {
        const query = `
            INSERT INTO scenarios (name, description, duration_minutes, category, timeline, created_by, is_public)
            VALUES (?, ?, ?, ?, ?, NULL, 1)
        `;
        
        dbAdapter.run(
            query,
            [scenario.name, scenario.description, scenario.duration_minutes, scenario.category, JSON.stringify(scenario.timeline)],
            (err) => {
                if (err) {
                    routesAdminLog.error('scenario seed failed', { scenario_name: scenario.name, error: err.message });
                    errors++;
                } else {
                    inserted++;
                }
                
                // After all scenarios processed
                if (inserted + errors === defaultScenarios.length) {
                    auditSuccess(req, {
                        action: 'seed_scenarios',
                        resourceType: 'scenario',
                        resourceId: 'default_scenarios',
                        newValue: { inserted, errors, total: defaultScenarios.length }
                    });
                    res.json({ 
                        message: `Seeded ${inserted} scenarios, ${errors} errors`,
                        inserted,
                        errors
                    });
                }
            }
        );
    });
});

// ============================================
// NEW ROUTES - Physical Exam, Audit, Preferences
// ============================================

// --- PHYSICAL EXAM FINDINGS ---

// POST /api/sessions/:sessionId/exam-findings - Record a physical exam finding
//
// Stage-6 audit: idempotent on (session_id, body_region, exam_type). Pre-fix
// every POST inserted a fresh row AND bumped exam_findings_count, so a
// network retry doubled both the audit trail and the counter. The natural
// key for this resource is "I performed exam X on region Y in this session";
// re-running it is the same operation. Returns already_recorded:true on
// duplicates.
router.post('/sessions/:sessionId/exam-findings', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    const { body_region, exam_type, finding, is_abnormal, audio_url, audio_played, case_id } = req.body;

    if (!body_region || !exam_type || !finding) {
        return res.status(400).json({ error: 'body_region, exam_type, and finding are required' });
    }

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    const existsSql = `SELECT id, finding, is_abnormal FROM physical_exam_findings
                       WHERE session_id = ? AND body_region = ? AND exam_type = ?
                       LIMIT 1`;
    dbAdapter.get(existsSql, [sessionId, body_region, exam_type], (existsErr, existing) => {
        if (existsErr) return res.status(500).json({ error: existsErr.message });

        if (existing && existing.id) {
            return res.json({
                id: existing.id,
                message: 'Exam finding already recorded',
                already_recorded: true
            });
        }

        const insertSql = `INSERT INTO physical_exam_findings
                     (session_id, case_id, user_id, body_region, exam_type, finding, is_abnormal, audio_url, audio_played)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        dbAdapter.run(insertSql, [
            sessionId,
            case_id || null,
            req.user.id,
            body_region,
            exam_type,
            finding,
            is_abnormal ? 1 : 0,
            audio_url || null,
            audio_played ? 1 : 0
        ], function(err) {
            if (err) return res.status(500).json({ error: err.message });

            // Counter only increments on real inserts so retries don't inflate it.
            dbAdapter.run(`UPDATE sessions SET exam_findings_count = exam_findings_count + 1 WHERE id = ?`, [sessionId]);

            res.json({ id: this.lastID, message: 'Exam finding recorded', already_recorded: false });
        });
    });
});

// GET /api/sessions/:sessionId/exam-findings - Get all exam findings for a session
router.get('/sessions/:sessionId/exam-findings', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    dbAdapter.all(
        `SELECT * FROM physical_exam_findings WHERE session_id = ? ORDER BY timestamp`,
        [sessionId],
        (err, findings) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ findings });
        }
    );
});

// --- CASE VERSIONS ---

// GET /api/cases/:caseId/versions - Get version history for a case
router.get('/cases/:caseId/versions', authenticateToken, requireAdmin, (req, res) => {
    const { caseId } = req.params;

    dbAdapter.all(
        `SELECT cv.*, u.username as changed_by_username
         FROM case_versions cv
         LEFT JOIN users u ON cv.changed_by = u.id
         WHERE cv.case_id = ?
         ORDER BY cv.version_number DESC`,
        [caseId],
        (err, versions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ versions });
        }
    );
});

// POST /api/cases/:caseId/restore/:versionId - Restore a case to a previous version
router.post('/cases/:caseId/restore/:versionId', authenticateToken, requireAdmin, (req, res) => {
    const { caseId, versionId } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    dbAdapter.get(
        `SELECT * FROM case_versions WHERE id = ? AND case_id = ?`,
        [versionId, caseId],
        (err, version) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!version) return res.status(404).json({ error: 'Version not found' });

            const config = JSON.parse(version.config_snapshot);
            const sql = `UPDATE cases SET
                         name = ?, description = ?, system_prompt = ?, config = ?, scenario = ?,
                         last_modified_by = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1
                         WHERE id = ?`;

            dbAdapter.run(sql, [
                config.name,
                config.description,
                config.system_prompt,
                JSON.stringify(config.config || {}),
                config.scenario ? JSON.stringify(config.scenario) : null,
                req.user.id,
                caseId
            ], function(err) {
                if (err) return res.status(500).json({ error: err.message });

                // Log audit and create new version
                logAudit({
                    userId: req.user.id,
                    username: req.user.username,
                    action: 'RESTORE_CASE_VERSION',
                    resourceType: 'case',
                    resourceId: caseId,
                    metadata: { restored_from_version: version.version_number },
                    ipAddress,
                    userAgent,
                    status: 'success'
                });

                createCaseVersion(caseId, req.user.id, 'restored', `Restored from version ${version.version_number}`, config);

                res.json({ message: 'Case restored successfully', restoredFromVersion: version.version_number });
            });
        }
    );
});

// --- USER PREFERENCES ---
//
// (Routes moved earlier in the file — see "USER PREFERENCES (declared early)"
// just above the /users/:id routes. Express matches first-defined-first, and
// /users/:id was capturing /users/preferences as id="preferences" → 404
// "User not found" because no row had that id. Stage E5 fix.)

// ---------------------------------------------------------------------------
// Observability slice: routes — agent templates + TNA + admin.
// Admin, audit-log, agent-template, patient-record, and analytics diagnostics
// use structured route-family logging.
// ---------------------------------------------------------------------------
// --- SYSTEM AUDIT LOG ---


export default router;
