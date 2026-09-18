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
    BRIEF_NO_PATIENT,
    buildSpecialistBrief,
    disclosureState,
    extractAnswerTerms,
    extractFindings,
    guardSpecialistReply,
} from '../../server/services/specialistBrief.js';
import { SPECIALTIES, normalizeDisclosure } from '../../server/shared/specialties.js';

const SECRET = {
    pathDx: 'SECRET-PATH-DX invasive ductal carcinoma',
    pathAccept: 'SECRET-PATH-ACCEPT idc',
    ecgDx: 'SECRET-ECG-DX anterior stemi',
    ecgRationale: 'SECRET-ECG-RATIONALE contiguous ST elevation',
    ecgRhythm: 'secret_ecg_rhythm_label',
    impression: 'SECRET-IMPRESSION right lower lobe pneumonia',
    interpretation: 'SECRET-INTERPRETATION lobar consolidation',
    caseDx: 'SECRET-CASE-DX',
    labPreset: 'SECRET-LAB-PRESET high',
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
    investigations: {
        labs: [
            { test_name: 'Troponin I', test_group: 'Cardiac Markers', min_value: 0, max_value: 0.04, current_value: 0.09, unit: 'ng/mL', is_abnormal: true, preset: SECRET.labPreset, normal_samples: [0.01] },
            { test_name: 'Sodium', min_value: 135, max_value: 145, current_value: 139, unit: 'mmol/L', is_abnormal: false },
            { test_name: 'Not resulted', current_value: null, unit: 'x' },
            { test_name: '', current_value: 5 },
            'not an object',
            null,
        ],
    },
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

// Regression lock (2026-09-18): there is no caseSummary any more. The brief
// led with patient name, age, sex and CHIEF COMPLAINT — a symptom — for a
// specialist who never met the patient. The block below pins the replacement:
// the brief says outright that it knows none of that.
describe('the specialist knows no patient', () => {
    it('exports a scope line that denies symptoms, history and presentation', () => {
        expect(BRIEF_NO_PATIENT).toMatch(/not their symptoms/i);
        expect(BRIEF_NO_PATIENT).toMatch(/not their history/i);
    });

    it('invariant: no patient text from the config can reach a brief', () => {
        for (const type of Object.keys(SPECIALTIES)) {
            const specialty = SPECIALTIES[type];
            const brief = buildSpecialistBrief({
                specialty,
                findings: extractFindings(specialty.domain, fullConfig()),
                disclosureState: { findingsAllowed: true, reason: 'on_request' },
            });
            expect(brief, type).not.toContain('Ada Example');
            expect(brief, type).not.toContain('Breast lump');
            expect(brief, type).not.toContain('SECRET-HPI');
            expect(brief, type).not.toContain('58');
            expect(brief, type).not.toContain('Female');
        }
    });
});

describe('extractFindings — laboratory', () => {
    it('renders each resulted test against its reference interval', () => {
        expect(extractFindings('laboratory', fullConfig())).toEqual([
            { text: 'Troponin I = 0.09 ng/mL (reference 0-0.04 ng/mL, abnormal)', source: 'Cardiac Markers' },
            { text: 'Sodium = 139 mmol/L (reference 135-145 mmol/L)', source: 'Laboratory' },
        ]);
    });

    it('skips an unresulted test rather than reporting a blank value', () => {
        const texts = extractFindings('laboratory', fullConfig()).map((f) => f.text);
        expect(texts.some((t) => t.startsWith('Not resulted'))).toBe(false);
    });

    it('reads no authoring shortcuts: preset and normal_samples stay private', () => {
        const findings = extractFindings('laboratory', fullConfig());
        expect(secretsIn(findings)).toEqual([]);
        expect(JSON.stringify(findings)).not.toContain('0.01');
    });

    it('survives a missing or malformed investigations block', () => {
        expect(extractFindings('laboratory', {})).toEqual([]);
        expect(extractFindings('laboratory', { investigations: 'nope' })).toEqual([]);
        expect(extractFindings('laboratory', { investigations: { labs: 'nope' } })).toEqual([]);
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
        const d = disclosure({ findings: 'after_effort', minStudentTurns: 3, requireRoomActivity: false });
        expect(disclosureState({ disclosure: d, studentTurns: 2 }).findingsAllowed).toBe(false);
        expect(disclosureState({ disclosure: d, studentTurns: 3 }).findingsAllowed).toBe(true);
        expect(disclosureState({ disclosure: d, studentTurns: 4 }).findingsAllowed).toBe(true);
    });

    it('enforces requireRoomActivity as a second after_effort condition', () => {
        const d = disclosure({ findings: 'after_effort', minStudentTurns: 1, requireRoomActivity: true });
        expect(disclosureState({ disclosure: d, studentTurns: 5, roomActive: false }))
            .toMatchObject({ findingsAllowed: false, reason: 'after_effort_room_not_visited' });
        expect(disclosureState({ disclosure: d, studentTurns: 5, roomActive: true }))
            .toMatchObject({ findingsAllowed: true, reason: 'after_effort_met' });
    });

    it('names the turn shortfall first when BOTH conditions fail', () => {
        const d = disclosure({ findings: 'after_effort', minStudentTurns: 3, requireRoomActivity: true });
        expect(disclosureState({ disclosure: d, studentTurns: 0, roomActive: false }).reason)
            .toBe('after_effort_turns_below_min');
    });

    // Fail SHUT: a caller that forgets to pass roomActive must not be handed
    // an open gate by a falsy default that happens to read as "fine".
    it('defaults roomActive to closed when the caller omits it', () => {
        const d = disclosure({ findings: 'after_effort', minStudentTurns: 0, requireRoomActivity: true });
        expect(disclosureState({ disclosure: d, studentTurns: 9 }).findingsAllowed).toBe(false);
    });

    it('ignores room activity when the mode is not after_effort', () => {
        const d = disclosure({ findings: 'on_request', requireRoomActivity: true });
        expect(disclosureState({ disclosure: d, studentTurns: 0, roomActive: false }).findingsAllowed).toBe(true);
    });

    it('is closed for an unknown mode or missing disclosure', () => {
        expect(disclosureState({ disclosure: { findings: 'always' }, studentTurns: 10 }).findingsAllowed).toBe(false);
        expect(disclosureState({ disclosure: null, studentTurns: 10 }).findingsAllowed).toBe(false);
    });
});

describe('buildSpecialistBrief', () => {
    const findings = extractFindings('pathology', fullConfig());
    const path = SPECIALTIES.pathologist;

    it('leads with the scope line and lists the findings when allowed', () => {
        const brief = buildSpecialistBrief({ specialty: path, findings, disclosureState: { findingsAllowed: true, reason: 'after_effort_met' } });
        expect(brief.startsWith(BRIEF_HEADER)).toBe(true);
        expect(brief).toContain('the pathology material for this case');
        expect(brief).toContain(BRIEF_NO_PATIENT);
        expect(brief).toContain(BRIEF_FINDINGS_LEAD);
        expect(brief).toContain('- Nests of atypical cells infiltrate the stroma (Activity act-1)');
        expect(brief).not.toContain(BRIEF_WITHHELD);
        expect(brief.trim().endsWith(BRIEF_NO_DIAGNOSIS)).toBe(true);
    });

    it('names each domain\'s own material', () => {
        const material = (type) => buildSpecialistBrief({
            specialty: SPECIALTIES[type], findings: [], disclosureState: { findingsAllowed: true },
        });
        expect(material('cardiologist')).toContain('the ECG tracing(s) for this case');
        expect(material('radiologist')).toContain('the imaging for this case');
        expect(material('laboratorian')).toContain('the laboratory results for this case');
        // An unknown or missing specialty still gets a brief, read generically.
        expect(buildSpecialistBrief({ findings: [], disclosureState: {} })).toContain('the material for this case');
    });

    it('withholds the findings when not allowed, but keeps the scope line', () => {
        const brief = buildSpecialistBrief({ specialty: path, findings, disclosureState: { findingsAllowed: false, reason: 'never' } });
        expect(brief).toContain(BRIEF_NO_PATIENT);
        expect(brief).toContain(BRIEF_WITHHELD);
        expect(brief).not.toContain('Nests of atypical cells');
        expect(brief).toContain(BRIEF_NO_DIAGNOSIS);
    });

    it('says no findings were provided when none were authored', () => {
        const brief = buildSpecialistBrief({ specialty: path, findings: [], disclosureState: { findingsAllowed: true } });
        expect(brief).toContain(BRIEF_NO_FINDINGS);
        expect(brief).not.toContain(BRIEF_FINDINGS_LEAD);
    });

    it('invariant: a brief built from any domain carries no answer-key text', () => {
        for (const type of Object.keys(SPECIALTIES)) {
            const specialty = SPECIALTIES[type];
            const brief = buildSpecialistBrief({
                specialty,
                findings: extractFindings(specialty.domain, fullConfig()),
                disclosureState: { findingsAllowed: true, reason: 'on_request' },
            });
            expect(secretsIn(brief), type).toEqual([]);
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
