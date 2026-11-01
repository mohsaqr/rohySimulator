// The survey a learner opens from the course room.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getSurveyById: vi.fn(),
  checkIfCompleted: vi.fn(),
  submitResponse: vi.fn(),
}));
vi.mock('../../api/surveys', () => ({ surveysApi: api }));

import { SurveyEmbed } from './SurveyEmbed';

const survey = (isAnonymous) => ({
  id: 5,
  title: 'Course feedback',
  isAnonymous,
  isPublished: true,
  questions: [{ id: 1, questionText: 'How was it?', questionType: 'free_text', options: [], isRequired: true }],
});

afterEach(cleanup);
beforeEach(() => { Object.values(api).forEach((fn) => fn.mockReset()); });

describe('SurveyEmbed — already answered', () => {
  // Regression lock: an anonymous survey skipped the "already answered" check, so a learner who had answered it was offered the form again and could only be refused (409)
  it('shows an anonymous survey the learner answered as completed', async () => {
    api.getSurveyById.mockResolvedValue(survey(true));
    api.checkIfCompleted.mockResolvedValue({ completed: true });
    render(<SurveyEmbed surveyId={5} context="module" moduleId={7} courseId={7} />);
    expect(await screen.findByText('Survey completed')).toBeTruthy();
    expect(api.checkIfCompleted).toHaveBeenCalledWith(5, 7);
    expect(screen.queryByText(/How was it\?/)).toBeNull();
  });

  it('offers the form while it is not answered', async () => {
    api.getSurveyById.mockResolvedValue(survey(false));
    api.checkIfCompleted.mockResolvedValue({ completed: false });
    render(<SurveyEmbed surveyId={5} context="module" moduleId={7} courseId={7} />);
    expect(await screen.findByText(/How was it\?/)).toBeTruthy();
    expect(screen.queryByText('Survey completed')).toBeNull();
  });
});
