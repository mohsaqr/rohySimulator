import express from 'express';
import dbAdapter from '../dbAdapter.js';
import { dbPath } from '../db.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireAdmin,
    requireEducator,
    hasRoleAtLeast,
    ROLE_RANKS,
} from '../middleware/auth.js';


import {
    REDACTED,
    redactPlatformSettingRows,
} from '../redaction.js';
import { logger } from '../logger.js';
import { DEFAULT_TURNAROUND_MINUTES } from '../lib/turnaround.js';
import { TTS_PROVIDERS, voiceMatchesLanguage } from '../shared/voiceIdentity.js';
import { LANGUAGES } from '../shared/languages.js';
import {
    AFFECT_MODES,
    AFFECT_PROVIDER_POLICIES,
    AFFECT_REACTIVITIES,
    DEFAULT_AFFECT_ROUTING,
    normalizeAffectSettings,
} from '../shared/affectNote.js';
import {
    deriveVoiceProvider,
    getAllProviderStatus,
    defaultVoiceKey,
    defaultVoiceKeys,
    providerEnabledKey,
    providerEnabledKeys,
} from '../services/ttsProviders.js';
import {
    auditSuccess,
    redactAuditSetting,
    redactRows,
    resetCohortCaseEnforcementCache,
    verifySessionOwnership
} from './_helpers.js';

const radiologyLog = logger('radiology');
const routesLlmLog = logger('routes-llm-tts');
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

router.post('/sessions/:sessionId/notes', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    const { note_type, content } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'content is required' });
    }

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    dbAdapter.run(
        `INSERT INTO clinical_notes (session_id, user_id, note_type, content)
         VALUES (?, ?, ?, ?)`,
        [sessionId, req.user.id, note_type || 'general', content],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Note added' });
        }
    );
});

// GET /api/sessions/:sessionId/notes - Get clinical notes for a session
router.get('/sessions/:sessionId/notes', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    dbAdapter.all(
        `SELECT cn.*, u.username
         FROM clinical_notes cn
         LEFT JOIN users u ON cn.user_id = u.id
         WHERE cn.session_id = ? AND cn.deleted_at IS NULL
         ORDER BY cn.created_at`,
        [sessionId],
        (err, notes) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ notes });
        }
    );
});

// --- EXPORT RECORDS ---

// POST /api/admin/export-records - Log an export action (Admin only)
router.post('/admin/export-records', authenticateToken, requireAdmin, (req, res) => {
    const { export_type, export_format, resource_type, resource_ids, record_count, file_name, file_size_bytes, filters_applied, notes } = req.body;

    dbAdapter.run(
        `INSERT INTO export_records (user_id, export_type, export_format, resource_type, resource_ids, record_count, file_name, file_size_bytes, filters_applied, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            req.user.id,
            export_type,
            export_format || null,
            resource_type || null,
            resource_ids ? JSON.stringify(resource_ids) : null,
            record_count || null,
            file_name || null,
            file_size_bytes || null,
            filters_applied ? JSON.stringify(filters_applied) : null,
            notes || null
        ],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Export recorded' });
        }
    );
});

// GET /api/admin/export-records - Get export history (Admin only)
router.get('/admin/export-records', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100, offset = 0 } = req.query;

    dbAdapter.all(
        `SELECT er.*, u.username
         FROM export_records er
         LEFT JOIN users u ON er.user_id = u.id
         ORDER BY er.exported_at DESC
         LIMIT ? OFFSET ?`,
        [parseInt(limit), parseInt(offset)],
        (err, records) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ records: redactRows(records, { pii: 'allow', internal: 'allow' }) });
        }
    );
});

// --- ACTIVE SESSIONS ---

// GET /api/admin/active-sessions - Get currently active sessions (Admin only)

router.get('/admin/database-stats', authenticateToken, requireAdmin, (req, res) => {
    const stats = {};

    const tables = [
        'users', 'cases', 'sessions', 'interactions', 'learning_events',
        'physical_exam_findings', 'case_versions', 'system_audit_log',
        'vital_sign_history', 'clinical_notes', 'export_records', 'active_sessions'
    ];

    let completed = 0;
    tables.forEach(table => {
        dbAdapter.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
            stats[table] = err ? 'error' : row.count;
            completed++;
            if (completed === tables.length) {
                // Use the resolved db path (`ROHY_DB` overrides the default).
                // Pre-F-015 this was hardcoded to `server/database.sqlite`,
                // so deploys that pointed ROHY_DB elsewhere reported
                // "unknown" or stale sizes.
                try {
                    const dbStats = fs.statSync(dbPath);
                    stats.database_size_mb = (dbStats.size / (1024 * 1024)).toFixed(2);
                } catch {
                    stats.database_size_mb = 'unknown';
                }
                res.json({ stats });
            }
        });
    });
});

// ============================================
// MASTER DATA ROUTES - Reference Data Management
// ============================================

// --- BODY REGIONS ---

// GET /api/master/body-regions - Get all body regions
router.get('/master/body-regions', (req, res) => {
    dbAdapter.all(
        `SELECT br.*,
                GROUP_CONCAT(DISTINCT et.technique_id) as exam_types
         FROM body_regions br
         LEFT JOIN region_exam_types ret ON br.id = ret.region_id
         LEFT JOIN exam_techniques et ON ret.technique_id = et.id
         WHERE br.is_active = 1
         GROUP BY br.id
         ORDER BY br.display_order`,
        [],
        (err, regions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ regions });
        }
    );
});

// POST /api/master/body-regions - Create body region (Admin)
router.post('/master/body-regions', authenticateToken, requireEducator, (req, res) => {
    const { region_id, name, anatomical_view, description, parent_region_id, display_order } = req.body;

    dbAdapter.run(
        `INSERT INTO body_regions (region_id, name, anatomical_view, description, parent_region_id, display_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [region_id, name, anatomical_view || 'both', description, parent_region_id, display_order || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Body region created' });
        }
    );
});

// --- EXAM TECHNIQUES ---

// GET /api/master/exam-techniques - Get all exam techniques
router.get('/master/exam-techniques', (req, res) => {
    dbAdapter.all(
        `SELECT * FROM exam_techniques WHERE is_active = 1 ORDER BY display_order`,
        [],
        (err, techniques) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ techniques });
        }
    );
});

// --- BODY MAP COORDINATES ---

// GET /api/master/body-map-coordinates - Get body map coordinates
router.get('/master/body-map-coordinates', (req, res) => {
    const { gender, view } = req.query;

    let sql = `SELECT bmc.*, br.region_id, br.name as region_name
               FROM body_map_coordinates bmc
               JOIN body_regions br ON bmc.region_id = br.id
               WHERE bmc.is_clickable = 1`;
    const params = [];

    if (gender) {
        sql += ` AND (bmc.gender = ? OR bmc.gender = 'unisex')`;
        params.push(gender);
    }
    if (view) {
        sql += ` AND bmc.view = ?`;
        params.push(view);
    }

    sql += ` ORDER BY bmc.z_index`;

    dbAdapter.all(sql, params, (err, coordinates) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ coordinates });
    });
});

// --- SCENARIO TEMPLATES ---

