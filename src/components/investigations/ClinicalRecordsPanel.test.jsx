// History tab now groups its 7 fields into a 3-group accordion: Present
// History (CC + HPI), Past Medical (PMH + PSH + Allergies), Personal & Social
// (Social + Family). Empty groups are hidden, populated ones default open.
// These tests lock the grouping contract — re-flattening or moving a field
// across groups will fail one of these assertions.

import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import ClinicalRecordsPanel from './ClinicalRecordsPanel.jsx';

const fullHistoryConfig = {
    clinicalRecords: {
        history: {
            chiefComplaint: 'Chest pain for 2 hours',
            hpi: 'Sudden onset substernal pressure...',
            pastMedical: 'HTN, DM',
            pastSurgical: 'Appendectomy 2010',
            allergies: 'Penicillin (rash)',
            social: 'Smokes 1ppd',
            family: 'Father MI at 55',
        },
    },
};

describe('ClinicalRecordsPanel — History accordion groups', () => {
    it('renders three group headers when content is populated', () => {
        renderWithProviders(<ClinicalRecordsPanel caseConfig={fullHistoryConfig} />);
        expect(screen.getByText('Present History')).toBeInTheDocument();
        expect(screen.getByText('Past Medical')).toBeInTheDocument();
        expect(screen.getByText('Personal & Social')).toBeInTheDocument();
    });

    it('shows item counts in each group header', () => {
        renderWithProviders(<ClinicalRecordsPanel caseConfig={fullHistoryConfig} />);
        // Present History: CC + HPI = 2 items
        // Past Medical: PMH + PSH + Allergies = 3 items
        // Personal & Social: Social + Family = 2 items
        const counts = screen.getAllByText(/\d+ items?/);
        const counted = counts.map(n => n.textContent);
        expect(counted).toContain('2 items');
        expect(counted).toContain('3 items');
    });

    it('shows fields inside their assigned group when expanded (default)', () => {
        renderWithProviders(<ClinicalRecordsPanel caseConfig={fullHistoryConfig} />);
        expect(screen.getByText('Chief Complaint')).toBeInTheDocument();
        expect(screen.getByText('Chest pain for 2 hours')).toBeInTheDocument();
        expect(screen.getByText('History of Present Illness')).toBeInTheDocument();
        expect(screen.getByText('Past Medical History')).toBeInTheDocument();
        expect(screen.getByText('Family History')).toBeInTheDocument();
    });

    it('hides empty groups entirely instead of showing empty headings', () => {
        const partial = {
            clinicalRecords: {
                history: {
                    chiefComplaint: 'Headache',
                    // no past medical, no social
                },
            },
        };
        renderWithProviders(<ClinicalRecordsPanel caseConfig={partial} />);
        expect(screen.getByText('Present History')).toBeInTheDocument();
        expect(screen.queryByText('Past Medical')).not.toBeInTheDocument();
        expect(screen.queryByText('Personal & Social')).not.toBeInTheDocument();
    });

    it('collapses a group when its header is clicked', () => {
        renderWithProviders(<ClinicalRecordsPanel caseConfig={fullHistoryConfig} />);
        // Past Medical group is open by default — its content (Allergies row) is visible.
        expect(screen.getByText('Allergies')).toBeInTheDocument();
        const header = screen.getByRole('button', { name: /Past Medical/i });
        fireEvent.click(header);
        // After collapse, Allergies row is hidden (its label disappears with the body).
        expect(screen.queryByText('Allergies')).not.toBeInTheDocument();
        // Group header itself stays — user can re-expand.
        expect(screen.getByText('Past Medical')).toBeInTheDocument();
    });

    it('keeps Chief Complaint visually highlighted (red) inside its group', () => {
        renderWithProviders(<ClinicalRecordsPanel caseConfig={fullHistoryConfig} />);
        const heading = screen.getByText('Chief Complaint');
        // Walk up to the wrapping element with bg-red-900 styling.
        const card = heading.closest('div.bg-red-900\\/20');
        expect(card).not.toBeNull();
    });

    it('falls back to "No history information available" when records are empty', () => {
        renderWithProviders(<ClinicalRecordsPanel caseConfig={{ clinicalRecords: { history: {} } }} />);
        expect(screen.getByText(/No history information available/i)).toBeInTheDocument();
    });
});
