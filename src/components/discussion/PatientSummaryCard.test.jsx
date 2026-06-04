import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PatientSummaryCard from './PatientSummaryCard.jsx';

const patientAvatarProps = vi.fn();

vi.mock('../chat/PatientAvatar.jsx', () => ({
    default: function PatientAvatarStub(props) {
        patientAvatarProps(props);
        return <div data-testid="patient-avatar-stub" />;
    },
}));

afterEach(() => {
    patientAvatarProps.mockClear();
});

describe('PatientSummaryCard avatar wiring', () => {
    it('passes the canonical case avatar_id and demographics to PatientAvatar', async () => {
        const headManifest = { all: [{ id: 'case-avatar.glb', label: 'Case Avatar' }] };
        const platformAvatars = { default_avatar_female: 'platform-female.glb' };
        render(
            <PatientSummaryCard
                activeCase={{
                    id: 'case-1',
                    name: 'Case One',
                    config: {
                        patient_name: 'Alex Patient',
                        avatar_id: 'case-avatar.glb',
                        patient_avatar: 'legacy-avatar.glb',
                        demographics: { gender: 'female', age: 32 },
                    },
                }}
                headManifest={headManifest}
                platformAvatars={platformAvatars}
            />
        );

        await screen.findByTestId('patient-avatar-stub');
        await waitFor(() => {
            expect(patientAvatarProps).toHaveBeenCalledWith(expect.objectContaining({
                avatarId: 'case-avatar.glb',
                headManifest,
                platformAvatars,
                patient: {
                    id: 'case-1',
                    name: 'Alex Patient',
                    gender: 'female',
                    age: 32,
                },
            }));
        });
    });

    it('shows the structured chief complaint, never the case description', async () => {
        render(
            <PatientSummaryCard
                activeCase={{
                    id: 'case-cc',
                    name: 'Thomas Taylor',
                    description: 'Thomas Taylor',
                    chief_complaint: 'Crushing chest pain',
                    config: {
                        patient_name: 'Thomas Taylor',
                        demographics: { gender: 'male', age: 69 },
                        structuredHistory: { chiefComplaint: 'Chest pain for 2 hours' },
                    },
                }}
            />
        );
        await screen.findByTestId('patient-avatar-stub');
        expect(screen.getByText('Chest pain for 2 hours')).toBeTruthy();
        // The name must not appear in the chief-complaint slot (bug #2).
        expect(screen.queryByText('Chief complaint').nextSibling?.textContent).not.toBe('Thomas Taylor');
    });

    it('falls back to the chief_complaint column, not the description, when no structured history', async () => {
        render(
            <PatientSummaryCard
                activeCase={{
                    id: 'case-col',
                    name: 'Thomas Taylor',
                    description: 'Thomas Taylor',          // selection-screen blurb == name
                    chief_complaint: 'Crushing chest pain', // dedicated column
                    config: { patient_name: 'Thomas Taylor', demographics: { gender: 'male', age: 69 } },
                }}
            />
        );
        await screen.findByTestId('patient-avatar-stub');
        expect(screen.getByText('Crushing chest pain')).toBeTruthy();
        expect(screen.queryByText('Thomas Taylor', { selector: '.text-slate-100.text-sm' })).toBeNull();
    });

    it('renders no chief-complaint box when neither structured nor column value exists', async () => {
        render(
            <PatientSummaryCard
                activeCase={{
                    id: 'case-none',
                    name: 'Thomas Taylor',
                    description: 'Thomas Taylor',
                    config: { patient_name: 'Thomas Taylor', demographics: { gender: 'male', age: 69 } },
                }}
            />
        );
        await screen.findByTestId('patient-avatar-stub');
        // No "Chief complaint" label at all — better than echoing the name.
        expect(screen.queryByText('Chief complaint')).toBeNull();
    });

    it('parses a stringified config so chief complaint still resolves', async () => {
        render(
            <PatientSummaryCard
                activeCase={{
                    id: 'case-str',
                    name: 'Thomas Taylor',
                    config: JSON.stringify({
                        patient_name: 'Thomas Taylor',
                        demographics: { gender: 'male', age: 69 },
                        structuredHistory: { chiefComplaint: 'Shortness of breath' },
                    }),
                }}
            />
        );
        await screen.findByTestId('patient-avatar-stub');
        expect(screen.getByText('Shortness of breath')).toBeTruthy();
    });

    it('still reads the legacy patient_avatar key when avatar_id is absent', async () => {
        render(
            <PatientSummaryCard
                activeCase={{
                    id: 'case-legacy',
                    name: 'Legacy Case',
                    config: {
                        patient_avatar: 'legacy-avatar.glb',
                        demographics: { gender: 'male', age: 52 },
                    },
                }}
                headManifest={{ all: [{ id: 'legacy-avatar.glb', label: 'Legacy Avatar' }] }}
                platformAvatars={{}}
            />
        );

        await screen.findByTestId('patient-avatar-stub');
        await waitFor(() => {
            expect(patientAvatarProps).toHaveBeenCalledWith(expect.objectContaining({
                avatarId: 'legacy-avatar.glb',
                patient: expect.objectContaining({ gender: 'male', age: 52 }),
            }));
        });
    });
});
