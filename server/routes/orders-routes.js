import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireEducator,
    requireReviewer,
    ROLE_RANKS,
    hasRoleAtLeast,
} from '../middleware/auth.js';


import * as labDb from '../services/labDatabase.js';


import { logger } from '../logger.js';
import {
    auditSuccess,
    logAudit,
    resolveSessionCaseConfig,
    resolveSessionTrinity,
    tenantId,
    verifySessionOwnership
} from './_helpers.js';

const radiologyLog = logger('radiology');
const routesOrdersLog = logger('routes-orders-labs-radiology');
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

router.get('/cases/:id/investigations', authenticateToken, (req, res) => {
    const caseId = req.params.id;
    
    const sql = `SELECT * FROM case_investigations WHERE case_id = ? AND tenant_id = ? AND deleted_at IS NULL`;
    
    dbAdapter.all(sql, [caseId, tenantId(req)], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ investigations: rows });
    });
});

// POST /api/investigations - Admin creates investigation for case
router.post('/investigations', authenticateToken, requireEducator, (req, res) => {
    const { case_id, investigation_type, test_name, result_data, image_url, turnaround_minutes } = req.body;
    
    const sql = `INSERT INTO case_investigations (case_id, investigation_type, test_name, result_data, image_url, turnaround_minutes, tenant_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    dbAdapter.run(sql, [case_id, investigation_type, test_name, JSON.stringify(result_data), image_url, turnaround_minutes || 30, tenantId(req)], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// POST /api/sessions/:id/order - Order investigation(s)
router.post('/sessions/:id/order', authenticateToken, async (req, res) => {
    const sessionId = req.params.id;
    const { investigation_ids } = req.body; // Array of investigation IDs

    if (!Array.isArray(investigation_ids)) {
        return res.status(400).json({ error: 'investigation_ids must be an array' });
    }

    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;

    const sql = `INSERT INTO investigation_orders (session_id, investigation_id, available_at, tenant_id)
                 VALUES (?, ?, datetime('now', '+' || (SELECT turnaround_minutes FROM case_investigations WHERE id = ? AND tenant_id = ?) || ' minutes'), ?)`;

    const stmt = dbAdapter.prepare(sql);
    let inserted = 0;
    let runError = null;
    let pending = investigation_ids.length;

    if (pending === 0) {
        stmt.finalize();
        return res.json({ message: '0 investigations ordered' });
    }

    investigation_ids.forEach(invId => {
        stmt.run([sessionId, invId, invId, tenantId(req), tenantId(req)], function(err) {
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
                    res.json({ message: `${inserted} investigations ordered` });
                });
            }
        });
    });
});

// ---------------------------------------------------------------------------
// Observability slice: routes — orders + labs + radiology.
// Lab, radiology, treatment, and investigation-order diagnostics are structured
// under req.log or routes-orders-labs-radiology.
// ---------------------------------------------------------------------------
// GET /api/sessions/:id/orders - Get all orders for session
router.get('/sessions/:id/orders', authenticateToken, (req, res) => {
    const sessionId = req.params.id;

    // Calculate is_ready directly in SQLite to avoid timezone issues
    const sql = `
        SELECT
            io.*,
            ci.investigation_type,
            ci.test_name,
            ci.test_group,
            ci.gender_category,
            ci.min_value,
            ci.max_value,
            ci.current_value,
            ci.unit,
            ci.result_data,
            ci.image_url,
            ci.turnaround_minutes,
            ci.is_abnormal,
            CASE WHEN datetime(io.available_at) <= datetime('now') THEN 1 ELSE 0 END as is_ready_db,
            (julianday(io.available_at) - julianday('now')) * 24 * 60 as minutes_remaining
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ? AND io.tenant_id = ?
        ORDER BY io.ordered_at DESC
    `;

    dbAdapter.all(sql, [sessionId, tenantId(req)], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        (req.log || routesOrdersLog).debug('orders rows loaded', { session_id: sessionId, row_count: rows.length });

        // Parse JSON result_data and ensure all values are present
        const orders = rows.map(row => {
            const order = {
                ...row,
                result_data: row.result_data ? JSON.parse(row.result_data) : null,
                is_ready: row.is_ready_db === 1,
                minutes_remaining: Math.max(0, Math.ceil(row.minutes_remaining || 0)),
                test_group: row.test_group || 'General',
                unit: row.unit || '',
                min_value: row.min_value ?? null,
                max_value: row.max_value ?? null,
                current_value: row.current_value ?? null
            };
            (req.log || routesOrdersLog).debug('order readiness calculated', { test_name: row.test_name, is_ready: order.is_ready, minutes_remaining: row.minutes_remaining, available_at: row.available_at });
            return order;
        });

        res.json({ orders });
    });
});

// PUT /api/orders/:id/view - Mark investigation as viewed
//
// Pattern-sweep follow-up to Stage 3: this endpoint had the same shape as
// the alarm-ack IDOR — `req.params.id` + UPDATE without an ownership check
// and no idempotency on the timestamp. Pre-fix any authenticated user could
// flip another learner's `viewed_at` (corrupting their analytics) and a
// network retry on the legitimate owner's PUT re-stamped the viewed_at,
// destroying the view_delay_ms metric. Fix folds both:
//   1. JOIN to sessions to verify the requester owns the session (or admin).
//   2. Only stamp if viewed_at IS NULL; on retry return 200 with the
//      original timestamp + already_viewed:true, mirroring /alarms/ack.
router.put('/orders/:id/view', authenticateToken, (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.id;
    const canSupervise = hasRoleAtLeast(req.user, ROLE_RANKS.educator);

    // First get the order details for logging
    const getOrderSql = `
        SELECT io.*, ci.test_name, ci.test_group, ci.current_value, ci.unit, ci.is_abnormal,
               s.case_id, s.id as session_id, s.user_id as session_user_id
        FROM investigation_orders io
        LEFT JOIN case_investigations ci ON io.investigation_id = ci.id
        LEFT JOIN sessions s ON io.session_id = s.id
        WHERE io.id = ? AND io.tenant_id = ?
    `;

    dbAdapter.get(getOrderSql, [orderId, tenantId(req)], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        // Ownership: only the session owner or educator/admin can mark viewed.
        if (!canSupervise && order.session_user_id !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Idempotent: a retry returns the original timestamp without
        // re-stamping. view_delay_ms calculation relies on viewed_at being
        // set on first view only; mutating it would silently zero the metric.
        if (order.viewed_at) {
            return res.json({
                message: 'Order already marked as viewed',
                viewed_at: order.viewed_at,
                already_viewed: true
            });
        }

        const now = new Date();
        const orderedAt = new Date(order.ordered_at);
        const availableAt = new Date(order.available_at);

        // Calculate timing metrics (first-view path only — order.viewed_at is null here)
        const waitTimeMs = availableAt - orderedAt;
        const viewDelayMs = now - availableAt;
        const totalTimeMs = now - orderedAt;

        // Update viewed_at (guard with IS NULL so a parallel retry can't double-stamp)
        const updateSql = `UPDATE investigation_orders SET viewed_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND viewed_at IS NULL`;

        dbAdapter.run(updateSql, [orderId, tenantId(req)], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });

            // Log detailed learning event
            const logSql = `
                INSERT INTO learning_events (
                    session_id, user_id, case_id, verb, object_type, object_id, object_name,
                    component, result, duration_ms, context, tenant_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const context = {
                test_group: order.test_group,
                value: order.current_value,
                unit: order.unit,
                is_abnormal: order.is_abnormal,
                wait_time_ms: waitTimeMs,
                view_delay_ms: viewDelayMs,
                total_time_ms: totalTimeMs,
                ordered_at: order.ordered_at,
                available_at: order.available_at
            };

            const resultText = `${order.current_value} ${order.unit || ''}${order.is_abnormal ? ' (ABNORMAL)' : ''}`;

            dbAdapter.run(logSql, [
                order.session_id,
                userId,
                order.case_id,
                'VIEWED_LAB_RESULT',
                'lab_result',
                String(order.investigation_id),
                order.test_name,
                'OrdersDrawer',
                resultText,
                viewDelayMs,
                JSON.stringify(context),
                tenantId(req)
            ]);

            res.json({
                message: 'Investigation marked as viewed',
                timing: {
                    wait_time_minutes: Math.round(waitTimeMs / 60000 * 10) / 10,
                    view_delay_minutes: Math.round(viewDelayMs / 60000 * 10) / 10,
                    total_time_minutes: Math.round(totalTimeMs / 60000 * 10) / 10
                }
            });
        });
    });
});

// --- LABORATORY DATABASE ENDPOINTS ---

// GET /api/labs/search - Search lab database
router.get('/labs/search', authenticateToken, (req, res) => {
    const { q, limit = 50 } = req.query;
    
    if (!q || q.trim() === '') {
        return res.json({ results: [] });
    }
    
    try {
        const results = labDb.searchTests(q, parseInt(limit));
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: 'Error searching labs', details: error.message });
    }
});

// GET /api/labs/groups - Get all test groups
router.get('/labs/groups', authenticateToken, (req, res) => {
    try {
        const groups = labDb.getAllGroups();
        res.json({ groups });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching groups', details: error.message });
    }
});

// GET /api/labs/group/:groupName - Get tests by group
router.get('/labs/group/:groupName', authenticateToken, (req, res) => {
    const { groupName } = req.params;
    
    try {
        const tests = labDb.getTestsByGroup(decodeURIComponent(groupName));
        res.json({ tests });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching tests by group', details: error.message });
    }
});

