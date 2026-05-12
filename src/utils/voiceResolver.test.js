// Tests for src/utils/voiceResolver.js — the post-2026-05-12 contract.
//
// The resolver has exactly one tier: voice.case_voice → file. Anything else
// returns file:null. Provider is read only from voiceSettings.tts_provider.
// No slot logic, no per-provider hardcoded map, no catalogue fallback.

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

describe('resolveVoice — no fallback below tier 1', () => {
    it('returns file:null when nothing matches — no hardcoded provider voice', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: { tts_provider: 'kokoro' }
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
        // Provider is still surfaced so the caller can build a helpful error
        // ("No voice configured for provider X. Set one in …").
        expect(r.provider).toBe('kokoro');
    });

    it('extra args from older callsites (gender / age / platformAvatars / ttsVoices) are ignored', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: { tts_provider: 'kokoro' },
            gender: 'female',
            age: 8,
            platformAvatars: { default_voice_kokoro_child: 'af_bella' },
            ttsVoices: [{ filename: 'whatever' }]
        });
        expect(r.file).toBeNull();
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
