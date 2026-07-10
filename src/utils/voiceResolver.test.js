// Tests for src/utils/voiceResolver.js — the Voice 2.0 contract, v1.4
// sovereignty semantics (VOICE2_PLAN.md).
//
// CONTRACT REWRITE (2026-07, twice): the 2026-05 one-tier contract died
// with Voice 2.0; v1.4 then made configured voices SOVEREIGN (owner: "the
// case sound reigns supreme"). Current chain: a configured voice (case
// first, else the persona template) is LITERAL — it plays on its own
// derived engine or the speaker fails LOUDLY; no template stand-in, no
// default stand-in. The per-language platform default serves ONLY speakers
// with no voice configured at all, announced via `substituted:true` +
// reason 'not_configured'.

import { describe, it, expect } from 'vitest';
import {
    resolveVoice,
    deriveSlot,
    isVoiceValidForProvider,
    guessVoiceProvider,
    voiceLanguage,
    voiceMatchesLanguage,
} from './voiceResolver.js';

// Settings payload builder mirroring GET /platform-settings/voice.
function mkSettings({ usable = ['kokoro', 'google', 'openai', 'piper'], defaults = {}, rate, pitch } = {}) {
    return {
        providers: ['kokoro', 'google', 'openai', 'piper'].map(id => ({
            id, capable: usable.includes(id), enabled: true, usable: usable.includes(id), reason: null
        })),
        ...Object.fromEntries(Object.entries(defaults).map(([lang, v]) => [`tts_default_voice_${lang}`, v])),
        ...(rate !== undefined ? { tts_rate: rate } : {}),
        ...(pitch !== undefined ? { tts_pitch: pitch } : {}),
    };
}

describe('tier: override — the voice plays on its own engine', () => {
    it('a kokoro case_voice plays with its derived engine', () => {
        const r = resolveVoice({ voice: { case_voice: 'af_bella' }, voiceSettings: mkSettings() });
        expect(r.file).toBe('af_bella');
        expect(r.provider).toBe('kokoro');   // derived from the id, no platform setting
        expect(r.tier).toBe('override');
        expect(r.substituted).toBe(false);
        expect(r.requestedFile).toBe('af_bella');
    });

    it('a google case_voice plays on google in the same config world (mixed engines)', () => {
        const r = resolveVoice({ voice: { case_voice: 'de-DE-Chirp3-HD-Kore' }, voiceSettings: mkSettings() });
        expect(r.file).toBe('de-DE-Chirp3-HD-Kore');
        expect(r.provider).toBe('google');
        expect(r.tier).toBe('override');
    });

    it('a stored voice.tts_provider field cannot change the derived engine (the saga leak)', () => {
        const r = resolveVoice({
            voice: { case_voice: 'af_bella', tts_provider: 'google' },
            voiceSettings: mkSettings()
        });
        expect(r.provider).toBe('kokoro'); // derived from the id, the stale field is dead
        expect(r.file).toBe('af_bella');
    });

    it('treats empty/null/undefined case_voice as "not set"', () => {
        for (const value of ['', null, undefined]) {
            const r = resolveVoice({ voice: { case_voice: value }, voiceSettings: mkSettings() });
            expect(r.file).toBeNull();
            expect(r.tier).toBeNull();
        }
    });

    it('fails OPEN before settings load — the server owns the final word', () => {
        const r = resolveVoice({ voice: { case_voice: 'af_bella' }, voiceSettings: null });
        expect(r.file).toBe('af_bella');
        expect(r.tier).toBe('override');
    });
});

