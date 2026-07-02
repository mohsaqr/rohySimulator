// Smoke test — DayHourMatrix renders jittered per-student bubbles, the
// Heatmap|Bubbles toggle switches marks, and window paging (◀ / All)
// filters events to a 7-day Sunday-snapped window.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DayHourMatrix from './DayHourMatrix';

const TUE = new Date(2026, 0, 6, 14, 0).getTime();       // Tue 6 Jan 2026 (week of Sun 4 Jan)
const PREV_TUE = new Date(2025, 11, 30, 9, 0).getTime(); // Tue 30 Dec 2025 (week of Sun 28 Dec)
const EVENTS = [
    { ts: TUE, student: 'alice', state: 'read' },
    { ts: TUE, student: 'bob', state: 'write' },
    { ts: PREV_TUE, student: 'alice', state: 'read' },
];
const COLOR_MAP = { read: '#4e79a7', write: '#e15759' };

describe('DayHourMatrix', () => {
    it('renders one bubble per student per cell plus the state legend', () => {
        const { container } = render(<DayHourMatrix events={EVENTS} colorMap={COLOR_MAP} />);
        // Tue 14h holds alice + bob; Tue 9h (prev week, All time) holds alice.
        expect(container.querySelectorAll('[data-testid="bubble"]')).toHaveLength(3);
        expect(screen.getByText('read')).toBeInTheDocument();
        expect(screen.getByText('write')).toBeInTheDocument();
    });

    it('toggles between bubbles and heatmap marks', () => {
        const { container } = render(<DayHourMatrix events={EVENTS} colorMap={COLOR_MAP} />);
        fireEvent.click(screen.getByRole('button', { name: 'Heatmap' }));
        expect(container.querySelectorAll('[data-testid^="heat-cell-"]')).toHaveLength(2);
        expect(container.querySelectorAll('[data-testid="bubble"]')).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Bubbles' }));
        expect(container.querySelectorAll('[data-testid="bubble"]')).toHaveLength(3);
    });

    it('pages 7-day windows with ◀ and All shows everything again', () => {
        const { container } = render(<DayHourMatrix events={EVENTS} colorMap={COLOR_MAP} />);
        const bubbles = () => container.querySelectorAll('[data-testid="bubble"]').length;

        expect(screen.getByTestId('nav-label')).toHaveTextContent('All time');
        // First ◀ snaps to the most recent week with data (4–10 Jan 2026).
        fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
        expect(screen.getByTestId('nav-label')).toHaveTextContent('4–10 Jan 2026');
        expect(bubbles()).toBe(2);
        // Second ◀ steps back one week (28 Dec 2025 – 3 Jan 2026).
        fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
        expect(screen.getByTestId('nav-label')).toHaveTextContent('28 Dec – 3 Jan 2026');
        expect(bubbles()).toBe(1);
        // All restores the full range.
        fireEvent.click(screen.getByRole('button', { name: 'All' }));
        expect(screen.getByTestId('nav-label')).toHaveTextContent('All time');
        expect(bubbles()).toBe(3);
    });
});