// GET /api/labs/all - Get all tests (paginated)
router.get('/labs/all', authenticateToken, (req, res) => {
    const { page = 1, pageSize = 50 } = req.query;
    
    try {
        const result = labDb.getAllTests(parseInt(page), parseInt(pageSize));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching all tests', details: error.message });
    }
});

// GET /api/labs/grouped - Get tests grouped by name
router.get('/labs/grouped', authenticateToken, (req, res) => {
    try {
        const grouped = labDb.getGroupedTests();
        res.json({ tests: grouped });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching grouped tests', details: error.message });
    }
});

// GET /api/labs/stats - Get database statistics (Admin only)
router.get('/labs/stats', authenticateToken, requireReviewer, (req, res) => {
    try {
        const stats = labDb.getDatabaseStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching stats', details: error.message });
    }
});

// POST /api/labs/test - Add a new lab test (Admin only)
router.post('/labs/test', authenticateToken, requireEducator, (req, res) => {
    try {
        const result = labDb.addTest(req.body);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        auditSuccess(req, {
            action: 'create_lab_catalog_test',
            resourceType: 'lab_catalog_test',
            resourceId: `${result.test.test_name}:${result.test.category}`,
            resourceName: result.test.test_name,
            newValue: result.test
        });
        res.status(201).json({ message: 'Test added successfully', test: result.test });
    } catch (error) {
        res.status(500).json({ error: 'Error adding test', details: error.message });
    }
});

// PUT /api/labs/test - Update a lab test (Admin only)
router.put('/labs/test', authenticateToken, requireEducator, (req, res) => {
    const { test_name, category, ...updates } = req.body;

    if (!test_name || !category) {
        return res.status(400).json({ error: 'test_name and category are required' });
    }

    try {
        const oldTest = labDb.loadLabDatabase().find(t => t.test_name === test_name && t.category === category) || null;
        const result = labDb.updateTest(test_name, category, updates);
        if (!result.success) {
            return res.status(404).json({ error: result.error });
        }
        auditSuccess(req, {
            action: 'update_lab_catalog_test',
            resourceType: 'lab_catalog_test',
            resourceId: `${test_name}:${category}`,
            resourceName: test_name,
            oldValue: oldTest,
            newValue: result.test
        });
        res.json({ message: 'Test updated successfully', test: result.test });
    } catch (error) {
        res.status(500).json({ error: 'Error updating test', details: error.message });
    }
});

// DELETE /api/labs/test - Delete a lab test (Admin only)
router.delete('/labs/test', authenticateToken, requireEducator, (req, res) => {
    const { test_name, category } = req.body;

    if (!test_name || !category) {
        return res.status(400).json({ error: 'test_name and category are required' });
    }

    try {
        const oldTest = labDb.loadLabDatabase().find(t => t.test_name === test_name && t.category === category) || null;
        const result = labDb.deleteTest(test_name, category);
        if (!result.success) {
            return res.status(404).json({ error: result.error });
        }
        auditSuccess(req, {
            action: 'delete_lab_catalog_test',
            resourceType: 'lab_catalog_test',
            resourceId: `${test_name}:${category}`,
            resourceName: test_name,
            oldValue: oldTest
        });
        res.json({ message: 'Test deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting test', details: error.message });
    }
});

// POST /api/labs/import - Import lab tests from CSV (Admin only)
router.post('/labs/import', authenticateToken, requireEducator, (req, res) => {
    const { tests, overwrite = false } = req.body;

    if (!tests || !Array.isArray(tests) || tests.length === 0) {
        return res.status(400).json({ error: 'tests array is required' });
    }

    try {
        const results = labDb.importFromCSV(tests, overwrite);
        auditSuccess(req, {
            action: 'import_lab_catalog_tests',
            resourceType: 'lab_catalog',
            resourceId: 'Lab_database.json',
            newValue: { overwrite, submitted: tests.length, results }
        });
        res.json({
            message: 'Import completed',
            results
        });
    } catch (error) {
        res.status(500).json({ error: 'Error importing tests', details: error.message });
    }
});

// POST /api/labs/reload - Force reload the lab database (Admin only)
router.post('/labs/reload', authenticateToken, requireEducator, (req, res) => {
    try {
        labDb.clearCache();
        const tests = labDb.loadLabDatabase();
        auditSuccess(req, {
            action: 'reload_lab_catalog',
            resourceType: 'lab_catalog',
            resourceId: 'Lab_database.json',
            newValue: { totalTests: tests.length }
        });
        res.json({ message: 'Database reloaded', totalTests: tests.length });
    } catch (error) {
        res.status(500).json({ error: 'Error reloading database', details: error.message });
    }
});

// POST /api/cases/:caseId/labs - Add or update lab test on a case (Admin only)
//
// Stage-2 audit: this endpoint is now an UPSERT keyed on
// (case_id, test_name, investigation_type='lab'). Pre-fix it was append-only,
// which let ConfigPanel's per-row save loop quietly accumulate duplicates
// every time an admin saved a case. Single-row admin adds and the bulk PUT
// below both rely on this dedup behavior.
router.post('/cases/:caseId/labs', authenticateToken, requireEducator, (req, res) => {
    const { caseId } = req.params;
    const {
        test_name,
        test_group,
        gender_category,
        min_value,
        max_value,
        current_value,
        unit,
        normal_samples,
        is_abnormal,
        turnaround_minutes = 30
    } = req.body;

    if (!test_name) {
        return res.status(400).json({ error: 'test_name is required' });
    }

    const findSql = `SELECT id FROM case_investigations WHERE case_id = ? AND tenant_id = ? AND investigation_type = 'lab' AND test_name = ? AND deleted_at IS NULL`;
    dbAdapter.get(findSql, [caseId, tenantId(req), test_name], (findErr, existing) => {
        if (findErr) return res.status(500).json({ error: findErr.message });

        if (existing && existing.id) {
            dbAdapter.get('SELECT * FROM case_investigations WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [existing.id, tenantId(req)], (oldErr, oldLab) => {
                if (oldErr) return res.status(500).json({ error: oldErr.message });
            const updateSql = `
                UPDATE case_investigations
                SET test_group = ?, gender_category = ?, min_value = ?, max_value = ?,
                    current_value = ?, unit = ?, normal_samples = ?,
                    is_abnormal = ?, turnaround_minutes = ?
                WHERE id = ?
            `;
            dbAdapter.run(updateSql, [
                test_group, gender_category, min_value, max_value, current_value, unit,
                JSON.stringify(normal_samples || []),
                is_abnormal ? 1 : 0, turnaround_minutes, existing.id
            ], function(updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                auditSuccess(req, {
                    action: 'update_case_lab',
                    resourceType: 'case_lab',
                    resourceId: String(existing.id),
                    resourceName: test_name,
                    oldValue: oldLab,
                    newValue: req.body,
                    metadata: { case_id: caseId }
                });
                res.json({ id: existing.id, message: 'Lab test updated', upserted: true });
            });
            });
            return;
        }

        const insertSql = `
            INSERT INTO case_investigations (
                case_id, investigation_type, test_name, test_group, gender_category,
                min_value, max_value, current_value, unit, normal_samples,
                is_abnormal, turnaround_minutes, tenant_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        dbAdapter.run(insertSql, [
            caseId, 'lab', test_name, test_group, gender_category,
            min_value, max_value, current_value, unit,
            JSON.stringify(normal_samples || []),
            is_abnormal ? 1 : 0, turnaround_minutes, tenantId(req)
        ], function(insertErr) {
            if (insertErr) return res.status(500).json({ error: insertErr.message });
            auditSuccess(req, {
                action: 'create_case_lab',
                resourceType: 'case_lab',
                resourceId: String(this.lastID),
                resourceName: test_name,
                newValue: req.body,
                metadata: { case_id: caseId }
            });
            res.json({ id: this.lastID, message: 'Lab test added to case' });
        });
    });
});

// PUT /api/cases/:caseId/labs - Bulk-replace all lab rows for a case (Admin only)
//
// Stage-2 audit: ConfigPanel previously POSTed each lab in the editor's array
// without any cleanup, so admin removals never deleted DB rows. This endpoint
// is the atomic replacement: cascade-clean dependent investigation_orders for
// labs we're about to remove, drop the old lab rows, then insert the new set.
router.put('/cases/:caseId/labs', authenticateToken, requireEducator, (req, res) => {
    const { caseId } = req.params;
    const labs = Array.isArray(req.body?.labs) ? req.body.labs : null;
    if (labs === null) {
        return res.status(400).json({ error: 'body.labs array is required' });
    }

    dbAdapter.all(
        `SELECT * FROM case_investigations WHERE case_id = ? AND tenant_id = ? AND investigation_type = 'lab' AND deleted_at IS NULL`,
        [caseId, tenantId(req)],
        (readErr, oldLabs) => {
            if (readErr) return res.status(500).json({ error: readErr.message });

    dbAdapter.serialize(() => {
        dbAdapter.run('BEGIN');
        // Delete dependent orders for this case's lab investigations first
        // (FK has no ON DELETE CASCADE — application layer handles it).
        const orphanSql = `
            DELETE FROM investigation_orders
            WHERE investigation_id IN (
                SELECT id FROM case_investigations
                WHERE case_id = ? AND tenant_id = ? AND investigation_type = 'lab' AND deleted_at IS NULL
            )
        `;
        dbAdapter.run(orphanSql, [caseId, tenantId(req)], (orphanErr) => {
            if (orphanErr) {
                dbAdapter.run('ROLLBACK');
                return res.status(500).json({ error: orphanErr.message });
            }
            dbAdapter.run(
                `UPDATE case_investigations SET deleted_at = CURRENT_TIMESTAMP WHERE case_id = ? AND tenant_id = ? AND investigation_type = 'lab' AND deleted_at IS NULL`,
                [caseId, tenantId(req)],
                function(deleteErr) {
                    if (deleteErr) {
                        dbAdapter.run('ROLLBACK');
                        return res.status(500).json({ error: deleteErr.message });
                    }
                    const deleted = this.changes ?? 0;
                    if (labs.length === 0) {
                        dbAdapter.run('COMMIT');
                        auditSuccess(req, {
                            action: 'bulk_replace_case_labs',
                            resourceType: 'case',
                            resourceId: caseId,
                            oldValue: { labs: oldLabs || [] },
                            newValue: { labs: [] },
                            metadata: { inserted: 0, deleted }
                        });
                        return res.json({ inserted: 0, deleted });
                    }
                    const insertSql = `
                        INSERT INTO case_investigations (
                            case_id, investigation_type, test_name, test_group, gender_category,
                            min_value, max_value, current_value, unit, normal_samples,
                            is_abnormal, turnaround_minutes, tenant_id
                        ) VALUES (?, 'lab', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    let pending = labs.length;
                    let failed = false;
                    labs.forEach(lab => {
                        if (failed) return;
                        if (!lab?.test_name) {
                            failed = true;
                            dbAdapter.run('ROLLBACK');
                            return res.status(400).json({ error: 'each lab requires test_name' });
                        }
                        dbAdapter.run(insertSql, [
                            caseId, lab.test_name, lab.test_group ?? null,
                            lab.gender_category ?? null, lab.min_value ?? null,
                            lab.max_value ?? null, lab.current_value ?? null,
                            lab.unit ?? null, JSON.stringify(lab.normal_samples || []),
                            lab.is_abnormal ? 1 : 0, lab.turnaround_minutes ?? 30, tenantId(req)
                        ], (insertErr) => {
                            if (insertErr && !failed) {
                                failed = true;
                                dbAdapter.run('ROLLBACK');
                                return res.status(500).json({ error: insertErr.message });
                            }
                            pending--;
                            if (pending === 0 && !failed) {
                                dbAdapter.run('COMMIT');
                                auditSuccess(req, {
                                    action: 'bulk_replace_case_labs',
                                    resourceType: 'case',
                                    resourceId: caseId,
                                    oldValue: { labs: oldLabs || [] },
                                    newValue: { labs },
                                    metadata: { inserted: labs.length }
                                });
                                res.json({ inserted: labs.length, message: 'Labs replaced' });
                            }
                        });
                    });
                }
            );
        });
    });
        }
    );
});

