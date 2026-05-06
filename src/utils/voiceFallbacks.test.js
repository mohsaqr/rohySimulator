// src/utils/voiceFallbacks.test.js
//
// Locks in the contract of `src/utils/voiceFallbacks.js` — the *client* mirror
// of `server/services/voiceFallbacks.js`. The server copy is covered by
// `tests/server/services/voiceFallbacks.test.js`; this file owns the client
// side and additionally pins down **mirror parity** with the server table.
//
// CONTRACT (observed in src/utils/voiceFallbacks.js, ~17 lines):
//   - `PROVIDER_FALLBACK_VOICE` is a static (provider × gender) → voice-id map.
//   - Providers covered: 'kokoro', 'openai', 'google', 'piper'.
//   - Genders covered: 'female', 'male', 'child'.
//   - `fallbackVoiceFor(provider, gender)` returns
//     `PROVIDER_FALLBACK_VOICE[provider]?.[gender] || ''`.
//   - No gender normalisation — exact lowercase property lookup only.
//   - Unknown provider does NOT throw; returns '' (sentinel).
//   - Piper rows are intentionally empty strings; the client routes look up
//     the first available .onnx on the host when this is empty.
//   - The map is exported by reference and is not Object.freeze'd, but the
//     helper itself does not mutate it (idempotent across calls).
//
// MIRROR PARITY: as of writing, the client table is byte-for-byte identical
// to the server table. The parity test below imports both modules and
// compares them entry-for-entry — drift is a bug.

import { describe, it, expect } from 'vitest';
import {
    PROVIDER_FALLBACK_VOICE,
    fallbackVoiceFor,
} from './voiceFallbacks.js';
import {
    PROVIDER_FALLBACK_VOICE as SERVER_FALLBACK_MAP,
    fallbackVoiceFor as serverFallbackVoiceFor,
} from '../../server/services/voiceFallbacks.js';

// Locked-in literal (NOT derived from the import) — a regression in the
// source surfaces as a test failure rather than a tautology.
const EXPECTED_TABLE = {
    kokoro: { female: 'af_bella',        male: 'am_michael',      child: 'af_bella' },
    openai: { female: 'nova',            male: 'onyx',            child: 'shimmer' },
    google: { female: 'en-US-Neural2-F', male: 'en-US-Neural2-A', child: 'en-US-Neural2-F' },
    piper:  { female: '',                male: '',                child: '' },
};

const PROVIDERS = ['google', 'openai', 'kokoro', 'piper'];
const GENDERS = ['male', 'female', 'child'];

describe('PROVIDER_FALLBACK_VOICE (client) — static map', () => {
    it('exposes exactly the four supported providers as own keys', () => {
        expect(Object.keys(PROVIDER_FALLBACK_VOICE).sort()).toEqual(
            [...PROVIDERS].sort(),
        );
    });

    it('every (provider, gender) pair matches the locked-in table', () => {
        for (const provider of PROVIDERS) {
            for (const gender of GENDERS) {
                expect(PROVIDER_FALLBACK_VOICE[provider][gender]).toBe(
                    EXPECTED_TABLE[provider][gender],
                );
            }
        }
    });
});

describe('fallbackVoiceFor (client) — every supported combo', () => {
    it('returns a non-empty string for every non-piper (provider, gender) combo', () => {
        // Per the source, piper rows are intentionally '' (sentinel). Every
        // other (provider × gender) pair must resolve to a real voice id.
        for (const provider of ['google', 'openai', 'kokoro']) {
            for (const gender of GENDERS) {
                const voiceId = fallbackVoiceFor(provider, gender);
                expect(typeof voiceId).toBe('string');
                expect(voiceId.length).toBeGreaterThan(0);
                expect(voiceId).toBe(EXPECTED_TABLE[provider][gender]);
            }
        }
    });

    it('returns the empty-string sentinel for every (piper, gender) combo', () => {
        // Documented: piper resolves at request time from installed .onnx files.
        for (const gender of GENDERS) {
            expect(fallbackVoiceFor('piper', gender)).toBe('');
        }
    });
});

describe('fallbackVoiceFor (client) — mirror parity with server', () => {
    it('client PROVIDER_FALLBACK_VOICE matches server PROVIDER_FALLBACK_VOICE entry-for-entry', () => {
        // Drift between client and server fallback maps would be a bug — the
        // file's own header comment says "keep in lockstep with the server copy".
        expect(Object.keys(PROVIDER_FALLBACK_VOICE).sort()).toEqual(
            Object.keys(SERVER_FALLBACK_MAP).sort(),
        );
        for (const provider of PROVIDERS) {
            for (const gender of GENDERS) {
                expect(PROVIDER_FALLBACK_VOICE[provider][gender]).toBe(
                    SERVER_FALLBACK_MAP[provider][gender],
                );
            }
        }
    });

    it('client fallbackVoiceFor returns identical values to server fallbackVoiceFor', () => {
        // Cover both happy-path and edge-case inputs to make sure the
        // implementations agree on every observable behaviour.
        const cases = [
            ['google', 'female'],
            ['google', 'male'],
            ['google', 'child'],
            ['openai', 'female'],
            ['openai', 'male'],
            ['openai', 'child'],
            ['kokoro', 'female'],
            ['kokoro', 'male'],
            ['kokoro', 'child'],
            ['piper', 'female'],
            ['piper', 'male'],
            ['piper', 'child'],
            ['azure', 'female'],     // unknown provider
            ['google', 'Male'],      // wrong-case gender
            ['google', 'M'],         // gender alias
            ['google', ''],          // empty gender
            ['google', undefined],   // missing gender
            [undefined, 'male'],     // missing provider
            [null, null],            // both nullish
        ];
        for (const [provider, gender] of cases) {
            expect(fallbackVoiceFor(provider, gender)).toBe(
                serverFallbackVoiceFor(provider, gender),
            );
        }
    });
});

