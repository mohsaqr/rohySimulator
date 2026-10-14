// The Course view with lessons locked behind the case: a locked lesson is
// listed by the case panel and never requested on its own, and only open
// lessons reach the vendored lessons room.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const getLectures = vi.fn();
const getLectureById = vi.fn();
vi.mock('./api/courses', () => ({
    coursesApi: {
        getLectures: (...a) => getLectures(...a),
        getLectureById: (...a) => getLectureById(...a),
        markLectureComplete: vi.fn(),
    },
}));
vi.mock('./api/surveys', () => ({ surveysApi: { getModuleSurveys: async () => [] } }));
const apiFetch = vi.fn(async () => ({ data: [] }));
vi.mock('../../services/apiClient', () => ({
    apiFetch: (...a) => apiFetch(...a),
    apiGet: async () => ({ gate: { configured: false, unlocked: true }, questionnaires: [] }),
    apiPost: vi.fn(),
}));
const roomLessons = vi.fn();
vi.mock('./LessonsRoom', () => ({
    LessonsRoom: ({ lessons }) => { roomLessons(lessons); return <div data-testid="lessons-room">{lessons.map((l) => l.title).join(',')}</div>; },
}));

import LessonsRoomContainer from './LessonsRoomContainer';

afterEach(() => {
    cleanup();
    getLectures.mockReset();
    getLectureById.mockReset();
    roomLessons.mockReset();
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => ({ data: [] }));
});

describe('LessonsRoomContainer with locked lessons', () => {
    it('never requests a locked lesson, and hands only open lessons to the room', async () => {
        // Regression lock: the container "hydrated" every lesson without sections, so each locked lesson cost a refused request (403) on every visit
        getLectures.mockResolvedValue([
            { id: 1, title: 'Open', sections: [] },
            { id: 2, title: 'Locked', locked: true, lock: { slidesOpened: 0, slidesTotal: 4 } },
        ]);
        render(<LessonsRoomContainer cohortId={3} cohortName="Patologia" caseId={10} />);
        await waitFor(() => expect(screen.getByTestId('lessons-room')).toHaveTextContent('Open'));
        expect(screen.getByTestId('lessons-room')).not.toHaveTextContent('Locked');
        expect(getLectureById).not.toHaveBeenCalled();
    });
});

describe('LessonsRoomContainer for a case with no course for the viewer', () => {
    // Regression lock: a student not enrolled in the case's course was told "This case is not linked to a course yet", which was false and sent people hunting for a missing link
    it('tells a student who is not enrolled that they are not enrolled', async () => {
        apiFetch.mockImplementation(async (path) => (String(path).startsWith('/courses/for-case/')
            ? { data: { cohortId: null, reason: 'not_enrolled' } }
            : { data: [] }));
        render(<LessonsRoomContainer cohortId={null} cohortName={null} caseId={17} />);
        expect(await screen.findByText("You are not enrolled in this case's course")).toBeTruthy();
        expect(screen.queryByText('This case is not linked to a course yet.')).toBeNull();
        expect(apiFetch).toHaveBeenCalledWith('/courses/for-case/17');
    });

    it('still says "not linked" when the case really has no course', async () => {
        apiFetch.mockImplementation(async (path) => (String(path).startsWith('/courses/for-case/')
            ? { data: { cohortId: null, reason: 'no_course' } }
            : { data: [] }));
        render(<LessonsRoomContainer cohortId={null} cohortName={null} caseId={18} />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/courses/for-case/18'));
        expect(screen.getByText('This case is not linked to a course yet.')).toBeTruthy();
        expect(screen.queryByText("You are not enrolled in this case's course")).toBeNull();
    });
});

describe('LessonsRoomContainer when a request fails', () => {
    // Regression lock: every load caught to [] (and the case → course lookup to null), so a failed request looked like an empty course or "not linked to a course" (FI-0010 F18)
    it('says the course could not be loaded, with Retry, instead of showing an empty course', async () => {
        getLectures.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
        render(<LessonsRoomContainer cohortId={3} cohortName="Patologia" caseId={null} />);
        const alert = await screen.findByTestId('course-load-error');
        expect(alert).toHaveTextContent('The course could not be loaded. Try again.');
        expect(screen.queryByTestId('lessons-room')).toBeNull();
        expect(screen.queryByText(/No course content/)).toBeNull();

        getLectures.mockResolvedValueOnce([{ id: 1, title: 'Back again', sections: [] }]);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByTestId('lessons-room')).toHaveTextContent('Back again'));
        expect(screen.queryByTestId('course-load-error')).toBeNull();
    });

    it('tells an offline failure apart from a refusal', async () => {
        getLectures.mockRejectedValueOnce(Object.assign(new Error('Network error'), { status: 0, code: 'NETWORK' }));
        render(<LessonsRoomContainer cohortId={3} cohortName="Patologia" />);
        expect(await screen.findByTestId('course-load-error')).toHaveTextContent(/server could not be reached/);
        cleanup();
        getLectures.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
        render(<LessonsRoomContainer cohortId={3} cohortName="Patologia" />);
        expect(await screen.findByTestId('course-load-error')).toHaveTextContent(/not available to you/);
    });

    it('fails the whole load when the progress request fails, rather than showing nothing completed', async () => {
        getLectures.mockResolvedValue([{ id: 1, title: 'Open', sections: [] }]);
        apiFetch.mockImplementation(async (path) => {
            if (String(path).endsWith('/progress')) throw Object.assign(new Error('x'), { status: 502 });
            return { data: [] };
        });
        render(<LessonsRoomContainer cohortId={3} cohortName="Patologia" />);
        expect(await screen.findByTestId('course-load-error')).toBeInTheDocument();
        expect(screen.queryByTestId('lessons-room')).toBeNull();
    });

    it('does not call a failed case → course lookup "not linked"; it retries and finds the course', async () => {
        let lookups = 0;
        apiFetch.mockImplementation(async (path) => {
            if (String(path).startsWith('/courses/for-case/')) {
                lookups += 1;
                if (lookups === 1) throw Object.assign(new Error('Network error'), { status: 0 });
                return { data: { cohortId: 3, cohortName: 'Patologia' } };
            }
            return { data: [] };
        });
        getLectures.mockResolvedValue([{ id: 1, title: 'Found it', sections: [] }]);
        render(<LessonsRoomContainer cohortId={null} cohortName={null} caseId={21} />);
        expect(await screen.findByTestId('course-load-error')).toBeInTheDocument();
        expect(screen.queryByText('This case is not linked to a course yet.')).toBeNull();
        expect(screen.queryByText('No course content here')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByTestId('lessons-room')).toHaveTextContent('Found it'));
        expect(getLectures).toHaveBeenCalledWith(3, { includeSections: true });
    });
});
