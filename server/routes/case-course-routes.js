// A case's course side for the learner and the educator: whether the course
// materials are open yet (the case's course gate), the case's questionnaires,
// and their answers.
//
// The questionnaires are authored in the case (config.questionnaires,
// shared/caseCourse.js). A learner never receives them through the case
// itself — the case projection does not allow the key — only through
// GET /cases/:caseId/course-state, as copies without the answer key; the
// key comes back with a submitted attempt once that attempt may show it.
//
// Answers are written once per learner, case, questionnaire and attempt
// (unique index, 0067). Which attempt is open is decided here from the
// learner's gate state, never taken from the client.

import express from 'express';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, requireEducator } from '../middleware/auth.js';
import {
    tenantId,
    auditSuccess,
    caseAccessEnforcedFor,
    canReadAcrossUsers,
    cohortCaseVisibleExists,
    resolveSessionTrinity,
} from './_helpers.js';
import { logger } from '../logger.js';
import { courseGateState } from '../services/courseGate.js';
import {
    normaliseQuestionnaires,
    learnerQuestionnaire,
    openAttempt,
    releasesFeedback,
    checkAnswers,
    scoreAnswers,
} from '../shared/caseCourse.js';

const router = express.Router();
const log = logger('routes-case-course');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(value, fallback) {
    if (typeof value !== 'string') return value ?? fallback;
    try { return JSON.parse(value); } catch { return fallback; }
}

// The case row if the caller may open the case — the same rule as
// GET /cases/:id, so a learner reads the course side of exactly the cases
// they can play. A case they cannot see is "not found".
async function readableCase(req, caseId) {
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
                AND ( c.is_default = 1 OR ${cohortCaseVisibleExists('c')} )`,
            [caseId, tenantId(req), req.user.id]
        );
    }
    return dbAdapter.get(
        'SELECT id, config FROM cases WHERE id = ? AND tenant_id = ? AND is_available = 1 AND deleted_at IS NULL',
        [caseId, tenantId(req)]
    );
}

function questionnairesOf(caseRow) {
    const config = parseJson(caseRow.config, {});
    // Stored questionnaires were checked on save; re-reading them through the
    // same normaliser means a hand-edited row cannot make the scorer throw.
    return normaliseQuestionnaires(isPlainObject(config) ? config.questionnaires : null).questionnaires ?? [];
}

/**
 * One submitted attempt as its owner sees it. The answer key — which options
 * were right, the feedback text — comes only with an attempt that releases it
 * (shared/caseCourse.js releasesFeedback). A pre-test shows its score once the
 * post-test is in, and never its per-question key.
 */
function attemptView(row, questionnaire, { postSubmitted }) {
    const view = { attempt: row.attempt, submittedAt: row.created_at, answers: parseJson(row.answers, {}) };
    const answered = parseJson(row.questionnaire, null) ?? questionnaire;
    if (releasesFeedback(answered, row.attempt)) {
        const scored = scoreAnswers(answered, view.answers);
        if (scored) Object.assign(view, { score: scored.score, maxScore: scored.maxScore, results: scored.results });
        view.key = Object.fromEntries(answered.questions
            .filter((q) => q.correct || q.feedback)
            .map((q) => [q.id, { ...(q.correct ? { correct: q.correct } : {}), ...(q.feedback ? { feedback: q.feedback } : {}) }]));
    } else if (row.attempt === 'pre' && postSubmitted && row.score !== null) {
        Object.assign(view, { score: row.score, maxScore: row.max_score });
    }
    return view;
}

// GET /cases/:caseId/course-state — the caller's gate state for the case and
// the case's questionnaires with the attempt open to them now and what they
// already submitted.
router.get('/cases/:caseId/course-state', authenticateToken, async (req, res) => {
    try {
        const caseId = Number(req.params.caseId);
        if (!Number.isInteger(caseId)) return res.status(400).json({ error: 'Invalid case id' });
        const caseRow = await readableCase(req, caseId);
        if (!caseRow) return res.status(404).json({ error: 'Case not found' });

        const gate = await courseGateState({ tenantId: tenantId(req), userId: req.user.id, caseRow });
        const questionnaires = questionnairesOf(caseRow);
        const rows = questionnaires.length ? await dbAdapter.all(
            `SELECT questionnaire_id, attempt, answers, questionnaire, score, max_score, created_at
               FROM case_questionnaire_responses
              WHERE tenant_id = ? AND case_id = ? AND user_id = ?
              ORDER BY id ASC`,
            [tenantId(req), caseId, req.user.id]
        ) : [];

        res.json({
            gate,
            questionnaires: questionnaires.map((questionnaire) => {
                const mine = rows.filter((row) => row.questionnaire_id === questionnaire.id);
                const postSubmitted = mine.some((row) => row.attempt === 'post');
                return {
                    ...learnerQuestionnaire(questionnaire),
                    openAttempt: openAttempt(questionnaire, gate.unlocked, mine.map((row) => row.attempt)),
                    attempts: mine.map((row) => attemptView(row, questionnaire, { postSubmitted })),
                };
            }),
        });
    } catch (err) {
        (req.log || log).error('course state failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load the course state' });
    }
});

// POST /cases/:caseId/questionnaires/:questionnaireId/responses — body
// { attempt, answers, sessionId? }. Refused unless `attempt` is the one open
// to the caller now; written once.
router.post('/cases/:caseId/questionnaires/:questionnaireId/responses', authenticateToken, async (req, res) => {
    try {
        const caseId = Number(req.params.caseId);
        if (!Number.isInteger(caseId)) return res.status(400).json({ error: 'Invalid case id' });
        const caseRow = await readableCase(req, caseId);
        if (!caseRow) return res.status(404).json({ error: 'Case not found' });
        const questionnaire = questionnairesOf(caseRow).find((q) => q.id === req.params.questionnaireId);
        if (!questionnaire) return res.status(404).json({ error: 'Questionnaire not found' });

        const { attempt, answers: rawAnswers, sessionId } = req.body ?? {};
        const gate = await courseGateState({ tenantId: tenantId(req), userId: req.user.id, caseRow });
        const submitted = await dbAdapter.all(
            `SELECT attempt FROM case_questionnaire_responses
              WHERE tenant_id = ? AND case_id = ? AND questionnaire_id = ? AND user_id = ?`,
            [tenantId(req), caseId, questionnaire.id, req.user.id]
        );
        const done = submitted.map((row) => row.attempt);
        if (done.includes(attempt)) {
            return res.status(409).json({ error: 'You have already answered this', code: 'already_submitted' });
        }
        const open = openAttempt(questionnaire, gate.unlocked, done);
        if (!open || attempt !== open) {
            return res.status(409).json({ error: 'This questionnaire is not open for that attempt now', code: 'attempt_closed', openAttempt: open });
        }

        const { answers, problem } = checkAnswers(questionnaire, rawAnswers);
        if (problem) return res.status(400).json({ error: problem, code: 'invalid_answers' });

        // A session is recorded only when it is the caller's own, on this case.
        let session = null;
        if (sessionId !== undefined && sessionId !== null) {
            const trinity = await resolveSessionTrinity(sessionId, tenantId(req), { principal: req.user });
            if (!trinity.found || Number(trinity.case_id) !== caseId) {
                return res.status(400).json({ error: 'sessionId is not your session on this case', code: 'invalid_session' });
            }
            session = Number(sessionId);
        }

        const scored = scoreAnswers(questionnaire, answers);
        try {
            await dbAdapter.run(
                `INSERT INTO case_questionnaire_responses
                    (tenant_id, case_id, questionnaire_id, attempt, user_id, session_id, answers, questionnaire, score, max_score)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [tenantId(req), caseId, questionnaire.id, attempt, req.user.id, session,
                    JSON.stringify(answers), JSON.stringify(questionnaire), scored?.score ?? null, scored?.maxScore ?? null]
            );
        } catch (err) {
            // Two tabs submitting at once: the unique index lets one through.
            if (/UNIQUE/i.test(err.message)) {
                return res.status(409).json({ error: 'You have already answered this', code: 'already_submitted' });
            }
            throw err;
        }

        auditSuccess(req, {
            action: 'submit_questionnaire',
            resourceType: 'case',
            resourceId: String(caseId),
            metadata: { questionnaireId: questionnaire.id, attempt, score: scored?.score ?? null, maxScore: scored?.maxScore ?? null },
        });
        req.log.info('questionnaire submitted', { case_id: caseId, questionnaire_id: questionnaire.id, attempt });

        const row = await dbAdapter.get(
            `SELECT attempt, answers, questionnaire, score, max_score, created_at FROM case_questionnaire_responses
              WHERE tenant_id = ? AND case_id = ? AND questionnaire_id = ? AND attempt = ? AND user_id = ?`,
            [tenantId(req), caseId, questionnaire.id, attempt, req.user.id]
        );
        res.status(201).json(attemptView(row, questionnaire, { postSubmitted: attempt === 'post' }));
    } catch (err) {
        (req.log || log).error('questionnaire submit failed', { error: err.message });
        res.status(500).json({ error: 'Failed to save the answers' });
    }
});

