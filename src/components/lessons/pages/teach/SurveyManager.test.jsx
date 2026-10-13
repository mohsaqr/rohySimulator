// Survey builder shortcuts: an educator building a 10-question perception
// survey had to type every option of every question by hand. The question
// list now has Duplicate, and the question editor fills options from a preset
// scale, from a multi-line paste, or from the previous choice question.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
    getSurveys: vi.fn(),
    getSurveyById: vi.fn(),
    duplicateQuestion: vi.fn(),
    addQuestion: vi.fn(),
}));
vi.mock('../../api/surveys', () => ({ surveysApi: api }));
vi.mock('../../services/activityLogger', () => ({
    default: { logSurveyManagerViewed: vi.fn(), logSurveyCreated: vi.fn() },
}));

import { SurveyManager } from './SurveyManager';
import {
    splitPastedLines,
    insertPastedOptions,
    previousChoiceOptions,
} from './surveyOptionTools';

const likert = {
    id: 70, surveyId: 7, questionText: 'The case felt realistic', questionType: 'single_choice',
    options: ['Low', 'High'], isRequired: true, orderIndex: 0,
};
const openText = {
    id: 71, surveyId: 7, questionText: 'What would you change?', questionType: 'free_text',
    options: [], isRequired: false, orderIndex: 1,
};
const survey = (questions) => ({
    id: 7, title: 'Perception', isPublished: false, isAnonymous: false,
    _count: { questions: questions.length, responses: 0 }, questions,
});

async function openSurvey(questions = [likert, openText]) {
    api.getSurveys.mockResolvedValue([survey(questions)]);
    render(<SurveyManager classroomId={3} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Perception' }));
    await screen.findByText('Q1');
}

async function openAddQuestion() {
    const buttons = screen.getAllByRole('button', { name: 'Add question' });
    fireEvent.click(buttons.at(-1));
    return screen.findByRole('dialog');
}

const optionValues = (dialog) =>
    within(dialog).getAllByRole('textbox', { name: /^Option \d+$/ }).map((el) => el.value);

beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
});

describe('SurveyManager — duplicate question', () => {
    it('the Duplicate button calls the API and shows the refreshed survey', async () => {
        await openSurvey();
        const copy = { ...likert, id: 72, orderIndex: 1 };
        api.duplicateQuestion.mockResolvedValue(copy);
        api.getSurveyById.mockResolvedValue(survey([likert, copy, { ...openText, orderIndex: 2 }]));

        fireEvent.click(screen.getByRole('button', { name: 'Duplicate question 1' }));

        await waitFor(() => expect(api.duplicateQuestion).toHaveBeenCalledWith(7, 70));
        expect(api.getSurveyById).toHaveBeenCalledWith(7);
        await waitFor(() => expect(screen.getAllByText('The case felt realistic')).toHaveLength(2));
        expect(screen.getByRole('button', { name: 'Duplicate question 3' })).toBeInTheDocument();
    });
});

describe('SurveyManager — filling options', () => {
    it('a preset fills empty options in one click', async () => {
        await openSurvey();
        const dialog = await openAddQuestion();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Agreement (5)' }));
        expect(optionValues(dialog)).toEqual([
            'Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree',
        ]);
        expect(within(dialog).queryByRole('alert')).toBeNull();
    });

    it('a preset asks before replacing options the educator typed', async () => {
        await openSurvey();
        const dialog = await openAddQuestion();
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Option 1' }), {
            target: { value: 'Mine' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Yes / No' }));
        expect(optionValues(dialog)).toEqual(['Mine']);

        const alert = within(dialog).getByRole('alert');
        fireEvent.click(within(alert).getByRole('button', { name: 'Keep mine' }));
        expect(optionValues(dialog)).toEqual(['Mine']);

        fireEvent.click(within(dialog).getByRole('button', { name: 'Yes / No' }));
        fireEvent.click(within(within(dialog).getByRole('alert')).getByRole('button', { name: 'Replace' }));
        expect(optionValues(dialog)).toEqual(['Yes', 'No']);
    });

    it('pasting several lines into an option box makes one option per line', async () => {
        await openSurvey();
        const dialog = await openAddQuestion();
        fireEvent.paste(within(dialog).getByRole('textbox', { name: 'Option 1' }), {
            clipboardData: { getData: () => '  Never\r\nSometimes\n\n Always  \n' },
        });
        expect(optionValues(dialog)).toEqual(['Never', 'Sometimes', 'Always']);
    });

    it('"Same options as previous question" copies the last choice question', async () => {
        await openSurvey();
        const dialog = await openAddQuestion();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Same options as previous question' }));
        expect(optionValues(dialog)).toEqual(['Low', 'High']);
    });

    it('offers no "same as previous" when there is no earlier choice question', async () => {
        await openSurvey([openText]);
        const dialog = await openAddQuestion();
        expect(within(dialog).queryByRole('button', { name: 'Same options as previous question' })).toBeNull();
    });
});

describe('surveyOptionTools', () => {
    it('splitPastedLines trims and drops blank lines', () => {
        expect(splitPastedLines('a\r\n\n  b \rc')).toEqual(['a', 'b', 'c']);
        expect(splitPastedLines('')).toEqual([]);
    });

    it('insertPastedOptions replaces an empty field and keeps a typed one', () => {
        expect(insertPastedOptions(['x', '', 'z'], 1, ['p', 'q'])).toEqual(['x', 'p', 'q', 'z']);
        expect(insertPastedOptions(['x', 'y'], 0, ['p'])).toEqual(['x', 'p', 'y']);
    });

    it('previousChoiceOptions looks only before the question being edited', () => {
        const qs = [
            { id: 1, questionType: 'single_choice', options: ['a', 'b'] },
            { id: 2, questionType: 'free_text', options: [] },
            { id: 3, questionType: 'multiple_choice', options: ['c', 'd'] },
        ];
        expect(previousChoiceOptions(qs)).toEqual(['c', 'd']);
        expect(previousChoiceOptions(qs, 3)).toEqual(['a', 'b']);
        expect(previousChoiceOptions(qs, 1)).toBeNull();
        expect(previousChoiceOptions(undefined)).toBeNull();
    });
});
