// Tests for OyonGazeView's layout — chiefly the "Gaze maps by screen"
// small-multiple grid: one ZoneBubbleMap per room carrying gaze windows,
// friendly room labels (chat → 'Patient (main)', consultant → 'Discussant',
// null → 'Unassigned'), per-student bubbles with stable colors. The numbers
// themselves are covered by gazeAnalytics.test.js.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import OyonGazeView from './OyonGazeView.jsx';

// Hydrated emotion-record rows as the API delivers them: NEWEST-FIRST.
const gazeRec = (over = {}) => ({
    session_id: 's1',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    username: 'alice',
    room: 'chat',
    dominant_emotion: 'neutral',
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
    gazeRec({ window_end: '2026-07-02T08:00:40.000Z', room: null, username: 'alice' }),
    gazeRec({ window_end: '2026-07-02T08:00:30.000Z', room: 'consultant', username: 'alice' }),
    gazeRec({ window_end: '2026-07-02T08:00:20.000Z', room: 'chat', username: 'bob' }),
    gazeRec({ window_end: '2026-07-02T08:00:10.000Z', room: 'chat', username: 'alice' }),
];

describe('OyonGazeView', () => {
    it('renders the stat chips and the standing sections', () => {
        render(<OyonGazeView records={RECORDS} loading={false} />);
        expect(screen.getByText('Gaze windows')).toBeInTheDocument();
        expect(screen.getAllByText('At patient').length).toBeGreaterThan(0); // chip + table header
        expect(screen.getByText('Attention targets')).toBeInTheDocument();
        expect(screen.getByText('Screen zones')).toBeInTheDocument();
        expect(screen.getByText('Gaze centroids')).toBeInTheDocument();
        expect(screen.getByText('Gaze by room')).toBeInTheDocument();
        expect(screen.getByText('Gaze log')).toBeInTheDocument();
    });

    it('renders one ZoneBubbleMap per room with gaze data, busiest room first', () => {
        render(<OyonGazeView records={RECORDS} loading={false} />);
        expect(screen.getByText('Gaze maps by screen')).toBeInTheDocument();
        const maps = screen.getAllByTestId('zone-bubble-map');
        expect(maps).toHaveLength(3); // chat, consultant, unassigned

        // Friendly labels, window counts, chat (2 windows) first.
        expect(maps[0]).toHaveTextContent('Patient (main) · 2 windows');
        expect(screen.getByText('Discussant · 1 window')).toBeInTheDocument();
        expect(screen.getByText('Unassigned · 1 window')).toBeInTheDocument();
        // No lab windows → no lab zone-bubble panel (scope to the maps, since
        // the new Location transition card lists "Lab" in its subtitle prose).
        expect(maps.some((m) => /Lab ·/.test(m.textContent))).toBe(false);
    });

    it('draws per-student bubbles in each room panel', () => {
        const { container } = render(<OyonGazeView records={RECORDS} loading={false} />);
        const bubbles = container.querySelectorAll('[data-testid="zone-bubble"]');
        // chat: alice+bob × 2 zones = 4, consultant: alice × 2, unassigned: alice × 2.
        expect(bubbles).toHaveLength(8);
        const titles = [...bubbles].map((b) => b.querySelector('title').textContent);
        expect(titles).toContain('alice · middle_center · 70%');
        expect(titles).toContain('bob · top_center · 30%');
        // Stable per-student colors: every alice bubble shares one fill.
        const aliceFills = new Set([...bubbles]
            .filter((b) => b.querySelector('title').textContent.startsWith('alice'))
            .map((b) => b.getAttribute('fill')));
        expect(aliceFills.size).toBe(1);
    });

    it('omits the per-screen section (not an empty shell) without room maps', () => {
        // Gaze windows exist but carry no zone proportions → no panels.
        const noZones = [gazeRec({ gaze: { n_points: 50, duration_ms: 10000 } })];
        render(<OyonGazeView records={noZones} loading={false} />);
        expect(screen.queryByText('Gaze maps by screen')).not.toBeInTheDocument();
        expect(screen.queryAllByTestId('zone-bubble-map')).toHaveLength(0);
    });

    it('shows the empty state when no records carry gaze', () => {
        render(<OyonGazeView records={[]} loading={false} />);
        expect(screen.getByText(/No gaze data in the current selection/)).toBeInTheDocument();
    });
});
