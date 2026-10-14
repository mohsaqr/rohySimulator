// Validation of a course-survey submission against the survey's own questions.
//
// A course survey (surveys / survey_questions, the ported LAILA builder) is a
// different instrument from a case questionnaire (cases.config.questionnaires,
// server/shared/caseCourse.js), but a learner's answer to either must be one
// the author offered. Before this, POST /surveys/:id/submit checked only that
// required questions were present, so `answerValue: 'NOT AN OPTION'` was stored
// and then counted as an extra option in the educator's results (FI-0010 F11).
//
// Course-survey answers are option TEXT (the client sends the option string it
// rendered), not option numbers as in a case questionnaire. Options are stored
// HTML-stripped, so a submitted value is stripped the same way before it is
// compared — the comparison happens on exactly the text the learner was shown.

import { stripHtmlToText } from './lessonSanitize.js';
import { COURSE_LIMITS } from '../shared/caseCourse.js';

/** Longest free-text answer, shared with case questionnaires. */
export const SURVEY_ANSWER_MAX_CHARS = COURSE_LIMITS.answerChars;

function safeOptions(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((o) => String(o)) : [];
    } catch {
        return [];
    }
}

const isEmptyAnswer = (value) => value == null
    || (Array.isArray(value) ? value.length === 0 : String(value).trim() === '');

const problem = (code, error) => ({ answers: [], problem: { code, error } });

/**
 * Check a submission's answers against the survey's questions.
 *
 * @param {Array<object>} questions  survey_questions rows (id, question_type, options, is_required).
 * @param {unknown} rawAnswers       the request's `answers` ([{ questionId, answerValue }]).
 * @returns {{answers: Array<{questionId: number, value: string}>, problem?: {code: string, error: string}}}
 *   `answers` holds the values to store (choice lists JSON-encoded), one per
 *   answered question. An answer to a question that is not in this survey is
 *   ignored, as it always was (a question deleted while the learner was
 *   answering must not cost them the rest). Empty optional answers are dropped.
 */
export function validateSurveyAnswers(questions, rawAnswers) {
    if (rawAnswers != null && !Array.isArray(rawAnswers)) {
        return problem('survey_answers_malformed', 'answers must be a list');
    }
    const list = rawAnswers ?? [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const seen = new Set();
    const out = [];

    for (const entry of list) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            return problem('survey_answers_malformed', 'each answer must be an object with questionId and answerValue');
        }
        const question = byId.get(Number(entry.questionId));
        if (!question) continue;
        if (seen.has(question.id)) {
            return problem('survey_answer_duplicate', 'a question was answered twice');
        }
        seen.add(question.id);
        const value = entry.answerValue;
        if (isEmptyAnswer(value)) continue;

        if (question.question_type === 'free_text') {
            if (typeof value !== 'string') {
                return problem('survey_answer_invalid', 'a text question takes text');
            }
            const text = stripHtmlToText(value).trim();
            if (text.length > SURVEY_ANSWER_MAX_CHARS) {
                return problem('survey_answer_too_long', `an answer is longer than ${SURVEY_ANSWER_MAX_CHARS} characters`);
            }
            if (text) out.push({ questionId: question.id, value: text });
            continue;
        }

        const options = new Set(safeOptions(question.options));
        if (question.question_type === 'single_choice') {
            if (typeof value !== 'string') {
                return problem('survey_answer_invalid', 'a single-choice question takes one of its options');
            }
            const chosen = stripHtmlToText(value);
            if (!options.has(chosen)) {
                return problem('survey_answer_not_an_option', 'an answer is not one of the question\'s options');
            }
            out.push({ questionId: question.id, value: chosen });
            continue;
        }

        if (question.question_type === 'multiple_choice') {
            if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
                return problem('survey_answer_invalid', 'a multiple-choice question takes a list of its options');
            }
            const chosen = value.map((v) => stripHtmlToText(v));
            if (new Set(chosen).size !== chosen.length) {
                return problem('survey_answer_duplicate', 'an option was chosen twice');
            }
            if (!chosen.every((v) => options.has(v))) {
                return problem('survey_answer_not_an_option', 'an answer is not one of the question\'s options');
            }
            out.push({ questionId: question.id, value: JSON.stringify(chosen) });
            continue;
        }

        // A question type the builder no longer offers: refuse rather than
        // store something the results view cannot read.
        return problem('survey_answer_invalid', 'a question has an unknown type');
    }

    for (const question of questions) {
        if (question.is_required && !out.some((a) => a.questionId === question.id)) {
            return problem('survey_answer_required', 'Please answer all required questions');
        }
    }
    return { answers: out };
}
