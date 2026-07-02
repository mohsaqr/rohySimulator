// Tests for OyonWindowsView — the per-window data table extracted from
// OyonLearningAnalyticsTab, presentational over hydrated emotion-record rows
// with CLIENT-SIDE quality controls (min-confidence, max-missing-face,
// dominant multi-select) and CSV/JSON export of the filtered rows.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import OyonWindowsView from './OyonWindowsView.jsx';
import { filterRecords } from './recordAggregates.js';
import { buildRecordsCsv, RECORD_CSV_HEADERS } from './emotionLogShared.js';

const rec = (over = {}) => ({
    id: over.id ?? Math.random().toString(36).slice(2),
    session_id: 's1',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    username: 'alice',
    user_role: 'student',
    case_id: 7,
    case_title_snapshot: 'Chest pain',
    dominant_emotion: 'happy',
    confidence: 0.9,
    valence: 0.4,
    arousal: 0.3,
    entropy: 0.2,
    valid_frames: 120,
    missing_face_ratio: 0.05,
    model_name: 'hse',
    probabilities: { happy: 0.9, neutral: 0.1 },
    ...over,
});

const alice = () => rec({ id: 'w-alice' });
const bob = () => rec({
    id: 'w-bob',
    username: 'bob',
    dominant_emotion: 'sad',
    confidence: 0.2,
    missing_face_ratio: 0.5,
});

describe('OyonWindowsView', () => {
    it('renders one table row per record with the count line', () => {
        render(<OyonWindowsView records={[alice(), bob()]} loading={false} />);
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getByText('2 of 2 windows')).toBeInTheDocument();
        // Scoped to the table — the labels also exist as filter pills.
        const table = screen.getByRole('table');
        expect(within(table).getByText('happy')).toBeInTheDocument();
        expect(within(table).getByText('sad')).toBeInTheDocument();
    });

    it('min-confidence slider filters low-confidence rows client-side', () => {
        render(<OyonWindowsView records={[alice(), bob()]} loading={false} />);
        fireEvent.change(screen.getByRole('slider', { name: 'Min confidence' }), {
            target: { value: '0.5' },
        });
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.queryByText('bob')).not.toBeInTheDocument();
        expect(screen.getByText('1 of 2 windows')).toBeInTheDocument();
    });

    it('max missing-face slider filters high-missingness rows client-side', () => {
        render(<OyonWindowsView records={[alice(), bob()]} loading={false} />);
        fireEvent.change(screen.getByRole('slider', { name: 'Max missing-face' }), {
            target: { value: '0.2' },
        });
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.queryByText('bob')).not.toBeInTheDocument();
    });

    it('dominant-emotion multi-select keeps only the selected labels', () => {
        render(<OyonWindowsView records={[alice(), bob()]} loading={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'sad' }));
        expect(screen.queryByText('alice')).not.toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        // Multi-select: adding a second label brings alice back.
        fireEvent.click(screen.getByRole('button', { name: 'happy' }));
        expect(screen.getByText('alice')).toBeInTheDocument();
        // Toggle off restores the unfiltered pool.
        fireEvent.click(screen.getByRole('button', { name: 'sad' }));
        fireEvent.click(screen.getByRole('button', { name: 'happy' }));
        expect(screen.getByText('2 of 2 windows')).toBeInTheDocument();
    });

    it('shows the empty state when the filters exclude everything', () => {
        render(<OyonWindowsView records={[bob()]} loading={false} />);
        fireEvent.change(screen.getByRole('slider', { name: 'Min confidence' }), {
            target: { value: '0.95' },
        });
        expect(screen.getByText(/No windows match the current quality filters/)).toBeInTheDocument();
    });

    it('expands a row into the probability-map detail', () => {
        render(<OyonWindowsView records={[alice()]} loading={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'detail' }));
        expect(screen.getByText(/Probability map \(estimates\)/)).toBeInTheDocument();
        expect(screen.getByText('90.0%')).toBeInTheDocument();
    });
});

describe('filterRecords', () => {
    it('active numeric constraints exclude records missing the field', () => {
        const noConf = rec({ confidence: null });
        expect(filterRecords([noConf], { minConfidence: 0.1, maxMissingFace: 1, dominant: [] })).toEqual([]);
        expect(filterRecords([noConf], { minConfidence: 0, maxMissingFace: 1, dominant: [] })).toHaveLength(1);
    });
});

describe('CSV export helper', () => {
    it('emits the expected header row and one line per record', () => {
        const csv = buildRecordsCsv([alice()]);
        const lines = csv.split('\n');
        expect(lines[0]).toBe(RECORD_CSV_HEADERS.join(','));
        expect(lines[0]).toBe(
            'window_start,window_end,session_id,user_id,username,user_role,'
            + 'student_name_snapshot,case_id,case_title_snapshot,case_category_snapshot,'
            + 'dominant_expression_estimate,confidence,valence_estimate,arousal_estimate,'
            + 'entropy,valid_frames,missing_face_ratio,'
            + 'model_name,model_version,capture_mode,capture_status,'
            + 'consent_version,consent_recorded_at'
        );
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('alice');
        expect(lines[1]).toContain('happy');
    });

    it('quotes cells containing commas or quotes', () => {
        const csv = buildRecordsCsv([rec({ case_title_snapshot: 'Chest pain, severe "crushing"' })]);
        expect(csv).toContain('"Chest pain, severe ""crushing"""');
    });
});
