// Tests for OyonDataLogs — the Oyon raw-data console hosted inside the
// System Logs surface. Locks the seams that matter:
//
//   1. Fetches /addons/oyon/emotion-records and renders the Windows rows.
//   2. FilterBar selections map onto the endpoint's SERVER query params
//      (user_id / from — the names buildEmotionRecordsWhere reads).
//   3. The structured 503 stub (OYON_DISABLED) renders the actionable
//      notice, not an error dump.
//   4. The pill nav switches to the Students aggregate view.
//
// apiFetch is mocked (OyonSessionsView test pattern); ApiError must be the
// SAME class the component imports, so the mock exports one and the tests
// construct rejections from it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { apiFetchMock, MockApiError } = vi.hoisted(() => {
    class MockApiError extends Error {
        constructor(message, { status = 0, code = null, body = null, url = null } = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.code = code;
            this.body = body;
            this.url = url;
        }
    }
    return { apiFetchMock: vi.fn(), MockApiError };
});

vi.mock('../../services/apiClient', () => ({
    apiFetch: apiFetchMock,
    ApiError: MockApiError,
}));

import OyonDataLogs from './OyonDataLogs.jsx';

const rec = (over = {}) => ({
    id: Math.random().toString(36).slice(2),
    session_id: 's1',
    user_id: 1,
    username: 'alice',
    user_role: 'student',
    case_id: 7,
    case_title_snapshot: 'Chest pain',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    dominant_emotion: 'happy',
    confidence: 0.8,
    valence: 0.4,
    arousal: 0.3,
    missing_face_ratio: 0.05,
    ...over,
});

const RECORDS = [
    rec(),
    rec({ id: 'r2', session_id: 's2', user_id: 2, username: 'bob', dominant_emotion: 'sad' }),
];

function respondWithRecords(records = RECORDS) {
    apiFetchMock.mockResolvedValue({ records, total: records.length });
}

function lastFetchUrl() {
    return apiFetchMock.mock.calls.at(-1)[0];
}

beforeEach(() => {
    apiFetchMock.mockReset();
});

describe('OyonDataLogs', () => {
    it('fetches emotion records and renders the Windows rows', async () => {
        respondWithRecords();
        render(<OyonDataLogs />);

        expect(await screen.findByText('alice')).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getByTestId('oyon-data-count')).toHaveTextContent('2 of 2 windows');

        const url = apiFetchMock.mock.calls[0][0];
        expect(url).toContain('/addons/oyon/emotion-records?');
        expect(url).toContain('limit=200');
        expect(url).toContain('offset=0');
    });

    it('maps FilterBar selections onto the server query params', async () => {
        respondWithRecords();
        render(<OyonDataLogs />);
        await screen.findByText('alice');

        // Pick a user in the shared FilterBar combobox → refetch with user_id.
        fireEvent.focus(screen.getByRole('combobox', { name: 'User' }));
        fireEvent.mouseDown(await screen.findByRole('option', { name: /alice/ }));
        await waitFor(() => {
            expect(lastFetchUrl()).toContain('user_id=1');
        });

        // Date inputs map onto from / to.
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-07-01' } });
        await waitFor(() => {
            expect(lastFetchUrl()).toContain('from=2026-07-01');
        });
        // The user filter is still applied alongside the date.
        expect(lastFetchUrl()).toContain('user_id=1');
    });

    it('renders the actionable notice on the structured OYON_DISABLED 503 stub', async () => {
        apiFetchMock.mockRejectedValue(new MockApiError(
            'Oyon is disabled on this server. Set OYON_ENABLED=1 and restart.',
            { status: 503, code: 'OYON_DISABLED' },
        ));
        render(<OyonDataLogs />);

        expect(await screen.findByText(/Oyon data — disabled on this server/)).toBeInTheDocument();
        expect(screen.getByText(/Set OYON_ENABLED=1 and restart/)).toBeInTheDocument();
        expect(screen.getByText('OYON_DISABLED')).toBeInTheDocument();
        // The actionable panel replaces the table chrome entirely.
        expect(screen.queryByRole('combobox', { name: 'User' })).not.toBeInTheDocument();
    });

    it('switches to the Students aggregate view via the pill nav', async () => {
        respondWithRecords();
        render(<OyonDataLogs />);
        await screen.findByText('alice');

        fireEvent.click(screen.getByRole('button', { name: /Students/ }));
        // Column headers unique to the Students aggregate table.
        expect(screen.getByText('Top estimate')).toBeInTheDocument();
        expect(screen.getByText('Mean valence')).toBeInTheDocument();
        expect(screen.getByText('alice')).toBeInTheDocument();
    });
});
