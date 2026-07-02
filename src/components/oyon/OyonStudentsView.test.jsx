// Tests for OyonStudentsView — the per-student aggregate table extracted
// from OyonLearningAnalyticsTab, now computing its rollups client-side from
// hydrated emotion-record rows.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import OyonStudentsView from './OyonStudentsView.jsx';
import { studentAggregates } from './recordAggregates.js';

const rec = (over = {}) => ({
    id: Math.random().toString(36).slice(2),
    session_id: 's1',
    user_id: 1,
    username: 'alice',
    user_role: 'student',
    case_id: 7,
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    dominant_emotion: 'happy',
    confidence: 0.8,
    valence: 0.4,
    arousal: 0.3,
    missing_face_ratio: 0.05,
    ...over,
});

describe('OyonStudentsView', () => {
    it('renders one aggregate row per student', () => {
        render(
            <OyonStudentsView
                records={[
                    rec(),
                    rec({ session_id: 's2', case_id: 8 }),
                    rec({ user_id: 2, username: 'bob', dominant_emotion: 'sad', confidence: 0.2, missing_face_ratio: 0.5 }),
                ]}
            />,
        );
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        // Quality verdicts from the client-side means.
        expect(screen.getByText('good signal')).toBeInTheDocument();
        expect(screen.getByText('low signal')).toBeInTheDocument();
    });

    it('shows the empty state without records', () => {
        render(<OyonStudentsView records={[]} />);
        expect(screen.getByText(/No students match the current filters/)).toBeInTheDocument();
    });
});

describe('studentAggregates', () => {
    it('counts distinct sessions/cases/windows and the top dominant estimate per student', () => {
        const agg = studentAggregates([
            rec({ valence: 0.2, confidence: 0.6 }),
            rec({ session_id: 's2', case_id: 8, dominant_emotion: 'neutral', valence: 0.6, confidence: 1.0 }),
            rec({ session_id: 's2', dominant_emotion: 'happy' }),
            rec({ user_id: 2, username: 'bob' }),
        ]);
        expect(agg).toHaveLength(2);
        const alice = agg[0]; // sorted by window count desc
        expect(alice.username).toBe('alice');
        expect(alice.window_count).toBe(3);
        expect(alice.sessions_count).toBe(2);
        expect(alice.cases_count).toBe(2);
        expect(alice.top_dominant_estimate).toBe('happy');
        expect(alice.mean_valence).toBeCloseTo((0.2 + 0.6 + 0.4) / 3, 10);
        expect(alice.mean_confidence).toBeCloseTo((0.6 + 1.0 + 0.8) / 3, 10);
        expect(alice.first_window).toBe('2026-07-02T08:00:00.000Z');
        expect(agg[1].username).toBe('bob');
        expect(agg[1].window_count).toBe(1);
    });

    it('groups anonymised rows (no user_id) by their label, skipping non-finite means', () => {
        const agg = studentAggregates([
            rec({ user_id: null, username: null, student_name_snapshot: 'anon-a', valence: null }),
            rec({ user_id: null, username: null, student_name_snapshot: 'anon-a', valence: 0.5 }),
        ]);
        expect(agg).toHaveLength(1);
        expect(agg[0].student_label).toBe('anon-a');
        expect(agg[0].mean_valence).toBeCloseTo(0.5, 10);
    });
});
