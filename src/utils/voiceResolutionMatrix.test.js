import { describe, expect, it } from 'vitest';
import { resolveVoice } from './voiceResolver.js';

// Voice 2.0 v1.4 resolution matrix (CONTRACT REWRITE 2026-07 —
// VOICE2_PLAN.md, sovereignty semantics). Per provider, this locks:
//   1. A voice plays on its own DERIVED engine whenever that engine is
//      usable — tier 'override'.
//   2. A stored voice.tts_provider field stays dead (the saga leak guard:
//      nothing stored can redirect an engine).
//   3. With the voice's engine unusable, the speaker FAILS LOUDLY — a
//      configured voice is literal; the language default is NOT a stand-in
//      (owner: "the case sound reigns supreme").
//   4. Nothing configured and no default → file:null (loud path).

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];

const CASE_VOICE_OVERRIDE = {
    piper:  'en_US-ryan-high.onnx',
    kokoro: 'am_adam',
    google: 'en-US-Neural2-D',
    openai: 'echo'
};

const ALL_USABLE = {
    providers: PROVIDERS.map(id => ({ id, capable: true, enabled: true, usable: true, reason: null }))
};

const usableExcept = (excluded) => ({
    providers: PROVIDERS.map(id => ({
        id, capable: id !== excluded, enabled: true, usable: id !== excluded, reason: null
    })),
    tts_default_voice_en: 'am_adam' // present on purpose: it must NOT stand in
});

describe('voice resolution matrix — the voice owns its engine, and is literal', () => {
    PROVIDERS.forEach(provider => {
        it(`${provider}: its voice plays on its own DERIVED engine, override tier`, () => {
            const r = resolveVoice({
                voice: { case_voice: CASE_VOICE_OVERRIDE[provider] },
                voiceSettings: ALL_USABLE
            });
            expect(r.file).toBe(CASE_VOICE_OVERRIDE[provider]);
            expect(r.provider).toBe(provider); // derived from the id — no platform engine exists
            expect(r.tier).toBe('override');
            expect(r.substituted).toBe(false);
        });

        it(`${provider}: a stored voice.tts_provider field cannot redirect the engine`, () => {
            const otherProvider = PROVIDERS.find(p => p !== provider);
            const r = resolveVoice({
                voice: { case_voice: CASE_VOICE_OVERRIDE[provider], tts_provider: otherProvider },
                voiceSettings: ALL_USABLE
            });
            expect(r.provider).toBe(provider); // the id decides, the stale field is dead
        });

        it(`${provider}: engine unusable → LOUD FAIL — the default never stands in for a configured voice`, () => {
            const r = resolveVoice({
                voice: { case_voice: CASE_VOICE_OVERRIDE[provider] },
                voiceSettings: usableExcept(provider)
            });
            expect(r.file).toBeNull();
            expect(r.tier).toBe('invalid');
            expect(r.substituted).toBe(false);
            expect(r.requestedFile).toBe(CASE_VOICE_OVERRIDE[provider]);
            expect(r.provider).toBe(provider); // names the engine to fix
        });

        it(`${provider}: nothing configured, no default → file:null (loud path)`, () => {
            const r = resolveVoice({
                voice: {},
                voiceSettings: ALL_USABLE
            });
            expect(r.file).toBeNull();
            expect(r.tier).toBeNull();
        });
    });
});
