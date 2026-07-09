// Lessons (lectures) + sections + progress — the server seam for the ported
// LAILA/chatoyon lesson authoring UI. Endpoints match the vendored client
// (src/components/lessons/api/courses.js) verbatim: they live under /courses/*
// and `moduleId` params carry a rohy COHORT id (lessons attach to a cohort).
//
// Response envelope is { success, data } — the client shim reads response.data.data.
//
// Auth: reads require a signed-in user (staff see all; students see published
// lessons of cohorts they are live members of). Writes require educator rank
// AND manage-access to the lesson's cohort (owner | admin | teacher-member) via
// cohortAccess.resolveManageableCohort — NOT _helpers.canManageOwnedResource.
import express from 'express';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, requireEducator } from '../middleware/auth.js';
import { tenantId } from './_helpers.js';
import { logger } from '../logger.js';
import { resolveManageableCohort, isLiveCohortMember, isAdminReq } from '../lib/cohortAccess.js';
import { sanitizeLessonHtml } from '../lib/lessonSanitize.js';

const router = express.Router();
const log = logger('routes-lessons');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, error) => res.status(status).json({ success: false, error });

// --- row → client (camelCase) mappers ---------------------------------------
function mapLesson(row, sections) {
    if (!row) return null;
    const out = {
        id: row.id,
        classroomId: row.cohort_id,   // client contract name (opaque course id)
        cohortId: row.cohort_id,
        title: row.title,
        description: row.description,
        content: row.content,
        contentType: row.content_type,
        videoUrl: row.video_url,
        duration: row.duration,
        orderIndex: row.order_index,
        isPublished: !!row.is_published,
        isFree: !!row.is_free,
        availableFrom: row.available_from,
        availableUntil: row.available_until,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
    if (sections) out.sections = sections.map(mapSection);
    return out;
}

function mapSection(row) {
    return {
        id: row.id,
        lectureId: row.lesson_id,
        title: row.title,
        type: row.type,
        content: row.content,
        fileName: row.file_name,
        fileUrl: row.file_url,
        fileType: row.file_type,
        fileSize: row.file_size,
        order: row.order_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// --- access helpers ---------------------------------------------------------
async function loadLesson(lessonId, req) {
    return dbAdapter.get(
        `SELECT * FROM lessons WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [lessonId, tenantId(req)]
    );
}

// Lesson row if the caller may MANAGE it (via its cohort), else null.
async function lessonForManage(lessonId, req) {
    const lesson = await loadLesson(lessonId, req);
    if (!lesson) return null;
    const cohort = await resolveManageableCohort(lesson.cohort_id, req);
    return cohort ? lesson : null;
}

// Lesson row if the caller may READ it: staff (manage) OR published + live
// member of the cohort. Returns { lesson, staff } or null.
async function lessonForRead(lessonId, req) {
    const lesson = await loadLesson(lessonId, req);
    if (!lesson) return null;
    const cohort = await resolveManageableCohort(lesson.cohort_id, req);
    if (cohort) return { lesson, staff: true };
    if (lesson.is_published && (await isLiveCohortMember(lesson.cohort_id, req.user.id))) {
        return { lesson, staff: false };
    }
    return null;
}

async function sectionsFor(lessonId) {
    const rows = await dbAdapter.all(
        `SELECT * FROM lesson_sections WHERE lesson_id = ? AND deleted_at IS NULL
          ORDER BY order_index ASC, id ASC`,
        [lessonId]
    );
    return rows;
}

// ===========================================================================
// Lectures
// ===========================================================================

// GET /courses/modules/:moduleId/lectures — list a cohort's lessons.
router.get('/courses/modules/:moduleId/lectures', authenticateToken, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        if (!Number.isInteger(cohortId)) return fail(res, 400, 'Invalid module id');
        const cohort = await resolveManageableCohort(cohortId, req);
        const staff = !!cohort;
        if (!staff && !(await isLiveCohortMember(cohortId, req.user.id))) {
            return fail(res, 404, 'Course not found');
        }
        const rows = await dbAdapter.all(
            `SELECT * FROM lessons
              WHERE cohort_id = ? AND tenant_id = ? AND deleted_at IS NULL
                ${staff ? '' : 'AND is_published = 1'}
              ORDER BY order_index ASC, id ASC`,
            [cohortId, tenantId(req)]
        );
        // ?include=sections — batch-fetch every lesson's sections in ONE query
        // (the client would otherwise N+1 per lesson) and attach them in the
        // same shape as the single-lesson detail endpoint.
        if (req.query.include === 'sections' && rows.length) {
            const ids = rows.map((r) => r.id);
            const sections = await dbAdapter.all(
                `SELECT * FROM lesson_sections
                  WHERE lesson_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
                  ORDER BY lesson_id ASC, order_index ASC, id ASC`,
                ids
            );
            const byLesson = new Map(ids.map((id) => [id, []]));
            sections.forEach((s) => byLesson.get(s.lesson_id)?.push(s));
            return ok(res, rows.map((r) => mapLesson(r, byLesson.get(r.id))));
        }
        return ok(res, rows.map((r) => mapLesson(r)));
    } catch (err) {
        log.error('list lectures failed', { error: err.message });
        return fail(res, 500, 'Failed to list lessons');
    }
});

// POST /courses/modules/:moduleId/lectures — create a lesson in a cohort.
router.post('/courses/modules/:moduleId/lectures', authenticateToken, requireEducator, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        if (!Number.isInteger(cohortId)) return fail(res, 400, 'Invalid module id');
        const cohort = await resolveManageableCohort(cohortId, req);
        if (!cohort) return fail(res, 404, 'Course not found');

        const b = req.body || {};
        if (!b.title || typeof b.title !== 'string' || b.title.trim() === '') {
            return fail(res, 400, 'Title is required');
        }
        // Append to the end of the cohort's lesson list.
        const maxRow = await dbAdapter.get(
            `SELECT COALESCE(MAX(order_index), -1) AS mx FROM lessons
              WHERE cohort_id = ? AND deleted_at IS NULL`,
            [cohortId]
        );
        const orderIndex = Number.isInteger(b.orderIndex) ? b.orderIndex : maxRow.mx + 1;
        const { lastID } = await dbAdapter.run(
            `INSERT INTO lessons
               (cohort_id, tenant_id, title, description, content, content_type,
                video_url, duration, order_index, is_published, is_free,
                available_from, available_until)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                cohortId, tenantId(req), b.title.trim(),
                b.description != null ? sanitizeLessonHtml(String(b.description)) : null,
                b.content != null ? sanitizeLessonHtml(b.content) : null,
                b.contentType ?? 'text', b.videoUrl ?? null,
                Number.isInteger(b.duration) ? b.duration : null, orderIndex,
                b.isPublished ? 1 : 0, b.isFree ? 1 : 0,
                b.availableFrom ?? null, b.availableUntil ?? null,
            ]
        );
        const row = await dbAdapter.get(`SELECT * FROM lessons WHERE id = ?`, [lastID]);
        return ok(res, mapLesson(row, []), 201);
    } catch (err) {
        log.error('create lecture failed', { error: err.message });
        return fail(res, 500, 'Failed to create lesson');
    }
});

