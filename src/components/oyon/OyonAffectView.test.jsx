// Tests for OyonAffectView + the pure affectAnalytics module — the native
// port of the <oyon-app> element's Analyze · Affect tab (KPI chips, capture
// timeline strip, valence×arousal plane, emotion distribution, dynamics
// timeline).

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import OyonAffectView from './OyonAffectView.jsx';
import {
    affectAnalytics, quadrantOf, dominantProbability, fallbackDynamics, stateOf,
} from './affectAnalytics.js';

// Hydrated emotion-record rows as the API delivers them: NEWEST-FIRST.
const rec = (over = {}) => ({
    id: over.id ?? Math.random().toString(36).slice(2),
    session_id: 's1',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    username: 'alice',
    dominant_emotion: 'happy',
    probabilities: { happy: 0.8, neutral: 0.2 },
    confidence: 0.8,
    valence: 0.4,
    arousal: 0.3,
    entropy: 0.2,
    missing_face_ratio: 0.1,
    dynamics: null,
    ...over,
});

const newestFirst = [
    rec({
        id: 'w2',
        window_start: '2026-07-02T08:00:10.000Z',
        window_end: '2026-07-02T08:00:20.000Z',
        dominant_emotion: 'sad',
        probabilities: { sad: 0.6, happy: 0.4 },
        valence: -0.4,
        arousal: -0.2,
        missing_face_ratio: 0.2,
        dynamics: { affect_speed: 0.12, instability_score: 0.5, phase_quadrant: 'negative-calm' },
    }),
    rec({ id: 'w1' }),
];

describe('quadrantOf', () => {
    it('assigns the four circumplex quadrants and nulls unmeasured affect', () => {
        expect(quadrantOf(0.5, 0.5)).toBe('positive-activated');
        expect(quadrantOf(0.5, -0.1)).toBe('positive-calm');
        expect(quadrantOf(-0.5, 0.5)).toBe('negative-activated');
        expect(quadrantOf(-0.5, -0.5)).toBe('negative-calm');
        // Boundary: zero counts as positive on both axes (port of phaseQuadrant).
        expect(quadrantOf(0, 0)).toBe('positive-activated');
        expect(quadrantOf(null, 0.2)).toBeNull();
        expect(quadrantOf(0.2, undefined)).toBeNull();
    });
});

describe('dominantProbability', () => {
    it('takes the max of the probabilities blob', () => {
        expect(dominantProbability(rec({ probabilities: { happy: 0.7, sad: 0.3 } }))).toBe(0.7);
    });
    it('falls back to the confidence scalar, then 0', () => {
        expect(dominantProbability(rec({ probabilities: null, confidence: 0.55 }))).toBe(0.55);
        expect(dominantProbability(rec({ probabilities: null, confidence: null }))).toBe(0);
    });
});

describe('stateOf', () => {
    it('lowercases and buckets missing labels as insufficient', () => {
        expect(stateOf(rec({ dominant_emotion: ' Happy ' }))).toBe('happy');
        expect(stateOf(rec({ dominant_emotion: null }))).toBe('insufficient');
        expect(stateOf(rec({ dominant_emotion: '' }))).toBe('insufficient');
    });
});

describe('fallbackDynamics', () => {
    it('derives affect speed from valence/arousal velocity across window_end', () => {
        const prev = rec({ window_end: '2026-07-02T08:00:10.000Z', valence: 0, arousal: 0 });
        const cur = rec({ window_end: '2026-07-02T08:00:20.000Z', valence: 0.4, arousal: 0.3 });
        const d = fallbackDynamics(cur, prev);
        // Δv/Δt = 0.04, Δa/Δt = 0.03 → hypot = 0.05
        expect(d.affect_speed).toBeCloseTo(0.05, 10);
        expect(d.instability_score).toBeGreaterThan(0);
        expect(d.instability_score).toBeLessThanOrEqual(1);
        expect(d.phase_quadrant).toBe('positive-activated');
    });
    it('nulls affect speed without a previous window but still scores instability', () => {
        const d = fallbackDynamics(rec(), null);
        expect(d.affect_speed).toBeNull();
        expect(typeof d.instability_score).toBe('number');
    });
});

