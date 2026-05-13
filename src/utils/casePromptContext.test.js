import { describe, expect, it } from 'vitest';
import {
    buildDiscussionCaseContext,
    buildPatientCaseDesignContext,
    formatCaseRadiologyForPrompt,
    formatCaseVitalsForPrompt,
    formatPersonaDemographicsForPrompt,
    formatStructuredHistoryForPrompt,
} from './casePromptContext.js';

const richCase = {
    name: 'Chest Pain Case',
    description: 'Simulation case description',
    config: {
        patient_name: 'Richard Thompson',
        demographics: { age: 62, gender: 'Male', weight: '85 kg', height: '175 cm' },
        storyMode: 'structured',
        structuredHistory: {
            chiefComplaint: 'Chest pressure',
            hpi: 'Started after stairs and radiates to the jaw',
            pmh: 'Hypertension and hyperlipidemia',
            psh: 'Appendectomy',
            medications: 'Amlodipine and atorvastatin',
            allergies: 'NKDA',
            socialHistory: 'Former smoker',
            familyHistory: 'Father had MI at 58',
            ros: 'Diaphoresis and dyspnea',
            additionalNotes: 'Anxious but cooperative',
        },
        clinicalRecords: {
            history: {
                chiefComplaint: 'Chest pressure',
                hpi: 'Started after stairs and radiates to the jaw',
                pastMedical: 'Hypertension and hyperlipidemia',
                pastSurgical: 'Appendectomy',
                allergies: 'NKDA',
                social: 'Former smoker',
                family: 'Father had MI at 58',
            },
        },
        initialVitals: {
            hr: 110,
            bpSys: 90,
            bpDia: 60,
            spo2: 92,
            rr: 22,
            temp: 37.1,
            etco2: 35,
            rhythm: 'Sinus tachycardia',
            conditions: { stElev: 2, pvc: true, wideQRS: false },
        },
        physical_exam: {
            chest: {
                auscultation: { finding: 'Bibasal crackles', abnormal: true },
            },
        },
        radiology: [
            {
                modality: 'X-Ray',
                studyName: 'Chest X-ray',
                findings: 'Mild pulmonary edema',
                interpretation: 'Congestive changes',
            },
        ],
        investigations: {
            labs: [
                {
                    test_name: 'Troponin I',
                    current_value: 2.1,
                    unit: 'ng/mL',
                    is_abnormal: true,
                    turnaround_minutes: 15,
                },
            ],
        },
        diagnosis: 'STEMI',
        treatment_plan: 'Aspirin, heparin, cath lab',
        learning_objectives: ['recognize STEMI', 'activate cath lab'],
    },
};

describe('case prompt context formatters', () => {
    it('formats current structured-mode field names and old aliases', () => {
        expect(formatStructuredHistoryForPrompt(richCase.config.structuredHistory)).toContain(
            'History of Present Illness: Started after stairs'
        );
        expect(formatStructuredHistoryForPrompt({
            historyOfPresentIllness: 'old hpi key',
            pastMedicalHistory: 'old pmh key',
        })).toContain('Past Medical History: old pmh key');
    });

    it('omits mirrored clinical-history fields but keeps structured-only AI notes', () => {
        const out = formatStructuredHistoryForPrompt(richCase.config.structuredHistory, {
            omitMirroredHistory: richCase.config.clinicalRecords.history,
        });
        expect(out).not.toContain('Chief Complaint: Chest pressure');
        expect(out).not.toContain('Past Medical History: Hypertension');
        expect(out).toContain('Current Medications: Amlodipine and atorvastatin');
        expect(out).toContain('Review of Systems: Diaphoresis and dyspnea');
        expect(out).toContain('Additional Notes for AI: Anxious but cooperative');
    });

    it('formats initialVitals, legacy initial_vitals, and top-level legacy vitals', () => {
        expect(formatCaseVitalsForPrompt(richCase.config)).toContain('BP: 90/60 mmHg');
        expect(formatCaseVitalsForPrompt({ initial_vitals: { hr: 99, bpSys: 120, bpDia: 70 } })).toContain('HR: 99 bpm');
        expect(formatCaseVitalsForPrompt({ hr: 80, sbp: 130, dbp: 85 })).toContain('BP: 130/85 mmHg');
    });

    it('maps configured radiology studyName/modality into prompt markdown', () => {
        const out = formatCaseRadiologyForPrompt(richCase.config);
        expect(out).toContain('X-Ray');
        expect(out).toContain('Chest X-ray');
        expect(out).toContain('Mild pulmonary edema');
    });
});

