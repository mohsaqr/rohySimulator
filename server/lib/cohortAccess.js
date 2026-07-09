// Shared cohort access checks for the lessons + surveys routes.
//
// This replicates the SECURITY CHOKEPOINT rule from cohorts-routes.js
// (loadOwnedCohort / resolveManageableCohort): a caller may MANAGE a cohort's
// content when they are the owner, an admin, or a LIVE member_role='teacher'
// of that cohort — always within their own tenant. It deliberately does NOT
// use _helpers.canManageOwnedResource, which would grant any educator access
// to any cohort's content.
import dbAdapter from '../dbAdapter.js';
import { ROLE_RANKS, hasRoleAtLeast } from '../middleware/auth.js';
import { tenantId } from '../routes/_helpers.js';

export const isAdminReq = (req) => hasRoleAtLeast(req.user, ROLE_RANKS.admin);

// Cohort row when the caller can MANAGE it (owner | admin | live teacher-member,
// tenant-scoped); else null. Never leaks existence — callers 404 on null.
export async function resolveManageableCohort(cohortId, req) {
    const cohort = await dbAdapter.get(
        `SELECT * FROM cohorts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [cohortId, tenantId(req)]
    );
    if (!cohort) return null;
    if (cohort.owner_user_id === req.user.id || isAdminReq(req)) return cohort;
    const teacher = await dbAdapter.get(
        `SELECT 1 FROM cohort_members
          WHERE cohort_id = ? AND user_id = ?
            AND member_role = 'teacher' AND deleted_at IS NULL
          LIMIT 1`,
        [cohort.id, req.user.id]
    );
    return teacher ? cohort : null;
}

// True when the user is a live, active member of the cohort (any role). Used to
// gate STUDENT reads of published lessons/surveys.
export async function isLiveCohortMember(cohortId, userId) {
    const row = await dbAdapter.get(
        `SELECT 1 FROM cohort_members
          WHERE cohort_id = ? AND user_id = ?
            AND deleted_at IS NULL AND status = 'active'
          LIMIT 1`,
        [cohortId, userId]
    );
    return !!row;
}
