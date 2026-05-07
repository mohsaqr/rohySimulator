// Editor's History tab now organises 7 fields into 3 accordion groups so
// authors stop staring at a flat 7-item list. Default all-open (it's an
// editor — collapse is opt-in, not opt-out). These tests lock the grouping
// contract and the open-by-default behaviour.

import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import ClinicalRecordsEditor from './ClinicalRecordsEditor.jsx';

function setup({ history = {} } = {}) {
    const caseData = {
        config: {
            clinicalRecords: { history },
        },
    };
    const setCaseData = vi.fn();
    const updateConfig = vi.fn((key, value) => {
        caseData.config[key] = value;
    });
    return renderWithProviders(
        <ClinicalRecordsEditor
            caseData={caseData}
            setCaseData={setCaseData}
            updateConfig={updateConfig}
        />,
    );
}

describe('ClinicalRecordsEditor — History accordion groups', () => {
    it('renders all three group headers regardless of content', () => {
        setup();
        expect(screen.getByText('Present History')).toBeInTheDocument();
        expect(screen.getByText('Past Medical')).toBeInTheDocument();
        expect(screen.getByText('Personal & Social')).toBeInTheDocument();
    });

    it('shows "filled of total" count per group', () => {
        setup({ history: { chiefComplaint: 'CP', allergies: 'NKDA' } });
        const headerCounts = screen.getAllByText(/\d+ of \d+/);
        const counted = headerCounts.map(n => n.textContent);
        expect(counted).toContain('1 of 2'); // Present History — CC filled, HPI empty
        expect(counted).toContain('1 of 3'); // Past Medical — Allergies filled, PMH/PSH empty
        expect(counted).toContain('0 of 2'); // Personal & Social — both empty
    });

    it('opens all three groups by default so author sees every field immediately', () => {
        setup();
        expect(screen.getByPlaceholderText(/Chest pain for 2 hours/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/HTN, DM, CAD/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Father MI at 55/i)).toBeInTheDocument();
    });

    it('hides a group body when its header is collapsed', () => {
        setup();
        expect(screen.getByPlaceholderText(/Smoking, alcohol, occupation/i)).toBeInTheDocument();
        const header = screen.getByRole('button', { name: /Personal & Social/i });
        fireEvent.click(header);
        expect(screen.queryByPlaceholderText(/Smoking, alcohol, occupation/i)).not.toBeInTheDocument();
        // Header still visible — user can re-expand.
        expect(screen.getByText('Personal & Social')).toBeInTheDocument();
    });

    it('marks fields with content with a filled-indicator dot', () => {
        const { container } = setup({ history: { hpi: 'Sudden onset...' } });
        // Look for the green dot adjacent to the HPI label.
        const hpiLabel = screen.getByText(/History of Present Illness/i);
        const dot = hpiLabel.querySelector('span.text-green-400');
        expect(dot).not.toBeNull();
    });

    it('still groups fields correctly when only one field per group is populated', () => {
        setup({ history: {
            chiefComplaint: 'A',
            pastMedical: 'B',
            social: 'C',
        }});
        // Each group: CC in Present History, PMH in Past Medical, Social in Personal & Social.
        // Counts should reflect 1 filled in each group.
        const counts = screen.getAllByText(/\d+ of \d+/).map(n => n.textContent);
        expect(counts.filter(c => c.startsWith('1 of'))).toHaveLength(3);
    });
});
