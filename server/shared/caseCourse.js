// A case's course side: when the course materials open for a learner
// (`config.courseGate`) and the questionnaires the case asks
// (`config.questionnaires`). Both live in the case config so they travel with
// the case — export/import and case packages carry them unchanged — and both
// are read by the server and the case editor, hence `server/shared/`.
//
// The gate decides nothing by itself. A course lesson is locked by pointing at
// a case (`lessons.unlock_case_id`); the server then evaluates THAT case's gate
// for the learner asking (services/courseGate.js) and withholds the lesson's
// content until it opens. A gate no lesson points at still anchors the case's
// pre/post questionnaires.
//
// A questionnaire's answer key (`correct`, `feedback`) never reaches a
// learner before it is released: the learner reads questionnaires through
// GET /cases/:caseId/course-state, which sends learnerQuestionnaire() copies,
// and the case projection does not allow `questionnaires` at all.

export const QUESTION_TYPES = Object.freeze(['single', 'multiple', 'text']);

/**
 * When a questionnaire is answered, relative to the course gate:
 * - `during`   once, at any time in the case
 * - `pre_post` twice, the same questions: `pre` while the materials are
 *              locked, `post` once they open — the difference is the gain
 * - `after`    once, after the materials open
 */
export const QUESTIONNAIRE_TIMINGS = Object.freeze(['during', 'pre_post', 'after']);

export const COURSE_LIMITS = Object.freeze({
    maxMinutes: 24 * 60,
    questionnaires: 10,
    questions: 50,
    options: 10,
    titleChars: 200,
    textChars: 2000,
    answerChars: 4000,
});

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function text(value, max, field, { required = false } = {}) {
    if (value === undefined || value === null) {
        return required ? { problem: `${field} is required` } : { value: '' };
    }
    if (typeof value !== 'string') return { problem: `${field} must be text` };
    const trimmed = value.trim();
    if (required && !trimmed) return { problem: `${field} is required` };
    if (trimmed.length > max) return { problem: `${field} is longer than ${max} characters` };
    return { value: trimmed };
}

/**
 * The course gate as stored, or a problem the save must refuse.
 *
 * A gate at its defaults (no minutes, no slide condition) is stored as
 * nothing: `{ gate: null }`.
 *
 * @param {unknown} raw  config.courseGate
 * @returns {{gate: {afterMinutes: number, allSlidesOpened: boolean}|null, problem?: string}}
 */
export function normaliseCourseGate(raw) {
    if (raw === undefined || raw === null) return { gate: null };
    if (!isPlainObject(raw)) return { gate: null, problem: 'courseGate must be an object' };
    const afterMinutes = raw.afterMinutes ?? 0;
    if (!Number.isInteger(afterMinutes) || afterMinutes < 0 || afterMinutes > COURSE_LIMITS.maxMinutes) {
        return { gate: null, problem: `courseGate.afterMinutes must be a whole number from 0 to ${COURSE_LIMITS.maxMinutes}` };
    }
    const allSlidesOpened = raw.allSlidesOpened ?? false;
    if (typeof allSlidesOpened !== 'boolean') {
        return { gate: null, problem: 'courseGate.allSlidesOpened must be true or false' };
    }
    if (afterMinutes === 0 && !allSlidesOpened) return { gate: null };
    return { gate: { afterMinutes, allSlidesOpened } };
}

