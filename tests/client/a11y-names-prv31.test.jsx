// Regression lock: icon buttons without names, form fields labelled only by placeholder or by a detached <label>, modals without dialog semantics or Escape, and an off-canvas drawer that kept Tab stops (QA 2026-10-04, PRV-31)
//
// Each assertion queries by ROLE and accessible NAME — what a screen reader
// user navigates by — so a control that only looks labelled fails.
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import renderWithProviders from '../utils/renderWithProviders.jsx';
import InvestigationCatalogue from '../../src/components/investigations/InvestigationCatalogue.jsx';
import TreatmentPanel from '../../src/components/treatments/TreatmentPanel.jsx';
import CaseSummaryModal from '../../src/components/discussion/CaseSummaryModal.jsx';

vi.mock('../../src/services/PatientRecord', () => ({
    usePatientRecord: () => ({ ordered: vi.fn(), administered: vi.fn(), noted: vi.fn(), changed: vi.fn() }),
}));

const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
let fetchSpy;
beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('/available-treatments')) {
            return Promise.resolve(json({
                treatments: {
                    medication: [
                        { id: 1, treatment_type: 'medication', treatment_name: 'Aspirin', route: 'PO', is_available: 1 },
                        { id: 2, treatment_type: 'medication', treatment_name: 'Morphine', route: 'IV', is_available: 1,
                          hr_effect: -5, bp_sys_effect: -10, bp_dia_effect: -5, rr_effect: -4, spo2_effect: -2,
                          dose_dependent: 1, base_dose: 2, base_dose_unit: 'mg', max_effect_multiplier: 2, onset_minutes: 3, peak_minutes: 15 },
                    ],
                    iv_fluid: [], oxygen: [], nursing: [],
                },
                config: {},
            }));
        }
        if (u.includes('/treatment-orders')) return Promise.resolve(json({ orders: [] }));
        return Promise.resolve(json({}));
    });
});
afterEach(() => fetchSpy.mockRestore());

function LabCatalogue() {
    const [groupFilter, setGroupFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    return (
        <InvestigationCatalogue
            kind="lab"
            theme={{ kindIcon: () => null, accentText: '', accentBg: '', accentRow: '', accentRail: '', accentChip: '' }}
            items={[{ id: 'trop', test_name: 'Troponin I', test_group: 'Cardiac', turnaround_minutes: 30 }]}
            groups={['Cardiac']}
            orders={[]}
            selectedIds={[]}
            onToggleSelect={vi.fn()}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            groupFilter={groupFilter}
            onGroupFilterChange={setGroupFilter}
            loading={false}
            onSubmit={vi.fn()}
        />
    );
}

describe('PRV-31 accessible names', () => {
    it('lab search and group filter are named', () => {
        renderWithProviders(<LabCatalogue />, {});
        expect(screen.getByRole('textbox', { name: /search/i })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Filter by group' })).toBeInTheDocument();
    });

    it('every order-form field is labelled, and the form close button is named', async () => {
        renderWithProviders(<TreatmentPanel sessionId="sess-a11y" />, {});
        const aspirin = await screen.findByText('Aspirin');
        expect(screen.getByRole('textbox', { name: 'Search treatments' })).toBeInTheDocument();
        fireEvent.click(aspirin.closest('button'));

        expect(screen.getByLabelText('Dose')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Dose unit' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Route' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Frequency' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Urgency' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Notes (optional)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close order form' })).toBeInTheDocument();
    });
});

describe('PRV-31 case summary modal', () => {
    it('is a named dialog that closes on Escape, titled by the patient — never the authoring title', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <CaseSummaryModal activeCase={{ id: 'c1', name: 'Inferior STEMI with RV infarct', config: {} }} sessionId="s1" onClose={onClose} />,
        );
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAccessibleName();
        expect(dialog.textContent).not.toContain('Inferior STEMI with RV infarct');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});

describe('PRV-37 order form previews the effect at the typed dose', () => {
    // Regression lock: the preview showed morphine's 2 mg base effect (RR -4) whatever dose was typed (QA 2026-10-04, PRV-37)
    it('scales the expected effects with the dose', async () => {
        renderWithProviders(<TreatmentPanel sessionId="sess-dose" />, {});
        fireEvent.click((await screen.findByText('Morphine')).closest('button'));
        const preview = () => screen.getByTestId('expected-effects').textContent;
        expect(preview()).toContain('RR -4');
        fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '4' } });
        expect(preview()).toContain('RR -8');
        expect(preview()).toContain('BP -20/-10');
        fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '1' } });
        expect(preview()).toContain('RR -2');
    });
});