// PUT /api/cases/:caseId/labs/:labId - Update lab values (Admin only)
router.put('/cases/:caseId/labs/:labId', authenticateToken, requireEducator, (req, res) => {
    const { labId } = req.params;
    const { 
        current_value, 
        is_abnormal,
        min_value,
        max_value,
        turnaround_minutes
    } = req.body;
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (current_value !== undefined) {
        updates.push('current_value = ?');
        params.push(current_value);
    }
    if (is_abnormal !== undefined) {
        updates.push('is_abnormal = ?');
        params.push(is_abnormal ? 1 : 0);
    }
    if (min_value !== undefined) {
        updates.push('min_value = ?');
        params.push(min_value);
    }
    if (max_value !== undefined) {
        updates.push('max_value = ?');
        params.push(max_value);
    }
    if (turnaround_minutes !== undefined) {
        updates.push('turnaround_minutes = ?');
        params.push(turnaround_minutes);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(labId);
    const sql = `UPDATE case_investigations SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`;

    dbAdapter.get('SELECT * FROM case_investigations WHERE id = ? AND case_id = ? AND tenant_id = ? AND deleted_at IS NULL', [labId, req.params.caseId, tenantId(req)], (readErr, oldLab) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        if (!oldLab) return res.status(404).json({ error: 'Lab test not found' });

        dbAdapter.run(sql, [...params, tenantId(req)], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Lab test not found' });
            }
            auditSuccess(req, {
                action: 'update_case_lab_values',
                resourceType: 'case_lab',
                resourceId: labId,
                resourceName: oldLab.test_name,
                oldValue: oldLab,
                newValue: req.body,
                metadata: { case_id: req.params.caseId }
            });
            res.json({ message: 'Lab test updated' });
        });
    });
});