function normaliseQuestion(raw, where) {
    if (!isPlainObject(raw)) return { problem: `${where} must be an object` };
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { problem: `${where}.id must be 1–64 letters, digits, - or _` };
    if (!QUESTION_TYPES.includes(raw.type)) return { problem: `${where}.type must be one of ${QUESTION_TYPES.join(', ')}` };
    const prompt = text(raw.text, COURSE_LIMITS.textChars, `${where}.text`, { required: true });
    if (prompt.problem) return prompt;
    const feedback = text(raw.feedback, COURSE_LIMITS.textChars, `${where}.feedback`);
    if (feedback.problem) return feedback;
    const required = raw.required ?? true;
    if (typeof required !== 'boolean') return { problem: `${where}.required must be true or false` };
    const question = { id: raw.id, type: raw.type, text: prompt.value, required };
    if (feedback.value) question.feedback = feedback.value;
    if (raw.type === 'text') {
        if (raw.options !== undefined || raw.correct !== undefined) {
            return { problem: `${where} is a text question and takes no options or correct answer` };
        }
        return { question };
    }
    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > COURSE_LIMITS.options) {
        return { problem: `${where}.options must list 2 to ${COURSE_LIMITS.options} choices` };
    }
    const options = [];
    for (const [i, option] of raw.options.entries()) {
        const checked = text(option, COURSE_LIMITS.titleChars, `${where}.options[${i}]`, { required: true });
        if (checked.problem) return checked;
        options.push(checked.value);
    }
    question.options = options;
    const correct = raw.correct ?? [];
    if (!Array.isArray(correct) || !correct.every((n) => Number.isInteger(n) && n >= 0 && n < options.length)) {
        return { problem: `${where}.correct must list option numbers` };
    }
    if (new Set(correct).size !== correct.length) return { problem: `${where}.correct lists an option twice` };
    if (raw.type === 'single' && correct.length > 1) return { problem: `${where} is single choice and takes one correct option` };
    if (correct.length) question.correct = [...correct].sort((a, b) => a - b);
    return { question };
}

function normaliseQuestionnaire(raw, where) {
    if (!isPlainObject(raw)) return { problem: `${where} must be an object` };
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { problem: `${where}.id must be 1–64 letters, digits, - or _` };
    const title = text(raw.title, COURSE_LIMITS.titleChars, `${where}.title`, { required: true });
    if (title.problem) return title;
    const instructions = text(raw.instructions, COURSE_LIMITS.textChars, `${where}.instructions`);
    if (instructions.problem) return instructions;
    if (!QUESTIONNAIRE_TIMINGS.includes(raw.timing)) {
        return { problem: `${where}.timing must be one of ${QUESTIONNAIRE_TIMINGS.join(', ')}` };
    }
    const graded = raw.graded ?? false;
    if (typeof graded !== 'boolean') return { problem: `${where}.graded must be true or false` };
    if (!Array.isArray(raw.questions) || raw.questions.length === 0 || raw.questions.length > COURSE_LIMITS.questions) {
        return { problem: `${where}.questions must list 1 to ${COURSE_LIMITS.questions} questions` };
    }
    const questions = [];
    const ids = new Set();
    for (const [i, rawQuestion] of raw.questions.entries()) {
        const { question, problem } = normaliseQuestion(rawQuestion, `${where}.questions[${i}]`);
        if (problem) return { problem };
        if (ids.has(question.id)) return { problem: `${where}.questions[${i}].id "${question.id}" is used twice` };
        ids.add(question.id);
        questions.push(question);
    }
    const questionnaire = { id: raw.id, title: title.value, timing: raw.timing, graded, questions };
    if (instructions.value) questionnaire.instructions = instructions.value;
    return { questionnaire };
}

/**
 * The questionnaires as stored, or a problem the save must refuse. An empty
 * list is stored as nothing: `{ questionnaires: null }`.
 *
 * @param {unknown} raw  config.questionnaires
 * @returns {{questionnaires: object[]|null, problem?: string}}
 */
export function normaliseQuestionnaires(raw) {
    if (raw === undefined || raw === null) return { questionnaires: null };
    if (!Array.isArray(raw)) return { questionnaires: null, problem: 'questionnaires must be a list' };
    if (raw.length > COURSE_LIMITS.questionnaires) {
        return { questionnaires: null, problem: `a case takes at most ${COURSE_LIMITS.questionnaires} questionnaires` };
    }
    const out = [];
    const ids = new Set();
    for (const [i, rawQuestionnaire] of raw.entries()) {
        const { questionnaire, problem } = normaliseQuestionnaire(rawQuestionnaire, `questionnaires[${i}]`);
        if (problem) return { questionnaires: null, problem };
        if (ids.has(questionnaire.id)) return { questionnaires: null, problem: `questionnaires[${i}].id "${questionnaire.id}" is used twice` };
        ids.add(questionnaire.id);
        out.push(questionnaire);
    }
    return { questionnaires: out.length ? out : null };
}

