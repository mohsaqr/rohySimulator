// Phase 6 audio-fidelity test #1 — Google TTS reference hashing.
//
// CONTRACT: this is a LIVE-API test. It only runs if process.env.GOOGLE_TTS_API_KEY
// (or GOOGLE_API_KEY) is set. In CI it is wired to a nightly secret; on a
// developer workstation without a key, every live `it()` block is skipped
// cleanly (test.skip + a one-line note in the runner) so `npm run test:server`
// stays green for the 671+ unit suite.
//
// Why "reference hashing"?
//   - Google's neural TTS encoder is *slightly* non-deterministic — two calls
//     with the same voice + text produce audio that is perceptually identical
//     but bit-different (different sha256). So we cannot bit-compare WAVs.
//   - Instead we lock three coarse, stable invariants:
//       1. SAMPLE RATE — the contract is 24000 Hz (server/services/googleTts.js
//          line 24). Any change here is a regression.
//       2. PCM BYTE LENGTH — within ±10 % of a baseline. Catches Google
//          silently substituting a "similar" voice with a different speaking
//          rate or trimming behaviour.
//       3. NON-IDENTICAL HASHES across two same-voice calls — proves there is
//          no aggressive caching or substitution happening server-side.
//   - Distinct voices saying the same text MUST produce distinct audio (sanity
//     check that voice routing is wired and Google isn't returning a default).
//
// Why no fixed checked-in fixture?
//   - We can't generate fixtures without the key, and a fixture taken on one
//     day rots: Google ships voice updates without notice. Using a "live
//     baseline established at the start of this test run" gives us the same
//     regression coverage without forcing every contributor to carry stale
//     binaries. If Google deprecates a voice, the per-voice call fails (4xx)
//     and the test fails — that is the substitution-detection signal we want.
//   - The fixtures/ dir is created so a future contributor with a key can
//     drop in golden WAVs and tighten the tolerance. Today it is empty.

import { describe, it, expect, beforeAll } from 'vitest';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { synthesizeGoogleStream } from '../../../server/services/googleTts.js';

const API_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY || '';
const HAS_KEY = API_KEY.length > 0;
const SAMPLE_RATE = 24000;
const LENGTH_TOLERANCE = 0.10; // ±10 %

// One-shot diagnostic so it is obvious in CI logs which mode the file ran in.
// Vitest captures stdout; this only fires once per file.
beforeAll(() => {

    console.log(
        HAS_KEY
            ? '[google-reference] GOOGLE_TTS_API_KEY detected — running LIVE Google TTS calls'
            : '[google-reference] GOOGLE_TTS_API_KEY not set — skipping live tests (this is expected on PRs without the secret)'
    );
});

// Drain helper — synthesizeGoogleStream is an async generator that yields one
// chunk because the REST API is non-streaming. Concat into one PCM Buffer.
async function synthOnce({ text, voice, speed = 1 }) {
    const chunks = [];
    let sampleRate = null;
    for await (const chunk of synthesizeGoogleStream({
        text,
        voice,
        speed,
        apiKey: API_KEY,
    })) {
        sampleRate = chunk.sampleRate;
        chunks.push(chunk.pcm);
    }
    const pcm = Buffer.concat(chunks);
    return {
        sampleRate,
        pcm,
        length: pcm.length,
        sha256: createHash('sha256').update(pcm).digest('hex'),
    };
}

function withinTolerance(observed, baseline, tolerance) {
    const diff = Math.abs(observed - baseline) / baseline;
    return diff <= tolerance;
}

