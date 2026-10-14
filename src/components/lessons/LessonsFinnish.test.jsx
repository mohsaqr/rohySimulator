// The course, lesson and survey screens under a Finnish UI (FI-0010 review F08).
//
// The vendored lessons module resolves its strings through rohy's i18next with
// LAILA's namespaces (`teaching`, `common`, `authoring_lessons`) and inline
// English defaults. rohy shipped no such catalogues, so under Finnish the
// course room said "Course", "6 lessons", "cards", "Mark complete", and the
// survey screens were English throughout. These render the real components
// after the real language switch (setAppLanguage loads src/locales/fi AND the
// module's src/components/lessons/locales/fi.json), and assert Finnish text and
// the absence of the English it replaced.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
    getSurveys: vi.fn(),
    getSurveyById: vi.fn(),
    getResponses: vi.fn(),
    submitResponse: vi.fn(),
    checkIfCompleted: vi.fn(),
    exportResponses: vi.fn(),
}));
vi.mock('./api/surveys', () => ({ surveysApi: api }));
vi.mock('./services/activityLogger', () => {
    const logger = new Proxy({}, { get: () => vi.fn() });
    return { default: logger, activityLogger: logger };
});

import { setAppLanguage } from '../../i18n/index.js';
import { LessonsRoom } from './LessonsRoom';
import { LessonRoomView } from './LessonRoomView';
import { SurveyRenderer } from './components/survey/SurveyRenderer';
import { SurveyManager } from './pages/teach/SurveyManager';
import { SurveyResponses } from './pages/teach/SurveyResponses';
import { LessonsQueryProvider } from './LessonsQueryProvider';

const lesson = (id, title, sections = 1) => ({
    id, title, isPublished: true, sections: Array.from({ length: sections }, (_, i) => ({ id: id * 10 + i, order: i, type: 'text', content: '<p>x</p>' })),
});
const surveyItem = (id, title, questions, isPublished = true) => ({ id, survey: { id, title, isPublished, _count: { questions } } });

