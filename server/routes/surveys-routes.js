// Surveys — builder + response capture + analytics + CSV export, the server
// seam for the ported survey UI (src/components/lessons/api/surveys.js).
// Endpoints match the vendored client verbatim; `moduleId` params carry a rohy
// COHORT id. Response envelope { success, data }.
//
// Ownership: a survey is managed by its creator or an admin (createdById).
// Attaching to a cohort additionally requires manage-access to that cohort.
// Students may submit to a published survey attached to a cohort they belong to.
import express from 'express';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, requireEducator } from '../middleware/auth.js';
import { tenantId } from './_helpers.js';
import { logger } from '../logger.js';
import { isAdminReq, resolveManageableCohort, isLiveCohortMember } from '../lib/cohortAccess.js';
import { stripHtmlToText } from '../lib/lessonSanitize.js';

const router = express.Router();
const log = logger('routes-surveys');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, error) => res.status(status).json({ success: false, error });

const QUESTION_TYPES = new Set(['single_choice', 'multiple_choice', 'free_text']);

function safeJsonArray(str) {
    if (!str) return [];
    try { const v = JSON.parse(str); return Array.isArray(v) ? v : []; }
    catch { return []; }
}

function mapSurvey(row, questions) {
    if (!row) return null;
    const out = {
        id: row.id,
        title: row.title,
        description: row.description,
        createdById: row.created_by_id,
        isPublished: !!row.is_published,
        isAnonymous: !!row.is_anonymous,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
    if (questions) out.questions = questions.map(mapQuestion);
    return out;
}

function mapQuestion(row) {
    return {
        id: row.id,
        surveyId: row.survey_id,
        questionText: row.question_text,
        questionType: row.question_type,
        options: safeJsonArray(row.options),
        isRequired: !!row.is_required,
        orderIndex: row.order_index,
    };
}

async function questionsFor(surveyId) {
    return dbAdapter.all(
        `SELECT * FROM survey_questions WHERE survey_id = ? AND deleted_at IS NULL
          ORDER BY order_index ASC, id ASC`,
        [surveyId]
    );
}

async function loadSurvey(surveyId, req) {
    return dbAdapter.get(
        `SELECT * FROM surveys WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [surveyId, tenantId(req)]
    );
}

async function surveyForManage(surveyId, req) {
    const survey = await loadSurvey(surveyId, req);
    if (!survey) return null;
    if (survey.created_by_id === req.user.id || isAdminReq(req)) return survey;
    return null;
}

// SQL fragment: the survey `s.id` is attached (live link) to a live cohort
// where the given user is a live, active member. Binds ONE param (user id).
const MEMBER_ATTACHED_EXISTS = `EXISTS (
    SELECT 1 FROM cohort_surveys cs2
      JOIN cohorts co2 ON co2.id = cs2.cohort_id AND co2.deleted_at IS NULL
      JOIN cohort_members cm2 ON cm2.cohort_id = cs2.cohort_id
     WHERE cs2.survey_id = s.id AND cs2.deleted_at IS NULL
       AND cm2.user_id = ? AND cm2.deleted_at IS NULL AND cm2.status = 'active'
)`;

// True when the survey is attached (live link) to a live cohort where the user
// is a live member — the student read/submit gate, mirroring lessonForRead.
async function isMemberOfAttachedCohort(surveyId, userId) {
    const row = await dbAdapter.get(
        `SELECT 1 FROM cohort_surveys cs
           JOIN cohorts co ON co.id = cs.cohort_id AND co.deleted_at IS NULL
           JOIN cohort_members cm ON cm.cohort_id = cs.cohort_id
          WHERE cs.survey_id = ? AND cs.deleted_at IS NULL
            AND cm.user_id = ? AND cm.deleted_at IS NULL AND cm.status = 'active'
          LIMIT 1`,
        [surveyId, userId]
    );
    return !!row;
}

// ===========================================================================
// Survey CRUD
// ===========================================================================

// GET /surveys[?courseId=] — teacher's own (or published for students; all for admin),
// optionally restricted to surveys attached to a cohort.
router.get('/surveys', authenticateToken, async (req, res) => {
    try {
        const courseId = req.query.courseId != null ? Number(req.query.courseId) : null;
        const where = ['s.tenant_id = ?', 's.deleted_at IS NULL'];
        const params = [tenantId(req)];
        if (isAdminReq(req)) {
            // all
        } else {
            // own OR (published AND attached to a cohort the caller belongs to)
            // — a published survey must NOT leak tenant-wide to non-members.
            where.push(`(s.created_by_id = ? OR (s.is_published = 1 AND ${MEMBER_ATTACHED_EXISTS}))`);
            params.push(req.user.id, req.user.id);
        }
        let sql = `SELECT s.* FROM surveys s`;
        if (Number.isInteger(courseId)) {
            sql += ` JOIN cohort_surveys cs ON cs.survey_id = s.id AND cs.cohort_id = ? AND cs.deleted_at IS NULL`;
            params.unshift(courseId); // cs.cohort_id bind is first
        }
        sql += ` WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC`;
        const rows = await dbAdapter.all(sql, params);
        // The manager table reads s._count.questions / s._count.responses for
        // display and publish gating (LAILA/Prisma shape) — batch both counts.
        const counts = { questions: new Map(), responses: new Map() };
        if (rows.length) {
            const ids = rows.map((r) => r.id);
            const marks = ids.map(() => '?').join(',');
            const qRows = await dbAdapter.all(
                `SELECT survey_id, COUNT(*) AS n FROM survey_questions
                  WHERE survey_id IN (${marks}) AND deleted_at IS NULL GROUP BY survey_id`,
                ids
            );
            qRows.forEach((r) => counts.questions.set(r.survey_id, r.n));
            const rRows = await dbAdapter.all(
                `SELECT survey_id, COUNT(*) AS n FROM survey_responses
                  WHERE survey_id IN (${marks}) GROUP BY survey_id`,
                ids
            );
            rRows.forEach((r) => counts.responses.set(r.survey_id, r.n));
        }
        return ok(res, rows.map((r) => ({
            ...mapSurvey(r),
            _count: {
                questions: counts.questions.get(r.id) || 0,
                responses: counts.responses.get(r.id) || 0,
            },
        })));
    } catch (err) {
        log.error('list surveys failed', { error: err.message });
        return fail(res, 500, 'Failed to list surveys');
    }
});

// POST /surveys
router.post('/surveys', authenticateToken, requireEducator, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.title || String(b.title).trim().length < 1) return fail(res, 400, 'Title is required');
        const { lastID } = await dbAdapter.run(
            `INSERT INTO surveys (tenant_id, title, description, created_by_id, is_published, is_anonymous)
             VALUES (?,?,?,?,?,?)`,
            [tenantId(req), stripHtmlToText(String(b.title)).trim(),
             b.description != null ? stripHtmlToText(String(b.description)) : null, req.user.id,
             b.isPublished ? 1 : 0, b.isAnonymous ? 1 : 0]
        );
        const row = await dbAdapter.get(`SELECT * FROM surveys WHERE id = ?`, [lastID]);
        return ok(res, mapSurvey(row, []), 201);
    } catch (err) {
        log.error('create survey failed', { error: err.message });
        return fail(res, 500, 'Failed to create survey');
    }
});

// GET /surveys/:id — with questions. Drafts visible to owner/admin only.
router.get('/surveys/:id', authenticateToken, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await loadSurvey(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const isOwnerOrAdmin = survey.created_by_id === req.user.id || isAdminReq(req);
        // Non-owners may only read a PUBLISHED survey that is attached to a
        // cohort they are a live member of — no tenant-wide read leak.
        if (!isOwnerOrAdmin) {
            if (!survey.is_published || !(await isMemberOfAttachedCohort(surveyId, req.user.id))) {
                return fail(res, 404, 'Survey not found');
            }
        }
        const questions = await questionsFor(surveyId);
        return ok(res, mapSurvey(survey, questions));
    } catch (err) {
        log.error('get survey failed', { error: err.message });
        return fail(res, 500, 'Failed to load survey');
    }
});

// PUT /surveys/:id
router.put('/surveys/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const b = req.body || {};
        const sets = []; const params = [];
        const put = (c, v) => { sets.push(`${c} = ?`); params.push(v); };
        if (b.title !== undefined) put('title', stripHtmlToText(String(b.title)));
        if (b.description !== undefined) {
            put('description', b.description != null ? stripHtmlToText(String(b.description)) : null);
        }
        if (b.isPublished !== undefined) put('is_published', b.isPublished ? 1 : 0);
        if (b.isAnonymous !== undefined) put('is_anonymous', b.isAnonymous ? 1 : 0);
        if (sets.length) {
            params.push(surveyId);
            await dbAdapter.run(
                `UPDATE surveys SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params
            );
        }
        const row = await dbAdapter.get(`SELECT * FROM surveys WHERE id = ?`, [surveyId]);
        const questions = await questionsFor(surveyId);
        return ok(res, mapSurvey(row, questions));
    } catch (err) {
        log.error('update survey failed', { error: err.message });
        return fail(res, 500, 'Failed to update survey');
    }
});

