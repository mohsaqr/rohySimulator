// Phase 6 audio-fidelity test #2: semitone pitch independence.
//
// Locks the bb34d88 contract that `pitch` is a SEMITONE shift, decoupled
// from `speed`. This is the single most important Phase 6 test — if pitch
// ever silently re-couples to playbackRate (which is what the pre-bb34d88
// implementation did) the duration check below will fire.
//
// Strategy
// --------
//   1. Synthesize the same text at pitch ∈ {-5, 0, +5} via the real Google
//      TTS service module. Speed is held constant at 1.0.
//   2. Parse each returned WAV (RIFF/PCM-int16) into a mono Float32 array.
//   3. Duration = pcm.length / sampleRate; assert all three are within ±5%
//      (proves pitch does NOT couple to speed).
//   4. Estimate F0 by autocorrelation in the human voice band and assert
//      the ratio matches 2^(±5/12) within ±15% (Google's pitch shifter is
//      not bit-perfect; that tolerance is empirically wide enough to absorb
//      voicing variation while still catching a regression that flips the
//      semitone scaling or re-introduces playbackRate coupling).
//
// Skip behaviour
// --------------
//   Without GOOGLE_TTS_API_KEY (or GOOGLE_API_KEY) we describe.skip the
//   whole live-call block and expose a single "skipped" placeholder so the
//   suite reports green in offline CI. The helper-self-test block runs in
//   both modes — it doesn't need network.

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';

import { synthesizeGoogleWav } from '../../../server/services/googleTts.js';
import { parseWav, estimateFundamental } from './_audio-helpers.js';

// We only call Google TTS if a key is present. Both env vars are accepted
// because server/services/googleTts.js's resolveApiKey() falls back through
// both — keeping the test in lockstep with the source.
const HAVE_KEY = Boolean(process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY);

// A short utterance with sustained voicing and minimal plosive transients,
// so the autocorrelator has clean periodic structure to lock onto. Avoid
// punctuation that would inject silence breaks mid-clip (the analysis
// window is 0.4s starting at 0.2s into the audio).
const TEST_TEXT = 'The quick brown fox jumps over the lazy dog and runs along the river.';
const TEST_VOICE = 'en-US-Neural2-D'; // male, lower F0 → easier ACF lock.

// Semitone math constant. 2^(5/12) ≈ 1.4983, 2^(-5/12) ≈ 0.6674.
const SEMITONE_RATIO = Math.pow(2, 5 / 12);

// One synthesis can take 1–3 s. We do up to four sequentially in the
// idempotency test; 60s is comfortable headroom.
const NETWORK_TIMEOUT_MS = 60_000;

// Cached synthesis results so each `it()` doesn't re-spend API quota. Keyed
// by pitch; populated lazily inside the live block.
const wavCache = new Map();

async function synthAt(pitch) {
    if (wavCache.has(pitch)) return wavCache.get(pitch);
    const wavBuf = await synthesizeGoogleWav({
        text: TEST_TEXT,
        voice: TEST_VOICE,
        speed: 1,
        pitch,
    });
    const decoded = parseWav(wavBuf);
    const result = {
        wavBuf,
        decoded,
        durationSec: decoded.pcm.length / decoded.sampleRate,
    };
    wavCache.set(pitch, result);
    return result;
}

// ---------------------------------------------------------------------------
// Live block — only runs with an API key
// ---------------------------------------------------------------------------
describe.skipIf(!HAVE_KEY)('Phase 6 — pitch is a pure semitone shift (live Google TTS)', () => {
    it(
        'pitch=0 produces audio with a definable fundamental (sanity check)',
        async () => {
            const { decoded } = await synthAt(0);
            expect(decoded.sampleRate).toBe(24000);
            expect(decoded.pcm.length).toBeGreaterThan(decoded.sampleRate * 1.0); // > 1s
            const f0 = estimateFundamental({ pcm: decoded.pcm, sampleRate: decoded.sampleRate });
            // Adult-male Neural2-D F0 sits in the ~95–160 Hz range; we widen
            // the assertion to the full voicing band to absorb prosodic
            // variation across runs without being so wide it'd accept noise.
            expect(f0.frequency).toBeGreaterThan(70);
            expect(f0.frequency).toBeLessThan(300);
        },
        NETWORK_TIMEOUT_MS,
    );

    it(
        'duration is constant across pitch values (no speed coupling)',
        async () => {
            const [base, up, down] = await Promise.all([
                synthAt(0),
                synthAt(5),
                synthAt(-5),
            ]);
            const baseDur = base.durationSec;
            // ±5% — generous enough for Google's prosodic jitter between
            // requests, tight enough to fail loudly if pitch ever re-couples
            // to playbackRate (which would shift duration by ~1.5×).
            expect(Math.abs(up.durationSec - baseDur) / baseDur).toBeLessThan(0.05);
            expect(Math.abs(down.durationSec - baseDur) / baseDur).toBeLessThan(0.05);
        },
        NETWORK_TIMEOUT_MS,
    );

    it(
        'pitch=+5 shifts fundamental up by ~2^(5/12) (≈1.498×)',
        async () => {
            const [base, up] = await Promise.all([synthAt(0), synthAt(5)]);
            const f0Base = estimateFundamental({ pcm: base.decoded.pcm, sampleRate: base.decoded.sampleRate });
            const f0Up   = estimateFundamental({ pcm: up.decoded.pcm,   sampleRate: up.decoded.sampleRate });
            const ratio = f0Up.frequency / f0Base.frequency;
            // Tolerance ±15% — Google's pitch shifter introduces voicing
            // variation request-to-request; this is wide enough to accept
            // honest noise but narrow enough to reject e.g. a 1.0× (no
            // shift) or 2.0× (octave) regression.
            expect(ratio).toBeGreaterThan(SEMITONE_RATIO * 0.85);
            expect(ratio).toBeLessThan(SEMITONE_RATIO * 1.15);
        },
        NETWORK_TIMEOUT_MS,
    );

    it(
        'pitch=-5 shifts fundamental down by ~2^(-5/12) (≈0.667×)',
        async () => {
            const [base, down] = await Promise.all([synthAt(0), synthAt(-5)]);
            const f0Base = estimateFundamental({ pcm: base.decoded.pcm, sampleRate: base.decoded.sampleRate });
            const f0Down = estimateFundamental({ pcm: down.decoded.pcm, sampleRate: down.decoded.sampleRate });
            const ratio = f0Down.frequency / f0Base.frequency;
            const expected = 1 / SEMITONE_RATIO;
            expect(ratio).toBeGreaterThan(expected * 0.85);
            expect(ratio).toBeLessThan(expected * 1.15);
        },
        NETWORK_TIMEOUT_MS,
    );

    it(
        'analysis is stable: same call twice yields fundamental within ±5% (idempotency)',
        async () => {
            // Force a fresh synthesis distinct from the cached pitch=0 entry
            // by passing a temporary cache slot. The point of this test is
            // to prove the autocorrelator's verdict is repeatable — if it
            // weren't, the ±15% tolerance above would be hiding noise rather
            // than measuring real shifts.
            const a = await synthesizeGoogleWav({ text: TEST_TEXT, voice: TEST_VOICE, speed: 1, pitch: 0 });
            const b = await synthesizeGoogleWav({ text: TEST_TEXT, voice: TEST_VOICE, speed: 1, pitch: 0 });
            const da = parseWav(a);
            const db = parseWav(b);
            const fa = estimateFundamental({ pcm: da.pcm, sampleRate: da.sampleRate });
            const fb = estimateFundamental({ pcm: db.pcm, sampleRate: db.sampleRate });
            const drift = Math.abs(fa.frequency - fb.frequency) / fa.frequency;
            // Google's TTS output for an identical request is deterministic
            // up to sub-Hz jitter; a ±5% allowance is loose enough not to
            // false-fail without masking a true regression.
            expect(drift).toBeLessThan(0.05);
        },
        NETWORK_TIMEOUT_MS,
    );
});