// DELETE /api/cases/:caseId/labs/:labId - Remove lab from case (Admin only)
//
// Stage-2 audit (deferred L6 from Stage 1): SQLite can't add ON DELETE CASCADE
// to an existing FK without a table rebuild, so dependent investigation_orders
// rows are cleaned up here in the application layer before the parent row is
// deleted. Otherwise GET /sessions/:id/lab-results would JOIN against missing
// case_investigations rows and either error or silently drop entries.
router.delete('/cases/:caseId/labs/:labId', authenticateToken, requireEducator, (req, res) => {
    const { labId, caseId } = req.params;

    dbAdapter.get('SELECT * FROM case_investigations WHERE id = ? AND case_id = ? AND tenant_id = ? AND deleted_at IS NULL', [labId, caseId, tenantId(req)], (readErr, oldLab) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        if (!oldLab) return res.status(404).json({ error: 'Lab test not found' });

    dbAdapter.serialize(() => {
        dbAdapter.run('BEGIN');
        // Regular `function` (not arrow) so SQLite binds `this.changes` for
        // the orphan-row count.
        dbAdapter.run(
            `DELETE FROM investigation_orders WHERE investigation_id = ?`,
            [labId],
            function (orphanErr) {
                if (orphanErr) {
                    dbAdapter.run('ROLLBACK');
                    return res.status(500).json({ error: orphanErr.message });
                }
                const orphans = this.changes ?? 0;
                dbAdapter.run(
                    `UPDATE case_investigations SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND case_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
                    [labId, caseId, tenantId(req)],
                    function (deleteErr) {
                        if (deleteErr) {
                            dbAdapter.run('ROLLBACK');
                            return res.status(500).json({ error: deleteErr.message });
                        }
                        if (this.changes === 0) {
                            dbAdapter.run('ROLLBACK');
                            return res.status(404).json({ error: 'Lab test not found' });
                        }
                        dbAdapter.run('COMMIT');
                        auditSuccess(req, {
                            action: 'delete_case_lab',
                            resourceType: 'case_lab',
                            resourceId: labId,
                            resourceName: oldLab.test_name,
                            oldValue: oldLab,
                            metadata: { case_id: caseId, orphan_orders_removed: orphans }
                        });
                        res.json({
                            message: 'Lab test removed from case',
                            orphan_orders_removed: orphans
                        });
                    }
                );
            }
        );
    });
    });
});

// GET /api/sessions/:sessionId/available-labs - Get available labs for session's case
router.get('/sessions/:sessionId/available-labs', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    
    // Get session + case_snapshot (preferred) + live config (fallback for
    // sessions written before the snapshot column existed).
    const sessionSql = `SELECT s.case_id, s.case_snapshot, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?`;

    dbAdapter.get(sessionSql, [sessionId], (err, session) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const caseConfig = resolveSessionCaseConfig(session);
        const defaultLabsEnabled = caseConfig.investigations?.defaultLabsEnabled !== false;
        
        // Get configured abnormal labs for this case
        const labsSql = `
            SELECT 
                id, test_name, test_group, gender_category,
                min_value, max_value, current_value, unit,
                normal_samples, is_abnormal, turnaround_minutes
            FROM case_investigations 
            WHERE case_id = ? AND deleted_at IS NULL AND investigation_type = 'lab'
            ORDER BY test_group, test_name
        `;
        
        dbAdapter.all(labsSql, [session.case_id], (err, dbConfiguredLabs) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // ALSO get labs from config JSON (case editor saves here)
            const configJsonLabs = caseConfig.investigations?.labs || [];

            // Merge: DB labs take precedence, then config JSON labs
            const configuredMap = {};

            // First add config JSON labs (with generated IDs)
            configJsonLabs.forEach(lab => {
                if (lab.test_name) {
                    configuredMap[lab.test_name] = {
                        id: lab.id || `config_${lab.test_name.replace(/[^a-zA-Z0-9]/g, '_')}`,
                        test_name: lab.test_name,
                        test_group: lab.test_group || 'General',
                        gender_category: lab.gender_category || 'Both',
                        min_value: lab.min_value,
                        max_value: lab.max_value,
                        current_value: lab.current_value,
                        unit: lab.unit || '',
                        normal_samples: lab.normal_samples || [],
                        is_abnormal: lab.is_abnormal || false,
                        turnaround_minutes: lab.turnaround_minutes || 30,
                        source: 'config'
                    };
                }
            });

            // Then DB labs override (they have proper IDs)
            dbConfiguredLabs.forEach(lab => {
                let normalSamples = [];
                try {
                    normalSamples = JSON.parse(lab.normal_samples || '[]');
                } catch (e) {
                    (req.log || routesOrdersLog).warn('lab normal_samples json parse failed', { test_name: lab.test_name, error: e.message });
                }
                configuredMap[lab.test_name] = {
                    ...lab,
                    normal_samples: normalSamples,
                    source: 'database'
                };
            });

            if (defaultLabsEnabled) {
                // Return ALL labs from database, with configured abnormals overriding normals
                const allLabs = labDb.loadLabDatabase();
                const patientGender = caseConfig.demographics?.gender || 'Male';
                
                // Get unique test names from database
                const uniqueTests = {};
                allLabs.forEach(test => {
                    if (!uniqueTests[test.test_name]) {
                        uniqueTests[test.test_name] = [];
                    }
                    uniqueTests[test.test_name].push(test);
                });
                
                // Build response with all tests
                const responseLabs = [];
                Object.entries(uniqueTests).forEach(([testName, variations]) => {
                    // Check if this test has a configured abnormal value
                    if (configuredMap[testName]) {
                        // Use configured abnormal value
                        const configLab = configuredMap[testName];
                        // normal_samples might be array (config JSON) or string (DB)
                        const normalSamples = Array.isArray(configLab.normal_samples)
                            ? configLab.normal_samples
                            : (typeof configLab.normal_samples === 'string' ? JSON.parse(configLab.normal_samples || '[]') : []);
                        responseLabs.push({
                            ...configLab,
                            normal_samples: normalSamples,
                            source: configLab.source || 'configured'
                        });
                    } else {
                        // Use default normal value from database
                        const genderSpecific = labDb.getGenderSpecificTest(testName, patientGender);
                        if (genderSpecific) {
                            const normalValue = labDb.getRandomNormalValue(genderSpecific);
                            responseLabs.push({
                                id: `default_${testName.replace(/[^a-zA-Z0-9]/g, '_')}`,
                                test_name: genderSpecific.test_name,
                                test_group: genderSpecific.group,
                                gender_category: genderSpecific.category,
                                min_value: genderSpecific.min_value,
                                max_value: genderSpecific.max_value,
                                current_value: normalValue,
                                unit: genderSpecific.unit,
                                normal_samples: genderSpecific.normal_samples,
                                is_abnormal: false,
                                turnaround_minutes: 30,
                                source: 'default'
                            });
                        }
                    }
                });
                
                res.json({ labs: responseLabs, defaultLabsEnabled: true });
            } else {
                // Only return configured labs (from both DB and config JSON)
                const allConfiguredLabs = Object.values(configuredMap);
                res.json({ labs: allConfiguredLabs, defaultLabsEnabled: false });
            }
        });
    });
});

// POST /api/sessions/:sessionId/order-labs - Order multiple lab tests
router.post('/sessions/:sessionId/order-labs', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { lab_ids, turnaround_override } = req.body; // Array of lab investigation IDs + optional turnaround override

    if (!Array.isArray(lab_ids) || lab_ids.length === 0) {
        return res.status(400).json({ error: 'lab_ids array is required' });
    }

    (req.log || routesOrdersLog).info('lab order request received', { session_id: sessionId, lab_ids, turnaround_override });

    // Verify session exists and user has access; pull snapshot in same query
    dbAdapter.get('SELECT user_id, case_id, case_snapshot FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Separate IDs by type
        const numericIds = lab_ids.filter(id => typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)));
        const defaultIds = lab_ids.filter(id => String(id).startsWith('default_'));
        const configIds = lab_ids.filter(id => String(id).startsWith('config_') || String(id).startsWith('lab_'));

        (req.log || routesOrdersLog).debug('lab order id breakdown', { numeric_count: numericIds.length, default_count: defaultIds.length, config_count: configIds.length });

        // Track IDs that need to be inserted as orders
        const configuredIds = [...numericIds.map(id => parseInt(id, 10))];

        // Get case config (snapshot-preferred) to determine patient gender and find config-based labs
        dbAdapter.get('SELECT config FROM cases WHERE id = ?', [session.case_id], (err, caseRow) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Merge: snapshot from session row + live config as fallback
            const caseConfig = resolveSessionCaseConfig({ case_snapshot: session.case_snapshot, config: caseRow?.config });
            const patientGender = caseConfig.demographics?.gender || 'Male';
            const configJsonLabs = caseConfig.investigations?.labs || [];

            // Get case-level timing settings
            const caseInstantResults = caseConfig.investigations?.instantResults === true;
            const caseDefaultTurnaround = caseConfig.investigations?.defaultTurnaround || 0;

            (req.log || routesOrdersLog).debug('lab order case config loaded', { instant_results: caseInstantResults, default_turnaround: caseDefaultTurnaround, config_lab_count: configJsonLabs.length });

            // Helper to get turnaround time (priority: instant/override > test default > case default)
            const getTurnaround = (testDefaultMinutes) => {
                // Instant results = 0 minutes (from case config)
                if (caseInstantResults) {
                    return 0;
                }
                // Request-level override (0 means instant, positive means that many minutes)
                if (turnaround_override !== null && turnaround_override !== undefined) {
                    if (turnaround_override === 0) {
                        return 0; // Instant results from request
                    }
                    if (turnaround_override > 0) {
                        return turnaround_override;
                    }
                }
                // Test default takes priority (individual lab turnaround times)
                if (testDefaultMinutes && testDefaultMinutes > 0) {
                    return testDefaultMinutes;
                }
                // Case-level default as fallback
                if (caseDefaultTurnaround > 0) {
                    return caseDefaultTurnaround;
                }
                // Final fallback
                return 30;
            };

            // Process all IDs and create orders
            //
            // Stage-2 audit: each lab is now idempotent on
            // (session_id, investigation_id) — a duplicate order request
            // returns the existing order row instead of inserting a new
            // row. Investigation_orders has no UNIQUE constraint (would
            // require a SQLite table rebuild) so the check lives here.
            const processOrders = () => {
                const insertSql = `
                    INSERT INTO investigation_orders (session_id, investigation_id, ordered_at, available_at)
                    VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' minutes'))
                `;
                const existsSql = `SELECT id FROM investigation_orders WHERE session_id = ? AND investigation_id = ? LIMIT 1`;

                let inserted = 0;
                let skipped = 0;
                const orderIds = [];

                // Get configured labs
                if (configuredIds.length > 0) {
                    const labsSql = `SELECT id, turnaround_minutes, test_name FROM case_investigations WHERE deleted_at IS NULL AND id IN (${configuredIds.map(() => '?').join(',')})`;

                    dbAdapter.all(labsSql, configuredIds, (err, labs) => {
                        if (err) {
                            (req.log || routesOrdersLog).error('labs fetch failed', { error: err.message });
                            return finalizeOrders();
                        }

                        // Track pending inserts
                        let pendingInserts = labs.length;
                        if (pendingInserts === 0) {
                            return finalizeOrders();
                        }

                        labs.forEach(lab => {
                            const turnaround = getTurnaround(lab.turnaround_minutes);
                            dbAdapter.get(existsSql, [sessionId, lab.id], (existsErr, existing) => {
                                if (existing && existing.id) {
                                    skipped++;
                                    pendingInserts--;
                                    if (pendingInserts === 0) finalizeOrders();
                                    return;
                                }
                                (req.log || routesOrdersLog).debug('ordering lab', { test_name: lab.test_name, turnaround_minutes: turnaround });
                                dbAdapter.run(insertSql, [sessionId, lab.id, turnaround], function(insertErr) {
                                    if (!insertErr) {
                                        orderIds.push({ id: this.lastID, test_name: lab.test_name, turnaround });
                                        inserted++;
                                    } else {
                                        (req.log || routesOrdersLog).error('lab order insert failed', { error: insertErr.message });
                                    }
                                    pendingInserts--;
                                    if (pendingInserts === 0) {
                                        finalizeOrders();
                                    }
                                });
                            });
                        });
                    });
                } else {
                    finalizeOrders();
                }

                function finalizeOrders() {
                    (req.log || routesOrdersLog).info('lab orders finalized', { inserted, orders: orderIds });

                    // Per-lab learning_events rows below are the canonical record;
                    // the legacy event_log dual-write was dropped in Phase 2 of
                    // PLAN_LOGGING.md (one row per ordered lab is more useful than
                    // one summary row anyway).

                    // Log detailed learning events for each ordered lab
                    const logSql = `
                        INSERT INTO learning_events (
                            session_id, user_id, case_id, verb, object_type, object_id, object_name,
                            component, result, context
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    orderIds.forEach(order => {
                        const turnaround = getTurnaround(30);
                        const context = {
                            turnaround_minutes: turnaround,
                            instant_results: caseInstantResults,
                            order_id: order.id
                        };

                        dbAdapter.run(logSql, [
                            sessionId,
                            req.user.id,
                            session.case_id,
                            'ORDERED_LAB',
                            'lab_test',
                            String(order.id),
                            order.test_name,
                            'OrdersDrawer',
                            `Turnaround: ${turnaround} min`,
                            JSON.stringify(context)
                        ]);
                    });

                    res.json({
                        message: `${inserted} lab tests ordered`,
                        orders: orderIds,
                        skipped_duplicates: skipped
                    });
                }
            };

            const insertLabSql = `
                INSERT INTO case_investigations (
                    case_id, investigation_type, test_name, test_group, gender_category,
                    min_value, max_value, current_value, unit, normal_samples,
                    is_abnormal, turnaround_minutes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            let pendingOps = 0;
            let completedOps = 0;

            const checkComplete = () => {
                if (completedOps >= pendingOps) {
                    processOrders();
                }
            };

            // Process config-based labs (from case editor config JSON)
            if (configIds.length > 0) {
                configIds.forEach(configId => {
                    // Find the lab in config JSON
                    const idStr = String(configId);
                    const testNameFromId = idStr.replace('config_', '').replace('lab_', '').replace(/_/g, ' ');

                    // Try to find by ID first, then by test name
                    let configLab = configJsonLabs.find(l => l.id === configId);
                    if (!configLab) {
                        configLab = configJsonLabs.find(l =>
                            l.test_name && l.test_name.toLowerCase().replace(/[^a-z0-9]/g, ' ').includes(testNameFromId.toLowerCase())
                        );
                    }

                    if (configLab) {
                        pendingOps++;
                        dbAdapter.run(insertLabSql, [
                            session.case_id, 'lab',
                            configLab.test_name,
                            configLab.test_group || 'General',
                            configLab.gender_category || 'Both',
                            configLab.min_value,
                            configLab.max_value,
                            configLab.current_value,
                            configLab.unit || '',
                            JSON.stringify(configLab.normal_samples || []),
                            configLab.is_abnormal ? 1 : 0,
                            getTurnaround(configLab.turnaround_minutes)
                        ], function(err) {
                            completedOps++;
                            if (!err) {
                                configuredIds.push(this.lastID);
                            } else {
                                (req.log || routesOrdersLog).error('config lab create failed', { error: err.message });
                            }
                            checkComplete();
                        });
                    }
                });
            }

            // Process default labs (from lab database with normal values)
            if (defaultIds.length > 0) {
                (req.log || routesOrdersLog).debug('processing default lab ids', { count: defaultIds.length });
                const testNames = defaultIds.map(id => String(id).replace('default_', '').replace(/_/g, ' '));

                testNames.forEach((testName, idx) => {
                    const genderSpecific = labDb.getGenderSpecificTest(testName, patientGender);
                    if (genderSpecific) {
                        pendingOps++;
                        const normalValue = labDb.getRandomNormalValue(genderSpecific);
                        (req.log || routesOrdersLog).debug('default lab resolved', { requested_test_name: testName, resolved_test_name: genderSpecific.test_name });

                        dbAdapter.run(insertLabSql, [
                            session.case_id, 'lab',
                            genderSpecific.test_name,
                            genderSpecific.group,
                            genderSpecific.category,
                            genderSpecific.min_value,
                            genderSpecific.max_value,
                            normalValue,
                            genderSpecific.unit,
                            JSON.stringify(genderSpecific.normal_samples),
                            0,
                            getTurnaround(30)
                        ], function(err) {
                            completedOps++;
                            if (!err) {
                                configuredIds.push(this.lastID);
                            } else {
                                (req.log || routesOrdersLog).error('default lab create failed', { error: err.message });
                            }
                            checkComplete();
                        });
                    } else {
                        (req.log || routesOrdersLog).warn('default lab not found', { test_name: testName, lab_id: defaultIds[idx] });
                    }
                });
            }

            // If no async ops needed, process immediately
            if (pendingOps === 0) {
                processOrders();
            }
        });
    });
});

// GET /api/sessions/:sessionId/lab-results - Get completed lab results
router.get('/sessions/:sessionId/lab-results', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    
    const sql = `
        SELECT 
            io.id as order_id,
            io.ordered_at,
            io.available_at,
            io.viewed_at,
            ci.id as lab_id,
            ci.test_name,
            ci.test_group,
            ci.unit,
            ci.current_value,
            ci.min_value,
            ci.max_value,
            ci.is_abnormal,
            ci.gender_category
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ? AND ci.investigation_type = 'lab'
        AND datetime(io.available_at) <= datetime('now')
        ORDER BY io.available_at DESC
    `;
    
    dbAdapter.all(sql, [sessionId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Evaluate each result
        const processedResults = results.map(result => ({
            ...result,
            status: labDb.evaluateValue(result.current_value, result.min_value, result.max_value),
            flag: labDb.getValueFlag(labDb.evaluateValue(result.current_value, result.min_value, result.max_value)),
            is_ready: true
        }));
        
        res.json({ results: processedResults });
    });
});

// PUT /api/sessions/:sessionId/labs/:labId - Instructor edit lab value during simulation (Admin only)
router.put('/sessions/:sessionId/labs/:labId', authenticateToken, requireEducator, async (req, res) => {
    const { sessionId, labId } = req.params;
    const { current_value } = req.body;

    if (current_value === undefined) {
        return res.status(400).json({ error: 'current_value is required' });
    }

    // Update the lab value in case_investigations
    const sql = `UPDATE case_investigations SET current_value = ?, is_abnormal = 1 WHERE id = ?`;

    dbAdapter.run(sql, [current_value, labId], async function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Lab test not found' });
        }

        // Log the instructor edit to learning_events (canonical xAPI store).
        // Trinity is server-derived from sessionId. Verb EDITED_LAB_VALUE is
        // attributed to the session owner (the student), with the editing
        // instructor recorded in context.instructor_id for offline auditing.
        const trinity = await resolveSessionTrinity(sessionId, tenantId(req));
        if (trinity.found) {
            dbAdapter.run(
                `INSERT INTO learning_events (
                    session_id, user_id, case_id, verb,
                    object_type, object_id, object_name,
                    component, result, context, severity, category, tenant_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    trinity.user_id,
                    trinity.case_id,
                    'EDITED_LAB_VALUE',
                    'lab',
                    String(labId),
                    `Lab ${labId}`,
                    'INSTRUCTOR_PANEL',
                    `value=${current_value}`,
                    JSON.stringify({ current_value, instructor_id: req.user.id }),
                    'IMPORTANT',
                    'CLINICAL',
                    tenantId(req),
                ],
                (insertErr) => {
                    if (insertErr) routesOrdersLog.warn('lab edit learning_events failed', { error: insertErr.message });
                }
            );
        } else {
            routesOrdersLog.warn('lab edit: session trinity not resolvable', { sessionId, labId });
        }

        res.json({
            message: 'Lab value updated',
            new_value: current_value
        });
    });
});