// DELETE /surveys/:id — soft-delete.
router.delete('/surveys/:id', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        await dbAdapter.run(`UPDATE surveys SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [surveyId]);
        return ok(res, { message: 'Deleted' });
    } catch (err) {
        log.error('delete survey failed', { error: err.message });
        return fail(res, 500, 'Failed to delete survey');
    }
});

// POST /surveys/:id/publish — refuses a 0-question survey.
router.post('/surveys/:id/publish', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const q = await dbAdapter.get(
            `SELECT COUNT(*) AS n FROM survey_questions WHERE survey_id = ? AND deleted_at IS NULL`, [surveyId]
        );
        if (!q.n) return fail(res, 400, 'Add at least one question before publishing');
        await dbAdapter.run(
            `UPDATE surveys SET is_published = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [surveyId]
        );
        const row = await dbAdapter.get(`SELECT * FROM surveys WHERE id = ?`, [surveyId]);
        return ok(res, mapSurvey(row));
    } catch (err) {
        log.error('publish survey failed', { error: err.message });
        return fail(res, 500, 'Failed to publish survey');
    }
});

// ===========================================================================
// Questions
// ===========================================================================

function validateQuestion(b) {
    if (!b.questionText || String(b.questionText).trim().length < 1) return 'Question text is required';
    if (!QUESTION_TYPES.has(b.questionType)) return 'Invalid question type';
    if (b.questionType !== 'free_text') {
        const opts = Array.isArray(b.options) ? b.options.filter((o) => String(o).trim() !== '') : [];
        if (opts.length < 2) return 'Choice questions need at least two options';
    }
    return null;
}

