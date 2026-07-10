// Inherit / override audit — Voice 2.0 v1.4 sovereignty contract
// (CONTRACT REWRITE 2026-07, VOICE2_PLAN.md). The audited invariants:
//
//   - case_voice wins over the template voice when both are set;
//   - a CONFIGURED voice (case or template) is LITERAL: unplayable means
//     the speaker fails loudly — no template stand-in for a case voice, no
//     default stand-in for either (owner: "the case sound reigns supreme");
//   - the per-language default serves ONLY speakers with nothing
//     configured, and is declared (substituted / not_configured);
//   - a stored per-persona tts_provider field remains dead: the engine
//     comes from the voice id, nothing stored can redirect it (the exact
//     leak that caused the 2026-05 saga);
//   - rate/pitch inherit case > template > platform.

import { describe, it, expect } from 'vitest';
import { resolveVoice } from './voiceResolver.js';

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];

const VOICE_OF = {
    piper:  'en_US-ryan-high.onnx',
    kokoro: 'am_adam',
    google: 'en-US-Neural2-D',
    openai: 'echo'
};

const settingsWith = ({ usable = PROVIDERS, defaults = {} } = {}) => ({
    providers: PROVIDERS.map(id => ({
        id, capable: usable.includes(id), enabled: true, usable: usable.includes(id), reason: null
    })),
    ...Object.fromEntries(Object.entries(defaults).map(([lang, v]) => [`tts_default_voice_${lang}`, v])),
});

describe('exhaustive inherit/override audit — sovereignty', () => {
    PROVIDERS.forEach(provider => {
        describe(`voice engine=${provider}`, () => {
            it('case_voice present and playable → tier=override on the derived engine', () => {
                const r = resolveVoice({
                    voice: { case_voice: VOICE_OF[provider] },
                    voiceSettings: settingsWith()
                });
                expect(r).toMatchObject({
                    file: VOICE_OF[provider],
                    provider,
                    tier: 'override',
                    substituted: false
                });
            });

            it('case_voice beats a playable template voice', () => {
                const r = resolveVoice({
                    voice: { case_voice: VOICE_OF[provider] },
                    templateVoice: { case_voice: 'am_adam' },
                    voiceSettings: settingsWith()
                });
                expect(r.file).toBe(VOICE_OF[provider]);
                expect(r.tier).toBe('override');
            });

            it('case_voice = "" / null / undefined → treated as not set', () => {
                for (const blank of ['', null, undefined]) {
                    const r = resolveVoice({
                        voice: { case_voice: blank },
                        voiceSettings: settingsWith()
                    });
                    expect(r.file).toBeNull();
                    expect(r.tier).toBeNull();
                }
            });

            it('per-persona tts_provider CANNOT redirect the engine (saga leak guard)', () => {
                const otherProvider = PROVIDERS.find(p => p !== provider);
                const r = resolveVoice({
                    voice: { case_voice: VOICE_OF[provider], tts_provider: otherProvider },
                    voiceSettings: settingsWith()
                });
                expect(r.provider).toBe(provider);
                expect(r.file).toBe(VOICE_OF[provider]);
            });
        });
    });

    it('unplayable case override + playable template → LOUD FAIL, the template does NOT stand in', () => {
        const r = resolveVoice({
            voice: { case_voice: VOICE_OF.google },
            templateVoice: { case_voice: VOICE_OF.kokoro },
            voiceSettings: settingsWith({ usable: ['kokoro', 'piper', 'openai'] })
        });
        expect(r).toMatchObject({
            file: null,
            tier: 'invalid',
            substituted: false,
            requestedFile: VOICE_OF.google
        });
    });

    it('unplayable case + defaults present → still a LOUD FAIL (configured voices are literal)', () => {
        const r = resolveVoice({
            voice: { case_voice: VOICE_OF.google },
            voiceSettings: settingsWith({ usable: ['kokoro', 'piper'], defaults: { en: 'am_adam' } })
        });
        expect(r).toMatchObject({ file: null, tier: 'invalid', substituted: false });
    });

    it('nothing configured anywhere → the language default speaks, declared', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: settingsWith({ defaults: { en: 'am_adam' } })
        });
        expect(r).toMatchObject({
            file: 'am_adam',
            tier: 'default',
            substituted: true,
            substitutionReason: 'not_configured'
        });
    });
});

describe('Cartesian rate/pitch inheritance', () => {
    it('per-character values win over platform values', () => {
        const r = resolveVoice({
            voice: { case_voice: 'am_adam', tts_rate: 0.75, tts_pitch: 3 },
            voiceSettings: { ...settingsWith(), tts_rate: 1.1, tts_pitch: -1 }
        });
        expect(r.rate).toBe(0.75);
        expect(r.pitch).toBe(3);
    });

    it('template values fill in before platform values', () => {
        const r = resolveVoice({
            voice: { case_voice: 'am_adam' },
            templateVoice: { tts_rate: 0.9, tts_pitch: 2 },
            voiceSettings: { ...settingsWith(), tts_rate: 1.1, tts_pitch: -1 }
        });
        expect(r.rate).toBe(0.9);
        expect(r.pitch).toBe(2);
    });

    it('platform values fill in when nothing else is set', () => {
        const r = resolveVoice({
            voice: { case_voice: 'am_adam' },
            voiceSettings: { ...settingsWith(), tts_rate: 1.1, tts_pitch: -1 }
        });
        expect(r.rate).toBe(1.1);
        expect(r.pitch).toBe(-1);
    });

    it('all unset → undefined (server will clamp to its own default)', () => {
        const r = resolveVoice({
            voice: { case_voice: 'am_adam' },
            voiceSettings: settingsWith()
        });
        expect(r.rate).toBeUndefined();
        expect(r.pitch).toBeUndefined();
    });
});
