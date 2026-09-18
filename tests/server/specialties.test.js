// The on-call specialty registry (server/shared/specialties.js) is the single
// source of truth for which agent types are specialists and how willing each
// is to discuss findings. These tests pin its shape and the disclosure
// validator every route uses before storing a per-case override.

import { describe, it, expect } from 'vitest';
import {
    SPECIALTIES,
    SPECIALIST_TYPES,
    DISCLOSURE_MODES,
    isSpecialistType,
    specialtyFor,
    normalizeDisclosure,
    roomKeysOf,
    specialtyTypeForRoom,
} from '../../server/shared/specialties.js';

const DOMAINS = ['pathology', 'ecg', 'radiology', 'laboratory'];

describe('SPECIALTIES registry', () => {
    it('lists exactly the shipped specialties, keyed by agent_type', () => {
        expect(Object.keys(SPECIALTIES).sort())
            .toEqual(['cardiologist', 'laboratorian', 'pathologist', 'radiologist']);
        expect([...SPECIALIST_TYPES].sort()).toEqual(Object.keys(SPECIALTIES).sort());
    });

    it('gives every entry the required fields with valid values', () => {
        for (const [key, entry] of Object.entries(SPECIALTIES)) {
            expect(entry.agentType, key).toBe(key);
            expect(DOMAINS, key).toContain(entry.domain);
            expect(Array.isArray(entry.pluginIds), key).toBe(true);
            expect(Array.isArray(entry.rooms), key).toBe(true);
            expect(normalizeDisclosure(entry.defaultDisclosure).errors, key).toEqual([]);
        }
    });

    // Every specialty must own at least one room: `requireRoomActivity` asks
    // "was the learner in this specialist's room", and a specialty with no
    // room could never answer yes, so the gate would be permanently shut.
    it('gives every specialty at least one room to own', () => {
        for (const key of SPECIALIST_TYPES) {
            expect(roomKeysOf(key).length, key).toBeGreaterThan(0);
        }
    });

    it('maps each specialty to the rooms whose case material it may read', () => {
        expect(roomKeysOf('pathologist')).toEqual(['pathology']);
        expect(roomKeysOf('cardiologist')).toEqual(['ecg']);
        // The PACS plugin room and the pre-plugin core radiology room.
        expect(roomKeysOf('radiologist')).toEqual(['pacs', 'radiology']);
        // The lab is a core room with no plugin behind it.
        expect(SPECIALTIES.laboratorian.pluginIds).toEqual([]);
        expect(roomKeysOf('laboratorian')).toEqual(['lab']);
    });

    it('never lets two specialties claim the same room', () => {
        const all = SPECIALIST_TYPES.flatMap((t) => roomKeysOf(t));
        expect(all.length).toBe(new Set(all).size);
    });

    it('answers which specialty owns a room, and null for one nobody owns', () => {
        expect(specialtyTypeForRoom('pathology')).toBe('pathologist');
        expect(specialtyTypeForRoom('ecg')).toBe('cardiologist');
        expect(specialtyTypeForRoom('pacs')).toBe('radiologist');
        expect(specialtyTypeForRoom('radiology')).toBe('radiologist');
        expect(specialtyTypeForRoom('lab')).toBe('laboratorian');
        ['chat', 'examination', 'consultant', '', null, undefined]
            .forEach((room) => expect(specialtyTypeForRoom(room), String(room)).toBeNull());
    });

    it('returns no rooms for anything that is not a specialty', () => {
        expect(roomKeysOf('nurse')).toEqual([]);
        expect(roomKeysOf(null)).toEqual([]);
    });

    it('ships the after-effort default disclosure', () => {
        expect(SPECIALTIES.pathologist.defaultDisclosure).toEqual({
            findings: 'after_effort',
            minStudentTurns: 3,
            requireRoomActivity: true,
        });
        // Every specialty shares one frozen default object, so a change to the
        // registry default cannot reach three of four specialties.
        SPECIALIST_TYPES.forEach((t) => {
            expect(SPECIALTIES[t].defaultDisclosure, t).toBe(SPECIALTIES.pathologist.defaultDisclosure);
        });
    });

    it('is frozen, so no caller can mutate the shared defaults', () => {
        expect(Object.isFrozen(SPECIALTIES)).toBe(true);
        expect(Object.isFrozen(SPECIALIST_TYPES)).toBe(true);
        expect(Object.isFrozen(SPECIALTIES.radiologist)).toBe(true);
        expect(Object.isFrozen(SPECIALTIES.radiologist.pluginIds)).toBe(true);
        expect(Object.isFrozen(SPECIALTIES.radiologist.defaultDisclosure)).toBe(true);
        expect(Object.isFrozen(DISCLOSURE_MODES)).toBe(true);
    });
});

