// The Course view with lessons locked behind the case: a locked lesson is
// listed by the case panel and never requested on its own, and only open
// lessons reach the vendored lessons room.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

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
vi.mock('../../services/apiClient', () => ({
    apiFetch: async () => ({ data: [] }),
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
