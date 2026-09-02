import { describe, it, expect } from 'vitest';
import roomEn from '../../locales/en/room3d.json';
import monitorEn from '../../locales/en/monitor.json';
import { casePatient, mapVitals, rhythmLabel } from './caseBinding.js';

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
        // Placeholders come from the room's own locale namespace; the test
        // hands in the English table so what it pins is what a learner sees.
        const patient = casePatient(null, (key) => roomEn[key]);
        expect(patient.name).toBe('Unknown patient');
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

describe('rhythmLabel', () => {
    it('names non-sinus rhythms and leaves sinus to the heart-rate label', () => {
        // Through the monitor's own vocabulary, so the room's monitor and
        // the bedside monitor can never name a rhythm differently.
        const tMonitor = (key) => monitorEn[key];
        expect(rhythmLabel('AFib', tMonitor)).toBe('Atrial Fibrillation');
        expect(rhythmLabel('VTach', tMonitor)).toBe('Ventricular Tachycardia');
        expect(rhythmLabel('VFib', tMonitor)).toBe('Ventricular Fibrillation');
        expect(rhythmLabel('Asystole', tMonitor)).toBe('Asystole');
        expect(rhythmLabel('NSR', tMonitor)).toBeNull();
        expect(rhythmLabel(undefined, tMonitor)).toBeNull();
        // Without a translator it hands back the key, never English.
        expect(rhythmLabel('AFib')).toBe('rhythm_afib');
    });
});
