// Regression lock for Bug 3 (16.5.2026 report): the "Available special
// tests" chips were inert <span>s. They must be buttons that perform the
// region's special examination, passing the chosen test name.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ExamTypeSelector from './ExamTypeSelector';

afterEach(cleanup);

describe('ExamTypeSelector — special tests are clickable (Bug 3)', () => {
    it('renders each special test as a button and reports the test name', () => {
        const onExamTypeSelect = vi.fn();
        // backLower carries specialTests in BODY_REGIONS.
        render(
            <ExamTypeSelector
                selectedRegion="backLower"
                selectedExamType={null}
                onExamTypeSelect={onExamTypeSelect}
            />,
        );

        const slr = screen.getByRole('button', { name: 'Straight leg raise' });
        expect(slr).toBeTruthy();
        fireEvent.click(slr);
        expect(onExamTypeSelect).toHaveBeenCalledWith('special', 'Straight leg raise');
    });

    it('also works through the posterior body-map alias id (Bug 2 + 3 together)', () => {
        const onExamTypeSelect = vi.fn();
        render(
            <ExamTypeSelector
                selectedRegion="lowerBack"
                selectedExamType={null}
                onExamTypeSelect={onExamTypeSelect}
            />,
        );
        // Alias resolves, so its special tests are present and clickable.
        const btn = screen.getByRole('button', { name: 'CVA tenderness' });
        fireEvent.click(btn);
        expect(onExamTypeSelect).toHaveBeenCalledWith('special', 'CVA tenderness');
    });
});
