// Contract for usePatientAvatar — which body lies on the bed.
//
// The whole point is agreement with the FIRST screen. So these tests assert
// against Rohy's own resolver rather than against a hard-coded expectation:
// whatever `resolveAvatarId` picks for a case is what the room must load,
// because that is literally what the portrait shows.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import usePatientAvatar from './usePatientAvatar';
import { resolveAvatarId } from '../../utils/resolveAvatar';
import { VoiceProvider } from '../../contexts/VoiceContext';

// Age buckets are the resolver's own: child / young / middle / elderly.
const MANIFEST = {
    all: [
        { id: 'am_adult.glb', gender: 'male', age: 'adult' },
        { id: 'af_elderly.glb', gender: 'female', age: 'elderly' },
        { id: 'af_young.glb', gender: 'female', age: 'young' },
    ],
    male: { young: ['am_adult.glb'], middle: ['am_adult.glb'], elderly: ['am_adult.glb'] },
    female: { elderly: ['af_elderly.glb'], young: ['af_young.glb'], middle: ['af_elderly.glb'] },
    fallback: ['am_adult.glb'],
};

vi.mock('../../config/api', () => ({ baseUrl: (p) => p }));

const apiFetch = vi.fn();
vi.mock('../../services/apiClient.js', () => ({ apiFetch: (...a) => apiFetch(...a) }));

const wrapper = ({ children }) => <VoiceProvider>{children}</VoiceProvider>;

const mount = (activeCase) =>
    renderHook(() => usePatientAvatar({ activeCase }), { wrapper });

const MARGARET = {
    id: 2,
    patient_name: 'Margaret Chen',
    patient_gender: 'Female',
    patient_age: 72,
    config: { demographics: { gender: 'Female', age: 72 } },
};

beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ default_avatar_male: '', default_avatar_female: '' });
    global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(MANIFEST) }));
});

describe('usePatientAvatar', () => {
    it('puts the SAME person on the bed as the first screen shows', async () => {
        const { result } = mount(MARGARET);
        await waitFor(() => expect(result.current.url).toBeTruthy());

        // What the portrait resolves for this exact patient descriptor.
        const portrait = resolveAvatarId({
            avatarId: null,
            gender: 'Female',
            manifest: MANIFEST,
            platformAvatars: { default_avatar_male: '', default_avatar_female: '' },
            patient: { gender: 'Female', name: 'Margaret Chen', age: 72, id: 2 },
        });
        expect(result.current.url).toBe(`/avatars/heads/${portrait}`);
        // And specifically: a 72-year-old woman is not a male adult, which
        // is what the room used to load for every case (avatarsdk.glb).
        expect(result.current.avatarId).toBe('af_elderly.glb');
    });

    it('honours an explicitly authored avatar without waiting for the manifest', () => {
        const { result } = mount({
            id: 9,
            config: { avatar_id: 'chosen.glb', demographics: { gender: 'Male' } },
        });
        // Synchronously, on the first render: an authored id needs no resolver.
        expect(result.current.url).toBe('/avatars/heads/chosen.glb');
    });

    it('holds the room back rather than mounting the wrong body first', () => {
        const { result } = mount(MARGARET);
        // Before the manifest lands there is no answer — and no answer is
        // better than a body the learner watches get swapped.
        expect(result.current.url).toBeNull();
    });

    it('carries the avatar\'s own camera framing', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                ...MANIFEST,
                all: [{ id: 'af_elderly.glb', gender: 'female', age: 'elderly', camera: { pos: [0, 1.4, 0.8], lookY: 1.4, fov: 18 } }],
            }),
        }));
        const { result } = mount(MARGARET);
        await waitFor(() => expect(result.current.url).toBeTruthy());
        expect(result.current.camera).toEqual({ pos: [0, 1.4, 0.8], lookY: 1.4, fov: 18 });
    });

    it('survives an unreadable manifest without blocking on it forever', async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
        const { result } = mount(MARGARET);
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        // Nothing to resolve against and nothing authored: the room stays
        // unmounted rather than inventing a patient.
        expect(result.current.url).toBeNull();
    });
});