describe('case prompt context surfaces', () => {
    it('patient context includes case design fields that are not otherwise in clinicalRecords', () => {
        const out = buildPatientCaseDesignContext(richCase);
        expect(out).toContain('CASE DESIGN CONTEXT');
        expect(out).toContain('Patient: Richard Thompson');
        expect(out).toContain('Current Medications: Amlodipine and atorvastatin');
        expect(out).toContain('Review of Systems: Diaphoresis and dyspnea');
        expect(out).toContain('Additional Notes for AI: Anxious but cooperative');
        expect(out).toContain('Configured Initial Vitals');
        expect(out).toContain('Bibasal crackles');
        expect(out).not.toContain('Expected diagnosis');
    });

    it('full debrief context includes all authored clinical expectations and configured results', () => {
        const out = buildDiscussionCaseContext(richCase, 'full');
        expect(out).toContain('Structured History');
        expect(out).toContain('History of Present Illness: Started after stairs');
        expect(out).toContain('Initial Vitals');
        expect(out).toContain('Configured Radiology Results');
        expect(out).toContain('Troponin I = 2.1 ng/mL');
        expect(out).toContain('Expected diagnosis: STEMI');
        expect(out).toContain('Learning objectives: recognize STEMI; activate cath lab');
    });

    it('history and vitals filters only expose their intended slices', () => {
        const history = buildDiscussionCaseContext(richCase, 'history');
        expect(history).toContain('History of Present Illness');
        expect(history).not.toContain('Initial Vitals');
        expect(history).not.toContain('Expected diagnosis');

        const vitals = buildDiscussionCaseContext(richCase, 'vitals');
        expect(vitals).toContain('Initial Vitals');
        expect(vitals).not.toContain('History of Present Illness');
        expect(vitals).not.toContain('Expected diagnosis');
    });
});

describe('formatPersonaDemographicsForPrompt', () => {
    it('emits one line per authored field with humanised labels', () => {
        const out = formatPersonaDemographicsForPrompt({
            age: 62,
            gender: 'Male',
            weight: '85 kg',
            height: '175 cm',
            bloodType: 'A+',
            language: 'English',
            ethnicity: 'White',
            occupation: 'Mechanic',
            maritalStatus: 'Married',
            mrn: 'MRN-001',
            dob: '1963-04-12',
        });
        expect(out).toContain('- Age: 62 years old');
        expect(out).toContain('- Gender: Male');
        expect(out).toContain('- Weight: 85 kg');
        expect(out).toContain('- Height: 175 cm');
        expect(out).toContain('- Blood type: A+');
        expect(out).toContain('- Preferred language: English');
        expect(out).toContain('- Ethnicity: White');
        expect(out).toContain('- Occupation: Mechanic');
        expect(out).toContain('- Marital status: Married');
        expect(out).toContain('- MRN: MRN-001');
        expect(out).toContain('- Date of birth: 1963-04-12');
    });

    it('omits fields that are missing or blank instead of emitting Unknown', () => {
        const out = formatPersonaDemographicsForPrompt({ age: 30, gender: '   ', height: '' });
        expect(out).toBe('- Age: 30 years old');
    });

    it('surfaces demographics.allergies as "Known allergies"', () => {
        const out = formatPersonaDemographicsForPrompt({ age: 40, allergies: 'Penicillin' });
        expect(out).toContain('- Known allergies: Penicillin');
    });

    it('joins emergencyContact when at least one sub-field is set', () => {
        const out = formatPersonaDemographicsForPrompt({
            age: 40,
            emergencyContact: { name: 'Jane Doe', relationship: 'Spouse', phone: '555-1234' },
        });
        expect(out).toContain('- Emergency contact: Jane Doe · Spouse · 555-1234');
    });

    it('returns an empty string for null / non-object input', () => {
        expect(formatPersonaDemographicsForPrompt(null)).toBe('');
        expect(formatPersonaDemographicsForPrompt(undefined)).toBe('');
        expect(formatPersonaDemographicsForPrompt('nope')).toBe('');
    });
});

describe('formatStructuredHistoryForPrompt — allergies fallback', () => {
    it('falls back to demographics.allergies when structuredHistory.allergies is empty', () => {
        const out = formatStructuredHistoryForPrompt(
            { chiefComplaint: 'Headache' },
            { demographics: { allergies: 'Sulfa drugs' } }
        );
        expect(out).toContain('- Allergies: Sulfa drugs');
    });

    it('prefers structuredHistory.allergies when both are set', () => {
        const out = formatStructuredHistoryForPrompt(
            { allergies: 'NKDA' },
            { demographics: { allergies: 'Sulfa drugs' } }
        );
        expect(out).toContain('- Allergies: NKDA');
        expect(out).not.toContain('Sulfa drugs');
    });

    it('returns allergies-only line when structuredHistory is empty but demographics has allergies', () => {
        const out = formatStructuredHistoryForPrompt(null, {
            demographics: { allergies: 'Latex' },
        });
        expect(out).toBe('- Allergies: Latex');
    });

    it('returns empty string when neither has allergies and structuredHistory is empty', () => {
        expect(formatStructuredHistoryForPrompt(null)).toBe('');
        expect(formatStructuredHistoryForPrompt(null, { demographics: {} })).toBe('');
    });
});

describe('buildPatientCaseDesignContext — allergies fallback wiring', () => {
    it('surfaces demographics.allergies in case design when structuredHistory.allergies is empty', () => {
        const out = buildPatientCaseDesignContext({
            name: 'Case',
            config: {
                demographics: { age: 50, gender: 'Female', allergies: 'Peanut' },
                structuredHistory: { chiefComplaint: 'Cough' },
            },
        });
        expect(out).toContain('Allergies: Peanut');
    });
});