// POST /surveys/:id/questions
router.post('/surveys/:id/questions', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const b = req.body || {};
        const err = validateQuestion(b);
        if (err) return fail(res, 400, err);
        const options = b.questionType === 'free_text' ? null
            : JSON.stringify((b.options || []).map((o) => stripHtmlToText(String(o))));
        const maxRow = await dbAdapter.get(
            `SELECT COALESCE(MAX(order_index), -1) AS mx FROM survey_questions
              WHERE survey_id = ? AND deleted_at IS NULL`, [surveyId]
        );
        const orderIndex = Number.isInteger(b.orderIndex) ? b.orderIndex : maxRow.mx + 1;
        const { lastID } = await dbAdapter.run(
            `INSERT INTO survey_questions
               (survey_id, question_text, question_type, options, is_required, order_index)
             VALUES (?,?,?,?,?,?)`,
            [surveyId, stripHtmlToText(String(b.questionText)).trim(), b.questionType, options,
             b.isRequired === false ? 0 : 1, orderIndex]
        );
        const row = await dbAdapter.get(`SELECT * FROM survey_questions WHERE id = ?`, [lastID]);
        return ok(res, mapQuestion(row), 201);
    } catch (err) {
        log.error('add question failed', { error: err.message });
        return fail(res, 500, 'Failed to add question');
    }
});