// GET /api/master/scenario-templates - Get all scenario templates
router.get('/master/scenario-templates', (req, res) => {
    const { category, include_timeline } = req.query;

    let sql = `SELECT * FROM scenario_templates WHERE is_active = 1`;
    const params = [];

    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY name`;

    dbAdapter.all(sql, params, (err, templates) => {
        if (err) return res.status(500).json({ error: err.message });

        if (include_timeline === 'true') {
            // Fetch timeline for each template
            const templateIds = templates.map(t => t.id);
            if (templateIds.length === 0) {
                return res.json({ templates });
            }

            dbAdapter.all(
                `SELECT * FROM scenario_timeline_points WHERE scenario_id IN (${templateIds.join(',')}) ORDER BY sequence_order`,
                [],
                (err, points) => {
                    if (err) return res.status(500).json({ error: err.message });

                    templates.forEach(t => {
                        t.timeline = points.filter(p => p.scenario_id === t.id);
                    });
                    res.json({ templates });
                }
            );
        } else {
            res.json({ templates });
        }
    });
});

// GET /api/master/scenario-templates/:id - Get single scenario with timeline
router.get('/master/scenario-templates/:id', (req, res) => {
    const { id } = req.params;

    dbAdapter.get(`SELECT * FROM scenario_templates WHERE id = ? OR template_id = ?`, [id, id], (err, template) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!template) return res.status(404).json({ error: 'Scenario not found' });

        dbAdapter.all(
            `SELECT * FROM scenario_timeline_points WHERE scenario_id = ? ORDER BY sequence_order`,
            [template.id],
            (err, timeline) => {
                if (err) return res.status(500).json({ error: err.message });
                template.timeline = timeline;
                res.json({ template });
            }
        );
    });
});

// POST /api/master/scenario-templates - Create scenario template (Admin)
router.post('/master/scenario-templates', authenticateToken, requireEducator, (req, res) => {
    const { template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, timeline } = req.body;

    dbAdapter.run(
        `INSERT INTO scenario_templates (template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            const scenarioId = this.lastID;

            // Insert timeline points if provided
            if (timeline && timeline.length > 0) {
                const stmt = dbAdapter.prepare(
                    `INSERT INTO scenario_timeline_points
                     (scenario_id, sequence_order, time_minutes, label, hr, spo2, rr, bp_sys, bp_dia, temp, etco2, cardiac_rhythm, st_elevation, pvc_present, wide_qrs, t_inversion, noise_level)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );

                timeline.forEach((point, index) => {
                    stmt.run([
                        scenarioId, index + 1, point.time_minutes || point.time, point.label,
                        point.hr, point.spo2, point.rr, point.bp_sys || point.bpSys, point.bp_dia || point.bpDia,
                        point.temp, point.etco2, point.cardiac_rhythm || point.rhythm,
                        point.st_elevation || point.stElev ? 1 : 0,
                        point.pvc_present || point.pvc ? 1 : 0,
                        point.wide_qrs || point.wideQRS ? 1 : 0,
                        point.t_inversion || point.tInv ? 1 : 0,
                        point.noise_level || point.noise || 0
                    ]);
                });
                stmt.finalize();
            }

            auditSuccess(req, {
                action: 'create_scenario_template',
                resourceType: 'scenario_template',
                resourceId: String(scenarioId),
                resourceName: name,
                newValue: { template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, timeline }
            });
            res.json({ id: scenarioId, message: 'Scenario template created' });
        }
    );
});

// ---------------------------------------------------------------------------
// Observability slice: routes — lab/medication catalogue.
// Legacy master-data endpoints share the structured routes-orders logger until
// the catalogue router owns the full surface.
// ---------------------------------------------------------------------------
// --- LAB TESTS ---

// GET /api/master/lab-tests - Get all lab tests
router.get('/master/lab-tests', (req, res) => {
    const { group, category, search, limit = 500, offset = 0 } = req.query;

    let sql = `SELECT * FROM lab_tests WHERE is_active = 1`;
    const params = [];

    if (group) {
        sql += ` AND test_group = ?`;
        params.push(group);
    }
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }
    if (search) {
        sql += ` AND (test_name LIKE ? OR test_code LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY test_group, test_name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    dbAdapter.all(sql, params, (err, tests) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ tests });
    });
});

// GET /api/master/lab-tests/groups - Get lab test groups
router.get('/master/lab-tests/groups', (req, res) => {
    dbAdapter.all(
        `SELECT DISTINCT test_group, COUNT(*) as count FROM lab_tests WHERE is_active = 1 GROUP BY test_group ORDER BY test_group`,
        [],
        (err, groups) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ groups });
        }
    );
});

// POST /api/master/lab-tests - Create lab test (Admin)
router.post('/master/lab-tests', authenticateToken, requireEducator, (req, res) => {
    const { test_code, test_name, test_group, category, specimen_type, min_value, max_value, unit, critical_low, critical_high, normal_samples, description, turnaround_minutes } = req.body;

    dbAdapter.run(
        `INSERT INTO lab_tests (test_code, test_name, test_group, category, specimen_type, min_value, max_value, unit, critical_low, critical_high, normal_samples, description, turnaround_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [test_code, test_name, test_group, category || 'General', specimen_type, min_value, max_value, unit, critical_low, critical_high, JSON.stringify(normal_samples || []), description, turnaround_minutes || DEFAULT_TURNAROUND_MINUTES],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            auditSuccess(req, {
                action: 'create_master_lab_test',
                resourceType: 'lab_test',
                resourceId: String(this.lastID),
                resourceName: test_name,
                newValue: req.body
            });
            res.json({ id: this.lastID, message: 'Lab test created' });
        }
    );
});

// --- LAB PANELS ---

// GET /api/master/lab-panels - Get all lab panels
router.get('/master/lab-panels', (req, res) => {
    const { category, include_tests } = req.query;

    let sql = `SELECT * FROM lab_panels WHERE is_active = 1`;
    const params = [];

    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY display_order, panel_name`;

    dbAdapter.all(sql, params, (err, panels) => {
        if (err) return res.status(500).json({ error: err.message });

        if (include_tests === 'true') {
            const panelIds = panels.map(p => p.id);
            if (panelIds.length === 0) {
                return res.json({ panels });
            }

            dbAdapter.all(
                `SELECT pt.*, lt.test_name, lt.test_group, lt.unit, lt.min_value, lt.max_value
                 FROM panel_tests pt
                 JOIN lab_tests lt ON pt.lab_test_id = lt.id
                 WHERE pt.panel_id IN (${panelIds.join(',')})
                 ORDER BY pt.display_order`,
                [],
                (err, tests) => {
                    if (err) return res.status(500).json({ error: err.message });

                    panels.forEach(p => {
                        p.tests = tests.filter(t => t.panel_id === p.id);
                    });
                    res.json({ panels });
                }
            );
        } else {
            res.json({ panels });
        }
    });
});

// --- MEDICATIONS ---

// GET /api/master/medications - Get all medications
router.get('/master/medications', (req, res) => {
    const { drug_class, category, search, limit = 500, offset = 0 } = req.query;

    let sql = `SELECT * FROM medications WHERE is_active = 1 AND deleted_at IS NULL`;
    const params = [];

    if (drug_class) {
        sql += ` AND drug_class = ?`;
        params.push(drug_class);
    }
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }
    if (search) {
        sql += ` AND (generic_name LIKE ? OR brand_names LIKE ? OR medication_code LIKE ? OR indications LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY generic_name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    dbAdapter.all(sql, params, (err, medications) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ medications });
    });
});

// POST /api/master/medications - Create medication (Admin)
router.post('/master/medications', authenticateToken, requireEducator, (req, res) => {
    const { medication_code, generic_name, brand_names, drug_class, category, route, typical_dose, dose_unit, frequency, indications, contraindications, side_effects, is_controlled, is_high_alert } = req.body;

    dbAdapter.run(
        `INSERT INTO medications (medication_code, generic_name, brand_names, drug_class, category, route, typical_dose, dose_unit, frequency, indications, contraindications, side_effects, is_controlled, is_high_alert)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [medication_code, generic_name, JSON.stringify(brand_names || []), drug_class, category, route, typical_dose, dose_unit, frequency, JSON.stringify(indications || []), JSON.stringify(contraindications || []), JSON.stringify(side_effects || []), is_controlled ? 1 : 0, is_high_alert ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            auditSuccess(req, {
                action: 'create_master_medication',
                resourceType: 'medication',
                resourceId: String(this.lastID),
                resourceName: generic_name,
                newValue: req.body
            });
            res.json({ id: this.lastID, message: 'Medication created' });
        }
    );
});

// POST /api/master/medications/bulk - Bulk import medications (Admin)
router.post('/master/medications/bulk', authenticateToken, requireEducator, (req, res) => {
    const { medications } = req.body; // Array of { name, uses, side_effects, description }

    if (!Array.isArray(medications) || medications.length === 0) {
        return res.status(400).json({ error: 'medications array is required' });
    }

    const stmt = dbAdapter.prepare(
        `INSERT OR IGNORE INTO medications (generic_name, indications, side_effects, category) VALUES (?, ?, ?, ?)`
    );

    let inserted = 0;
    let skipped = 0;

    dbAdapter.serialize(() => {
        dbAdapter.run('BEGIN TRANSACTION');

        for (const med of medications) {
            const name = med.name || med.medicine_name || med.generic_name;
            if (!name) {
                skipped++;
                continue;
            }

            stmt.run(
                [
                    name.trim(),
                    JSON.stringify(med.uses || []),
                    JSON.stringify(med.side_effects || []),
                    'General'
                ],
                function(err) {
                    if (!err && this.changes > 0) inserted++;
                    else skipped++;
                }
            );
        }

        dbAdapter.run('COMMIT', () => {
            stmt.finalize();
            auditSuccess(req, {
                action: 'bulk_import_master_medications',
                resourceType: 'medication_catalog',
                resourceId: 'medications',
                newValue: { inserted, skipped, total: medications.length }
            });
            res.json({
                message: 'Bulk import completed',
                inserted,
                skipped,
                total: medications.length
            });
        });
    });
});

