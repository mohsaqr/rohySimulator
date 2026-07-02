// Tests for OyonSessionsView — the session list with drill-in extracted from
// OyonLearningAnalyticsTab. Grouping is client-side over the `records` prop;
// the drill-in fetches /addons/oyon/analytics/session/{id} via apiClient
// (mocked here, following the AttentionTab test pattern).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../services/apiClient', () => ({
    apiFetch: apiFetchMock,
}));

import OyonSessionsView from './OyonSessionsView.jsx';

const rec = (over = {}) => ({
    id: Math.random().toString(36).slice(2),
    session_id: 's1',
    user_id: 1,
    username: 'alice',
    case_id: 7,
    case_title_snapshot: 'Chest pain',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    dominant_emotion: 'happy',
    confidence: 0.8,
    valence: 0.4,
    missing_face_ratio: 0.05,
    ...over,
});

const detailWindow = (over = {}) => ({
    window_start: '2026-07-02T08:00:00',
    window_end: '2026-07-02T08:00:10',
    dominant_emotion: 'happy',
    confidence: 0.8,
    valence: 0.5,
    missing_face_ratio: 0.05,
    ...over,
});

beforeEach(() => {
    apiFetchMock.mockReset();
});

describe('OyonSessionsView', () => {
    it('groups records into one session row each with the count line', () => {
        render(
            <OyonSessionsView
                records={[
                    rec(),
                    rec(),
                    rec({ session_id: 's2', username: 'bob', case_title_snapshot: 'Sepsis' }),
                ]}
            />,
        );
        expect(screen.getByText('3 windows across 2 sessions')).toBeInTheDocument();
        expect(screen.getByText('Session s1')).toBeInTheDocument();
        expect(screen.getByText('Session s2')).toBeInTheDocument();
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('Sepsis')).toBeInTheDocument();
        expect(apiFetchMock).not.toHaveBeenCalled();
    });

    it('drills into a session: fetches the detail and renders timeline + valence line', async () => {
        apiFetchMock.mockResolvedValue({
            oyon_windows: [
                detailWindow(),
                detailWindow({ window_start: '2026-07-02T08:00:10', window_end: '2026-07-02T08:00:20', valence: -0.2 }),
            ],
        });
        render(<OyonSessionsView records={[rec()]} />);
        fireEvent.click(screen.getByText('Session s1'));
        expect(apiFetchMock).toHaveBeenCalledWith('/addons/oyon/analytics/session/s1');
        await waitFor(() => {
            expect(screen.getByText('Estimated dominant per window')).toBeInTheDocument();
        });
        expect(screen.getByText('Valence (estimate)')).toBeInTheDocument();
    });

    it('shows the loading state while the drill-in fetch is in flight', () => {
        apiFetchMock.mockImplementation(() => new Promise(() => {}));
        render(<OyonSessionsView records={[rec()]} />);
        fireEvent.click(screen.getByText('Session s1'));
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('surfaces a drill-in fetch failure as an inline error', async () => {
        apiFetchMock.mockRejectedValue(new Error('boom 503'));
        render(<OyonSessionsView records={[rec()]} />);
        fireEvent.click(screen.getByText('Session s1'));
        await waitFor(() => {
            expect(screen.getByText('boom 503')).toBeInTheDocument();
        });
    });

    it('reports when a session detail has no captured windows', async () => {
        apiFetchMock.mockResolvedValue({ oyon_windows: [] });
        render(<OyonSessionsView records={[rec()]} />);
        fireEvent.click(screen.getByText('Session s1'));
        await waitFor(() => {
            expect(screen.getByText(/No estimated-expression windows captured/)).toBeInTheDocument();
        });
    });

    it('clicking an open session toggles it closed without refetching', async () => {
        apiFetchMock.mockResolvedValue({ oyon_windows: [detailWindow()] });
        render(<OyonSessionsView records={[rec()]} />);
        fireEvent.click(screen.getByText('Session s1'));
        await waitFor(() => {
            expect(screen.getByText('Estimated dominant per window')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Session s1'));
        expect(screen.queryByText('Estimated dominant per window')).not.toBeInTheDocument();
        expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state without records', () => {
        render(<OyonSessionsView records={[]} />);
        expect(screen.getByText(/No sessions match the current filters/)).toBeInTheDocument();
    });
});
