// Tests for src/utils/voiceResolver.js — the post-2026-05-13 contract.
//
// The resolver has exactly one tier: voice.case_voice → file. Anything else
// returns file:null. Provider is read only from voiceSettings.tts_provider.
// No slot logic, no per-provider hardcoded map, no catalogue fallback.

import { describe, it, expect, vi } from 'vitest';
import { resolveVoice, deriveSlot, isVoiceValidForProvider, voiceLanguage, voiceMatchesLanguage } from './voiceResolver.js';

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

    it('extra args (gender / age / platformAvatars / ttsVoices) are ignored — no slot lookup', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: { tts_provider: 'google', voice_google_female: 'en-US-Neural2-F' },
            gender: 'female',
            age: 35,
            platformAvatars: { default_voice_kokoro_child: 'af_bella' },
            ttsVoices: [{ filename: 'whatever' }]
        });
        // Tier 2 was tried briefly on 2026-05-13 and reverted the same day —
        // shipped personas now carry their own case_voice; the slot mechanism
        // is deliberately not consulted.
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

describe('resolveVoice — isValid validator (cross-provider guard)', () => {
    // CONTRACT (migration 0022 + companion code): when callers supply an
    // `isValid` function and it rejects the requested case_voice, the
    // resolver returns tier='invalid' + file=null. That ends the
    // three-week saga of stale provider voices reaching /api/tts and
    // surfacing as runtime toasts — the resolver itself becomes the
    // gate, so the caller can fall back to the template silently.
    it('returns tier=override when isValid is omitted (backward compatible)', () => {
        const r = resolveVoice({
            voice: { case_voice: 'en-US-Neural2-J' },
            voiceSettings: { tts_provider: 'kokoro' }
        });
        expect(r.file).toBe('en-US-Neural2-J');
        expect(r.tier).toBe('override');
    });

    it('returns tier=invalid when isValid rejects the requested voice', () => {
        const r = resolveVoice({
            voice: { case_voice: 'en-US-Neural2-J' },
            voiceSettings: { tts_provider: 'kokoro' },
            isValid: () => false,
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBe('invalid');
    });

    it('returns tier=override when isValid approves the voice', () => {
        const r = resolveVoice({
            voice: { case_voice: 'am_michael' },
            voiceSettings: { tts_provider: 'kokoro' },
            isValid: () => true,
        });
        expect(r.file).toBe('am_michael');
        expect(r.tier).toBe('override');
    });

    it('isValid is not called when no case_voice is set (no false-positive invalid)', () => {
        const isValid = vi.fn(() => false);
        const r = resolveVoice({
            voice: {},
            voiceSettings: { tts_provider: 'kokoro' },
            isValid,
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
        expect(isValid).not.toHaveBeenCalled();
    });
});

describe('isVoiceValidForProvider — pattern-based provider check', () => {
    // CONTRACT: cheap pattern guard so the resolver can reject a Google
    // voice id under the Kokoro provider without a network round-trip.
    // Brittle if a provider introduces new id shapes; callers can pass
    // their own `isValid` to bypass.
    it('accepts a Kokoro id under kokoro', () => {
        expect(isVoiceValidForProvider('am_michael', 'kokoro')).toBe(true);
        expect(isVoiceValidForProvider('af_bella',   'kokoro')).toBe(true);
        expect(isVoiceValidForProvider('bm_lewis',   'kokoro')).toBe(true);
        expect(isVoiceValidForProvider('bf_emma',    'kokoro')).toBe(true);
    });

    it('rejects a Google id under kokoro (the STEMI bug)', () => {
        expect(isVoiceValidForProvider('en-US-Neural2-J', 'kokoro')).toBe(false);
        expect(isVoiceValidForProvider('en-US-Neural2-C', 'kokoro')).toBe(false);
    });

    it('rejects a Piper filename under kokoro', () => {
        expect(isVoiceValidForProvider('en_US-amy-medium.onnx', 'kokoro')).toBe(false);
    });

    it('accepts Google ids under google', () => {
        expect(isVoiceValidForProvider('en-US-Neural2-J',       'google')).toBe(true);
        expect(isVoiceValidForProvider('en-US-Chirp3-HD-Orus',  'google')).toBe(true);
    });

    it('accepts Piper .onnx filenames under piper', () => {
        expect(isVoiceValidForProvider('en_US-amy-medium.onnx', 'piper')).toBe(true);
    });

    it('accepts known OpenAI voices under openai', () => {
        expect(isVoiceValidForProvider('alloy', 'openai')).toBe(true);
        expect(isVoiceValidForProvider('echo',  'openai')).toBe(true);
        expect(isVoiceValidForProvider('nova',  'openai')).toBe(true);
    });

    it('returns true (no rejection) for unknown providers — fail open', () => {
        expect(isVoiceValidForProvider('anything', 'unknown_provider')).toBe(true);
    });

    it('returns false for empty / null voice ids regardless of provider', () => {
        expect(isVoiceValidForProvider('',   'kokoro')).toBe(false);
        expect(isVoiceValidForProvider(null, 'kokoro')).toBe(false);
        expect(isVoiceValidForProvider(undefined, 'kokoro')).toBe(false);
    });
});

// I18N (2026-07-08): voice LANGUAGE helpers. Validation only — these must
// never influence which voice plays (one-tier case_voice stays authoritative).
// The contract callers rely on: null means "unknown, do NOT warn".
describe('voiceLanguage', () => {
    it('derives BCP-47 from Piper model filenames', () => {
        expect(voiceLanguage('en_US-amy-medium.onnx', 'piper')).toBe('en-US');
        expect(voiceLanguage('it_IT-paola-medium.onnx', 'piper')).toBe('it-IT');
        expect(voiceLanguage('fi_FI-harri-medium.onnx', 'piper')).toBe('fi-FI');
    });

    it('derives BCP-47 from Google voice names', () => {
        expect(voiceLanguage('en-US-Chirp3-HD-Kore', 'google')).toBe('en-US');
        expect(voiceLanguage('sv-SE-Wavenet-A', 'google')).toBe('sv-SE');
    });

    it('maps Kokoro pack prefixes', () => {
        expect(voiceLanguage('af_bella', 'kokoro')).toBe('en-US');
        expect(voiceLanguage('bm_lewis', 'kokoro')).toBe('en-GB');
        expect(voiceLanguage('if_sara', 'kokoro')).toBe('it-IT');
    });

    it('marks text-following providers as multilingual', () => {
        expect(voiceLanguage('alloy', 'openai')).toBe('multilingual');
        expect(voiceLanguage(null, 'browser')).toBe('multilingual');
    });

    it('returns null for unknown shapes — never guesses', () => {
        expect(voiceLanguage('mystery-voice', 'piper')).toBeNull();
        expect(voiceLanguage('af_bella', 'unknown_provider')).toBeNull();
        expect(voiceLanguage(null, 'kokoro')).toBeNull();
        expect(voiceLanguage('qf_x', 'kokoro')).toBeNull();
    });
});

describe('voiceMatchesLanguage', () => {
    it('matches on primary subtag: registry codes and BCP-47 both work', () => {
        expect(voiceMatchesLanguage('it_IT-paola-medium.onnx', 'piper', 'it')).toBe(true);
        expect(voiceMatchesLanguage('en_GB-jenny_dioco-medium.onnx', 'piper', 'en-US')).toBe(true);
        expect(voiceMatchesLanguage('en_US-amy-medium.onnx', 'piper', 'it')).toBe(false);
    });

    it('multilingual providers always match', () => {
        expect(voiceMatchesLanguage('alloy', 'openai', 'fi')).toBe(true);
        expect(voiceMatchesLanguage('whatever', 'browser', 'sv')).toBe(true);
    });

    it('returns null when the voice language is unknown — callers must not warn', () => {
        expect(voiceMatchesLanguage('mystery', 'piper', 'it')).toBeNull();
        expect(voiceMatchesLanguage('af_bella', 'kokoro', '')).toBeNull();
        expect(voiceMatchesLanguage('af_bella', 'kokoro', null)).toBeNull();
    });
});
