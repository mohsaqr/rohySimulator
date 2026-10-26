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
//
// Educator rank is part of the rule. Several lesson routes call this WITHOUT a
// requireEducator in front (the read path decides staff view vs learner view
// from it), so a student holding a teacher membership — added by mistake, or
// an owner later demoted — used to get the staff view: unstripped MCQ keys,
// unpublished lessons, no course gate (security audit 2026-10-26, F-20).
export async function resolveManageableCohort(cohortId, req) {
    if (!hasRoleAtLeast(req.user, ROLE_RANKS.educator)) return null;
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
//
// The cohort must be live (not deleted) and in the member's own tenant: a user
// moved to another tenant used to keep reading the old course's published
// surveys and lessons through a stale membership (audit 2026-10-26, L2-17).
export async function isLiveCohortMember(cohortId, userId) {
    const row = await dbAdapter.get(
        `SELECT 1 FROM cohort_members cm
           JOIN cohorts c ON c.id = cm.cohort_id AND c.deleted_at IS NULL
           JOIN users u ON u.id = cm.user_id AND u.tenant_id = c.tenant_id
          WHERE cm.cohort_id = ? AND cm.user_id = ?
            AND cm.deleted_at IS NULL AND cm.status = 'active'
          LIMIT 1`,
        [cohortId, userId]
    );
    return !!row;
}

/**
 * Ids of the learners whose individual data an EDUCATOR may read: live
 * student members of the courses the educator owns or co-teaches, in the
 * educator's tenant. Admins are not limited by this (callers check rank
 * first); reviewers and below get an empty list.
 *
 * @param {import('express').Request} req
 * @returns {Promise<number[]>}
 */
export async function taughtLearnerIds(req) {
    if (!hasRoleAtLeast(req.user, ROLE_RANKS.educator)) return [];
    const rows = await dbAdapter.all(
        `SELECT DISTINCT cm.user_id
           FROM cohorts c
           JOIN cohort_members cm ON cm.cohort_id = c.id
                AND cm.deleted_at IS NULL AND cm.member_role = 'student'
          WHERE c.tenant_id = ? AND c.deleted_at IS NULL
            AND (c.owner_user_id = ?
                 OR EXISTS (SELECT 1 FROM cohort_members t
                             WHERE t.cohort_id = c.id AND t.user_id = ?
                               AND t.member_role = 'teacher' AND t.deleted_at IS NULL))`,
        [tenantId(req), req.user.id, req.user.id]
    );
    return rows.map((r) => Number(r.user_id));
}