// DELETE /api/master/medications/:id - Delete single medication (Admin)
router.delete('/master/medications/:id', authenticateToken, requireEducator, (req, res) => {
    const { id } = req.params;

    dbAdapter.get('SELECT * FROM medications WHERE id = ? AND deleted_at IS NULL', [id], (readErr, oldMedication) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        if (!oldMedication) return res.status(404).json({ error: 'Medication not found' });

    dbAdapter.serialize(() => {
        dbAdapter.run('BEGIN');
        dbAdapter.run('DELETE FROM medication_doses WHERE medication_id = ?', [id], function(doseErr) {
            if (doseErr) {
                dbAdapter.run('ROLLBACK');
                return res.status(500).json({ error: doseErr.message });
            }
            const medicationDosesRemoved = this.changes ?? 0;
            dbAdapter.run('UPDATE treatment_effects SET medication_id = NULL WHERE medication_id = ?', [id], function(effectErr) {
                if (effectErr) {
                    dbAdapter.run('ROLLBACK');
                    return res.status(500).json({ error: effectErr.message });
                }
                const treatmentEffectsDetached = this.changes ?? 0;
                dbAdapter.run('UPDATE treatment_orders SET medication_id = NULL WHERE medication_id = ?', [id], function(orderErr) {
                    if (orderErr) {
                        dbAdapter.run('ROLLBACK');
                        return res.status(500).json({ error: orderErr.message });
                    }
                    const treatmentOrdersDetached = this.changes ?? 0;
                    dbAdapter.run('UPDATE case_treatments SET medication_id = NULL WHERE medication_id = ?', [id], function(caseErr) {
                        if (caseErr) {
                            dbAdapter.run('ROLLBACK');
                            return res.status(500).json({ error: caseErr.message });
                        }
                        const caseTreatmentsDetached = this.changes ?? 0;
                        dbAdapter.run('UPDATE medications SET deleted_at = CURRENT_TIMESTAMP, is_active = 0 WHERE id = ? AND deleted_at IS NULL', [id], function(err) {
                            if (err) {
                                dbAdapter.run('ROLLBACK');
                                return res.status(500).json({ error: err.message });
                            }
                            if (this.changes === 0) {
                                dbAdapter.run('ROLLBACK');
                                return res.status(404).json({ error: 'Medication not found' });
                            }
                            dbAdapter.run('COMMIT');
                            auditSuccess(req, {
                                action: 'delete_master_medication',
                                resourceType: 'medication',
                                resourceId: id,
                                resourceName: oldMedication.generic_name,
                                oldValue: oldMedication,
                                metadata: {
                                    medication_doses_removed: medicationDosesRemoved,
                                    treatment_effects_detached: treatmentEffectsDetached,
                                    treatment_orders_detached: treatmentOrdersDetached,
                                    case_treatments_detached: caseTreatmentsDetached
                                }
                            });
                            res.json({
                                message: 'Medication deleted',
                                medication_doses_removed: medicationDosesRemoved,
                                treatment_effects_detached: treatmentEffectsDetached,
                                treatment_orders_detached: treatmentOrdersDetached,
                                case_treatments_detached: caseTreatmentsDetached
                            });
                        });
                    });
                });
            });
        });
    });
    });
});

// DELETE /api/master/medications/all - Clear all medications (Admin)
router.delete('/master/medications/all', authenticateToken, requireEducator, (req, res) => {
    dbAdapter.get('SELECT COUNT(*) AS count FROM medications WHERE deleted_at IS NULL', [], (readErr, row) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        const oldCount = row?.count || 0;

    dbAdapter.serialize(() => {
        dbAdapter.run('BEGIN');
        dbAdapter.run('DELETE FROM medication_doses', [], function(doseErr) {
            if (doseErr) {
                dbAdapter.run('ROLLBACK');
                return res.status(500).json({ error: doseErr.message });
            }
            const medicationDosesRemoved = this.changes ?? 0;
            dbAdapter.run('UPDATE treatment_effects SET medication_id = NULL WHERE medication_id IS NOT NULL', [], function(effectErr) {
                if (effectErr) {
                    dbAdapter.run('ROLLBACK');
                    return res.status(500).json({ error: effectErr.message });
                }
                const treatmentEffectsDetached = this.changes ?? 0;
                dbAdapter.run('UPDATE treatment_orders SET medication_id = NULL WHERE medication_id IS NOT NULL', [], function(orderErr) {
                    if (orderErr) {
                        dbAdapter.run('ROLLBACK');
                        return res.status(500).json({ error: orderErr.message });
                    }
                    const treatmentOrdersDetached = this.changes ?? 0;
                    dbAdapter.run('UPDATE case_treatments SET medication_id = NULL WHERE medication_id IS NOT NULL', [], function(caseErr) {
                        if (caseErr) {
                            dbAdapter.run('ROLLBACK');
                            return res.status(500).json({ error: caseErr.message });
                        }
                        const caseTreatmentsDetached = this.changes ?? 0;
                        dbAdapter.run('UPDATE medications SET deleted_at = CURRENT_TIMESTAMP, is_active = 0 WHERE deleted_at IS NULL', function(err) {
                            if (err) {
                                dbAdapter.run('ROLLBACK');
                                return res.status(500).json({ error: err.message });
                            }
                            const deleted = this.changes ?? 0;
                            dbAdapter.run('COMMIT');
                            auditSuccess(req, {
                                action: 'delete_all_master_medications',
                                resourceType: 'medication_catalog',
                                resourceId: 'medications',
                                oldValue: { medication_count: oldCount },
                                newValue: { medication_count: 0 },
                                metadata: {
                                    deleted,
                                    medication_doses_removed: medicationDosesRemoved,
                                    treatment_effects_detached: treatmentEffectsDetached,
                                    treatment_orders_detached: treatmentOrdersDetached,
                                    case_treatments_detached: caseTreatmentsDetached
                                }
                            });
                            res.json({
                                message: 'All medications deleted',
                                deleted,
                                medication_doses_removed: medicationDosesRemoved,
                                treatment_effects_detached: treatmentEffectsDetached,
                                treatment_orders_detached: treatmentOrdersDetached,
                                case_treatments_detached: caseTreatmentsDetached
                            });
                        });
                    });
                });
            });
        });
    });
    });
});

// --- INVESTIGATION TEMPLATES ---

// GET /api/master/investigation-templates - Get all investigation templates
router.get('/master/investigation-templates', (req, res) => {
    const { investigation_type, category } = req.query;

    let sql = `SELECT * FROM investigation_templates WHERE is_active = 1`;
    const params = [];

    if (investigation_type) {
        sql += ` AND investigation_type = ?`;
        params.push(investigation_type);
    }
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY category, name`;

    dbAdapter.all(sql, params, (err, templates) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ templates });
    });
});

// --- VITAL SIGN DEFINITIONS ---

// GET /api/master/vital-sign-definitions - Get vital sign definitions
router.get('/master/vital-sign-definitions', (req, res) => {
    dbAdapter.all(
        `SELECT * FROM vital_sign_definitions WHERE is_active = 1 ORDER BY display_order`,
        [],
        (err, vitals) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ vitals });
        }
    );
});

// --- DIAGNOSES ---

// GET /api/master/diagnoses - Get diagnoses
router.get('/master/diagnoses', (req, res) => {
    const { body_system, severity, search, limit = 500, offset = 0 } = req.query;

    let sql = `SELECT * FROM diagnoses WHERE is_active = 1`;
    const params = [];

    if (body_system) {
        sql += ` AND body_system = ?`;
        params.push(body_system);
    }
    if (severity) {
        sql += ` AND severity = ?`;
        params.push(severity);
    }
    if (search) {
        sql += ` AND (name LIKE ? OR icd_code LIKE ? OR description LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    dbAdapter.all(sql, params, (err, diagnoses) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ diagnoses });
    });
});

// --- SEARCH ALIASES ---

// GET /api/master/search-aliases - Get search aliases
router.get('/master/search-aliases', (req, res) => {
    const { alias_type } = req.query;

    let sql = `SELECT * FROM search_aliases WHERE is_active = 1`;
    const params = [];

    if (alias_type) {
        sql += ` AND alias_type = ?`;
        params.push(alias_type);
    }

    sql += ` ORDER BY alias_term`;

    dbAdapter.all(sql, params, (err, aliases) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ aliases });
    });
});

// ============================================
// SEEDING ROUTES - Import data from files
// ============================================

