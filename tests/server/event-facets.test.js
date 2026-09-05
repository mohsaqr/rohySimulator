// Completeness: for EVERY registered verb — rohy's and every plugin's — every
// analytics consumer returns a curated value, never its default bucket.
//
// This is the test that makes "single source of truth" enforceable. Before
// the facet registry, 46 plugin verbs and ~20 rohy verbs rendered as 'Other'
// in the clinical-action lens, 'Administration' in the medical-domain lens,
// a raw verb that the rare-verb pass collapsed to 'OTHER' in TNA sequences,
// and 'Navigation' in the cohort pulse — while resolving correctly in the
// clinical-state lens beside them. Each of those defaults is asserted absent
// here for every verb the registry knows.
import { describe, it, expect } from 'vitest';
import {
    LEARNING_VERBS, CLINICAL_STATES, OBJECT_TYPES, COMPONENTS, OBJECT_TYPE_FACETS,
    VERB_FALLBACKS, OBJECT_OVERRIDES, DEFAULT_INTERPRETATIONS, TNA_MERGE_MAP,
    resolveClinicalState, clinicalAction, medicalDomain, fineLabel, activityLabel,
    tnaMergeTarget, pulseBucket, LENSES, ROOMS, roomLabel, roomLabelKey,
} from '../../server/shared/eventFacets.js';
import { TNA_BUCKETS, PULSE_BUCKETS, CLINICAL_ACTIONS, MEDICAL_DOMAINS } from '../../server/shared/learningVerbFacets.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { CORE_ROOM_KEYS } from '../../server/shared/pluginRegistry.js';

describe('every registered verb resolves in every lens', () => {
    it.each(LEARNING_VERBS)('%s', (verb) => {
        // With no object type, so the verb's own facet is what answers.
        const state = resolveClinicalState(verb, '');
        expect(CLINICAL_STATES, 'clinical-state').toContain(state);
        expect(CLINICAL_ACTIONS, 'clinical-action').toContain(clinicalAction(verb, ''));
        expect(clinicalAction(verb, '')).not.toBe('Other');
        expect(MEDICAL_DOMAINS, 'medical-domain').toContain(medicalDomain(verb, ''));
        const label = fineLabel(verb, '');
        expect(label, 'fine').toMatch(/\S/);
        expect(label).not.toBe('Unknown');
        const tna = tnaMergeTarget(verb);
        expect(tna === null || TNA_BUCKETS.includes(tna), `tna=${tna}`).toBe(true);
        expect(tna, 'tna target is defined (null means drop, undefined means unregistered)').not.toBeUndefined();
        expect(PULSE_BUCKETS, 'pulse').toContain(pulseBucket(verb, ''));
        for (const lens of LENSES) expect(activityLabel(verb, 'thing', lens), lens).toMatch(/\S/);
    });
});

describe('the derived maps agree with each other', () => {
    it('VERB_FALLBACKS covers every verb with a canonical state', () => {
        for (const verb of LEARNING_VERBS) expect(CLINICAL_STATES, verb).toContain(VERB_FALLBACKS[verb]);
    });
    it('OBJECT_OVERRIDES and DEFAULT_INTERPRETATIONS only name canonical states', () => {
        for (const state of Object.values(OBJECT_OVERRIDES)) expect(CLINICAL_STATES).toContain(state);
        for (const state of Object.values(DEFAULT_INTERPRETATIONS)) expect(CLINICAL_STATES).toContain(state);
    });
    it('TNA_MERGE_MAP is total over the registry', () => {
        expect(Object.keys(TNA_MERGE_MAP).sort()).toEqual([...LEARNING_VERBS].sort());
    });
    it('plugin verbs resolve to real states with their own object types, never a literal bucket', () => {
        PLUGIN_MANIFESTS.forEach((m) => {
            const objectType = Object.values(m.vocabulary.objectTypes)[0];
            Object.keys(m.vocabulary.verbs).forEach((verb) => {
                expect(resolveClinicalState(verb, objectType)).not.toBe(`${verb}_${objectType}`);
                expect(clinicalAction(verb, objectType)).not.toBe('Other');
            });
        });
    });
});

describe('resolution chain', () => {
    it('explicit pair > object > verb > visible literal', () => {
        expect(resolveClinicalState('OPENED', 'physical_exam')).toBe('examining');
        expect(resolveClinicalState('VIEWED', 'vital_sign')).toBe('monitoring');
        expect(resolveClinicalState('ORDERED_LAB', 'unknown_thing')).toBe('investigating');
        expect(resolveClinicalState('UNK_VERB', 'unk_object')).toBe('UNK_VERB_unk_object');
        expect(resolveClinicalState('', '')).toBe('navigating');
    });
    it('a custom map overrides per call', () => {
        const custom = { ...DEFAULT_INTERPRETATIONS, 'ORDERED_LAB:lab_test': 'reflecting' };
        expect(resolveClinicalState('ORDERED_LAB', 'lab_test', custom)).toBe('reflecting');
    });
    it('an unregistered verb is visible, not absorbed', () => {
        expect(clinicalAction('WAT', 'zzz')).toBe('Other');
        expect(fineLabel('SOME_NEW_VERB', 'thing')).toBe('Some new verb');
        expect(tnaMergeTarget('WAT')).toBeUndefined();
        expect(pulseBucket('WAT', 'zzz')).toBeNull();
    });
    it('the object decides the pulse bucket before the verb', () => {
        expect(pulseBucket('SENT_MESSAGE', 'chat_message')).toBe('Communication');
        expect(pulseBucket('SENT_MESSAGE', 'debrief')).toBe('Debrief');
        expect(pulseBucket('VIEWED', 'patient_record')).toBe('Assessment');
        expect(pulseBucket('ORDERED_LAB', 'lab_test')).toBe('Investigations');
        expect(pulseBucket('ORDERED_TREATMENT', 'treatment')).toBe('Orders & treatment');
        expect(pulseBucket('OPENED_SLIDE', 'slide')).not.toBe('Navigation');
    });
});

describe('object types, components and rooms', () => {
    it('OBJECT_TYPES and COMPONENTS fold every plugin declaration', () => {
        PLUGIN_MANIFESTS.forEach((m) => {
            Object.entries(m.vocabulary.objectTypes || {}).forEach(([k, v]) => expect(OBJECT_TYPES[k]).toBe(v));
            Object.entries(m.vocabulary.components || {}).forEach(([k, v]) => expect(COMPONENTS[k]).toBe(v));
        });
        expect(OBJECT_TYPES.SESSION).toBe('session');
        expect(COMPONENTS.APP).toBe('App');
    });
    it('OBJECT_TYPE_FACETS carries the plugin object overrides', () => {
        PLUGIN_MANIFESTS.forEach((m) => {
            Object.entries(m.states?.objectOverrides || {}).forEach(([type, state]) => {
                expect(OBJECT_TYPE_FACETS[type]?.clinicalState).toBe(state);
            });
        });
    });
    it('every core room, every plugin room and lessons have a label', () => {
        for (const key of CORE_ROOM_KEYS) expect(roomLabel(key)).toMatch(/\S/);
        for (const m of PLUGIN_MANIFESTS) {
            expect(ROOMS[m.id]).toBeTruthy();
            expect(roomLabelKey(m.id)).toBe(m.room.labelKey);
        }
        expect(roomLabel('lessons')).toBe('Lessons');
        expect(roomLabel('consultant')).toBe('Discussant');
        expect(roomLabel('')).toBeNull();
        expect(roomLabel('gone_plugin')).toBe('Gone_plugin');
    });
});
