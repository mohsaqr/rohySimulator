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
import { ACTIVE_MEMBERSHIP, dbGet } from '../routes/_helpers.js';

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