// POST /api/admin/seed/exam-techniques - Seed exam techniques
router.post('/admin/seed/exam-techniques', authenticateToken, requireAdmin, (req, res) => {
    const techniques = [
        { technique_id: 'inspection', name: 'Inspection', icon: 'Eye', description: 'Visual examination', display_order: 1 },
        { technique_id: 'palpation', name: 'Palpation', icon: 'Hand', description: 'Examination by touch', display_order: 2 },
        { technique_id: 'percussion', name: 'Percussion', icon: 'Waves', description: 'Tapping to assess underlying structures', display_order: 3 },
        { technique_id: 'auscultation', name: 'Auscultation', icon: 'Stethoscope', description: 'Listening to body sounds', display_order: 4 },
        { technique_id: 'special', name: 'Special Tests', icon: 'ClipboardCheck', description: 'Specialized examination techniques', display_order: 5 }
    ];

    let inserted = 0;
    techniques.forEach(t => {
        dbAdapter.run(
            `INSERT OR IGNORE INTO exam_techniques (technique_id, name, icon, description, display_order) VALUES (?, ?, ?, ?, ?)`,
            [t.technique_id, t.name, t.icon, t.description, t.display_order],
            (err) => {
                if (!err) inserted++;
            }
        );
    });

    setTimeout(() => {
        res.json({ message: `Seeded ${inserted} exam techniques` });
    }, 500);
});

// POST /api/admin/seed/vital-definitions - Seed vital sign definitions
router.post('/admin/seed/vital-definitions', authenticateToken, requireAdmin, (req, res) => {
    const vitals = [
        { vital_id: 'hr', name: 'Heart Rate', abbreviation: 'HR', unit: 'bpm', normal_min: 60, normal_max: 100, critical_low: 40, critical_high: 150, alarm_low: 50, alarm_high: 120, display_order: 1, color_code: '#ef4444' },
        { vital_id: 'spo2', name: 'Oxygen Saturation', abbreviation: 'SpO2', unit: '%', normal_min: 95, normal_max: 100, critical_low: 88, critical_high: null, alarm_low: 90, alarm_high: null, display_order: 2, color_code: '#3b82f6' },
        { vital_id: 'rr', name: 'Respiratory Rate', abbreviation: 'RR', unit: '/min', normal_min: 12, normal_max: 20, critical_low: 8, critical_high: 30, alarm_low: 10, alarm_high: 24, display_order: 3, color_code: '#22c55e' },
        { vital_id: 'bp_sys', name: 'Systolic BP', abbreviation: 'SBP', unit: 'mmHg', normal_min: 90, normal_max: 140, critical_low: 70, critical_high: 180, alarm_low: 80, alarm_high: 160, display_order: 4, color_code: '#f59e0b' },
        { vital_id: 'bp_dia', name: 'Diastolic BP', abbreviation: 'DBP', unit: 'mmHg', normal_min: 60, normal_max: 90, critical_low: 40, critical_high: 110, alarm_low: 50, alarm_high: 100, display_order: 5, color_code: '#f59e0b' },
        { vital_id: 'temp', name: 'Temperature', abbreviation: 'Temp', unit: '°C', normal_min: 36.5, normal_max: 37.5, critical_low: 35, critical_high: 40, alarm_low: 36, alarm_high: 38.5, decimal_places: 1, display_order: 6, color_code: '#a855f7' },
        { vital_id: 'etco2', name: 'End-Tidal CO2', abbreviation: 'EtCO2', unit: 'mmHg', normal_min: 35, normal_max: 45, critical_low: 20, critical_high: 60, alarm_low: 30, alarm_high: 50, display_order: 7, color_code: '#6366f1' }
    ];

    let inserted = 0;
    vitals.forEach(v => {
        dbAdapter.run(
            `INSERT OR IGNORE INTO vital_sign_definitions (vital_id, name, abbreviation, unit, normal_min, normal_max, critical_low, critical_high, alarm_low, alarm_high, decimal_places, display_order, color_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.vital_id, v.name, v.abbreviation, v.unit, v.normal_min, v.normal_max, v.critical_low, v.critical_high, v.alarm_low, v.alarm_high, v.decimal_places || 0, v.display_order, v.color_code],
            (err) => {
                if (!err) inserted++;
            }
        );
    });

    setTimeout(() => {
        res.json({ message: `Seeded ${inserted} vital sign definitions` });
    }, 500);
});

// POST /api/admin/seed/lab-tests - Seed lab tests from file
router.post('/admin/seed/lab-tests', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const labDbPath = path.join(__dirname, '../../Lab_database.txt');

        if (!fs.existsSync(labDbPath)) {
            return res.status(404).json({ error: 'Lab_database.txt not found' });
        }

        const content = fs.readFileSync(labDbPath, 'utf8');
        const tests = JSON.parse(content);

        let inserted = 0;
        let errors = 0;

        const stmt = dbAdapter.prepare(
            `INSERT OR IGNORE INTO lab_tests (test_name, test_group, category, min_value, max_value, unit, normal_samples)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        tests.forEach(test => {
            stmt.run(
                [test.test_name, test.group, test.category || 'General', test.min_value, test.max_value, test.unit, JSON.stringify(test.normal_samples || [])],
                (err) => {
                    if (err) errors++;
                    else inserted++;
                }
            );
        });

        stmt.finalize(() => {
            res.json({ message: `Imported ${inserted} lab tests, ${errors} errors`, total: tests.length });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error importing lab tests', details: error.message });
    }
});

// POST /api/admin/seed/body-regions - Seed body regions from examRegions.js data
router.post('/admin/seed/body-regions', authenticateToken, requireAdmin, (req, res) => {
    // Basic body regions - can be expanded
    const regions = [
        { region_id: 'headNeck', name: 'Head & Neck', anatomical_view: 'anterior', display_order: 1 },
        { region_id: 'eyes', name: 'Eyes', anatomical_view: 'anterior', display_order: 2 },
        { region_id: 'ears', name: 'Ears', anatomical_view: 'both', display_order: 3 },
        { region_id: 'nose', name: 'Nose', anatomical_view: 'anterior', display_order: 4 },
        { region_id: 'mouth', name: 'Mouth/Throat', anatomical_view: 'anterior', display_order: 5 },
        { region_id: 'neck', name: 'Neck', anatomical_view: 'both', display_order: 6 },
        { region_id: 'chest', name: 'Chest', anatomical_view: 'anterior', display_order: 7 },
        { region_id: 'heart', name: 'Heart', anatomical_view: 'anterior', display_order: 8 },
        { region_id: 'lungs', name: 'Lungs', anatomical_view: 'both', display_order: 9 },
        { region_id: 'abdomen', name: 'Abdomen', anatomical_view: 'anterior', display_order: 10 },
        { region_id: 'back', name: 'Back', anatomical_view: 'posterior', display_order: 11 },
        { region_id: 'upperExtremities', name: 'Upper Extremities', anatomical_view: 'both', display_order: 12 },
        { region_id: 'lowerExtremities', name: 'Lower Extremities', anatomical_view: 'both', display_order: 13 },
        { region_id: 'skin', name: 'Skin', anatomical_view: 'both', display_order: 14 },
        { region_id: 'neurological', name: 'Neurological', anatomical_view: 'special', display_order: 15 }
    ];

    let inserted = 0;
    regions.forEach(r => {
        dbAdapter.run(
            `INSERT OR IGNORE INTO body_regions (region_id, name, anatomical_view, display_order) VALUES (?, ?, ?, ?)`,
            [r.region_id, r.name, r.anatomical_view, r.display_order],
            (err) => {
                if (!err) inserted++;
            }
        );
    });

    setTimeout(() => {
        res.json({ message: `Seeded ${inserted} body regions` });
    }, 500);
});

// POST /api/admin/seed/all - Documentation-only endpoint that lists the
// per-domain seed routes. Actual seeding is fan-out, run by the operator
// against the individual endpoints (no per-call results aggregation here).
router.post('/admin/seed/all', authenticateToken, requireAdmin, async (req, res) => {
    res.json({
        message: 'To seed all data, call individual seed endpoints:',
        endpoints: [
            'POST /api/admin/seed/exam-techniques',
            'POST /api/admin/seed/vital-definitions',
            'POST /api/admin/seed/body-regions',
            'POST /api/admin/seed/lab-tests'
        ]
    });
});

// ============================================
// USER PROFILE ENDPOINTS
// ============================================

// GET /api/user/profile - Get current user's profile

const DEFAULT_USER_FIELD_CONFIG = {
    name: { label: 'Full Name', required: true, enabled: true },
    institution: { label: 'Institution', required: false, enabled: true },
    address: { label: 'Address', required: false, enabled: true },
    phone: { label: 'Phone Number', required: false, enabled: true },
    alternative_email: { label: 'Alternative Email', required: false, enabled: true },
    education: { label: 'Education', required: false, enabled: true },
    grade: { label: 'Grade/Year', required: false, enabled: true }
};

// GET /api/platform-settings/user-fields - Get user field configuration
router.get('/platform-settings/user-fields', authenticateToken, (req, res) => {
    dbAdapter.get(
        `SELECT setting_value FROM platform_settings WHERE setting_key = 'user_field_config'`,
        [],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (row && row.setting_value) {
                try {
                    const config = JSON.parse(row.setting_value);
                    res.json({ config });
                } catch {
                    res.json({ config: DEFAULT_USER_FIELD_CONFIG });
                }
            } else {
                res.json({ config: DEFAULT_USER_FIELD_CONFIG });
            }
        }
    );
});

// PUT /api/platform-settings/user-fields - Update user field configuration (Admin only)
router.put('/platform-settings/user-fields', authenticateToken, requireAdmin, (req, res) => {
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Invalid configuration' });
    }

    const configJson = JSON.stringify(config);

    getPlatformSetting('user_field_config')
        .then((oldValue) => {
            dbAdapter.run(
                `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
                 VALUES ('user_field_config', ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(setting_key) DO UPDATE SET
                 setting_value = excluded.setting_value,
                 updated_by = excluded.updated_by,
                 updated_at = CURRENT_TIMESTAMP`,
                [configJson, req.user.id],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    auditSuccess(req, {
                        action: 'update_platform_user_fields',
                        resourceType: 'platform_setting',
                        resourceId: 'user_field_config',
                        resourceName: 'user_field_config',
                        oldValue: { user_field_config: redactAuditSetting('user_field_config', oldValue) },
                        newValue: { user_field_config: config }
                    });
                    res.json({ message: 'User field configuration updated', config });
                }
            );
        })
        .catch((err) => {
            if (err) return res.status(500).json({ error: err.message });
        });
});

// GET /api/platform-settings - Get all platform settings (Admin only)
router.get('/platform-settings', authenticateToken, requireAdmin, (req, res) => {
    dbAdapter.all(
        `SELECT ps.*, u.username as updated_by_username
         FROM platform_settings ps
         LEFT JOIN users u ON ps.updated_by = u.id
         ORDER BY ps.setting_key`,
        [],
        (err, settings) => {
            if (err) return res.status(500).json({ error: err.message });

            res.json({ settings: redactPlatformSettingRows(settings) });
        }
    );
});

// ============================================
// LLM SETTINGS & RATE LIMITING API
// ============================================

// Helper function to get a platform setting
const getPlatformSetting = (key) => {
    return new Promise((resolve, reject) => {
        dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key], (err, row) => {
            if (err) reject(err);
            else resolve(row?.setting_value || null);
        });
    });
};

