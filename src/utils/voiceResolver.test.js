// Run with:  npm run test:client
//
// Phase 1 / task 1.1 — TESTING_PLAN.md section 1.1.
// Locks in the precedence chain documented at the top of voiceResolver.js
// and the rate/pitch tie-break that regressed the discussant-voice incident
// on 2026-05-06 (fix: commit bb34d88).

import { describe, it, expect } from 'vitest';
import { resolveVoice, deriveSlot } from './voiceResolver.js';
import { PROVIDER_FALLBACK_VOICE } from './voiceFallbacks.js';

// ---- Fixtures -------------------------------------------------------------

const platformAvatarsWithMaleDefault = {
    default_voice_piper_male: 'persona-male.onnx',
    default_voice_piper_female: 'persona-female.onnx',
    default_voice_piper_child: 'persona-child.onnx',
    default_rate_male: 1.1,
    default_pitch_male: -2
};

const voiceSettingsWithSlot = {
    tts_provider: 'piper',
    voice_piper_male: 'slot-male.onnx',
    voice_piper_female: 'slot-female.onnx',
    voice_piper_child: 'slot-child.onnx',
    tts_rate: 0.9,
    tts_pitch: 4
};

const ttsCatalogue = [
    { filename: 'first-installed.onnx', label: 'First Installed' },
    { filename: 'second.onnx',          label: 'Second' }
];

// ---- Tier 1: per-speaker case_voice override -----------------------------

describe('resolveVoice — Tier 1: case_voice override', () => {
    it('case_voice wins over platform persona default', () => {
        const r = resolveVoice({
            voice: { case_voice: 'override.onnx', tts_provider: 'piper' },
            platformAvatars: platformAvatarsWithMaleDefault,
            voiceSettings: voiceSettingsWithSlot,
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBe('override');
        expect(r.file).toBe('override.onnx');
    });

    it('case_voice wins even when platform + slot + hardcoded all available (kokoro)', () => {
        const r = resolveVoice({
            voice: { case_voice: 'override.onnx', tts_provider: 'kokoro' },
            platformAvatars: { default_voice_kokoro_male: 'persona.bin' },
            voiceSettings: { voice_kokoro_male: 'slot.bin' },
            gender: 'male',
            age: 40,
            ttsVoices: ttsCatalogue
        });
        expect(r.tier).toBe('override');
        expect(r.file).toBe('override.onnx');
        expect(r.provider).toBe('kokoro');
    });
});

// ---- Tier 2: platform persona default ------------------------------------

describe('resolveVoice — Tier 2: platform persona default', () => {
    it('uses default_voice_<provider>_<slot> when no case_voice override', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: platformAvatarsWithMaleDefault,
            voiceSettings: voiceSettingsWithSlot,
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBe('platform-default');
        expect(r.file).toBe('persona-male.onnx');
    });

    it('persona default beats voice slot (tier 2 > tier 3)', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: { default_voice_piper_female: 'persona-f.onnx' },
            voiceSettings:   { voice_piper_female: 'slot-f.onnx' },
            gender: 'female',
            age: 30
        });
        expect(r.tier).toBe('platform-default');
        expect(r.file).toBe('persona-f.onnx');
    });
});

// ---- Tier 3: voice slot --------------------------------------------------

describe('resolveVoice — Tier 3: voice_<provider>_<slot>', () => {
    it('falls through to slot when no persona default present', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: null,
            voiceSettings: voiceSettingsWithSlot,
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBe('voice-slot');
        expect(r.file).toBe('slot-male.onnx');
    });
});

// ---- Tier 4: hardcoded provider fallback ---------------------------------

describe('resolveVoice — Tier 4: PROVIDER_FALLBACK_VOICE', () => {
    it('uses the kokoro hardcoded male fallback when nothing else configured', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'kokoro' },
            platformAvatars: null,
            voiceSettings: null,
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBe('hardcoded');
        expect(r.file).toBe(PROVIDER_FALLBACK_VOICE.kokoro.male);
        expect(r.file).toBe('am_michael');
    });

    it('returns file=null for piper when no slot configured (piper hardcoded entries are empty)', () => {
        // CONTRACT: PROVIDER_FALLBACK_VOICE.piper.* is '' so the truthy check
        // in tier 4 fails for piper and we fall through to tier 5/null. This
        // is intentional — Piper has no baked-in default.
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: null,
            voiceSettings: null,
            gender: 'male',
            age: 40
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
    });
});

// ---- Tier 5: catalog-first (editor only) ---------------------------------

describe('resolveVoice — Tier 5: catalog-first', () => {
    it('only triggers when ttsVoices array is provided (runtime path leaves it null)', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: null,
            voiceSettings: null,
            gender: 'male',
            age: 40,
            ttsVoices: ttsCatalogue
        });
        expect(r.tier).toBe('catalog-first');
        expect(r.file).toBe('first-installed.onnx');
    });

    it('does NOT trigger when ttsVoices is null — runtime should 503 instead of guessing', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: null,
            voiceSettings: null,
            gender: 'male',
            age: 40,
            ttsVoices: null
        });
        expect(r.tier).toBeNull();
        expect(r.file).toBeNull();
    });

    it('does NOT trigger when ttsVoices is an empty array', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            ttsVoices: []
        });
        expect(r.tier).toBeNull();
        expect(r.file).toBeNull();
    });

    it('catalog-first is below tier 4 — kokoro hardcoded still wins over catalogue', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'kokoro' },
            ttsVoices: ttsCatalogue,
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBe('hardcoded');
        expect(r.file).toBe('am_michael');
    });
});