// PUT /surveys/:id/questions/:questionId
router.put('/surveys/:id/questions/:questionId', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const questionId = Number(req.params.questionId);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const q = await dbAdapter.get(
            `SELECT * FROM survey_questions WHERE id = ? AND survey_id = ? AND deleted_at IS NULL`,
            [questionId, surveyId]
        );
        if (!q) return fail(res, 404, 'Question not found');
        const b = req.body || {};
        const sets = []; const params = [];
        const put = (c, v) => { sets.push(`${c} = ?`); params.push(v); };
        if (b.questionText !== undefined) put('question_text', stripHtmlToText(String(b.questionText)));
        if (b.questionType !== undefined) {
            if (!QUESTION_TYPES.has(b.questionType)) return fail(res, 400, 'Invalid question type');
            put('question_type', b.questionType);
        }
        if (b.options !== undefined) {
            put('options', Array.isArray(b.options)
                ? JSON.stringify(b.options.map((o) => stripHtmlToText(String(o)))) : null);
        }
        if (b.isRequired !== undefined) put('is_required', b.isRequired ? 1 : 0);
        if (b.orderIndex !== undefined) put('order_index', Number(b.orderIndex) || 0);
        if (sets.length) {
            params.push(questionId);
            await dbAdapter.run(`UPDATE survey_questions SET ${sets.join(', ')} WHERE id = ?`, params);
        }
        const row = await dbAdapter.get(`SELECT * FROM survey_questions WHERE id = ?`, [questionId]);
        return ok(res, mapQuestion(row));
    } catch (err) {
        log.error('update question failed', { error: err.message });
        return fail(res, 500, 'Failed to update question');
    }
});

// DELETE /surveys/:id/questions/:questionId
router.delete('/surveys/:id/questions/:questionId', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const questionId = Number(req.params.questionId);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const q = await dbAdapter.get(
            `SELECT id FROM survey_questions WHERE id = ? AND survey_id = ? AND deleted_at IS NULL`,
            [questionId, surveyId]
        );
        if (!q) return fail(res, 404, 'Question not found');
        await dbAdapter.run(`UPDATE survey_questions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [questionId]);
        return ok(res, { message: 'Deleted' });
    } catch (err) {
        log.error('delete question failed', { error: err.message });
        return fail(res, 500, 'Failed to delete question');
    }
});

// POST /surveys/:id/questions/reorder
router.post('/surveys/:id/questions/reorder', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const ids = Array.isArray(req.body?.questionIds)
            ? req.body.questionIds.map(Number).filter(Number.isInteger) : null;
        if (!ids || !ids.length) return fail(res, 400, 'questionIds required');
        const owned = await dbAdapter.all(
            `SELECT id FROM survey_questions WHERE survey_id = ? AND deleted_at IS NULL`, [surveyId]
        );
        const set = new Set(owned.map((r) => r.id));
        if (!ids.every((id) => set.has(id))) return fail(res, 400, 'Unknown question id');
        await dbAdapter.transaction(async () => {
            for (let i = 0; i < ids.length; i++) {
                await dbAdapter.run(`UPDATE survey_questions SET order_index = ? WHERE id = ?`, [i, ids[i]]);
            }
        });
        return ok(res, { message: 'Reordered' });
    } catch (err) {
        log.error('reorder questions failed', { error: err.message });
        return fail(res, 500, 'Failed to reorder questions');
    }
});

// ===========================================================================
// Responses
// ===========================================================================

// POST /surveys/:id/submit
router.post('/surveys/:id/submit', authenticateToken, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const b = req.body || {};
        const survey = await dbAdapter.get(
            `SELECT * FROM surveys WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
            [surveyId, tenantId(req)]
        );
        if (!survey || !survey.is_published) return fail(res, 404, 'Survey not found');

        const cohortId = b.classroomId != null ? Number(b.classroomId) : null;
        // If tied to a cohort, the caller must be a live member (owner/admin bypass).
        if (Number.isInteger(cohortId)) {
            const manage = await resolveManageableCohort(cohortId, req);
            if (!manage && !(await isLiveCohortMember(cohortId, req.user.id))) {
                return fail(res, 403, 'Not enrolled in this course');
            }
            const attached = await dbAdapter.get(
                `SELECT 1 FROM cohort_surveys WHERE cohort_id = ? AND survey_id = ? AND deleted_at IS NULL LIMIT 1`,
                [cohortId, surveyId]
            );
            if (!attached) return fail(res, 400, 'Survey is not part of this course');
        } else {
            // Standalone submit: only the owner/admin or a live member of a
            // cohort the survey is attached to may respond — no open door.
            const isOwnerOrAdmin = survey.created_by_id === req.user.id || isAdminReq(req);
            if (!isOwnerOrAdmin && !(await isMemberOfAttachedCohort(surveyId, req.user.id))) {
                return fail(res, 403, 'Not enrolled in this course');
            }
        }

        // Dedupe non-anonymous responses per (survey, user, cohort).
        if (!survey.is_anonymous) {
            const dup = await dbAdapter.get(
                `SELECT 1 FROM survey_responses
                  WHERE survey_id = ? AND user_id = ?
                    AND (cohort_id IS ? OR cohort_id = ?) LIMIT 1`,
                [surveyId, req.user.id, cohortId, cohortId]
            );
            if (dup) return fail(res, 409, 'You have already responded');
        }

        const questions = await questionsFor(surveyId);
        const qById = new Map(questions.map((q) => [q.id, q]));
        const answers = Array.isArray(b.answers) ? b.answers : [];
        // Required-question enforcement.
        for (const q of questions) {
            if (!q.is_required) continue;
            const a = answers.find((x) => Number(x.questionId) === q.id);
            const empty = !a || a.answerValue == null ||
                (Array.isArray(a.answerValue) ? a.answerValue.length === 0 : String(a.answerValue).trim() === '');
            if (empty) return fail(res, 400, 'Please answer all required questions');
        }

        const responseId = await dbAdapter.transaction(async () => {
            const { lastID } = await dbAdapter.run(
                `INSERT INTO survey_responses (survey_id, user_id, cohort_id, context, context_id)
                 VALUES (?,?,?,?,?)`,
                [surveyId, survey.is_anonymous ? null : req.user.id, cohortId,
                 b.context ?? (cohortId ? 'module' : 'standalone'),
                 Number.isInteger(b.contextId) ? b.contextId : null]
            );
            for (const a of answers) {
                const q = qById.get(Number(a.questionId));
                if (!q) continue; // ignore foreign questions
                // Strip HTML server-side — free-text answers are rendered in
                // the analytics view; option values gain nothing from markup.
                const value = Array.isArray(a.answerValue)
                    ? JSON.stringify(a.answerValue.map((v) => stripHtmlToText(String(v))))
                    : stripHtmlToText(String(a.answerValue ?? ''));
                await dbAdapter.run(
                    `INSERT INTO survey_answers (response_id, question_id, answer_value) VALUES (?,?,?)`,
                    [lastID, q.id, value]
                );
            }
            return lastID;
        });
        return ok(res, { id: responseId }, 201);
    } catch (err) {
        log.error('submit survey failed', { error: err.message });
        return fail(res, 500, 'Failed to submit response');
    }
});