// Helper function to set a platform setting
const setPlatformSetting = (key, value, userId) => {
    return new Promise((resolve, reject) => {
        dbAdapter.run(
            `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(setting_key) DO UPDATE SET
             setting_value = excluded.setting_value,
             updated_by = excluded.updated_by,
             updated_at = CURRENT_TIMESTAMP`,
            [key, value, userId],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
};

const setAuditedPlatformSetting = async (req, key, value, action = 'update_platform_setting') => {
    const oldValue = await getPlatformSetting(key);
    await setPlatformSetting(key, value, req.user.id);
    auditSuccess(req, {
        action,
        resourceType: 'platform_setting',
        resourceId: key,
        resourceName: key,
        oldValue: { [key]: redactAuditSetting(key, oldValue) },
        newValue: { [key]: redactAuditSetting(key, value) }
    });
};

// --- Cohort-case access enforcement flag ------------------------------------
// The master switch for class-centric, date-windowed case access (default OFF
// so existing installs are unaffected until an admin opts in). Reads/writes the
// `enforce_cohort_case_access` platform setting and busts the in-process cache.
router.get('/platform-settings/cohort-case-enforcement', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const value = await getPlatformSetting('enforce_cohort_case_access');
        res.json({ enabled: value === 'true' || value === '1' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/platform-settings/cohort-case-enforcement', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
        await setAuditedPlatformSetting(req, 'enforce_cohort_case_access', enabled ? 'true' : 'false', 'update_cohort_case_enforcement');
        resetCohortCaseEnforcementCache();
        res.json({ enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Default LLM settings
const DEFAULT_LLM_SETTINGS = {
    provider: 'lmstudio',
    model: 'local-model',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
    enabled: true,
    maxOutputTokens: '',  // Empty = use provider default
    temperature: '',      // Empty = use provider default
    // Empty by default. The previous shipped default was a ~30-line generic
    // "You are a simulated patient" block that was prepended to every patient
    // prompt — and shadowed each case's own persona / instructions. Behavioral
    // guidance (no jargon, stay in character, etc.) now lives in the patient
    // agent template (`agent_templates` row, agent_type='patient'), which can
    // be edited per deployment from the UI. Admins who still want a global
    // preamble can set this explicitly; if set, it is *appended* after the
    // case content rather than prepended (see proxy-routes.js).
    systemPromptTemplate: ''
};

// Default rate limit settings (0 = unlimited/disabled)
const DEFAULT_RATE_LIMITS = {
    tokensPerUserDaily: 0,
    costPerUserDaily: 0,
    tokensPlatformDaily: 0,
    costPlatformDaily: 0,
    requestsPerUserHourly: 0
};

// GET /api/platform-settings/llm - Get LLM configuration
router.get('/platform-settings/llm', authenticateToken, async (req, res) => {
    try {
        const settings = {};
        const keys = ['llm_provider', 'llm_model', 'llm_base_url', 'llm_api_key', 'llm_enabled', 'llm_max_output_tokens', 'llm_temperature', 'llm_system_prompt_template'];

        for (const key of keys) {
            settings[key] = await getPlatformSetting(key);
        }

        // Runtime fields the DiagnosticBar and other authenticated UI
        // surfaces need to render. The base URL is a vendor public endpoint
        // (e.g. https://api.openai.com/v1), so it's not treated as secret.
        const response = {
            provider: settings.llm_provider || DEFAULT_LLM_SETTINGS.provider,
            model: settings.llm_model || DEFAULT_LLM_SETTINGS.model,
            baseUrl: settings.llm_base_url || DEFAULT_LLM_SETTINGS.baseUrl,
            apiKey: settings.llm_api_key ? REDACTED : '',
            apiKeySet: !!settings.llm_api_key,
            enabled: settings.llm_enabled !== 'false',
            maxOutputTokens: settings.llm_max_output_tokens || '',
            temperature: settings.llm_temperature || ''
        };

        // F-008: the system-prompt template is rubric framing / pedagogy
        // policy — students must not see it. Gate behind educator+ so the
        // admin LLM settings page (also educator-gated by the same role
        // wall in the SPA) still loads, but the per-session DiagnosticBar
        // call from a student account returns the template field omitted.
        if (hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            response.systemPromptTemplate = settings.llm_system_prompt_template || DEFAULT_LLM_SETTINGS.systemPromptTemplate;
        }

        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/llm - Update LLM configuration (Admin only)
router.put('/platform-settings/llm', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { provider, model, baseUrl, apiKey, enabled, maxOutputTokens, temperature, systemPromptTemplate } = req.body;

        if (provider) await setAuditedPlatformSetting(req, 'llm_provider', provider, 'update_platform_llm_settings');
        if (model !== undefined) await setAuditedPlatformSetting(req, 'llm_model', model, 'update_platform_llm_settings');
        if (baseUrl) await setAuditedPlatformSetting(req, 'llm_base_url', baseUrl, 'update_platform_llm_settings');
        if (apiKey !== undefined && apiKey !== REDACTED) await setAuditedPlatformSetting(req, 'llm_api_key', apiKey, 'update_platform_llm_settings');
        if (enabled !== undefined) await setAuditedPlatformSetting(req, 'llm_enabled', String(enabled), 'update_platform_llm_settings');
        if (maxOutputTokens !== undefined) await setAuditedPlatformSetting(req, 'llm_max_output_tokens', String(maxOutputTokens), 'update_platform_llm_settings');
        if (temperature !== undefined) await setAuditedPlatformSetting(req, 'llm_temperature', String(temperature), 'update_platform_llm_settings');
        if (systemPromptTemplate !== undefined) await setAuditedPlatformSetting(req, 'llm_system_prompt_template', systemPromptTemplate, 'update_platform_llm_settings');

        res.json({ message: 'LLM settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/platform-settings/llm/test - Test LLM connection (Admin only)
router.post('/platform-settings/llm/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const provider = await getPlatformSetting('llm_provider') || DEFAULT_LLM_SETTINGS.provider;
        const model = await getPlatformSetting('llm_model') || '';
        const baseUrl = await getPlatformSetting('llm_base_url') || DEFAULT_LLM_SETTINGS.baseUrl;
        const apiKey = await getPlatformSetting('llm_api_key') || '';

        let headers = { 'Content-Type': 'application/json' };
        let requestPayload = {};
        let endpoint = '';

        if (provider === 'anthropic') {
            // Anthropic API format
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            requestPayload = {
                model: model || 'claude-3-5-sonnet-20241022',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'Say "test successful" in exactly two words.' }]
            };
            endpoint = `${baseUrl}/messages`;
        } else {
            // OpenAI-compatible format
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            requestPayload = {
                messages: [{ role: 'user', content: 'Say "test successful" in exactly two words.' }]
            };
            if (model && model.trim() !== '') {
                requestPayload.model = model;
            }
            endpoint = `${baseUrl}/chat/completions`;
        }

        (req.log || routesLlmLog).info('llm test request sending', { provider, endpoint });
        const testResponse = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestPayload)
        });

        if (!testResponse.ok) {
            const errText = await testResponse.text();
            return res.status(400).json({
                success: false,
                error: `LLM API returned ${testResponse.status}: ${errText}`
            });
        }

        const data = await testResponse.json();

        // Extract content based on provider
        let responseContent;
        if (provider === 'anthropic') {
            responseContent = data.content?.[0]?.text || 'No response content';
        } else {
            responseContent = data.choices?.[0]?.message?.content || 'No response content';
        }

        res.json({
            success: true,
            message: 'Connection successful',
            response: responseContent
        });
    } catch (err) {
        (req.log || routesLlmLog).error('llm test failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/platform-settings/llm/models/detect - list the models the configured
// server actually has loaded (Admin only). LM Studio (and every other
// OpenAI-compatible server) refuses to guess when more than one model is loaded
// — it returns 400 "Multiple models are loaded. Please specify a model." — so the
// admin needs to know the exact ids on offer. This proxies the provider's
// standard `GET <baseUrl>/models` list so the picker can be populated live.
//
// Body params (baseUrl/apiKey/provider) let the caller detect against UNSAVED
// edits; each falls back to the persisted platform setting when omitted.
router.post('/platform-settings/llm/models/detect', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const provider = req.body?.provider || await getPlatformSetting('llm_provider') || DEFAULT_LLM_SETTINGS.provider;
        const baseUrl = (req.body?.baseUrl ?? await getPlatformSetting('llm_base_url')) || DEFAULT_LLM_SETTINGS.baseUrl;
        const apiKey = (req.body?.apiKey ?? await getPlatformSetting('llm_api_key')) || '';

        if (provider === 'anthropic') {
            // Anthropic has no OpenAI-style /models list to enumerate here; the
            // curated catalogue already covers it, so there's nothing to detect.
            return res.json({ models: [], supported: false });
        }

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const endpoint = `${String(baseUrl).replace(/\/$/, '')}/models`;

        (req.log || routesLlmLog).info('llm models detect', { provider, endpoint });
        const resp = await fetch(endpoint, { method: 'GET', headers });
        if (!resp.ok) {
            const errText = await resp.text();
            return res.status(400).json({ error: `Model list request returned ${resp.status}: ${errText}` });
        }
        const data = await resp.json();
        // OpenAI-compatible shape: { data: [{ id }, …] }. Fall back to a bare
        // array in case a server returns the list directly.
        const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        const models = rows
            .map((m) => (typeof m === 'string' ? m : m?.id))
            .filter((id) => typeof id === 'string' && id.trim() !== '');
        res.json({ models, supported: true });
    } catch (err) {
        (req.log || routesLlmLog).error('llm models detect failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// GET /api/platform-settings/rate-limits - Get rate limit configuration
router.get('/platform-settings/rate-limits', authenticateToken, async (req, res) => {
    try {
        const settings = {
            tokensPerUserDaily: parseInt(await getPlatformSetting('rate_limit_tokens_per_user_daily')) || DEFAULT_RATE_LIMITS.tokensPerUserDaily,
            costPerUserDaily: parseFloat(await getPlatformSetting('rate_limit_cost_per_user_daily')) || DEFAULT_RATE_LIMITS.costPerUserDaily,
            tokensPlatformDaily: parseInt(await getPlatformSetting('rate_limit_tokens_platform_daily')) || DEFAULT_RATE_LIMITS.tokensPlatformDaily,
            costPlatformDaily: parseFloat(await getPlatformSetting('rate_limit_cost_platform_daily')) || DEFAULT_RATE_LIMITS.costPlatformDaily,
            requestsPerUserHourly: parseInt(await getPlatformSetting('rate_limit_requests_per_user_hourly')) || DEFAULT_RATE_LIMITS.requestsPerUserHourly
        };

        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/rate-limits - Update rate limit configuration (Admin only)
router.put('/platform-settings/rate-limits', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { tokensPerUserDaily, costPerUserDaily, tokensPlatformDaily, costPlatformDaily, requestsPerUserHourly } = req.body;

        if (tokensPerUserDaily !== undefined) await setAuditedPlatformSetting(req, 'rate_limit_tokens_per_user_daily', String(tokensPerUserDaily), 'update_platform_rate_limits');
        if (costPerUserDaily !== undefined) await setAuditedPlatformSetting(req, 'rate_limit_cost_per_user_daily', String(costPerUserDaily), 'update_platform_rate_limits');
        if (tokensPlatformDaily !== undefined) await setAuditedPlatformSetting(req, 'rate_limit_tokens_platform_daily', String(tokensPlatformDaily), 'update_platform_rate_limits');
        if (costPlatformDaily !== undefined) await setAuditedPlatformSetting(req, 'rate_limit_cost_platform_daily', String(costPlatformDaily), 'update_platform_rate_limits');
        if (requestsPerUserHourly !== undefined) await setAuditedPlatformSetting(req, 'rate_limit_requests_per_user_hourly', String(requestsPerUserHourly), 'update_platform_rate_limits');

        res.json({ message: 'Rate limits updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Default monitor visibility settings
const DEFAULT_MONITOR_SETTINGS = {
    showTimer: true,
    showECG: true,
    showSpO2: true,
    showBP: true,
    showRR: true,
    showTemp: true,
    showCO2: true,
    showPleth: true,
    showNumerics: true
};

// GET /api/platform-settings/monitor - Get monitor visibility settings (public, no auth required)
router.get('/platform-settings/monitor', async (req, res) => {
    try {
        const settings = {};
        for (const [key, defaultVal] of Object.entries(DEFAULT_MONITOR_SETTINGS)) {
            const value = await getPlatformSetting(`monitor_${key}`);
            settings[key] = value !== null ? value === 'true' : defaultVal;
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/monitor - Update monitor visibility settings (Admin only)
router.put('/platform-settings/monitor', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const validKeys = Object.keys(DEFAULT_MONITOR_SETTINGS);

        for (const [key, value] of Object.entries(req.body)) {
            if (validKeys.includes(key)) {
                await setAuditedPlatformSetting(req, `monitor_${key}`, String(value), 'update_platform_monitor_settings');
            }
        }

        res.json({ message: 'Monitor settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Default doctor/chat settings
const DEFAULT_CHAT_SETTINGS = {
    doctorName: 'Dr. Carmen',
    doctorAvatar: ''
};

// GET /api/platform-settings/chat - Get chat/doctor settings
router.get('/platform-settings/chat', authenticateToken, async (req, res) => {
    try {
        const doctorName = await getPlatformSetting('chat_doctor_name') || DEFAULT_CHAT_SETTINGS.doctorName;
        const doctorAvatar = await getPlatformSetting('chat_doctor_avatar') || DEFAULT_CHAT_SETTINGS.doctorAvatar;

        res.json({
            doctorName,
            doctorAvatar
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/chat - Update chat/doctor settings (Admin only)
router.put('/platform-settings/chat', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { doctorName, doctorAvatar } = req.body;

        if (doctorName !== undefined) await setAuditedPlatformSetting(req, 'chat_doctor_name', doctorName, 'update_platform_chat_settings');
        if (doctorAvatar !== undefined) await setAuditedPlatformSetting(req, 'chat_doctor_avatar', doctorAvatar, 'update_platform_chat_settings');

        res.json({ message: 'Chat settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// VOICE SETTINGS (Stack T)
// ============================================
// All fields are nullable except voice_mode_enabled (defaults false).
// No frontend defaults — admin must populate before voice mode is usable.

// Voice 2.0 (VOICE2_PLAN.md §5.4): there is no `tts_provider` engine
// setting, no per-provider `voice_<p>_<gender>` slot keys, and no
// `default_voice_<p>_<gender>` persona-default keys — the voice endpoints
// own exactly ONE defaults family: `tts_default_voice_<lang>` (one per
// registry language) plus `tts_provider_enabled_<p>` policy toggles.
// Migration 0034 deletes the retired rows.
const VOICE_GENDERS = ['male', 'female', 'child'];
const VOICE_STT_PROVIDERS = ['browser'];
const VOICE_AVATAR_TYPES = ['3d_head', 'none'];

// Path-traversal-proof voice id check. Piper voices end in .onnx; Kokoro
// voice ids are short slugs like "af_heart". Both must avoid path separators.
const isSafeVoiceFilename = (s) => {
    if (typeof s !== 'string' || s.length === 0 || s.length > 200) return false;
    if (s.includes('/') || s.includes('\\') || s.includes('..') || s.startsWith('.')) return false;
    // Either a Piper .onnx filename, or a short alphanumeric/underscore slug
    // matching Kokoro's voice id format (e.g. "af_heart", "bm_george").
    return s.endsWith('.onnx') || /^[a-zA-Z0-9_-]+$/.test(s);
};

const isBcp47 = (s) => typeof s === 'string' && /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s) && s.length <= 35;

// GET /api/platform-settings/voice - Get voice settings (any authed user).
// Cloud TTS API keys are *never* returned — only a boolean indicating
// whether one is configured. Prevents leaking keys to non-admins and to
// browser dev-tools. The env var (process.env.GOOGLE_TTS_API_KEY) is also
// reported as "set" so the UI can show "configured via env" for
// production deployments that don't want keys in the database.
router.get('/platform-settings/voice', authenticateToken, async (req, res) => {
    try {
        const flatKeys = [
            'voice_mode_enabled',
            'tts_rate', 'tts_pitch',
            'stt_provider', 'stt_language',
            'avatar_type', 'llm_model_voice',
            'google_tts_api_key', 'openai_tts_api_key'
        ];
        const raw = {};
        for (const k of flatKeys) raw[k] = await getPlatformSetting(k);

        const toFloat = (v) => v === null || v === undefined || v === '' ? null : parseFloat(v);

        const out = {
            voice_mode_enabled: raw.voice_mode_enabled === 'true',
            tts_rate: toFloat(raw.tts_rate),
            tts_pitch: toFloat(raw.tts_pitch),
            stt_provider: raw.stt_provider || null,
            stt_language: raw.stt_language || null,
            avatar_type: raw.avatar_type || null,
            llm_model_voice: raw.llm_model_voice || null,
            google_tts_api_key_set: !!raw.google_tts_api_key || !!process.env.GOOGLE_TTS_API_KEY,
            google_tts_api_key_via_env: !raw.google_tts_api_key && !!process.env.GOOGLE_TTS_API_KEY,
            openai_tts_api_key_set: !!raw.openai_tts_api_key || !!process.env.OPENAI_API_KEY,
            openai_tts_api_key_via_env: !raw.openai_tts_api_key && !!process.env.OPENAI_API_KEY
        };
        // Voice 2.0: per-language default voices (the fallback safety net,
        // VOICE2_PLAN.md §5.5) + per-provider enable toggles + live provider
        // status so the client never re-probes capability itself.
        for (const lang of Object.keys(LANGUAGES)) {
            out[defaultVoiceKey(lang)] = (await getPlatformSetting(defaultVoiceKey(lang))) || null;
        }
        for (const p of TTS_PROVIDERS) {
            const v = await getPlatformSetting(providerEnabledKey(p));
            out[providerEnabledKey(p)] = v !== '0' && v !== 'false';
        }
        out.providers = await getAllProviderStatus();
        res.json(out);
    } catch (err) {
        (req.log || routesLlmLog).error('voice platform settings read failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load voice settings' });
    }
});

// PUT /api/platform-settings/voice - Update voice settings (Admin only)
router.put('/platform-settings/voice', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const allowed = new Set([
            'voice_mode_enabled',
            'tts_rate', 'tts_pitch',
            'stt_provider', 'stt_language',
            'avatar_type', 'llm_model_voice',
            'google_tts_api_key', 'openai_tts_api_key',
            ...defaultVoiceKeys(),
            ...providerEnabledKeys()
        ]);

        for (const key of Object.keys(body)) {
            if (!allowed.has(key)) {
                return res.status(400).json({ error: `Unknown setting: ${key} (endpoint: /platform-settings/voice)` });
            }
        }

        const validateRange = (v, min, max) => {
            if (v === null || v === undefined || v === '') return null;
            const f = parseFloat(v);
            if (!Number.isFinite(f) || f < min || f > max) return undefined;
            return String(f);
        };

        const writes = [];
        const warnings = [];
        const setIfPresent = (key, val) => writes.push([key, val]);

        if ('voice_mode_enabled' in body) {
            if (typeof body.voice_mode_enabled !== 'boolean') {
                return res.status(400).json({ error: 'voice_mode_enabled must be boolean' });
            }
            setIfPresent('voice_mode_enabled', body.voice_mode_enabled ? 'true' : 'false');
        }
        // Per-language default voices (VOICE2_PLAN.md §5.5). Validation is
        // the same catalogue authority /api/tts routes with — a typo'd
        // default cannot be saved. Tolerant on check ERRORS: "not found
        // anywhere" rejects, "couldn't check" saves with a warning (an
        // admin must be able to save a kokoro default on a box where the
        // kokoro import is broken). A voice that provably speaks the wrong
        // language rejects; unknown language passes.
        for (const lang of Object.keys(LANGUAGES)) {
            const k = defaultVoiceKey(lang);
            if (!(k in body)) continue;
            const v = body[k];
            if (v === null || v === '' || v === undefined) {
                setIfPresent(k, ''); // clearing restores loud-fail for this language
                continue;
            }
            if (typeof v !== 'string' || !isSafeVoiceFilename(v)) {
                return res.status(400).json({ error: `${k} must be a safe voice id` });
            }
            const { provider, checkErrors } = await deriveVoiceProvider(v);
            if (!provider) {
                if (checkErrors.length > 0) {
                    warnings.push(`${k}: could not verify "${v}" (catalogue check failed for: ${checkErrors.join(', ')}); saved unverified`);
                    setIfPresent(k, v);
                    continue;
                }
                return res.status(400).json({ error: `${k}: voice "${v}" is in no provider's catalogue` });
            }
            if (voiceMatchesLanguage(v, provider, lang) === false) {
                return res.status(400).json({ error: `${k}: voice "${v}" (${provider}) does not speak "${lang}"` });
            }
            setIfPresent(k, v);
        }
        // Per-provider enable toggles (VOICE2_PLAN.md §5.2 — the cost
        // policy switch; capability is probed, never stored).
        for (const p of TTS_PROVIDERS) {
            const k = providerEnabledKey(p);
            if (!(k in body)) continue;
            if (typeof body[k] !== 'boolean') {
                return res.status(400).json({ error: `${k} must be boolean` });
            }
            setIfPresent(k, body[k] ? '1' : '0');
        }
        if ('tts_rate' in body) {
            const v = validateRange(body.tts_rate, 0.5, 1.5);
            if (v === undefined) {
                return res.status(400).json({ error: 'tts_rate must be between 0.5 and 1.5' });
            }
            setIfPresent('tts_rate', v ?? '');
        }
        if ('tts_pitch' in body) {
            const v = validateRange(body.tts_pitch, -10, 10);
            if (v === undefined) {
                return res.status(400).json({ error: 'tts_pitch must be between -10 and 10 semitones' });
            }
            setIfPresent('tts_pitch', v ?? '');
        }
        if ('stt_provider' in body) {
            if (body.stt_provider !== null && !VOICE_STT_PROVIDERS.includes(body.stt_provider)) {
                return res.status(400).json({ error: `stt_provider must be one of ${VOICE_STT_PROVIDERS.join(', ')}` });
            }
            setIfPresent('stt_provider', body.stt_provider || '');
        }
        if ('stt_language' in body) {
            if (body.stt_language !== null && body.stt_language !== '' && !isBcp47(body.stt_language)) {
                return res.status(400).json({ error: 'stt_language must be a BCP-47 locale tag' });
            }
            setIfPresent('stt_language', body.stt_language || '');
        }
        if ('avatar_type' in body) {
            if (body.avatar_type !== null && !VOICE_AVATAR_TYPES.includes(body.avatar_type)) {
                return res.status(400).json({ error: `avatar_type must be one of ${VOICE_AVATAR_TYPES.join(', ')}` });
            }
            setIfPresent('avatar_type', body.avatar_type || '');
        }
        if ('llm_model_voice' in body) {
            if (body.llm_model_voice !== null && (typeof body.llm_model_voice !== 'string' || body.llm_model_voice.length > 200)) {
                return res.status(400).json({ error: 'llm_model_voice must be a string ≤ 200 chars or null' });
            }
            setIfPresent('llm_model_voice', body.llm_model_voice || '');
        }
        // Cloud TTS API keys: empty string clears the value (admin can also
        // disable by sending '' to fall back to env or to fail-open). We don't
        // shape-validate beyond a length cap and a charset filter — different
        // providers have different prefixes, and stale validation tends to
        // reject keys that work fine.
        for (const k of ['google_tts_api_key', 'openai_tts_api_key']) {
            if (k in body) {
                const v = body[k];
                // Intentional control-char filter — rejects API keys that
                // would smuggle NULs, ESC, etc. through the settings boundary.
                // eslint-disable-next-line no-control-regex
                if (v !== null && v !== '' && (typeof v !== 'string' || v.length > 256 || /[\s\x00-\x1f\x7f]/.test(v))) {
                    return res.status(400).json({ error: `${k} must be a printable string ≤ 256 chars or empty to clear` });
                }
                setIfPresent(k, v || '');
            }
        }

        for (const [k, v] of writes) {
            await setAuditedPlatformSetting(req, k, v, 'update_platform_voice_settings');
        }

        res.json({
            message: 'Voice settings updated successfully',
            updated: writes.map(w => w[0]),
            ...(warnings.length > 0 ? { warnings } : {})
        });
    } catch (err) {
        (req.log || routesLlmLog).error('voice platform settings update failed', { error: err.message });
        res.status(500).json({ error: 'Failed to update voice settings' });
    }
});

// --- Affect routing (Plan A, todo/plan-a-implementation-spec.md) -------------
// One JSON platform key (`affect_routing`) holding the whole config, stored
// normalized. GET is any-authed-user — the chat client needs the routing
// decision (mode, thresholds) before it computes a signal; there is nothing
// sensitive in it. PUT is admin-only. The proxy route re-reads the stored
// value on every LLM call, so the server stays the authoritative gate no
// matter what a stale client sends.

// GET /api/platform-settings/affect - Affect-routing config (any authed user)
router.get('/platform-settings/affect', authenticateToken, async (req, res) => {
    try {
        const raw = await getPlatformSetting('affect_routing');
        res.json(normalizeAffectSettings(raw));
    } catch (err) {
        res.status(500).json({ error: 'Failed to load affect settings' });
    }
});

// PUT /api/platform-settings/affect - Update affect-routing config (Admin only)
router.put('/platform-settings/affect', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const allowed = new Set(Object.keys(DEFAULT_AFFECT_ROUTING));
        for (const key of Object.keys(body)) {
            if (!allowed.has(key)) {
                return res.status(400).json({ error: `Unknown setting: ${key} (endpoint: /platform-settings/affect)` });
            }
        }
        // Loud validation (voice-settings pattern): reject bad values rather
        // than silently coercing — an admin must know their input didn't take.
        if ('enabled' in body && typeof body.enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be boolean' });
        }
        if ('affect_mode' in body && !AFFECT_MODES.includes(body.affect_mode)) {
            return res.status(400).json({ error: `affect_mode must be one of: ${AFFECT_MODES.join(', ')}` });
        }
        if ('providers' in body && !AFFECT_PROVIDER_POLICIES.includes(body.providers)) {
            return res.status(400).json({ error: `providers must be one of: ${AFFECT_PROVIDER_POLICIES.join(', ')}` });
        }
        if ('reactivity' in body && !AFFECT_REACTIVITIES.includes(body.reactivity)) {
            return res.status(400).json({ error: `reactivity must be one of: ${AFFECT_REACTIVITIES.join(', ')}` });
        }
        if ('may_acknowledge' in body && typeof body.may_acknowledge !== 'boolean') {
            return res.status(400).json({ error: 'may_acknowledge must be boolean' });
        }
        if ('min_confidence' in body) {
            const f = Number(body.min_confidence);
            if (!Number.isFinite(f) || f < 0 || f > 1) {
                return res.status(400).json({ error: 'min_confidence must be a number between 0 and 1' });
            }
        }
        if ('max_age_ms' in body) {
            const f = Number(body.max_age_ms);
            if (!Number.isFinite(f) || f < 1000 || f > 120000) {
                return res.status(400).json({ error: 'max_age_ms must be between 1000 and 120000' });
            }
        }
        const current = normalizeAffectSettings(await getPlatformSetting('affect_routing'));
        const merged = normalizeAffectSettings({ ...current, ...body });
        await setAuditedPlatformSetting(req, 'affect_routing', JSON.stringify(merged), 'update_affect_settings');
        res.json(merged);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update affect settings' });
    }
});

// Per-gender persona defaults — FLAT, provider-independent keys only:
//   default_avatar_<gender>   — GLB filename, no TTS interaction
//   default_rate_<gender>     — TTS speed (0.5–1.5), applies to any engine
//   default_pitch_<gender>    — provider pitch in semitones (-10–10)
//
// Voice defaults do NOT live here. The gendered per-provider
// `default_voice_<provider>_<gender>` family (a no-op since the 2026-05
// resolver collapse) is retired by migration 0034; the live defaults are
// the per-LANGUAGE `tts_default_voice_<lang>` keys on
// /platform-settings/voice (VOICE2_PLAN.md §5.5).
const PERSONA_GENDERS = VOICE_GENDERS;
const PERSONA_FLAT_FIELDS = ['avatar', 'rate', 'pitch'];
const PERSONA_FLAT_KEYS = PERSONA_GENDERS
    .flatMap(g => PERSONA_FLAT_FIELDS.map(f => `default_${f}_${g}`));
const PERSONA_KEYS = new Set(PERSONA_FLAT_KEYS);

// GET /api/platform-settings/avatars - Per-gender persona defaults (any authed user)
router.get('/platform-settings/avatars', authenticateToken, async (req, res) => {
    try {
        const out = {};
        for (const k of PERSONA_KEYS) {
            const v = await getPlatformSetting(k);
            // Numeric fields come back as strings from the KV store; coerce.
            if (v != null && v !== '' && (k.startsWith('default_rate_') || k.startsWith('default_pitch_'))) {
                const n = Number(v);
                out[k] = Number.isFinite(n) ? n : null;
            } else {
                out[k] = v || null;
            }
        }
        res.json(out);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/avatars - Update persona defaults (Admin only)
router.put('/platform-settings/avatars', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        for (const key of Object.keys(body)) {
            if (!PERSONA_KEYS.has(key)) {
                return res.status(400).json({ error: `Unknown setting: ${key} (endpoint: /platform-settings/avatars)` });
            }
        }
        const isSafeGlb   = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]+\.glb$/.test(v);
        const inRange = (v, lo, hi) => {
            const n = Number(v);
            return Number.isFinite(n) && n >= lo && n <= hi;
        };

        for (const k of PERSONA_KEYS) {
            if (!(k in body)) continue;
            const raw = body[k];
            // Empty / null clears the override.
            if (raw === null || raw === '' || raw === undefined) {
                await setAuditedPlatformSetting(req, k, '', 'update_platform_avatar_defaults');
                continue;
            }
            if (k.startsWith('default_avatar_') && !isSafeGlb(raw)) {
                return res.status(400).json({ error: `${k} must be a safe GLB filename` });
            }
            if (k.startsWith('default_rate_')  && !inRange(raw, 0.5, 1.5)) {
                return res.status(400).json({ error: `${k} must be between 0.5 and 1.5` });
            }
            if (k.startsWith('default_pitch_') && !inRange(raw, -10, 10)) {
                return res.status(400).json({ error: `${k} must be between -10 and 10 semitones` });
            }
            await setAuditedPlatformSetting(req, k, String(raw), 'update_platform_avatar_defaults');
        }
        res.json({ message: 'Persona defaults updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// LLM MODELS REGISTRY
// ============================================
// This endpoint is the single allowed home for hardcoded Anthropic model
// identifiers. Frontend code reads from here rather than embedding strings.

export default router;