describe('isSpecialistType / specialtyFor', () => {
    it('recognises the specialist types', () => {
        for (const type of SPECIALIST_TYPES) {
            expect(isSpecialistType(type)).toBe(true);
            expect(specialtyFor(type)).toBe(SPECIALTIES[type]);
        }
    });

    it('rejects every other type, including prototype keys', () => {
        for (const type of ['consultant', 'nurse', 'patient', 'Pathologist', '', null, undefined, 42, 'toString', '__proto__']) {
            expect(isSpecialistType(type), String(type)).toBe(false);
            expect(specialtyFor(type), String(type)).toBeNull();
        }
    });
});

describe('normalizeDisclosure', () => {
    const DEFAULT = SPECIALTIES.pathologist.defaultDisclosure;

    it('returns the default with no errors for a missing config', () => {
        for (const input of [undefined, null, {}]) {
            const { value, errors } = normalizeDisclosure(input);
            expect(errors).toEqual([]);
            expect(value).toEqual(DEFAULT);
        }
    });

    it('merges a partial config over the default', () => {
        const { value, errors } = normalizeDisclosure({ findings: 'on_request', minStudentTurns: 0 });
        expect(errors).toEqual([]);
        expect(value).toEqual({ ...DEFAULT, findings: 'on_request', minStudentTurns: 0 });
    });

    it('accepts every disclosure mode', () => {
        for (const mode of DISCLOSURE_MODES) {
            expect(normalizeDisclosure({ findings: mode }).errors).toEqual([]);
        }
    });

    it('does not mutate the shared default when merging', () => {
        normalizeDisclosure({ minStudentTurns: 9 });
        expect(DEFAULT.minStudentTurns).toBe(3);
    });

    it.each([
        ['negative turns', { minStudentTurns: -1 }],
        ['non-integer turns', { minStudentTurns: 1.5 }],
        ['string turns', { minStudentTurns: '3' }],
        ['bad mode', { findings: 'always' }],
        ['non-boolean flag', { requireRoomActivity: 'yes' }],
        ['non-boolean interpretation flag', { requireInterpretation: 1 }],
        ['unknown field', { revealDiagnosis: true }],
    ])('reports an error for %s and keeps the default for that field', (_label, input) => {
        const { value, errors } = normalizeDisclosure(input);
        expect(errors).toHaveLength(1);
        expect(value).toEqual(DEFAULT);
    });

    it('rejects a non-object config', () => {
        for (const input of ['after_effort', 3, ['findings'], true]) {
            const { value, errors } = normalizeDisclosure(input);
            expect(errors, JSON.stringify(input)).toHaveLength(1);
            expect(value).toEqual(DEFAULT);
        }
    });

    it('reports one error per bad field and still applies the good ones', () => {
        const { value, errors } = normalizeDisclosure({ findings: 'never', minStudentTurns: -2, requireRoomActivity: 'no' });
        expect(errors).toHaveLength(2);
        expect(value.findings).toBe('never');
        expect(value.minStudentTurns).toBe(3);
        expect(value.requireRoomActivity).toBe(true);
    });
});