// --- RADIOLOGY ORDERING ENDPOINTS ---

// GET /api/radiology-database - Get master radiology database for case designer
router.get('/radiology-database', authenticateToken, (req, res) => {
    const { search, modality } = req.query;

    let filtered = radiologyDatabase;

    // Filter by search term
    if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(study =>
            study.name.toLowerCase().includes(searchLower) ||
            study.modality.toLowerCase().includes(searchLower) ||
            study.body_region.toLowerCase().includes(searchLower) ||
            (study.common_indications && study.common_indications.some(ind =>
                ind.toLowerCase().includes(searchLower)
            ))
        );
    }

    // Filter by modality
    if (modality && modality !== 'all') {
        filtered = filtered.filter(study => study.modality === modality);
    }

    // Get unique modalities for filter dropdown
    const modalities = [...new Set(radiologyDatabase.map(s => s.modality))].sort();

    res.json({
        studies: filtered,
        modalities,
        total: filtered.length,
        totalAvailable: radiologyDatabase.length
    });
});

// GET /api/sessions/:sessionId/available-radiology - Get available radiology studies
router.get('/sessions/:sessionId/available-radiology', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    // Get case config (snapshot-preferred) to include custom studies.
    dbAdapter.get(
        'SELECT s.case_snapshot, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?',
        [sessionId],
        (err, row) => {
            if (err) {
                (req.log || routesOrdersLog).error('case config fetch failed', { error: err.message });
                return res.json({
                    studies: radiologyDatabase,
                    groups: [...new Set(radiologyDatabase.map(s => s.modality))].sort(),
                    total: radiologyDatabase.length
                });
            }

            let allStudies = [...radiologyDatabase];

            const config = resolveSessionCaseConfig(row);
            const configuredRadiology = config.radiology || config.clinicalRecords?.radiology || [];

            configuredRadiology.forEach(cr => {
                if (cr.isCustom && cr.studyId) {
                    allStudies.push({
                        id: cr.studyId,
                        name: cr.studyName || 'Custom Study',
                        modality: cr.modality || 'Other',
                        body_region: cr.bodyRegion || '',
                        turnaround_minutes: cr.turnaroundMinutes || 30,
                        common_indications: [],
                        isCustom: true
                    });
                }
            });

            // Group by modality for easier display
            const groups = [...new Set(allStudies.map(s => s.modality))].sort();

            res.json({
                studies: allStudies,
                groups: groups,
                total: allStudies.length
            });
        }
    );
});

// GET /api/sessions/:sessionId/radiology-orders - Get radiology orders for session
router.get('/sessions/:sessionId/radiology-orders', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    const sql = `
        SELECT
            io.id,
            io.investigation_id as study_id,
            io.ordered_at,
            io.available_at,
            io.viewed_at,
            ci.test_name,
            ci.test_group as modality,
            ci.image_url,
            ci.result_data,
            ci.turnaround_minutes,
            CASE
                WHEN datetime(io.available_at) <= datetime('now') THEN 1
                ELSE 0
            END as is_ready,
            CASE
                WHEN datetime(io.available_at) > datetime('now')
                THEN ROUND((julianday(io.available_at) - julianday('now')) * 24 * 60, 1)
                ELSE 0
            END as minutes_remaining
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ? AND ci.investigation_type = 'radiology'
        ORDER BY io.ordered_at DESC
    `;

    dbAdapter.all(sql, [sessionId], (err, orders) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ orders: orders || [] });
    });
});