// PUT /courses/modules/:moduleId/lectures/reorder — reorder within a cohort.
router.put('/courses/modules/:moduleId/lectures/reorder', authenticateToken, requireEducator, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        const cohort = await resolveManageableCohort(cohortId, req);
        if (!cohort) return fail(res, 404, 'Course not found');
        const ids = Array.isArray(req.body?.lectureIds)
            ? req.body.lectureIds.map(Number).filter(Number.isInteger)
            : null;
        if (!ids || !ids.length) return fail(res, 400, 'lectureIds required');
        // Only reorder lessons that actually belong to this cohort.
        const owned = await dbAdapter.all(
            `SELECT id FROM lessons WHERE cohort_id = ? AND deleted_at IS NULL`,
            [cohortId]
        );
        const ownedSet = new Set(owned.map((r) => r.id));
        if (!ids.every((id) => ownedSet.has(id))) return fail(res, 400, 'Unknown lesson id');
        await dbAdapter.transaction(async () => {
            for (let i = 0; i < ids.length; i++) {
                await dbAdapter.run(
                    `UPDATE lessons SET order_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [i, ids[i]]
                );
            }
        });
        return ok(res, { message: 'Reordered' });
    } catch (err) {
        log.error('reorder lectures failed', { error: err.message });
        return fail(res, 500, 'Failed to reorder lessons');
    }
});

// GET /courses/for-case/:caseId — the course (cohort) a case belongs to, for the
// per-case "Course" card. Prefers a live cohort the caller can reach (member or
// manager); returns { cohortId, cohortName } or { cohortId: null }.
router.get('/courses/for-case/:caseId', authenticateToken, async (req, res) => {
    try {
        const caseId = Number(req.params.caseId);
        if (!Number.isInteger(caseId)) return fail(res, 400, 'Invalid case id');
        const rows = await dbAdapter.all(
            `SELECT co.id, co.name, co.owner_user_id
               FROM cohort_cases cc
               JOIN cohorts co ON co.id = cc.cohort_id
              WHERE cc.case_id = ? AND cc.deleted_at IS NULL AND co.deleted_at IS NULL
                AND co.tenant_id = ?
              ORDER BY co.id ASC`,
            [caseId, tenantId(req)]
        );
        // Prefer a cohort the caller is actually ENROLLED in (student or
        // teacher-member), then one they own, then any (admins). ORDER BY
        // co.id ASC above stays the tiebreaker within each tier.
        for (const c of rows) {
            if (await isLiveCohortMember(c.id, req.user.id)) {
                return ok(res, { cohortId: c.id, cohortName: c.name });
            }
        }
        const owned = rows.find((c) => c.owner_user_id === req.user.id);
        if (owned) return ok(res, { cohortId: owned.id, cohortName: owned.name });
        if (isAdminReq(req) && rows.length) {
            return ok(res, { cohortId: rows[0].id, cohortName: rows[0].name });
        }
        return ok(res, { cohortId: null });
    } catch (err) {
        log.error('for-case failed', { error: err.message });
        return fail(res, 500, 'Failed to resolve course');
    }
});

// GET /courses/case-assignments — every live case in the caller's tenant with
// the course (cohort) it is assigned to, or null when unassigned. Educator+;
// feeds the assignment editor. One-case⇄one-course invariant: when legacy data
// still holds several live links, the lowest cohort id is reported (the same
// tiebreaker PUT /cases/:caseId/course collapses to).
router.get('/courses/case-assignments', authenticateToken, requireEducator, async (req, res) => {
    try {
        const rows = await dbAdapter.all(
            `SELECT c.id AS case_id, c.name AS case_name,
                    MIN(co.id) AS cohort_id, co.name AS cohort_name
               FROM cases c
               LEFT JOIN cohort_cases cc
                 ON cc.case_id = c.id AND cc.deleted_at IS NULL
               LEFT JOIN cohorts co
                 ON co.id = cc.cohort_id AND co.deleted_at IS NULL AND co.tenant_id = c.tenant_id
              WHERE c.tenant_id = ? AND c.deleted_at IS NULL
              GROUP BY c.id
              ORDER BY c.id ASC`,
            [tenantId(req)]
        );
        return ok(res, rows.map((r) => ({
            caseId: r.case_id,
            caseName: r.case_name,
            cohortId: r.cohort_id ?? null,
            cohortName: r.cohort_name ?? null,
        })));
    } catch (err) {
        log.error('case-assignments failed', { error: err.message });
        return fail(res, 500, 'Failed to list case assignments');
    }
});

// PUT /cases/:caseId/course — (re)assign a case to exactly one course.
// Body { cohortId: <int> } moves the case there; { cohortId: null } unassigns.
// Educator-gated AND the target cohort must be manageable by the caller
// (owner | admin | teacher-member) — otherwise 404, no existence leak.
// Enforces the one-case⇄one-course invariant: after this call the case has at
// most one live cohort_cases row.
router.put('/cases/:caseId/course', authenticateToken, requireEducator, async (req, res) => {
    try {
        const caseId = Number(req.params.caseId);
        if (!Number.isInteger(caseId)) return fail(res, 400, 'Invalid case id');
        const caseRow = await dbAdapter.get(
            `SELECT id FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
            [caseId, tenantId(req)]
        );
        if (!caseRow) return fail(res, 404, 'Case not found');

        const rawCohortId = req.body?.cohortId ?? null;
        let cohortId = null;
        if (rawCohortId !== null) {
            cohortId = Number(rawCohortId);
            if (!Number.isInteger(cohortId)) return fail(res, 400, 'cohortId must be an integer or null');
            const cohort = await resolveManageableCohort(cohortId, req);
            if (!cohort) return fail(res, 404, 'Course not found');
        }

        await dbAdapter.transaction(async () => {
            // Soft-delete every live link EXCEPT the target (all of them when
            // unassigning) …
            if (cohortId === null) {
                await dbAdapter.run(
                    `UPDATE cohort_cases SET deleted_at = CURRENT_TIMESTAMP
                      WHERE case_id = ? AND deleted_at IS NULL`,
                    [caseId]
                );
            } else {
                await dbAdapter.run(
                    `UPDATE cohort_cases SET deleted_at = CURRENT_TIMESTAMP
                      WHERE case_id = ? AND cohort_id != ? AND deleted_at IS NULL`,
                    [caseId, cohortId]
                );
                // … then revive-or-insert the target link (a fresh row; any
                // soft-deleted twin stays dead — the 0027 partial unique only
                // covers live rows).
                await dbAdapter.run(
                    `INSERT INTO cohort_cases (cohort_id, case_id)
                     SELECT ?, ?
                      WHERE NOT EXISTS (
                        SELECT 1 FROM cohort_cases cc
                         WHERE cc.cohort_id = ? AND cc.case_id = ? AND cc.deleted_at IS NULL)`,
                    [cohortId, caseId, cohortId, caseId]
                );
            }
        });
        return ok(res, { caseId, cohortId });
    } catch (err) {
        log.error('assign case course failed', { error: err.message });
        return fail(res, 500, 'Failed to assign course');
    }
});

// GET /courses/modules/:moduleId/progress — lesson ids the caller has completed
// in this cohort (drives the student room's completed ticks).
router.get('/courses/modules/:moduleId/progress', authenticateToken, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        if (!Number.isInteger(cohortId)) return fail(res, 400, 'Invalid module id');
        const rows = await dbAdapter.all(
            `SELECT lesson_id FROM lesson_progress
              WHERE user_id = ? AND cohort_id = ? AND is_completed = 1`,
            [req.user.id, cohortId]
        );
        return ok(res, rows.map((r) => r.lesson_id));
    } catch (err) {
        log.error('progress failed', { error: err.message });
        return fail(res, 500, 'Failed to load progress');
    }
});

