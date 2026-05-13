// Tiered drug + lab catalogue routes (Session 2 of the catalogue plan).
//
// Mounted at `/api/catalogue`. The legacy `/api/master/medications` and
// `/api/master/lab-tests` routes in server/routes.js stay untouched —
// the Session 3 UI lift will migrate consumers off them. Until then, the
// two surfaces coexist:
//
//   /api/master/*    — legacy, educator+ only, scope-blind, kept for
//                      back-compat with the existing settings UI.
//   /api/catalogue/* — Session 2, scope-aware, students can add to their
//                      own scope, search proxies live here.
//
// The scope model (per the locked plan):
//   platform — visible to all tenants. Created only via /promote (admin).
//   tenant   — visible to all users in same tenant. Created by educator+.
//   user     — visible only to creator. Default scope for everyone.
//   session  — transient, cleaned at session end. Anyone may create.
//
// Authorization for edit/delete: row.created_by === user.id, OR
// (row.scope === 'tenant' AND user is educator+ in same tenant), OR
// (row.scope === 'platform' AND user is admin). Enforced in canMutate().

import express from 'express';
import dbAdapter from '../dbAdapter.js';
import {
    authenticateToken,
    requireAdmin,
    ROLE_RANKS,
    getRoleRank,
    hasRoleAtLeast,
} from '../middleware/auth.js';
import { searchRxNorm } from '../services/rxnormProxy.js';
import { searchOpenFda } from '../services/openfdaProxy.js';
import { searchLoinc } from '../services/loincProxy.js';
import { logger } from '../logger.js';
import { appendAuditEntry } from '../audit-chain.js';
import { DEFAULT_TURNAROUND_MINUTES } from '../lib/turnaround.js';

const router = express.Router();
const catalogueLog = logger('catalogue');

// ------------------------------ helpers --------------------------------

const VALID_SCOPES = new Set(['platform', 'tenant', 'user', 'session']);

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) =>
        dbAdapter.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) =>
        dbAdapter.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) =>
        dbAdapter.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

// Audit helper local to this file. Mirrors the shape used by
// server/routes.js logAudit() but uses the dbRun promise wrapper above so
// it's awaitable inside async routes. Failure is logged + swallowed —
// audit issues should never block the user's mutation from succeeding.
async function audit(req, params) {
    try {
        await appendAuditEntry({
            userId: req.user?.id ?? null,
            username: req.user?.username ?? null,
            action: params.action,
            resourceType: params.resourceType ?? null,
            resourceId: params.resourceId != null ? String(params.resourceId) : null,
            resourceName: params.resourceName ?? null,
            oldValue: params.oldValue ? JSON.stringify(params.oldValue) : null,
            newValue: params.newValue ? JSON.stringify(params.newValue) : null,
            ipAddress: req.ip ?? null,
            userAgent: req.headers?.['user-agent'] ?? null,
            status: params.status ?? 'success',
            metadata: params.metadata ? JSON.stringify(params.metadata) : null,
            tenantId: req.user?.tenant_id ?? 1,
        });
    } catch (err) {
        (req.log || catalogueLog).warn('catalogue audit write failed', {
            action: params.action,
            error: err.message
        });
    }
}

// Decide the authoritative scope for a write. Pin to 'user' unless the
// caller has rank to elevate. Platform-scope is NEVER granted by this
// path — must use POST /:id/promote (admin only).
function determineScope(user, requestedScope) {
    const requested = requestedScope || 'user';
    if (!VALID_SCOPES.has(requested)) {
        const err = new Error(`Invalid scope: ${requestedScope}`);
        err.status = 400;
        throw err;
    }
    if (requested === 'session' || requested === 'user') return requested;
    if (requested === 'tenant') {
        if (hasRoleAtLeast(user, ROLE_RANKS.educator)) return 'tenant';
        const err = new Error('Tenant scope requires educator role or higher');
        err.status = 403;
        throw err;
    }
    if (requested === 'platform') {
        const err = new Error('Platform scope is granted only via /promote (admin)');
        err.status = 403;
        throw err;
    }
    // Should not reach here.
    return 'user';
}

