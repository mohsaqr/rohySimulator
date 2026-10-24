// Regression lock: a learner's MCQ copy carries no answer keys, so the student view must grade through the server, not against a key in the page
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ checkMcqAnswer: vi.fn(), log: vi.fn() }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_k, o) => o?.defaultValue ?? _k }),
}));
vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children }) => <div>{children}</div> }));
vi.mock('../../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
vi.mock('../../../api/courses', () => ({ coursesApi: { checkMcqAnswer: (...a) => mocks.checkMcqAnswer(...a) } }));
vi.mock('../../../services/activityLogger', () => ({ activityLogger: { log: (...a) => mocks.log(...a) } }));

const { McqNodeView } = await import('./McqNodeView.jsx');
const { LessonMediaContext } = await import('./LessonMediaContext.js');
const { normalizeQuestion, mcqBlockIndexOf } = await import('./mcqShared.js');

const renderStudent = (questions) => render(
    <LessonMediaContext.Provider value={{ lectureId: 11, sectionId: 22 }}>
        <McqNodeView node={{ attrs: { questions } }} editor={{ isEditable: false }} getPos={() => 0} />
    </LessonMediaContext.Provider>,
);

describe('MCQ student view', () => {
    beforeEach(() => { mocks.checkMcqAnswer.mockReset(); mocks.log.mockReset(); });

    it('keeps a missing answer key as null instead of inventing answer 0', () => {
        expect(normalizeQuestion({ question: 'q', options: ['a', 'b'] }).correctIndex).toBeNull();
        expect(normalizeQuestion({ question: 'q', options: ['a', 'b'], correctIndex: 1 }).correctIndex).toBe(1);
        expect(normalizeQuestion({ question: 'q', options: ['a', 'b'], correctIndex: 9 }).correctIndex).toBe(0);
    });

    it('addresses a block by its order among the document\'s MCQ blocks', () => {
        const nodes = [[0, 'paragraph'], [5, 'lectureMcq'], [9, 'paragraph'], [14, 'lectureMcq']];
        const editor = { state: { doc: { descendants: (fn) => nodes.forEach(([p, name]) => fn({ type: { name } }, p)) } } };
        expect(mcqBlockIndexOf(editor, () => 5)).toBe(0);
        expect(mcqBlockIndexOf(editor, () => 14)).toBe(1);
        expect(mcqBlockIndexOf(null, () => 14)).toBe(0);
    });

    it('grades a key-less question through the check route and shows the verdict', async () => {
        mocks.checkMcqAnswer.mockResolvedValue({ correct: false, correctIndex: 1, explanation: 'Because B.' });
        renderStudent([{ question: 'Pick one', options: ['Alpha', 'Beta'] }]);
        fireEvent.click(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Check answer'));
        await waitFor(() => expect(screen.getByText('Because B.')).toBeTruthy());
        expect(mocks.checkMcqAnswer).toHaveBeenCalledWith(11, { sectionId: 22, blockIndex: 0, questionIndex: 0, answerIndex: 0 });
        expect(screen.getByText('Not quite.')).toBeTruthy();
        expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ result: 'incorrect', correctIndex: 1 }));
    });

    it('says so when the check fails, and lets the learner retry', async () => {
        mocks.checkMcqAnswer.mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ correct: true, correctIndex: 0, explanation: '' });
        renderStudent([{ question: 'Pick one', options: ['Alpha', 'Beta'] }]);
        fireEvent.click(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Check answer'));
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        fireEvent.click(screen.getByText('Check answer'));
        await waitFor(() => expect(screen.getByText('Correct!')).toBeTruthy());
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('grades locally when the key is in the document (staff preview)', async () => {
        renderStudent([{ question: 'Pick one', options: ['Alpha', 'Beta'], correctIndex: 1, explanation: 'Local.' }]);
        fireEvent.click(screen.getByText('Beta'));
        fireEvent.click(screen.getByText('Check answer'));
        await waitFor(() => expect(screen.getByText('Correct!')).toBeTruthy());
        expect(mocks.checkMcqAnswer).not.toHaveBeenCalled();
    });
});
