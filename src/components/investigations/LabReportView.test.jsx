// Contract for LabReportView — the embed-or-modal lab report renderer.
// Two things matter for the new screen:
//   1. With `onClose`, the X + Close buttons are shown (modal usage).
//   2. Without `onClose`, both close buttons disappear (embed usage
//      inside InvestigationsScreen, where the topbar's Back is the
//      canonical exit).
// Also verify the side effects we moved here from the old modal:
//   3. mark-as-viewed PUT fires for unviewed results.
//   4. PatientRecord.elicited is called with abnormal=true when the
//      value is outside the reference range.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const apiPut = vi.fn(() => Promise.resolve({}));
vi.mock('../../services/apiClient', () => ({ apiPut: (...a) => apiPut(...a) }));

const elicited = vi.fn();
vi.mock('../../services/PatientRecord', () => ({
    usePatientRecord: () => ({ elicited, ordered: vi.fn() }),
}));

import LabReportView from './LabReportView';

const baseResult = {
    order_id: 42,
    test_name: 'Sodium',
    test_group: 'Electrolytes',
    current_value: 148,
    unit: 'mmol/L',
    min_value: 135,
    max_value: 145,
    available_at: '2026-05-13T10:00:00Z',
    viewed_at: null,
};

beforeEach(() => {
    apiPut.mockClear();
    elicited.mockClear();
});
afterEach(() => cleanup());

describe('LabReportView — embed vs modal close affordances', () => {
    it('renders the X + Close buttons when onClose is provided', () => {
        render(<LabReportView result={baseResult} patientInfo={{}} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Close/ })).toBeTruthy();
    });

    it('hides both close affordances when onClose is omitted', () => {
        render(<LabReportView result={baseResult} patientInfo={{}} />);
        expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
        // The X button has no accessible name — assert via the Print
        // button as a sentinel that the footer still rendered.
        expect(screen.getByRole('button', { name: /Print Report/ })).toBeTruthy();
    });
});

describe('LabReportView — side effects on mount', () => {
    it('marks the result as viewed when it is not already viewed', async () => {
        render(<LabReportView result={baseResult} patientInfo={{}} />);
        await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/orders/42/view'));
    });

    it('does not mark already-viewed results', () => {
        render(<LabReportView result={{ ...baseResult, viewed_at: '2026-05-13T10:01:00Z' }} patientInfo={{}} />);
        expect(apiPut).not.toHaveBeenCalled();
    });

    it('reports abnormal=true to PatientRecord when value is above reference', async () => {
        render(<LabReportView result={baseResult} patientInfo={{}} />);
        await waitFor(() => expect(elicited).toHaveBeenCalled());
        const [, , isAbnormal] = elicited.mock.calls[0];
        expect(isAbnormal).toBe(true);
    });

    it('reports abnormal=false when value is in range', async () => {
        render(<LabReportView result={{ ...baseResult, current_value: 140 }} patientInfo={{}} />);
        await waitFor(() => expect(elicited).toHaveBeenCalled());
        const [, , isAbnormal] = elicited.mock.calls[0];
        expect(isAbnormal).toBe(false);
    });
});