// Filter clause + params for "rows visible to this user". Excludes
// soft-deleted rows when the table has a deleted_at column (medications
// does; lab_tests does not in current schema).
function visibilityClause(user, { hasDeletedAt = false, alias = '' } = {}) {
    const a = alias ? `${alias}.` : '';
    const clauses = [
        `${a}scope = 'platform'`,
        `(${a}scope = 'tenant' AND ${a}tenant_id = ?)`,
        `(${a}scope = 'user' AND ${a}created_by = ?)`,
    ];
    const params = [user.tenant_id ?? 1, user.id];
    let where = `(${clauses.join(' OR ')})`;
    if (hasDeletedAt) where += ` AND ${a}deleted_at IS NULL`;
    return { where, params };
}

function canMutate(user, row) {
    if (!user || !row) return false;
    if (row.created_by === user.id) return true;
    if (row.scope === 'tenant' && row.tenant_id === (user.tenant_id ?? 1)
        && hasRoleAtLeast(user, ROLE_RANKS.educator)) return true;
    if (row.scope === 'platform' && hasRoleAtLeast(user, ROLE_RANKS.admin)) return true;
    return false;
}

// Determine the data_sources row to attribute new rows to, based on the
// creator's role. Curated rows are stamped at seed time and don't go
// through here.
async function dataSourceIdFor(user) {
    const rank = getRoleRank(user);
    let key;
    if (rank >= ROLE_RANKS.admin) key = 'admin';
    else if (rank >= ROLE_RANKS.educator) key = 'educator';
    else key = 'student';
    const row = await dbGet('SELECT id FROM data_sources WHERE source_key = ?', [key]);
    return row?.id ?? null;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
        const status = err.status || 500;
        if (!res.headersSent) res.status(status).json({ error: err.message });
        else next(err);
    });
}

// =========================================================================
//  MEDICATIONS
// =========================================================================

