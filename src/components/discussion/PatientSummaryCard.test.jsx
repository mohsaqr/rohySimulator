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
