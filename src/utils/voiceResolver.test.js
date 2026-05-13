// Tests for src/utils/voiceResolver.js — the post-2026-05-13 contract.
//
// The resolver has TWO named tiers:
//   1. voice.case_voice                         → tier='override'
//   2. voiceSettings.voice_<provider>_<slot>    → tier='platform-slot'
// Tier 2 only fires when gender/age are supplied. Anything else returns
// file:null. Provider is read only from voiceSettings.tts_provider.

import { describe, it, expect } from 'vitest';
import { resolveVoice, deriveSlot } from './voiceResolver.js';

describe('resolveVoice — tier 1: case_voice override', () => {
    it('returns the voice.case_voice when present', () => {
        const r = resolveVoice({
            voice: { case_voice: 'af_bella' },
            voiceSettings: { tts_provider: 'kokoro' }
        });
        expect(r.file).toBe('af_bella');
        expect(r.tier).toBe('override');
        expect(r.provider).toBe('kokoro');
    });

    it('ignores voice.tts_provider and reads provider from voiceSettings only', () => {
        const r = resolveVoice({
            voice: { case_voice: 'foo', tts_provider: 'google' },
            voiceSettings: { tts_provider: 'kokoro' }
        });
        expect(r.provider).toBe('kokoro');
    });

    it('treats empty/null/undefined case_voice as "not set"', () => {
        for (const value of ['', null, undefined]) {
            const r = resolveVoice({
                voice: { case_voice: value },
                voiceSettings: { tts_provider: 'kokoro' }
            });
            expect(r.file).toBeNull();
            expect(r.tier).toBeNull();
        }
    });
});

describe('resolveVoice — tier 2: platform slot for the speaker demographic', () => {
    it('picks voice_<provider>_<slot> when no case_voice is set and gender is supplied', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: {
                tts_provider: 'google',
                voice_google_female: 'en-US-Neural2-F',
                voice_google_male: 'en-US-Chirp3-HD-Charon',
            },
            gender: 'female',
            age: 35,
        });
        expect(r.file).toBe('en-US-Neural2-F');
        expect(r.tier).toBe('platform-slot');
        expect(r.slot).toBe('female');
    });

    it('child slot wins over gender when age < 13', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: {
                tts_provider: 'google',
                voice_google_female: 'en-US-Neural2-F',
                voice_google_child: 'en-US-Chirp-HD-O',
            },
            gender: 'female',
            age: 8,
        });
        expect(r.file).toBe('en-US-Chirp-HD-O');
        expect(r.slot).toBe('child');
    });

    it('case_voice override beats the platform slot', () => {
        const r = resolveVoice({
            voice: { case_voice: 'en-US-Casey' },
            voiceSettings: {
                tts_provider: 'google',
                voice_google_female: 'en-US-Neural2-F',
            },
            gender: 'female',
            age: 35,
        });
        expect(r.file).toBe('en-US-Casey');
        expect(r.tier).toBe('override');
    });

    it('returns file:null when the slot for that demographic is unset', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: {
                tts_provider: 'google',
                voice_google_male: 'en-US-Charon',
                // voice_google_female intentionally missing
            },
            gender: 'female',
            age: 35,
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
        expect(r.slot).toBe('female');
    });

    it('returns file:null when the slot is set to an empty string', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: { tts_provider: 'kokoro', voice_kokoro_male: '   ' },
            gender: 'male',
            age: 40,
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
    });

    it('does NOT attempt tier 2 when caller omits gender and age', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: {
                tts_provider: 'google',
                voice_google_male: 'en-US-Charon',
                voice_google_female: 'en-US-Neural2-F',
            },
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
        expect(r.slot).toBeNull();
    });

    it('does NOT attempt tier 2 when provider is unset, even if gender is given', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: { voice_google_female: 'en-US-Neural2-F' },
            gender: 'female',
            age: 35,
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
    });
});

describe('resolveVoice — provider sourcing', () => {
    it('returns null provider when voiceSettings has none configured', () => {
        const r = resolveVoice({
            voice: { case_voice: 'af_bella' },
            voiceSettings: {}
        });
        expect(r.file).toBe('af_bella');
        expect(r.provider).toBeNull();
    });

    it('returns null provider when voiceSettings is null', () => {
        const r = resolveVoice({ voice: { case_voice: 'x' } });
        expect(r.provider).toBeNull();
    });
});

describe('resolveVoice — rate and pitch', () => {
    it('per-character rate/pitch wins over platform values', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x', tts_rate: 0.8, tts_pitch: 2 },
            voiceSettings: { tts_provider: 'kokoro', tts_rate: 1.2, tts_pitch: 0 }
        });
        expect(r.rate).toBe(0.8);
        expect(r.pitch).toBe(2);
    });

    it('falls back to platform rate/pitch when per-character is unset', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x' },
            voiceSettings: { tts_provider: 'kokoro', tts_rate: 1.2, tts_pitch: -1 }
        });
        expect(r.rate).toBe(1.2);
        expect(r.pitch).toBe(-1);
    });

    it('returns undefined when neither layer provides a value', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x' },
            voiceSettings: { tts_provider: 'kokoro' }
        });
        expect(r.rate).toBeUndefined();
        expect(r.pitch).toBeUndefined();
    });

    it('treats non-numeric values as unset (skips them)', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x', tts_rate: '', tts_pitch: 'nope' },
            voiceSettings: { tts_provider: 'kokoro', tts_rate: 1.05 }
        });
        expect(r.rate).toBe(1.05);
        expect(r.pitch).toBeUndefined();
    });
});

describe('deriveSlot — preserved for UI labels (not used by the resolver)', () => {
    it('maps demographics to a slot tag', () => {
        expect(deriveSlot('female', 30)).toBe('female');
        expect(deriveSlot('male', 30)).toBe('male');
        expect(deriveSlot('female', 8)).toBe('child');
    });
});
