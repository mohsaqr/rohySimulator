// The learner's course panel: it shows the gate the server reported, sends
// the attempt the server opened, and shows the answer key only when the
// server sent one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiGet: (...a) => apiGet(...a),
    apiPost: (...a) => apiPost(...a),
}));
const log = vi.fn();
vi.mock('../../services/eventLogger', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, default: { ...real.default, log: (...a) => log(...a) } };
});

import CaseCoursePanel from './CaseCoursePanel';

const lockedGate = {
    configured: true, unlocked: false, afterMinutes: 15, allSlidesOpened: true,
    startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    unlockAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    remainingSeconds: 600,
    slides: [{ id: 's1', label: 'A1 — HE', opened: true }, { id: 's2', label: 'B1 — HE', opened: false }],
};
const preTest = {
    id: 'prepost', title: 'Diagnoosi', timing: 'pre_post', graded: true,
    questions: [
        { id: 'origin', type: 'single', text: 'Origin?', options: ['Colon', 'Lung'], required: true },
        { id: 'found', type: 'multiple', text: 'Found?', options: ['Glands', 'Pigment', 'Fat'], required: true },
        { id: 'why', type: 'text', text: 'Why?', required: false },
    ],
};

afterEach(() => {
    cleanup();
    sessionStorage.clear();
    apiGet.mockReset();
    apiPost.mockReset();
    log.mockReset();
});

describe('CaseCoursePanel', () => {
    it('shows a locked gate with the time left, the slides and how many lessons wait', async () => {
        apiGet.mockResolvedValue({ gate: lockedGate, questionnaires: [] });
        render(<CaseCoursePanel caseId={10} lockedLessons={[{ id: 1, locked: true }, { id: 2, locked: true }]} />);
        expect(await screen.findByText('Course materials are locked')).toBeInTheDocument();
        expect(screen.getByTestId('course-gate-time').textContent).toMatch(/Time left: (9:5\d|10:00)/);
        expect(screen.getByText('Slides opened: 1/2')).toBeInTheDocument();
        expect(screen.getByTestId('gate-waiting-count').textContent).toMatch(/2 lessons open when the conditions above are met/);
        expect(apiGet).toHaveBeenCalledWith('/cases/10/course-state');
    });

    it('shows a questionnaire that is not open yet under a plain heading, with no form', async () => {
        // Regression lock: a closed questionnaire arrives without its title or questions; the card must not need them
        apiGet.mockResolvedValue({ gate: lockedGate, questionnaires: [
            { id: 'after', timing: 'after', graded: true, closed: true, openAttempt: null, attempts: [] },
        ] });
        render(<CaseCoursePanel caseId={10} />);
        const card = await screen.findByTestId('questionnaire-after');
        expect(card.textContent).toContain('Questionnaire');
        expect(card.textContent).toContain('Opens together with the course materials.');
        expect(screen.queryByTestId('questionnaire-form-after')).toBeNull();
    });

    it('renders nothing for a case with no gate and no questionnaires', async () => {
        apiGet.mockResolvedValue({ gate: { configured: false, unlocked: true }, questionnaires: [] });
        const { container } = render(<CaseCoursePanel caseId={10} />);
        await waitFor(() => expect(apiGet).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="case-course-panel"]')).toBeNull();
    });

    it('renders nothing, not an error, when the server refuses (a guest)', async () => {
        apiGet.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
        const { container } = render(<CaseCoursePanel caseId={10} />);
        await waitFor(() => expect(apiGet).toHaveBeenCalled());
        expect(container.textContent).toBe('');
    });

    it('says so when the course state fails to load', async () => {
        apiGet.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }));
        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByText(/could not be loaded|failed/i)).toBeInTheDocument();
    });

    it('refuses to send while a required question is unanswered', async () => {
        apiGet.mockResolvedValue({ gate: lockedGate, questionnaires: [{ ...preTest, openAttempt: 'pre', attempts: [] }] });
        render(<CaseCoursePanel caseId={10} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Send answers' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Answer every question');
        expect(apiPost).not.toHaveBeenCalled();
    });

    it('sends the open attempt with the answers by question id, then reloads', async () => {
        apiGet.mockResolvedValue({ gate: lockedGate, questionnaires: [{ ...preTest, openAttempt: 'pre', attempts: [] }] });
        apiPost.mockResolvedValue({ attempt: 'pre' });
        render(<CaseCoursePanel caseId={10} sessionId={77} />);
        fireEvent.click(await screen.findByLabelText('Colon'));
        fireEvent.click(screen.getByLabelText('Fat'));
        fireEvent.click(screen.getByLabelText('Glands'));
        fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
        expect(apiPost).toHaveBeenCalledWith('/cases/10/questionnaires/prepost/responses', {
            attempt: 'pre', answers: { origin: 0, found: [0, 2] }, sessionId: 77,
        });
        await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
        expect(log).toHaveBeenCalledWith('SUBMITTED', 'questionnaire', expect.objectContaining({ objectId: 'prepost', result: 'pre' }));
    });

    it('shows the post-test result with the gain and the released key', async () => {
        apiGet.mockResolvedValue({
            gate: { ...lockedGate, unlocked: true },
            questionnaires: [{
                ...preTest,
                openAttempt: null,
                attempts: [
                    { attempt: 'pre', submittedAt: '2026-10-10T10:00:00.000Z', answers: { origin: 1, found: [0] }, score: 0, maxScore: 2 },
                    {
                        attempt: 'post', submittedAt: '2026-10-10T10:30:00.000Z', answers: { origin: 0, found: [0] },
                        score: 1, maxScore: 2, results: { origin: true, found: false },
                        key: { found: { correct: [0, 1], feedback: 'Pigment is anthracosis.' } },
                    },
                ],
            }],
        });
        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByText('Pre-test 0/2 → post-test 1/2')).toBeInTheDocument();
        expect(screen.getByText('Correct answer: Glands, Pigment')).toBeInTheDocument();
        expect(screen.getByText('Pigment is anthracosis.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
    });

    it('shows no key for a pre-test the server sent without one', async () => {
        apiGet.mockResolvedValue({
            gate: lockedGate,
            questionnaires: [{
                ...preTest, openAttempt: null,
                attempts: [{ attempt: 'pre', submittedAt: '2026-10-10T10:00:00.000Z', answers: { origin: 1, found: [0] } }],
            }],
        });
        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByText('You will see this score after the post-test.')).toBeInTheDocument();
        expect(screen.queryByText(/Correct answer/)).toBeNull();
    });
});

