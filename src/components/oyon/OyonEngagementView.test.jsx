// Tests for OyonEngagementView + the engagement-view helpers added to
// engagementAnalytics.js — the native port of the <oyon-app> element's
// Analyze · Engagement tab (summary chips incl. gaze entropy with the
// element's focus tones, and the focus/openness timeline over the pool).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import OyonEngagementView from './OyonEngagementView.jsx';
import { focusTone, meanGazeEntropy } from './engagementAnalytics.js';

// Hydrated emotion-record rows as the API delivers them: NEWEST-FIRST.
const rec = (over = {}) => ({
    id: over.id ?? Math.random().toString(36).slice(2),
    session_id: 's1',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    dominant_emotion: 'happy',
    missing_face_ratio: 0.1,
    engagement: {
        focus_score: 0.7,
        eye_openness_mean: 0.8,
        blink_rate_hz: 0.25,
        gaze_entropy: 1.2,
    },
    gaze: null,
    ...over,
});

describe('focusTone', () => {
    it('applies the element thresholds: >0.6 ok, >0.4 warn, else bad', () => {
        expect(focusTone(0.7)).toBe('ok');
        expect(focusTone(0.61)).toBe('ok');
        expect(focusTone(0.6)).toBe('warn');
        expect(focusTone(0.5)).toBe('warn');
        expect(focusTone(0.4)).toBe('bad');
        expect(focusTone(0.1)).toBe('bad');
        expect(focusTone(null)).toBeNull();
        expect(focusTone(undefined)).toBeNull();
    });
});

describe('meanGazeEntropy', () => {
    it('averages only the windows carrying gaze_entropy (null ≠ 0)', () => {
        const rows = [
            rec({ engagement: { gaze_entropy: 2 } }),
            rec({ engagement: { gaze_entropy: 1 } }),
            rec({ engagement: { focus_score: 0.5 } }), // no entropy → excluded
            rec({ engagement: null }),
        ];
        expect(meanGazeEntropy(rows)).toBeCloseTo(1.5, 10);
        expect(meanGazeEntropy([rec({ engagement: null })])).toBeNull();
        expect(meanGazeEntropy([])).toBeNull();
    });
});

describe('OyonEngagementView', () => {
    it('renders the element summary chips including mean entropy', () => {
        render(<OyonEngagementView records={[rec(), rec({ id: 'w2' })]} loading={false} />);
        expect(screen.getByText('Windows')).toBeInTheDocument();
        expect(screen.getByText('Engagement windows')).toBeInTheDocument();
        expect(screen.getByText('2 / 2')).toBeInTheDocument();
        expect(screen.getByText('Mean focus')).toBeInTheDocument();
        expect(screen.getByText('0.70')).toBeInTheDocument();
        expect(screen.getByText('Mean blink')).toBeInTheDocument();
        expect(screen.getByText('0.25 Hz')).toBeInTheDocument();
        expect(screen.getByText('Mean openness')).toBeInTheDocument();
        expect(screen.getByText('Mean entropy')).toBeInTheDocument();
        expect(screen.getByText('1.20')).toBeInTheDocument();
        // Timeline SVG + coverage annotation.
        expect(screen.getByRole('img', { name: 'Engagement timeline' })).toBeInTheDocument();
        expect(screen.getByText('2/2 windows with engagement')).toBeInTheDocument();
    });

    it('adds the concatenation caveat only for multi-session pools', () => {
        const twoSessions = [rec({ session_id: 's2' }), rec({ session_id: 's1' })];
        const { rerender } = render(<OyonEngagementView records={twoSessions} loading={false} />);
        expect(screen.getByText(/concatenated\s+chronologically/)).toBeInTheDocument();

        rerender(<OyonEngagementView records={[rec(), rec({ id: 'w2' })]} loading={false} />);
        expect(screen.queryByText(/concatenated\s+chronologically/)).not.toBeInTheDocument();
    });

    it('shows the empty state when no window carries an engagement block', () => {
        render(<OyonEngagementView records={[rec({ engagement: null })]} loading={false} />);
        expect(screen.getByText(/No engagement data in the current selection/)).toBeInTheDocument();
    });

    it('shows the loading card while the first fetch is in flight', () => {
        render(<OyonEngagementView records={[]} loading />);
        expect(screen.getByText(/Loading engagement data/)).toBeInTheDocument();
    });
});
