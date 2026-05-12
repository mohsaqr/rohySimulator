import { describe, expect, it } from 'vitest';
import { resolveVoice } from './voiceResolver.js';

// 2026-05-12 — voice resolution collapsed to a single tier. Per-character
// `case_voice` is THE source; everything below it (per-gender slots,
// hardcoded provider maps, catalogue fallbacks) was removed because the
// stacked fallbacks made it impossible to tell which place was authoritative.
//
// This matrix locks the new contract across the four providers:
//   1. With case_voice    → that voice file, with provider = platform's
//                           tts_provider (NOT voice.tts_provider; that field
//                           is intentionally ignored).
//   2. Without case_voice → file:null, tier:null. Caller must surface this
//                           as a visible error — no silent substitution.

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];

const CASE_VOICE_OVERRIDE = {
    piper:  'en_US-ryan-high.onnx',
    kokoro: 'am_adam',
    google: 'en-US-Neural2-D',
    openai: 'echo'
};

describe('voice resolution matrix — case_voice is the only source', () => {
    PROVIDERS.forEach(provider => {
        it(`${provider}: case_voice present → that voice plays, override tier`, () => {
            const r = resolveVoice({
                voice: { case_voice: CASE_VOICE_OVERRIDE[provider] },
                voiceSettings: { tts_provider: provider }
            });
            expect(r.file).toBe(CASE_VOICE_OVERRIDE[provider]);
            expect(r.provider).toBe(provider);
            expect(r.tier).toBe('override');
        });

        it(`${provider}: case_voice absent → file:null (no hardcoded fallback)`, () => {
            const r = resolveVoice({
                voice: {},
                voiceSettings: { tts_provider: provider }
            });
            expect(r.file).toBeNull();
            expect(r.tier).toBeNull();
            // Provider is still reported so the caller can render a useful error.
            expect(r.provider).toBe(provider);
        });

        it(`${provider}: voice.tts_provider is ignored (platform wins)`, () => {
            // Persona was authored under a different provider — that stale
            // value used to leak through and silently override the platform.
            // It no longer does.
            const otherProvider = PROVIDERS.find(p => p !== provider);
            const r = resolveVoice({
                voice: { case_voice: 'x', tts_provider: otherProvider },
                voiceSettings: { tts_provider: provider }
            });
            expect(r.provider).toBe(provider);
        });
    });
});
