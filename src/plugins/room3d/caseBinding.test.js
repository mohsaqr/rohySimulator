import { describe, it, expect } from 'vitest';
import { avatarUrl, casePatient, mapVitals, rhythmLabel } from './caseBinding.js';

const STEMI_CASE = {
    id: 7,
    name: 'Crushing Chest Pain',
    description: 'STEMI presentation',
    patient_name: 'Maria Mercedes Rodriguez',
    patient_gender: 'Female',
    patient_age: 58,
    chief_complaint: 'Crushing chest pain for 2 hours',
    config: {
        patient_name: 'Maria Mercedes Rodriguez',
        avatar_id: 'rb_female_adult_02.glb',
        greeting: '*clutching chest, sweating heavily* Doctor, my chest hurts so much.',
        demographics: { age: 58, gender: 'Female', allergies: 'Sulfa drugs (rash)' },
        structuredHistory: {
            chiefComplaint: 'Crushing chest pain for 2 hours',
            pmh: 'Type 2 diabetes, hypertension',
        },
        clinicalRecords: {
            history: { hpi: 'Pain started at rest, radiating to the left arm.', social: 'Never smoker' },
            medications: [{ name: 'Metformin', dose: '1000mg', route: 'PO', frequency: 'BID' }],
        },
    },
};

describe('casePatient', () => {
    it('maps a full case record to the room patient contract', () => {
        const patient = casePatient(STEMI_CASE);
        expect(patient).toMatchObject({
            name: 'Maria Mercedes Rodriguez',
            initials: 'MM',
            age: 58,
            pronouns: 'she/her',
            speaker: 'MARIA',
            presenting_concern: 'Crushing chest pain for 2 hours',
            background: 'Type 2 diabetes, hypertension',
            allergies: 'Sulfa drugs (rash)',
            case_title: 'Crushing Chest Pain',
        });
        expect(patient.opening_line).toBe('Doctor, my chest hurts so much.');
        expect(patient.arrival_note).toMatch(/^Maria Mercedes Rodriguez presents with crushing chest pain/);
    });

    it('falls back safely on an empty case and never guesses pronouns', () => {
        const patient = casePatient(null);
        expect(patient.name).toBe('Unknown Patient');
        expect(patient.initials).toBe('UP');
        expect(patient.pronouns).toBe('they/them');
        expect(patient.allergies).toBe('Not recorded');
        expect(patient.opening_line.length).toBeGreaterThan(0);
    });
});

describe('mapVitals', () => {
    const FEED = { hr: 108, spo2: 94, rr: 24, bp_sys: 158, bp_dia: 94, temp: 37.1, etco2: 30, rhythm: 'NSR' };

    it('maps the snake_case EventLogger mirror to the engine shape', () => {
        expect(mapVitals(FEED)).toEqual({
            heart_rate: 108,
            oxygen_saturation: 94,
            respiratory_rate: 24,
            systolic: 158,
            diastolic: 94,
            temperature: 37.1,
        });
    });

    it('returns null for absent feeds and arrest-state "?" placeholders', () => {
        expect(mapVitals(null)).toBeNull();
        expect(mapVitals(undefined)).toBeNull();
        expect(mapVitals({ ...FEED, spo2: '?' })).toBeNull();
        expect(mapVitals({ ...FEED, hr: null })).toBeNull();
    });

    it('substitutes a normal temperature when the feed omits it', () => {
        expect(mapVitals({ ...FEED, temp: null }).temperature).toBe(37.0);
    });
});

describe('avatarUrl', () => {
    it('uses the case avatar_id from the Rohy catalogue', () => {
        expect(avatarUrl(STEMI_CASE)).toBe('/avatars/heads/rb_female_adult_02.glb');
    });

    it('falls back to the default full-body avatar', () => {
        expect(avatarUrl(null)).toBe('/avatars/heads/avatarsdk.glb');
        expect(avatarUrl({ config: {} })).toBe('/avatars/heads/avatarsdk.glb');
    });
});

describe('rhythmLabel', () => {
    it('names non-sinus rhythms and leaves sinus to the heart-rate label', () => {
        expect(rhythmLabel('AFib')).toBe('Atrial fibrillation');
        expect(rhythmLabel('VTach')).toBe('Ventricular tachycardia');
        expect(rhythmLabel('VFib')).toBe('Ventricular fibrillation');
        expect(rhythmLabel('Asystole')).toBe('Asystole');
        expect(rhythmLabel('NSR')).toBeNull();
        expect(rhythmLabel(undefined)).toBeNull();
    });
});
