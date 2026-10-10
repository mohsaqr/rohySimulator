// server/shared/caseCourse.js — the course gate and questionnaire rules the
// case editor and the server share.

import { describe, it, expect } from 'vitest';
import {
    normaliseCourseGate,
    normaliseQuestionnaires,
    learnerQuestionnaire,
    openAttempt,
    releasesFeedback,
    checkAnswers,
    scoreAnswers,
} from '../../server/shared/caseCourse.js';

const quiz = (overrides = {}) => ({
    id: 'quiz',
    title: 'Diagnoosi',
    timing: 'pre_post',
    graded: true,
    questions: [
        { id: 'q1', type: 'single', text: 'Origin?', options: ['Colon', 'Lung', 'Liver'], correct: [0], feedback: 'CDX2.' },
        { id: 'q2', type: 'multiple', text: 'Which are present?', options: ['A', 'B', 'C', 'D'], correct: [1, 3] },
        { id: 'q3', type: 'text', text: 'Why?', required: false },
    ],
    ...overrides,
});

describe('normaliseCourseGate', () => {
    it('stores nothing for an absent gate or one at its defaults', () => {
        expect(normaliseCourseGate(undefined)).toEqual({ gate: null });
        expect(normaliseCourseGate({ afterMinutes: 0, allSlidesOpened: false })).toEqual({ gate: null });
    });

    it('keeps minutes and the slide condition, filling the missing one', () => {
        expect(normaliseCourseGate({ afterMinutes: 15 })).toEqual({ gate: { afterMinutes: 15, allSlidesOpened: false } });
        expect(normaliseCourseGate({ allSlidesOpened: true })).toEqual({ gate: { afterMinutes: 0, allSlidesOpened: true } });
    });

    it.each([
        ['a string', 'soon'],
        ['a negative minute count', { afterMinutes: -1 }],
        ['a fraction of a minute', { afterMinutes: 1.5 }],
        ['more than a day', { afterMinutes: 24 * 60 + 1 }],
        ['a non-boolean slide condition', { allSlidesOpened: 'yes' }],
    ])('refuses %s', (_label, raw) => {
        expect(normaliseCourseGate(raw).problem).toEqual(expect.any(String));
    });
});

describe('normaliseQuestionnaires', () => {
    it('keeps a valid questionnaire, trimming text and sorting correct options', () => {
        const raw = [quiz({ title: '  Diagnoosi  ', questions: [
            { id: 'q1', type: 'multiple', text: ' Pick ', options: [' A ', 'B', 'C'], correct: [2, 0] },
        ] })];
        const { questionnaires, problem } = normaliseQuestionnaires(raw);
        expect(problem).toBeUndefined();
        expect(questionnaires[0].title).toBe('Diagnoosi');
        expect(questionnaires[0].questions[0]).toEqual({
            id: 'q1', type: 'multiple', text: 'Pick', options: ['A', 'B', 'C'], correct: [0, 2], required: true,
        });
    });

    it('stores nothing for an empty list', () => {
        expect(normaliseQuestionnaires([])).toEqual({ questionnaires: null });
    });

    it.each([
        ['an unknown timing', [quiz({ timing: 'sometime' })]],
        ['a duplicate questionnaire id', [quiz(), quiz()]],
        ['a duplicate question id', [quiz({ questions: [quiz().questions[0], quiz().questions[0]] })]],
        ['a single-choice question with two correct options', [quiz({ questions: [{ id: 'q', type: 'single', text: 't', options: ['a', 'b'], correct: [0, 1] }] })]],
        ['a correct option that does not exist', [quiz({ questions: [{ id: 'q', type: 'single', text: 't', options: ['a', 'b'], correct: [2] }] })]],
        ['a choice question with one option', [quiz({ questions: [{ id: 'q', type: 'single', text: 't', options: ['a'] }] })]],
        ['a text question with options', [quiz({ questions: [{ id: 'q', type: 'text', text: 't', options: ['a', 'b'] }] })]],
        ['no questions', [quiz({ questions: [] })]],
        ['an id with spaces', [quiz({ id: 'my quiz' })]],
    ])('refuses %s', (_label, raw) => {
        expect(normaliseQuestionnaires(raw).problem).toEqual(expect.any(String));
    });
});

describe('learnerQuestionnaire', () => {
    it('drops the answer key and keeps everything a learner needs to answer', () => {
        const stripped = learnerQuestionnaire(quiz());
        const text = JSON.stringify(stripped);
        expect(text).not.toContain('correct');
        expect(text).not.toContain('CDX2.');
        expect(stripped.questions.map((q) => q.options ?? null)).toEqual([['Colon', 'Lung', 'Liver'], ['A', 'B', 'C', 'D'], null]);
    });
});