// GET /surveys/:id/my-response[?moduleId=]
router.get('/surveys/:id/my-response', authenticateToken, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const cohortId = req.query.moduleId != null ? Number(req.query.moduleId) : null;
        const row = await dbAdapter.get(
            `SELECT 1 FROM survey_responses
              WHERE survey_id = ? AND user_id = ?
                AND (? IS NULL OR cohort_id = ?) LIMIT 1`,
            [surveyId, req.user.id, Number.isInteger(cohortId) ? cohortId : null,
             Number.isInteger(cohortId) ? cohortId : null]
        );
        return ok(res, { completed: !!row });
    } catch (err) {
        log.error('my-response failed', { error: err.message });
        return fail(res, 500, 'Failed to check response');
    }
});

// Build per-question aggregates for analytics/export.
async function collectResponses(surveyId, cohortId) {
    const questions = await questionsFor(surveyId);
    const params = [surveyId];
    let where = 'r.survey_id = ?';
    if (Number.isInteger(cohortId)) { where += ' AND r.cohort_id = ?'; params.push(cohortId); }
    const responses = await dbAdapter.all(`SELECT * FROM survey_responses r WHERE ${where}`, params);
    const respIds = responses.map((r) => r.id);
    let answers = [];
    if (respIds.length) {
        answers = await dbAdapter.all(
            `SELECT * FROM survey_answers WHERE response_id IN (${respIds.map(() => '?').join(',')})`,
            respIds
        );
    }
    return { questions, responses, answers };
}

