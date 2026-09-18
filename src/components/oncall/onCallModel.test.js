import { describe, it, expect } from 'vitest';
import {
    countReachable,
    formatCallDuration,
    initialsOf,
    isFailedReply,
    isImageAvatar,
    newCallId,
    reachabilityOf,
    specialistsOf,
    specialistTypeForRoom,
    SPECIALTY_LABEL_KEYS,
} from './onCallModel';
import { SPECIALIST_TYPES } from '../../../server/shared/specialties.js';

const team = [
    { agent_type: 'patient', name: 'Default Patient', enabled: true },
    { agent_type: 'nurse', name: 'Sarah', enabled: true, availability_type: 'present', status: 'absent' },
    { agent_type: 'pathologist', name: 'Dr. Ana Path', enabled: true, availability_type: 'on-call', status: 'absent' },
    { agent_type: 'cardiologist', name: 'Dr. Ben Heart', enabled: true, availability_type: 'on-call', status: 'present' },
    { agent_type: 'radiologist', name: 'Dr. Cy Ray', enabled: true, availability_type: 'absent', status: 'absent' },
    { agent_type: 'laboratorian', name: 'Dr. Dana Lab', enabled: true, availability_type: 'on-call', status: 'present' },
];

describe('specialistsOf', () => {
    it('keeps registry specialists only, never the nurse or the patient', () => {
        expect(specialistsOf(team).map(a => a.agent_type))
            .toEqual(['pathologist', 'cardiologist', 'radiologist', 'laboratorian']);
    });
    it('drops disabled specialists and is null-safe', () => {
        expect(specialistsOf([{ agent_type: 'pathologist', enabled: false }])).toEqual([]);
        expect(specialistsOf(null)).toEqual([]);
    });
});

describe('reachabilityOf / countReachable', () => {
    it('maps display status to what the phone can do', () => {
        expect(reachabilityOf(team[2])).toBe('on_call');
        expect(reachabilityOf(team[3])).toBe('available');
        expect(reachabilityOf(team[4])).toBe('unavailable');
        expect(reachabilityOf({ ...team[2], status: 'paged', arrives_at: '2099-01-01T00:00:00Z' })).toBe('paging');
    });
    it('counts specialists that can be reached, ignoring the unavailable one', () => {
        // pathologist (on call) + cardiologist (present) + laboratorian
        // (present); the radiologist is absent.
        expect(countReachable(team)).toBe(3);
        expect(countReachable([])).toBe(0);
    });
});

describe('initialsOf', () => {
    it('skips honorifics and takes first + last name', () => {
        expect(initialsOf('Dr. Samira Haddad')).toBe('SH');
        expect(initialsOf('Dr Jonas Van Berg')).toBe('JB');
        expect(initialsOf('Cher')).toBe('CH');
        // The seeded specialists are all "On-call …": the title must not
        // become every contact's initial.
        expect(initialsOf('On-call Pathologist')).toBe('PA');
        expect(initialsOf('On call Radiologist')).toBe('RA');
        expect(initialsOf('')).toBe('?');
    });
});

describe('isImageAvatar', () => {
    it('accepts 2D image urls and rejects the seeded .glb avatars', () => {
        expect(isImageAvatar('rb_medical_male_03.glb')).toBe(false);
        expect(isImageAvatar('/avatars/dr.png')).toBe(true);
        expect(isImageAvatar(null)).toBe(false);
    });
});

describe('newCallId', () => {
    it('matches the conversation route contract and is unique', () => {
        const ids = Array.from({ length: 50 }, () => newCallId());
        ids.forEach(id => expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('formatCallDuration / isFailedReply', () => {
    it('formats mm:ss', () => {
        expect(formatCallDuration(0)).toBe('0:00');
        expect(formatCallDuration(65_400)).toBe('1:05');
        expect(formatCallDuration(-5)).toBe('0:00');
    });
    it('recognises the service failure strings', () => {
        expect(isFailedReply('Error: Could not communicate with X.')).toBe(true);
        expect(isFailedReply('Rate limit exceeded: slow down')).toBe(true);
        expect(isFailedReply('The margins are clear.')).toBe(false);
    });
});

describe('specialistTypeForRoom', () => {
    it('opens the phone on the specialist who owns the room it was rung from', () => {
        expect(specialistTypeForRoom('pathology')).toBe('pathologist');
        expect(specialistTypeForRoom('ecg')).toBe('cardiologist');
        expect(specialistTypeForRoom('pacs')).toBe('radiologist');
        // The pre-plugin radiology room and the core lab room.
        expect(specialistTypeForRoom('radiology')).toBe('radiologist');
        expect(specialistTypeForRoom('lab')).toBe('laboratorian');
    });

    it('opens the contact list from a room nobody owns', () => {
        ['chat', 'examination', 'consultant', 'room3d', '', null, undefined]
            .forEach((room) => expect(specialistTypeForRoom(room), String(room)).toBeNull());
    });
});

describe('SPECIALTY_LABEL_KEYS', () => {
    // A specialty added to the registry without its phone label would render
    // the contact row with no tag and no error.
    it('carries a label key for every specialty in the registry', () => {
        SPECIALIST_TYPES.forEach((type) => {
            expect(SPECIALTY_LABEL_KEYS[type], type).toBe(`specialty_${type}`);
        });
        expect(Object.keys(SPECIALTY_LABEL_KEYS).sort()).toEqual([...SPECIALIST_TYPES].sort());
    });
});