const visibleText = (container) => container.textContent;
const ariaAndTitles = (container) => [...container.querySelectorAll('[aria-label],[title]')]
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`).join(' | ');

beforeAll(async () => { await setAppLanguage('fi'); });
afterAll(async () => { await setAppLanguage('en'); });
beforeEach(() => { Object.values(api).forEach((fn) => fn.mockReset()); });

describe('course room in Finnish', () => {
    // Regression lock: the course room rendered "Course", "6 lessons", "cards", "list", "section(s)" and "Not published" in English under a Finnish UI (FI-0010 F08)
    it('renders the contents page in Finnish with Finnish plurals', () => {
        const lessons = [1, 2, 3, 4, 5, 6].map((n) => lesson(n, `Oppitunti ${n}`, n === 1 ? 1 : 3));
        lessons[5].isPublished = false;
        const { container } = render(
            <LessonsRoom
                lessons={lessons}
                surveys={[surveyItem(9, 'Palaute', 1)]}
                classroomId={4}
                classMeta={{ name: 'Patologia' }}
                completedIds={new Set([1])}
                onMarkComplete={() => {}}
            />,
        );
        const text = visibleText(container);
        expect(text).toContain('Kurssi');
        expect(text).toContain('6 oppituntia');
        expect(text).toContain('1 kysely');
        expect(text).toContain('1 suoritettu');
        expect(text).toContain('Kortit');
        expect(text).toContain('Luettelo');
        expect(text).toContain('1 osio');
        expect(text).toContain('3 osiota');
        expect(text).toContain('1 kysymys');
        expect(text).toContain('Kurssikysely');
        expect(text).toContain('Ei julkaistu');
        expect(ariaAndTitles(container)).toContain('Ei julkaistu – opiskelijat eivät vielä näe tätä');
        expect(ariaAndTitles(container)).toContain('Suoritettu');
        for (const english of ['Course', 'lessons', 'survey', 'completed', 'cards', 'list', 'section', 'question', 'Not published', 'Survey']) {
            expect(text, english).not.toMatch(new RegExp(`\\b${english}\\b`));
        }
        expect(ariaAndTitles(container)).not.toMatch(/Completed|Not published|students can/);
    });

    it('uses the Finnish partitive plural and a Finnish fallback title', () => {
        const { container } = render(
            <LessonsRoom lessons={[lesson(1, 'A'), lesson(2, 'B')]} surveys={[]} completedIds={new Set()} onMarkComplete={() => {}} classMeta={{}} />,
        );
        expect(visibleText(container)).toContain('2 oppituntia');
        expect(visibleText(container)).toContain('Oppitunnit'); // fallback title, not "Lessons"
    });

    it('names an empty course in Finnish', () => {
        const { container } = render(
            <LessonsRoom lessons={[]} surveys={[]} completedIds={new Set()} onMarkComplete={() => {}} classMeta={{ name: 'Tyhjä' }} />,
        );
        expect(visibleText(container)).toContain('Kurssilla ei vielä ole sisältöä');
        expect(visibleText(container)).toContain('Kurssilla ei vielä ole oppitunteja tai kyselyitä.');
        expect(visibleText(container)).not.toMatch(/No course content|doesn.t have/);
    });

    it('offers "Kaikki sisällöt" back from a lesson, and Finnish completion controls', () => {
        render(
            <LessonsRoom lessons={[lesson(1, 'Ensimmäinen'), lesson(2, 'Toinen')]} surveys={[]} completedIds={new Set()} onMarkComplete={() => {}} classMeta={{}} />,
        );
        fireEvent.click(screen.getByText('Ensimmäinen'));
        expect(screen.getByText('Kaikki sisällöt')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Merkitse suoritetuksi' })).toBeInTheDocument();
        expect(screen.queryByText(/All contents|Mark complete/)).toBeNull();
    });

    it('shows a completed lesson as Suoritettu', () => {
        render(<LessonRoomView lecture={lesson(1, 'Valmis')} onOpenTutor={() => {}} completed onMarkComplete={() => {}} />);
        expect(screen.getByRole('button', { name: 'Suoritettu' })).toBeDisabled();
        expect(screen.queryByText('Completed')).toBeNull();
    });
});

describe('course survey for a learner, in Finnish', () => {
    const survey = {
        id: 5, title: 'Palaute', questions: [
            { id: 51, questionText: 'Oliko selkeä?', questionType: 'single_choice', options: ['Kyllä', 'Ei'], isRequired: true },
        ],
    };

    // Regression lock: "This question is required" and "Failed to submit survey" were hardcoded English (FI-0010 F08)
    it('asks for a required answer in Finnish', async () => {
        render(<SurveyRenderer survey={survey} />);
        fireEvent.click(screen.getByRole('button', { name: 'Lähetä kysely' }));
        expect(await screen.findByText('Vastaa tähän kysymykseen.')).toBeInTheDocument();
        expect(screen.queryByText(/This question is required|Submit Survey/)).toBeNull();
        expect(api.submitResponse).not.toHaveBeenCalled();
    });

    it('reports a failed submission in Finnish, never the raw server text', async () => {
        api.submitResponse.mockRejectedValue(Object.assign(new Error('Failed to submit response'), { status: 500, code: 'HTTP_500' }));
        render(<SurveyRenderer survey={survey} />);
        fireEvent.click(screen.getByLabelText('Kyllä'));
        fireEvent.click(screen.getByRole('button', { name: 'Lähetä kysely' }));
        expect(await screen.findByText('Kyselyä ei voitu lähettää. Yritä uudelleen.')).toBeInTheDocument();
        expect(screen.queryByText(/Failed to submit/)).toBeNull();
    });

    it('explains a refused answer from its code', async () => {
        api.submitResponse.mockRejectedValue(Object.assign(new Error('x'), { status: 400, code: 'survey_answer_not_an_option' }));
        render(<SurveyRenderer survey={survey} />);
        fireEvent.click(screen.getByLabelText('Ei'));
        fireEvent.click(screen.getByRole('button', { name: 'Lähetä kysely' }));
        expect(await screen.findByText(/Jokin vastauksistasi ei ole tämän kyselyn vaihtoehto/)).toBeInTheDocument();
    });
});

describe('survey builder and results for an educator, in Finnish', () => {
    it('labels the survey editor in Finnish', async () => {
        api.getSurveys.mockResolvedValue([{
            id: 7, title: 'Kokemus', isPublished: false, isAnonymous: false, _count: { questions: 1, responses: 0 },
            questions: [{ id: 70, surveyId: 7, questionText: 'Realistinen?', questionType: 'single_choice', options: ['Kyllä', 'Ei'], isRequired: true, orderIndex: 0 }],
        }]);
        const { container } = render(<SurveyManager classroomId={3} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Kokemus' }));
        await waitFor(() => expect(visibleText(container)).toContain('Kysymykset'));
        expect(visibleText(container)).toContain('Kurssikyselyt');
        expect(visibleText(container)).toContain('Luo kysely');
        // F19: no link to a route rohy does not have.
        expect(container.querySelector('a[href^="/classes"]')).toBeNull();

        fireEvent.click(screen.getAllByRole('button', { name: 'Lisää kysymys' }).at(-1));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Kysymystyyppi')).toBeInTheDocument();
        expect(within(dialog).getByText('Vastausvaihtoehdot')).toBeInTheDocument();
        expect(dialog.textContent).not.toMatch(/Question type|Options\b/);
    });

    it('shows the results in Finnish, with Finnish dates and percentages, and goes back through onBack', async () => {
        // Regression lock: survey results used toLocaleString() with the browser locale, and the breadcrumbs were <a href="/classes"> links to routes rohy does not have (FI-0010 F16, F19)
        api.getResponses.mockResolvedValue({
            survey: { id: 7, title: 'Kokemus', isAnonymous: false },
            totalResponses: 2,
            questionStats: [{ questionId: 70, questionText: 'Realistinen?', questionType: 'single_choice', options: ['Kyllä', 'Ei'], optionCounts: { Kyllä: 1, Ei: 1 }, totalResponses: 2 }],
            responses: [{ id: 1, completedAt: '2026-10-14T09:05:00.000Z', user: { displayName: 'opiskelija', email: 'o@example.com' }, answers: [{ id: 11, answerValue: 'Kyllä', question: { questionText: 'Realistinen?' } }] }],
        });
        const onBack = vi.fn();
        const { container } = render(
            <LessonsQueryProvider><SurveyResponses surveyId={7} classroomId={3} onBack={onBack} /></LessonsQueryProvider>,
        );
        expect(await screen.findByText('Yhteenveto')).toBeInTheDocument();
        const text = visibleText(container);
        expect(text).toContain('Vastaukset');
        expect(text).toContain('Yksittäiset vastaukset');
        expect(text).toContain('Vie CSV-tiedostona');
        expect(text).toContain('2 vastausta');
        expect(text).toMatch(/1 \(50\s%\)/); // Finnish: a (non-breaking) space before %
        for (const english of ['Responses', 'Summary', 'Individual responses', 'Export CSV', 'Classes']) {
            expect(text, english).not.toContain(english);
        }

        expect(container.querySelector('a[href]')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Kurssikyselyt' }));
        expect(onBack).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Yksittäiset vastaukset'));
        const finnishDate = new Date('2026-10-14T09:05:00.000Z').toLocaleString('fi');
        expect(await screen.findByText(finnishDate)).toBeInTheDocument();
        expect(screen.getByText('Vastaus 1')).toBeInTheDocument();
    });
});
