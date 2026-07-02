// Tests for OyonCompareView + the pure compareAnalytics module — the native
// port of the <oyon-app> element's Analyze · Comparison tab (side-by-side
// per-group timelines + distributions, the single-session time-slice mode)
// with the Rohy compare-by toggle (student | session | case) and per-entity
// summary table.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import OyonCompareView from './OyonCompareView.jsx';
import {
    compareRecords, entityKeyOf, splitIntoSlices, groupStats, distributionOf,
} from './compareAnalytics.js';

// Hydrated emotion-record rows as the API delivers them: NEWEST-FIRST.
const rec = (over = {}) => ({
    id: over.id ?? Math.random().toString(36).slice(2),
    session_id: 's1',
    user_id: 1,
    username: 'alice',
    student_name_snapshot: 'Alice A',
    case_id: 7,
    case_title_snapshot: 'Chest pain',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    dominant_emotion: 'happy',
    probabilities: { happy: 0.8, neutral: 0.2 },
    confidence: 0.8,
    valence: 0.4,
    arousal: 0.2,
    engagement: { focus_score: 0.6 },
    ...over,
});

const at = (sec) => `2026-07-02T08:00:${String(sec).padStart(2, '0')}.000Z`;

// Two sessions / two students / two cases, newest-first.
const twoEntities = [
    rec({ id: 'w3', session_id: 's2', username: 'bob', student_name_snapshot: 'Bob B', case_id: 8, case_title_snapshot: 'Sepsis', window_start: at(30), dominant_emotion: 'sad', valence: -0.4 }),
    rec({ id: 'w2', session_id: 's1', window_start: at(20) }),
    rec({ id: 'w1', session_id: 's1', window_start: at(10), valence: 0.2 }),
];

describe('entityKeyOf', () => {
    it('resolves each compare-by dimension with fallbacks', () => {
        const r = rec();
        expect(entityKeyOf(r, 'session')).toBe('s1');
        expect(entityKeyOf(r, 'student')).toBe('alice');
        expect(entityKeyOf(r, 'case')).toBe('Chest pain');
        expect(entityKeyOf(rec({ username: null }), 'student')).toBe('Alice A');
        expect(entityKeyOf(rec({ username: null, student_name_snapshot: null }), 'student')).toBe('user 1');
        expect(entityKeyOf(rec({ username: null, student_name_snapshot: null, user_id: null }), 'student')).toBe('(unknown)');
        expect(entityKeyOf(rec({ case_title_snapshot: null }), 'case')).toBe('case 7');
        expect(entityKeyOf(rec({ session_id: null }), 'session')).toBe('(unknown)');
    });
});

describe('splitIntoSlices', () => {
    it('splits into ceil-sized contiguous slices, dropping empty ones', () => {
        const ws = [1, 2, 3, 4, 5].map((n) => ({ n }));
        const three = splitIntoSlices(ws, 3);
        expect(three.map((s) => s.length)).toEqual([2, 2, 1]);
        expect(three[0].map((w) => w.n)).toEqual([1, 2]);
        // 5 windows into 4 parts of ceil(5/4)=2 → only 3 non-empty slices.
        expect(splitIntoSlices(ws, 4).map((s) => s.length)).toEqual([2, 2, 1]);
        expect(splitIntoSlices(ws, 1)).toHaveLength(1);
        expect(splitIntoSlices([], 3)).toEqual([]);
    });
});

describe('groupStats / distributionOf', () => {
    it('computes count, dominant share and null-honest means', () => {
        const ws = [
            rec({ dominant_emotion: 'happy', valence: 0.2, arousal: null, engagement: null }),
            rec({ dominant_emotion: 'happy', valence: 0.4, arousal: 0.2, engagement: { focus_score: 0.5 } }),
            rec({ dominant_emotion: 'sad', valence: null, arousal: 0.4, engagement: { focus_score: 0.7 } }),
        ];
        const s = groupStats(ws);
        expect(s.windowCount).toBe(3);
        expect(s.dominantEmotion).toBe('happy');
        expect(s.dominantShare).toBeCloseTo(2 / 3, 10);
        expect(s.meanValence).toBeCloseTo(0.3, 10);   // nulls excluded
        expect(s.meanArousal).toBeCloseTo(0.3, 10);
        expect(s.meanFocus).toBeCloseTo(0.6, 10);

        expect(distributionOf(ws)).toEqual([
            { emotion: 'happy', count: 2, share: 2 / 3 },
            { emotion: 'sad', count: 1, share: 1 / 3 },
        ]);
    });

    it('handles an empty group', () => {
        const s = groupStats([]);
        expect(s.windowCount).toBe(0);
        expect(s.dominantEmotion).toBeNull();
        expect(s.meanValence).toBeNull();
        expect(distributionOf([])).toEqual([]);
    });
});

