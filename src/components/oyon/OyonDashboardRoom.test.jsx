// Contract for the named Oyon dashboard surface.
//
// This surface is an ADDITION: it renders OYON's own Analyze dashboards
// (OyonServerDashboards → <oyon-app chrome="none">) over server rows, beside
// Rohy's existing Emotion Analytics route rather than replacing it. What matters
// here is that authorization stays server-side (the component only calls Rohy's
// API), that a failed signal-windows probe cannot blank the dashboard, and that
// the modality summary from migration 0039 reaches the UI.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k, opts) => (opts?.count != null ? `${k}:${opts.count}` : k) }),
}));

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));

// The real child loads a ~5 MB web-component bundle; stub it and assert the
// records it is handed instead.
const dashboardProps = vi.fn();
vi.mock('./OyonServerDashboards', () => ({
    default: (props) => {
        dashboardProps(props);
        return <div data-testid="oyon-dashboards">{(props.records || []).length} rows</div>;
    },
}));

const OyonDashboardRoom = (await import('./OyonDashboardRoom')).default;

// `session_id` is NOT NULL in oyon_emotion_records — a fixture without one is
// unfaithful, and hid the fact that the embedded viewer is session-scoped.
function record(i, sessionId = 's1') {
    return {
        record_id: `r${i}`,
        session_id: sessionId,
        window_start: `2026-07-02T08:0${i}:00.000Z`,
        window_end: `2026-07-02T08:0${i}:10.000Z`,
        dominant_emotion: 'neutral',
    };
}

beforeEach(() => {
    apiFetch.mockReset();
    dashboardProps.mockReset();
});

describe('OyonDashboardRoom', () => {
    it('feeds fetched emotion records into Oyon\'s own dashboards', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records: [record(1), record(2)], total: 2 });
            }
            return Promise.resolve({ modalities: [] });
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('oyon-dashboards')).toHaveTextContent('2 rows'));
        expect(dashboardProps).toHaveBeenCalled();
    });

    it('surfaces the modality summary from the signal-windows endpoint', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records: [record(1)], total: 1 });
            }
            return Promise.resolve({ modalities: [{ modality: 'facial', count: 12 }] });
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText('facial · 12')).toBeInTheDocument());
    });

    // A failed advisory probe must not take the dashboard down with it.
    it('still renders the dashboard when the signal-windows probe fails', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records: [record(1)], total: 1 });
            }
            return Promise.reject(new Error('signal windows exploded'));
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('oyon-dashboards')).toBeInTheDocument());
        expect(screen.queryByText('dashboard_load_failed')).not.toBeInTheDocument();
    });

    it('reports a records-fetch failure instead of rendering an empty dashboard', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.reject(new Error('403 Access denied'));
            }
            return Promise.resolve({ modalities: [] });
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText('dashboard_load_failed')).toBeInTheDocument());
        expect(screen.getByText('403 Access denied')).toBeInTheDocument();
        expect(screen.queryByTestId('oyon-dashboards')).not.toBeInTheDocument();
    });
});

// ---------- session scoping ---------------------------------------------
//
// Regression lock for the "renders data, refresh, empty" bug.
//
// An embedded chrome="none" Oyon viewer FORCES the current-session scope as a
// privacy boundary: with no pinned session it reports "No active session" and
// renders zero rows no matter what setWindows() fed it (Oyon's own contract:
// "a missing session must yield no rows" / "a viewer pin must win"). The
// dashboard fetched up to 1000 records across ALL sessions and pinned nothing,
// so it showed the element's empty state on any load where no capture session
// happened to be live — and even when it "worked", every session but the live
// one was unreachable.

describe('OyonDashboardRoom — session scoping', () => {
    function mockSessions(records) {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records, total: records.length });
            }
            return Promise.resolve({ modalities: [] });
        });
    }

    it('pins a session, without which the viewer renders nothing', async () => {
        mockSessions([record(1, 's1'), record(2, 's1')]);
        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(dashboardProps).toHaveBeenCalled());

        const last = dashboardProps.mock.calls.at(-1)[0];
        expect(last.sessionId).toBe('s1');
    });

    // The element shows ONE session, so feeding it a cross-session pool would
    // silently mislead: counts in the panels would not match the rows fed.
    it('feeds only the selected session, not the whole pool', async () => {
        mockSessions([
            record(1, 's1'),
            record(2, 's2'), record(3, 's2'), record(4, 's2'),
        ]);
        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(dashboardProps).toHaveBeenCalled());

        await waitFor(() => {
            const p = dashboardProps.mock.calls.at(-1)[0];
            // s2 is newest by window_end, so it is the default pick.
            expect(p.sessionId).toBe('s2');
            expect(p.records).toHaveLength(3);
            expect(p.records.every(r => r.session_id === 's2')).toBe(true);
        });
    });

    it('offers every session in the pool, newest first', async () => {
        mockSessions([record(1, 's1'), record(5, 's2')]);
        render(<OyonDashboardRoom onClose={() => {}} />);

        const select = await screen.findByRole('combobox');
        const options = [...select.querySelectorAll('option')].map(o => o.value);
        expect(options).toEqual(['s2', 's1']);
    });

    it('re-scopes the viewer when the educator picks another session', async () => {
        mockSessions([record(1, 's1'), record(5, 's2')]);
        render(<OyonDashboardRoom onClose={() => {}} />);

        const select = await screen.findByRole('combobox');
        await waitFor(() => expect(dashboardProps.mock.calls.at(-1)[0].sessionId).toBe('s2'));

        fireEvent.change(select, { target: { value: 's1' } });
        await waitFor(() => {
            const p = dashboardProps.mock.calls.at(-1)[0];
            expect(p.sessionId).toBe('s1');
            expect(p.records.every(r => r.session_id === 's1')).toBe(true);
        });
    });
});
