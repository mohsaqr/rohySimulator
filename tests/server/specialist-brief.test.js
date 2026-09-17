// On-call specialists: the pure half of services/specialistBrief.js.
//
// What a specialist is told (findings, gated) and what it may never say (the
// diagnosis) are decided here. The invariant tests assert that no answer-key
// text — impression, interpretation, diagnosis, rationale, rhythm — can reach
// the extracted findings or the brief, whatever the document shape.

import { describe, it, expect } from 'vitest';
import {
    BRIEF_FINDINGS_LEAD,
    BRIEF_HEADER,
    BRIEF_NO_DIAGNOSIS,
    BRIEF_NO_FINDINGS,
    BRIEF_WITHHELD,
    GUARD_FALLBACK_REPLY,
    buildSpecialistBrief,
    caseSummary,
    disclosureState,
    extractAnswerTerms,
    extractFindings,
    guardSpecialistReply,
} from '../../server/services/specialistBrief.js';
import { normalizeDisclosure } from '../../server/shared/specialties.js';

const SECRET = {
    pathDx: 'SECRET-PATH-DX invasive ductal carcinoma',
    pathAccept: 'SECRET-PATH-ACCEPT idc',
    ecgDx: 'SECRET-ECG-DX anterior stemi',
    ecgRationale: 'SECRET-ECG-RATIONALE contiguous ST elevation',
    ecgRhythm: 'secret_ecg_rhythm_label',
    impression: 'SECRET-IMPRESSION right lower lobe pneumonia',
    interpretation: 'SECRET-INTERPRETATION lobar consolidation',
    caseDx: 'SECRET-CASE-DX',
};

const fullConfig = () => ({
    diagnosis: SECRET.caseDx,
    patient_name: 'Ada Example',
    demographics: { age: 58, gender: 'Female', weight: 70 },
    structuredHistory: { chiefComplaint: 'Breast lump', hpi: 'SECRET-HPI should not be in summary' },
    pathology: {
        manifest: { title: 'SECRET-TITLE Invasive carcinoma', clinical: { history: 'x' } },
        rubric: {
            activities: [
                {
                    activityId: 'act-1',
                    findings: [
                        { id: 'f1', text: 'Nests of atypical cells infiltrate the stroma', roiId: 'r1' },
                        { id: 'f2', text: '   ' },
                        { id: 'f3' },
                        'not an object',
                        null,
                    ],
                    diagnosis: { expected: SECRET.pathDx, accept: [SECRET.pathAccept, 7, null], requireTerms: ['invasive'] },
                },
                { activityId: 'act-2', findings: 'not an array' },
                null,
            ],
        },
    },
    ecg: {
        rubric: {
            activities: [{
                activity_id: 'ecg-1',
                findings: [{ id: 'e1', text: 'ST elevation in V1-V4' }],
                expected: { accepted_diagnoses: [SECRET.ecgDx], rhythm: SECRET.ecgRhythm },
                rationale: SECRET.ecgRationale,
            }],
        },
    },
    pacs: {
        version: 1,
        worklist: [
            { description: 'CXR PA', report: { findings: 'Opacity in the right lower zone', impression: SECRET.impression, reportedBy: 'Dr R', released: false } },
            { description: 'No report' },
            { description: 'Bad report', report: 'text' },
        ],
    },
    radiology: [
        { studyName: 'CT chest', modality: 'CT', findings: 'Air bronchograms', interpretation: SECRET.interpretation },
        { studyName: 'Empty' },
        42,
    ],
});

const secretsIn = (value) => Object.values(SECRET).filter((secret) => JSON.stringify(value).toLowerCase().includes(secret.toLowerCase()));

