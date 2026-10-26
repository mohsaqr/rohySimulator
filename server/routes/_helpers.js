import crypto from 'node:crypto';
import dbAdapter from '../dbAdapter.js';
import {
    resolveTenant,
    ROLE_RANKS,
    VALID_ROLES,
    getRoleRank,
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
import { appendAuditEntry, auditDigest } from '../audit-chain.js';
import { isRoomEnabled } from '../shared/caseRooms.js';

const auditLog = logger('audit');
const routesCasesLog = logger('routes-cases-sessions');

export { redactRow, redactRows };

export const canManageOwnedResource = (ownerId, user) => ownerId === user?.id || hasRoleAtLeast(user, ROLE_RANKS.educator);
export const canReadAcrossUsers = (user) => hasRoleAtLeast(user, ROLE_RANKS.reviewer);
export const isValidRole = (role) => VALID_ROLES.includes(normalizeRole(role));
export const roleForStorage = (role, fallback = 'student') => normalizeRole(role || fallback);
export const tenantId = (req) => resolveTenant(req);

// The default tenant (migrations/0004_tenants.sql seeds it as id 1) is the
// one the install was set up from, and its admins are the only people who
// may act on things that have no tenant: platform_settings (one LLM key,
// one voice key, one registration policy for every tenant), the tenants
// table itself, and moving a user between tenants. A tenant admin is an
// admin of their tenant's users, cases and logs — not of the install
// (security audit 2026-10-24, findings 2 and 9).
export const PLATFORM_TENANT_ID = 1;
export const isPlatformAdmin = (user) =>
    hasRoleAtLeast(user, ROLE_RANKS.admin) && Number(user?.tenant_id ?? PLATFORM_TENANT_ID) === PLATFORM_TENANT_ID;

export function requirePlatformAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasRoleAtLeast(req.user, ROLE_RANKS.admin)) {
        return res.status(403).json({ error: 'Insufficient role' });
    }
    if (!isPlatformAdmin(req.user)) {
        return res.status(403).json({ error: 'Platform administrator required', code: 'platform_admin_required' });
    }
    next();
}

/** Rank of a role or user — re-exported so route files need one import. */
export { getRoleRank };

/**
 * Escape a user-typed search term for a `LIKE ? ESCAPE '\\'` clause: `%`, `_`
 * and the escape character itself become literals, so a learner typing `_`
 * matches an underscore rather than any character.
 */