// GET /api/catalogue/medications
//   Query params: scope (filter), q (substring), limit, offset.
//   Returns rows visible to the caller per visibility clause.
router.get('/medications', authenticateToken, asyncHandler(async (req, res) => {
    const { scope, q, limit = 200, offset = 0 } = req.query;
    const { where, params } = visibilityClause(req.user, { hasDeletedAt: true });

    let sql = `SELECT m.*, s.source_key AS data_source_key
               FROM medications m
               LEFT JOIN data_sources s ON s.id = m.data_source_id
               WHERE ${where} AND m.is_active = 1`;
    const sqlParams = [...params];

    if (scope) {
        if (!VALID_SCOPES.has(scope)) {
            return res.status(400).json({ error: `Invalid scope: ${scope}` });
        }
        sql += ` AND m.scope = ?`;
        sqlParams.push(scope);
    }
    if (q) {
        sql += ` AND (m.generic_name LIKE ? OR m.brand_names LIKE ? OR m.medication_code LIKE ?)`;
        sqlParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY m.is_curated DESC, m.generic_name LIMIT ? OFFSET ?`;
    sqlParams.push(parseInt(limit), parseInt(offset));

    const rows = await dbAll(sql, sqlParams);
    res.json({ medications: rows, count: rows.length });
}));

// POST /api/catalogue/medications
//   Anyone authenticated. Server pins scope per role rules.
router.post('/medications', authenticateToken, asyncHandler(async (req, res) => {
    const {
        generic_name, brand_names, drug_class, category, route, typical_dose, dose_unit,
        frequency, indications, contraindications, side_effects, rxcui, ndc_primary,
        atc_code, openfda_setid, boxed_warning, external_source, external_id,
        scope: requestedScope,
    } = req.body || {};
    if (!generic_name || !generic_name.trim()) {
        return res.status(400).json({ error: 'generic_name is required' });
    }
    const scope = determineScope(req.user, requestedScope);
    const dataSourceId = await dataSourceIdFor(req.user);

    // Synthesise medication_code if absent. Scope-aware so user-scoped rows
    // for the same drug name don't collide with platform-scoped ones.
    const code = (req.body.medication_code
        || `${scope}-${req.user.id}-${generic_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`).slice(0, 64);

    const result = await dbRun(
        `INSERT INTO medications (
            medication_code, generic_name, brand_names, drug_class, category, route,
            typical_dose, dose_unit, frequency, indications, contraindications, side_effects,
            rxcui, ndc_primary, atc_code, openfda_setid, boxed_warning,
            external_source, external_id, is_curated, scope, tenant_id, created_by, data_source_id, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)`,
        [
            code, generic_name.trim(), JSON.stringify(brand_names || []), drug_class || null,
            category || 'custom', route || null, typical_dose || null, dose_unit || null,
            frequency || null, JSON.stringify(indications || []),
            JSON.stringify(contraindications || []), JSON.stringify(side_effects || []),
            rxcui || null, ndc_primary || null, atc_code || null, openfda_setid || null,
            boxed_warning || null, external_source || null, external_id || null,
            scope, req.user.tenant_id ?? 1, req.user.id, dataSourceId,
        ]
    );
    await audit(req, {
        action: 'create_catalogue_medication',
        resourceType: 'medication',
        resourceId: result.lastID,
        resourceName: generic_name.trim(),
        newValue: { scope, external_source: external_source || null, rxcui: rxcui || null },
    });
    res.status(201).json({ id: result.lastID, scope, message: 'Medication added' });
}));

// PUT /api/catalogue/medications/:id  — owner / educator-tenant / admin only.
router.put('/medications/:id', authenticateToken, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await dbGet('SELECT * FROM medications WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return res.status(404).json({ error: 'Medication not found' });
    if (!canMutate(req.user, row)) return res.status(403).json({ error: 'Not authorized to edit this medication' });

    const allowed = ['generic_name', 'brand_names', 'drug_class', 'category', 'route',
        'typical_dose', 'dose_unit', 'frequency', 'indications', 'contraindications',
        'side_effects', 'rxcui', 'ndc_primary', 'atc_code', 'boxed_warning'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            const v = ['brand_names', 'indications', 'contraindications', 'side_effects'].includes(key)
                ? JSON.stringify(req.body[key] || [])
                : req.body[key];
            sets.push(`${key} = ?`);
            params.push(v);
        }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No editable fields supplied' });
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);
    await dbRun(`UPDATE medications SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(req, {
        action: 'update_catalogue_medication',
        resourceType: 'medication',
        resourceId: id,
        resourceName: row.generic_name,
        oldValue: { scope: row.scope, generic_name: row.generic_name },
        newValue: req.body,
    });
    res.json({ id, message: 'Medication updated' });
}));

// DELETE /api/catalogue/medications/:id — soft delete; same auth matrix.
router.delete('/medications/:id', authenticateToken, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await dbGet('SELECT * FROM medications WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return res.status(404).json({ error: 'Medication not found' });
    if (!canMutate(req.user, row)) return res.status(403).json({ error: 'Not authorized to delete this medication' });

    await dbRun('UPDATE medications SET deleted_at = CURRENT_TIMESTAMP, is_active = 0 WHERE id = ?', [id]);
    await audit(req, {
        action: 'delete_catalogue_medication',
        resourceType: 'medication',
        resourceId: id,
        resourceName: row.generic_name,
        oldValue: { scope: row.scope, generic_name: row.generic_name },
    });
    res.json({ id, message: 'Medication deleted' });
}));

// POST /api/catalogue/medications/:id/promote { scope: 'tenant'|'platform' }
//   Admin only. Bumps a row to a wider scope. The reverse direction
//   (demoting platform → user) is intentionally not supported here — that
//   would orphan rows from existing tenants and is policy work, not a route.
router.post('/medications/:id/promote', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = req.body?.scope;
    if (!['tenant', 'platform'].includes(target)) {
        return res.status(400).json({ error: 'scope must be "tenant" or "platform"' });
    }
    const row = await dbGet('SELECT * FROM medications WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return res.status(404).json({ error: 'Medication not found' });

    await dbRun('UPDATE medications SET scope = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [target, id]);
    await audit(req, {
        action: 'promote_catalogue_medication',
        resourceType: 'medication',
        resourceId: id,
        resourceName: row.generic_name,
        oldValue: { scope: row.scope },
        newValue: { scope: target },
    });
    res.json({ id, scope: target, message: `Medication promoted to ${target}` });
}));

// GET /api/catalogue/medications/search?q= — RxNorm + openFDA proxy.
//   Auth required. Returns transient hits; does NOT persist.
router.get('/medications/search', authenticateToken, asyncHandler(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    if (!q) return res.json({ hits: [], q });

    const sources = String(req.query.sources || 'rxnorm,openfda')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

    const tasks = [];
    if (sources.includes('rxnorm')) tasks.push(searchRxNorm(q, { limit }).catch((err) => ({ _error: err.message, _source: 'rxnorm' })));
    if (sources.includes('openfda')) tasks.push(searchOpenFda(q, { limit }).catch((err) => ({ _error: err.message, _source: 'openfda' })));
    const results = await Promise.all(tasks);

    const hits = [];
    const errors = [];
    for (const r of results) {
        if (Array.isArray(r)) hits.push(...r);
        else if (r && r._error) errors.push({ source: r._source, message: r._error });
    }
    res.json({ q, hits, errors, sources });
}));