/** A questionnaire without its answer key: no `correct`, no `feedback`. */
export function learnerQuestionnaire(questionnaire) {
    return {
        ...questionnaire,
        questions: questionnaire.questions.map(({ correct: _correct, feedback: _feedback, ...rest }) => rest),
    };
}

/**
 * The attempt a learner may submit now, or null when none is open.
 *
 * @param {object} questionnaire
 * @param {boolean} unlocked     the case's course gate is open for this learner
 * @param {Iterable<string>} submitted  attempts this learner already submitted
 * @returns {'single'|'pre'|'post'|null}
 */
export function openAttempt(questionnaire, unlocked, submitted) {
    const done = new Set(submitted);
    if (questionnaire.timing === 'during') return done.has('single') ? null : 'single';
    if (questionnaire.timing === 'after') return unlocked && !done.has('single') ? 'single' : null;
    if (!unlocked) return done.has('pre') ? null : 'pre';
    return done.has('post') ? null : 'post';
}

/**
 * Whether a submitted attempt may show its score and feedback. A pre-test
 * shows neither: its answers would otherwise be the post-test's answer key.
 */
export function releasesFeedback(questionnaire, attempt) {
    return questionnaire.graded && attempt !== 'pre';
}

/**
 * Answers checked against the questions, or a problem to refuse.
 *
 * Answers are keyed by question id: an option number for `single`, a list of
 * option numbers for `multiple`, text for `text`. An unanswered optional
 * question is simply absent.
 *
 * @returns {{answers: object, problem?: string}}
 */
export function checkAnswers(questionnaire, raw) {
    if (!isPlainObject(raw)) return { answers: {}, problem: 'answers must be an object keyed by question id' };
    const known = new Set(questionnaire.questions.map((q) => q.id));
    const stray = Object.keys(raw).find((id) => !known.has(id));
    if (stray) return { answers: {}, problem: `no question "${stray}" in this questionnaire` };
    const answers = {};
    for (const question of questionnaire.questions) {
        const value = raw[question.id];
        const empty = value === undefined || value === null
            || (typeof value === 'string' && !value.trim())
            || (Array.isArray(value) && value.length === 0);
        if (empty) {
            // Required unless it says otherwise — the stored default.
            if (question.required !== false) return { answers: {}, problem: `question "${question.id}" needs an answer` };
            continue;
        }
        if (question.type === 'text') {
            if (typeof value !== 'string') return { answers: {}, problem: `question "${question.id}" takes text` };
            if (value.trim().length > COURSE_LIMITS.answerChars) {
                return { answers: {}, problem: `the answer to "${question.id}" is longer than ${COURSE_LIMITS.answerChars} characters` };
            }
            answers[question.id] = value.trim();
        } else if (question.type === 'single') {
            if (!Number.isInteger(value) || value < 0 || value >= question.options.length) {
                return { answers: {}, problem: `question "${question.id}" takes one option number` };
            }
            answers[question.id] = value;
        } else {
            const valid = Array.isArray(value)
                && value.every((n) => Number.isInteger(n) && n >= 0 && n < question.options.length)
                && new Set(value).size === value.length;
            if (!valid) return { answers: {}, problem: `question "${question.id}" takes a list of different option numbers` };
            answers[question.id] = [...value].sort((a, b) => a - b);
        }
    }
    return { answers };
}

/**
 * The score of checked answers. Only a graded questionnaire's choice questions
 * that name a correct answer count, one point each; a multiple-choice
 * question scores only when the chosen set equals the correct set.
 *
 * @returns {{score: number, maxScore: number, results: Record<string, boolean>}|null}
 *   null for an ungraded questionnaire or one with nothing to score
 */
export function scoreAnswers(questionnaire, answers) {
    if (!questionnaire.graded) return null;
    const scored = questionnaire.questions.filter((q) => q.type !== 'text' && Array.isArray(q.correct) && q.correct.length);
    if (!scored.length) return null;
    const results = {};
    for (const question of scored) {
        const given = answers[question.id];
        const chosen = question.type === 'single' ? (Number.isInteger(given) ? [given] : []) : (Array.isArray(given) ? given : []);
        results[question.id] = chosen.length === question.correct.length
            && chosen.every((n, i) => n === question.correct[i]);
    }
    const score = Object.values(results).filter(Boolean).length;
    return { score, maxScore: scored.length, results };
}