// GET /courses/lectures/:id — one lesson with its sections.
router.get('/courses/lectures/:id', authenticateToken, async (req, res) => {
    try {
        const lessonId = Number(req.params.id);
        if (!Number.isInteger(lessonId)) return fail(res, 400, 'Invalid lesson id');
        const access = await lessonForRead(lessonId, req);
        if (!access) return fail(res, 404, 'Lesson not found');
        const sections = await sectionsFor(lessonId);
        return ok(res, mapLesson(access.lesson, sections));
    } catch (err) {
        log.error('get lecture failed', { error: err.message });
        return fail(res, 500, 'Failed to load lesson');
    }
});

// PUT /courses/lectures/:id — update lesson fields.
router.put('/courses/lectures/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const lessonId = Number(req.params.id);
        const lesson = await lessonForManage(lessonId, req);
        if (!lesson) return fail(res, 404, 'Lesson not found');
        const b = req.body || {};
        const sets = [];
        const params = [];
        const put = (col, val) => { sets.push(`${col} = ?`); params.push(val); };
        if (b.title !== undefined) put('title', String(b.title));
        if (b.description !== undefined) {
            put('description', b.description != null ? sanitizeLessonHtml(String(b.description)) : null);
        }
        if (b.content !== undefined) put('content', b.content != null ? sanitizeLessonHtml(b.content) : null);
        if (b.contentType !== undefined) put('content_type', b.contentType);
        if (b.videoUrl !== undefined) put('video_url', b.videoUrl);
        if (b.duration !== undefined) put('duration', Number.isInteger(b.duration) ? b.duration : null);
        if (b.orderIndex !== undefined) put('order_index', Number(b.orderIndex) || 0);
        if (b.isPublished !== undefined) put('is_published', b.isPublished ? 1 : 0);
        if (b.isFree !== undefined) put('is_free', b.isFree ? 1 : 0);
        if (b.availableFrom !== undefined) put('available_from', b.availableFrom);
        if (b.availableUntil !== undefined) put('available_until', b.availableUntil);
        if (sets.length) {
            params.push(lessonId);
            await dbAdapter.run(
                `UPDATE lessons SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                params
            );
        }
        const row = await dbAdapter.get(`SELECT * FROM lessons WHERE id = ?`, [lessonId]);
        const sections = await sectionsFor(lessonId);
        return ok(res, mapLesson(row, sections));
    } catch (err) {
        log.error('update lecture failed', { error: err.message });
        return fail(res, 500, 'Failed to update lesson');
    }
});

// DELETE /courses/lectures/:id — soft-delete a lesson.
router.delete('/courses/lectures/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const lessonId = Number(req.params.id);
        const lesson = await lessonForManage(lessonId, req);
        if (!lesson) return fail(res, 404, 'Lesson not found');
        await dbAdapter.run(
            `UPDATE lessons SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [lessonId]
        );
        return ok(res, { message: 'Deleted' });
    } catch (err) {
        log.error('delete lecture failed', { error: err.message });
        return fail(res, 500, 'Failed to delete lesson');
    }
});

