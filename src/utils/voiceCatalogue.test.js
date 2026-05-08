import { describe, expect, it } from 'vitest';
import {
    normalizeVoiceGender,
    voiceMatchesSlot,
    voicesForSlot,
    voiceSlotForDemographics
} from './voiceCatalogue.js';

describe('voiceCatalogue gender matching', () => {
    const voices = [
        { filename: 'en_US-amy-medium.onnx', displayName: 'Amy' },
        { filename: 'en_US-ryan-medium.onnx', displayName: 'Ryan' },
        { filename: 'alloy', displayName: 'Alloy', gender: 'neutral' },
        { filename: 'unknown-voice', displayName: 'Custom' },
    ];

    it('derives patient slots from demographics', () => {
        expect(voiceSlotForDemographics('female', 40)).toBe('female');
        expect(voiceSlotForDemographics('male', 40)).toBe('male');
        expect(voiceSlotForDemographics('male', 8)).toBe('child');
    });

    it('normalizes explicit and inferred voice genders', () => {
        expect(normalizeVoiceGender({ filename: 'x', gender: 'Female' })).toBe('female');
        expect(normalizeVoiceGender({ filename: 'en_US-ryan-medium.onnx' })).toBe('male');
        expect(normalizeVoiceGender({ filename: 'en_US-amy-medium.onnx' })).toBe('female');
        expect(normalizeVoiceGender({ filename: 'alloy', gender: 'neutral' })).toBe('neutral');
    });

    it('filters known opposite-gender voices while keeping neutral and unknown voices', () => {
        const male = voicesForSlot(voices, 'male').map(v => v.filename);
        expect(male).toContain('en_US-ryan-medium.onnx');
        expect(male).toContain('alloy');
        expect(male).toContain('unknown-voice');
        expect(male).not.toContain('en_US-amy-medium.onnx');

        const female = voicesForSlot(voices, 'female').map(v => v.filename);
        expect(female).toContain('en_US-amy-medium.onnx');
        expect(female).not.toContain('en_US-ryan-medium.onnx');
    });

    it('keeps a mismatched saved selection visible so it can be corrected', () => {
        const male = voicesForSlot(voices, 'male', 'en_US-amy-medium.onnx').map(v => v.filename);
        expect(male[0]).toBe('en_US-amy-medium.onnx');
        expect(male).toContain('en_US-ryan-medium.onnx');
    });

    it('matches child slots to child/female/neutral/unknown voices', () => {
        expect(voiceMatchesSlot({ filename: 'kid.onnx', gender: 'child' }, 'child')).toBe(true);
        expect(voiceMatchesSlot({ filename: 'en_US-amy-medium.onnx' }, 'child')).toBe(true);
        expect(voiceMatchesSlot({ filename: 'en_US-ryan-medium.onnx' }, 'child')).toBe(false);
    });
});
