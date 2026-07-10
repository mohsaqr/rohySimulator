// Voice 2.0 catalogue-disjointness contract (VOICE2_PLAN.md §5.1 / §7.4).
//
// THE invariant the whole router stands on: engine derivation routes a
// voice by exact catalogue membership, which is deterministic ONLY while
// no voice id belongs to two providers' catalogues. This test loads the
// real catalogues (google list, openai list, the kokoro-js package's
// shipped voice set) and proves pairwise disjointness — plus that every
// real id matches its own provider's id-shape pattern and no other's, so
// the shape-based hints (guessVoiceProvider) can never contradict the
// catalogue router. A collision here fails the BUILD, not the runtime.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { GOOGLE_VOICES } from '../../server/services/googleTts.js';
import { OPENAI_VOICES } from '../../server/services/openaiTts.js';
import {
    VOICE_ID_PATTERNS,
    isVoiceValidForProvider,
    guessVoiceProvider,
    voiceLanguage,
    voiceMatchesLanguage,
    primaryLanguage,
} from '../../server/shared/voiceIdentity.js';

// Kokoro's USABLE catalogue, read the same way the derivation layer reads
// it: the ids in the package's bundled VOICES map. CAREFUL: the package
// also ships 54 <id>.bin files (Italian/Japanese/Chinese packs included),
// but the runtime `tts.voices` map exposes only the 28 English voices — a
// .bin file is NOT synthesizable (verified against a live model load,
// 2026-07-10). Deriving from .bin files would route unsynthesizable ids
// to kokoro and 400 at play time.
function kokoroShippedIds() {
    const req = createRequire(import.meta.url);
    const src = fs.readFileSync(req.resolve('kokoro-js'), 'utf8');
    return [...new Set(src.match(/\b[a-z][fm]_[a-z]+\b/g) || [])];
}

const kokoroIds = kokoroShippedIds();
const googleIds = GOOGLE_VOICES.map(v => v.filename);
const openaiIds = OPENAI_VOICES.map(v => v.filename);

describe('voice catalogue disjointness (the derivation invariant)', () => {
    it('loads the usable kokoro catalogue from the package bundle', () => {
        expect(kokoroIds.length).toBeGreaterThan(20);
        expect(kokoroIds).toContain('af_bella');      // the en seed
        // The Italian .bin pack ships in the package but the model does NOT
        // expose it — it must not appear in the routing catalogue, or
        // derivation would send unsynthesizable ids to kokoro.
        expect(kokoroIds).not.toContain('if_sara');
    });

    it('kokoro ∩ google = ∅, kokoro ∩ openai = ∅, google ∩ openai = ∅', () => {
        const kokoro = new Set(kokoroIds);
        const google = new Set(googleIds);
        expect(googleIds.filter(id => kokoro.has(id))).toEqual([]);
        expect(openaiIds.filter(id => kokoro.has(id))).toEqual([]);
        expect(openaiIds.filter(id => google.has(id))).toEqual([]);
    });

    it('no real catalogue id has the piper shape (.onnx suffix)', () => {
        const all = [...kokoroIds, ...googleIds, ...openaiIds];
        expect(all.filter(id => VOICE_ID_PATTERNS.piper.test(id))).toEqual([]);
    });

    it('every kokoro id matches the kokoro pattern and no other (full prefix set, incl. if_sara)', () => {
        for (const id of kokoroIds) {
            expect(VOICE_ID_PATTERNS.kokoro.test(id), `kokoro pattern must match ${id}`).toBe(true);
            expect(VOICE_ID_PATTERNS.google.test(id), `google pattern must not match ${id}`).toBe(false);
            expect(VOICE_ID_PATTERNS.openai.test(id), `openai pattern must not match ${id}`).toBe(false);
        }
    });

    it('every google id matches the google pattern and no other', () => {
        for (const id of googleIds) {
            expect(VOICE_ID_PATTERNS.google.test(id), `google pattern must match ${id}`).toBe(true);
            expect(VOICE_ID_PATTERNS.kokoro.test(id), `kokoro pattern must not match ${id}`).toBe(false);
            expect(VOICE_ID_PATTERNS.openai.test(id), `openai pattern must not match ${id}`).toBe(false);
        }
    });

    it('every openai id matches the openai pattern and no other', () => {
        for (const id of openaiIds) {
            expect(VOICE_ID_PATTERNS.openai.test(id), `openai pattern must match ${id}`).toBe(true);
            expect(VOICE_ID_PATTERNS.kokoro.test(id), `kokoro pattern must not match ${id}`).toBe(false);
            expect(VOICE_ID_PATTERNS.google.test(id), `google pattern must not match ${id}`).toBe(false);
        }
    });
});

describe('shape hints (guess/validate — never the router)', () => {
    it('guesses each provider from its id shape', () => {
        expect(guessVoiceProvider('af_bella')).toBe('kokoro');
        expect(guessVoiceProvider('if_sara')).toBe('kokoro');
        expect(guessVoiceProvider('de-DE-Chirp3-HD-Aoede')).toBe('google');
        expect(guessVoiceProvider('alloy')).toBe('openai');
        expect(guessVoiceProvider('fi_FI-harri-medium.onnx')).toBe('piper');
        expect(guessVoiceProvider('totallyunknown')).toBe(null);
        expect(guessVoiceProvider('')).toBe(null);
    });

    it('a hypothetical af_bella.onnx is piper, not kokoro (suffix wins)', () => {
        expect(guessVoiceProvider('af_bella.onnx')).toBe('piper');
    });

    it('isVoiceValidForProvider stays fail-open on unknown providers', () => {
        expect(isVoiceValidForProvider('anything', 'browser')).toBe(true);
        expect(isVoiceValidForProvider('', 'kokoro')).toBe(false);
    });
});

describe('voiceLanguage / voiceMatchesLanguage', () => {
    it('derives languages from ids', () => {
        expect(voiceLanguage('de-DE-Chirp3-HD-Aoede', 'google')).toBe('de-DE');
        expect(voiceLanguage('af_bella', 'kokoro')).toBe('en-US');
        expect(voiceLanguage('if_sara', 'kokoro')).toBe('it-IT');
        expect(voiceLanguage('fi_FI-harri-medium.onnx', 'piper')).toBe('fi-FI');
        expect(voiceLanguage('alloy', 'openai')).toBe('multilingual');
        expect(voiceLanguage('garbage', 'google')).toBe(null);
    });

    it('primaryLanguage lowers to the primary subtag', () => {
        expect(primaryLanguage('de-DE')).toBe('de');
        expect(primaryLanguage('en')).toBe('en');
        expect(primaryLanguage(null)).toBe(null);
    });

    it('language matching: definite answers and null on unknown', () => {
        expect(voiceMatchesLanguage('de-DE-Chirp3-HD-Aoede', 'google', 'de')).toBe(true);
        expect(voiceMatchesLanguage('af_bella', 'kokoro', 'de')).toBe(false);
        expect(voiceMatchesLanguage('alloy', 'openai', 'de')).toBe(true); // multilingual
        expect(voiceMatchesLanguage('garbage', 'google', 'de')).toBe(null);
    });
});