// POST /courses/lectures/:id/duplicate — deep-copy lesson + sections (unpublished).
router.post('/courses/lectures/:id/duplicate', authenticateToken, requireEducator, async (req, res) => {
    try {
        const lessonId = Number(req.params.id);
        const lesson = await lessonForManage(lessonId, req);
        if (!lesson) return fail(res, 404, 'Lesson not found');
        const sections = await sectionsFor(lessonId);
        const maxRow = await dbAdapter.get(
            `SELECT COALESCE(MAX(order_index), -1) AS mx FROM lessons
              WHERE cohort_id = ? AND deleted_at IS NULL`,
            [lesson.cohort_id]
        );
        const newId = await dbAdapter.transaction(async () => {
            const { lastID } = await dbAdapter.run(
                `INSERT INTO lessons
                   (cohort_id, tenant_id, title, description, content, content_type,
                    video_url, duration, order_index, is_published, is_free,
                    available_from, available_until)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    lesson.cohort_id, lesson.tenant_id, `${lesson.title} (copy)`,
                    lesson.description, lesson.content, lesson.content_type,
                    lesson.video_url, lesson.duration, maxRow.mx + 1,
                    0, lesson.is_free, lesson.available_from, lesson.available_until,
                ]
            );
            for (const s of sections) {
                await dbAdapter.run(
                    `INSERT INTO lesson_sections
                       (lesson_id, title, type, content, file_name, file_url,
                        file_type, file_size, order_index)
                     VALUES (?,?,?,?,?,?,?,?,?)`,
                    [lastID, s.title, s.type, s.content, s.file_name, s.file_url,
                     s.file_type, s.file_size, s.order_index]
                );
            }
            return lastID;
        });
        const row = await dbAdapter.get(`SELECT * FROM lessons WHERE id = ?`, [newId]);
        const newSections = await sectionsFor(newId);
        return ok(res, mapLesson(row, newSections), 201);
    } catch (err) {
        log.error('duplicate lecture failed', { error: err.message });
        return fail(res, 500, 'Failed to duplicate lesson');
    }
});

// POST /courses/lectures/:id/complete — mark complete for the calling student.
router.post('/courses/lectures/:id/complete', authenticateToken, async (req, res) => {
    try {
        const lessonId = Number(req.params.id);
        const access = await lessonForRead(lessonId, req);
        if (!access) return fail(res, 404, 'Lesson not found');
        // Upsert progress keyed by (user, lesson).
        const existing = await dbAdapter.get(
            `SELECT id FROM lesson_progress WHERE user_id = ? AND lesson_id = ?`,
            [req.user.id, lessonId]
        );
        if (existing) {
            await dbAdapter.run(
                `UPDATE lesson_progress
                    SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                [existing.id]
            );
        } else {
            await dbAdapter.run(
                `INSERT INTO lesson_progress (user_id, lesson_id, cohort_id, is_completed, completed_at)
                 VALUES (?,?,?,1,CURRENT_TIMESTAMP)`,
                [req.user.id, lessonId, access.lesson.cohort_id]
            );
        }
        return ok(res, { isCompleted: true });
    } catch (err) {
        log.error('complete lecture failed', { error: err.message });
        return fail(res, 500, 'Failed to mark complete');
    }
});

// ===========================================================================
// Sections
// ===========================================================================

// GET /courses/lectures/:lectureId/sections
router.get('/courses/lectures/:lectureId/sections', authenticateToken, async (req, res) => {
    try {
        const lessonId = Number(req.params.lectureId);
        const access = await lessonForRead(lessonId, req);
        if (!access) return fail(res, 404, 'Lesson not found');
        const rows = await sectionsFor(lessonId);
        return ok(res, rows.map(mapSection));
    } catch (err) {
        log.error('list sections failed', { error: err.message });
        return fail(res, 500, 'Failed to list sections');
    }
});

function sectionWriteColumns(b) {
    // camel → snake; sanitize HTML content on write.
    return {
        title: b.title ?? null,
        type: b.type ?? 'text',
        content: b.content != null ? sanitizeLessonHtml(b.content) : null,
        file_name: b.fileName ?? null,
        file_url: b.fileUrl ?? null,
        file_type: b.fileType ?? null,
        file_size: Number.isInteger(b.fileSize) ? b.fileSize : null,
    };
}

// POST /courses/lectures/:lectureId/sections — create a section.
router.post('/courses/lectures/:lectureId/sections', authenticateToken, requireEducator, async (req, res) => {
    try {
        const lessonId = Number(req.params.lectureId);
        const lesson = await lessonForManage(lessonId, req);
        if (!lesson) return fail(res, 404, 'Lesson not found');
        const b = req.body || {};
        const c = sectionWriteColumns(b);
        const maxRow = await dbAdapter.get(
            `SELECT COALESCE(MAX(order_index), -1) AS mx FROM lesson_sections
              WHERE lesson_id = ? AND deleted_at IS NULL`,
            [lessonId]
        );
        const order = Number.isInteger(b.order) ? b.order : maxRow.mx + 1;
        const { lastID } = await dbAdapter.run(
            `INSERT INTO lesson_sections
               (lesson_id, title, type, content, file_name, file_url, file_type, file_size, order_index)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [lessonId, c.title, c.type, c.content, c.file_name, c.file_url, c.file_type, c.file_size, order]
        );
        const row = await dbAdapter.get(`SELECT * FROM lesson_sections WHERE id = ?`, [lastID]);
        return ok(res, mapSection(row), 201);
    } catch (err) {
        log.error('create section failed', { error: err.message });
        return fail(res, 500, 'Failed to create section');
    }
});

// Resolve a section for management via its parent lesson's cohort.
async function sectionForManage(sectionId, req) {
    const section = await dbAdapter.get(
        `SELECT * FROM lesson_sections WHERE id = ? AND deleted_at IS NULL`, [sectionId]
    );
    if (!section) return null;
    const lesson = await lessonForManage(section.lesson_id, req);
    return lesson ? section : null;
}

// PUT /courses/sections/:id — update a section (the autosave target).
router.put('/courses/sections/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const sectionId = Number(req.params.id);
        const section = await sectionForManage(sectionId, req);
        if (!section) return fail(res, 404, 'Section not found');
        const b = req.body || {};
        const sets = [];
        const params = [];
        const put = (col, val) => { sets.push(`${col} = ?`); params.push(val); };
        if (b.title !== undefined) put('title', b.title);
        if (b.type !== undefined) put('type', b.type);
        if (b.content !== undefined) put('content', b.content != null ? sanitizeLessonHtml(b.content) : null);
        if (b.fileName !== undefined) put('file_name', b.fileName);
        if (b.fileUrl !== undefined) put('file_url', b.fileUrl);
        if (b.fileType !== undefined) put('file_type', b.fileType);
        if (b.fileSize !== undefined) put('file_size', Number.isInteger(b.fileSize) ? b.fileSize : null);
        if (b.order !== undefined) put('order_index', Number(b.order) || 0);
        if (sets.length) {
            params.push(sectionId);
            await dbAdapter.run(
                `UPDATE lesson_sections SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                params
            );
        }
        const row = await dbAdapter.get(`SELECT * FROM lesson_sections WHERE id = ?`, [sectionId]);
        return ok(res, mapSection(row));
    } catch (err) {
        log.error('update section failed', { error: err.message });
        return fail(res, 500, 'Failed to update section');
    }
});

