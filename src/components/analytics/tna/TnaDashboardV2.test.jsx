// Tests for src/components/analytics/tna/TnaDashboardV2.jsx — the hub-embed
// contract added for AnalyticsHub.
//
// CONTRACT (locked from TnaDashboardV2.jsx):
//   - `externalFilters` (default null): when set to
//     { caseId, userId, startDate, endDate }, every fetch uses those values
//     (undefined/null fields treated as ''), the four Case/Student/Start/End
//     input groups are NOT rendered, and the per-tab controls (Source,
//     Group by, Mode / Emotion states) still are. Changing externalFilters
//     re-fetches with the new params.
//   - `hideHeader` (default false): suppresses V2's own header row (title +
//     close/refresh buttons); the tab strip still renders.
//   - Defaults preserve standalone behavior exactly: local filter inputs
//     and the header (with close button when `onClose` is given) render.
//   - Signal tabs (Attention/Gaze/Sessions, …): first-class tabs driven
//     by ONE shared /addons/oyon/emotion-records fetch that fires
//     whenever a signal tab is active — regardless of the Source select —
//     paginated at 200/page and capped at 1000 with a truncation notice.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({
    apiFetch: apiFetchMock,
}));

// The Oyon presentation views are heavy (SVG plots) — stub them so these
// tests stay about V2's fetch/tab wiring.
vi.mock('../../oyon/OyonAttentionV2', () => ({
    default: ({ records }) => <div data-testid="oyon-attention-v2-view">attention:{records?.length ?? 0}</div>,
}));
vi.mock('../../oyon/OyonGazeView', () => ({
    default: ({ records }) => <div data-testid="oyon-gaze-view">gaze:{records?.length ?? 0}</div>,
}));
vi.mock('../../oyon/OyonSessionsView', () => ({
    default: ({ records }) => <div data-testid="oyon-sessions-view">sessions:{records?.length ?? 0}</div>,
}));
vi.mock('../../oyon/OyonAffectV2', () => ({
    default: ({ records }) => <div data-testid="oyon-affect-v2-view">affect:{records?.length ?? 0}</div>,
}));

// The two carmdash-style Activity-tab charts are SVG-heavy — stub them so the
// activity-tab tests stay about V2's fetch + client-side filter wiring.
vi.mock('../charts/StackedAreaChart', () => ({
    default: ({ series, title }) => <div data-testid="stacked-area-chart">{title}:{series.length}</div>,
}));
vi.mock('../charts/DayHourMatrix', () => ({
    default: ({ events }) => <div data-testid="day-hour-matrix">matrix:{events.length}</div>,
}));

import TnaDashboardV2 from './TnaDashboardV2.jsx';

// Route the mock by endpoint: filter options + empty sequence payload keep
// the heavy downstream visualizations (network graph, clusters…) unmounted
// so the assertions stay about the filter/header wiring. `emotionTotal`
// controls how many emotion-record rows the paginated endpoint reports.
const routeApi = ({ emotionTotal = 3 } = {}) => {
    apiFetchMock.mockImplementation(async (url) => {
        if (url.startsWith('/analytics/filter-options')) {
            return { cases: [{ id: 'c1', title: 'Chest pain' }], users: [{ id: 'u1', username: 'amina' }] };
        }
        if (url.startsWith('/analytics/tna-sequences')) {
            return { sequences: [], objectTypeSequences: [], metadata: null };
        }
        if (url.startsWith('/learning-events/all')) {
            return {
                events: [
                    { timestamp: '2026-06-01T10:00:00.000Z', user_id: 1, username: 'amina', verb: 'ORDERED_LAB', object_type: 'lab_test', case_id: 'c1' },
                    { timestamp: '2026-06-02T11:00:00.000Z', user_id: 2, username: 'omar', verb: 'SENT_MESSAGE', object_type: 'chat_message', case_id: 'c1' },
                ],
            };
        }
        if (url.startsWith('/addons/oyon/emotion-records')) {
            const params = new URLSearchParams(url.split('?')[1]);
            const limit = parseInt(params.get('limit') || '200', 10);
            const offset = parseInt(params.get('offset') || '0', 10);
            const n = Math.max(0, Math.min(limit, emotionTotal - offset));
            const records = Array.from({ length: n }, (_, i) => ({
                id: offset + i,
                session_id: `s${(offset + i) % 4}`,
                // Chronology + rooms/gaze so the Locations / Gaze targets
                // sources can build sequences from the same mock rows.
                window_start: `2026-07-02T08:${String(10 + (offset + i)).padStart(2, '0')}:00.000Z`,
                room: (offset + i) % 2 === 0 ? 'chat' : 'lab',
                gaze: { aoi_dwell_ms: (offset + i) % 2 === 0 ? { patient_face: 800 } : { ecg: 700 } },
            }));
            return { records, total: emotionTotal };
        }
        return {};
    });
};

