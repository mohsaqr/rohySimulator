// Phase 6 audio-fidelity test #3: provider parity.
//
// CONTRACT: per TESTING_PLAN.md Phase 6:
//   "Provider parity — Call /api/tts with all four providers + the same
//    text. Assert all four return audio with reasonable duration / sample
//    rate. Already in audit-voices.sh 10/10 — promote to Vitest if needed."
//
// We DON'T spin up the full /api/tts route here — that would force every
// test to also stand up auth, DB seeding, and the platform_settings glue
// for each provider. Instead we exercise the synthesis path each provider
// path actually uses inside `server/routes.js`:
//
//   - google → server/services/googleTts.js  → synthesizeGoogleWav()
//   - openai → server/services/openaiTts.js  → synthesizeOpenaiWav()
//   - kokoro → server/services/kokoroTts.js  → synthesizeKokoro()
//   - piper  → spawn $PIPER_BIN with --output-raw  (no service module;
//              the route calls piper directly)
//
// Each provider's prereqs are gated independently so locally most tests
// will skip cleanly:
//   - google: GOOGLE_TTS_API_KEY (or GOOGLE_API_KEY) in env
//   - openai: OPENAI_API_KEY in env
//   - kokoro: kokoro-js + first-run model download from HuggingFace.
//             Skipped if RUN_KOKORO_PARITY is not '1' (slow + network).
//   - piper:  server/data/piper/venv/bin/piper exists locally
//
// Sample rates locked here are the contract the rest of the platform
// (route handler, client PCM scheduler, WAV header builder) depends on:
//   - google: 24000 Hz (server/services/googleTts.js)
//   - openai: 24000 Hz (server/services/openaiTts.js)
//   - kokoro: 24000 Hz (Kokoro-82M model output)
//   - piper:  22050 Hz (sidecar `audio.sample_rate` for the medium models)

import { describe, it, expect, beforeAll } from 'vitest';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    synthesizeGoogleWav,
} from '../../../server/services/googleTts.js';
import {
    synthesizeOpenaiWav,
} from '../../../server/services/openaiTts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const PIPER_DIR = path.join(repoRoot, 'server', 'data', 'piper');
const PIPER_BIN = process.env.PIPER_BIN || path.join(PIPER_DIR, 'venv', 'bin', 'piper');

// Same text for every provider — the whole point of "parity" is that the
// input is constant; what varies is the synthesizer.
const PARITY_TEXT = 'parity test sentence one.';

// Locked sample rates per provider. If a provider ever silently changes
// its output rate (which would desync lipsync timing on the client), one
// of the tests below fails loudly.
const EXPECTED_SAMPLE_RATE = {
    google: 24000,
    openai: 24000,
    kokoro: 24000,
    piper:  22050,
};

// Each provider's "reasonable" minimum bytes. These are intentionally
// loose — we're catching "provider returned an empty/error WAV", not
// asserting exact byte counts (which depend on phoneme duration models
// the test can't predict). A 0.5 s s16le mono 22 kHz clip is ~22 KB,
// so 8 KB is a safe floor that still excludes "WAV with empty data".
const MIN_AUDIO_BYTES = 8 * 1024;

// Prereq guards. We compute these once in beforeAll so per-test skips
// are cheap and we don't repeatedly stat the filesystem.
const has = {
    googleKey: false,
    openaiKey: false,
    kokoroEnabled: false,
    piperBin: false,
};

