// Treatments library — the editable catalogue students order from.
//
// `treatment_effects` is the master list behind the student Treatment panel
// (GET /sessions/:id/available-treatments merges it with the case overlay in
// `case_treatments`) and the case editor's CaseTreatmentConfig. Until 0046 it
// was a read-only seed; these routes make it a scoped library:
//
//   scope 'platform' — visible to every tenant, editable by PLATFORM admins
//                      only (admins of the default tenant; audit 2026-10-26, F-02).
//   scope 'tenant'   — visible to users of `tenant_id`, editable by that
//                      tenant's educator+.
//
// Visibility rule (shared with the reader in orders-routes.js):
//   scope = 'platform' OR (scope = 'tenant' AND tenant_id = <caller tenant>)
// A caller never sees — and therefore can never edit — another tenant's rows;
// an out-of-scope id answers 404, not 403, so ids do not enumerate.
//
// The read endpoint `GET /treatment-effects` stays in orders-routes.js (it was
// there first and CaseTreatmentConfig pins its path). Deactivate is soft
// (`is_active = 0`) because `active_treatments.effect_id` and historical
// orders reference rows; `PUT /:id/restore` flips it back.

import express from 'express';
import { authenticateToken, requireEducator, ROLE_RANKS, hasRoleAtLeast } from '../middleware/auth.js';
import { auditSuccess, dbGet, dbRun, isPlatformAdmin, tenantId } from './_helpers.js';
import { logger } from '../logger.js';

const router = express.Router();
const log = logger('treatments-library');

export const TREATMENT_TYPES = Object.freeze(['medication', 'iv_fluid', 'oxygen', 'nursing']);
const SCOPES = Object.freeze(['platform', 'tenant']);

// SELECT list every read shares — the seeded columns plus the 0046 ownership
// columns, so a client can render the scope badge and gate its Edit button.
export const TREATMENT_EFFECT_COLUMNS = [
    'id', 'medication_id', 'treatment_type', 'treatment_name', 'route',
    'onset_minutes', 'peak_minutes', 'duration_minutes',
    'hr_effect', 'bp_sys_effect', 'bp_dia_effect', 'rr_effect', 'spo2_effect', 'temp_effect', 'etco2_effect',
    'dose_dependent', 'base_dose', 'base_dose_unit', 'max_effect_multiplier',
    'description', 'is_active', 'created_at',
    'rxcui', 'data_source_id', 'pk_source', 'pk_evidence_url',
    'scope', 'tenant_id', 'created_by', 'updated_at',
];

/** SQL fragment restricting rows to what `tenant` may see. Bind one param. */
export const VISIBILITY_SQL = `(scope = 'platform' OR (scope = 'tenant' AND tenant_id = ?))`;

const NAME_MAX = 120;
const TEXT_MAX = 2000;

// Numeric field spec: [column, {min, integer}]. Effects are signed deltas;
// timings must be non-negative; multiplier must be > 0.
const NUMERIC_FIELDS = {
    onset_minutes: { min: 0 },
    peak_minutes: { min: 0 },
    duration_minutes: { min: 0 },
    hr_effect: { integer: true },
    bp_sys_effect: { integer: true },
    bp_dia_effect: { integer: true },
    rr_effect: { integer: true },
    spo2_effect: { integer: true },
    temp_effect: {},
    etco2_effect: { integer: true },
    base_dose: { min: 0, nullable: true },
    max_effect_multiplier: { min: 0, exclusiveMin: true },
};
const TEXT_FIELDS = ['route', 'base_dose_unit', 'description', 'rxcui', 'pk_source', 'pk_evidence_url'];

const DEFAULTS = {
    onset_minutes: 5,
    peak_minutes: 15,
    duration_minutes: 60,
    hr_effect: 0,
    bp_sys_effect: 0,
    bp_dia_effect: 0,
    rr_effect: 0,
    spo2_effect: 0,
    temp_effect: 0,
    etco2_effect: 0,
    dose_dependent: 0,
    base_dose: null,
    base_dose_unit: null,
    max_effect_multiplier: 2.0,
    route: null,
    description: null,
    rxcui: null,
    pk_source: null,
    pk_evidence_url: null,
    medication_id: null,
};

class ValidationError extends Error {
    constructor(message, code = 'invalid_treatment') {
        super(message);
        this.code = code;
    }
}

function cleanText(value, field, max = TEXT_MAX) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
    const trimmed = value.trim();
    if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
    return trimmed || null;
}

