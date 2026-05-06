// tests/server/services/voiceFallbacks.test.js
//
// Locks in the contract of `server/services/voiceFallbacks.js`:
//
//   - `PROVIDER_FALLBACK_VOICE` is a static (provider × gender) → voice-id map.
//   - `fallbackVoiceFor(provider, gender)` returns `map[provider]?.[gender] || ''`.
//
// CONTRACT (observed in voiceFallbacks.js, ~35 lines):
//   - Providers covered: 'kokoro', 'openai', 'google', 'piper'.
//   - Genders covered: 'female', 'male', 'child'.
//   - The map is exported by reference; it is not frozen, but tests assert it
//     is observably stable across calls (no mutation by the helper itself).
//   - Gender normalisation is NOT performed — the helper does an exact
//     property lookup. 'Male', 'M', 'm', 'FEMALE' all miss and return ''.
//   - Age-based child routing is NOT performed — there is no age parameter.
//   - Unknown provider does NOT throw — returns '' (sentinel: empty string).
//   - Piper rows are intentionally empty strings; the helper still resolves
//     them (the empty string passes through `||` and becomes ''), so piper
//     callers always see '' regardless of gender.
//
// NOTE: a mirror module exists at `src/utils/voiceFallbacks.js` for the
// client side. Phase 3 owns that test; this file does not import the client.

import { describe, it, expect } from 'vitest';
import {
    PROVIDER_FALLBACK_VOICE,
    fallbackVoiceFor,
} from '../../../server/services/voiceFallbacks.js';

// The full table this test pins down. Kept literal (not derived from the
// import) so a regression in the source surfaces as a test failure rather
// than a tautology.
const EXPECTED_TABLE = {
    kokoro: { female: 'af_bella',        male: 'am_michael',      child: 'af_bella' },
    openai: { female: 'nova',            male: 'onyx',            child: 'shimmer' },
    google: { female: 'en-US-Neural2-F', male: 'en-US-Neural2-A', child: 'en-US-Neural2-F' },
    piper:  { female: '',                male: '',                child: '' },
};

const PROVIDERS = ['kokoro', 'openai', 'google', 'piper'];
const GENDERS = ['female', 'male', 'child'];

describe('PROVIDER_FALLBACK_VOICE static map', () => {
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

    it('every non-piper (provider, gender) entry is a non-empty string id', () => {
        for (const provider of ['kokoro', 'openai', 'google']) {
            for (const gender of GENDERS) {
                const voiceId = PROVIDER_FALLBACK_VOICE[provider][gender];
                expect(typeof voiceId).toBe('string');
                expect(voiceId.length).toBeGreaterThan(0);
            }
        }
    });

    it('piper row is empty by design (host-dependent .onnx lookup)', () => {
        // Documented in the source comment: piper resolves at request time.
        for (const gender of GENDERS) {
            expect(PROVIDER_FALLBACK_VOICE.piper[gender]).toBe('');
        }
    });
});

describe('fallbackVoiceFor(provider, gender)', () => {
    it('returns the table value for every supported (provider, gender) combo', () => {
        for (const provider of PROVIDERS) {
            for (const gender of GENDERS) {
                expect(fallbackVoiceFor(provider, gender)).toBe(
                    EXPECTED_TABLE[provider][gender],
                );
            }
        }
    });

    it('does NOT normalise gender casing or aliases — exact lookup only', () => {
        // Each of these maps to a real entry only via exact lowercase string.
        // The helper does no normalisation, so all variants miss and return ''.
        const variants = ['Male', 'MALE', 'M', 'm', 'Female', 'FEMALE', 'F', 'f', 'Child', 'CHILD', 'kid'];
        for (const variant of variants) {
            expect(fallbackVoiceFor('openai', variant)).toBe('');
        }
        // Sanity: the canonical lowercase form *does* resolve.
        expect(fallbackVoiceFor('openai', 'male')).toBe('onyx');
    });

    it('returns empty string for unknown provider (no throw, sentinel only)', () => {
        // Optional-chaining short-circuits and `|| ''` produces the sentinel.
        expect(() => fallbackVoiceFor('azure', 'female')).not.toThrow();
        expect(fallbackVoiceFor('azure', 'female')).toBe('');
        expect(fallbackVoiceFor('elevenlabs', 'male')).toBe('');
        expect(fallbackVoiceFor('', 'male')).toBe('');
        expect(fallbackVoiceFor('GOOGLE', 'male')).toBe(''); // case-sensitive provider too
    });

    it('returns empty string for missing / nullish / unknown gender slot', () => {
        expect(fallbackVoiceFor('openai', undefined)).toBe('');
        expect(fallbackVoiceFor('openai', null)).toBe('');
        expect(fallbackVoiceFor('openai', '')).toBe('');
        expect(fallbackVoiceFor('openai', 'nonbinary')).toBe('');
        expect(fallbackVoiceFor('google', 'adult')).toBe('');
    });

    it('returns empty string for nullish provider too (no crash on undefined)', () => {
        expect(() => fallbackVoiceFor(undefined, 'male')).not.toThrow();
        expect(() => fallbackVoiceFor(null, 'male')).not.toThrow();
        expect(fallbackVoiceFor(undefined, 'male')).toBe('');
        expect(fallbackVoiceFor(null, 'male')).toBe('');
    });

    it('piper returns empty string for every gender (matches the empty row)', () => {
        // The `|| ''` clause makes empty rows indistinguishable from misses,
        // which is exactly the documented behaviour: piper callers must
        // resolve a concrete voice from the host-installed .onnx files.
        for (const gender of GENDERS) {
            expect(fallbackVoiceFor('piper', gender)).toBe('');
        }
    });

    it('is stable: repeated calls with the same args return the same value', () => {
        // No internal state, no mutation. Lock in idempotency so a future
        // refactor (e.g. memoisation, lazy init) can't silently regress it.
        const first = fallbackVoiceFor('google', 'female');
        const second = fallbackVoiceFor('google', 'female');
        const third = fallbackVoiceFor('google', 'female');
        expect(first).toBe('en-US-Neural2-F');
        expect(second).toBe(first);
        expect(third).toBe(first);

        // Calling the helper does not mutate the exported table.
        const beforeKeys = Object.keys(PROVIDER_FALLBACK_VOICE).sort();
        fallbackVoiceFor('openai', 'child');
        fallbackVoiceFor('bogus', 'bogus');
        fallbackVoiceFor('kokoro', 'male');
        const afterKeys = Object.keys(PROVIDER_FALLBACK_VOICE).sort();
        expect(afterKeys).toEqual(beforeKeys);
        expect(PROVIDER_FALLBACK_VOICE.openai.child).toBe('shimmer');
    });
});