const seqUrls = () => apiFetchMock.mock.calls
    .map((c) => c[0])
    .filter((u) => u.startsWith('/analytics/tna-sequences?'));

const lastSeqParams = () => new URLSearchParams(seqUrls().at(-1).split('?')[1]);

beforeEach(() => {
    apiFetchMock.mockReset();
    routeApi();
});

describe('TnaDashboardV2 standalone (defaults)', () => {
    it('lands on Activity and renders its own Case/Student/Start/End filter inputs and header close button', async () => {
        render(<TnaDashboardV2 onClose={() => {}} />);
        await waitFor(() => expect(eventUrls()).toEqual(['/learning-events/all?limit=5000']));

        expect(screen.getByText('Case')).toBeTruthy();
        expect(screen.getByText('Student')).toBeTruthy();
        expect(screen.getByText('Start')).toBeTruthy();
        expect(screen.getByText('End')).toBeTruthy();
        expect(screen.getByText('Activity Overview')).toBeTruthy();
        expect(screen.getByTitle('Close')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy();
        expect(seqUrls().length).toBe(0);
    });
});

describe('TnaDashboardV2 externalFilters', () => {
    it('hides the Case/Student/Start/End inputs but keeps the per-tab controls', async () => {
        render(<TnaDashboardV2 externalFilters={{ caseId: '7' }} />);
        await waitFor(() => expect(eventUrls().length).toBe(1));

        expect(screen.queryByText('Case')).toBeNull();
        expect(screen.queryByText('Student')).toBeNull();
        expect(screen.queryByText('Start')).toBeNull();
        expect(screen.queryByText('End')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));
        await waitFor(() => expect(seqUrls().length).toBe(1));
        // V2-owned per-tab controls stay.
        expect(screen.getByText('Source')).toBeTruthy();
        expect(screen.getByText('Group by')).toBeTruthy();
        expect(screen.getByText('Mode')).toBeTruthy();
    });

    it('feeds the external values into the sequence fetch, treating missing fields as empty', async () => {
        render(
            <TnaDashboardV2
                externalFilters={{ caseId: '7', userId: '42', startDate: '2026-01-01', endDate: undefined }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));
        await waitFor(() => expect(seqUrls().length).toBe(1));

        const params = lastSeqParams();
        expect(params.get('case_id')).toBe('7');
        expect(params.get('user_id')).toBe('42');
        expect(params.get('start_date')).toBe('2026-01-01');
        expect(params.has('end_date')).toBe(false);
    });

    it('refetches with the new case_id when externalFilters changes', async () => {
        const { rerender } = render(<TnaDashboardV2 externalFilters={{ caseId: '1' }} />);
        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));
        await waitFor(() => expect(seqUrls().length).toBe(1));
        expect(lastSeqParams().get('case_id')).toBe('1');

        rerender(<TnaDashboardV2 externalFilters={{ caseId: '2' }} />);
        await waitFor(() => expect(seqUrls().length).toBe(2));
        expect(lastSeqParams().get('case_id')).toBe('2');
    });
});