// POST /api/sessions/:sessionId/order-radiology - Order radiology studies
router.post('/sessions/:sessionId/order-radiology', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { radiology_ids, instant } = req.body;

    if (!Array.isArray(radiology_ids) || radiology_ids.length === 0) {
        return res.status(400).json({ error: 'radiology_ids array is required' });
    }

    // Verify session exists and get case config (snapshot-preferred)
    dbAdapter.get('SELECT s.user_id, s.case_id, s.case_snapshot, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const caseConfig = resolveSessionCaseConfig(session);
        // Check both new location (config.radiology) and old location (clinicalRecords.radiology)
        const configuredRadiology = caseConfig.radiology || caseConfig.clinicalRecords?.radiology || [];

        let inserted = 0;
        let skipped = 0;
        let pending = radiology_ids.length;
        const orderIds = [];

        if (pending === 0) {
            return res.json({ message: '0 radiology studies ordered', orders: [] });
        }

        // Stage-2 audit: radiology idempotency lives at (session_id, test_name)
        // because each order INSERTs a fresh case_investigations row to capture
        // result_data at order time (intentional — admin edits to result_data
        // between orders should reflect on the next order). UNIQUE on
        // investigation_orders(session_id, investigation_id) wouldn't catch
        // re-orders of the same study because investigation_id is always new.
        const existingRadSql = `
            SELECT io.id FROM investigation_orders io
            JOIN case_investigations ci ON io.investigation_id = ci.id
            WHERE io.session_id = ? AND ci.investigation_type = 'radiology' AND ci.test_name = ?
            LIMIT 1
        `;

        const finalize = () => {
            res.json({
                message: `${inserted} radiology studies ordered`,
                orders: orderIds,
                skipped_duplicates: skipped
            });
        };

        radiology_ids.forEach(radId => {
            // Check if this is a custom study (ID starts with "custom_")
            const isCustomStudy = typeof radId === 'string' && radId.startsWith('custom_');

            // Find study in radiology database by ID (for non-custom studies)
            const study = isCustomStudy ? null : radiologyDatabase.find(s => s.id === radId);

            // Check if this study has configured results in the case config
            const configuredResult = configuredRadiology.find(cr =>
                cr.studyId === radId ||
                (study && cr.studyName?.toLowerCase() === study.name?.toLowerCase()) ||
                (study && cr.type?.toLowerCase() === study.name?.toLowerCase())
            );

            // For custom studies, we MUST have a configured result
            if (!study && !configuredResult) {
                (req.log || routesOrdersLog).warn('radiology study not found and no config', { radiology_id: radId });
                pending--;
                if (pending === 0) finalize();
                return;
            }

            // Get study details from master database or configured result
            const testName = study?.name || configuredResult?.studyName || 'Unknown Study';
            const modality = study?.modality || configuredResult?.modality || 'Other';
            const bodyRegion = study?.body_region || configuredResult?.bodyRegion || '';
            const defaultTurnaround = study?.turnaround_minutes || 30;

            // Use configured turnaround time if available
            const configuredTurnaround = configuredResult?.turnaroundMinutes;
            const turnaround = instant ? 0 : (configuredTurnaround ?? defaultTurnaround);

            // Use configured findings/interpretation if available, otherwise use normal defaults from master database
            const findings = configuredResult?.findings || study?.normal_findings || '';
            const interpretation = configuredResult?.interpretation || study?.normal_interpretation || '';
            const imageUrl = configuredResult?.imageUrl || null;
            const videoUrl = configuredResult?.videoUrl || null;

            // Build result data including configured findings
            const resultData = {
                indications: study?.common_indications || [],
                body_region: bodyRegion,
                findings: findings,
                interpretation: interpretation,
                videoUrl: videoUrl,
                hasConfiguredResult: !!configuredResult,
                isCustomStudy: isCustomStudy,
                isNormalDefault: !configuredResult?.findings && !configuredResult?.interpretation && !!study?.normal_findings
            };

            // Idempotency: skip if this session already has an order for this
            // study (matched by test_name). Stage-2 audit fix.
            dbAdapter.get(existingRadSql, [sessionId, testName], (existsErr, existing) => {
                if (existing && existing.id) {
                    skipped++;
                    pending--;
                    if (pending === 0) finalize();
                    return;
                }

                // First insert into case_investigations
                const insertStudySql = `
                    INSERT INTO case_investigations (
                        case_id, investigation_type, test_name, test_group,
                        image_url, result_data, turnaround_minutes
                    ) VALUES (?, 'radiology', ?, ?, ?, ?, ?)
                `;

                dbAdapter.run(insertStudySql, [
                    session.case_id,
                    testName,
                    modality,
                    imageUrl,
                    JSON.stringify(resultData),
                    turnaround
                ], function(err) {
                    if (err) {
                        (req.log || routesOrdersLog).error('radiology study insert failed', { error: err.message });
                        pending--;
                        if (pending === 0) finalize();
                        return;
                    }

                    const investigationId = this.lastID;

                    // Now create the order
                    const orderSql = `
                        INSERT INTO investigation_orders (session_id, investigation_id, available_at)
                        VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
                    `;

                    dbAdapter.run(orderSql, [sessionId, investigationId, turnaround], function(orderErr) {
                        pending--;
                        if (!orderErr) {
                            inserted++;
                            orderIds.push(this.lastID);
                        }
                        if (pending === 0) finalize();
                    });
                });
            });
        });
    });
});

// ==================== TREATMENT MODULE API ENDPOINTS ====================

// GET /api/sessions/:sessionId/available-treatments - Get available treatments for session's case
router.get('/sessions/:sessionId/available-treatments', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { type } = req.query; // Optional filter: medication, iv_fluid, oxygen, nursing

    dbAdapter.get('SELECT s.case_id, s.case_snapshot, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const caseConfig = resolveSessionCaseConfig(session);

        // Get case-specific treatment configuration
        const treatmentConfig = caseConfig.treatments || {};

        // Get all treatment effects (master data) as available treatments
        let effectsSql = `SELECT * FROM treatment_effects WHERE is_active = 1`;
        const params = [];
        if (type) {
            effectsSql += ` AND treatment_type = ?`;
            params.push(type);
        }
        effectsSql += ` ORDER BY treatment_type, treatment_name`;

        dbAdapter.all(effectsSql, params, (err, effects) => {
            if (err) return res.status(500).json({ error: err.message });

            // Get case-specific treatments (restrictions/expected)
            dbAdapter.all(`SELECT * FROM case_treatments WHERE case_id = ?`, [session.case_id], (err, caseTreatments) => {
                if (err) return res.status(500).json({ error: err.message });

                // Build treatment map with case-specific overrides
                const caseTreatmentMap = {};
                caseTreatments.forEach(ct => {
                    caseTreatmentMap[`${ct.treatment_type}:${ct.treatment_name}`] = ct;
                });

                // Merge master data with case-specific configuration
                const treatments = effects.map(effect => {
                    const key = `${effect.treatment_type}:${effect.treatment_name}`;
                    const caseOverride = caseTreatmentMap[key];

                    return {
                        ...effect,
                        is_available: caseOverride?.is_available ?? true,
                        is_expected: caseOverride?.is_expected ?? false,
                        is_contraindicated: caseOverride?.is_contraindicated ?? false,
                        points_if_ordered: caseOverride?.points_if_ordered ?? 0,
                        feedback_if_ordered: caseOverride?.feedback_if_ordered ?? null,
                        feedback_if_missed: caseOverride?.feedback_if_missed ?? null,
                        custom_effect_override: caseOverride?.custom_effect_override ? JSON.parse(caseOverride.custom_effect_override) : null
                    };
                });

                // Group by type - use treatment_type values as keys for consistency
                const grouped = {
                    medication: treatments.filter(t => t.treatment_type === 'medication'),
                    iv_fluid: treatments.filter(t => t.treatment_type === 'iv_fluid'),
                    oxygen: treatments.filter(t => t.treatment_type === 'oxygen'),
                    nursing: treatments.filter(t => t.treatment_type === 'nursing')
                };

                res.json({
                    treatments: type ? treatments : grouped,
                    config: treatmentConfig
                });
            });
        });
    });
});