// GET /surveys/:id/responses[?moduleId=] — aggregated stats + raw responses.
router.get('/surveys/:id/responses', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const cohortId = req.query.moduleId != null ? Number(req.query.moduleId) : null;
        const { questions, responses, answers } = await collectResponses(surveyId, cohortId);
        const byQuestion = questions.map((q) => {
            const qAnswers = answers.filter((a) => a.question_id === q.id);
            const opts = safeJsonArray(q.options);
            const optionCounts = {};
            opts.forEach((o) => { optionCounts[o] = 0; });
            const freeTexts = [];
            for (const a of qAnswers) {
                if (q.question_type === 'free_text') { freeTexts.push(a.answer_value); continue; }
                let vals;
                try { const p = JSON.parse(a.answer_value); vals = Array.isArray(p) ? p : [a.answer_value]; }
                catch { vals = [a.answer_value]; }
                vals.forEach((v) => { optionCounts[v] = (optionCounts[v] || 0) + 1; });
            }
            return {
                questionId: q.id,
                questionText: q.question_text,
                questionType: q.question_type,
                options: opts,
                optionCounts,
                freeTexts,
                // SurveyResponses.jsx contract: per-question answer count and
                // (for free_text) the raw texts under `responses`.
                totalResponses: qAnswers.length,
                responses: freeTexts,
            };
        });
        // Raw per-respondent view (SurveyResponses "Individual" tab). User
        // identity is only attached when the survey is not anonymous.
        const anon = !!survey.is_anonymous;
        let usersById = new Map();
        if (!anon) {
            const uids = [...new Set(responses.map((r) => r.user_id).filter(Boolean))];
            if (uids.length) {
                const uRows = await dbAdapter.all(
                    `SELECT id, username, email FROM users WHERE id IN (${uids.map(() => '?').join(',')})`,
                    uids
                );
                usersById = new Map(uRows.map((u) => [u.id, u]));
            }
        }
        const textByQuestion = new Map(questions.map((q) => [q.id, q.question_text]));
        const answersByResp = new Map();
        for (const a of answers) {
            if (!answersByResp.has(a.response_id)) answersByResp.set(a.response_id, []);
            answersByResp.get(a.response_id).push(a);
        }
        const rawResponses = responses.map((r) => {
            const u = anon ? null : usersById.get(r.user_id);
            return {
                id: r.id,
                completedAt: r.completed_at,
                user: u ? { displayName: u.username, email: u.email } : null,
                answers: (answersByResp.get(r.id) || []).map((a) => {
                    let answerValue = a.answer_value;
                    try {
                        const p = JSON.parse(a.answer_value);
                        if (Array.isArray(p)) answerValue = p;
                    } catch { /* scalar answer stays as-is */ }
                    return {
                        id: a.id,
                        answerValue,
                        question: { questionText: textByQuestion.get(a.question_id) || '' },
                    };
                }),
            };
        });
        return ok(res, {
            survey: mapSurvey(survey),
            totalResponses: responses.length,
            isAnonymous: anon,
            questionStats: byQuestion,
            responses: rawResponses,
            // Legacy alias kept for existing consumers/tests.
            questions: byQuestion,
        });
    } catch (err) {
        log.error('get responses failed', { error: err.message });
        return fail(res, 500, 'Failed to load responses');
    }
});

