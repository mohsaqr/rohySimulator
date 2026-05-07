import dbAdapter from '../dbAdapter.js';
import {
    resolveTenant,
    ROLE_RANKS,
    VALID_ROLES,
    hasRoleAtLeast,
    normalizeRole
} from '../middleware/auth.js';
import {
    REDACTED,
    redactAuditPayload,
    redactJsonColumn,
    redactRow,
    redactRows
} from '../redaction.js';
import { logger } from '../logger.js';
import { appendAuditEntry } from '../audit-chain.js';

const auditLog = logger('audit');
const routesCasesLog = logger('routes-cases-sessions');

export { redactRow, redactRows };

export const canManageOwnedResource = (ownerId, user) => ownerId === user?.id || hasRoleAtLeast(user, ROLE_RANKS.educator);
export const canReadAcrossUsers = (user) => hasRoleAtLeast(user, ROLE_RANKS.reviewer);
export const isValidRole = (role) => VALID_ROLES.includes(normalizeRole(role));
export const roleForStorage = (role, fallback = 'student') => normalizeRole(role || fallback);
export const tenantId = (req) => resolveTenant(req);

export const SOFT_DELETE_TABLES = [
    'cases',
    'sessions',
    'agent_templates',
    'scenarios',
    'medications',
    'case_investigations',
    'lab_definitions',
    'clinical_notes'
];

export const HARD_DELETE_ON_PURGE_TABLES = [
    'user_preferences',
    'active_sessions',
    'alarm_config',
    'session_notes',
    'questionnaire_responses',
    'export_records',
    'llm_usage',
    'tts_usage'
];

export const RETENTION_TABLES = [
    { table: 'event_log', column: 'timestamp', userColumn: 'user_id' },
    { table: 'learning_events', column: 'timestamp', userColumn: 'user_id' },
    { table: 'interactions', column: 'timestamp', userColumn: null },
    { table: 'system_audit_log', column: 'timestamp', userColumn: 'user_id' },
    { table: 'alarm_events', column: 'triggered_at', userColumn: null },
    { table: 'llm_request_log', column: 'request_timestamp', userColumn: 'user_id' },
    // client_logs (audit Phase 3): high-volume, useful for incident
    // triage but not load-bearing for clinical audit. Same anonymise-on-
    // user-purge contract as the rest. Aged sweep: see scripts/sweep-retention.js.
    { table: 'client_logs', column: 'received_at', userColumn: 'user_id' }
];

export function dbGet(sql, params = []) {
    return dbAdapter.get(sql, params);
}

export function dbAll(sql, params = []) {
    return dbAdapter.all(sql, params);
}

export function dbRun(sql, params = []) {
    return dbAdapter.run(sql, params);
}

