// Inherit / override audit — locks the post-2026-05-12 contract where
// per-character case_voice is the only voice source and the platform
// tts_provider is the only provider source. The previous version was a
// Cartesian sweep across five tiers of fallback; with the fallbacks gone
// the audit shrinks to four orthogonal cases, plus one "leak-guard" case
// that proves stale per-persona tts_provider can't override the platform.

import { describe, it, expect } from 'vitest';
import { resolveVoice } from './voiceResolver.js';

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];

describe('exhaustive inherit/override audit — case_voice is the only voice source', () => {
    PROVIDERS.forEach(provider => {
        describe(`provider=${provider}`, () => {
            it('case_voice present → tier=override and that voice plays', () => {
                const r = resolveVoice({
                    voice: { case_voice: 'speaker-A' },
                    voiceSettings: { tts_provider: provider }
                });
                expect(r).toMatchObject({
                    file: 'speaker-A',
                    provider,
                    tier: 'override'
                });
            });

            it('case_voice absent → file:null, tier:null (no silent fallback)', () => {
                const r = resolveVoice({
                    voice: {},
                    voiceSettings: { tts_provider: provider }
                });
                expect(r).toMatchObject({
                    file: null,
                    provider,
                    tier: null
                });
            });

            it('case_voice = "" / null / undefined → file:null (treated as not set)', () => {
                for (const blank of ['', null, undefined]) {
                    const r = resolveVoice({
                        voice: { case_voice: blank },
                        voiceSettings: { tts_provider: provider }
                    });
                    expect(r.file).toBeNull();
                    expect(r.tier).toBeNull();
                }
            });

            it('per-persona tts_provider CANNOT leak through (platform wins)', () => {
                // The deployed-but-mute symptom we chased for three weeks:
                // an admin set the provider to kokoro in Voice Settings, but
                // the Patient persona was authored under google, and that
                // persona-level tts_provider silently overrode the platform.
                // Resolver no longer reads voice.tts_provider at all.
                const otherProvider = PROVIDERS.find(p => p !== provider);
                const r = resolveVoice({
                    voice: { case_voice: 'speaker-A', tts_provider: otherProvider },
                    voiceSettings: { tts_provider: provider }
                });
                expect(r.provider).toBe(provider);
                expect(r.file).toBe('speaker-A');
            });
        });
    });
});

describe('Cartesian rate/pitch inheritance', () => {
    it('per-character values win over platform values', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x', tts_rate: 0.75, tts_pitch: 3 },
            voiceSettings: { tts_provider: 'kokoro', tts_rate: 1.1, tts_pitch: -1 }
        });
        expect(r.rate).toBe(0.75);
        expect(r.pitch).toBe(3);
    });

    it('platform values fill in when per-character is unset', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x' },
            voiceSettings: { tts_provider: 'kokoro', tts_rate: 1.1, tts_pitch: -1 }
        });
        expect(r.rate).toBe(1.1);
        expect(r.pitch).toBe(-1);
    });

    it('both unset → undefined (server will clamp to its own default)', () => {
        const r = resolveVoice({
            voice: { case_voice: 'x' },
            voiceSettings: { tts_provider: 'kokoro' }
        });
        expect(r.rate).toBeUndefined();
        expect(r.pitch).toBeUndefined();
    });
});