// =========================================================================
//  LAB TESTS
// =========================================================================

router.get('/lab-tests', authenticateToken, asyncHandler(async (req, res) => {
    const { scope, q, limit = 200, offset = 0 } = req.query;
    const { where, params } = visibilityClause(req.user, { hasDeletedAt: false });

    let sql = `SELECT lt.*, s.source_key AS data_source_key
               FROM lab_tests lt
               LEFT JOIN data_sources s ON s.id = lt.data_source_id
               WHERE ${where} AND lt.is_active = 1`;
    const sqlParams = [...params];

    if (scope) {
        if (!VALID_SCOPES.has(scope)) {
            return res.status(400).json({ error: `Invalid scope: ${scope}` });
        }
        sql += ` AND lt.scope = ?`;
        sqlParams.push(scope);
    }
    if (q) {
        sql += ` AND (lt.test_name LIKE ? OR lt.test_code LIKE ? OR lt.loinc_code LIKE ?)`;
        sqlParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY lt.is_curated DESC, lt.test_name LIMIT ? OFFSET ?`;
    sqlParams.push(parseInt(limit), parseInt(offset));

    const rows = await dbAll(sql, sqlParams);
    res.json({ lab_tests: rows, count: rows.length });
}));

router.post('/lab-tests', authenticateToken, asyncHandler(async (req, res) => {
    const {
        test_name, test_group, category, specimen_type, min_value, max_value, unit,
        critical_low, critical_high, normal_samples, description, turnaround_minutes,
        loinc_code, ucum_unit, external_source, scope: requestedScope,
    } = req.body || {};
    if (!test_name || !test_name.trim()) {
        return res.status(400).json({ error: 'test_name is required' });
    }
    if (!unit) return res.status(400).json({ error: 'unit is required' });

    const scope = determineScope(req.user, requestedScope);
    const dataSourceId = await dataSourceIdFor(req.user);
    const code = (req.body.test_code
        || `${scope}-${req.user.id}-${test_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`).slice(0, 96);

    const result = await dbRun(
        `INSERT INTO lab_tests (
            test_code, test_name, test_group, category, specimen_type,
            min_value, max_value, unit, critical_low, critical_high, normal_samples,
            description, turnaround_minutes,
            loinc_code, ucum_unit, external_source,
            is_curated, scope, tenant_id, created_by, data_source_id, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)`,
        [
            code, test_name.trim(), test_group || 'Custom', category || 'General', specimen_type || null,
            min_value ?? null, max_value ?? null, unit, critical_low ?? null, critical_high ?? null,
            JSON.stringify(normal_samples || []), description || null, turnaround_minutes || DEFAULT_TURNAROUND_MINUTES,
            loinc_code || null, ucum_unit || unit, external_source || null,
            scope, req.user.tenant_id ?? 1, req.user.id, dataSourceId,
        ]
    );
    await audit(req, {
        action: 'create_catalogue_lab_test',
        resourceType: 'lab_test',
        resourceId: result.lastID,
        resourceName: test_name.trim(),
        newValue: { scope, loinc_code: loinc_code || null, external_source: external_source || null },
    });
    res.status(201).json({ id: result.lastID, scope, message: 'Lab test added' });
}));

router.put('/lab-tests/:id', authenticateToken, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await dbGet('SELECT * FROM lab_tests WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Lab test not found' });
    if (!canMutate(req.user, row)) return res.status(403).json({ error: 'Not authorized to edit this lab test' });

    const allowed = ['test_name', 'test_group', 'category', 'specimen_type', 'min_value',
        'max_value', 'unit', 'critical_low', 'critical_high', 'description',
        'turnaround_minutes', 'loinc_code', 'ucum_unit'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            sets.push(`${key} = ?`);
            params.push(req.body[key]);
        }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No editable fields supplied' });
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);
    await dbRun(`UPDATE lab_tests SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(req, {
        action: 'update_catalogue_lab_test',
        resourceType: 'lab_test',
        resourceId: id,
        resourceName: row.test_name,
        oldValue: { scope: row.scope, test_name: row.test_name },
        newValue: req.body,
    });
    res.json({ id, message: 'Lab test updated' });
}));

router.delete('/lab-tests/:id', authenticateToken, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await dbGet('SELECT * FROM lab_tests WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Lab test not found' });
    if (!canMutate(req.user, row)) return res.status(403).json({ error: 'Not authorized to delete this lab test' });

    // lab_tests has no deleted_at column today (would need migration 0008).
    // Hard-delete is acceptable for catalogue rows (no FK from sessions);
    // any reference_ranges cascade via ON DELETE CASCADE in 0007.
    await dbRun('DELETE FROM lab_tests WHERE id = ?', [id]);
    await audit(req, {
        action: 'delete_catalogue_lab_test',
        resourceType: 'lab_test',
        resourceId: id,
        resourceName: row.test_name,
        oldValue: { scope: row.scope, test_name: row.test_name },
    });
    res.json({ id, message: 'Lab test deleted' });
}));