describe('sovereignty — a configured voice is literal, nothing stands in', () => {
    it('an unplayable case voice does NOT fall back to the template', () => {
        const r = resolveVoice({
            voice: { case_voice: 'en-US-Chirp3-HD-Aoede' },   // google off below
            templateVoice: { case_voice: 'am_liam' },          // playable, but not asked for
            voiceSettings: mkSettings({ usable: ['kokoro'] })
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBe('invalid');
        expect(r.requestedFile).toBe('en-US-Chirp3-HD-Aoede');
        expect(r.provider).toBe('google'); // names the engine the admin must fix
    });

    it('an unplayable case voice does NOT fall back to the language default', () => {
        const r = resolveVoice({
            voice: { case_voice: 'en-US-Chirp3-HD-Aoede' },
            voiceSettings: mkSettings({ usable: ['kokoro'], defaults: { en: 'af_bella' } })
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBe('invalid');
        expect(r.substituted).toBe(false);
    });

    it('with no case override, the template IS the configuration', () => {
        const r = resolveVoice({
            voice: {},
            templateVoice: { case_voice: 'am_liam' },
            voiceSettings: mkSettings()
        });
        expect(r.file).toBe('am_liam');
        expect(r.tier).toBe('override');
        expect(r.substituted).toBe(false);
    });

    it('an unplayable TEMPLATE voice is equally literal — no default stand-in', () => {
        const r = resolveVoice({
            voice: {},
            templateVoice: { case_voice: 'en-US-Chirp3-HD-Aoede' },
            voiceSettings: mkSettings({ usable: ['kokoro'], defaults: { en: 'af_bella' } })
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBe('invalid');
        expect(r.requestedFile).toBe('en-US-Chirp3-HD-Aoede');
    });

    it('an id matching no engine shape fails loudly even when a default exists', () => {
        const r = resolveVoice({
            voice: { case_voice: 'totallyunknown' },
            voiceSettings: mkSettings({ defaults: { en: 'af_bella' } })
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBe('invalid');
    });
});

describe('tier: default — ONLY for speakers with nothing configured', () => {
    it('nothing configured + en default → default plays, announced as not_configured', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: mkSettings({ defaults: { en: 'af_bella' } })
        });
        expect(r.file).toBe('af_bella');
        expect(r.tier).toBe('default');
        expect(r.substituted).toBe(true);
        expect(r.substitutionReason).toBe('not_configured');
        expect(r.requestedFile).toBeNull();
    });

    it('a de session uses ONLY the de default — never the en one (the German directive)', () => {
        const settings = mkSettings({
            defaults: { en: 'af_bella', de: 'de_DE-thorsten-medium.onnx' }
        });
        const r = resolveVoice({ voice: {}, voiceSettings: settings, language: 'de' });
        expect(r.file).toBe('de_DE-thorsten-medium.onnx');
        expect(r.provider).toBe('piper');
    });

    it('a de session with NO de default gets nothing — the en default never leaks', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: mkSettings({ defaults: { en: 'af_bella' } }),
            language: 'de'
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
    });

    it('an unknown language code falls back to the en default row', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: mkSettings({ defaults: { en: 'af_bella' } }),
            language: 'xx'
        });
        expect(r.file).toBe('af_bella');
    });

    it('an unplayable default does not play (its engine is off too)', () => {
        const r = resolveVoice({
            voice: {},
            voiceSettings: mkSettings({ usable: ['google'], defaults: { en: 'af_bella' } })
        });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
    });

    it('nothing configured, no default → tier null ("pick a voice" story)', () => {
        const r = resolveVoice({ voice: {}, voiceSettings: mkSettings() });
        expect(r.file).toBeNull();
        expect(r.tier).toBeNull();
        expect(r.requestedFile).toBeNull();
        expect(r.substituted).toBe(false);
    });
});

describe('rate/pitch inheritance chain (case > template > platform)', () => {
    it('per-character values win over platform values', () => {
        const r = resolveVoice({
            voice: { case_voice: 'af_bella', tts_rate: 0.75, tts_pitch: 3 },
            voiceSettings: mkSettings({ rate: 1.1, pitch: -1 })
        });
        expect(r.rate).toBe(0.75);
        expect(r.pitch).toBe(3);
    });

    it('template values fill in before platform values', () => {
        const r = resolveVoice({
            voice: { case_voice: 'af_bella' },
            templateVoice: { tts_rate: 0.9 },
            voiceSettings: mkSettings({ rate: 1.1, pitch: -1 })
        });
        expect(r.rate).toBe(0.9);
        expect(r.pitch).toBe(-1);
    });

    it('all unset → undefined (server clamps to its own default)', () => {
        const r = resolveVoice({ voice: { case_voice: 'af_bella' }, voiceSettings: mkSettings() });
        expect(r.rate).toBeUndefined();
        expect(r.pitch).toBeUndefined();
    });
});

describe('isValid override (catalogue-backed callers / tests)', () => {
    it('a supplied isValid replaces the shape+status check', () => {
        const r = resolveVoice({
            voice: { case_voice: 'af_bella' },
            voiceSettings: mkSettings({ defaults: { en: 'bm_lewis' } }),
            isValid: () => false // everything unplayable…
        });
        expect(r.file).toBeNull(); // …and configured voices never substitute
        expect(r.tier).toBe('invalid');
    });
});

describe('re-exported identity helpers (deep coverage lives server-side)', () => {
    it('isVoiceValidForProvider covers the full kokoro prefix set now', () => {
        expect(isVoiceValidForProvider('if_sara', 'kokoro')).toBe(true);   // the old regex missed this
        expect(isVoiceValidForProvider('af_bella', 'kokoro')).toBe(true);
        expect(isVoiceValidForProvider('af_bella', 'google')).toBe(false);
    });

    it('guessVoiceProvider derives engines from id shapes', () => {
        expect(guessVoiceProvider('fi_FI-harri-medium.onnx')).toBe('piper');
        expect(guessVoiceProvider('alloy')).toBe('openai');
    });

    it('voiceLanguage / voiceMatchesLanguage behave as before', () => {
        expect(voiceLanguage('de-DE-Chirp3-HD-Kore', 'google')).toBe('de-DE');
        expect(voiceLanguage('alloy', 'openai')).toBe('multilingual');
        expect(voiceMatchesLanguage('alloy', 'openai', 'de')).toBe(true);
        expect(voiceMatchesLanguage('af_bella', 'kokoro', 'de')).toBe(false);
        expect(voiceMatchesLanguage('garbage', 'google', 'de')).toBe(null);
    });

    it('deriveSlot passthrough still works for UI labels', () => {
        expect(typeof deriveSlot('female', 30)).toBe('string');
    });
});
