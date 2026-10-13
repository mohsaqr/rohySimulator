// The course page as staff see it: an item students cannot see is marked.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LessonsRoom } from './LessonsRoom';

afterEach(cleanup);

const survey = (id, title, isPublished) => ({ id, survey: { id, title, isPublished, _count: { questions: 10 } } });
const lesson = (id, title, isPublished) => ({ id, title, isPublished, sections: [] });

describe('LessonsRoom — publication state', () => {
    // Regression lock: an unpublished survey looked the same as a published one to the teacher, so "students cannot see the survey" had no visible cause
    it('marks an unpublished survey and lesson, in cards and in the list view', async () => {
        render(
            <LessonsRoom
                lessons={[lesson(1, 'Open lesson', true), lesson(2, 'Draft lesson', false)]}
                surveys={[survey(3, 'VP perception', false), survey(4, 'Published survey', true)]}
                classroomId={9}
                completedIds={new Set()}
                onMarkComplete={() => {}}
            />,
        );
        const check = () => {
            const draftSurvey = screen.getByText('VP perception').closest('[role="button"]');
            const liveSurvey = screen.getByText('Published survey').closest('[role="button"]');
            const draftLesson = screen.getByText('Draft lesson').closest('[role="button"]');
            const liveLesson = screen.getByText('Open lesson').closest('[role="button"]');
            expect(within(draftSurvey).getByText(/Not published/)).toBeTruthy();
            expect(within(draftLesson).getByText(/Not published/)).toBeTruthy();
            expect(within(liveSurvey).queryByText(/Not published/)).toBeNull();
            expect(within(liveLesson).queryByText(/Not published/)).toBeNull();
        };
        check();
        await userEvent.click(screen.getByRole('button', { name: /list/i }));
        check();
    });

    it('marks nothing when publication state is unknown (students only ever receive published items)', () => {
        render(
            <LessonsRoom
                lessons={[{ id: 1, title: 'Lesson', sections: [] }]}
                surveys={[{ id: 2, survey: { id: 2, title: 'Survey', _count: { questions: 1 } } }]}
                classroomId={9}
                completedIds={new Set()}
                onMarkComplete={() => {}}
            />,
        );
        expect(screen.queryByText(/Not published/)).toBeNull();
    });
});
