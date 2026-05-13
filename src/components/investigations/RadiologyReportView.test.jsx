// Contract for RadiologyReportView — same embed-vs-modal close
// contract as LabReportView, plus image rendering and mark-as-viewed
// side effects.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const apiPut = vi.fn(() => Promise.resolve({}));
vi.mock('../../services/apiClient', () => ({ apiPut: (...a) => apiPut(...a) }));

const elicited = vi.fn();
vi.mock('../../services/PatientRecord', () => ({
    usePatientRecord: () => ({ elicited, ordered: vi.fn() }),
}));

import RadiologyReportView from './RadiologyReportView';

const baseResult = {
    id: 81,
    test_name: 'CT Head without contrast',
    modality: 'CT',
    image_url: 'https://example.test/ct-head.jpg',
    result_data: {
        findings: 'No acute hemorrhage.',
        interpretation: 'Normal CT of the head.',
        body_region: 'Head',
    },
    available_at: '2026-05-13T10:00:00Z',
    viewed_at: null,
};

beforeEach(() => {
    apiPut.mockClear();
    elicited.mockClear();
});
afterEach(() => cleanup());

describe('RadiologyReportView — embed vs modal close affordances', () => {
    it('renders Close + X when onClose is provided', () => {
        render(<RadiologyReportView result={baseResult} patientInfo={{}} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Close/ })).toBeTruthy();
    });

    it('hides both close affordances when onClose is omitted', () => {
        render(<RadiologyReportView result={baseResult} patientInfo={{}} />);
        expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
    });
});

describe('RadiologyReportView — content', () => {
    it('renders the image when image_url is present', () => {
        render(<RadiologyReportView result={baseResult} patientInfo={{}} />);
        const img = screen.getByAltText('CT Head without contrast');
        expect(img.getAttribute('src')).toBe('https://example.test/ct-head.jpg');
    });

    it('renders the Impression panel with the interpretation text', () => {
        render(<RadiologyReportView result={baseResult} patientInfo={{}} />);
        expect(screen.getByText('Normal CT of the head.')).toBeTruthy();
    });

    it('parses result_data when it arrives as a JSON string', () => {
        const result = {
            ...baseResult,
            result_data: JSON.stringify({
                findings: 'parsed findings',
                interpretation: 'parsed interpretation',
            }),
        };
        render(<RadiologyReportView result={result} patientInfo={{}} />);
        expect(screen.getByText('parsed interpretation')).toBeTruthy();
    });
});

describe('RadiologyReportView — side effects on mount', () => {
    it('marks the result as viewed', async () => {
        render(<RadiologyReportView result={baseResult} patientInfo={{}} />);
        await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/orders/81/view', { room: 'radiology' }));
    });

    it('reports has_image=true to PatientRecord when image_url is present', async () => {
        render(<RadiologyReportView result={baseResult} patientInfo={{}} />);
        await waitFor(() => expect(elicited).toHaveBeenCalled());
        const meta = elicited.mock.calls[0][3];
        expect(meta.has_image).toBe(true);
    });
});
