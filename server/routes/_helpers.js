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

// --- Cohort-case access enforcement (class-centric, date-windowed) ----------
// Enforcement is OPT-IN via the global platform flag `enforce_cohort_case_access`
// and only applies to sub-reviewer ranks (students). Reviewer/educator/admin
// always bypass. When the flag is absent or unreadable we treat it as OFF, so a
// settings glitch can never lock every student out (fail-safe / non-breaking).

/** True when the caller ranks below reviewer, i.e. enforcement *could* apply. */
export const isEnforcedStudent = (user) => !canReadAcrossUsers(user);

let _enforceCache = { value: null, at: 0 };
const ENFORCE_CACHE_MS = 15000;

/** Read the global enforcement flag (cached ~15s, fail-safe OFF). */
export async function cohortCaseEnforcementOn() {
    const now = Date.now();
    if (_enforceCache.value !== null && now - _enforceCache.at < ENFORCE_CACHE_MS) {
        return _enforceCache.value;
    }
    try {
        const row = await dbGet(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'enforce_cohort_case_access'`
        );
        const on = row?.setting_value === 'true' || row?.setting_value === '1';
        _enforceCache = { value: on, at: now };
        return on;
    } catch {
        return false;
    }
}

/** Drop the cached flag after a toggle (admin route / tests call this). */
export function resetCohortCaseEnforcementCache() {
    _enforceCache = { value: null, at: 0 };
}

/**
 * The single gate every case-visibility site shares: catalog (GET /cases),
 * direct read (GET /cases/:id) and session launch (POST /sessions). True only
 * when the caller is below reviewer rank AND the admin has opted in. Call this
 * rather than testing rank and flag separately — the three sites previously
 * tested rank alone, which enforced course scoping on every install whether or
 * not the admin had turned it on.
 */
export async function caseAccessEnforcedFor(user) {
    if (!isEnforcedStudent(user)) return false;
    return cohortCaseEnforcementOn();
}

// --- Registration policy ----------------------------------------------------
// How people get accounts, set by an admin in Platform → Users:
//
//   open     anyone who can reach the URL self-registers   (the historical behaviour)
//   approval anyone may request; an admin approves          (phase 3)
//   invite   self-registration requires an invite           (phase 2)
//   closed   no self-registration; admins create users
//
// ABSENT SETTING = 'open'. That is what makes this non-breaking: an existing
// install that never opts in behaves exactly as it did before the feature
// existed. Fresh installs are seeded to a safe mode by server/seeders.
//
// The bootstrap (empty users table → first account claims the instance as
// admin) is checked BEFORE this policy in POST /auth/register and bypasses it
// entirely, so a fresh box stays claimable in every mode.

export const REGISTRATION_MODES = ['open', 'approval', 'invite', 'closed'];
export const DEFAULT_REGISTRATION_MODE = 'open';

let _policyCache = { value: null, at: 0 };
const POLICY_CACHE_MS = 15000;

/** Normalise the stored comma-separated domain list into bare hostnames. */
function parseDomains(raw) {
    if (!raw) return [];
    return raw
        .split(',')
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
}

/**
 * The current registration policy (cached ~15s).
 *
 * Deliberately UNLIKE cohortCaseEnforcementOn(): on a read error we serve the
 * last-good cached value rather than the default. A transient DB failure must
 * never silently re-open a closed instance. We only fall back to 'open' when
 * there has never been a successful read — and that case is safe, because an
 * instance nobody has ever configured is a fresh one, which the bootstrap
 * covers regardless of mode.
 *
 * @returns {Promise<{mode: string, domains: string[], message: string|null}>}
 */
export async function registrationPolicy() {
    const now = Date.now();
    if (_policyCache.value && now - _policyCache.at < POLICY_CACHE_MS) {
        return _policyCache.value;
    }
    try {
        const rows = await dbAll(
            `SELECT setting_key, setting_value FROM platform_settings
              WHERE setting_key IN ('registration_mode', 'registration_email_domains', 'registration_message')`
        );
        const byKey = Object.fromEntries((rows || []).map((r) => [r.setting_key, r.setting_value]));
        const stored = byKey.registration_mode;
        const value = {
            mode: REGISTRATION_MODES.includes(stored) ? stored : DEFAULT_REGISTRATION_MODE,
            domains: parseDomains(byKey.registration_email_domains),
            message: byKey.registration_message || null
        };
        _policyCache = { value, at: now };
        return value;
    } catch (err) {
        if (_policyCache.value) {
            routesCasesLog.warn('registration policy read failed, serving cached value', { error: err.message });
            return _policyCache.value;
        }
        routesCasesLog.warn('registration policy unreadable, defaulting to open', { error: err.message });
        return { mode: DEFAULT_REGISTRATION_MODE, domains: [], message: null };
    }
}

/** Drop the cached policy after a write (admin route / tests call this). */
export function resetRegistrationPolicyCache() {
    _policyCache = { value: null, at: 0 };
}

/**
 * True when `email` is acceptable under an allowlist. An empty list allows
 * everything. Domains are matched on the exact host after '@' (a sub-domain of
 * an allowed domain is NOT allowed — 'evil.uef.fi' must not pass a 'uef.fi'
 * allowlist just because it ends with it).
 */
export function emailDomainAllowed(email, domains) {
    if (!domains || domains.length === 0) return true;
    const host = String(email || '').split('@')[1]?.toLowerCase();
    if (!host) return false;
    return domains.includes(host);
}

/**
 * SQL `EXISTS (...)` fragment: true when the given cases-row alias is assigned,
 * in-window, to a live active in-window membership of the bound user. Contains
 * exactly ONE bind placeholder (`?` for the student's user id). All time
 * comparisons wrap both sides in datetime() because cohort windows are stored as
 * ISO strings while CURRENT_TIMESTAMP columns use 'YYYY-MM-DD HH:MM:SS' — the two
 * are not lexically comparable. `caseAlias` is a trusted internal literal.
 */
export function cohortCaseVisibleExists(caseAlias = 'c') {
    return `EXISTS (
        SELECT 1
          FROM cohort_cases cc
          JOIN cohorts co ON co.id = cc.cohort_id
          JOIN cohort_members cm ON cm.cohort_id = co.id
         WHERE cc.case_id = ${caseAlias}.id
           AND cc.deleted_at IS NULL
           AND co.deleted_at IS NULL
           AND co.tenant_id = ${caseAlias}.tenant_id
           AND cm.user_id = ?
           AND cm.deleted_at IS NULL
           AND cm.status = 'active'
           AND (co.starts_at IS NULL OR datetime(co.starts_at) <= datetime('now'))
           AND (co.ends_at IS NULL OR datetime(co.ends_at) >= datetime('now'))
           AND (cc.available_from IS NULL OR datetime(cc.available_from) <= datetime('now'))
           AND (cc.available_until IS NULL OR datetime(cc.available_until) >= datetime('now'))
           AND (cm.enrolled_from IS NULL OR datetime(cm.enrolled_from) <= datetime('now'))
           AND (cm.enrolled_until IS NULL OR datetime(cm.enrolled_until) >= datetime('now'))
    )`;
}

/**
 * Idempotently enrol a user into every AUTO-ENROL class in their tenant
 * (`cohorts.auto_enroll = 1`) — the safety net that guarantees every student
 * always has the default class (the "Basic course"), so enforcement can never
 * lock anyone out. One INSERT per matching cohort the user is not already a
 * live member of. No-op if no auto-enrol class exists for the tenant. Never
 * throws (login/register must not fail on this). The seedStemiCourse comment
 * already names this hook `ensureAutoEnrollMemberships`.
 */
export async function ensureAutoEnrollMemberships(userId, tenant_id) {
    if (!userId) return;
    try {
        await dbRun(
            `INSERT INTO cohort_members (cohort_id, user_id)
             SELECT c.id, ?
               FROM cohorts c
              WHERE c.tenant_id = ?
                AND c.auto_enroll = 1
                AND c.deleted_at IS NULL
                AND NOT EXISTS (
                    SELECT 1 FROM cohort_members m
                     WHERE m.cohort_id = c.id AND m.user_id = ? AND m.deleted_at IS NULL)`,
            [userId, tenant_id, userId]
        );
    } catch (err) {
        routesCasesLog.warn('ensureAutoEnrollMemberships failed', { user_id: userId, tenant_id, error: err.message });
    }
}

/**
 * Enrol one user into one class, idempotently and revive-aware.
 *
 * Lives here (rather than in users-routes.js, where it was born) because three
 * separate paths now need it: the CSV import wizard, the admin roster, and
 * invite redemption. A revived membership resets `status` and clears the
 * enrolment window — without that, re-enrolling someone who was removed leaves
 * them a member who still cannot see anything.
 *
 * @returns {Promise<'already'|'revived'|'enrolled'>}
 */
export async function enrollUserInCohort(cohortId, userId) {
    const existing = await dbGet(
        `SELECT id, deleted_at FROM cohort_members WHERE cohort_id = ? AND user_id = ?
          ORDER BY (deleted_at IS NULL) DESC, id DESC LIMIT 1`,
        [cohortId, userId]
    );
    if (existing && existing.deleted_at == null) return 'already';
    if (existing) {
        await dbRun(
            `UPDATE cohort_members SET deleted_at = NULL, status = 'active', enrolled_from = NULL, enrolled_until = NULL WHERE id = ?`,
            [existing.id]
        );
        return 'revived';
    }
    await dbRun(`INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)`, [cohortId, userId]);
    return 'enrolled';
}

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
    // Oyon tables store tenant_id and user_id as TEXT, so cast explicitly to
    // string when comparing — sqlite does NOT auto-coerce TEXT='1' to
    // INTEGER 1 in equality. Records get anonymised (preserves aggregate
    // analytics value), consents get hard-deleted (consents are personal
    // acts, not aggregates).
    plan.anonymize_retained.oyon_emotion_records = await dbScalar(
        `SELECT COUNT(*) AS count FROM oyon_emotion_records WHERE tenant_id = ? AND user_id = ?`,
        [String(tenant_id), String(userId)]
    );
    plan.hard_delete.oyon_emotion_consents = await dbScalar(
        `SELECT COUNT(*) AS count FROM oyon_emotion_consents WHERE tenant_id = ? AND user_id = ?`,
        [String(tenant_id), String(userId)]
    );
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
        // Oyon: anonymise records (rows kept for aggregate analytics, but
        // the user pointer + name snapshot are scrubbed), then hard-delete
        // consents (a personal act with no aggregate value once the user is
        // gone). String-cast required: oyon tables hold TEXT ids.
        await dbRun(
            `UPDATE oyon_emotion_records
             SET user_id = NULL,
                 student_id = NULL,
                 student_name_snapshot = ?,
                 student_role_snapshot = NULL
             WHERE tenant_id = ? AND user_id = ?`,
            [anonymizedUsername, String(tenant_id), String(userId)]
        );
        await dbRun(
            `DELETE FROM oyon_emotion_consents WHERE tenant_id = ? AND user_id = ?`,
            [String(tenant_id), String(userId)]
        );
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

/**
 * Per-tenant retention sweep for oyon_emotion_records.
 *
 * Each tenant sets its own `oyon_settings.retention_days`. This is independent
 * of the global retention-sweep script's hardcoded TABLES list — Oyon data is
 * privacy-sensitive enough that admins want explicit control per tenant
 * rather than a single global value.
 *
 * Behaviour:
 *   - `retention_days IS NULL` or `<= 0`: tenant opted out of automatic
 *     deletion; no rows touched. (Default for fresh tenants.)
 *   - `retention_days > 0`: rows where `window_start` is older than the
 *     cutoff are hard-deleted. We do NOT anonymise here because retention is
 *     about removing stale data entirely; anonymisation is the user-purge
 *     path.
 *
 * Accepts an optional `runner` { all, run } so the production retention-sweep
 * script can pass its own raw-sqlite3 connection (it doesn't share the
 * dbAdapter singleton) and tests can inject a test-db wrapper. Defaults to
 * dbAdapter for in-process use.
 *
 * Returns a map of tenant_id → deleted row count for logging/tests.
 */
export async function sweepOyonRetention({ runner } = {}) {
    const all = runner?.all ?? dbAll;
    const run = runner?.run ?? dbRun;
    const tenants = await all(
        `SELECT tenant_id, retention_days
         FROM oyon_settings
         WHERE retention_days IS NOT NULL AND retention_days > 0`
    );
    const deletedByTenant = {};
    for (const row of tenants) {
        const days = Math.floor(Number(row.retention_days));
        if (!Number.isFinite(days) || days <= 0) continue;
        const result = await run(
            `DELETE FROM oyon_emotion_records
             WHERE tenant_id = ?
               AND window_start < datetime('now', ? || ' days')`,
            [String(row.tenant_id), `-${days}`]
        );
        deletedByTenant[row.tenant_id] = result?.changes || 0;
    }
    return deletedByTenant;
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
        } catch {
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
/**
 * Resolve the canonical (user_id, case_id) for a given session within a tenant.
 *
 * This is the server-side trinity invariant for learning-analytics writes:
 * the client sends `session_id`; the server derives `user_id` and `case_id`
 * from the sessions row. Client-supplied values for those columns are
 * ignored. A stale/replayed batch can no longer mislabel a row.
 *
 * Returns:
 *   { found: true, user_id, case_id }       — session exists in tenant
 *   { found: false, reason: 'cross_tenant' } — id exists outside tenant or not at all
 *
 * Callers should drop events whose trinity cannot be resolved.
 */
export function resolveSessionTrinity(sessionId, tenant_id) {
    return new Promise((resolve) => {
        if (sessionId === undefined || sessionId === null || sessionId === '') {
            return resolve({ found: false, reason: 'no_session_id' });
        }
        dbAdapter.get(
            'SELECT user_id, case_id FROM sessions WHERE id = ? AND tenant_id = ?',
            [sessionId, tenant_id],
            (err, row) => {
                if (err) return resolve({ found: false, reason: 'db_error' });
                if (!row) return resolve({ found: false, reason: 'cross_tenant' });
                resolve({ found: true, user_id: row.user_id, case_id: row.case_id });
            }
        );
    });
}

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
