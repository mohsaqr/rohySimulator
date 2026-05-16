// Complements CohortReports.test.jsx — drives the deeper report views
// (StudentDetail drill-down, populated grid, export, live feed polling and
// the error/empty branches) that the smoke test doesn't reach. Uses the
// same fetch-spy harness so the real apiClient → cohortsService path runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import CohortReports from './CohortReports.jsx';

const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

let fetchSpy;

beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
});

describe('CohortReports — RosterView + StudentDetail', () => {
    it('drills into a student, lists sessions + timeline, and navigates back', async () => {
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/student/')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    student: { id: 9, username: 'stu', name: 'Stu', role: 'student' },
                    sessions: [
                        { id: 1, case_id: 'c1', case_name: 'Chest pain', status: 'ended', completed: true, start_time: '2026-05-01T10:00:00Z' },
                        { id: 2, case_id: 'c2', case_name: null, status: null, completed: false, start_time: null },
                    ],
                    events: [
                        { id: 50, session_id: 1, timestamp: '2026-05-01T10:05:00Z', verb: 'opened', object_name: 'Monitor', room: 'patient' },
                        { id: 51, session_id: 2, timestamp: null, verb: 'ordered', object_type: 'lab' },
                    ],
                }));
            }
            if (u.includes('/roster')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    roster: [{
                        id: 9, username: 'stu', name: 'Stu', role: 'student',
                        session_count: 2, cases_attempted: 2, cases_completed: 1,
                        last_activity: '2026-05-01T10:05:00Z',
                    }],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<CohortReports cohortId={1} />);
        await waitFor(() => expect(screen.getByText('Stu')).toBeTruthy());

        fireEvent.click(screen.getByText('Stu'));
        await waitFor(() =>
            expect(screen.getByText('Back to roster')).toBeTruthy());
        // Activity grouped per case/session: named + fallback "Case c2".
        expect(screen.getByText('Chest pain')).toBeTruthy();
        expect(screen.getByText('Case c2')).toBeTruthy();
        // First group is open by default → its event verb is visible.
        expect(screen.getByText('opened')).toBeTruthy();
        // Second group is collapsed → expand it, then its verb shows.
        fireEvent.click(screen.getByText('Case c2'));
        await waitFor(() => expect(screen.getByText('ordered')).toBeTruthy());

        fireEvent.click(screen.getByText('Back to roster'));
        await waitFor(() =>
            expect(screen.getByText('Stu')).toBeTruthy());
    });

    it('shows empty-state copy when a student has no sessions/events', async () => {
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/student/')) {
                return Promise.resolve(jsonResponse({
                    student: { id: 9, username: 'stu' },
                    sessions: [], events: [],
                }));
            }
            if (u.includes('/roster')) {
                return Promise.resolve(jsonResponse({
                    roster: [{ id: 9, username: 'stu', name: 'Stu Dent' }],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });
        renderWithProviders(<CohortReports cohortId={1} />);
        await waitFor(() => expect(screen.getByText('Stu Dent')).toBeTruthy());
        fireEvent.click(screen.getByText('Stu Dent'));
        await waitFor(() =>
            expect(screen.getByText('No activity yet.')).toBeTruthy());
    });

    it('toasts when the roster request fails', async () => {
        fetchSpy.mockImplementation(() =>
            Promise.resolve(jsonResponse({ error: 'nope' }, { status: 500 })));
        renderWithProviders(<CohortReports cohortId={1} />);
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });

    it('renders the empty-roster message', async () => {
        fetchSpy.mockImplementation(() =>
            Promise.resolve(jsonResponse({ roster: [] })));
        renderWithProviders(<CohortReports cohortId={1} />);
        await waitFor(() =>
            expect(screen.getByText(/No members in this class yet/)).toBeTruthy());
    });
});

describe('CohortReports — GridView', () => {
    it('renders a populated completion matrix with completed/attempted/empty cells', async () => {
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/grid')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    students: [
                        { id: 1, username: 'a', name: 'Alice' },
                        { id: 2, username: 'b', name: 'Bob' },
                    ],
                    cases: [
                        { id: 'c1', name: 'Chest pain' },
                        { id: 'c2', name: 'Stroke' },
                    ],
                    cells: {
                        1: { c1: { completed: true, last_activity: '2026-05-01T10:00:00Z' } },
                        2: { c2: { completed: false, last_activity: '2026-05-02T11:00:00Z' } },
                    },
                }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });
        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Completion grid'));
        await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
        expect(screen.getByText('Bob')).toBeTruthy();
        expect(screen.getAllByText('Chest pain').length).toBeGreaterThan(0);
    });

    it('shows the no-members grid message', async () => {
        fetchSpy.mockImplementation((url) => {
            if (String(url).includes('/grid')) {
                return Promise.resolve(jsonResponse({ students: [], cases: [], cells: {} }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });
        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Completion grid'));
        await waitFor(() =>
            expect(screen.getByText(/No members in this class yet/)).toBeTruthy());
    });

    it('toasts when the grid request fails', async () => {
        fetchSpy.mockImplementation((url) => {
            if (String(url).includes('/grid')) {
                return Promise.resolve(jsonResponse({ error: 'x' }, { status: 500 }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });
        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Completion grid'));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });
});

describe('CohortReports — ExportView', () => {
    it('downloads the CSV and toasts success', async () => {
        const createObjectURL = vi.fn(() => 'blob:x');
        const revokeObjectURL = vi.fn();
        globalThis.URL.createObjectURL = createObjectURL;
        globalThis.URL.revokeObjectURL = revokeObjectURL;
        vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/export')) {
                return Promise.resolve(new Response('csv,data', { status: 200 }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });

        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Export'));
        fireEvent.click(await screen.findByRole('button', { name: /Download CSV/i }));
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('CSV download started'));
    });

    it('toasts when the export request fails', async () => {
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/export')) {
                return Promise.resolve(jsonResponse({ error: 'denied' }, { status: 403 }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });
        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Export'));
        fireEvent.click(await screen.findByRole('button', { name: /Download CSV/i }));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });
});

describe('CohortReports — FeedView', () => {
    it('loads events, then pauses and resumes polling', async () => {
        let calls = 0;
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/feed')) {
                calls += 1;
                return Promise.resolve(jsonResponse({
                    events: calls === 1
                        ? [{ id: 1, timestamp: '2026-05-01T10:00:00Z', verb: 'opened', object_name: 'Monitor', room: 'patient' }]
                        : [],
                    next_since: calls,
                }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });

        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Live feed'));
        await waitFor(() => expect(screen.getByText('opened')).toBeTruthy());

        // Pause then resume — exercises the paused branch + interval teardown.
        fireEvent.click(screen.getByRole('button', { name: /Pause/i }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Resume/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /Resume/i }));

        // Manual refresh-now button triggers another poll.
        fireEvent.click(screen.getByTitle('Refresh now'));
        await waitFor(() => expect(calls).toBeGreaterThan(1));
    });

    it('shows the empty-feed message and toasts on poll failure', async () => {
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/feed')) {
                return Promise.resolve(jsonResponse({ error: 'boom' }, { status: 500 }));
            }
            return Promise.resolve(jsonResponse({ roster: [] }));
        });
        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Live feed'));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        await waitFor(() =>
            expect(screen.getByText('No activity yet.')).toBeTruthy());
    });
});