describe('extractFindings', () => {
    it('reads pathology rubric findings, skipping malformed entries', () => {
        expect(extractFindings('pathology', fullConfig())).toEqual([
            { text: 'Nests of atypical cells infiltrate the stroma', source: 'Activity act-1' },
        ]);
    });

    it('reads ECG rubric findings', () => {
        expect(extractFindings('ecg', fullConfig())).toEqual([
            { text: 'ST elevation in V1-V4', source: 'Activity ecg-1' },
        ]);
    });

    it('reads PACS report findings and legacy radiology findings with their study names', () => {
        expect(extractFindings('radiology', fullConfig())).toEqual([
            { text: 'Opacity in the right lower zone', source: 'CXR PA' },
            { text: 'Air bronchograms', source: 'CT chest' },
        ]);
    });

    it('returns [] for missing or malformed documents and unknown domains', () => {
        for (const config of [null, undefined, 'x', [], {}, { pathology: [] }, { pathology: { rubric: 'x' } },
            { ecg: { rubric: { activities: {} } } }, { pacs: { worklist: 'x' }, radiology: {} }]) {
            for (const domain of ['pathology', 'ecg', 'radiology', 'dermatology']) {
                expect(extractFindings(domain, config), `${domain} ${JSON.stringify(config)}`).toEqual([]);
            }
        }
    });

    it('invariant: never returns impression, interpretation, diagnosis, rationale or rhythm text', () => {
        for (const domain of ['pathology', 'ecg', 'radiology']) {
            expect(secretsIn(extractFindings(domain, fullConfig())), domain).toEqual([]);
        }
    });
});

describe('extractAnswerTerms', () => {
    it('pathology: diagnosis.expected + accept strings, plus the case diagnosis', () => {
        expect(extractAnswerTerms('pathology', fullConfig())).toEqual([SECRET.pathDx, SECRET.pathAccept, SECRET.caseDx]);
    });

    it('ecg: accepted_diagnoses and a multi-word humanised rhythm, plus the case diagnosis', () => {
        expect(extractAnswerTerms('ecg', fullConfig())).toEqual([SECRET.ecgDx, 'secret ecg rhythm label', SECRET.caseDx]);
    });

    it('ecg: a one-word rhythm label is not a term (it would censor ordinary teaching)', () => {
        const config = { ecg: { rubric: { activities: [{ expected: { accepted_diagnoses: [], rhythm: 'sinus' } }] } } };
        expect(extractAnswerTerms('ecg', config)).toEqual([]);
    });

    it('radiology: no terms from free-text impressions in v1, only the case diagnosis', () => {
        expect(extractAnswerTerms('radiology', fullConfig())).toEqual([SECRET.caseDx]);
    });

    it('reads expected_diagnosis and de-duplicates by normalised form', () => {
        expect(extractAnswerTerms('pathology', { expected_diagnosis: 'Acute MI', diagnosis: 'acute-mi' })).toEqual(['acute-mi']);
        expect(extractAnswerTerms('ecg', null)).toEqual([]);
    });
});

describe('caseSummary', () => {
    it('allow-lists patient, age, sex and chief complaint only', () => {
        expect(caseSummary(fullConfig(), {})).toBe('Patient: Ada Example\nAge: 58\nSex: Female\nChief complaint: Breast lump');
    });

    it('falls back to the case row columns and never uses the case name', () => {
        const summary = caseSummary({}, { patient_name: 'Row Name', patient_age: 40, patient_gender: 'Male', chief_complaint: 'Cough', name: 'SECRET-CASE-DX STEMI' });
        expect(summary).toBe('Patient: Row Name\nAge: 40\nSex: Male\nChief complaint: Cough');
    });

    it('invariant: no answer-key or unlisted text', () => {
        const summary = caseSummary(fullConfig(), { name: SECRET.caseDx });
        expect(secretsIn(summary)).toEqual([]);
        expect(summary).not.toContain('SECRET-HPI');
        expect(caseSummary(null, null)).toBe('');
    });
});

describe('disclosureState', () => {
    const disclosure = (partial) => normalizeDisclosure(partial).value;

    it("'never' is closed however many turns", () => {
        expect(disclosureState({ disclosure: disclosure({ findings: 'never' }), studentTurns: 99 }).findingsAllowed).toBe(false);
    });

    it("'on_request' is open from the first turn", () => {
        const state = disclosureState({ disclosure: disclosure({ findings: 'on_request' }), studentTurns: 0 });
        expect(state).toMatchObject({ findingsAllowed: true, reason: 'on_request' });
    });

    it("'after_effort' opens exactly at minStudentTurns", () => {
        const d = disclosure({ findings: 'after_effort', minStudentTurns: 3 });
        expect(disclosureState({ disclosure: d, studentTurns: 2 }).findingsAllowed).toBe(false);
        expect(disclosureState({ disclosure: d, studentTurns: 3 }).findingsAllowed).toBe(true);
        expect(disclosureState({ disclosure: d, studentTurns: 4 }).findingsAllowed).toBe(true);
    });

    it('reports the room-activity and interpretation conditions as not enforced', () => {
        const state = disclosureState({ disclosure: disclosure({}), studentTurns: 0 });
        expect(state.notEnforced).toEqual(['requireRoomActivity', 'requireInterpretation']);
        const off = disclosure({ requireRoomActivity: false, requireInterpretation: false });
        expect(disclosureState({ disclosure: off, studentTurns: 0 }).notEnforced).toEqual([]);
    });

    it('is closed for an unknown mode or missing disclosure', () => {
        expect(disclosureState({ disclosure: { findings: 'always' }, studentTurns: 10 }).findingsAllowed).toBe(false);
        expect(disclosureState({ disclosure: null, studentTurns: 10 }).findingsAllowed).toBe(false);
    });
});

