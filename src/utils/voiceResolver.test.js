// Run with:  npm run test:client
//
// Locks the resolveVoice() contract documented at the top of voiceResolver.js.
//
// 2026-05-12 — chain was collapsed from 5 tiers to 3 after admins reported
// the Voice Settings tab appeared to do nothing (case_voice silently won
// over the platform slot). The new contract:
//
//   1. case_voice (per-character) → tier='override'
//   2. PROVIDER_FALLBACK_VOICE   → tier='hardcoded'
//   3. catalog-first (editor only)→ tier='catalog-first'
//
// Rate/pitch resolution is independent of which voice file is picked and
// keeps the original three-tier pickNum chain (voice → persona → settings).

import { describe, it, expect } from 'vitest';
import { resolveVoice, deriveSlot } from './voiceResolver.js';
import { PROVIDER_FALLBACK_VOICE } from './voiceFallbacks.js';

// ---- Fixtures -------------------------------------------------------------

// Legacy platform-level voice settings — present in the test fixture so we
// can prove they are NO LONGER read at resolution time. New deployments
// won't write them; older DBs that still have them must be ignored.
const platformAvatarsLegacy = {
    default_voice_piper_male: 'persona-male.onnx',
    default_voice_piper_female: 'persona-female.onnx',
    default_voice_piper_child: 'persona-child.onnx',
    default_rate_male: 1.1,
    default_pitch_male: -2
};

const voiceSettingsLegacy = {
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

// ---- Tier 1: per-character case_voice -------------------------------------

describe('resolveVoice — Tier 1: case_voice (the source of truth)', () => {
    it('case_voice is returned when set, regardless of legacy platform fields', () => {
        const r = resolveVoice({
            voice: { case_voice: 'override.onnx', tts_provider: 'piper' },
            platformAvatars: platformAvatarsLegacy,
            voiceSettings: voiceSettingsLegacy,
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBe('override');
        expect(r.file).toBe('override.onnx');
    });

    it('case_voice wins for kokoro even with legacy persona + slot + hardcoded all present', () => {
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

// ---- Tier 2: hardcoded provider fallback ----------------------------------
//
// Without a case_voice, the resolver ignores legacy platform per-gender
// voice fields and falls straight through to PROVIDER_FALLBACK_VOICE.

describe('resolveVoice — Tier 2: PROVIDER_FALLBACK_VOICE', () => {
    it('uses the kokoro hardcoded male fallback when no case_voice is set', () => {
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

    it('ignores legacy default_voice_*_* (Avatars tab) entries entirely', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: platformAvatarsLegacy,    // persona-male.onnx set
            voiceSettings: null,
            gender: 'male',
            age: 40
        });
        // Piper has no hardcoded fallback (PROVIDER_FALLBACK_VOICE.piper.* is ''),
        // so the resolver falls through to null instead of returning the legacy
        // persona-male.onnx — that's the whole point of the collapse.
        expect(r.tier).toBeNull();
        expect(r.file).toBeNull();
    });

    it('ignores legacy voice_*_* (Voice Settings tab) entries entirely', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            platformAvatars: null,
            voiceSettings: voiceSettingsLegacy,        // slot-male.onnx set
            gender: 'male',
            age: 40
        });
        expect(r.tier).toBeNull();
        expect(r.file).toBeNull();
    });

    it('uses the kokoro hardcoded female fallback for a female speaker', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'kokoro' },
            gender: 'female',
            age: 40
        });
        expect(r.tier).toBe('hardcoded');
        expect(r.file).toBe(PROVIDER_FALLBACK_VOICE.kokoro.female);
        expect(r.file).toBe('af_bella');
    });

    it('returns file=null for piper when no case_voice (piper has empty hardcoded fallback)', () => {
        // CONTRACT: PROVIDER_FALLBACK_VOICE.piper.* is '' so the truthy check
        // in tier 2 fails for piper and the resolver returns null. Intentional —
        // Piper has no baked-in default; admins must configure case_voice per case.
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
            gender: 'male',
            age: 40
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
    });
});

// ---- Tier 3: catalog-first (editor only) ----------------------------------

describe('resolveVoice — Tier 3: catalog-first (editor preview only)', () => {
    it('triggers when ttsVoices is provided AND no hardcoded fallback exists (piper)', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper' },
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

    it('catalog-first is below tier 2 — kokoro hardcoded still wins over the catalogue', () => {
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
    it("gender='male' + age<13 → child slot → kokoro child fallback (af_bella)", () => {
        const r = resolveVoice({
            voice: { tts_provider: 'kokoro' },
            gender: 'male',
            age: 8
        });
        expect(r.tier).toBe('hardcoded');
        expect(r.file).toBe(PROVIDER_FALLBACK_VOICE.kokoro.child);
    });

    it("gender='' + age=undefined → male slot (default age=35, default gender male)", () => {
        const r = resolveVoice({
            voice: { tts_provider: 'kokoro' },
            gender: '',
            age: undefined
        });
        // CONTRACT: When age is undefined, the destructure default (35) applies,
        // so safeAge=35 → not child. Gender '' fails /^f/i.test → male.
        expect(r.tier).toBe('hardcoded');
        expect(r.file).toBe(PROVIDER_FALLBACK_VOICE.kokoro.male);
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
//
// Rate/pitch resolution is INDEPENDENT of which voice file gets picked.
// pickNum order remains: voice → persona (Avatars tab default_rate/pitch
// for the slot) → voiceSettings global tts_rate/tts_pitch. These fields
// were not part of the tier collapse — admins can still set platform-wide
// rate/pitch defaults; only the per-gender voice *files* were removed.

describe('resolveVoice — rate/pitch precedence', () => {
    it('voice.tts_pitch wins over voiceSettings.tts_pitch (regression: bb34d88)', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper', tts_pitch: 7 },
            voiceSettings: { tts_pitch: 99 },
            platformAvatars: platformAvatarsLegacy,
            gender: 'male',
            age: 40
        });
        expect(r.pitch).toBe(7);
    });

    it('voice.tts_rate wins over voiceSettings.tts_rate', () => {
        const r = resolveVoice({
            voice: { tts_provider: 'piper', tts_rate: 1.5 },
            voiceSettings: { tts_rate: 0.5 },
            platformAvatars: platformAvatarsLegacy,
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
            platformAvatars: platformAvatarsLegacy, // default_rate_male=1.1, default_pitch_male=-2
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

    it('inherits voiceSettings.tts_provider when the speaker leaves provider unset', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: { tts_provider: 'google' },
            gender: 'female',
            age: 40
        });
        expect(r.provider).toBe('google');
        // Falls through to the hardcoded google female fallback, NOT to any
        // legacy voice_google_female slot setting.
        expect(r.file).toBe(PROVIDER_FALLBACK_VOICE.google.female);
        expect(r.tier).toBe('hardcoded');
    });

    it("falls back to 'kokoro' when neither side declares a provider", () => {
        const r = resolveVoice({});
        expect(r.provider).toBe('kokoro');
        expect(r.file).toBe(PROVIDER_FALLBACK_VOICE.kokoro.male);
        expect(r.tier).toBe('hardcoded');
    });
});