// Skip the live-API blocks cleanly when the key is missing. We use
// describe.skipIf so the block name still appears in the test report with a
// "skipped" badge, which is more informative than silently dropping it.
describe.skipIf(!HAS_KEY)('Google TTS — live reference hashing (requires GOOGLE_TTS_API_KEY)', () => {
    // Each test runs sequentially against the live API. Vitest's default is
    // parallel within a file; we keep the calls small (≤1 KB text) so total
    // runtime stays under a few seconds per voice and quota cost is negligible.

    it('en-US-Neural2-D "hello world" returns 24kHz PCM with plausible length', async () => {
        const out = await synthOnce({
            text: 'hello world',
            voice: 'en-US-Neural2-D',
        });
        expect(out.sampleRate).toBe(SAMPLE_RATE);
        // "hello world" at 24kHz mono int16 is roughly 0.6–1.2 s of audio,
        // i.e. ~28k–58k bytes. Anything outside [10k, 200k] is a red flag
        // (empty buffer, a substituted long-form voice, or an error blob).
        expect(out.length).toBeGreaterThan(10_000);
        expect(out.length).toBeLessThan(200_000);
        expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    }, 30_000);

    it('en-US-Neural2-J "hello world" produces audio distinct from Neural2-D', async () => {
        // Establish or re-use a Neural2-D baseline within this test for the
        // distinctness comparison. We re-call rather than memoise across
        // tests so each `it` block is independently runnable.
        const dOut = await synthOnce({
            text: 'hello world',
            voice: 'en-US-Neural2-D',
        });
        const jOut = await synthOnce({
            text: 'hello world',
            voice: 'en-US-Neural2-J',
        });

        expect(jOut.sampleRate).toBe(SAMPLE_RATE);
        expect(jOut.length).toBeGreaterThan(10_000);

        // Two distinct voices saying the same text MUST produce distinct
        // bytes. If they collide, Google has substituted one of them.
        expect(jOut.sha256).not.toBe(dOut.sha256);

        // Length should be in the same ballpark (same text, similar speaking
        // rate) — within ±50 %. Wider than the same-voice tolerance because
        // different voices have legitimately different cadences.
        expect(withinTolerance(jOut.length, dOut.length, 0.50)).toBe(true);
    }, 60_000);

    it('en-US-Chirp3-HD-Charon short phrase returns valid Chirp 3 audio', async () => {
        const out = await synthOnce({
            text: 'Good morning, doctor.',
            voice: 'en-US-Chirp3-HD-Charon',
        });
        expect(out.sampleRate).toBe(SAMPLE_RATE);
        // Chirp 3 HD voices share the 24kHz contract with Neural2; if Google
        // ever ships them at 48kHz this assertion is the canary.
        expect(out.length).toBeGreaterThan(10_000);
        expect(out.length).toBeLessThan(400_000);
    }, 30_000);

    it('two same-voice same-text calls produce similar-length but byte-distinct audio', async () => {
        // Locks two contracts at once:
        //   - byte-distinct: proves Google is not caching server-side and is
        //     not returning a static blob (which would mask voice deprecation).
        //   - length within ±10 %: catches voice substitution where Google
        //     swaps in a faster/slower voice without telling us.
        const a = await synthOnce({
            text: 'hello world',
            voice: 'en-US-Neural2-D',
        });
        const b = await synthOnce({
            text: 'hello world',
            voice: 'en-US-Neural2-D',
        });

        expect(a.sampleRate).toBe(SAMPLE_RATE);
        expect(b.sampleRate).toBe(SAMPLE_RATE);

        // Non-deterministic encoder — different sha is expected and required.
        // If this ever stops being true, Google has changed something we
        // should know about (likely caching, possibly a voice freeze).
        expect(a.sha256).not.toBe(b.sha256);

        expect(withinTolerance(b.length, a.length, LENGTH_TOLERANCE)).toBe(
            true
        );
    }, 60_000);
});

// This block runs ALWAYS (no API key required) — UNKNOWN_VOICE is rejected
// before any fetch. It is the cheapest possible regression check that the
// voice allow-list has not been silently widened or removed.
describe('Google TTS — voice allow-list (offline)', () => {
    it('rejects nonexistent voice with code=UNKNOWN_VOICE before any network call', async () => {
        // Guard against accidental network use: if the source ever starts
        // calling fetch *before* validating the voice, this stub will be
        // hit and we will see it in the call count.
        const calls = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (...args) => {
            calls.push(args);
            return { ok: false, status: 500, json: async () => ({}) };
        };

        try {
            const gen = synthesizeGoogleStream({
                text: 'hi',
                voice: 'nonexistent',
                speed: 1,
                apiKey: 'whatever',
            });
            await expect(gen.next()).rejects.toMatchObject({
                code: 'UNKNOWN_VOICE',
            });
            expect(calls).toHaveLength(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
