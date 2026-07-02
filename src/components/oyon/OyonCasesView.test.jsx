// Tests for OyonCasesView — the per-case table (+ dominant-estimate DistBar)
// extracted from OyonLearningAnalyticsTab, now computing its rollups
// client-side from hydrated emotion-record rows.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import OyonCasesView from './OyonCasesView.jsx';
import { caseAggregates } from './recordAggregates.js';

const rec = (over = {}) => ({
    id: Math.random().toString(36).slice(2),
    session_id: 's1',
    user_id: 1,
    username: 'alice',
    case_id: 7,
    case_title_snapshot: 'Chest pain',
    case_category_snapshot: 'cardiology',
    window_start: '2026-07-02T08:00:00.000Z',
    dominant_emotion: 'happy',
    confidence: 0.8,
    valence: 0.4,
    ...over,
});

describe('OyonCasesView', () => {
    it('renders one aggregate row per case with the distribution bar', () => {
        render(
            <OyonCasesView
                records={[
                    rec(),
                    rec({ dominant_emotion: 'happy', user_id: 2, username: 'bob', session_id: 's2' }),
                    rec({ dominant_emotion: 'sad' }),
                    rec({ case_id: 8, case_title_snapshot: 'Sepsis', case_category_snapshot: 'infectious' }),
                ]}
            />,
        );
        expect(screen.getByText('Chest pain')).toBeInTheDocument();
        expect(screen.getByText('Sepsis')).toBeInTheDocument();
        expect(screen.getByText('cardiology')).toBeInTheDocument();
        // DistBar segments carry "label: count" titles.
        expect(screen.getByTitle('happy: 2')).toBeInTheDocument();
        expect(screen.getByTitle('sad: 1')).toBeInTheDocument();
    });

    it('shows the empty state without records', () => {
        render(<OyonCasesView records={[]} />);
        expect(screen.getByText(/No cases match the current filters/)).toBeInTheDocument();
    });
});

describe('caseAggregates', () => {
    it('counts distinct students/sessions/windows and builds the dominant distribution per case', () => {
        const agg = caseAggregates([
            rec({ valence: 0.2, confidence: 0.6 }),
            rec({ user_id: 2, username: 'bob', session_id: 's2', dominant_emotion: 'sad', valence: 0.6, confidence: 1.0 }),
            rec({ case_id: 8, case_title_snapshot: 'Sepsis' }),
        ]);
        expect(agg).toHaveLength(2);
        const chest = agg[0]; // sorted by window count desc
        expect(chest.case_title).toBe('Chest pain');
        expect(chest.window_count).toBe(2);
        expect(chest.students_count).toBe(2);
        expect(chest.sessions_count).toBe(2);
        expect(chest.dominant_estimate_distribution).toEqual({ happy: 1, sad: 1 });
        expect(chest.mean_valence).toBeCloseTo(0.4, 10);
        expect(chest.mean_confidence).toBeCloseTo(0.8, 10);
        expect(agg[1].case_title).toBe('Sepsis');
    });
});