describe('openAttempt', () => {
    it.each([
        // timing,    unlocked, submitted,        open
        ['during',   false,    [],               'single'],
        ['during',   true,     ['single'],       null],
        ['after',    false,    [],               null],
        ['after',    true,     [],               'single'],
        ['pre_post', false,    [],               'pre'],
        ['pre_post', false,    ['pre'],          null],
        ['pre_post', true,     [],               'post'],
        ['pre_post', true,     ['pre'],          'post'],
        ['pre_post', true,     ['pre', 'post'],  null],
    ])('%s, unlocked=%s, submitted=%j → %s', (timing, unlocked, submitted, open) => {
        expect(openAttempt(quiz({ timing }), unlocked, submitted)).toBe(open);
    });

    it('never opens a pre-test once the materials are open', () => {
        for (const submitted of [[], ['post'], ['pre'], ['pre', 'post']]) {
            expect(openAttempt(quiz({ timing: 'pre_post' }), true, submitted)).not.toBe('pre');
        }
    });
});

describe('releasesFeedback', () => {
    it('holds back a pre-test, and anything ungraded', () => {
        expect(releasesFeedback(quiz(), 'pre')).toBe(false);
        expect(releasesFeedback(quiz(), 'post')).toBe(true);
        expect(releasesFeedback(quiz({ graded: false }), 'single')).toBe(false);
    });
});

describe('checkAnswers', () => {
    it('accepts answers of the right shape and sorts multiple choices', () => {
        expect(checkAnswers(quiz(), { q1: 0, q2: [3, 1], q3: ' koska ' })).toEqual({ answers: { q1: 0, q2: [1, 3], q3: 'koska' } });
    });

    it('lets an optional question go unanswered', () => {
        expect(checkAnswers(quiz(), { q1: 1, q2: [0] }).problem).toBeUndefined();
    });

    it.each([
        ['a missing required answer', { q2: [0] }],
        ['an option out of range', { q1: 3, q2: [0] }],
        ['a list for a single choice', { q1: [0], q2: [0] }],
        ['a repeated option', { q1: 0, q2: [1, 1] }],
        ['a question that does not exist', { q1: 0, q2: [0], q9: 'x' }],
        ['a number for a text question', { q1: 0, q2: [0], q3: 4 }],
        ['no object at all', 'q1=0'],
    ])('refuses %s', (_label, answers) => {
        expect(checkAnswers(quiz(), answers).problem).toEqual(expect.any(String));
    });
});

describe('scoreAnswers', () => {
    it('scores a choice question one point, and a multiple choice only on the exact set', () => {
        expect(scoreAnswers(quiz(), { q1: 0, q2: [1, 3] })).toEqual({ score: 2, maxScore: 2, results: { q1: true, q2: true } });
        expect(scoreAnswers(quiz(), { q1: 0, q2: [1] })).toEqual({ score: 1, maxScore: 2, results: { q1: true, q2: false } });
        expect(scoreAnswers(quiz(), { q1: 2, q2: [0, 1, 3] })).toEqual({ score: 0, maxScore: 2, results: { q1: false, q2: false } });
    });

    it('does not score an ungraded questionnaire, or one with no answer key', () => {
        expect(scoreAnswers(quiz({ graded: false }), { q1: 0 })).toBeNull();
        expect(scoreAnswers(quiz({ questions: [{ id: 't', type: 'text', text: 'Why?' }] }), { t: 'x' })).toBeNull();
    });

    it('gives the same score whatever order the multiple choices were checked in', () => {
        const orders = [[1, 3], [3, 1]];
        const scores = orders.map((q2) => scoreAnswers(quiz(), checkAnswers(quiz(), { q1: 0, q2 }).answers).score);
        expect(new Set(scores)).toEqual(new Set([2]));
    });

    it('never scores above the maximum', () => {
        const options = [0, 1, 2, 3];
        const subsets = options.flatMap((_, i) => options.slice(i).map((__, j) => options.slice(i, i + j + 1)));
        for (const q2 of subsets) {
            for (const q1 of [0, 1, 2]) {
                const { score, maxScore } = scoreAnswers(quiz(), { q1, q2 });
                expect(score).toBeLessThanOrEqual(maxScore);
                expect(score).toBeGreaterThanOrEqual(0);
            }
        }
    });
});