export function escapeLikeTerm(value) {
    return String(value ?? '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Parse a page size from the query string: an integer clamped to [1, max],
 * `fallback` when absent or not an integer (so `limit=-1` and `limit=abc`
 * cannot mean "everything").
 */
export function clampLimit(raw, fallback, max) {
    if (raw === undefined || raw === null || raw === '') return Math.min(fallback, max);
    const n = Number(raw);
    if (!Number.isInteger(n)) return Math.min(fallback, max);
    return Math.min(Math.max(n, 1), max);
}

/** Parse an offset from the query string: a non-negative integer, else 0. */
export function clampOffset(raw, max = 100000) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return 0;
    return Math.min(n, max);
}

// --- Cohort-case access enforcement (class-centric, date-windowed) ----------
// Enforcement is ON unless an admin turns it off (Settings → Courses → Course
// access, stored as the platform flag `enforce_cohort_case_access`). It only
// applies to sub-reviewer ranks (students); reviewer/educator/admin always
// bypass. It used to be opt-in, which made course membership look broken: a
// student added to a course saw nothing new, because every student already saw
// every case (Prova FI0010.AUTHOR.02). An absent flag now means ON; only an
// explicit 'false'/'0' turns it off. An unreadable flag also falls back to ON —
// for an access rule, failing closed is the safe side.

/** What an install that never touched the switch gets. */
export const COHORT_CASE_ENFORCEMENT_DEFAULT = true;

/** The flag's stored text → on/off, with absent meaning the default. */
export function parseCohortCaseEnforcement(value) {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return COHORT_CASE_ENFORCEMENT_DEFAULT;
}

/** True when the caller ranks below reviewer, i.e. enforcement *could* apply. */
export const isEnforcedStudent = (user) => !canReadAcrossUsers(user);

let _enforceCache = { value: null, at: 0 };
const ENFORCE_CACHE_MS = 15000;

/** Read the global enforcement flag (cached ~15s; absent or unreadable = ON). */
export async function cohortCaseEnforcementOn() {
    const now = Date.now();
    if (_enforceCache.value !== null && now - _enforceCache.at < ENFORCE_CACHE_MS) {
        return _enforceCache.value;
    }
    try {
        const row = await dbGet(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'enforce_cohort_case_access'`
        );
        const on = parseCohortCaseEnforcement(row?.setting_value);
        _enforceCache = { value: on, at: now };
        return on;
    } catch {
        return COHORT_CASE_ENFORCEMENT_DEFAULT;
    }
}

/** Drop the cached flag after a toggle (admin route / tests call this). */
export function resetCohortCaseEnforcementCache() {
    _enforceCache = { value: null, at: 0 };
}

/**
 * The single gate every case-visibility site shares: catalog (GET /cases),
 * direct read (GET /cases/:id) and session launch (POST /sessions). True only
 * when the caller is below reviewer rank AND enforcement is on. Call this
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
 * The closing half of a date window: "this bound has not passed yet".
 *
 * A teacher who types 2026-03-31 into an "available until" box means the case is
 * open THROUGH the 31st. SQLite reads a bare date as midnight, so a plain
 * `datetime(bound) >= datetime('now')` closed the case at 00:00 on the 31st and
 * silently ate the whole final day — including the deadline day of a class.
 * A date-only bound therefore expires at the END of that day; a bound with a time
 * component is respected to the second, because someone who wrote one meant it.
 *
 * `learningEventAggregates.isDateOnly` makes the identical distinction for the
 * analytics filters. `column` is a trusted internal literal, never request input.
 */
function liveUntil(column) {
    return `(${column} IS NULL OR
             datetime(${column}, CASE WHEN length(${column}) = 10 THEN '+1 day' ELSE '+0 seconds' END)
               > datetime('now'))`;
}

/**
 * SQL conditions: `cm` is a live, active, in-window membership of a live,
 * in-window course `co`. All time comparisons wrap both sides in datetime()
 * because cohort windows are stored as ISO strings while CURRENT_TIMESTAMP
 * columns use 'YYYY-MM-DD HH:MM:SS' — the two are not lexically comparable.
 */
export const ACTIVE_MEMBERSHIP = `
           co.deleted_at IS NULL
           AND cm.deleted_at IS NULL
           AND cm.status = 'active'
           AND (co.starts_at IS NULL OR datetime(co.starts_at) <= datetime('now'))
           AND ${liveUntil('co.ends_at')}
           AND (cm.enrolled_from IS NULL OR datetime(cm.enrolled_from) <= datetime('now'))
           AND ${liveUntil('cm.enrolled_until')}`;

// A course's own "members also get the default case" setting, read from its
// settings JSON. CASE guards json_extract: one malformed settings blob must not
// turn every student's case list into a 500.
const COURSE_GIVES_DEFAULT_CASE =
    `(CASE WHEN json_valid(co.settings) THEN json_extract(co.settings, '$.default_case_access') END) = 1`;

/**
 * Which cases a student may see while course access is enforced — the ONE rule
 * the catalogue, the direct read, session launch and the case-course routes
 * share. Returns the SQL condition for the cases-row alias and the binds it
 * needs, in order (every bind is the student's user id).
 *
 *  - Any case assigned (in-window) to a course the student is an active member
 *    of — except that the default case's own link to the DEFAULT course grants
 *    nothing on its own (that link exists on every install; see below).
 *  - The default case (`cases.is_default`), which is for people who registered
 *    themselves: shown when the student belongs to no course other than the
 *    default course, or when some course they are active in says
 *    `settings.default_case_access: true`. A student invited into a course
 *    does not get it unless that course allows it — and membership of a course
 *    that does not allow it wins over also being in the default course.
 *
 * "Belongs to another course" counts every live membership, active or not and
 * in its window or not: a student whose course starts next week has still been
 * invited into it, and is not a self-registered learner in the meantime.
 *
 * @param {string} caseAlias  trusted internal literal naming the cases row
 * @returns {{sql: string, binds: (userId: number) => number[]}}
 */
export function studentCaseVisibility(caseAlias = 'c') {
    const c = caseAlias;
    const sql = `(
        EXISTS (
            SELECT 1
              FROM cohort_cases cc
              JOIN cohorts co ON co.id = cc.cohort_id
              JOIN cohort_members cm ON cm.cohort_id = co.id
             WHERE cc.case_id = ${c}.id
               AND cc.deleted_at IS NULL
               AND co.tenant_id = ${c}.tenant_id
               AND cm.user_id = ?
               AND ${ACTIVE_MEMBERSHIP}
               AND (cc.available_from IS NULL OR datetime(cc.available_from) <= datetime('now'))
               AND ${liveUntil('cc.available_until')}
               AND NOT (${c}.is_default = 1 AND co.is_default = 1)
        )
        OR ( ${c}.is_default = 1 AND (
            EXISTS (
                SELECT 1
                  FROM cohorts co
                  JOIN cohort_members cm ON cm.cohort_id = co.id
                 WHERE co.tenant_id = ${c}.tenant_id
                   AND co.is_default = 0
                   AND cm.user_id = ?
                   AND ${ACTIVE_MEMBERSHIP}
                   AND ${COURSE_GIVES_DEFAULT_CASE}
            )
            OR NOT EXISTS (
                SELECT 1
                  FROM cohorts co
                  JOIN cohort_members cm ON cm.cohort_id = co.id
                 WHERE co.tenant_id = ${c}.tenant_id
                   AND co.is_default = 0
                   AND co.deleted_at IS NULL
                   AND cm.user_id = ?
                   AND cm.deleted_at IS NULL
            )
        ))
    )`;
    return { sql, binds: (userId) => [userId, userId, userId] };
}

/**
 * Idempotently enrol a user into every AUTO-ENROL class in their tenant
 * (`cohorts.auto_enroll = 1`, the default "Basic course") — where people who
 * register themselves land, so they always have something to open. Skipped for
 * a user who is already in any other course: an invited student gets their
 * course, not the default one. Callers that enrol into a specific course must
 * do that FIRST. One INSERT per matching cohort the user has never been a
 * member of. No-op if no auto-enrol class exists for the tenant. Never
 * throws (login/register must not fail on this). The seedStemiCourse comment
 * already names this hook `ensureAutoEnrollMemberships`.
 */
export async function ensureAutoEnrollMemberships(userId, tenant_id) {
    if (!userId) return;
    try {
        // The NOT EXISTS deliberately looks at EVERY membership row, live or
        // soft-deleted. It used to filter `m.deleted_at IS NULL`, which meant a
        // removed membership did not block a fresh insert — and because this runs
        // on every LOGIN, a student a teacher had just unenrolled from an
        // auto-enrol course was silently put back the next time they signed in.
        // Back on the roster, back in the analytics, back in the case list. An
        // unenrolment is a decision; a soft-deleted row is the record of it, and
        // auto-enrolment must not overrule it. (Re-adding them by hand still works
        // — upsertMember revives the row.)
        await dbRun(
            `INSERT INTO cohort_members (cohort_id, user_id)
             SELECT c.id, ?
               FROM cohorts c
              WHERE c.tenant_id = ?
                AND c.auto_enroll = 1
                AND c.deleted_at IS NULL
                AND NOT EXISTS (
                    SELECT 1 FROM cohort_members m
                     WHERE m.cohort_id = c.id AND m.user_id = ?)
                -- The default course is for people who registered themselves.
                -- Someone already in another course (invited into it, imported
                -- into a class, added by a teacher) is not swept into it — and
                -- with it its cases — at their next login.
                AND NOT EXISTS (
                    SELECT 1 FROM cohort_members m2
                      JOIN cohorts c2 ON c2.id = m2.cohort_id
                     WHERE m2.user_id = ?
                       AND m2.deleted_at IS NULL
                       AND c2.tenant_id = ?
                       AND c2.auto_enroll = 0
                       AND c2.deleted_at IS NULL)`,
            [userId, tenant_id, userId, userId, tenant_id]
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
    // Case questionnaire answers (0067): free text in the learner's own words,
    // deleted like the older questionnaire_responses, not anonymised.
    'case_questionnaire_responses',
    // Which slides the user's browser loaded (0068): a trace of one person's
    // activity, with nothing in it worth keeping anonymised.
    'plugin_content_reads',
    // A learner's work in a plugin room (0069): their own report prose and
    // annotations — deleted with them, like questionnaire answers.
    'plugin_session_documents',
    // How the user read the pathology slides (0070): their scored read.
    'pathology_read_assessments',
    'export_records',
    'llm_usage',
    'tts_usage'
];

export const RETENTION_TABLES = [
    { table: 'event_log', column: 'timestamp', userColumn: 'user_id' },
    { table: 'learning_events', column: 'timestamp', userColumn: 'user_id' },
    // The quarantine (0056): diagnostic, not evidentiary — same horizon, same
    // anonymise-on-purge contract (user_id is the principal who posted).
    { table: 'learning_events_rejected', column: 'received_at', userColumn: 'user_id' },
    { table: 'interactions', column: 'timestamp', userColumn: null },
    // system_audit_log is absent on purpose: its rows form a hash chain
    // (server/audit-chain.js), so deleting by age or anonymising in place
    // breaks verification. scripts/sweep-retention.js refuses it for the
    // same reason (security audit 2026-10-24, SEC-41).
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
 * The first required body field that is missing, or null when all are there.
 *
 * For the columns a route inserts into a NOT NULL column with no default:
 * without the check the INSERT fails with SQLITE_CONSTRAINT and the route
 * answers 500 for what is the client's mistake (found by the API fuzzer,
 * scripts/fuzz-api.sh). "Missing" is exactly what NOT NULL refuses — undefined
 * or null; an empty string was stored before and still is. A body that is not
 * a plain object (a JSON array) is missing every field.
 *
 * @param {*} body req.body
 * @param {string[]} fields
 * @returns {string|null}
 */
export function missingField(body, fields) {
    const obj = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
    return fields.find((field) => {
        const value = obj[field];
        return value === undefined || value === null;
    }) ?? null;
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
 * The tenant an audit row belongs to. A caller should pass `tenantId` (or use
 * `auditSuccess(req, …)`, which does). When it does not, the row used to be
 * filed under tenant 1 — so another tenant's privileged changes landed in the
 * default tenant's audit log, persona prompts included, and their own admins
 * never saw them (security audit 2026-10-26, F-19 / L2-06). Now the tenant is
 * taken from `req` when one is passed, else from the acting user's row; only
 * an event with no acting user at all (a failed login for an unknown name) is
 * the install's, i.e. the platform tenant's.
 *
 * @param {Object} params
 * @returns {Promise<number>}
 */
export async function resolveAuditTenant(params) {
    const explicit = params.tenantId ?? params.tenant_id;
    if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit);
    if (params.req?.user) return Number(tenantId(params.req));
    const userId = params.userId ?? null;
    if (userId !== null && userId !== undefined) {
        try {
            const row = await dbAdapter.get('SELECT tenant_id FROM users WHERE id = ?', [userId]);
            if (row?.tenant_id !== undefined && row?.tenant_id !== null) {
                auditLog.debug('audit row without tenant; derived from the acting user', { action: params.action, user_id: userId });
                return Number(row.tenant_id);
            }
        } catch (err) {
            auditLog.warn('audit tenant lookup failed', { action: params.action, user_id: userId, error: err.message });
        }
    }
    return PLATFORM_TENANT_ID;
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

    void resolveAuditTenant(params).then((tenant_id) => appendAuditEntry({
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
    })).catch((err) => {
        auditLog.warn('audit log write failed', {
            action,
            resource_type: resourceType ?? targetType ?? null,
            resource_id: resourceId ?? targetId ?? null,
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

    return resolveAuditTenant(params).then((tenant_id) => appendAuditEntry({
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
    }));
}

/**
 * COMMIT the open transaction, then — and only then — run `onCommitted`
 * (audit + response). A bare `dbAdapter.run('COMMIT')` followed by
 * `res.json()` answers before the commit lands, so a reader on another
 * connection can still see the old rows after a 2xx, and the audit chain
 * records a success for a change that may never commit. A COMMIT that fails
 * is rolled back and answered 500 with `code: 'COMMIT_FAILED'`.
 *
 * @param {import('express').Request} req   for the request-scoped logger
 * @param {import('express').Response} res
 * @param {() => void} onCommitted          audit + response; runs once, after COMMIT
 */
export function commitThen(req, res, onCommitted) {
    dbAdapter.run('COMMIT', [], (err) => {
        if (!err) return onCommitted();
        (req.log ?? routesCasesLog).error('COMMIT failed; rolling back', { error: err.message });
        dbAdapter.run('ROLLBACK', [], (rollbackErr) => {
            // A failed COMMIT may already have ended the transaction; say so
            // rather than letting the adapter log it as an unhandled failure.
            if (rollbackErr) (req.log ?? routesCasesLog).warn('ROLLBACK after failed COMMIT', { error: rollbackErr.message });
        });
        res.status(500).json({ error: 'Could not save the change', code: 'COMMIT_FAILED' });
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

// ---------------------------------------------------------------------------
// User purge (GDPR erasure)
//
// ONE list of steps drives both the dry-run plan an admin reads and the purge
// itself, so the plan can no longer claim what the purge does not do (security
// audit 2026-10-26, L7-04: client_logs and learning_events_rejected were
// reported "anonymised" and never touched, and seven tables holding the
// person's data — the two Oyon signal tables, registration requests, terms
// acceptances, course memberships, lesson progress, survey responses and the
// usage budget — were missed outright). Each step names its category, its
// table, how its rows are counted, and the statement that handles them; the
// plan runs the counts, the purge runs the statements, in this order.
//
// Category meanings (the plan's keys):
//   soft_delete         domain rows the user authored: hidden (deleted_at) and
//                       detached from the user;
//   hard_delete         the person's own rows with nothing worth keeping
//                       anonymised: deleted;
//   anonymize_retained  operational / aggregate rows kept with the person
//                       removed (user id NULLed, name -> pseudonym, IP/UA NULL);
//   detach              catalogue rows that merely record who last touched them.
// The user row itself is retained, deactivated, renamed to the pseudonym and
// stripped of PII (`anonymize_user`).
// ---------------------------------------------------------------------------

/**
 * A fresh pseudonym for a purged account. Random — the earlier
 * `deleted_user_<id>` kept the original id, and every retained row still
 * carries that id, so the pseudonym re-identified the person to anyone who
 * could read the audit log or registration requests. Generated once per purge
 * and stored (users.username, sessions.student_name, …); never derived.
 * @returns {string} `deleted_user_<16 hex>`
 */
export function newPurgePseudonym() {
    return `deleted_user_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * What the purge's own audit row may say about who was erased: the pseudonym
 * and a keyed digest of the former username (so an operator who is asked
 * "was X erased?" can check), never the username itself — the audit chain
 * cannot be edited later, so a clear name there would outlive the erasure.
 * @param {{username?: string|null}} targetUser
 * @param {string} pseudonym
 * @returns {{pseudonym: string, former_username_digest: string|null}}
 */
export function purgeAuditIdentity(targetUser, pseudonym) {
    return {
        pseudonym,
        former_username_digest: targetUser?.username ? auditDigest(String(targetUser.username)) : null,
    };
}

const inMarks = (ids) => ids.map(() => '?').join(',');

/**
 * The purge steps for one user. `ctx` = { userId, tenant_id, authoredCaseIds,
 * pseudonym, email }. Oyon tables hold tenant_id and user_id as TEXT, and
 * sqlite does not coerce TEXT '1' = INTEGER 1, so those binds are strings.
 */
function purgeSteps(ctx) {
    const { userId, tenant_id: tenant, authoredCaseIds = [], pseudonym = null, email = null } = ctx;
    const uid = userId;
    const sTenant = String(tenant);
    const sUid = String(userId);
    const steps = [];
    const step = (category, table, count, exec) => steps.push({ category, table, count, exec });

    // --- soft_delete -------------------------------------------------------
    step('soft_delete', 'cases',
        [`SELECT COUNT(*) AS count FROM cases WHERE tenant_id = ? AND (created_by = ? OR last_modified_by = ?)`, [tenant, uid, uid]],
        [`UPDATE cases SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL, last_modified_by = NULL
          WHERE tenant_id = ? AND (created_by = ? OR last_modified_by = ?)`, [tenant, uid, uid]]);
    if (authoredCaseIds.length > 0) {
        const marks = inMarks(authoredCaseIds);
        step('soft_delete', 'case_investigations',
            [`SELECT COUNT(*) AS count FROM case_investigations
              WHERE tenant_id = ? AND deleted_at IS NULL AND case_id IN (${marks})`, [tenant, ...authoredCaseIds]],
            [`UPDATE case_investigations SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
              WHERE tenant_id = ? AND case_id IN (${marks})`, [tenant, ...authoredCaseIds]]);
    } else {
        step('soft_delete', 'case_investigations', null, null);
    }
    step('soft_delete', 'sessions',
        [`SELECT COUNT(*) AS count FROM sessions WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
        [`UPDATE sessions SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), user_id = NULL, student_name = ?
          WHERE tenant_id = ? AND user_id = ?`, [pseudonym, tenant, uid]]);
    step('soft_delete', 'agent_templates',
        [`SELECT COUNT(*) AS count FROM agent_templates WHERE tenant_id = ? AND created_by = ?`, [tenant, uid]],
        [`UPDATE agent_templates SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL
          WHERE tenant_id = ? AND created_by = ?`, [tenant, uid]]);
    step('soft_delete', 'scenarios',
        [`SELECT COUNT(*) AS count FROM scenarios WHERE tenant_id = ? AND created_by = ?`, [tenant, uid]],
        [`UPDATE scenarios SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL
          WHERE tenant_id = ? AND created_by = ?`, [tenant, uid]]);
    // lab_definitions is a global master catalog (no tenant_id column);
    // detach by created_by only.
    step('soft_delete', 'lab_definitions',
        [`SELECT COUNT(*) AS count FROM lab_definitions WHERE created_by = ?`, [uid]],
        [`UPDATE lab_definitions SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), created_by = NULL
          WHERE created_by = ?`, [uid]]);
    step('soft_delete', 'clinical_notes',
        [`SELECT COUNT(*) AS count FROM clinical_notes WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
        [`UPDATE clinical_notes SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
          WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]]);

    // --- hard_delete -------------------------------------------------------
    for (const table of HARD_DELETE_ON_PURGE_TABLES) {
        step('hard_delete', table,
            [`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
            [`DELETE FROM ${table} WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]]);
    }
    // Consents are personal acts with no aggregate value once the user is gone.
    step('hard_delete', 'oyon_emotion_consents',
        [`SELECT COUNT(*) AS count FROM oyon_emotion_consents WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]],
        [`DELETE FROM oyon_emotion_consents WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]]);
    // Keystroke timing, pointer, voice and heart-rate-only windows, and the
    // typing / voice state sequences: deleted like the learner's own
    // self-service deletion does (their user_id is NOT NULL, so they cannot be
    // anonymised in place).
    step('hard_delete', 'oyon_signal_windows',
        [`SELECT COUNT(*) AS count FROM oyon_signal_windows WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]],
        [`DELETE FROM oyon_signal_windows WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]]);
    step('hard_delete', 'oyon_signal_events',
        [`SELECT COUNT(*) AS count FROM oyon_signal_events WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]],
        [`DELETE FROM oyon_signal_events WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]]);
    // Course membership and lesson progress have no tenant column of their
    // own; the course's tenant scopes them.
    step('hard_delete', 'cohort_members',
        [`SELECT COUNT(*) AS count FROM cohort_members
          WHERE user_id = ? AND cohort_id IN (SELECT id FROM cohorts WHERE tenant_id = ?)`, [uid, tenant]],
        [`DELETE FROM cohort_members
          WHERE user_id = ? AND cohort_id IN (SELECT id FROM cohorts WHERE tenant_id = ?)`, [uid, tenant]]);
    step('hard_delete', 'lesson_progress',
        [`SELECT COUNT(*) AS count FROM lesson_progress
          WHERE user_id = ? AND cohort_id IN (SELECT id FROM cohorts WHERE tenant_id = ?)`, [uid, tenant]],
        [`DELETE FROM lesson_progress
          WHERE user_id = ? AND cohort_id IN (SELECT id FROM cohorts WHERE tenant_id = ?)`, [uid, tenant]]);
    step('hard_delete', 'usage_budget',
        [`SELECT COUNT(*) AS count FROM usage_budget WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
        [`DELETE FROM usage_budget WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]]);

    // --- anonymize_retained -----------------------------------------------
    // system_audit_log is deliberately NOT here: every row's entry_hash
    // covers user_id, so nulling it in place made verifyAuditChain report
    // tampering after every purge (security audit 2026-10-24, SEC-41). The
    // purge_user entry the route appends records the erasure in the chain.
    for (const table of ['event_log', 'learning_events', 'llm_request_log', 'settings_logs',
        'session_settings', 'physical_exam_findings', 'emotion_logs', 'learning_events_rejected', 'client_logs']) {
        step('anonymize_retained', table,
            [`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
            // Table name from the literal list above, never a request value.
            [`UPDATE ${table}
                 SET user_id = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]]);
    }
    step('anonymize_retained', 'login_logs',
        [`SELECT COUNT(*) AS count FROM login_logs WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
        [`UPDATE login_logs SET user_id = NULL, username = ? WHERE tenant_id = ? AND user_id = ?`, [pseudonym, tenant, uid]]);
    // Records kept for aggregate analytics; the person and the name snapshot go.
    step('anonymize_retained', 'oyon_emotion_records',
        [`SELECT COUNT(*) AS count FROM oyon_emotion_records WHERE tenant_id = ? AND user_id = ?`, [sTenant, sUid]],
        [`UPDATE oyon_emotion_records
             SET user_id = NULL, student_id = NULL, student_name_snapshot = ?, student_role_snapshot = NULL
           WHERE tenant_id = ? AND user_id = ?`, [pseudonym, sTenant, sUid]]);
    // The fact of acceptance (version, title, body, time) is kept — it is the
    // record that the terms were accepted. Where it was accepted from is not.
    step('anonymize_retained', 'terms_acceptances',
        [`SELECT COUNT(*) AS count FROM terms_acceptances WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]],
        [`UPDATE terms_acceptances SET ip_address = NULL, user_agent = NULL WHERE tenant_id = ? AND user_id = ?`, [tenant, uid]]);
    // The application that created the account, and any other request from
    // the same address: kept as a decided request, with nothing of the person.
    step('anonymize_retained', 'registration_requests',
        [`SELECT COUNT(*) AS count FROM registration_requests
          WHERE tenant_id = ? AND (user_id = ? OR (? IS NOT NULL AND lower(email) = lower(?)))`, [tenant, uid, email, email]],
        [`UPDATE registration_requests
             SET username = ?, name = NULL, email = '', ip_address = NULL, decision_note = NULL,
                 password_hash = '', user_id = NULL
           WHERE tenant_id = ? AND (user_id = ? OR (? IS NOT NULL AND lower(email) = lower(?)))`, [pseudonym, tenant, uid, email, email]]);
    step('anonymize_retained', 'registration_invite_uses',
        [`SELECT COUNT(*) AS count FROM registration_invite_uses
          WHERE user_id = ? AND invite_id IN (SELECT id FROM registration_invites WHERE tenant_id = ?)`, [uid, tenant]],
        [`UPDATE registration_invite_uses SET user_id = NULL, ip_address = NULL
          WHERE user_id = ? AND invite_id IN (SELECT id FROM registration_invites WHERE tenant_id = ?)`, [uid, tenant]]);
    // Answers stay in the survey's results, unattributed. The dedupe key of a
    // named response embeds the user id, so it goes too.
    step('anonymize_retained', 'survey_responses',
        [`SELECT COUNT(*) AS count FROM survey_responses
          WHERE user_id = ? AND survey_id IN (SELECT id FROM surveys WHERE tenant_id = ?)`, [uid, tenant]],
        [`UPDATE survey_responses SET user_id = NULL, dedupe_key = NULL
          WHERE user_id = ? AND survey_id IN (SELECT id FROM surveys WHERE tenant_id = ?)`, [uid, tenant]]);

    // --- detach -------------------------------------------------------------
    step('detach', 'platform_settings',
        [`SELECT COUNT(*) AS count FROM platform_settings WHERE updated_by = ?`, [uid]],
        [`UPDATE platform_settings SET updated_by = NULL WHERE updated_by = ?`, [uid]]);
    step('detach', 'scenario_templates',
        [`SELECT COUNT(*) AS count FROM scenario_templates WHERE created_by = ?`, [uid]],
        [`UPDATE scenario_templates SET created_by = NULL WHERE created_by = ?`, [uid]]);
    step('detach', 'scenario_events',
        [`SELECT COUNT(*) AS count FROM scenario_events WHERE tenant_id = ? AND acknowledged_by = ?`, [tenant, uid]],
        [`UPDATE scenario_events SET acknowledged_by = NULL WHERE tenant_id = ? AND acknowledged_by = ?`, [tenant, uid]]);
    return steps;
}

/** `{ category: [table, …] }` for every table the purge touches — the plan's shape. */
export function purgeTablesByCategory() {
    const out = { soft_delete: [], hard_delete: [], anonymize_retained: [], detach: [] };
    for (const s of purgeSteps({ userId: 0, tenant_id: 0, authoredCaseIds: [0] })) {
        if (!out[s.category].includes(s.table)) out[s.category].push(s.table);
    }
    return out;
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
    const user = await dbGet('SELECT email FROM users WHERE id = ? AND tenant_id = ?', [userId, tenant_id]);

    const plan = { soft_delete: {}, hard_delete: {}, anonymize_retained: {}, detach: {}, anonymize_user: 1 };
    for (const s of purgeSteps({ userId, tenant_id, authoredCaseIds, email: user?.email ?? null })) {
        plan[s.category][s.table] = s.count ? await dbScalar(s.count[0], s.count[1]) : 0;
    }
    return { plan, authoredCaseIds, sessionIds };
}

/**
 * Run the purge: every step of purgeSteps, then the user row, in ONE
 * transaction on a connection of its own (dbAdapter.isolatedTransaction) — the
 * shared-handle BEGIN this used could take in another request's half-finished
 * writes and commit or roll them back with the purge (security audit
 * 2026-10-26, L7-11).
 *
 * @returns {Promise<{touched: {category: string, table: string, changes: number}[]}>}
 *          one entry per step, in plan order — the same tables the plan lists
 */
export async function executeUserPurge({ userId, tenant_id, anonymizedUsername, passwordHash, authoredCaseIds }) {
    return dbAdapter.isolatedTransaction(async (tx) => {
        const user = await tx.get('SELECT email FROM users WHERE id = ? AND tenant_id = ?', [userId, tenant_id]);
        const touched = [];
        for (const s of purgeSteps({
            userId, tenant_id, authoredCaseIds: authoredCaseIds || [], pseudonym: anonymizedUsername, email: user?.email ?? null,
        })) {
            const result = s.exec ? await tx.run(s.exec[0], s.exec[1]) : { changes: 0 };
            touched.push({ category: s.category, table: s.table, changes: result.changes || 0 });
        }
        await tx.run(
            `UPDATE users SET
                username = ?, name = NULL, email = NULL, password_hash = ?, role = 'student',
                department = NULL, status = 'inactive', last_login = NULL, failed_login_attempts = 0,
                locked_until = NULL, updated_at = CURRENT_TIMESTAMP, deleted_at = CURRENT_TIMESTAMP,
                institution = NULL, address = NULL, phone = NULL, alternative_email = NULL,
                education = NULL, grade = NULL
             WHERE id = ? AND tenant_id = ?`,
            [anonymizedUsername, passwordHash, userId, tenant_id]
        );
        return { touched };
    });
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

/**
 * The case config a session runs on (snapshot first), or null when the
 * session is not in this tenant.
 *
 * @param {number|string} sessionId
 * @param {number} tenant
 * @returns {Promise<object|null>}
 */
export async function loadSessionCaseConfig(sessionId, tenant) {
    const row = await dbAdapter.get(
        `SELECT s.case_snapshot, c.config
           FROM sessions s
           LEFT JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
          WHERE s.id = ? AND s.tenant_id = ?`,
        [sessionId, tenant]
    );
    return row ? resolveSessionCaseConfig(row) : null;
}

/**
 * Refuse a learner's action in a room the session's case has switched off
 * (config.rooms, shared/caseRooms.js). Hiding the room is the client's half;
 * this is the half a learner's own client cannot skip.
 *
 * Passes when ANY of `roomKeys` is on (an exam finding can be taken from the
 * examination room or the bedside). Reviewers and above pass: they preview
 * cases, and the client hides the room from them anyway. A session that does
 * not resolve passes too — the caller's own ownership check answers that.
 *
 * @param {object} req
 * @param {object} res
 * @param {number|string} sessionId
 * @param {string[]} roomKeys
 * @returns {Promise<boolean>} true when the action may go ahead; false once a
 *          403 {code:'room_disabled'} (or a 500) has been sent
 */
export async function requireSessionRoom(req, res, sessionId, roomKeys) {
    if (hasRoleAtLeast(req.user, ROLE_RANKS.reviewer)) return true;
    let config;
    try {
        config = await loadSessionCaseConfig(sessionId, tenantId(req));
    } catch (err) {
        (req.log || routesCasesLog).error('session room check failed', { error: err.message });
        res.status(500).json({ error: err.message });
        return false;
    }
    if (config === null || roomKeys.some((key) => isRoomEnabled(config, key))) return true;
    res.status(403).json({ error: 'This room is switched off for this case', code: 'room_disabled' });
    return false;
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

/**
 * Append a version snapshot of a case. Resolves once the row is written.
 *
 * ONE statement: the next version number is computed inside the INSERT, so
 * it is atomic. It used to be a SELECT MAX followed by a separate INSERT,
 * fire-and-forget — two quick saves could take the same number, and a route
 * answered before its version existed, so a History list (or a restore)
 * read right after a save could miss it (a CI flake in
 * case-gender-i18n.test.js, 2026-10-04). Callers await it before answering.
 * A failure is logged and resolved, never rejected: a missing version must
 * not fail the save it describes.
 *
 * @returns {Promise<void>}
 */
export function createCaseVersion(caseId, userId, changeType, description, configSnapshot) {
    return new Promise((resolve) => {
        dbAdapter.run(
            `INSERT INTO case_versions (case_id, version_number, changed_by, change_type, changes_description, config_snapshot, tenant_id)
             SELECT ?, COALESCE(MAX(version_number), 0) + 1, ?, ?, ?, ?, ?
               FROM case_versions WHERE case_id = ?`,
            [caseId, userId, changeType, description, JSON.stringify(configSnapshot), configSnapshot?.tenant_id || 1, caseId],
            (err) => {
                if (err) routesCasesLog.error('case version create failed', { error: err.message });
                resolve();
            }
        );
    });
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
 * `principal` — pass it on any path where the SESSION ID CAME FROM THE CLIENT.
 * Deriving the trinity from the sessions row stops a caller *mislabelling* a
 * row, but on its own it does the opposite of protecting the victim: a
 * same-tenant user who guesses another learner's integer session id gets an
 * event written under THAT learner's user_id and case_id, correctly attributed
 * by the server to someone who never performed it. Forged rows then flow
 * straight into the analytics the platform exists to produce. With `principal`
 * supplied, a session the principal does not own resolves to
 * { found: false, reason: 'not_owner' }.
 *
 * Omit `principal` only where the server itself chose the session id and is
 * deliberately writing on the owner's behalf — the instructor lab-value edit in
 * orders-routes.js is the one such caller, and it is reached through its own
 * educator guard.
 *
 * Returns:
 *   { found: true, user_id, case_id }        — session exists, and is the principal's
 *   { found: false, reason: 'cross_tenant' } — id exists outside tenant, is soft-deleted, or not at all
 *   { found: false, reason: 'not_owner' }    — exists in tenant, belongs to someone else
 *
 * Callers should drop events whose trinity cannot be resolved.
 */
export function resolveSessionTrinity(sessionId, tenant_id, { principal = null } = {}) {
    return new Promise((resolve) => {
        if (sessionId === undefined || sessionId === null || sessionId === '') {
            return resolve({ found: false, reason: 'no_session_id' });
        }
        // `deleted_at IS NULL`: a soft-deleted session is a right-to-erasure
        // tombstone. Writing a fresh event against it re-creates analysable
        // activity for a person who asked to be forgotten, and the purge has
        // already run — nothing would come back to collect it.
        dbAdapter.get(
            'SELECT user_id, case_id FROM sessions WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [sessionId, tenant_id],
            (err, row) => {
                if (err) return resolve({ found: false, reason: 'db_error' });
                if (!row) return resolve({ found: false, reason: 'cross_tenant' });
                // Rank does NOT widen this. verifySessionOwnership lets staff
                // reach any session in their tenant because reaching is reading
                // and acting AS THEMSELVES; here the write is attributed to the
                // session owner, so an educator bypass would let staff author
                // learner activity that is indistinguishable from the learner's
                // own. Nobody needs that, so nobody gets it.
                if (principal && Number(row.user_id) !== Number(principal.id)) {
                    return resolve({ found: false, reason: 'not_owner' });
                }
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
        // Educators and above may reach any session — but only in their OWN
        // tenant, and only one that exists. The old short-circuit returned true
        // here without touching the DB, which meant an educator in tenant B
        // passed the gate for a session id belonging to tenant A. Most callers
        // re-scope their own queries by tenant and so degraded to an empty
        // result, but the hand-rolled order routes did not — making this the
        // hinge of a cross-tenant mutation. Rank widens WHOSE sessions you may
        // touch; it never widens WHICH TENANT.
        const staff = hasRoleAtLeast(user, ROLE_RANKS.educator);
        // `deleted_at IS NULL`: an erased session (user purge, retention
        // sweep) is gone for every reader, staff included.
        dbAdapter.get('SELECT user_id, tenant_id FROM sessions WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [sessionId, user?.tenant_id || 1], (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return resolve(false);
            }
            if (!row) {
                res.status(404).json({ error: 'Session not found' });
                return resolve(false);
            }
            if (!staff && row.user_id !== user?.id) {
                res.status(403).json({ error: 'Access denied: session not owned by user' });
                return resolve(false);
            }
            resolve(true);
        });
    });
}