// GET /cases/:caseId/questionnaire-responses — every answer to the case's
// questionnaires, for the educator. Usernames only: the export is for
// teaching and research, and needs no name or e-mail.
router.get('/cases/:caseId/questionnaire-responses', authenticateToken, requireEducator, async (req, res) => {
    try {
        const caseId = Number(req.params.caseId);
        if (!Number.isInteger(caseId)) return res.status(400).json({ error: 'Invalid case id' });
        const caseRow = await dbAdapter.get(
            'SELECT id, config FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [caseId, tenantId(req)]
        );
        if (!caseRow) return res.status(404).json({ error: 'Case not found' });
        const rows = await dbAdapter.all(
            `SELECT r.id, r.questionnaire_id, r.attempt, r.user_id, u.username, r.session_id,
                    r.answers, r.questionnaire, r.score, r.max_score, r.created_at
               FROM case_questionnaire_responses r
               LEFT JOIN users u ON u.id = r.user_id
              WHERE r.tenant_id = ? AND r.case_id = ?
              ORDER BY r.questionnaire_id ASC, r.user_id ASC, r.id ASC`,
            [tenantId(req), caseId]
        );
        res.json({
            questionnaires: questionnairesOf(caseRow),
            responses: rows.map((row) => ({
                id: row.id,
                questionnaireId: row.questionnaire_id,
                attempt: row.attempt,
                userId: row.user_id,
                username: row.username,
                sessionId: row.session_id,
                answers: parseJson(row.answers, {}),
                questionnaire: parseJson(row.questionnaire, null),
                score: row.score,
                maxScore: row.max_score,
                submittedAt: row.created_at,
            })),
        });
    } catch (err) {
        (req.log || log).error('questionnaire responses failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load the answers' });
    }
});

export default router;
