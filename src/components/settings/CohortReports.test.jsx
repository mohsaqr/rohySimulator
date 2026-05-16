import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import CohortReports from './CohortReports.jsx';

const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

// Stub the heavy SVG/dynajs analytics pieces so rendering the native
// AnalyticsView stays light in jsdom — the unit under test here is the
// cohort tab wiring + scoped fetches, not the chart internals.
vi.mock('dynajs', () => ({
    tna: () => ({ labels: [], weights: [], inits: [] }),
    prune: (m) => m,
    centralities: () => ({ labels: [], measures: {} }),
    layout: () => ({ labels: [], x: [], y: [] }),
}));
vi.mock('../analytics/tna/laila/ActivityTimelineChart', () => ({
    ActivityTimelineChart: () => <div data-testid="timeline" />,
}));
vi.mock('../analytics/tna/laila/ActivityHeatmap', () => ({
    ActivityHeatmap: () => <div data-testid="heatmap" />,
}));
vi.mock('../analytics/tna/laila/ActivityDonutChart', () => ({
    ActivityDonutChart: () => <div data-testid="donut" />,
}));
vi.mock('../analytics/tna/laila/TnaNetworkGraph', () => ({
    TnaNetworkGraph: () => <div data-testid="tna-net" />,
}));
vi.mock('../analytics/tna/laila/CentralityBarChart', () => ({
    CentralityBarChart: () => <div data-testid="centrality" />,
}));
vi.mock('../analytics/tna/laila/TnaFrequencyChart', () => ({
    TnaFrequencyChart: () => <div data-testid="freq" />,
}));

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
});

describe('CohortReports', () => {
    it('renders the four reporting sub-tabs and the roster by default', async () => {
        fetchSpy.mockImplementation((url) => {
            if (String(url).includes('/roster')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    roster: [{
                        id: 9, username: 'stu', name: 'Stu', role: 'student',
                        session_count: 3, cases_attempted: 2,
                        cases_completed: 1, last_activity: null,
                    }],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<CohortReports cohortId={1} />);

        expect(screen.getByText('Completion grid')).toBeTruthy();
        expect(screen.getByText('Live feed')).toBeTruthy();
        await waitFor(() => expect(screen.getByText('Stu')).toBeTruthy());
    });

    it('Analytics tab renders the native scoped view, not an embedded dashboard', async () => {
        const seen = [];
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            seen.push(u);
            if (u.includes('/analytics/summary')) {
                return Promise.resolve(jsonResponse({
                    totalActivities: 5, uniqueUsers: 1, uniqueSessions: 2, avgPerUser: 5,
                }));
            }
            if (u.includes('/analytics/timeline-series')) {
                return Promise.resolve(jsonResponse({ days: [], verbs: [], series: {} }));
            }
            if (u.includes('/analytics/hourly-counts')) {
                return Promise.resolve(jsonResponse({ hourly: [] }));
            }
            if (u.includes('/analytics/stats')) {
                return Promise.resolve(jsonResponse({ verbs: [], objectTypes: [] }));
            }
            if (u.includes('/analytics/tna-sequences')) {
                return Promise.resolve(jsonResponse({ sequences: [], objectTypeSequences: [], metadata: {} }));
            }
            if (u.includes('/roster')) {
                return Promise.resolve(jsonResponse({
                    roster: [{ id: 1, username: 'stu', name: 'Stu', role: 'student' }],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<CohortReports cohortId={7} />);
        fireEvent.click(screen.getByText('Analytics'));

        // Native scope drill is present (no embedded admin dashboard).
        expect(await screen.findByText('Whole class')).toBeTruthy();
        expect(screen.queryByTestId('tna-dash')).toBeNull();
        // Stat tiles render from the scoped summary endpoint.
        await waitFor(() => expect(screen.getByText('Events')).toBeTruthy());
        // Every analytics call is the cohort-scoped, loadOwnedCohort-gated path.
        expect(seen.some((u) => u.includes('/cohorts/7/analytics/summary'))).toBe(true);
        expect(seen.some((u) => u.includes('/cohorts/7/analytics/tna-sequences'))).toBe(true);
    });

    it('does not render stale/old analytics when a scoped load fails (Codex P2)', async () => {
        // Analytics endpoints 500; the view must NOT fall back to rendering
        // a previous scope's stat tiles — `data` is cleared and the error
        // is surfaced via toast.
        fetchSpy.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('/roster')) {
                return Promise.resolve(jsonResponse({
                    roster: [{ id: 1, username: 'stu', name: 'Stu', role: 'student' }],
                }));
            }
            if (u.includes('/analytics/')) {
                return Promise.resolve(jsonResponse({ error: 'boom' }, { status: 500 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<CohortReports cohortId={7} />);
        fireEvent.click(screen.getByText('Analytics'));

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        // No stat tiles from a prior/!current scope leak through.
        expect(screen.queryByText('Events')).toBeNull();
    });

    it('shows the empty-grid message when no cases attempted', async () => {
        fetchSpy.mockImplementation((url) => {
            if (String(url).includes('/grid')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    students: [{ id: 9, username: 'stu', name: 'Stu' }],
                    cases: [],
                    cells: {},
                }));
            }
            return Promise.resolve(jsonResponse({
                cohort: { id: 1, name: 'C' }, roster: [],
            }));
        });

        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Completion grid'));
        await waitFor(() =>
            expect(screen.getByText(/No cases attempted/)).toBeTruthy());
    });
});
