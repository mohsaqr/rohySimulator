// buildAffectSignal: pure snapshot+settings → wire-signal builder (Plan A).
import { describe, it, expect } from 'vitest';
import { buildAffectSignal } from './affectSignal.js';
import { ANXIOUS_FLAG_THRESHOLD } from '../components/oyon/anxiousIndex.js';

const NOW = 1_000_000;
const sample = (over = {}) => ({
    dominant: 'fear', confidence: 0.8, valence: -0.5, arousal: 0.6,
    anxiousIndex: 0.7, ts: NOW - 1000, ...over,
});
const snap = (over = {}) => ({ sample: sample(over), windows: [] });
const anxiousSettings = { enabled: true, affect_mode: 'anxious', min_confidence: 0.4, max_age_ms: 20000 };
const dominantSettings = { ...anxiousSettings, affect_mode: 'dominant' };

describe('buildAffectSignal', () => {
    it('builds an anxious signal above the flag threshold', () => {
        expect(buildAffectSignal(snap(), anxiousSettings, NOW)).toEqual({
            mode: 'anxious', anxious: true, confidence: 0.8, age_ms: 1000,
        });
    });

    it('flags calm below the threshold and honours the exact threshold', () => {
        expect(buildAffectSignal(snap({ anxiousIndex: 0.1 }), anxiousSettings, NOW).anxious).toBe(false);
        expect(buildAffectSignal(snap({ anxiousIndex: ANXIOUS_FLAG_THRESHOLD }), anxiousSettings, NOW).anxious).toBe(true);
    });

    it('routes nothing when the anxious index is unknown (null ≠ 0)', () => {
        expect(buildAffectSignal(snap({ anxiousIndex: null }), anxiousSettings, NOW)).toBeNull();
    });

    it('builds a dominant signal with the canonicalized label', () => {
        expect(buildAffectSignal(snap({ dominant: 'Angry' }), dominantSettings, NOW)).toEqual({
            mode: 'dominant', label: 'anger', confidence: 0.8, age_ms: 1000,
        });
    });

    it('routes nothing for a non-canonical dominant label', () => {
        expect(buildAffectSignal(snap({ dominant: 'confused' }), dominantSettings, NOW)).toBeNull();
        expect(buildAffectSignal(snap({ dominant: null }), dominantSettings, NOW)).toBeNull();
    });

    it('routes nothing when disabled, off, or mode unknown', () => {
        expect(buildAffectSignal(snap(), null, NOW)).toBeNull();
        expect(buildAffectSignal(snap(), { ...anxiousSettings, enabled: false }, NOW)).toBeNull();
        expect(buildAffectSignal(snap(), { ...anxiousSettings, affect_mode: 'off' }, NOW)).toBeNull();
        expect(buildAffectSignal(snap(), { ...anxiousSettings, affect_mode: 'aggregate' }, NOW)).toBeNull();
    });

    it('routes nothing without a snapshot or usable timestamp', () => {
        expect(buildAffectSignal(null, anxiousSettings, NOW)).toBeNull();
        expect(buildAffectSignal({ sample: null }, anxiousSettings, NOW)).toBeNull();
        expect(buildAffectSignal(snap({ ts: NaN }), anxiousSettings, NOW)).toBeNull();
    });

    it('drops stale samples per max_age_ms', () => {
        expect(buildAffectSignal(snap({ ts: NOW - 20001 }), anxiousSettings, NOW)).toBeNull();
        expect(buildAffectSignal(snap({ ts: NOW - 19999 }), anxiousSettings, NOW)).not.toBeNull();
    });

    it('drops low-confidence samples and treats missing confidence as 0', () => {
        expect(buildAffectSignal(snap({ confidence: 0.3 }), anxiousSettings, NOW)).toBeNull();
        expect(buildAffectSignal(snap({ confidence: null }), anxiousSettings, NOW)).toBeNull();
    });
});