// POST /api/sessions/:sessionId/order-treatment - Order a treatment
router.post('/sessions/:sessionId/order-treatment', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const {
        treatment_type,
        treatment_name,
        medication_id,
        dose,
        dose_value,
        dose_unit,
        route,
        frequency,
        rate,
        rate_value,
        rate_unit,
        duration_minutes,
        urgency = 'routine',
        notes
    } = req.body;

    if (!treatment_type || !treatment_name) {
        return res.status(400).json({ error: 'treatment_type and treatment_name are required' });
    }

    // Verify session and access (snapshot-aware select for downstream config)
    dbAdapter.get('SELECT s.user_id, s.case_id, s.case_snapshot, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check for contraindication
        dbAdapter.get(`SELECT * FROM case_treatments WHERE case_id = ? AND treatment_type = ? AND treatment_name = ?`,
            [session.case_id, treatment_type, treatment_name], (err, caseConfig) => {
            if (err) return res.status(500).json({ error: err.message });

            const isContraindicated = caseConfig?.is_contraindicated ?? false;
            const isExpected = caseConfig?.is_expected ?? false;
            const pointsIfOrdered = caseConfig?.points_if_ordered ?? 0;
            const feedback = caseConfig?.feedback_if_ordered ?? null;

            // Get treatment effect data
            dbAdapter.get(`SELECT * FROM treatment_effects WHERE treatment_type = ? AND treatment_name = ? AND is_active = 1`,
                [treatment_type, treatment_name], (err, effect) => {
                if (err) return res.status(500).json({ error: err.message });

                const isHighAlert = effect?.treatment_name?.match(/epinephrine|norepinephrine|insulin|heparin|morphine|fentanyl|propofol/i) !== null;

                // Insert the order
                const insertSql = `
                    INSERT INTO treatment_orders (
                        session_id, treatment_type, medication_id, treatment_item,
                        dose, dose_value, dose_unit, route, frequency,
                        rate, rate_value, rate_unit, duration_minutes,
                        urgency, is_high_alert, notes, feedback, points_awarded
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                dbAdapter.run(insertSql, [
                    sessionId, treatment_type, medication_id || null, treatment_name,
                    dose || null, dose_value || null, dose_unit || null,
                    route || effect?.route || null, frequency || null,
                    rate || null, rate_value || null, rate_unit || null,
                    duration_minutes || null, urgency, isHighAlert ? 1 : 0,
                    notes || null, feedback, isExpected ? pointsIfOrdered : 0
                ], function(err) {
                    if (err) return res.status(500).json({ error: err.message });

                    const orderId = this.lastID;

                    // Log to audit
                    logAudit({
                        userId: req.user.id,
                        username: req.user.username,
                        action: 'ORDERED_TREATMENT',
                        resourceType: 'treatment_order',
                        resourceId: orderId,
                        resourceName: treatment_name,
                        sessionId: parseInt(sessionId),
                        metadata: { treatment_type, dose, route, urgency, isContraindicated, isExpected }
                    });

                    res.status(201).json({
                        message: 'Treatment ordered successfully',
                        order_id: orderId,
                        treatment_name,
                        treatment_type,
                        is_contraindicated: isContraindicated,
                        contraindication_feedback: isContraindicated ? feedback : null,
                        is_expected: isExpected,
                        points_awarded: isExpected ? pointsIfOrdered : 0,
                        is_high_alert: isHighAlert,
                        effect: effect ? {
                            onset_minutes: effect.onset_minutes,
                            peak_minutes: effect.peak_minutes,
                            duration_minutes: effect.duration_minutes
                        } : null
                    });
                });
            });
        });
    });
});

// POST /api/sessions/:sessionId/administer/:orderId - Administer an ordered treatment
//
// Hardened 2026-05-07 after a production nginx-502 incident. The route is
// callback-shaped (legacy sqlite3 style); previously, ANY synchronous throw
// inside a callback (e.g. `.includes` on a NULL field, NaN arithmetic on a
// missing effect column) would land in the global uncaughtException handler
// without ever firing res.json — leaving the request hanging until nginx's
// proxy_read_timeout fired a 502 to the client.
//
// Defensive contract: every callback wraps its body in try/catch + sendError,
// every numeric read is coerced via num(), every string membership check is
// guarded with optional chaining. Even a malformed treatment_effects row
// must produce a JSON response, never a hang.
router.post('/sessions/:sessionId/administer/:orderId', authenticateToken, (req, res) => {
    const { sessionId, orderId } = req.params;

    // Coerce arbitrary DB values (strings, nulls, bools, NaN) to a finite
    // number; fall back to `fb` otherwise. Used everywhere we multiply or
    // compare a treatment_effects column.
    const num = (v, fb = 0) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fb;
    };

    // Last-ditch error responder. If we've already started writing the
    // response, just end the connection — JSON would be invalid mid-stream.
    const sendError = (status, error, ctx = {}) => {
        routesOrdersLog.warn('administer route error', { status, error, sessionId, orderId, ...ctx });
        if (res.headersSent) {
            try { res.end(); } catch { /* noop */ }
            return;
        }
        try {
            res.status(status).json({ error: typeof error === 'string' ? error : (error?.message || 'request failed') });
        } catch { /* noop */ }
    };

    // Verify session and order
    dbAdapter.get(`SELECT t.*, s.user_id, s.case_id FROM treatment_orders t
            JOIN sessions s ON t.session_id = s.id
            WHERE t.id = ? AND t.session_id = ?`, [orderId, sessionId], (err, order) => {
        try {
            if (err) return sendError(500, err);
            if (!order) return sendError(404, 'Order not found');
            if (order.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
                return sendError(403, 'Access denied');
            }
            if (order.status !== 'ordered') {
                return sendError(400, `Cannot administer order with status: ${order.status}`);
            }
        } catch (e) {
            return sendError(500, e, { phase: 'order-validate' });
        }

        // Get treatment effect
        dbAdapter.get(`SELECT * FROM treatment_effects WHERE treatment_type = ? AND treatment_name = ? AND is_active = 1`,
            [order.treatment_type, order.treatment_item], (err, effect) => {
            let isContinuous, now;
            try {
                if (err) return sendError(500, err, { phase: 'effect-lookup' });

                now = new Date().toISOString();
                // Optional-chained `.includes` guards against treatment_item
                // being NULL — that was an unguarded throw in the old code.
                isContinuous = order.treatment_type === 'oxygen'
                    || (order.treatment_type === 'nursing' && (order.treatment_item || '').includes('Position'))
                    || (num(effect?.duration_minutes, 0) === -1);
            } catch (e) {
                return sendError(500, e, { phase: 'effect-classify' });
            }

            // Update order status
            dbAdapter.run(`UPDATE treatment_orders SET status = ?, administered_at = ? WHERE id = ?`,
                [isContinuous ? 'in_progress' : 'administered', now, orderId], (err) => {
                if (err) return sendError(500, err, { phase: 'order-update' });

                // No effect row → respond without active_treatments insert.
                if (!effect) {
                    try {
                        return res.json({
                            message: 'Treatment administered (no effect data)',
                            order_id: parseInt(orderId),
                            treatment_name: order.treatment_item,
                            status: isContinuous ? 'in_progress' : 'administered',
                            administered_at: now,
                            effect_active: false
                        });
                    } catch (e) {
                        return sendError(500, e, { phase: 'respond-no-effect' });
                    }
                }

                // Build active_treatment payload — every numeric field is
                // coerced via num() so a NULL/string/NaN column can't crash
                // the route. Matches the old maths exactly when columns are
                // already numeric.
                let payload;
                try {
                    let doseMultiplier = 1.0;
                    const baseDose = num(effect.base_dose, 0);
                    const doseValue = num(order.dose_value, 0);
                    if (effect.dose_dependent && baseDose > 0 && doseValue > 0) {
                        doseMultiplier = Math.min(doseValue / baseDose, num(effect.max_effect_multiplier, 2.0));
                    }
                    if (!Number.isFinite(doseMultiplier)) doseMultiplier = 1.0;

                    let expiresAt = null;
                    const durationMin = num(effect.duration_minutes, 0);
                    if (!isContinuous && durationMin > 0) {
                        const expireDate = new Date();
                        expireDate.setMinutes(expireDate.getMinutes() + durationMin);
                        expiresAt = expireDate.toISOString();
                    }

                    const peak = (key) => Math.round(num(effect[key], 0) * doseMultiplier);

                    payload = {
                        sessionId,
                        orderId,
                        effectId: effect.id,
                        now,
                        doseMultiplier,
                        peak_hr: peak('hr_effect'),
                        peak_bp_sys: peak('bp_sys_effect'),
                        peak_bp_dia: peak('bp_dia_effect'),
                        peak_rr: peak('rr_effect'),
                        peak_spo2: peak('spo2_effect'),
                        peak_temp: num(effect.temp_effect, 0) * doseMultiplier,
                        expiresAt,
                        isContinuous: isContinuous ? 1 : 0,
                    };
                } catch (e) {
                    return sendError(500, e, { phase: 'effect-compute' });
                }

                const insertEffectSql = `
                    INSERT INTO active_treatments (
                        session_id, treatment_order_id, effect_id, started_at,
                        phase, current_effect_strength, dose_multiplier,
                        peak_hr_effect, peak_bp_sys_effect, peak_bp_dia_effect,
                        peak_rr_effect, peak_spo2_effect, peak_temp_effect,
                        expires_at, is_continuous
                    ) VALUES (?, ?, ?, ?, 'onset', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                dbAdapter.run(insertEffectSql, [
                    payload.sessionId, payload.orderId, payload.effectId, payload.now,
                    payload.doseMultiplier,
                    payload.peak_hr, payload.peak_bp_sys, payload.peak_bp_dia,
                    payload.peak_rr, payload.peak_spo2, payload.peak_temp,
                    payload.expiresAt, payload.isContinuous,
                ], function(err) {
                    // active_treatments insert failure is non-fatal — the
                    // order is already marked administered. Log and respond
                    // 200 with effect_active: true; the engine will skip
                    // this order on its next tick because no row exists.
                    if (err) {
                        routesOrdersLog.warn('active treatment effect create failed', {
                            error: err.message, sessionId, orderId,
                        });
                    }

                    try {
                        res.json({
                            message: 'Treatment administered',
                            order_id: parseInt(orderId),
                            treatment_name: order.treatment_item,
                            status: isContinuous ? 'in_progress' : 'administered',
                            administered_at: now,
                            effect_active: !err,
                            active_treatment_id: this?.lastID,
                            effect_details: {
                                onset_minutes: num(effect.onset_minutes, 0),
                                peak_minutes: num(effect.peak_minutes, 0),
                                duration_minutes: num(effect.duration_minutes, 0),
                                is_continuous: isContinuous,
                                hr_effect: payload.peak_hr,
                                bp_sys_effect: payload.peak_bp_sys,
                                bp_dia_effect: payload.peak_bp_dia,
                                rr_effect: payload.peak_rr,
                                spo2_effect: payload.peak_spo2,
                            }
                        });
                    } catch (e) {
                        return sendError(500, e, { phase: 'respond-with-effect' });
                    }
                });
            });
        });
    });
});

