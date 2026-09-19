// The two server-built situation blocks: `none` (the agent knows nothing) and
// `handover` (the agent has just come on shift).
//
// These exist because the browser cannot be trusted to withhold. The route
// drops the client's situation for both scopes and calls in here instead, so
// what these functions refuse to say is the whole security property.

import { describe, expect, it } from 'vitest';
import {
    BRIEF_UNBRIEFED,
    HANDOVER_HEADER,
    HANDOVER_LIMITS,
    HANDOVER_NO_DETAILS,
    UNBRIEFED_HEADER,
    buildHandoverBrief,
    buildUnbriefedBlock,
    formatVitals,
} from '../../server/services/situationBrief.js';

describe('the unbriefed block', () => {
    it('denies every category of knowledge by name', () => {
        // A model handed a thin context invents a rich one. Naming each thing
        // it does NOT have is what stops it deciding the patient is 60 with
        // chest pain and an ECG already done.
        const out = buildUnbriefedBlock();
        expect(out).toContain(UNBRIEFED_HEADER);
        for (const denied of [/name/i, /age/i, /symptoms/i, /history/i, /why they presented/i, /ordered/i, /result/i]) {
            expect(BRIEF_UNBRIEFED).toMatch(denied);
        }
    });

    it('names the conversation as the only source, and says to ask', () => {
        expect(BRIEF_UNBRIEFED).toMatch(/what the person you are speaking to tells you/i);
        expect(BRIEF_UNBRIEFED).toMatch(/if you were not told something, you do not know it/i);
        expect(BRIEF_UNBRIEFED).toMatch(/ask/i);
    });

    it('forbids back-filling from what a case like this usually looks like', () => {
        // The specific failure this block was written against.
        expect(BRIEF_UNBRIEFED).toMatch(/never fill a gap with what a case like this usually looks like/i);
    });

    it('carries no case content of any kind', () => {
        expect(buildUnbriefedBlock()).not.toMatch(/patient:|reason for admission|observations/i);
    });
});

describe('formatVitals', () => {
    it('renders the recorded observations with their units', () => {
        expect(formatVitals({ hr: 118, rhythm: 'sinus tachycardia', spo2: 91, bp_sys: 90, bp_dia: 60, rr: 24, temp: 37.1, etco2: 35 }))
            .toBe('HR 118/min, rhythm sinus tachycardia, BP 90/60 mmHg, SpO2 91%, RR 24/min, temp 37.1 C, EtCO2 35 mmHg');
    });

    // Regression lock: a NULL column is not a vital sign of zero.
    //
    // `Number(null)` is 0 and `Number('')` is 0, and both are finite — so a
    // plain Number.isFinite guard reported an unrecorded EtCO2 to the agent as
    // "EtCO2 0 mmHg", a value incompatible with life, invented out of an empty
    // column. Same family as the `configuredMinSec || 60` incident in
    // docs/design/agent-behaviour-model.md §9.
    it('omits an unrecorded vital instead of reporting it as zero', () => {
        const out = formatVitals({ hr: 118, spo2: 91, bp_sys: 90, bp_dia: 60, etco2: null, temp: undefined, rr: '' });
        expect(out).toBe('HR 118/min, BP 90/60 mmHg, SpO2 91%');
        expect(out).not.toMatch(/EtCO2|temp|RR/);
    });

    it('still reports a genuine recorded zero', () => {
        // An asystolic heart rate is data, not a missing value. The guard must
        // distinguish "not recorded" from "recorded as 0".
        expect(formatVitals({ hr: 0, spo2: 0 })).toBe('HR 0/min, SpO2 0%');
    });

    it('needs both halves of a blood pressure before it reports one', () => {
        expect(formatVitals({ bp_sys: 90 })).toBe('');
        expect(formatVitals({ bp_dia: 60 })).toBe('');
    });

    it('returns empty for no row, a non-row, or an all-null row', () => {
        expect(formatVitals(null)).toBe('');
        expect(formatVitals('118')).toBe('');
        expect(formatVitals({ hr: null, spo2: null })).toBe('');
    });
});

describe('the handover brief', () => {
    const handed = {
        patient: { name: 'Ada Example', age: 54, gender: 'Female' },
        reason: 'central chest pain for two hours',
        vitals: 'HR 118/min, BP 90/60 mmHg',
    };

    it('hands over who the patient is, why they are here, and the observations', () => {
        const out = buildHandoverBrief(handed);
        expect(out).toContain(HANDOVER_HEADER);
        expect(out).toContain('Patient: Ada Example, 54 years old, Female.');
        expect(out).toContain('Reason for admission: central chest pain for two hours.');
        expect(out).toContain('Last recorded observations: HR 118/min, BP 90/60 mmHg.');
        expect(out).toContain(HANDOVER_LIMITS);
    });

    it('renders a numeric age', () => {
        // Regression lock: `cases.patient_age` is an INTEGER column, and a
        // string-only clean dropped every age silently.
        expect(buildHandoverBrief({ patient: { age: 54 } })).toContain('54 years old');
    });

    // The invariant that makes `handover` mean anything. A nurse coming on
    // shift is handed a patient, not a workup.
    it('carries no history, no results and no answer key, whatever is passed', () => {
        const out = buildHandoverBrief({
            ...handed,
            // Fields a future caller might be tempted to spread in. The
            // builder reads an explicit allow-list, so none of them appear.
            history: 'twenty years of hypertension',
            diagnosis: 'Anterior STEMI',
            labs: 'Troponin I 2.1 ng/mL',
        });
        expect(out).not.toContain('hypertension');
        expect(out).not.toContain('STEMI');
        expect(out).not.toContain('Troponin');
    });

    it('states the handover is exhaustive and tells the agent to ask', () => {
        const out = buildHandoverBrief(handed);
        expect(out).toMatch(/that is the whole handover/i);
        expect(out).toMatch(/say so and ask rather than assuming/i);
    });

    it('omits a line it was given nothing for', () => {
        const out = buildHandoverBrief({ patient: { name: 'Ada Example' } });
        expect(out).toContain('Patient: Ada Example.');
        expect(out).not.toContain('Reason for admission');
        expect(out).not.toContain('Last recorded observations');
    });

    it('still produces a coherent block for a case with no details at all', () => {
        // The limits line is what does the pedagogical work, so it must
        // survive an empty case rather than leaving a bare header.
        for (const empty of [{}, undefined, { patient: null, reason: '', vitals: '' }]) {
            const out = buildHandoverBrief(empty);
            expect(out).toContain(HANDOVER_HEADER);
            expect(out).toContain(HANDOVER_NO_DETAILS);
            expect(out).toContain(HANDOVER_LIMITS);
        }
    });
});