describe('affectAnalytics', () => {
    it('summarizes the newest window and reverses into chronological series', () => {
        const { summary, timeline, plane, distribution, dynamics } = affectAnalytics(newestFirst);
        expect(summary.windows).toBe(2);
        expect(summary.latestState).toBe('sad');           // newest-first row 0
        expect(summary.latestQuality).toBeCloseTo(0.8, 10); // 1 − 0.2
        expect(summary.analyzedWindows).toBe(2);
        // Stored dynamics blob wins over the fallback.
        expect(summary.affectSpeed).toBeCloseTo(0.12, 10);
        expect(summary.instability).toBeCloseTo(0.5, 10);

        // Chronological: w1 (happy) then w2 (sad).
        expect(timeline.map((t) => t.emotion)).toEqual(['happy', 'sad']);
        expect(timeline[0].prob).toBeCloseTo(0.8, 10);
        expect(plane).toHaveLength(2);
        expect(plane[1].quadrant).toBe('negative-calm');
        expect(dynamics).toHaveLength(2);
        expect(dynamics[1].speed).toBeCloseTo(0.12, 10);

        expect(distribution).toEqual([
            { emotion: 'happy', count: 1 },
            { emotion: 'sad', count: 1 },
        ]);
    });

    it('computes fallback dynamics when the stored blob is absent', () => {
        const rows = [
            rec({
                id: 'b',
                window_end: '2026-07-02T08:00:20.000Z',
                valence: 0.4, arousal: 0.3, dynamics: null,
            }),
            rec({
                id: 'a',
                window_end: '2026-07-02T08:00:10.000Z',
                valence: 0, arousal: 0, dynamics: null,
            }),
        ];
        const { summary } = affectAnalytics(rows);
        expect(summary.affectSpeed).toBeCloseTo(0.05, 10);
        expect(summary.analyzedWindows).toBe(2);
    });

    it('handles an empty pool', () => {
        const { summary, timeline, plane, distribution, dynamics } = affectAnalytics([]);
        expect(summary.windows).toBe(0);
        expect(summary.latestState).toBeNull();
        expect(timeline).toEqual([]);
        expect(plane).toEqual([]);
        expect(distribution).toEqual([]);
        expect(dynamics).toEqual([]);
    });

    it('drops windows without finite valence/arousal from the plane only', () => {
        const rows = [rec({ valence: null, arousal: 0.2 })];
        const { plane, timeline } = affectAnalytics(rows);
        expect(plane).toEqual([]);
        expect(timeline).toHaveLength(1);
    });
});

describe('OyonAffectView', () => {
    it('renders the KPI chips and all four chart sections', () => {
        render(<OyonAffectView records={newestFirst} loading={false} />);
        expect(screen.getByText('Windows')).toBeInTheDocument();
        expect(screen.getByText('Latest state')).toBeInTheDocument();
        expect(screen.getAllByText('sad').length).toBeGreaterThan(0); // latest-state chip (label also appears in legends)
        expect(screen.getByText('Latest quality')).toBeInTheDocument();
        expect(screen.getByText('80%')).toBeInTheDocument();
        expect(screen.getAllByText('Affect speed').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Instability').length).toBeGreaterThan(0);

        expect(screen.getByText('Capture timeline')).toBeInTheDocument();
        expect(screen.getByText('Affect plane')).toBeInTheDocument();
        expect(screen.getByText('Emotion distribution')).toBeInTheDocument();
        expect(screen.getByText('Dynamics timeline')).toBeInTheDocument();

        expect(screen.getByRole('img', { name: 'Capture timeline' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Valence–arousal plane' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Dynamics timeline' })).toBeInTheDocument();
    });

    it('renders the co-occurrence network from emotions the same person showed', () => {
        // One person (alice) showing three emotions → three co-occurrence edges.
        const rows = [
            rec({ id: 'a1', user_id: 1, username: 'alice', dominant_emotion: 'happy' }),
            rec({ id: 'a2', user_id: 1, username: 'alice', dominant_emotion: 'sad' }),
            rec({ id: 'a3', user_id: 1, username: 'alice', dominant_emotion: 'neutral' }),
        ];
        render(<OyonAffectView records={rows} loading={false} />);
        expect(screen.getByText('Co-occurring emotions')).toBeInTheDocument();
        expect(screen.getByText('Model channels')).toBeInTheDocument();
        expect(screen.getByText('Dominant labels')).toBeInTheDocument();
        expect(screen.getByText('Linked pairs')).toBeInTheDocument();
        const bundle = screen.getByTestId('edge-bundling');
        expect(bundle).toBeInTheDocument();
        expect(within(bundle).getByText('happy')).toBeInTheDocument();
        expect(within(bundle).getByText('sad')).toBeInTheDocument();
        // happy↔sad, happy↔neutral, sad↔neutral = 3 edges.
        expect(bundle.querySelectorAll('[data-testid="edge-bundling-edges"] path')).toHaveLength(3);
    });

    it('shows the hint instead of the network when no emotions co-occur', () => {
        // Each person shows exactly one emotion → no shared pair.
        const rows = [
            rec({ id: 'a1', user_id: 1, dominant_emotion: 'happy' }),
            rec({ id: 'b1', user_id: 2, dominant_emotion: 'sad' }),
        ];
        render(<OyonAffectView records={rows} loading={false} />);
        expect(screen.getByText('Co-occurring emotions')).toBeInTheDocument();
        expect(screen.getByText(/no co-occurring emotions/i)).toBeInTheDocument();
        expect(screen.queryByTestId('edge-bundling')).not.toBeInTheDocument();
    });

    it('shows the empty state when there are no windows', () => {
        render(<OyonAffectView records={[]} loading={false} />);
        expect(screen.getByText(/No windows in the current selection/)).toBeInTheDocument();
    });

    it('shows the loading card while the first fetch is in flight', () => {
        render(<OyonAffectView records={[]} loading />);
        expect(screen.getByText(/Loading affect data/)).toBeInTheDocument();
    });

    it('explains a missing plane instead of drawing an empty SVG', () => {
        render(
            <OyonAffectView
                records={[rec({ valence: null, arousal: null })]}
                loading={false}
            />,
        );
        expect(screen.getByText(/No valence\/arousal samples/)).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'Valence–arousal plane' })).not.toBeInTheDocument();
    });
});