export async function dbScalar(sql, params = []) {
    const row = await dbGet(sql, params);
    return row ? Number(row.count || 0) : 0;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validatePassword(password) {
    const errors = [];

    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Log an action to the system audit log
 * @param {Object} params - Audit log parameters
 */
export function logAudit(params) {
    const {
        userId = null,
        username = null,
        action,
        resourceType = null,
        resourceId = null,
        resourceName = null,
        targetType = null,
        targetId = null,
        targetName = null,
        oldValue = null,
        newValue = null,
        ipAddress = null,
        userAgent = null,
        sessionId = null,
        status = 'success',
        errorMessage = null,
        metadata = null
    } = params;
    const tenant_id = params.tenantId ?? params.tenant_id ?? 1;

    void appendAuditEntry({
        userId,
        username,
        action,
        resourceType: resourceType ?? targetType,
        resourceId: resourceId ?? targetId,
        resourceName: resourceName ?? targetName,
        oldValue: oldValue ? JSON.stringify(redactAuditPayload(oldValue)) : null,
        newValue: newValue ? JSON.stringify(redactAuditPayload(newValue)) : null,
        ipAddress,
        userAgent,
        sessionId,
        status,
        errorMessage,
        metadata: metadata ? JSON.stringify(redactAuditPayload(metadata)) : null,
        tenantId: tenant_id
    }).catch((err) => {
        auditLog.warn('audit log write failed', {
            action,
            resource_type: resourceType ?? targetType ?? null,
            resource_id: resourceId ?? targetId ?? null,
            tenant_id,
            error: err.message
        });
    });
}

export function logAuditAsync(params) {
    const {
        userId = null,
        username = null,
        action,
        resourceType = null,
        resourceId = null,
        resourceName = null,
        targetType = null,
        targetId = null,
        targetName = null,
        oldValue = null,
        newValue = null,
        ipAddress = null,
        userAgent = null,
        sessionId = null,
        status = 'success',
        errorMessage = null,
        metadata = null
    } = params;
    const tenant_id = params.tenantId ?? params.tenant_id ?? 1;

    return appendAuditEntry({
        userId,
        username,
        action,
        resourceType: resourceType ?? targetType,
        resourceId: resourceId ?? targetId,
        resourceName: resourceName ?? targetName,
        oldValue: oldValue ? JSON.stringify(redactAuditPayload(oldValue)) : null,
        newValue: newValue ? JSON.stringify(redactAuditPayload(newValue)) : null,
        ipAddress,
        userAgent,
        sessionId,
        status,
        errorMessage,
        metadata: metadata ? JSON.stringify(redactAuditPayload(metadata)) : null,
        tenantId: tenant_id
    });
}

export function auditSuccess(req, params) {
    logAudit({
        userId: req.user?.id,
        username: req.user?.username,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers?.['user-agent'],
        status: 'success',
        tenantId: tenantId(req),
        ...params
    });
}

export function parseAuditJson(value) {
    if (!value || typeof value !== 'string') return value ?? null;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

export function redactAuditSetting(key, value) {
    if (value == null) return value;
    if (/(api[_-]?key|password|secret|token)/i.test(key)) {
        return value ? REDACTED : value;
    }
    return redactJsonColumn(parseAuditJson(value));
}

export async function buildUserPurgePlan(userId, tenant_id) {
    const authoredCaseIds = (await dbAll(
        `SELECT id FROM cases WHERE tenant_id = ? AND deleted_at IS NULL
         AND (created_by = ? OR last_modified_by = ?)`,
        [tenant_id, userId, userId]
    )).map(r => r.id);
    const sessionIds = (await dbAll(
        `SELECT id FROM sessions WHERE tenant_id = ? AND deleted_at IS NULL AND user_id = ?`,
        [tenant_id, userId]
    )).map(r => r.id);

    const plan = {
        soft_delete: {
            cases: authoredCaseIds.length,
            sessions: sessionIds.length,
            agent_templates: await dbScalar(`SELECT COUNT(*) AS count FROM agent_templates WHERE tenant_id = ? AND created_by = ? AND deleted_at IS NULL`, [tenant_id, userId]),
            scenarios: await dbScalar(`SELECT COUNT(*) AS count FROM scenarios WHERE tenant_id = ? AND created_by = ? AND deleted_at IS NULL`, [tenant_id, userId]),
            // lab_definitions is a global master catalog (no tenant_id),
            // but per-user authorship exists via created_by. Stage E6 didn't
            // tenant-scope this table. Filter by created_by only.
            lab_definitions: await dbScalar(`SELECT COUNT(*) AS count FROM lab_definitions WHERE created_by = ? AND deleted_at IS NULL`, [userId]),
            clinical_notes: await dbScalar(`SELECT COUNT(*) AS count FROM clinical_notes WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`, [tenant_id, userId]),
            case_investigations: authoredCaseIds.length
                ? await dbScalar(
                    `SELECT COUNT(*) AS count FROM case_investigations
                     WHERE tenant_id = ? AND deleted_at IS NULL AND case_id IN (${authoredCaseIds.map(() => '?').join(',')})`,
                    [tenant_id, ...authoredCaseIds]
                )
                : 0
        },
        hard_delete: {},
        anonymize_retained: {},
        anonymize_user: 1
    };

    for (const table of HARD_DELETE_ON_PURGE_TABLES) {
        plan.hard_delete[table] = await dbScalar(
            `SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND user_id = ?`,
            [tenant_id, userId]
        );
    }

    plan.hard_delete.alarm_config = await dbScalar(
        `SELECT COUNT(*) AS count FROM alarm_config WHERE tenant_id = ? AND user_id = ?`,
        [tenant_id, userId]
    );

    plan.anonymize_retained.sessions = sessionIds.length;
    plan.anonymize_retained.login_logs = await dbScalar(`SELECT COUNT(*) AS count FROM login_logs WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
    plan.anonymize_retained.settings_logs = await dbScalar(`SELECT COUNT(*) AS count FROM settings_logs WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
    plan.anonymize_retained.session_settings = await dbScalar(`SELECT COUNT(*) AS count FROM session_settings WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
    plan.anonymize_retained.physical_exam_findings = await dbScalar(`SELECT COUNT(*) AS count FROM physical_exam_findings WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
    plan.anonymize_retained.emotion_logs = await dbScalar(`SELECT COUNT(*) AS count FROM emotion_logs WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
    for (const retention of RETENTION_TABLES.filter(t => t.userColumn)) {
        plan.anonymize_retained[retention.table] = await dbScalar(
            `SELECT COUNT(*) AS count FROM ${retention.table} WHERE tenant_id = ? AND ${retention.userColumn} = ?`,
            [tenant_id, userId]
        );
    }

    return { plan, authoredCaseIds, sessionIds };
}

export async function executeUserPurge({ userId, tenant_id, anonymizedUsername, passwordHash, authoredCaseIds }) {
    await dbRun('BEGIN');
    try {
        await dbRun(`UPDATE cases SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL, last_modified_by = NULL
                     WHERE tenant_id = ? AND (created_by = ? OR last_modified_by = ?)`, [tenant_id, userId, userId]);
        if (authoredCaseIds.length > 0) {
            await dbRun(
                `UPDATE case_investigations SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
                 WHERE tenant_id = ? AND case_id IN (${authoredCaseIds.map(() => '?').join(',')})`,
                [tenant_id, ...authoredCaseIds]
            );
        }
        await dbRun(`UPDATE sessions SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), user_id = NULL, student_name = ?
                     WHERE tenant_id = ? AND user_id = ?`, [anonymizedUsername, tenant_id, userId]);
        await dbRun(`UPDATE agent_templates SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL
                     WHERE tenant_id = ? AND created_by = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE scenarios SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL
                     WHERE tenant_id = ? AND created_by = ?`, [tenant_id, userId]);
        // lab_definitions is a global master catalog (no tenant_id column);
        // detach by created_by only.
        await dbRun(`UPDATE lab_definitions SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL
                     WHERE created_by = ?`, [userId]);
        await dbRun(`UPDATE clinical_notes SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
                     WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);

        for (const table of HARD_DELETE_ON_PURGE_TABLES) {
            await dbRun(`DELETE FROM ${table} WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        }

        await dbRun(`UPDATE event_log SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE learning_events SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE system_audit_log SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE llm_request_log SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE login_logs SET user_id = NULL, username = ? WHERE tenant_id = ? AND user_id = ?`, [anonymizedUsername, tenant_id, userId]);
        await dbRun(`UPDATE settings_logs SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE session_settings SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE physical_exam_findings SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE emotion_logs SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant_id, userId]);
        await dbRun(`UPDATE platform_settings SET updated_by = NULL WHERE updated_by = ?`, [userId]);
        await dbRun(`UPDATE scenario_templates SET created_by = NULL WHERE created_by = ?`, [userId]);
        await dbRun(`UPDATE scenario_events SET acknowledged_by = NULL WHERE tenant_id = ? AND acknowledged_by = ?`, [tenant_id, userId]);

        await dbRun(
            `UPDATE users SET
                username = ?, name = NULL, email = NULL, password_hash = ?, role = 'student',
                department = NULL, status = 'inactive', last_login = NULL, failed_login_attempts = 0,
                locked_until = NULL, updated_at = CURRENT_TIMESTAMP, deleted_at = CURRENT_TIMESTAMP,
                institution = NULL, address = NULL, phone = NULL, alternative_email = NULL,
                education = NULL, grade = NULL
             WHERE id = ? AND tenant_id = ?`,
            [anonymizedUsername, passwordHash, userId, tenant_id]
        );
        await dbRun('COMMIT');
    } catch (err) {
        await dbRun('ROLLBACK').catch(() => {});
        throw err;
    }
}

// Physiological clamp ranges for case.config.initialVitals. The editor's
// HTML min/max are advisory only (browsers accept out-of-range values when
// the user types them directly); this is the server-side belt-and-braces.
export const VITAL_RANGES = {
    hr:    { min: 20,  max: 250 },
    spo2:  { min: 50,  max: 100 },
    rr:    { min: 4,   max: 60  },
    bpSys: { min: 40,  max: 260 },
    bpDia: { min: 20,  max: 180 },
    temp:  { min: 30,  max: 43  },
    etco2: { min: 0,   max: 100 }
};

/**
 * Clamp the case's initialVitals to physiologically-plausible ranges so an
 * admin can't accidentally persist (or a malicious payload can't inject)
 * values that would crash the monitor or trigger unrelated alarm cascades.
 * Returns a new config object with clamped values; non-vitals fields are
 * untouched. If a vital was out-of-range we log it for the admin.
 */
export function clampInitialVitals(config) {
    if (!config || typeof config !== 'object') return config;
    const iv = config.initialVitals;
    if (!iv || typeof iv !== 'object') return config;
    const clamped = { ...iv };
    let changed = false;
    for (const [key, range] of Object.entries(VITAL_RANGES)) {
        if (iv[key] == null || iv[key] === '') continue;
        const n = Number(iv[key]);
        if (!Number.isFinite(n)) continue;
        if (n < range.min || n > range.max) {
            clamped[key] = Math.max(range.min, Math.min(range.max, n));
            routesCasesLog.warn('case initial vital clamped', { vital: key, value: n, clamped_value: clamped[key], min: range.min, max: range.max });
            changed = true;
        } else if (clamped[key] !== n) {
            clamped[key] = n; // coerce string-numbers to numbers
            changed = true;
        }
    }
    return changed ? { ...config, initialVitals: clamped } : config;
}

/**
 * Tuck scenario provenance metadata into the scenario JSON itself so it
 * round-trips through the DB. The case wizard sends `scenario_template`
 * (built-in template id), `scenario_from_repository` (admin-curated entry),
 * and `scenario_duration` (override duration in minutes) as top-level
 * fields. Pre-this-fix the destructure ignored them and admins lost the
 * audit trail of which template a case was authored from.
 *
 * The merged shape is `scenario.source = { kind, id?, name?, duration_minutes? }`
 * and is non-destructive: if no metadata is provided we return the scenario
 * unchanged, including null.
 */
export function mergeScenarioSource(scenario, { scenario_template, scenario_from_repository, scenario_duration }) {
    if (!scenario) return scenario; // null or undefined — leave alone
    const source = {};
    if (scenario_from_repository) {
        source.kind = 'repository';
        if (scenario_from_repository.id != null) source.id = scenario_from_repository.id;
        if (scenario_from_repository.name) source.name = scenario_from_repository.name;
    } else if (scenario_template) {
        source.kind = 'template';
        source.id = scenario_template;
    }
    if (scenario_duration != null) source.duration_minutes = scenario_duration;
    if (Object.keys(source).length === 0) return scenario;
    return { ...scenario, source };
}

// Stage-1 audit: pin runtime case config to a snapshot taken at session
// start. Readers prefer `sessions.case_snapshot` over the live `cases.config`
// JOIN; the live row is kept as a safety fallback for sessions written
// before the snapshot column existed.
//
// Pass a row that includes both `case_snapshot` (from sessions) and `config`
// (from JOIN cases). Returns the parsed config object. Never throws — bad
// JSON falls back to {} with a warning.
export function resolveSessionCaseConfig(row) {
    if (row && row.case_snapshot) {
        try {
            const snap = JSON.parse(row.case_snapshot);
            if (snap && snap.config) return snap.config;
        } catch (e) {
            routesCasesLog.warn('case snapshot json parse failed; using live config', { error: e.message });
        }
    }
    if (row && row.config) {
        try {
            return JSON.parse(row.config);
        } catch (e) {
            routesCasesLog.warn('live case config json parse failed', { error: e.message });
        }
    }
    return {};
}

// Same shape for scenario JSON.
export function resolveSessionCaseScenario(row) {
    if (row && row.case_snapshot) {
        try {
            const snap = JSON.parse(row.case_snapshot);
            if (snap && snap.scenario !== undefined) return snap.scenario;
        } catch (e) {
            // already warned in resolveSessionCaseConfig path; stay quiet here
        }
    }
    if (row && row.scenario) {
        try {
            return JSON.parse(row.scenario);
        } catch (e) {
            routesCasesLog.warn('live case scenario json parse failed', { error: e.message });
        }
    }
    return null;
}

export function createCaseVersion(caseId, userId, changeType, description, configSnapshot) {
    // Get current version number
    dbAdapter.get(
        `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM case_versions WHERE case_id = ?`,
        [caseId],
        (err, row) => {
            if (err) {
                routesCasesLog.error('case version lookup failed', { error: err.message });
                return;
            }
            const versionNumber = row?.next_version || 1;
            dbAdapter.run(
                `INSERT INTO case_versions (case_id, version_number, changed_by, change_type, changes_description, config_snapshot, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [caseId, versionNumber, userId, changeType, description, JSON.stringify(configSnapshot), configSnapshot?.tenant_id || 1],
                (err) => {
                    if (err) {
                        routesCasesLog.error('case version create failed', { error: err.message });
                    }
                }
            );
        }
    );
}

/**
 * Verify the authenticated user owns the given session (or is admin).
 * Resolves to true on access; otherwise sends 403/404/500 on `res` and
 * resolves to false. Use on any route that accepts session_id from the
 * body or path so users can't read/write across each other's sessions by
 * guessing the integer id.
 *
 * Usage:
 *   if (!await verifySessionOwnership(sessionId, req.user, res)) return;
 *   // ...handler continues
 *
 * Educators/admins and missing-session-id (caller's choice — handler may decide
 * non-scoped writes are OK) pass through. Pass `requireSession: true` to
 * reject when sessionId is falsy.
 */
export function verifySessionOwnership(sessionId, user, res, { requireSession = false } = {}) {
    return new Promise((resolve) => {
        if (sessionId === undefined || sessionId === null || sessionId === '') {
            if (requireSession) {
                res.status(400).json({ error: 'session_id required' });
                return resolve(false);
            }
            return resolve(true);
        }
        if (hasRoleAtLeast(user, ROLE_RANKS.educator)) {
            return resolve(true);
        }
        dbAdapter.get('SELECT user_id, tenant_id FROM sessions WHERE id = ? AND tenant_id = ?', [sessionId, user?.tenant_id || 1], (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return resolve(false);
            }
            if (!row) {
                res.status(404).json({ error: 'Session not found' });
                return resolve(false);
            }
            if (row.user_id !== user?.id) {
                res.status(403).json({ error: 'Access denied: session not owned by user' });
                return resolve(false);
            }
            resolve(true);
        });
    });
}