describe('compareRecords', () => {
    it('groups by session newest-activity-first with per-group stats', () => {
        const cmp = compareRecords(twoEntities, { by: 'session' });
        expect(cmp.mode).toBe('entities');
        expect(cmp.totalWindows).toBe(3);
        expect(cmp.groups.map((g) => g.id)).toEqual(['s2', 's1']); // s2 is newest
        const s1 = cmp.groups.find((g) => g.id === 's1');
        expect(s1.stats.windowCount).toBe(2);
        expect(s1.stats.meanValence).toBeCloseTo(0.3, 10);
        // Group timelines are chronological.
        expect(s1.windows.map((w) => w.id)).toEqual(['w1', 'w2']);
        expect(s1.timeline).toHaveLength(2);
    });

    it('groups by student and by case', () => {
        expect(compareRecords(twoEntities, { by: 'student' }).groups.map((g) => g.id))
            .toEqual(['bob', 'alice']);
        expect(compareRecords(twoEntities, { by: 'case' }).groups.map((g) => g.id))
            .toEqual(['Sepsis', 'Chest pain']);
    });

    it('splits a single session into time slices (element mode 2), honoring the slices option', () => {
        const single = [40, 30, 20, 10, 0].map((sec, i) =>
            rec({ id: `w${5 - i}`, window_start: at(sec) }));
        const two = compareRecords(single, { by: 'session' });
        expect(two.mode).toBe('slices');
        expect(two.groups.map((g) => g.stats.windowCount)).toEqual([3, 2]);
        expect(two.groups[0].label).toContain('slice 1/2');
        // First slice holds the chronologically earliest windows.
        expect(two.groups[0].windows.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);

        const three = compareRecords(single, { by: 'session', slices: 3 });
        expect(three.groups.map((g) => g.stats.windowCount)).toEqual([2, 2, 1]);
        // The element clamps slices to 2–6.
        expect(compareRecords(single, { by: 'session', slices: 99 }).groups.length).toBeLessThanOrEqual(6);
    });

    it('does not slice multi-session pools or single-window sessions', () => {
        expect(compareRecords(twoEntities, { by: 'session' }).mode).toBe('entities');
        expect(compareRecords([rec()], { by: 'session' }).mode).toBe('entities');
        expect(compareRecords([], {}).groups).toEqual([]);
    });
});

describe('OyonCompareView', () => {
    it('renders the entity table and per-group charts for a two-session pool', () => {
        render(<OyonCompareView records={twoEntities} loading={false} />);
        expect(screen.getByText(/Comparing/)).toBeInTheDocument();
        expect(screen.getByText(/3 windows total/)).toBeInTheDocument();

        const table = screen.getByRole('table');
        expect(within(table).getByText('s1')).toBeInTheDocument();
        expect(within(table).getByText('s2')).toBeInTheDocument();

        expect(screen.getByText('Capture timelines')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Emotion timeline — s1' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Emotion timeline — s2' })).toBeInTheDocument();
        expect(screen.getByText('Emotion distribution')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Export/ })).toBeEnabled();
    });

    it('switches grouping with the compare-by toggle', () => {
        render(<OyonCompareView records={twoEntities} loading={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Student' }));
        const table = screen.getByRole('table');
        expect(within(table).getByText('alice')).toBeInTheDocument();
        expect(within(table).getByText('bob')).toBeInTheDocument();
        expect(within(table).queryByText('s1')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Case' }));
        expect(within(screen.getByRole('table')).getByText('Sepsis')).toBeInTheDocument();
    });

    it('falls back to time slices for a single session and honors the slices select', () => {
        const single = [40, 30, 20, 10, 0].map((sec, i) => rec({ id: `w${i}`, window_start: at(sec) }));
        render(<OyonCompareView records={single} loading={false} />);
        expect(screen.getByText(/Single session — split into/)).toBeInTheDocument();
        expect(screen.getAllByText(/s1 · slice 1\/2/).length).toBeGreaterThan(0);

        fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } });
        expect(screen.getAllByText(/s1 · slice 3\/3/).length).toBeGreaterThan(0);
    });

    it('shows the not-enough state but keeps the toggle usable', () => {
        render(<OyonCompareView records={[rec()]} loading={false} />);
        expect(screen.getByText(/Not enough to compare/)).toBeInTheDocument();
        // The toggle is still there so the user can switch dimension.
        expect(screen.getByRole('button', { name: 'Student' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
    });

    it('shows the empty state when there are no windows', () => {
        render(<OyonCompareView records={[]} loading={false} />);
        expect(screen.getByText(/No windows in the current selection/)).toBeInTheDocument();
    });

    it('shows the loading card while the first fetch is in flight', () => {
        render(<OyonCompareView records={[]} loading />);
        expect(screen.getByText(/Loading comparison data/)).toBeInTheDocument();
    });
});
