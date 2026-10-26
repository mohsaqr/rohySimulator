// The one read policy for Oyon (affect / gaze / physiological) rows, for every
// reader OUTSIDE the Oyon router as well as inside it.
//
// The Oyon router enforced its policy in one place (assertOyonReadAccess +
// the per-row *_can_view columns), but four analytics routes read
// `oyon_emotion_records` directly with only "reviewer or above reads
// everyone" — so a reviewer got every learner's affect and gaze, an educator
// kept it after the admin switched educator view off, rows captured while a
// role's view was off were shown anyway, and a learner saw their own windows
// with student view off (security audit 2026-10-26, F-03 / L7-01). Educators
// also read every learner in the tenant, where the terms promise "the
// learner's educators" (L2-12 / F-35 / L7-09).
//
// The policy, per caller:
//   admin+     tenant flag admin_emotion_view_enabled, rows admin_can_view = 1,
//              every learner of the tenant.
//   educator   tenant flag educator_emotion_view_enabled, rows
//              educator_can_view = 1, and only learners who are live student
//              members of a course the educator owns or co-teaches.
//   anyone     their OWN rows when the tenant flag student_emotion_view_enabled
//   else       is on and the row has student_can_view = 1 (the self path of
//              GET /addons/oyon/student/me). Reviewers have no cross-user view.
// A staff member whose role view is off falls back to the self path.
//
// Two entry points:
//   assertOyonReadAccess(req, res, settings)  the Oyon router's gate for its
//       educator+ surfaces (role + per-role flag) — same answers and codes.
//   oyonReadScope(req, opts)  a SQL predicate (with params) to AND onto any
//       query of an oyon_* table, or null when the caller may read none.

import { ROLE_RANKS, hasRoleAtLeast } from '../middleware/auth.js';
import { tenantId } from '../routes/_helpers.js';
import { ensureSettings } from './oyonSettings.js';
import { taughtLearnerIds } from './cohortAccess.js';

/**
 * Which cross-user view the caller holds under the tenant's settings.
 * @returns {{ view: 'admin'|'educator'|null, status?: number, code?: string, error?: string }}
 */
export function oyonStaffView(user, settings) {
    if (hasRoleAtLeast(user, ROLE_RANKS.admin)) {
        return settings?.admin_emotion_view_enabled
            ? { view: 'admin' }
            : { view: null, status: 403, code: 'oyon_view_disabled', error: 'Oyon view disabled for this role' };
    }
    if (hasRoleAtLeast(user, ROLE_RANKS.educator)) {
        return settings?.educator_emotion_view_enabled
            ? { view: 'educator' }
            : { view: null, status: 403, code: 'oyon_view_disabled', error: 'Oyon view disabled for this role' };
    }
    return { view: null, status: 403, code: 'oyon_role_required', error: 'Oyon view requires educator role' };
}

/**
 * Gate for an educator+ Oyon surface. Writes the 403 and returns false on a
 * block, so the caller just `return`s. Same behaviour as the Oyon router's
 * own helper of this name.
 */
export function assertOyonReadAccess(req, res, settings) {
    const policy = oyonStaffView(req.user, settings);
    if (policy.view) return true;
    res.status(policy.status).json({ error: policy.error, code: policy.code });
    return false;
}

const col = (alias, name) => (alias ? `${alias}.${name}` : name);

/**
 * SQL predicate restricting an oyon_* query to the rows the caller may read.
 *
 * @param {import('express').Request} req
 * @param {object} [opts]
 * @param {object} [opts.settings]        the tenant's oyon_settings row (read when absent)
 * @param {string} [opts.alias]           table alias used in the query ('' for none)
 * @param {boolean} [opts.self=true]      allow the caller's own rows on the self path
 * @param {boolean} [opts.studentColumn=true]  the table has `student_can_view`
 *        (oyon_signal_events does not: no self path there)
 * @param {boolean} [opts.staffOnly=false] never fall back to the self path
 * @returns {Promise<null | { sql: string, params: unknown[], view: 'admin'|'educator'|'self' }>}
 */
export async function oyonReadScope(req, {
    settings = null,
    alias = '',
    self = true,
    studentColumn = true,
    staffOnly = false,
} = {}) {
    if (!req?.user) return null;
    const row = settings ?? await ensureSettings(tenantId(req));
    const { view } = oyonStaffView(req.user, row);
    if (view === 'admin') {
        return { sql: `${col(alias, 'admin_can_view')} = 1`, params: [], view };
    }
    if (view === 'educator') {
        const learners = await taughtLearnerIds(req);
        return {
            sql: `${col(alias, 'educator_can_view')} = 1 AND CAST(${col(alias, 'user_id')} AS INTEGER) IN (SELECT value FROM json_each(?))`,
            params: [JSON.stringify(learners)],
            view,
        };
    }
    if (staffOnly || !self || !studentColumn) return null;
    if (!row?.student_emotion_view_enabled) return null;
    return {
        sql: `${col(alias, 'student_can_view')} = 1 AND CAST(${col(alias, 'user_id')} AS INTEGER) = ?`,
        params: [Number(req.user.id)],
        view: 'self',
    };
}
