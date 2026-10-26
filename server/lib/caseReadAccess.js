// The one rule for "may this caller open this case", shared by every route
// that answers a case-scoped read outside GET /cases/:id (which applies the
// same rule through its own query): reviewers and above read any case of
// their tenant; a learner reads an available case of their tenant, and —
// while course access is enforced — only one a live course of theirs gives
// them (studentCaseVisibility). A case the caller may not open is "not
// found", never "forbidden", so ids do not enumerate.
//
// Extracted from case-course-routes.js (security audit 2026-10-26: the
// questionnaire-response, case-team and analytics routes need the same rule —
// F-16, L2-16).

import dbAdapter from '../dbAdapter.js';
import {
    tenantId,
    caseAccessEnforcedFor,
    canReadAcrossUsers,
    studentCaseVisibility,
} from '../routes/_helpers.js';

const studentCase = studentCaseVisibility('c');

/**
 * The case row (`id`, `config`) when the caller may open it, else null.
 * @param {import('express').Request} req
 * @param {number|string} caseId
 * @returns {Promise<{id: number, config: string}|null>}
 */
export async function readableCase(req, caseId) {
    if (caseId === undefined || caseId === null || caseId === '') return null;
    if (canReadAcrossUsers(req.user)) {
        return dbAdapter.get(
            'SELECT id, config FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [caseId, tenantId(req)]
        );
    }
    if (await caseAccessEnforcedFor(req.user)) {
        return dbAdapter.get(
            `SELECT c.id, c.config FROM cases c
              WHERE c.id = ? AND c.tenant_id = ? AND c.is_available = 1 AND c.deleted_at IS NULL
                AND ${studentCase.sql}`,
            [caseId, tenantId(req), ...studentCase.binds(req.user.id)]
        );
    }
    return dbAdapter.get(
        'SELECT id, config FROM cases WHERE id = ? AND tenant_id = ? AND is_available = 1 AND deleted_at IS NULL',
        [caseId, tenantId(req)]
    );
}
