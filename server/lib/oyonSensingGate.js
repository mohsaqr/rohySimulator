// Oyon sensing gate — the ONE rule deciding whether a learner may be sensed.
//
// Owner decision 2026-10-25: sensing is controlled per COURSE by the teacher.
// A learner (any role ranked below educator) may be sensed only when
//   1. the tenant switch `oyon_settings.emotion_capture_enabled` is on, AND
//   2. they hold an ACTIVE membership (same definition as case visibility:
//      live, status 'active', inside the member's and the course's date
//      windows) of at least one non-deleted course in their own tenant whose
//      settings say `oyon_sensing_enabled: true`.
// Staff (educator and above) keep the tenant switch only.
//
// GET /addons/oyon/config reports the result; every learner write endpoint in
// oyon-routes.js refuses with 403 `sensing_not_enabled_for_course` before
// writing. A learner's own-data read/delete is never gated.
import { ROLE_RANKS, getRoleRank } from '../middleware/auth.js';
import { ACTIVE_MEMBERSHIP, dbAll, dbGet } from '../routes/_helpers.js';

export const SENSING_COURSE_ERROR_CODE = 'sensing_not_enabled_for_course';

/** Whether the course rule applies to this user at all (learners only). */
export function courseRuleApplies(user) {
    return getRoleRank(user) < ROLE_RANKS.educator;
}

/**
 * Whether the user is an active member of a live, in-window course in their
 * tenant that enables Oyon sensing. The CASE guards json_extract so one
 * malformed settings blob cannot turn the check into a 500.
 */
export async function hasSensingCourse(userId, tenant) {
    const row = await dbGet(
        `SELECT 1 AS ok
           FROM cohort_members cm
           JOIN cohorts co ON co.id = cm.cohort_id
          WHERE cm.user_id = ?
            AND co.tenant_id = ?
            AND ${ACTIVE_MEMBERSHIP}
            AND (CASE WHEN json_valid(co.settings)
                      THEN json_extract(co.settings, '$.oyon_sensing_enabled') END) = 1
          LIMIT 1`,
        [userId, tenant]
    );
    return Boolean(row);
}

/**
 * Resolve the sensing gate for a user.
 *
 * @param {object} user      req.user
 * @param {*} tenant         tenantId(req)
 * @param {object} settings  the tenant's oyon_settings row (ensureSettings)
 * @returns {Promise<{ allowed: boolean, tenantEnabled: boolean,
 *                     courseRule: boolean, courseOpen: boolean|null }>}
 *   courseRule — the course rule applies to this user;
 *   courseOpen — for a gated user, whether a course enables sensing (null for staff).
 */
export async function resolveSensingGate(user, tenant, settings) {
    const tenantEnabled = Boolean(settings?.emotion_capture_enabled);
    if (!courseRuleApplies(user)) {
        return { allowed: tenantEnabled, tenantEnabled, courseRule: false, courseOpen: null };
    }
    const courseOpen = await hasSensingCourse(user.id, tenant);
    return { allowed: tenantEnabled && courseOpen, tenantEnabled, courseRule: true, courseOpen };
}

/**
 * The courses a SESSION belongs to, for its owner: live courses in the tenant
 * that the session's case is assigned to and that the session's owner is an
 * active member of. Ordered by course id, so attribution is deterministic.
 *
 * @param {{user_id: number|string, case_id: number|string|null}} session  the stored row
 * @param {*} tenant
 * @returns {Promise<{id: number, name: string, sensing: boolean}[]>}
 */
export async function sessionCourses(session, tenant) {
    if (session?.case_id == null || session?.user_id == null) return [];
    const rows = await dbAll(
        `SELECT co.id, co.name,
                (CASE WHEN json_valid(co.settings)
                      THEN json_extract(co.settings, '$.oyon_sensing_enabled') END) AS sensing
           FROM cohort_cases cc
           JOIN cohorts co ON co.id = cc.cohort_id
           JOIN cohort_members cm ON cm.cohort_id = co.id AND cm.user_id = ?
          WHERE cc.case_id = ?
            AND cc.deleted_at IS NULL
            AND co.tenant_id = ?
            AND ${ACTIVE_MEMBERSHIP}
          ORDER BY co.id`,
        [Number(session.user_id), Number(session.case_id), tenant]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, sensing: Number(r.sensing) === 1 }));
}

/**
 * The sensing gate for one SESSION (security audit 2026-10-26, L7-08).
 *
 * `resolveSensingGate` answers "may this learner be sensed at all" — a member
 * of ANY sensing course. That let course A's choice reach course B's cases.
 * The decision belongs to the course the session's case is taught in:
 *   - the case is assigned to one or more of the owner's active courses →
 *     sensing only if one of THOSE enables it;
 *   - the case is in none of them (an unassigned case, course access not
 *     enforced) → the learner-level rule above decides, as before.
 * Staff keep the tenant switch only. Either way `course` is the course the
 * session is attributed to — derived here, never taken from the client — or
 * null when the session belongs to none.
 *
 * @returns {Promise<{allowed: boolean, courseRule: boolean, course: {id:number,name:string}|null,
 *                    basis: 'staff'|'session_course'|'learner_courses'}>}
 */
export async function resolveSessionSensing(user, tenant, settings, session) {
    const tenantEnabled = Boolean(settings?.emotion_capture_enabled);
    const courses = await sessionCourses(session, tenant);
    const sensingCourse = courses.find((c) => c.sensing) || null;
    const attributed = sensingCourse || courses[0] || null;
    const course = attributed ? { id: attributed.id, name: attributed.name } : null;
    if (!courseRuleApplies(user)) {
        return { allowed: tenantEnabled, courseRule: false, course, basis: 'staff' };
    }
    if (courses.length > 0) {
        return { allowed: tenantEnabled && Boolean(sensingCourse), courseRule: true, course, basis: 'session_course' };
    }
    const open = await hasSensingCourse(user.id, tenant);
    return { allowed: tenantEnabled && open, courseRule: true, course: null, basis: 'learner_courses' };
}