beforeAll(() => {
    has.googleKey = !!(process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY);
    has.openaiKey = !!process.env.OPENAI_API_KEY;
    // Kokoro is opt-in: it downloads ~330 MB on first run from
    // HuggingFace and dominates the test runtime even after that. Gate it
    // behind RUN_KOKORO_PARITY=1 so `npm run test:server` stays fast by
    // default but we can still flip the switch in CI when we want it.
    has.kokoroEnabled = process.env.RUN_KOKORO_PARITY === '1';
    has.piperBin = fs.existsSync(PIPER_BIN);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parse the WAV header that all four providers (or the route's wrapPcmAsWav
// helper) produce. Returns { riff, wave, sampleRate, dataLen } or throws.
// CONTRACT: every WAV the platform emits is little-endian PCM s16 mono
// with the standard 44-byte RIFF/WAVE/fmt/data layout. If a provider
// silently switches to s24 or stereo, this parse fails and the test
// signals it.
function parseWavHeader(buf) {
    if (!Buffer.isBuffer(buf)) {
        throw new Error('parseWavHeader: not a Buffer');
    }
    if (buf.length < 44) {
        throw new Error(`parseWavHeader: buffer too short (${buf.length} bytes)`);
    }
    return {
        riff:        buf.slice(0, 4).toString('ascii'),
        wave:        buf.slice(8, 12).toString('ascii'),
        fmtMarker:   buf.slice(12, 16).toString('ascii'),
        audioFormat: buf.readUInt16LE(20),
        numChannels: buf.readUInt16LE(22),
        sampleRate:  buf.readUInt32LE(24),
        bitsPerSample: buf.readUInt16LE(34),
        dataMarker:  buf.slice(36, 40).toString('ascii'),
        dataLen:     buf.readUInt32LE(40),
    };
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

// Spawn piper directly (the route handler does the same; there's no
// service module wrapping it). Returns a Buffer of raw int16 LE PCM
// samples — the test wraps it in a WAV header itself for parity with
// what the route sends to the client.
function runPiper({ text, voiceFile, sampleRate }) {
    return new Promise((resolve, reject) => {
        const tmpFile = path.join(
            os.tmpdir(),
            `parity-piper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
        );
        try {
            fs.writeFileSync(tmpFile, text, 'utf8');
        } catch (err) {
            return reject(err);
        }
        const args = ['--model', voiceFile, '-i', tmpFile, '--output-raw'];
        let proc;
        try {
            proc = spawn(PIPER_BIN, args);
        } catch (err) {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
            return reject(err);
        }
        const chunks = [];
        let totalLen = 0;
        let stderrBuf = '';
        proc.stdout.on('data', (c) => { chunks.push(c); totalLen += c.length; });
        proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
        proc.on('error', (err) => {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
            reject(err);
        });
        proc.on('close', (code) => {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
            if (code !== 0) {
                return reject(new Error(`piper exited ${code}: ${stderrBuf.slice(0, 300)}`));
            }
            const pcm = Buffer.concat(chunks, totalLen);
            // Wrap into a standard 44-byte WAV — same builder shape as
            // the rest of the platform. We re-implement it inline rather
            // than import server/services/wav.js so this file is self-
            // contained and any signature change in the helper doesn't
            // silently mask a regression here.
            const numChannels = 1, bitsPerSample = 16;
            const byteRate = sampleRate * numChannels * bitsPerSample / 8;
            const blockAlign = numChannels * bitsPerSample / 8;
            const header = Buffer.alloc(44);
            header.write('RIFF', 0);
            header.writeUInt32LE(36 + pcm.length, 4);
            header.write('WAVE', 8);
            header.write('fmt ', 12);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20);
            header.writeUInt16LE(numChannels, 22);
            header.writeUInt32LE(sampleRate, 24);
            header.writeUInt32LE(byteRate, 28);
            header.writeUInt16LE(blockAlign, 32);
            header.writeUInt16LE(bitsPerSample, 34);
            header.write('data', 36);
            header.writeUInt32LE(pcm.length, 40);
            resolve(Buffer.concat([header, pcm]));
        });
    });
}

// Pick the first installed piper voice we can find. The repo ships three
// medium models but we don't want the test to hard-depend on any single
// filename — the route picks whatever's there too.
function findPiperVoice() {
    if (!fs.existsSync(PIPER_DIR)) return null;
    const onnx = fs.readdirSync(PIPER_DIR).filter(f => f.endsWith('.onnx'));
    if (onnx.length === 0) return null;
    return path.join(PIPER_DIR, onnx[0]);
}

// Cross-test cache so the "same text different audio" sanity check at
// the bottom doesn't re-synthesize. Filled opportunistically by tests
// that actually run; entries stay missing for skipped providers.
const synthesized = {};

// ---------------------------------------------------------------------------
// Per-provider parity tests
// ---------------------------------------------------------------------------

describe('provider parity — Google', () => {
    it('returns a non-empty WAV with valid RIFF header (skip without API key)', async () => {
        if (!has.googleKey) {
            // No key — skip cleanly. The audit-voices.sh runner gates
            // the live network call the same way.
            console.warn('[parity] skipping Google: no GOOGLE_TTS_API_KEY/GOOGLE_API_KEY in env');
            return;
        }
        const wav = await synthesizeGoogleWav({
            text: PARITY_TEXT,
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 0,
        });
        const hdr = parseWavHeader(wav);
        expect(hdr.riff).toBe('RIFF');
        expect(hdr.wave).toBe('WAVE');
        expect(hdr.fmtMarker).toBe('fmt ');
        expect(hdr.dataMarker).toBe('data');
        expect(hdr.audioFormat).toBe(1);            // PCM
        expect(hdr.numChannels).toBe(1);            // mono
        expect(hdr.bitsPerSample).toBe(16);
        // CONTRACT: Google audioConfig.sampleRateHertz hardcoded to 24 kHz.
        expect(hdr.sampleRate).toBe(EXPECTED_SAMPLE_RATE.google);
        expect(wav.length).toBeGreaterThan(MIN_AUDIO_BYTES);
        // dataLen should equal wav.length - 44 for a one-shot WAV.
        expect(hdr.dataLen).toBe(wav.length - 44);
        synthesized.google = wav;
    }, 60_000);
});

describe('provider parity — OpenAI', () => {
    it('returns a non-empty WAV with valid RIFF header (skip without API key)', async () => {
        if (!has.openaiKey) {
            console.warn('[parity] skipping OpenAI: no OPENAI_API_KEY in env');
            return;
        }
        const wav = await synthesizeOpenaiWav({
            text: PARITY_TEXT,
            voice: 'alloy',
            speed: 1,
        });
        const hdr = parseWavHeader(wav);
        expect(hdr.riff).toBe('RIFF');
        expect(hdr.wave).toBe('WAVE');
        expect(hdr.fmtMarker).toBe('fmt ');
        expect(hdr.dataMarker).toBe('data');
        expect(hdr.audioFormat).toBe(1);
        expect(hdr.numChannels).toBe(1);
        expect(hdr.bitsPerSample).toBe(16);
        // CONTRACT: OpenAI tts-1 PCM response is locked at 24 kHz s16le mono.
        expect(hdr.sampleRate).toBe(EXPECTED_SAMPLE_RATE.openai);
        expect(wav.length).toBeGreaterThan(MIN_AUDIO_BYTES);
        synthesized.openai = wav;
    }, 60_000);
});

describe('provider parity — Kokoro', () => {
    it('returns a non-empty WAV with valid RIFF header (skip unless RUN_KOKORO_PARITY=1)', async () => {
        if (!has.kokoroEnabled) {
            // Default-skip: kokoro-js will hit HuggingFace Hub on first
            // run to download ~330 MB. Opt in with RUN_KOKORO_PARITY=1.
            console.warn('[parity] skipping Kokoro: set RUN_KOKORO_PARITY=1 to enable (downloads model)');
            return;
        }
        let synthesizeKokoro;
        try {
            ({ synthesizeKokoro } = await import('../../../server/services/kokoroTts.js'));
        } catch (err) {
            console.warn('[parity] skipping Kokoro: import failed:', err.message);
            return;
        }
        let wav;
        try {
            wav = await synthesizeKokoro({
                text: PARITY_TEXT,
                voice: 'af_bella',  // documented fallback in voiceFallbacks.js
                speed: 1,
            });
        } catch (err) {
            // Tolerate transient HF Hub / network failures on first run —
            // the test's job is to lock the *contract*, not to assert HF
            // is up. If we got here without env-gating the test off, the
            // user explicitly opted in, so surface the error visibly.
            console.error('[parity] Kokoro synth failed:', err.message);
            throw err;
        }
        const hdr = parseWavHeader(wav);
        expect(hdr.riff).toBe('RIFF');
        expect(hdr.wave).toBe('WAVE');
        expect(hdr.fmtMarker).toBe('fmt ');
        expect(hdr.dataMarker).toBe('data');
        expect(hdr.audioFormat).toBe(1);
        expect(hdr.numChannels).toBe(1);
        expect(hdr.bitsPerSample).toBe(16);
        // CONTRACT: Kokoro-82M outputs at 24 kHz.
        expect(hdr.sampleRate).toBe(EXPECTED_SAMPLE_RATE.kokoro);
        expect(wav.length).toBeGreaterThan(MIN_AUDIO_BYTES);
        synthesized.kokoro = wav;
    }, 5 * 60_000); // model download can take minutes on first run
});

describe('provider parity — Piper', () => {
    it('returns a non-empty WAV with valid RIFF header (skip if piper not installed)', async () => {
        if (!has.piperBin) {
            console.warn(`[parity] skipping Piper: ${PIPER_BIN} not installed`);
            return;
        }
        const voiceFile = findPiperVoice();
        if (!voiceFile) {
            console.warn('[parity] skipping Piper: no .onnx voice files found');
            return;
        }
        // Read sample_rate from the sidecar — that's the contract piper
        // emits at, and the route's WAV builder reads the same field.
        let sampleRate = EXPECTED_SAMPLE_RATE.piper;
        const sidecarPath = `${voiceFile}.json`;
        if (fs.existsSync(sidecarPath)) {
            try {
                const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
                if (sidecar?.audio?.sample_rate) sampleRate = sidecar.audio.sample_rate;
            } catch { /* leave default */ }
        }
        const wav = await runPiper({ text: PARITY_TEXT, voiceFile, sampleRate });
        const hdr = parseWavHeader(wav);
        expect(hdr.riff).toBe('RIFF');
        expect(hdr.wave).toBe('WAVE');
        expect(hdr.fmtMarker).toBe('fmt ');
        expect(hdr.dataMarker).toBe('data');
        expect(hdr.audioFormat).toBe(1);
        expect(hdr.numChannels).toBe(1);
        expect(hdr.bitsPerSample).toBe(16);
        // CONTRACT: medium-quality piper voices (the ones we ship) are
        // 22050 Hz per sidecar; we only expect this if sidecar said so.
        expect(hdr.sampleRate).toBe(sampleRate);
        expect(wav.length).toBeGreaterThan(MIN_AUDIO_BYTES);
        synthesized.piper = wav;
    }, 60_000);
});

// ---------------------------------------------------------------------------
// Cross-provider parity invariants
// ---------------------------------------------------------------------------

describe('provider parity — cross-provider invariants', () => {
    it('every executed provider produced a WAV that starts with RIFF + WAVE', () => {
        // Walk whatever providers actually ran in this environment. If
        // none ran (no API keys, no piper, kokoro disabled), this test
        // still passes — it's an invariant, not a presence check. The
        // per-provider tests above already failed if any actually-run
        // provider returned a malformed buffer.
        const ran = Object.entries(synthesized).filter(([, v]) => v);
        if (ran.length === 0) {
            console.warn('[parity] no providers ran in this environment; nothing to cross-check');
            return;
        }
        for (const [provider, wav] of ran) {
            expect(wav.slice(0, 4).toString('ascii'), `${provider} RIFF header`).toBe('RIFF');
            expect(wav.slice(8, 12).toString('ascii'), `${provider} WAVE marker`).toBe('WAVE');
        }
    });

    it('different providers on the same text produce audibly-different audio (byte-distinct)', () => {
        // Sanity: if two providers ever returned byte-identical WAVs for
        // the same input, something's badly wrong (one is being silently
        // routed to the other, or both are returning a hardcoded clip).
        // We check that any two providers that BOTH ran disagree on the
        // sha256 of their output. With <2 providers run, there's nothing
        // to compare and the test no-ops.
        const ran = Object.entries(synthesized).filter(([, v]) => v);
        if (ran.length < 2) {
            console.warn(`[parity] only ${ran.length} provider(s) ran; cross-distinctness check skipped`);
            return;
        }
        const hashes = new Map(ran.map(([p, wav]) => [p, sha256(wav)]));
        const seen = new Map();
        for (const [provider, hash] of hashes) {
            if (seen.has(hash)) {
                throw new Error(`provider "${provider}" produced byte-identical audio to "${seen.get(hash)}" — providers must differ`);
            }
            seen.set(hash, provider);
        }
        // Also assert sample rates lined up with the locked table.
        for (const [provider, wav] of ran) {
            const hdr = parseWavHeader(wav);
            expect(hdr.sampleRate, `${provider} sample rate`).toBe(EXPECTED_SAMPLE_RATE[provider]);
        }
    });

    it('every executed provider returned ≥ MIN_AUDIO_BYTES of audio (non-trivial duration)', () => {
        // Catches "WAV with valid header but empty data section" — which
        // is what Google returns when an API quota error sneaks past the
        // .ok check, or what Piper would return on a phoneme-empty input.
        const ran = Object.entries(synthesized).filter(([, v]) => v);
        if (ran.length === 0) {
            console.warn('[parity] no providers ran in this environment; duration check skipped');
            return;
        }
        for (const [provider, wav] of ran) {
            expect(wav.length, `${provider} WAV bytes`).toBeGreaterThan(MIN_AUDIO_BYTES);
            // Data section length recorded in header should match actual
            // remaining bytes (off-by-N here is the kind of bug that
            // makes browsers refuse to decode).
            const hdr = parseWavHeader(wav);
            expect(hdr.dataLen, `${provider} header.dataLen vs wav.length-44`).toBe(wav.length - 44);
        }
    });
});