// GET /surveys/:id/export — CSV (omits user column when anonymous).
router.get('/surveys/:id/export', authenticateToken, requireEducator, async (req, res) => {
    try {
        const surveyId = Number(req.params.id);
        const survey = await surveyForManage(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        const cohortId = req.query.moduleId != null ? Number(req.query.moduleId) : null;
        const { questions, responses, answers } = await collectResponses(surveyId, cohortId);
        const anon = !!survey.is_anonymous;
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = [...(anon ? [] : ['user_id']), 'completed_at', ...questions.map((q) => q.question_text)];
        const answersByResp = new Map();
        for (const a of answers) {
            if (!answersByResp.has(a.response_id)) answersByResp.set(a.response_id, {});
            answersByResp.get(a.response_id)[a.question_id] = a.answer_value;
        }
        const lines = [header.map(esc).join(',')];
        for (const r of responses) {
            const amap = answersByResp.get(r.id) || {};
            const cells = [
                ...(anon ? [] : [r.user_id]),
                r.completed_at,
                ...questions.map((q) => {
                    const raw = amap[q.id];
                    if (raw == null) return '';
                    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.join('; ') : raw; }
                    catch { return raw; }
                }),
            ];
            lines.push(cells.map(esc).join(','));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="survey_${surveyId}.csv"`);
        return res.send(lines.join('\n'));
    } catch (err) {
        log.error('export survey failed', { error: err.message });
        return fail(res, 500, 'Failed to export');
    }
});

// ===========================================================================
// Cohort attachment (module surveys)
// ===========================================================================

// GET /surveys/module/:moduleId — surveys attached to a cohort.
router.get('/surveys/module/:moduleId', authenticateToken, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        if (!Number.isInteger(cohortId)) return fail(res, 400, 'Invalid module id');
        const manage = await resolveManageableCohort(cohortId, req);
        if (!manage && !(await isLiveCohortMember(cohortId, req.user.id))) {
            return fail(res, 404, 'Course not found');
        }
        const rows = await dbAdapter.all(
            `SELECT cs.id AS link_id, cs.order_index AS link_order, s.*
               FROM cohort_surveys cs JOIN surveys s ON s.id = cs.survey_id
              WHERE cs.cohort_id = ? AND cs.deleted_at IS NULL AND s.deleted_at IS NULL
                ${manage ? '' : 'AND s.is_published = 1'}
              ORDER BY cs.order_index ASC, cs.id ASC`,
            [cohortId]
        );
        // One grouped COUNT for all attached surveys (was a per-survey query).
        const countBySurvey = new Map();
        if (rows.length) {
            const counts = await dbAdapter.all(
                `SELECT survey_id, COUNT(*) AS n FROM survey_questions
                  WHERE survey_id IN (${rows.map(() => '?').join(',')}) AND deleted_at IS NULL
                  GROUP BY survey_id`,
                rows.map((r) => r.id)
            );
            counts.forEach((c) => countBySurvey.set(c.survey_id, c.n));
        }
        const data = rows.map((r) => ({
            id: r.link_id,
            classroomId: cohortId,
            surveyId: r.id,
            orderIndex: r.link_order,
            survey: { ...mapSurvey(r), _count: { questions: countBySurvey.get(r.id) || 0 } },
        }));
        return ok(res, data);
    } catch (err) {
        log.error('module surveys failed', { error: err.message });
        return fail(res, 500, 'Failed to list course surveys');
    }
});

// POST /surveys/module/:moduleId — attach a survey to a cohort.
router.post('/surveys/module/:moduleId', authenticateToken, requireEducator, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        const manage = await resolveManageableCohort(cohortId, req);
        if (!manage) return fail(res, 404, 'Course not found');
        const surveyId = Number(req.body?.surveyId);
        if (!Number.isInteger(surveyId)) return fail(res, 400, 'surveyId required');
        const survey = await loadSurvey(surveyId, req);
        if (!survey) return fail(res, 404, 'Survey not found');
        // Revive a soft-deleted link or insert a new one (idempotent).
        const existing = await dbAdapter.get(
            `SELECT * FROM cohort_surveys WHERE cohort_id = ? AND survey_id = ?`, [cohortId, surveyId]
        );
        let linkId;
        if (existing) {
            await dbAdapter.run(
                `UPDATE cohort_surveys SET deleted_at = NULL WHERE id = ?`, [existing.id]
            );
            linkId = existing.id;
        } else {
            const maxRow = await dbAdapter.get(
                `SELECT COALESCE(MAX(order_index), -1) AS mx FROM cohort_surveys
                  WHERE cohort_id = ? AND deleted_at IS NULL`, [cohortId]
            );
            const r = await dbAdapter.run(
                `INSERT INTO cohort_surveys (cohort_id, survey_id, order_index) VALUES (?,?,?)`,
                [cohortId, surveyId, maxRow.mx + 1]
            );
            linkId = r.lastID;
        }
        return ok(res, { id: linkId, classroomId: cohortId, surveyId }, 201);
    } catch (err) {
        log.error('attach survey failed', { error: err.message });
        return fail(res, 500, 'Failed to attach survey');
    }
});

// DELETE /surveys/module/:moduleId/:surveyId — detach.
router.delete('/surveys/module/:moduleId/:surveyId', authenticateToken, requireEducator, async (req, res) => {
    try {
        const cohortId = Number(req.params.moduleId);
        const surveyId = Number(req.params.surveyId);
        const manage = await resolveManageableCohort(cohortId, req);
        if (!manage) return fail(res, 404, 'Course not found');
        await dbAdapter.run(
            `UPDATE cohort_surveys SET deleted_at = CURRENT_TIMESTAMP
              WHERE cohort_id = ? AND survey_id = ? AND deleted_at IS NULL`,
            [cohortId, surveyId]
        );
        return ok(res, { message: 'Detached' });
    } catch (err) {
        log.error('detach survey failed', { error: err.message });
        return fail(res, 500, 'Failed to detach survey');
    }
});

export default router;
