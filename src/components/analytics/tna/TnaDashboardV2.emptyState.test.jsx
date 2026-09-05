// Regression lock: the zero-match empty state on the sequence tabs.
//
// CONTRACT: Network / Clusters / Patterns / Process Map render their whole
// body behind a `transformedData` gate. When the filters match no analysable
// sequence that gate rendered NOTHING — a blank dashboard with no
// explanation, and the one "no sequences" message that existed was gated to
// the window-record sources only, so the default activity source never showed
// it. Every sequence tab now renders an explicit empty state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ apiFetch: apiFetchMock }));

// Heavy SVG views the empty-state assertions don't need.
vi.mock('../../oyon/OyonAttentionV2', () => ({ default: () => <div /> }));
vi.mock('../../oyon/OyonGazeView', () => ({ default: () => <div /> }));
vi.mock('../../oyon/OyonSessionsView', () => ({ default: () => <div /> }));
vi.mock('../../oyon/OyonAffectV2', () => ({ default: () => <div /> }));
vi.mock('../charts/StackedAreaChart', () => ({ default: () => <div /> }));
vi.mock('../charts/DayHourMatrix', () => ({ default: () => <div /> }));

import TnaDashboardV2 from './TnaDashboardV2.jsx';

// Two events, both on case c1 — filtering to any other case yields zero rows
// and therefore zero sequences.
const routeApi = () => {
    apiFetchMock.mockImplementation(async (url) => {
        if (url.startsWith('/analytics/filter-options')) {
            return { cases: [{ id: 'c1', title: 'Chest pain' }], users: [] };
        }
        if (url.startsWith('/analytics/events')) {
            // The server applies the case filter; the mock honours it the
            // same way so a non-existent case really does return no rows.
            const caseId = new URLSearchParams(url.split('?')[1]).get('case_id');
            const events = [
                { timestamp: '2026-06-01T10:00:00.000Z', session_id: 1, user_id: 1, username: 'amina', verb: 'ORDERED_LAB', object_type: 'lab_test', case_id: 'c1' },
                { timestamp: '2026-06-01T10:05:00.000Z', session_id: 1, user_id: 1, username: 'amina', verb: 'SENT_MESSAGE', object_type: 'chat_message', case_id: 'c1' },
            ].filter((e) => !caseId || e.case_id === caseId);
            return { events, total: events.length, limit: 5000, offset: 0 };
        }
        if (url.startsWith('/addons/oyon/emotion-records')) return { records: [], total: 0 };
        return {};
    });
};

const EMPTY = /No events match the current filters/;

beforeEach(() => {
    cleanup();
    apiFetchMock.mockReset();
    routeApi();
});

describe('TnaDashboardV2 zero-match filters', () => {
    it.each(['Network', 'Clusters', 'Patterns', 'Process Map'])(
        'the %s tab explains that nothing matched instead of rendering blank',
        async (tab) => {
            render(<TnaDashboardV2 externalFilters={{ caseId: 'no-such-case' }} />);
            await waitFor(() => expect(apiFetchMock.mock.calls.some((c) => c[0].startsWith('/analytics/events'))).toBe(true));

            fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${tab}$`) }));

            await waitFor(() => expect(screen.getByText(EMPTY)).toBeTruthy());
        },
    );

    it('drops the empty state again once the filters match sequences', async () => {
        const { rerender } = render(<TnaDashboardV2 externalFilters={{ caseId: 'no-such-case' }} />);
        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));
        await waitFor(() => expect(screen.getByText(EMPTY)).toBeTruthy());

        rerender(<TnaDashboardV2 externalFilters={{ caseId: 'c1' }} />);

        await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    });

    it('does not accuse the filters while the rows are still loading', async () => {
        // A fetch that never settles → the loading card, not the empty state.
        apiFetchMock.mockImplementation(() => new Promise(() => {}));
        render(<TnaDashboardV2 externalFilters={{ caseId: 'no-such-case' }} />);

        fireEvent.click(screen.getByRole('button', { name: /^Network$/ }));

        expect(screen.queryByText(EMPTY)).toBeNull();
        expect(screen.getByText(/Loading activity events/)).toBeTruthy();
    });
});