// DELETE /courses/sections/:id — soft-delete a section.
router.delete('/courses/sections/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const sectionId = Number(req.params.id);
        const section = await sectionForManage(sectionId, req);
        if (!section) return fail(res, 404, 'Section not found');
        await dbAdapter.run(
            `UPDATE lesson_sections SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [sectionId]
        );
        return ok(res, { message: 'Deleted' });
    } catch (err) {
        log.error('delete section failed', { error: err.message });
        return fail(res, 500, 'Failed to delete section');
    }
});

// PUT /courses/lectures/:lectureId/sections/reorder
router.put('/courses/lectures/:lectureId/sections/reorder', authenticateToken, requireEducator, async (req, res) => {
    try {
        const lessonId = Number(req.params.lectureId);
        const lesson = await lessonForManage(lessonId, req);
        if (!lesson) return fail(res, 404, 'Lesson not found');
        const ids = Array.isArray(req.body?.sectionIds)
            ? req.body.sectionIds.map(Number).filter(Number.isInteger)
            : null;
        if (!ids || !ids.length) return fail(res, 400, 'sectionIds required');
        const owned = await dbAdapter.all(
            `SELECT id FROM lesson_sections WHERE lesson_id = ? AND deleted_at IS NULL`, [lessonId]
        );
        const ownedSet = new Set(owned.map((r) => r.id));
        if (!ids.every((id) => ownedSet.has(id))) return fail(res, 400, 'Unknown section id');
        await dbAdapter.transaction(async () => {
            for (let i = 0; i < ids.length; i++) {
                await dbAdapter.run(
                    `UPDATE lesson_sections SET order_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [i, ids[i]]
                );
            }
        });
        return ok(res, { message: 'Reordered' });
    } catch (err) {
        log.error('reorder sections failed', { error: err.message });
        return fail(res, 500, 'Failed to reorder sections');
    }
});

export default router;
