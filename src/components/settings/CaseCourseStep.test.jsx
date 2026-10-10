// The case wizard's Course step: the gate and the questionnaires are written
// into config in the stored shape, a gate at its defaults is no setting, the
// locked lessons save through their own endpoint, and the answers export one
// row per answer.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiGet: (...a) => apiGet(...a),
    apiPut: (...a) => apiPut(...a),
}));

import { CaseCourseStep } from './CaseCourseStep';
import { responsesToCsv } from './questionnaireCsv.js';
import { normaliseQuestionnaires } from '../../../server/shared/caseCourse.js';

let latest = null;
function Harness({ id = null, initialConfig }) {
    const [caseData, setCaseData] = useState({ id, config: initialConfig });
    useEffect(() => { latest = caseData; }, [caseData]);
    return <CaseCourseStep caseData={caseData} setCaseData={setCaseData} />;
}

afterEach(() => {
    cleanup();
    latest = null;
    apiGet.mockReset();
    apiPut.mockReset();
});

describe('CaseCourseStep', () => {
    it('writes the gate, and removes it again at its defaults', () => {
        render(<Harness initialConfig={{ pathology: { manifest: { slides: [{ id: 'a' }, { id: 'b' }] } } }} />);
        expect(screen.getByText('The case has 2 slides.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Minutes after the learner starts the case'), { target: { value: '15' } });
        fireEvent.click(screen.getByLabelText(/Every pathology slide opened/));
        expect(latest.config.courseGate).toEqual({ afterMinutes: 15, allSlidesOpened: true });
        fireEvent.change(screen.getByLabelText('Minutes after the learner starts the case'), { target: { value: '0' } });
        fireEvent.click(screen.getByLabelText(/Every pathology slide opened/));
        expect(latest.config).not.toHaveProperty('courseGate');
    });

    it('builds a graded questionnaire the server will accept', () => {
        render(<Harness initialConfig={{}} />);
        fireEvent.click(screen.getByRole('button', { name: /Add questionnaire/ }));
        fireEvent.change(screen.getByLabelText('Questionnaire title'), { target: { value: 'Diagnoosi' } });
        fireEvent.click(screen.getByLabelText(/Graded/));
        fireEvent.click(screen.getByRole('button', { name: /Single choice/ }));
        fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Alkuperä?' } });
        fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Paksusuoli' } });
        fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Keuhko' } });
        fireEvent.click(screen.getAllByLabelText('Correct answer')[0]);

        const { questionnaires, problem } = normaliseQuestionnaires(latest.config.questionnaires);
        expect(problem).toBeUndefined();
        expect(questionnaires[0]).toMatchObject({
            title: 'Diagnoosi', timing: 'during', graded: true,
            questions: [{ type: 'single', text: 'Alkuperä?', options: ['Paksusuoli', 'Keuhko'], correct: [0] }],
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says why a half-written questionnaire cannot be saved yet', () => {
        render(<Harness initialConfig={{}} />);
        fireEvent.click(screen.getByRole('button', { name: /Add questionnaire/ }));
        expect(screen.getByRole('alert')).toHaveTextContent('This questionnaire cannot be saved yet');
    });

    it('keeps the correct answer on its option when an earlier option is removed', () => {
        render(<Harness initialConfig={{ questionnaires: [{
            id: 'q', title: 'T', timing: 'during', graded: true,
            questions: [{ id: 'k', type: 'multiple', text: 'X', options: ['a', 'b', 'c'], correct: [2], required: true }],
        }] }} />);
        fireEvent.click(screen.getAllByLabelText('Remove option')[0]);
        expect(latest.config.questionnaires[0].questions[0]).toMatchObject({ options: ['b', 'c'], correct: [1] });
    });

    it('saves the locked lessons through the course-locks endpoint', async () => {
        apiGet.mockResolvedValue({ data: { cohortId: 3, cohortName: 'Patologia', lessons: [
            { id: 11, title: 'Kasvaimet', isPublished: true, locked: false, lockedByCaseId: null },
            { id: 12, title: 'Johdanto', isPublished: true, locked: false, lockedByCaseId: null },
        ] } });
        apiPut.mockResolvedValue({ data: {} });
        render(<Harness id={10} initialConfig={{}} />);
        fireEvent.click(await screen.findByLabelText('Kasvaimet'));
        fireEvent.click(screen.getByRole('button', { name: 'Save locked lessons' }));
        await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/cases/10/course-locks', { lessonIds: [11] }));
    });

    it('asks to save the case before choosing locked lessons', () => {
        render(<Harness initialConfig={{}} />);
        expect(screen.getByText('Save the case first, then choose its locked lessons.')).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });
});

describe('responsesToCsv', () => {
    it('writes one row per answer, with option text and quoted cells', () => {
        const csv = responsesToCsv({ responses: [{
            username: 'anna', questionnaireId: 'q', attempt: 'post', submittedAt: '2026-10-10T10:00:00.000Z', score: 1, maxScore: 1,
            answers: { a: 0, b: 'koska "CDX2"' },
            questionnaire: { questions: [
                { id: 'a', type: 'single', text: 'Origin?', options: ['Colon', 'Lung'] },
                { id: 'b', type: 'text', text: 'Why?' },
            ] },
        }] }).split('\n');
        expect(csv).toHaveLength(3);
        expect(csv[0]).toBe('"username","questionnaire_id","attempt","submitted_at","score","max_score","question_id","question","answer"');
        expect(csv[1]).toBe('"anna","q","post","2026-10-10T10:00:00.000Z","1","1","a","Origin?","Colon"');
        expect(csv[2]).toBe('"anna","q","post","2026-10-10T10:00:00.000Z","1","1","b","Why?","koska ""CDX2"""');
    });
});
