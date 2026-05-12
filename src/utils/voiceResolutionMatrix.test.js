import { describe, expect, it } from 'vitest';
import { resolveVoice } from './voiceResolver.js';
import { PROVIDER_FALLBACK_VOICE } from './voiceFallbacks.js';

// 2026-05-12 — voice resolution was collapsed from 5 tiers to 3. Per-character
// `case_voice` is THE source; platform per-gender slots (Voice tab) and
// per-persona defaults (Avatars tab) are no longer read. This matrix locks
// the new contract across the four providers and three demographic slots:
//
//   1. Without case_voice → PROVIDER_FALLBACK_VOICE (or null for piper).
//   2. With case_voice    → the case_voice file, regardless of legacy
//                           platform fields present in the same payload.
//
// Provider is still picked from voice.tts_provider with voiceSettings.tts_provider
// as the inheritance fallback — that's a global ops setting and unchanged.

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];
const SLOTS = ['male', 'female', 'child'];

const CASE_VOICE_OVERRIDE = {
    piper:  'en_US-ryan-high.onnx',
    kokoro: 'am_adam',
    google: 'en-US-Neural2-D',
    openai: 'echo'
};

const DEMOS = {
    male:   { gender: 'male',   age: 45 },
    female: { gender: 'female', age: 45 },
    child:  { gender: 'male',   age: 8 }
};

// Legacy fixture present to prove that voice_<provider>_<slot> values are
// no longer read. New deployments won't write these; older DBs with them
// must be ignored at resolution time.
function legacyVoiceSettings(activeProvider = 'piper') {
    const out = {
        tts_provider: activeProvider,
        tts_rate: 0.95,
        tts_pitch: -1
    };
    for (const provider of PROVIDERS) {
        for (const slot of SLOTS) {
            out[`voice_${provider}_${slot}`] = `legacy-slot:${provider}:${slot}`;
        }
    }
    return out;
}

// Legacy fixture for the Avatars-tab persona defaults. Same story — kept in
// the test so we can prove the resolver no longer reads it.
function legacyPlatformAvatars() {
    const out = {
        default_rate_male: 1.1,
        default_pitch_male: 2,
        default_rate_female: 0.9,
        default_pitch_female: -2,
        default_rate_child: 1.05,
        default_pitch_child: 1
    };
    for (const provider of PROVIDERS) {
        for (const slot of SLOTS) {
            out[`default_voice_${provider}_${slot}`] = `legacy-persona:${provider}:${slot}`;
        }
    }
    return out;
}

describe('voice resolution matrix — provider × slot × case_voice presence', () => {
    it.each(PROVIDERS)('without case_voice, %s falls through to hardcoded fallback (or null for piper)', (provider) => {
        const voiceSettings = legacyVoiceSettings(provider);
        const platformAvatars = legacyPlatformAvatars();
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: {},
                voiceSettings,
                platformAvatars,
                ...DEMOS[slot]
            });
            const hardcoded = PROVIDER_FALLBACK_VOICE[provider]?.[slot];
            if (hardcoded) {
                // Hardcoded fallback is set for kokoro/google/openai — that wins.
                expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
                expect(r.file, `${provider}/${slot} file`).toBe(hardcoded);
                expect(r.tier, `${provider}/${slot} tier`).toBe('hardcoded');
            } else {
                // Piper has no hardcoded fallback. Without ttsVoices, return null —
                // the resolver MUST NOT read the legacy voice_piper_* fields.
                expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
                expect(r.file, `${provider}/${slot} file`).toBeNull();
                expect(r.tier, `${provider}/${slot} tier`).toBeNull();
            }
        }
    });

    it.each(PROVIDERS)('case_voice %s wins for every slot even with legacy fields present', (provider) => {
        const voiceSettings = legacyVoiceSettings(provider);
        const platformAvatars = legacyPlatformAvatars();
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: {
                    case_voice: CASE_VOICE_OVERRIDE[provider],
                    tts_rate: 1.25,
                    tts_pitch: 3
                },
                voiceSettings,
                platformAvatars,
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            expect(r.file, `${provider}/${slot} file`).toBe(CASE_VOICE_OVERRIDE[provider]);
            expect(r.tier, `${provider}/${slot} tier`).toBe('override');
            // Per-character rate/pitch still apply.
            expect(r.rate).toBe(1.25);
            expect(r.pitch).toBe(3);
        }
    });

    it.each(PROVIDERS)('provider override %s wins over voiceSettings.tts_provider for every slot', (provider) => {
        const platformProvider = provider === 'piper' ? 'google' : 'piper';
        const voiceSettings = legacyVoiceSettings(platformProvider);
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: { tts_provider: provider },
                voiceSettings,
                platformAvatars: {},
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            // No case_voice → hardcoded fallback for this provider/slot.
            const expected = PROVIDER_FALLBACK_VOICE[provider]?.[slot] || null;
            expect(r.file, `${provider}/${slot} file`).toBe(expected);
            expect(r.tier, `${provider}/${slot} tier`).toBe(expected ? 'hardcoded' : null);
        }
    });

    it('piper is the only provider with no hardcoded fallback when no case_voice exists', () => {
        const piper = resolveVoice({
            voice: { tts_provider: 'piper' },
            voiceSettings: {},
            platformAvatars: {},
            gender: 'male',
            age: 40
        });
        expect(piper.file).toBeNull();
        expect(piper.tier).toBeNull();

        for (const provider of ['kokoro', 'google', 'openai']) {
            const r = resolveVoice({
                voice: { tts_provider: provider },
                voiceSettings: {},
                platformAvatars: {},
                gender: 'male',
                age: 40
            });
            expect(r.file, provider).toBeTruthy();
            expect(r.tier, provider).toBe('hardcoded');
        }
    });
});
