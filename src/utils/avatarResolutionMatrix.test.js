import { describe, expect, it } from 'vitest';
import {
    avatarsForSlot,
    deriveAvatarSlot,
    pickDemographicAvatar,
    resolveAvatarId,
} from './resolveAvatar.js';

const manifest = {
    all: [
        { id: 'male-young.glb', label: 'Male Young', gender: 'male', age: 'young' },
        { id: 'male-middle.glb', label: 'Male Middle', gender: 'male', age: 'middle' },
        { id: 'male-elderly.glb', label: 'Male Elderly', gender: 'male', age: 'elderly' },
        { id: 'female-young.glb', label: 'Female Young', gender: 'female', age: 'young' },
        { id: 'female-middle.glb', label: 'Female Middle', gender: 'female', age: 'middle' },
        { id: 'female-elderly.glb', label: 'Female Elderly', gender: 'female', age: 'elderly' },
        { id: 'boy-child.glb', label: 'Boy Child', gender: 'male', age: 'child' },
        { id: 'girl-child.glb', label: 'Girl Child', gender: 'female', age: 'child' },
        { id: 'legacy-neutral.glb', label: 'Legacy Neutral' },
    ],
    male: {
        young: ['male-young.glb'],
        middle: ['male-middle.glb'],
        elderly: ['male-elderly.glb'],
    },
    female: {
        young: ['female-young.glb'],
        middle: ['female-middle.glb'],
        elderly: ['female-elderly.glb'],
    },
    child: ['boy-child.glb', 'girl-child.glb'],
    fallback: ['legacy-neutral.glb'],
};

describe('avatar resolution matrix', () => {
    it.each([
        ['male adult', 'male', 35, 'male'],
        ['female adult', 'female', 35, 'female'],
        ['short female marker', 'F', 35, 'female'],
        ['child male', 'male', 9, 'child'],
        ['child female', 'female', 9, 'child'],
        ['missing age defaults to adult male', '', undefined, 'male'],
    ])('derives the persona slot for %s', (_label, gender, age, expected) => {
        expect(deriveAvatarSlot(gender, age)).toBe(expected);
    });

    it('keeps an explicit known avatar as the strongest case-level override', () => {
        expect(resolveAvatarId({
            avatarId: 'female-middle.glb',
            gender: 'male',
            manifest,
            platformAvatars: { default_avatar_male: 'male-middle.glb' },
            patient: { id: 'p1', gender: 'male', age: 45 },
        })).toBe('female-middle.glb');
    });

    it.each([
        ['male', 45, { default_avatar_male: 'male-elderly.glb' }, 'male-elderly.glb'],
        ['female', 45, { default_avatar_female: 'female-elderly.glb' }, 'female-elderly.glb'],
        ['female child', 8, { default_avatar_child: 'girl-child.glb' }, 'girl-child.glb'],
    ])('uses the matching platform default for %s', (gender, age, platformAvatars, expected) => {
        expect(resolveAvatarId({
            avatarId: '',
            gender,
            manifest,
            platformAvatars,
            patient: { id: `${gender}:${age}`, gender, age },
        })).toBe(expected);
    });

    it('ignores a stale explicit avatar and falls through to the platform default', () => {
        expect(resolveAvatarId({
            avatarId: 'deleted.glb',
            gender: 'female',
            manifest,
            platformAvatars: { default_avatar_female: 'female-middle.glb' },
            patient: { id: 'p2', gender: 'female', age: 45 },
        })).toBe('female-middle.glb');
    });

    it('ignores platform defaults that do not match the patient slot', () => {
        expect(resolveAvatarId({
            gender: 'female',
            manifest,
            platformAvatars: { default_avatar_female: 'male-middle.glb' },
            patient: { id: 'p3', gender: 'female', age: 45 },
        })).toBe('female-middle.glb');
    });

    it.each([
        [{ id: 'adult-m', gender: 'male', age: 28 }, 'male-young.glb'],
        [{ id: 'adult-f', gender: 'female', age: 41 }, 'female-middle.glb'],
        [{ id: 'senior-f', gender: 'female', age: 70 }, 'female-elderly.glb'],
    ])('auto-picks a demographic adult avatar for %o', (patient, expected) => {
        expect(resolveAvatarId({
            gender: patient.gender,
            manifest,
            platformAvatars: {},
            patient,
        })).toBe(expected);
    });

    it.each([
        [{ id: 'child-m', gender: 'male', age: 7 }, 'boy-child.glb'],
        [{ id: 'child-f', gender: 'female', age: 7 }, 'girl-child.glb'],
    ])('prefers a child avatar matching the child gender for %o', (patient, expected) => {
        expect(pickDemographicAvatar(patient, manifest)).toBe(expected);
    });

    it('falls back to manifest fallback when no platform or demographic pool is available', () => {
        const sparseManifest = {
            all: [{ id: 'fallback.glb', label: 'Fallback' }],
            fallback: ['fallback.glb'],
        };
        expect(resolveAvatarId({
            gender: 'female',
            manifest: sparseManifest,
            platformAvatars: {},
            patient: { id: 'p4', gender: 'female', age: 45 },
        })).toBe('fallback.glb');
    });
});

describe('avatar option filtering', () => {
    it.each([
        ['male', ['male-young.glb', 'male-middle.glb', 'male-elderly.glb', 'legacy-neutral.glb']],
        ['female', ['female-young.glb', 'female-middle.glb', 'female-elderly.glb', 'legacy-neutral.glb']],
        ['child', ['boy-child.glb', 'girl-child.glb']],
    ])('lists only avatars appropriate for the %s slot', (slot, expected) => {
        expect(avatarsForSlot(manifest, slot).map(a => a.id)).toEqual(expected);
    });

    it('preserves an existing mismatched selection so admins can see and replace it', () => {
        expect(avatarsForSlot(manifest, 'male', 'female-middle.glb').map(a => a.id)).toEqual([
            'female-middle.glb',
            'male-young.glb',
            'male-middle.glb',
            'male-elderly.glb',
            'legacy-neutral.glb',
        ]);
    });
});