// ---------------------------------------------------------------------------
// Always-on block — exercises the helper module against synthetic audio so
// the suite reports something meaningful even in offline CI. If parseWav or
// estimateFundamental break, the live tests above would also break — but
// this block surfaces the helper bug directly.
// ---------------------------------------------------------------------------
describe('Phase 6 — autocorrelation helper self-test (synthetic)', () => {
    function makeSineWav({ freq, durationSec, sampleRate = 24000 }) {
        const numFrames = Math.floor(durationSec * sampleRate);
        const pcm = Buffer.alloc(numFrames * 2);
        for (let i = 0; i < numFrames; i++) {
            const v = Math.sin(2 * Math.PI * freq * i / sampleRate);
            // Scale to int16 with a little headroom.
            pcm.writeInt16LE(Math.round(v * 30000), i * 2);
        }
        // Wrap as RIFF/WAVE/PCM-int16 mono — same layout wrapPcmAsWav uses.
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcm.length, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);    // PCM
        header.writeUInt16LE(1, 22);    // mono
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(pcm.length, 40);
        return Buffer.concat([header, pcm]);
    }

    it('parseWav round-trips a synthetic 24kHz mono sine', () => {
        const wav = makeSineWav({ freq: 200, durationSec: 1 });
        const decoded = parseWav(wav);
        expect(decoded.sampleRate).toBe(24000);
        expect(decoded.numChannels).toBe(1);
        expect(decoded.bitsPerSample).toBe(16);
        expect(decoded.pcm.length).toBe(24000);
        // Peak amplitude near our 30000/32768 ≈ 0.916 scale.
        let peak = 0;
        for (let i = 0; i < decoded.pcm.length; i++) peak = Math.max(peak, Math.abs(decoded.pcm[i]));
        expect(peak).toBeGreaterThan(0.85);
        expect(peak).toBeLessThan(1.0);
    });

    it('estimateFundamental locks onto a known sine within ±1 Hz', () => {
        const wav = makeSineWav({ freq: 220, durationSec: 1 });
        const decoded = parseWav(wav);
        const f0 = estimateFundamental({ pcm: decoded.pcm, sampleRate: decoded.sampleRate });
        expect(Math.abs(f0.frequency - 220)).toBeLessThan(1.0);
    });

    it('estimateFundamental tracks a +5 semitone shift on synthetic tones', () => {
        const decBase = parseWav(makeSineWav({ freq: 150, durationSec: 1 }));
        const decUp   = parseWav(makeSineWav({ freq: 150 * SEMITONE_RATIO, durationSec: 1 }));
        const fb = estimateFundamental({ pcm: decBase.pcm, sampleRate: decBase.sampleRate });
        const fu = estimateFundamental({ pcm: decUp.pcm,   sampleRate: decUp.sampleRate });
        const ratio = fu.frequency / fb.frequency;
        // On clean sines the helper should be tight (±2%); this catches a
        // helper-side regression separately from the live-call ±15%.
        expect(ratio).toBeGreaterThan(SEMITONE_RATIO * 0.98);
        expect(ratio).toBeLessThan(SEMITONE_RATIO * 1.02);
    });
});

// Visible breadcrumb when skipped so an offline run still reports the
// reason in the test output rather than silently disappearing.
describe.skipIf(HAVE_KEY)('Phase 6 — pitch-independence live tests (skipped: no GOOGLE_TTS_API_KEY)', () => {
    it.skip('set GOOGLE_TTS_API_KEY to run live pitch-independence checks', () => {});
});