// ---- Slot derivation ------------------------------------------------------

describe('resolveVoice — slot derivation', () => {
    it("gender='male' + age<13 → child slot", () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: platformAvatarsWithMaleDefault,
            gender: 'male',
            age: 8
        });
        expect(r.tier).toBe('platform-default');
        expect(r.file).toBe('persona-child.onnx');
    });

    it("gender='' + age=undefined → male slot (default age=35, default gender male)", () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: platformAvatarsWithMaleDefault,
            gender: '',
            age: undefined
        });
        // CONTRACT: When age is undefined, the destructure default (35) applies,
        // so safeAge=35 → not child. Gender '' fails /^f/i.test → male.
        expect(r.tier).toBe('platform-default');
        expect(r.file).toBe('persona-male.onnx');
    });

    it("deriveSlot helper: 'female' + age 30 → female", () => {
        expect(deriveSlot('female', 30)).toBe('female');
    });

    it('deriveSlot helper: NaN-ish age coerces to 35 → not child', () => {
        // CONTRACT: deriveSlot uses Number(age) and falls back to 35 when
        // not finite. So 'abc' → 35 → male (since gender '' is not female).
        expect(deriveSlot('', 'abc')).toBe('male');
    });
});

// ---- Rate/pitch precedence (the 2026-05-06 bug) --------------------------

describe('resolveVoice — rate/pitch precedence', () => {
    it('voice.tts_pitch wins over voiceSettings.tts_pitch (regression: bb34d88)', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper', tts_pitch: 7 },
            voiceSettings: { tts_pitch: 99 },
            platformAvatars: platformAvatarsWithMaleDefault,
            gender: 'male',
            age: 40
        });
        expect(r.pitch).toBe(7);
    });

    it('voice.tts_rate wins over voiceSettings.tts_rate', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper', tts_rate: 1.5 },
            voiceSettings: { tts_rate: 0.5 },
            platformAvatars: platformAvatarsWithMaleDefault,
            gender: 'male',
            age: 40
        });
        expect(r.rate).toBe(1.5);
    });

    it('persona default rate/pitch sit between voice and voiceSettings', () => {
        // pickNum order: voice → persona → voiceSettings
        const r = resolveVoice({
            voice: { tts_provider: 'piper' }, // no per-voice rate/pitch
            voiceSettings: { tts_rate: 0.5, tts_pitch: 99 },
            platformAvatars: platformAvatarsWithMaleDefault, // default_rate_male=1.1, default_pitch_male=-2
            gender: 'male',
            age: 40
        });
        expect(r.rate).toBe(1.1);
        expect(r.pitch).toBe(-2);
    });

    it('pickNum returns the first finite value across voice → persona → voiceSettings', () => {
        // voice.tts_rate is empty string (skip), persona missing, voiceSettings.tts_rate=0.75 finite
        const r = resolveVoice({
            voice: { tts_provider: 'piper', tts_rate: '', tts_pitch: null },
            voiceSettings: { tts_rate: 0.75, tts_pitch: 3 },
            platformAvatars: null,
            gender: 'male',
            age: 40
        });
        expect(r.rate).toBe(0.75);
        expect(r.pitch).toBe(3);
    });

    it('pickNum returns undefined when nothing applies', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            voiceSettings: null,
            platformAvatars: null
        });
        expect(r.rate).toBeUndefined();
        expect(r.pitch).toBeUndefined();
    });

    it('pickNum skips non-finite strings and picks the next finite value', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper', tts_rate: 'fast' }, // not finite → skip
            voiceSettings: { tts_rate: 0.8 },
            platformAvatars: null,
            gender: 'male',
            age: 40
        });
        // CONTRACT: pickNum continues past non-finite Number('fast')=NaN to
        // the next candidate; it does NOT short-circuit on bad strings.
        expect(r.rate).toBe(0.8);
    });
});

// ---- Provider derivation -------------------------------------------------

describe('resolveVoice — provider derivation', () => {
    it("voice.tts_provider wins over voiceSettings.tts_provider", () => {
        const r = resolveVoice({
            voice: { tts_provider: 'kokoro' },
            voiceSettings: { tts_provider: 'piper' },
            gender: 'male',
            age: 40
        });
        expect(r.provider).toBe('kokoro');
    });

    it("inherits voiceSettings.tts_provider when the speaker leaves provider unset", () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: {
                tts_provider: 'google',
                voice_google_female: 'en-US-Neural2-F'
            },
            gender: 'female',
            age: 40
        });
        expect(r.provider).toBe('google');
        expect(r.file).toBe('en-US-Neural2-F');
        expect(r.tier).toBe('voice-slot');
    });

    it("falls back to 'piper' when neither side declares a provider", () => {
        const r = resolveVoice({});
        expect(r.provider).toBe('piper');
    });
});
