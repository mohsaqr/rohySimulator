import { describe, it, expect } from 'vitest';
import {
    ACTIVITY_MAPPINGS, ACTIVITY_MAPPING_IDS, DEFAULT_ACTIVITY_MAPPING,
    ACTION_TO_DOMAIN, clinicalAction, medicalDomain, fineLabel, resolveActivityLabel,
} from './activityMappings';

describe('activityMappings registry', () => {
    it('exposes the seven lenses with the clinical-state default first', () => {
        expect(ACTIVITY_MAPPINGS).toHaveLength(7);
        expect(ACTIVITY_MAPPING_IDS).toEqual([
            'clinical-state', 'clinical-action', 'medical-domain', 'fine', 'verb', 'object', 'raw',
        ]);
        expect(DEFAULT_ACTIVITY_MAPPING).toBe('clinical-state');
    });
});

describe('clinical-action lens', () => {
    it('splits assessing into History vs Reading results by verb', () => {
        expect(clinicalAction('VIEWED_HISTORY', 'patient_record')).toBe('History');
        expect(clinicalAction('VIEWED_LAB_RESULT', 'lab_result')).toBe('Reading results');
        expect(clinicalAction('VIEWED_RADIOLOGY_RESULT', 'radiology_result')).toBe('Reading results');
    });
    it('maps ordering / treating / examining / monitoring', () => {
        expect(clinicalAction('ORDERED_LAB', 'lab_test')).toBe('Ordering');
        expect(clinicalAction('ORDERED_IMAGING', 'radiology_order')).toBe('Ordering');
        expect(clinicalAction('ORDERED_MEDICATION', 'medication')).toBe('Treating');
        expect(clinicalAction('PERFORMED_PHYSICAL_EXAM', 'physical_exam')).toBe('Examining');
        expect(clinicalAction('ACKNOWLEDGED_ALARM', 'alarm')).toBe('Monitoring');
    });
    it('debrief object beats the chat verb (Debriefing, not Communicating)', () => {
        expect(clinicalAction('SENT_MESSAGE', 'chat_message')).toBe('Communicating');
        expect(clinicalAction('SENT_MESSAGE', 'debrief')).toBe('Debriefing');
    });
    it('unknown verb falls back to Other', () => {
        expect(clinicalAction('WAT', 'zzz')).toBe('Other');
    });
});

describe('medical-domain lens (coarsening of clinical-action)', () => {
    it('every clinical-action maps to a domain', () => {
        for (const action of Object.values({
            a: 'History', b: 'Examining', c: 'Reading results', d: 'Ordering', e: 'Treating',
            f: 'Monitoring', g: 'Communicating', h: 'Debriefing', i: 'Documenting', j: 'Session', k: 'Navigating',
        })) {
            expect(ACTION_TO_DOMAIN[action]).toBeTruthy();
        }
    });
    it('collapses assessment-family actions into Assessment', () => {
        expect(medicalDomain('VIEWED_HISTORY', 'patient_record')).toBe('Assessment');
        expect(medicalDomain('PERFORMED_PHYSICAL_EXAM', 'physical_exam')).toBe('Assessment');
        expect(medicalDomain('VIEWED_LAB_RESULT', 'lab_result')).toBe('Assessment');
        expect(medicalDomain('ORDERED_LAB', 'lab_test')).toBe('Diagnostics');
        expect(medicalDomain('ORDERED_MEDICATION', 'medication')).toBe('Therapeutics');
    });
});

describe('fine-grained lens', () => {
    it('gives distinct readable labels for order vs read vs administer', () => {
        expect(fineLabel('ORDERED_LAB', 'lab_test')).toBe('Ordered lab');
        expect(fineLabel('ORDERED_IMAGING', 'radiology_order')).toBe('Ordered radiology');
        expect(fineLabel('VIEWED_LAB_RESULT', 'lab_result')).toBe('Read lab result');
        expect(fineLabel('VIEWED_RADIOLOGY_RESULT', 'radiology_result')).toBe('Read radiology');
        expect(fineLabel('ORDERED_MEDICATION', 'medication')).toBe('Ordered medication');
        expect(fineLabel('ADMINISTERED_MEDICATION', 'treatment')).toBe('Gave medication');
        expect(fineLabel('VIEWED_HISTORY', 'patient_record')).toBe('Read history');
    });
    it('disambiguates chat vs debrief messages', () => {
        expect(fineLabel('SENT_MESSAGE', 'chat_message')).toBe('Messaged patient');
        expect(fineLabel('SENT_MESSAGE', 'debrief')).toBe('Asked in debrief');
        expect(fineLabel('RECEIVED_MESSAGE', 'debrief')).toBe('Debrief reply');
    });
    it('humanizes unknown verbs as a readable fallback', () => {
        expect(fineLabel('SOME_NEW_VERB', 'thing')).toBe('Some new verb');
    });
});

describe('resolveActivityLabel dispatch', () => {
    const cases = [
        ['clinical-state', 'ORDERED_MEDICATION', 'medication', 'treating'],
        ['clinical-action', 'ORDERED_MEDICATION', 'medication', 'Treating'],
        ['medical-domain', 'ORDERED_MEDICATION', 'medication', 'Therapeutics'],
        ['fine', 'ORDERED_MEDICATION', 'medication', 'Ordered medication'],
        ['verb', 'ORDERED_MEDICATION', 'medication', 'ORDERED_MEDICATION'],
        ['object', 'ORDERED_MEDICATION', 'medication', 'medication'],
        ['raw', 'ORDERED_MEDICATION', 'medication', 'ORDERED_MEDICATION:medication'],
    ];
    it.each(cases)('%s lens labels an ordered medication as %s', (mapping, verb, obj, expected) => {
        expect(resolveActivityLabel(verb, obj, mapping)).toBe(expected);
    });
    it('defaults to clinical-state', () => {
        expect(resolveActivityLabel('ORDERED_LAB', 'lab_test')).toBe('investigating');
    });
});