describe('TnaDashboardV2 hideHeader', () => {
    it('removes the close button and title but keeps the tab strip', async () => {
        render(<TnaDashboardV2 onClose={() => {}} hideHeader />);
        await waitFor(() => expect(eventUrls().length).toBe(1));

        expect(screen.queryByTitle('Close')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Analytics' })).toBeNull();
        // Tab strip still renders.
        expect(screen.getByRole('button', { name: /Network/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Process Map/ })).toBeTruthy();
    });
});

const emotionUrls = () => apiFetchMock.mock.calls
    .map((c) => c[0])
    .filter((u) => u.startsWith('/addons/oyon/emotion-records?'));

const eventUrls = () => apiFetchMock.mock.calls
    .map((c) => c[0])
    .filter((u) => u.startsWith('/learning-events/all'));

describe('TnaDashboardV2 activity tab charts', () => {
    it('loads raw learning events on the landing Activity tab and renders both chart cards', async () => {
        render(<TnaDashboardV2 />);

        await waitFor(() => expect(eventUrls()).toEqual(['/learning-events/all?limit=5000']));
        await waitFor(() => expect(screen.getByTestId('stacked-area-chart')).toBeTruthy());
        // Both new chart titles render; the fixture's two events flow through.
        // The 2-day mock fixture is a short span → adaptive granularity
        // switches the stacked-area title to the over-time variant.
        expect(screen.getByText(/Activity by State over Time/)).toBeTruthy();
        expect(screen.getByText('Student Activity')).toBeTruthy();
        expect(screen.getByTestId('day-hour-matrix').textContent).toBe('matrix:2');
    });

    it('filter changes re-slice the cached rows client-side without a second fetch', async () => {
        const { rerender } = render(<TnaDashboardV2 externalFilters={{ caseId: '' }} />);

        await waitFor(() => expect(screen.getByTestId('day-hour-matrix').textContent).toBe('matrix:2'));

        // Both fixture events are case c1 — narrowing to c2 empties the charts
        // but must NOT re-fetch (the 5000-row cache is filtered in-memory).
        rerender(<TnaDashboardV2 externalFilters={{ caseId: 'c2' }} />);
        await waitFor(() =>
            expect(screen.getAllByText('No events for the current filters').length).toBe(2));
        expect(eventUrls().length).toBe(1);
    });
});

describe('TnaDashboardV2 window-record sources (Locations / Gaze targets)', () => {
    it('offers all four sources and switching to Locations uses the records fetch, not tna-sequences', async () => {
        render(<TnaDashboardV2 />);
        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));
        await waitFor(() => expect(seqUrls().length).toBe(1));

        const sourceSelect = screen.getByText('Source').parentElement.querySelector('select');
        expect([...sourceSelect.options].map((o) => o.value))
            .toEqual(['activity', 'emotions', 'rooms', 'gaze-targets']);

        fireEvent.change(sourceSelect, { target: { value: 'rooms' } });
        await waitFor(() => expect(apiFetchMock.mock.calls
            .filter((c) => c[0].startsWith('/addons/oyon/emotion-records')).length).toBeGreaterThan(0));
        // No additional tna-sequences fetch for a records source.
        expect(seqUrls().length).toBe(1);
        // Stat cards flip to the Locations vocabulary (the source <option>
        // also says 'Locations', so expect a second occurrence = the card).
        await waitFor(() => expect(screen.getAllByText('Locations').length).toBeGreaterThan(1));
        // Emotion-only + activity-only controls are hidden.
        expect(screen.queryByText('Emotion states')).toBeNull();
        expect(screen.queryByText('Mode')).toBeNull();
        expect(screen.queryByText('Group by')).toBeNull();
    });

    it('Gaze targets source builds sequences from AOI dwell', async () => {
        render(<TnaDashboardV2 />);
        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));
        await waitFor(() => expect(seqUrls().length).toBe(1));
        const sourceSelect = screen.getByText('Source').parentElement.querySelector('select');
        fireEvent.change(sourceSelect, { target: { value: 'gaze-targets' } });
        await waitFor(() => expect(screen.getAllByText('Gaze targets').length).toBeGreaterThan(1));
        expect(screen.getByText('Session sequences')).toBeTruthy();
    });
});