describe('fallbackVoiceFor (client) — gender normalisation (none)', () => {
    it('does NOT normalise gender casing or aliases — exact lowercase only', () => {
        // Mirrors the server's behaviour per its agent's report: no
        // normalisation. 'Male', 'M', 'FEMALE', etc. all miss and return ''.
        const variants = ['Male', 'MALE', 'M', 'm', 'Female', 'FEMALE', 'F', 'f', 'Child', 'CHILD', 'kid'];
        for (const variant of variants) {
            expect(fallbackVoiceFor('openai', variant)).toBe('');
        }
        // Sanity: the canonical lowercase form *does* resolve.
        expect(fallbackVoiceFor('openai', 'male')).toBe('onyx');
        expect(fallbackVoiceFor('openai', 'female')).toBe('nova');
    });

    it('returns "" for missing/nullish/unknown gender slots', () => {
        expect(fallbackVoiceFor('openai', undefined)).toBe('');
        expect(fallbackVoiceFor('openai', null)).toBe('');
        expect(fallbackVoiceFor('openai', '')).toBe('');
        expect(fallbackVoiceFor('openai', 'nonbinary')).toBe('');
        expect(fallbackVoiceFor('google', 'adult')).toBe('');
    });
});

describe('fallbackVoiceFor (client) — unknown provider', () => {
    it('returns "" for unknown / nullish / wrong-case provider (no throw)', () => {
        // Optional-chaining short-circuits and `|| ''` produces the sentinel.
        // Provider lookup is also case-sensitive (mirrors the server).
        expect(() => fallbackVoiceFor('azure', 'female')).not.toThrow();
        expect(fallbackVoiceFor('azure', 'female')).toBe('');
        expect(fallbackVoiceFor('elevenlabs', 'male')).toBe('');
        expect(fallbackVoiceFor('', 'male')).toBe('');
        expect(fallbackVoiceFor('GOOGLE', 'male')).toBe('');
        expect(() => fallbackVoiceFor(undefined, 'male')).not.toThrow();
        expect(() => fallbackVoiceFor(null, 'male')).not.toThrow();
        expect(fallbackVoiceFor(undefined, 'male')).toBe('');
        expect(fallbackVoiceFor(null, 'male')).toBe('');
    });
});

describe('fallbackVoiceFor (client) — stability & idempotency', () => {
    it('repeated calls with the same args return the same value', () => {
        // No internal state, no memoisation, no mutation. Lock in idempotency
        // so a future refactor can't silently regress it.
        const a = fallbackVoiceFor('google', 'female');
        const b = fallbackVoiceFor('google', 'female');
        const c = fallbackVoiceFor('google', 'female');
        expect(a).toBe('en-US-Neural2-F');
        expect(b).toBe(a);
        expect(c).toBe(a);

        // And for unknown inputs the sentinel is equally stable.
        expect(fallbackVoiceFor('azure', 'female')).toBe('');
        expect(fallbackVoiceFor('azure', 'female')).toBe('');
    });

    it('helper does not mutate the exported PROVIDER_FALLBACK_VOICE table', () => {
        // The table is exported by reference and is NOT Object.freeze'd
        // (verified by inspecting the source). The contract we enforce is
        // weaker but still load-bearing: the helper itself never writes to it.
        const beforeKeys = Object.keys(PROVIDER_FALLBACK_VOICE).sort();
        const beforeOpenAI = { ...PROVIDER_FALLBACK_VOICE.openai };
        const beforeGoogle = { ...PROVIDER_FALLBACK_VOICE.google };

        // Hammer the helper across every code path.
        for (const provider of [...PROVIDERS, 'azure', '', null, undefined, 'GOOGLE']) {
            for (const gender of [...GENDERS, 'Male', '', null, undefined, 'kid']) {
                fallbackVoiceFor(provider, gender);
            }
        }

        const afterKeys = Object.keys(PROVIDER_FALLBACK_VOICE).sort();
        expect(afterKeys).toEqual(beforeKeys);
        expect(PROVIDER_FALLBACK_VOICE.openai).toEqual(beforeOpenAI);
        expect(PROVIDER_FALLBACK_VOICE.google).toEqual(beforeGoogle);
        // Spot-check specific cells survived intact.
        expect(PROVIDER_FALLBACK_VOICE.openai.child).toBe('shimmer');
        expect(PROVIDER_FALLBACK_VOICE.kokoro.male).toBe('am_michael');
        expect(PROVIDER_FALLBACK_VOICE.piper.female).toBe('');
    });
});
