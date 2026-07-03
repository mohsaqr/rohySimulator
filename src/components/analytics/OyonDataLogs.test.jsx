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
    room: 'chat',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    dominant_emotion: 'happy',
    confidence: 0.8,
    valence: 0.4,
    arousal: 0.3,
    missing_face_ratio: 0.05,
    gaze: {
        n_points: 100,
        zone_proportions: { middle_center: 0.7, top_center: 0.3 },
        centroid: { x: 0.05, y: -0.1 },
        dispersion: 0.12,
        off_screen_ratio: 0.05,
        duration_ms: 10000,
        aoi_dwell_ms: { patient_face: 4000 },
    },
    engagement: { focus_score: 0.8, gaze_entropy: 0.4 },
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

    it('switches to the enhanced Gaze log view via the pill nav', async () => {
        respondWithRecords();
        render(<OyonDataLogs />);
        await screen.findByText('alice');

        fireEvent.click(screen.getByRole('button', { name: /Gaze/ }));

        expect(screen.getByPlaceholderText('Search any column…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Columns/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /CSV/ })).toBeInTheDocument();
        expect(screen.getByText('looking at')).toBeInTheDocument();
        expect(screen.getAllByText('Patient').length).toBeGreaterThan(0);
        expect(screen.getAllByText('middle_center').length).toBeGreaterThan(0);
    });

    it('exports the currently listed Gaze log rows after grid search', async () => {
        const blobs = [];
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        const originalCreateElement = document.createElement.bind(document);
        URL.createObjectURL = vi.fn((blob) => {
            blobs.push(blob);
            return 'blob:gaze-log';
        });
        URL.revokeObjectURL = vi.fn();
        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
            const element = originalCreateElement(tagName, options);
            if (String(tagName).toLowerCase() === 'a') element.click = vi.fn();
            return element;
        });

        try {
            respondWithRecords();
            render(<OyonDataLogs />);
            await screen.findByText('alice');

            fireEvent.click(screen.getByRole('button', { name: /Gaze/ }));
            fireEvent.change(screen.getByPlaceholderText('Search any column…'), {
                target: { value: 'bob' },
            });

            await waitFor(() => {
                expect(screen.queryByText('alice')).not.toBeInTheDocument();
                expect(screen.getByText('bob')).toBeInTheDocument();
            });

            fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
            expect(blobs).toHaveLength(1);
            const csv = await readBlobText(blobs[0]);
            expect(csv).toContain('bob');
            expect(csv).not.toContain('alice');
            expect(csv.split('\r\n')).toHaveLength(2);
        } finally {
            createElementSpy.mockRestore();
            if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
            else delete URL.createObjectURL;
            if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
            else delete URL.revokeObjectURL;
        }
    });
});

function readBlobText(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}