function cleanNumber(value, field, spec) {
    if (value === undefined || value === null || value === '') {
        if (spec.nullable) return null;
        throw new ValidationError(`${field} is required`);
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
    if (spec.integer && !Number.isInteger(n)) throw new ValidationError(`${field} must be an integer`);
    if (spec.min !== undefined) {
        if (spec.exclusiveMin ? n <= spec.min : n < spec.min) {
            throw new ValidationError(`${field} must be ${spec.exclusiveMin ? 'greater than' : 'at least'} ${spec.min}`);
        }
    }
    return n;
}

function cleanBool(value) {
    if (value === true || value === 1 || value === '1' || value === 'true') return 1;
    return 0;
}

/**
 * Validate a create/update body into a column→value map.
 * @param {object} body        request body
 * @param {object} [existing]  current row for PUT (missing fields keep it)
 */
export function validateTreatmentBody(body, existing = null) {
    if (!body || typeof body !== 'object') throw new ValidationError('body must be an object');
    const base = existing || DEFAULTS;
    const pick = (k) => (body[k] === undefined ? base[k] : body[k]);

    const treatment_type = pick('treatment_type');
    if (!TREATMENT_TYPES.includes(treatment_type)) {
        throw new ValidationError(
            `treatment_type must be one of ${TREATMENT_TYPES.join(', ')}`,
            'invalid_treatment_type',
        );
    }
    const treatment_name = cleanText(pick('treatment_name'), 'treatment_name', NAME_MAX);
    if (!treatment_name) throw new ValidationError('treatment_name is required', 'invalid_treatment_name');

    const out = { treatment_type, treatment_name };
    TEXT_FIELDS.forEach((f) => { out[f] = cleanText(pick(f), f, f === 'route' ? 64 : TEXT_MAX); });
    Object.entries(NUMERIC_FIELDS).forEach(([f, spec]) => { out[f] = cleanNumber(pick(f), f, spec); });
    out.dose_dependent = cleanBool(pick('dose_dependent'));
    if (out.pk_evidence_url && !/^https?:\/\//i.test(out.pk_evidence_url)) {
        throw new ValidationError('pk_evidence_url must be an http(s) URL', 'invalid_pk_evidence_url');
    }
    const medication_id = pick('medication_id');
    out.medication_id = medication_id === null || medication_id === undefined || medication_id === ''
        ? null
        : cleanNumber(medication_id, 'medication_id', { integer: true, min: 1 });
    return out;
}

/**
 * Who may change a row: platform admins for platform rows (a platform row's
 * doses and vital effects drive every tenant's simulations, so a tenant
 * admin may not rewrite them); educator+ of the same tenant for tenant rows.
 */
export function canMutateTreatment(user, row) {
    if (!user || !row) return false;
    if (row.scope === 'platform') return isPlatformAdmin(user);
    if (row.scope === 'tenant') {
        return row.tenant_id === (user.tenant_id || 1) && hasRoleAtLeast(user, ROLE_RANKS.educator);
    }
    return false;
}

async function loadVisible(id, tenant) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    return dbGet(
        `SELECT ${TREATMENT_EFFECT_COLUMNS.join(', ')} FROM treatment_effects
          WHERE id = ? AND ${VISIBILITY_SQL}`,
        [numericId, tenant],
    );
}

function isUniqueViolation(err) {
    return /UNIQUE constraint failed/i.test(err?.message || '');
}

function sendValidation(res, err) {
    return res.status(400).json({ error: err.message, code: err.code });
}

// POST /api/treatment-effects — create. Platform admins choose 'platform'
// (default) or 'tenant'; a tenant admin creates 'tenant' rows by default and is
// refused 'platform'; educators always create 'tenant' rows in their own
// tenant, whatever the body says.
router.post('/treatment-effects', authenticateToken, requireEducator, async (req, res) => {
    let fields;
    try {
        fields = validateTreatmentBody(req.body);
    } catch (err) {
        if (err instanceof ValidationError) return sendValidation(res, err);
        throw err;
    }
    const isAdmin = hasRoleAtLeast(req.user, ROLE_RANKS.admin);
    const requested = req.body?.scope;
    if (requested !== undefined && !SCOPES.includes(requested)) {
        return res.status(400).json({ error: `scope must be one of ${SCOPES.join(', ')}`, code: 'invalid_scope' });
    }
    const platformAdmin = isPlatformAdmin(req.user);
    if (requested === 'platform' && isAdmin && !platformAdmin) {
        return res.status(403).json({ error: 'Platform administrator required', code: 'platform_admin_required' });
    }
    const scope = platformAdmin ? (requested || 'platform') : 'tenant';
    const tenant = tenantId(req);

    const cols = Object.keys(fields);
    const sql = `INSERT INTO treatment_effects (${cols.join(', ')}, scope, tenant_id, created_by, updated_at, is_active)
                 VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?, CURRENT_TIMESTAMP, 1)`;
    try {
        const result = await dbRun(sql, [...cols.map((c) => fields[c]), scope, tenant, req.user.id]);
        const row = await loadVisible(result.lastID, tenant);
        auditSuccess(req, {
            action: 'treatment_effect.create',
            resourceType: 'treatment_effect',
            resourceId: String(result.lastID),
            resourceName: fields.treatment_name,
            newValue: { ...fields, scope },
        });
        req.log?.info?.('treatment effect created', { id: result.lastID, scope, treatment_type: fields.treatment_type });
        return res.status(201).json({ effect: row });
    } catch (err) {
        if (isUniqueViolation(err)) {
            return res.status(409).json({
                error: `A treatment named "${fields.treatment_name}" with route "${fields.route || '—'}" already exists. Names are unique across the platform — pick a distinct name (e.g. add a local protocol suffix).`,
                code: 'duplicate_treatment',
            });
        }
        (req.log || log).error('treatment effect create failed', { error: err.message });
        return res.status(500).json({ error: 'Failed to create treatment', code: 'treatment_create_failed' });
    }
});