describe('CaseCoursePanel — refused sends, late pre-tests and drafts (FI-0010 review)', () => {
    const openPre = (extra = {}) => ({ gate: lockedGate, questionnaires: [{ ...preTest, openAttempt: 'pre', attempts: [], ...extra }] });
    const answerAll = async () => {
        fireEvent.click(await screen.findByLabelText('Colon'));
        fireEvent.click(screen.getByLabelText('Glands'));
    };
    const refusal = (code, error) => Object.assign(new Error(error), { status: 409, code, body: { error, code } });

    it('says "already sent" in the interface language, not the server text', async () => {
        // Regression lock: a 409 showed the server's raw English ("You have already answered this") in a Finnish course
        apiGet.mockResolvedValue(openPre());
        apiPost.mockRejectedValue(refusal('already_submitted', 'You have already answered this'));
        render(<CaseCoursePanel caseId={10} />);
        await answerAll();
        fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('You have already sent your answers to this questionnaire.');
        expect(alert).not.toHaveTextContent('You have already answered this');
    });

    it('says the test can no longer be sent, and to refresh, when the attempt closed', async () => {
        apiGet.mockResolvedValue(openPre());
        apiPost.mockRejectedValue(refusal('attempt_closed', 'This questionnaire is not open for that attempt now'));
        render(<CaseCoursePanel caseId={10} />);
        await answerAll();
        fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This test can no longer be sent. Refresh the course view.');
        expect(alert).not.toHaveTextContent('not open for that attempt');
    });

    it('falls back to the generic message for anything else', async () => {
        apiGet.mockResolvedValue(openPre());
        apiPost.mockRejectedValue(Object.assign(new Error('Internal'), { status: 500, code: 'HTTP_500', body: { error: 'Failed to save the answers' } }));
        render(<CaseCoursePanel caseId={10} />);
        await answerAll();
        fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Your answers could not be sent. Try again.');
    });

    it('tells a learner whose materials are already open that the pre-test comes first and counts as late', async () => {
        apiGet.mockResolvedValue({ gate: { ...lockedGate, unlocked: true }, questionnaires: [{ ...preTest, openAttempt: 'pre', openAttemptLate: true, attempts: [] }] });
        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByTestId('questionnaire-late-prepost')).toHaveTextContent('answered after the materials opened');
        expect(screen.getByText('Pre-test')).toBeInTheDocument();
    });

    it('marks a late pre-test among the sent attempts', async () => {
        apiGet.mockResolvedValue({
            gate: { ...lockedGate, unlocked: true },
            questionnaires: [{ ...preTest, openAttempt: 'post', attempts: [{ attempt: 'pre', late: true, submittedAt: '2026-10-10T10:00:00.000Z', answers: { origin: 0, found: [0] } }] }],
        });
        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByTestId('attempt-prepost-pre-late')).toHaveTextContent('Answered after the course materials opened');
    });

    it('keeps unsent answers when the panel is opened again', async () => {
        // Regression lock: an in-progress pre-test lived only in component state and was lost on any remount
        apiGet.mockResolvedValue(openPre());
        const first = render(<CaseCoursePanel caseId={10} />);
        fireEvent.click(await screen.findByLabelText('Lung'));
        fireEvent.change(screen.getByLabelText('Why?'), { target: { value: 'pigment' } });
        first.unmount();

        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByLabelText('Lung')).toBeChecked();
        expect(screen.getByLabelText('Why?')).toHaveValue('pigment');
    });

    it('forgets the draft once the answers are sent', async () => {
        apiGet.mockResolvedValue(openPre());
        apiPost.mockResolvedValue({ attempt: 'pre' });
        const first = render(<CaseCoursePanel caseId={10} />);
        await answerAll();
        fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
        await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
        first.unmount();
        render(<CaseCoursePanel caseId={10} />);
        expect(await screen.findByLabelText('Colon')).not.toBeChecked();
    });
});