router.post('/lab-tests/:id/promote', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = req.body?.scope;
    if (!['tenant', 'platform'].includes(target)) {
        return res.status(400).json({ error: 'scope must be "tenant" or "platform"' });
    }
    const row = await dbGet('SELECT * FROM lab_tests WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Lab test not found' });
    await dbRun('UPDATE lab_tests SET scope = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [target, id]);
    await audit(req, {
        action: 'promote_catalogue_lab_test',
        resourceType: 'lab_test',
        resourceId: id,
        resourceName: row.test_name,
        oldValue: { scope: row.scope },
        newValue: { scope: target },
    });
    res.json({ id, scope: target, message: `Lab test promoted to ${target}` });
}));

router.get('/lab-tests/search', authenticateToken, asyncHandler(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    if (!q) return res.json({ hits: [], q });
    try {
        const hits = await searchLoinc(q, { limit });
        res.json({ q, hits, source: 'loinc' });
    } catch (err) {
        res.json({ q, hits: [], errors: [{ source: 'loinc', message: err.message }] });
    }
}));

// =========================================================================
//  CUSTOM GROUPS (drugs + labs share parallel CRUD)
// =========================================================================

function makeGroupRoutes(kind) {
    const config = kind === 'drug'
        ? {
            tablePrefix: 'custom_drug_groups',
            itemsTable: 'custom_drug_group_items',
            itemFk: 'medication_id',
            createAction: 'create_drug_group',
            updateAction: 'update_drug_group',
            deleteAction: 'delete_drug_group',
            addItemAction: 'add_drug_group_item',
            removeItemAction: 'remove_drug_group_item',
        }
        : {
            tablePrefix: 'custom_lab_groups',
            itemsTable: 'custom_lab_group_items',
            itemFk: 'lab_test_id',
            createAction: 'create_lab_group',
            updateAction: 'update_lab_group',
            deleteAction: 'delete_lab_group',
            addItemAction: 'add_lab_group_item',
            removeItemAction: 'remove_lab_group_item',
        };
    const groupRouter = express.Router();

    groupRouter.get('/', authenticateToken, asyncHandler(async (req, res) => {
        const { where, params } = visibilityClause(req.user, { hasDeletedAt: true });
        const rows = await dbAll(
            `SELECT * FROM ${config.tablePrefix} WHERE ${where} ORDER BY created_at DESC`,
            params
        );
        // Attach item counts so the UI can render "(N items)" without a second round-trip.
        const ids = rows.map((r) => r.id);
        let counts = new Map();
        if (ids.length) {
            const placeholders = ids.map(() => '?').join(',');
            const countRows = await dbAll(
                `SELECT group_id, COUNT(*) AS n FROM ${config.itemsTable}
                 WHERE group_id IN (${placeholders}) GROUP BY group_id`,
                ids
            );
            counts = new Map(countRows.map((r) => [r.group_id, r.n]));
        }
        res.json({ groups: rows.map((g) => ({ ...g, item_count: counts.get(g.id) || 0 })) });
    }));

    groupRouter.post('/', authenticateToken, asyncHandler(async (req, res) => {
        const { name, description, scope: requestedScope, items } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
        const scope = determineScope(req.user, requestedScope);
        const result = await dbRun(
            `INSERT INTO ${config.tablePrefix} (name, description, scope, tenant_id, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [name.trim(), description || null, scope, req.user.tenant_id ?? 1, req.user.id]
        );
        if (Array.isArray(items) && items.length) {
            for (let i = 0; i < items.length; i++) {
                await dbRun(
                    `INSERT OR IGNORE INTO ${config.itemsTable} (group_id, ${config.itemFk}, position)
                     VALUES (?, ?, ?)`,
                    [result.lastID, items[i], i]
                );
            }
        }
        await audit(req, {
            action: config.createAction,
            resourceType: kind === 'drug' ? 'drug_group' : 'lab_group',
            resourceId: result.lastID,
            resourceName: name.trim(),
            newValue: { scope, item_count: Array.isArray(items) ? items.length : 0 },
        });
        res.status(201).json({ id: result.lastID, scope, message: 'Group created' });
    }));

    groupRouter.put('/:id', authenticateToken, asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const row = await dbGet(`SELECT * FROM ${config.tablePrefix} WHERE id = ? AND deleted_at IS NULL`, [id]);
        if (!row) return res.status(404).json({ error: 'Group not found' });
        if (!canMutate(req.user, row)) return res.status(403).json({ error: 'Not authorized to edit this group' });
        const { name, description } = req.body || {};
        const sets = [];
        const params = [];
        if (name !== undefined) { sets.push('name = ?'); params.push(name); }
        if (description !== undefined) { sets.push('description = ?'); params.push(description); }
        if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
        params.push(id);
        await dbRun(`UPDATE ${config.tablePrefix} SET ${sets.join(', ')} WHERE id = ?`, params);
        await audit(req, {
            action: config.updateAction,
            resourceType: kind === 'drug' ? 'drug_group' : 'lab_group',
            resourceId: id, resourceName: row.name,
        });
        res.json({ id, message: 'Group updated' });
    }));

    groupRouter.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const row = await dbGet(`SELECT * FROM ${config.tablePrefix} WHERE id = ? AND deleted_at IS NULL`, [id]);
        if (!row) return res.status(404).json({ error: 'Group not found' });
        if (!canMutate(req.user, row)) return res.status(403).json({ error: 'Not authorized to delete this group' });
        await dbRun(`UPDATE ${config.tablePrefix} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
        await audit(req, {
            action: config.deleteAction,
            resourceType: kind === 'drug' ? 'drug_group' : 'lab_group',
            resourceId: id, resourceName: row.name,
        });
        res.json({ id, message: 'Group deleted' });
    }));

    // Items: list / add / remove. We intentionally don't expose a bulk
    // PUT here — the UI-driven "drag to reorder" path is Session 3 work,
    // and a one-shot "set the whole list" endpoint is easy to add then.
    groupRouter.get('/:id/items', authenticateToken, asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const group = await dbGet(`SELECT * FROM ${config.tablePrefix} WHERE id = ? AND deleted_at IS NULL`, [id]);
        if (!group) return res.status(404).json({ error: 'Group not found' });
        const { where, params } = visibilityClause(req.user, { hasDeletedAt: true });
        if (!canMutate(req.user, group) && group.scope !== 'platform' && !(group.scope === 'tenant' && group.tenant_id === (req.user.tenant_id ?? 1))) {
            return res.status(403).json({ error: 'Not authorized to view this group' });
        }
        const items = await dbAll(
            `SELECT i.${config.itemFk} AS item_id, i.position
             FROM ${config.itemsTable} i
             WHERE i.group_id = ?
             ORDER BY i.position`,
            [id]
        );
        res.json({ group, items });
        void where; void params; // currently informational; future: filter to visible items.
    }));

    groupRouter.post('/:id/items', authenticateToken, asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const group = await dbGet(`SELECT * FROM ${config.tablePrefix} WHERE id = ? AND deleted_at IS NULL`, [id]);
        if (!group) return res.status(404).json({ error: 'Group not found' });
        if (!canMutate(req.user, group)) return res.status(403).json({ error: 'Not authorized to modify this group' });
        const itemId = parseInt(req.body?.item_id, 10);
        if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'item_id is required' });
        const position = parseInt(req.body?.position, 10) || 0;
        await dbRun(
            `INSERT OR IGNORE INTO ${config.itemsTable} (group_id, ${config.itemFk}, position)
             VALUES (?, ?, ?)`,
            [id, itemId, position]
        );
        await audit(req, {
            action: config.addItemAction,
            resourceType: kind === 'drug' ? 'drug_group_item' : 'lab_group_item',
            resourceId: id, resourceName: group.name,
            metadata: { item_id: itemId, position },
        });
        res.json({ message: 'Item added' });
    }));

    groupRouter.delete('/:id/items/:itemId', authenticateToken, asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const itemId = parseInt(req.params.itemId, 10);
        const group = await dbGet(`SELECT * FROM ${config.tablePrefix} WHERE id = ? AND deleted_at IS NULL`, [id]);
        if (!group) return res.status(404).json({ error: 'Group not found' });
        if (!canMutate(req.user, group)) return res.status(403).json({ error: 'Not authorized to modify this group' });
        await dbRun(`DELETE FROM ${config.itemsTable} WHERE group_id = ? AND ${config.itemFk} = ?`, [id, itemId]);
        await audit(req, {
            action: config.removeItemAction,
            resourceType: kind === 'drug' ? 'drug_group_item' : 'lab_group_item',
            resourceId: id, resourceName: group.name,
            metadata: { item_id: itemId },
        });
        res.json({ message: 'Item removed' });
    }));

    return groupRouter;
}

// Mounted at non-overlapping paths because /medications/:id and
// /lab-tests/:id would otherwise match "groups" as the :id param and
// shadow the sub-router (Express matches by registration order, not
// specificity).
router.use('/medication-groups', makeGroupRoutes('drug'));
router.use('/lab-test-groups', makeGroupRoutes('lab'));

export default router;
