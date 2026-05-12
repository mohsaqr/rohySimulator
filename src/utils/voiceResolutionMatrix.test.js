import { describe, expect, it } from 'vitest';
import { resolveVoice } from './voiceResolver.js';

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];
const SLOTS = ['male', 'female', 'child'];

const VOICE = {
    piper: {
        male: 'en_US-ryan-medium.onnx',
        female: 'en_US-amy-medium.onnx',
        child: 'en_US-amy-medium.onnx',
        override: 'en_US-ryan-high.onnx'
    },
    kokoro: {
        male: 'am_michael',
        female: 'af_bella',
        child: 'af_bella',
        override: 'am_adam'
    },
    google: {
        male: 'en-US-Chirp3-HD-Charon',
        female: 'en-US-Chirp3-HD-Aoede',
        child: 'en-US-Chirp3-HD-Leda',
        override: 'en-US-Neural2-D'
    },
    openai: {
        male: 'onyx',
        female: 'nova',
        child: 'shimmer',
        override: 'echo'
    }
};

const DEMOS = {
    male: { gender: 'male', age: 45 },
    female: { gender: 'female', age: 45 },
    child: { gender: 'male', age: 8 }
};

function makeVoiceSettings(activeProvider = 'piper') {
    const out = {
        tts_provider: activeProvider,
        tts_rate: 0.95,
        tts_pitch: -1
    };
    for (const provider of PROVIDERS) {
        for (const slot of SLOTS) {
            out[`voice_${provider}_${slot}`] = VOICE[provider][slot];
        }
    }
    return out;
}

function makePlatformAvatars() {
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
            out[`default_voice_${provider}_${slot}`] = `${VOICE[provider][slot]}-persona`;
        }
    }
    return out;
}

describe('voice resolution matrix — provider x slot x inheritance mode', () => {
    it.each(PROVIDERS)('inherits platform provider %s and resolves every gender slot from voice settings', (provider) => {
        const voiceSettings = makeVoiceSettings(provider);
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: {},
                voiceSettings,
                platformAvatars: {},
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            expect(r.file, `${provider}/${slot} file`).toBe(VOICE[provider][slot]);
            expect(r.tier, `${provider}/${slot} tier`).toBe('voice-slot');
            expect(r.rate).toBe(0.95);
            expect(r.pitch).toBe(-1);
        }
    });

    it.each(PROVIDERS)('case provider override %s wins over platform provider for every slot', (provider) => {
        const platformProvider = provider === 'piper' ? 'google' : 'piper';
        const voiceSettings = makeVoiceSettings(platformProvider);
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: { tts_provider: provider },
                voiceSettings,
                platformAvatars: {},
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            expect(r.file, `${provider}/${slot} file`).toBe(VOICE[provider][slot]);
            expect(r.tier, `${provider}/${slot} tier`).toBe('voice-slot');
        }
    });

    // 2026-05-12 — tier order was reversed so platform Voice Settings is the
    // canonical source. The two assertions below previously locked the
    // case_voice-wins / persona-defaults-win semantics; both now invert.

    it.each(PROVIDERS)('platform voice slot %s wins over case_voice override (Voice Settings is canonical)', (provider) => {
        const voiceSettings = makeVoiceSettings(provider);
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: {
                    case_voice: VOICE[provider].override,
                    tts_rate: 1.25,
                    tts_pitch: 3
                },
                voiceSettings,
                platformAvatars: makePlatformAvatars(),
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            // Voice Settings (tier 1) wins; the override is ignored when a
            // platform slot is set for this provider/slot.
            expect(r.file, `${provider}/${slot} file`).toBe(VOICE[provider][slot]);
            expect(r.tier, `${provider}/${slot} tier`).toBe('voice-slot');
            // rate/pitch from the case still apply — those are independent of
            // which voice file is picked.
            expect(r.rate).toBe(1.25);
            expect(r.pitch).toBe(3);
        }
    });

    it.each(PROVIDERS)('case_voice acts as fallback for %s when Voice Settings is blank for that slot', (provider) => {
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: {
                    case_voice: VOICE[provider].override,
                    tts_provider: provider
                },
                voiceSettings: {},               // ← blank Voice Settings
                platformAvatars: {},
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            expect(r.file, `${provider}/${slot} file`).toBe(VOICE[provider].override);
            expect(r.tier, `${provider}/${slot} tier`).toBe('override');
        }
    });

    it.each(PROVIDERS)('platform voice slot %s wins over Avatars persona defaults', (provider) => {
        const voiceSettings = makeVoiceSettings(provider);
        const platformAvatars = makePlatformAvatars();
        for (const slot of SLOTS) {
            const r = resolveVoice({
                voice: {},
                voiceSettings,
                platformAvatars,
                ...DEMOS[slot]
            });
            expect(r.provider, `${provider}/${slot} provider`).toBe(provider);
            // Voice Settings (tier 1) still wins over the Avatars-tab persona
            // default; the persona default is now a fallback when Voice
            // Settings is blank for that slot.
            expect(r.file, `${provider}/${slot} file`).toBe(VOICE[provider][slot]);
            expect(r.tier, `${provider}/${slot} tier`).toBe('voice-slot');
            // rate/pitch still inherit from the Avatars-tab persona defaults
            // — they're independent of which voice file is picked.
            expect(r.rate).toBe(platformAvatars[`default_rate_${slot}`]);
            expect(r.pitch).toBe(platformAvatars[`default_pitch_${slot}`]);
        }
    });

    it('piper is the only provider with no hardcoded fallback when no platform slot exists', () => {
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