// PUT /api/treatment-effects/:id — update. Platform rows: admin only. Tenant
// rows: educator+ of the owning tenant. Scope and tenant are immutable here.
router.put('/treatment-effects/:id', authenticateToken, requireEducator, async (req, res) => {
    const tenant = tenantId(req);
    const existing = await loadVisible(req.params.id, tenant);
    if (!existing) return res.status(404).json({ error: 'Treatment not found', code: 'treatment_not_found' });
    if (!canMutateTreatment(req.user, existing)) {
        return res.status(403).json({
            error: existing.scope === 'platform'
                ? 'Platform treatments can only be edited by a platform administrator'
                : 'Not authorized to edit this treatment',
            code: 'treatment_forbidden',
        });
    }
    let fields;
    try {
        fields = validateTreatmentBody(req.body, existing);
    } catch (err) {
        if (err instanceof ValidationError) return sendValidation(res, err);
        throw err;
    }
    const cols = Object.keys(fields);
    const sql = `UPDATE treatment_effects
                    SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`;
    try {
        await dbRun(sql, [...cols.map((c) => fields[c]), existing.id]);
        const row = await loadVisible(existing.id, tenant);
        auditSuccess(req, {
            action: 'treatment_effect.update',
            resourceType: 'treatment_effect',
            resourceId: String(existing.id),
            resourceName: fields.treatment_name,
            oldValue: existing,
            newValue: fields,
        });
        req.log?.info?.('treatment effect updated', { id: existing.id, scope: existing.scope });
        return res.json({ effect: row });
    } catch (err) {
        if (isUniqueViolation(err)) {
            return res.status(409).json({
                error: `A treatment named "${fields.treatment_name}" with route "${fields.route || '—'}" already exists. Names are unique across the platform — pick a distinct name.`,
                code: 'duplicate_treatment',
            });
        }
        (req.log || log).error('treatment effect update failed', { id: existing.id, error: err.message });
        return res.status(500).json({ error: 'Failed to update treatment', code: 'treatment_update_failed' });
    }
});

// Shared soft-delete / restore handler.
async function setActive(req, res, active) {
    const tenant = tenantId(req);
    const existing = await loadVisible(req.params.id, tenant);
    if (!existing) return res.status(404).json({ error: 'Treatment not found', code: 'treatment_not_found' });
    if (!canMutateTreatment(req.user, existing)) {
        return res.status(403).json({
            error: existing.scope === 'platform'
                ? 'Platform treatments can only be changed by a platform administrator'
                : 'Not authorized to change this treatment',
            code: 'treatment_forbidden',
        });
    }
    try {
        await dbRun(
            `UPDATE treatment_effects SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [active ? 1 : 0, existing.id],
        );
        const row = await loadVisible(existing.id, tenant);
        auditSuccess(req, {
            action: active ? 'treatment_effect.restore' : 'treatment_effect.deactivate',
            resourceType: 'treatment_effect',
            resourceId: String(existing.id),
            resourceName: existing.treatment_name,
            oldValue: { is_active: existing.is_active },
            newValue: { is_active: active ? 1 : 0 },
        });
        req.log?.info?.(active ? 'treatment effect restored' : 'treatment effect deactivated', { id: existing.id });
        return res.json({ effect: row });
    } catch (err) {
        (req.log || log).error('treatment effect state change failed', { id: existing.id, error: err.message });
        return res.status(500).json({ error: 'Failed to update treatment', code: 'treatment_update_failed' });
    }
}

// DELETE /api/treatment-effects/:id — soft delete (is_active = 0). Rows are
// referenced by active_treatments / historical orders, so nothing is removed.
router.delete('/treatment-effects/:id', authenticateToken, requireEducator, (req, res) => setActive(req, res, false));

// PUT /api/treatment-effects/:id/restore — undo a deactivate.
router.put('/treatment-effects/:id/restore', authenticateToken, requireEducator, (req, res) => setActive(req, res, true));

export default router;
