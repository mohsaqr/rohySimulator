// Unit tests for the clinical-state resolver chain. Locks the precedence
// order: explicit map > object_type override > verb fallback > literal
// fallback. Mirrors LAILA's `resolveInterpretation` test pattern.

import { describe, it, expect } from 'vitest';
import {
    CLINICAL_STATES,
    DEFAULT_INTERPRETATIONS,
    OBJECT_OVERRIDES,
    VERB_FALLBACKS,
    resolveClinicalState,
} from './clinicalStates';

describe('clinicalStates resolver', () => {
    it('lists exactly the ten canonical states', () => {
        expect(CLINICAL_STATES).toHaveLength(10);
        expect(CLINICAL_STATES).toContain('assessing');
        expect(CLINICAL_STATES).toContain('treating');
        expect(CLINICAL_STATES).toContain('monitoring');
    });

    it('explicit verb:object map wins', () => {
        // OPENED → navigating by verb; physical_exam → examining by object;
        // OPENED:physical_exam is in DEFAULT_INTERPRETATIONS as examining
        expect(resolveClinicalState('OPENED', 'physical_exam')).toBe('examining');
        expect(DEFAULT_INTERPRETATIONS['OPENED:physical_exam']).toBe('examining');
    });

    it('object_type override beats verb fallback', () => {
        // VIEWED is generic navigation by verb; vital_sign forces monitoring.
        expect(resolveClinicalState('VIEWED', 'vital_sign')).toBe('monitoring');
        expect(OBJECT_OVERRIDES.vital_sign).toBe('monitoring');
    });

    it('verb fallback fires when no object override', () => {
        // unknown_object_type → no object override; ORDERED_LAB → investigating.
        expect(resolveClinicalState('ORDERED_LAB', 'unknown_thing')).toBe('investigating');
        expect(VERB_FALLBACKS.ORDERED_LAB).toBe('investigating');
    });

    it('falls through to literal verb_object when nothing matches', () => {
        expect(resolveClinicalState('UNK_VERB', 'unk_object')).toBe('UNK_VERB_unk_object');
    });

    it('emits navigating when both verb + object are empty', () => {
        expect(resolveClinicalState('', '')).toBe('navigating');
    });

    it('respects custom map override per call', () => {
        const custom = { ...DEFAULT_INTERPRETATIONS, 'ORDERED_LAB:lab_test': 'reflecting' };
        expect(resolveClinicalState('ORDERED_LAB', 'lab_test', custom)).toBe('reflecting');
    });

    it('every state in DEFAULT_INTERPRETATIONS is one of the canonical 10', () => {
        const canonical = new Set(CLINICAL_STATES);
        for (const state of Object.values(DEFAULT_INTERPRETATIONS)) {
            expect(canonical.has(state)).toBe(true);
        }
    });

    it('every state in VERB_FALLBACKS is canonical', () => {
        const canonical = new Set(CLINICAL_STATES);
        for (const state of Object.values(VERB_FALLBACKS)) {
            expect(canonical.has(state)).toBe(true);
        }
    });

    it('every state in OBJECT_OVERRIDES is canonical', () => {
        const canonical = new Set(CLINICAL_STATES);
        for (const state of Object.values(OBJECT_OVERRIDES)) {
            expect(canonical.has(state)).toBe(true);
        }
    });
});