describe('TnaDashboardV2 signal tabs', () => {
    it('shows all grouped tabs including the new signal tabs', async () => {
        render(<TnaDashboardV2 />);
        await waitFor(() => expect(eventUrls().length).toBe(1));

        for (const name of ['Activity', 'Network', 'Patterns', 'Process Map', 'Clusters',
            'Attention', 'Affect', 'Gaze', 'Compare', 'Sessions', 'Settings']) {
            expect(screen.getByRole('button', { name: new RegExp(`^${name}$`) })).toBeTruthy();
        }
        expect(screen.queryByRole('button', { name: /^Attention 2$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Affect 2$/ })).toBeNull();
        // Trends was retired from the primary signal tab strip.
        expect(screen.queryByRole('button', { name: /^Trends$/ })).toBeNull();
        // Engagement was retired from the primary signal tab strip.
        expect(screen.queryByRole('button', { name: /^Engagement$/ })).toBeNull();
        // The embedded <oyon-app> element tab was deliberately removed —
        // nesting Oyon's own app chrome inside this dashboard is not wanted.
        expect(screen.queryByRole('button', { name: /^Oyon$/ })).toBeNull();
    });

    it('the Affect tab renders the V2 affect view directly', async () => {
        render(<TnaDashboardV2 />);
        await waitFor(() => expect(emotionUrls().length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole('button', { name: /^Affect$/ }));
        await waitFor(() => expect(screen.getByTestId('oyon-affect-v2-view').textContent).toBe('affect:3'));
    });

    it('the Attention tab renders the V2 attention view directly', async () => {
        render(<TnaDashboardV2 />);
        await waitFor(() => expect(emotionUrls().length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole('button', { name: /^Attention$/ }));

        await waitFor(() => expect(screen.getByTestId('oyon-attention-v2-view').textContent).toBe('attention:3'));
    });

    it('clicking Gaze fetches emotion records even with source=activity and renders the gaze view', async () => {
        render(<TnaDashboardV2 />); // defaultSource = 'activity'
        await waitFor(() => expect(emotionUrls().length).toBe(1));

        fireEvent.click(screen.getByRole('button', { name: /Gaze/ }));

        await waitFor(() => expect(screen.getByTestId('oyon-gaze-view').textContent).toBe('gaze:3'));
        // The other signal views stay unmounted.
        expect(screen.queryByTestId('oyon-attention-v2-view')).toBeNull();
    });

    it('does not re-fetch when hopping between two signal tabs (one shared fetch)', async () => {
        render(<TnaDashboardV2 />);
        await waitFor(() => expect(emotionUrls().length).toBeGreaterThan(0));
        const callsAfterLanding = emotionUrls().length;

        fireEvent.click(screen.getByRole('button', { name: /^Attention$/ }));
        await waitFor(() => expect(screen.getByTestId('oyon-attention-v2-view')).toBeTruthy());
        const callsAfterFirst = emotionUrls().length;
        expect(callsAfterFirst).toBe(callsAfterLanding);

        fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
        await waitFor(() => expect(screen.getByTestId('oyon-sessions-view')).toBeTruthy());
        expect(emotionUrls().length).toBe(callsAfterFirst); // no second fetch

        fireEvent.click(screen.getByRole('button', { name: /Gaze/ }));
        await waitFor(() => expect(screen.getByTestId('oyon-gaze-view')).toBeTruthy());
        expect(emotionUrls().length).toBe(callsAfterFirst);
    });

    it('paginates to the 1000-window cap and shows the truncation notice', async () => {
        routeApi({ emotionTotal: 1200 });
        render(<TnaDashboardV2 />);
        await waitFor(() => expect(emotionUrls().length).toBe(5));

        fireEvent.click(screen.getByRole('button', { name: /^Attention$/ }));

        await waitFor(() => expect(screen.getByTestId('oyon-attention-v2-view').textContent).toBe('attention:1000'));
        expect(emotionUrls().length).toBe(5); // 5 pages of 200
        expect(screen.getByText(/capped at the most recent 1000 windows/)).toBeTruthy();
    });

    it('omits the truncation notice when under the cap', async () => {
        routeApi({ emotionTotal: 3 });
        render(<TnaDashboardV2 />);
        await waitFor(() => expect(emotionUrls().length).toBe(1));

        fireEvent.click(screen.getByRole('button', { name: /^Attention$/ }));
        await waitFor(() => expect(screen.getByTestId('oyon-attention-v2-view')).toBeTruthy());

        expect(screen.getByText(/3 windows · 3 sessions/)).toBeTruthy();
        expect(screen.queryByText(/capped at the most recent 1000 windows/)).toBeNull();
    });
});