describe('buildSpecialistBrief', () => {
    const findings = extractFindings('pathology', fullConfig());

    it('lists the findings when allowed', () => {
        const brief = buildSpecialistBrief({ summary: 'Patient: A', findings, disclosureState: { findingsAllowed: true, reason: 'after_effort_met' } });
        expect(brief.startsWith(BRIEF_HEADER)).toBe(true);
        expect(brief).toContain('Patient: A');
        expect(brief).toContain(BRIEF_FINDINGS_LEAD);
        expect(brief).toContain('- Nests of atypical cells infiltrate the stroma (Activity act-1)');
        expect(brief).not.toContain(BRIEF_WITHHELD);
        expect(brief.trim().endsWith(BRIEF_NO_DIAGNOSIS)).toBe(true);
    });

    it('withholds the findings when not allowed', () => {
        const brief = buildSpecialistBrief({ summary: '', findings, disclosureState: { findingsAllowed: false, reason: 'never' } });
        expect(brief).toContain(BRIEF_WITHHELD);
        expect(brief).not.toContain('Nests of atypical cells');
        expect(brief).toContain(BRIEF_NO_DIAGNOSIS);
    });

    it('says no findings were provided when none were authored', () => {
        const brief = buildSpecialistBrief({ summary: '', findings: [], disclosureState: { findingsAllowed: true } });
        expect(brief).toContain(BRIEF_NO_FINDINGS);
        expect(brief).not.toContain(BRIEF_FINDINGS_LEAD);
    });

    it('invariant: a brief built from any domain carries no answer-key text', () => {
        for (const domain of ['pathology', 'ecg', 'radiology']) {
            const brief = buildSpecialistBrief({
                summary: caseSummary(fullConfig(), {}),
                findings: extractFindings(domain, fullConfig()),
                disclosureState: { findingsAllowed: true, reason: 'on_request' },
            });
            expect(secretsIn(brief), domain).toEqual([]);
        }
    });
});

describe('guardSpecialistReply', () => {
    const terms = ['Invasive ductal carcinoma', 'first-degree AV block'];

    it('drops the sentence naming the diagnosis and keeps the rest', () => {
        const out = guardSpecialistReply('The nests show invasion. This is invasive ductal carcinoma. What else did you see?', terms);
        expect(out).toEqual({ text: 'The nests show invasion. What else did you see?', removed: 1 });
    });

    it('matches case-insensitively and across hyphen/space variants', () => {
        expect(guardSpecialistReply('Looks like FIRST DEGREE av block to me.', terms).removed).toBe(1);
        expect(guardSpecialistReply('Invasive-ductal carcinoma, clearly!', terms).removed).toBe(1);
        expect(guardSpecialistReply('Consistent with first‑degree AV block.', terms).removed).toBe(1);
    });

    it('falls back to a question when every sentence is removed', () => {
        expect(guardSpecialistReply('Invasive ductal carcinoma.', terms)).toEqual({ text: GUARD_FALLBACK_REPLY, removed: 1 });
    });

    it('does not match inside other words', () => {
        const text = 'Look for carcinomatosis. The ductal carcinomas nearby matter.';
        expect(guardSpecialistReply(text, ['carcinoma', 'ductal carcinoma'])).toEqual({ text, removed: 0 });
        expect(guardSpecialistReply('Mild scarring here.', ['car'])).toEqual({ text: 'Mild scarring here.', removed: 0 });
    });

    it('leaves text alone with no terms, and tolerates non-string input', () => {
        expect(guardSpecialistReply('Any text.', [])).toEqual({ text: 'Any text.', removed: 0 });
        expect(guardSpecialistReply(null, terms)).toEqual({ text: '', removed: 0 });
        expect(guardSpecialistReply('Any text.', null)).toEqual({ text: 'Any text.', removed: 0 });
    });
});