// PUT /api/sessions/:sessionId/discontinue/:orderId - Discontinue a treatment
router.put('/sessions/:sessionId/discontinue/:orderId', authenticateToken, (req, res) => {
    const { sessionId, orderId } = req.params;

    dbAdapter.get(`SELECT t.*, s.user_id FROM treatment_orders t
            JOIN sessions s ON t.session_id = s.id
            WHERE t.id = ? AND t.session_id = ?`, [orderId, sessionId], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.user_id !== req.user.id && !hasRoleAtLeast(req.user, ROLE_RANKS.educator)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const now = new Date().toISOString();

        // Update order status
        dbAdapter.run(`UPDATE treatment_orders SET status = 'discontinued', discontinued_at = ? WHERE id = ?`,
            [now, orderId], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Mark active treatment as expired
            dbAdapter.run(`UPDATE active_treatments SET phase = 'expired', expires_at = ? WHERE treatment_order_id = ?`,
                [now, orderId], (err) => {
                if (err) routesOrdersLog.warn('active treatment expire failed', { error: err.message });

                res.json({
                    message: 'Treatment discontinued',
                    order_id: parseInt(orderId),
                    discontinued_at: now
                });
            });
        });
    });
});

// GET /api/sessions/:sessionId/treatment-orders - Get all treatment orders for session
router.get('/sessions/:sessionId/treatment-orders', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { status } = req.query;

    dbAdapter.get('SELECT user_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        let sql = `SELECT * FROM treatment_orders WHERE session_id = ?`;
        const params = [sessionId];
        if (status) {
            sql += ` AND status = ?`;
            params.push(status);
        }
        sql += ` ORDER BY ordered_at DESC`;

        dbAdapter.all(sql, params, (err, orders) => {
            if (err) return res.status(500).json({ error: err.message });

            res.json({ orders });
        });
    });
});

// GET /api/sessions/:sessionId/active-effects - Get current active treatment effects
router.get('/sessions/:sessionId/active-effects', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    dbAdapter.get('SELECT user_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Get all active (non-expired) treatments
        const sql = `
            SELECT
                at.*,
                t.treatment_item, t.treatment_type, t.dose, t.route,
                te.onset_minutes, te.peak_minutes, te.duration_minutes, te.description
            FROM active_treatments at
            JOIN treatment_orders t ON at.treatment_order_id = t.id
            LEFT JOIN treatment_effects te ON at.effect_id = te.id
            WHERE at.session_id = ? AND at.phase != 'expired'
            ORDER BY at.started_at DESC
        `;

        dbAdapter.all(sql, [sessionId], (err, activeEffects) => {
            if (err) return res.status(500).json({ error: err.message });

            const now = new Date();

            // Calculate current effect strength for each treatment
            const effectsWithStrength = activeEffects.map(effect => {
                const startedAt = new Date(effect.started_at);
                const elapsedMinutes = (now - startedAt) / 60000;

                let phase = 'onset';
                let strength = 0;

                if (effect.is_continuous || effect.duration_minutes === -1) {
                    // Continuous treatments maintain peak effect
                    if (elapsedMinutes >= effect.peak_minutes) {
                        phase = 'peak';
                        strength = 1.0;
                    } else if (elapsedMinutes >= effect.onset_minutes) {
                        phase = 'peak';
                        strength = 1.0;
                    } else {
                        phase = 'onset';
                        strength = elapsedMinutes / effect.onset_minutes;
                    }
                } else {
                    // Calculate phase based on elapsed time
                    if (elapsedMinutes < effect.onset_minutes) {
                        phase = 'onset';
                        strength = elapsedMinutes / effect.onset_minutes;
                    } else if (elapsedMinutes < effect.peak_minutes) {
                        phase = 'peak';
                        strength = 1.0;
                    } else if (elapsedMinutes < effect.duration_minutes) {
                        phase = 'decline';
                        const declineProgress = (elapsedMinutes - effect.peak_minutes) / (effect.duration_minutes - effect.peak_minutes);
                        strength = Math.exp(-3 * declineProgress); // Exponential decay
                    } else {
                        phase = 'expired';
                        strength = 0;
                    }
                }

                return {
                    ...effect,
                    current_phase: phase,
                    current_strength: Math.max(0, Math.min(1, strength)),
                    elapsed_minutes: elapsedMinutes,
                    current_hr_effect: Math.round(effect.peak_hr_effect * strength),
                    current_bp_sys_effect: Math.round(effect.peak_bp_sys_effect * strength),
                    current_bp_dia_effect: Math.round(effect.peak_bp_dia_effect * strength),
                    current_rr_effect: Math.round(effect.peak_rr_effect * strength),
                    current_spo2_effect: Math.round(effect.peak_spo2_effect * strength),
                    current_temp_effect: effect.peak_temp_effect * strength
                };
            });

            // Calculate aggregate effects
            const aggregateEffects = effectsWithStrength.reduce((acc, effect) => {
                acc.hr_effect += effect.current_hr_effect || 0;
                acc.bp_sys_effect += effect.current_bp_sys_effect || 0;
                acc.bp_dia_effect += effect.current_bp_dia_effect || 0;
                acc.rr_effect += effect.current_rr_effect || 0;
                acc.spo2_effect += effect.current_spo2_effect || 0;
                acc.temp_effect += effect.current_temp_effect || 0;
                return acc;
            }, {
                hr_effect: 0,
                bp_sys_effect: 0,
                bp_dia_effect: 0,
                rr_effect: 0,
                spo2_effect: 0,
                temp_effect: 0
            });

            res.json({
                active_treatments: effectsWithStrength,
                aggregate_effects: aggregateEffects,
                treatment_count: effectsWithStrength.length
            });
        });
    });
});

// PUT /api/cases/:caseId/treatments - Configure case treatments (admin)
router.put('/cases/:caseId/treatments', authenticateToken, requireEducator, (req, res) => {
    const { caseId } = req.params;
    const { treatments } = req.body;

    if (!Array.isArray(treatments)) {
        return res.status(400).json({ error: 'treatments array is required' });
    }

    // Verify case exists
    dbAdapter.get('SELECT id FROM cases WHERE id = ?', [caseId], (err, caseRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!caseRow) return res.status(404).json({ error: 'Case not found' });

        dbAdapter.all('SELECT * FROM case_treatments WHERE case_id = ?', [caseId], (readErr, oldTreatments) => {
            if (readErr) return res.status(500).json({ error: readErr.message });

        // Delete existing case treatments and insert new ones
        dbAdapter.run('DELETE FROM case_treatments WHERE case_id = ?', [caseId], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            if (treatments.length === 0) {
                auditSuccess(req, {
                    action: 'configure_case_treatments',
                    resourceType: 'case',
                    resourceId: caseId,
                    oldValue: { treatments: oldTreatments || [] },
                    newValue: { treatments: [] },
                    metadata: { treatment_count: 0 }
                });
                return res.json({ message: 'Case treatments cleared', count: 0 });
            }

            const insertSql = `
                INSERT INTO case_treatments (
                    case_id, treatment_type, medication_id, treatment_name,
                    is_available, is_expected, is_contraindicated,
                    points_if_ordered, feedback_if_ordered, feedback_if_missed,
                    custom_effect_override
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            let inserted = 0;
            let pending = treatments.length;

            treatments.forEach(t => {
                dbAdapter.run(insertSql, [
                    caseId,
                    t.treatment_type,
                    t.medication_id || null,
                    t.treatment_name,
                    t.is_available ?? 1,
                    t.is_expected ?? 0,
                    t.is_contraindicated ?? 0,
                    t.points_if_ordered ?? 0,
                    t.feedback_if_ordered || null,
                    t.feedback_if_missed || null,
                    t.custom_effect_override ? JSON.stringify(t.custom_effect_override) : null
                ], function(err) {
                    if (!err) inserted++;
                    pending--;
                    if (pending === 0) {
                        logAudit({
                            userId: req.user.id,
                            username: req.user.username,
                            action: 'configure_case_treatments',
                            resourceType: 'case',
                            resourceId: caseId,
                            oldValue: { treatments: oldTreatments || [] },
                            newValue: { treatments },
                            metadata: { treatment_count: inserted }
                        });
                        res.json({ message: `Case treatments configured`, count: inserted });
                    }
                });
            });
        });
        });
    });
});

// GET /api/treatment-effects - Get all treatment effects (master data)
router.get('/treatment-effects', authenticateToken, (req, res) => {
    const { type } = req.query;

    let sql = 'SELECT * FROM treatment_effects WHERE is_active = 1';
    const params = [];
    if (type) {
        sql += ' AND treatment_type = ?';
        params.push(type);
    }
    sql += ' ORDER BY treatment_type, treatment_name';

    dbAdapter.all(sql, params, (err, effects) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ effects });
    });
});

// ---------------------------------------------------------------------------
// Observability slice: routes — LLM + TTS.
// Upstream LLM/TTS selection, failures, and usage logs are structured and
// request-correlated when a request logger is available.
// ---------------------------------------------------------------------------
// --- LLM PROXY ROUTE with Authentication & Rate Limiting ---

// Pull a safe, user-facing message out of an upstream LLM error body. Anthropic
// and OpenAI both surface { error: { message } } on 4xx/5xx; passing the raw
// body back leaks request structure (and on rare misconfig, partial keys
// echoed in error context). Falls back to a generic string when the body is
// not parseable JSON.

export default router;
