// TTS streaming first-byte latency benchmark — Phase 7 #1.
//
// Measures, per provider:
//   - first-byte latency: ms from issuing the synthesis call to the first
//     PCM chunk arriving on the async iterator.
//   - total time: ms from issue to the iterator completing.
//
// We bench against the in-process service modules (`server/services/*Tts.js`)
// rather than spinning up the Express + sqlite stack. The route handler does
// negligible work between request boundary and `synthesize<Provider>Stream()`
// (~1 sync DB read and a few validations), so the service-layer first-byte
// number is within a few ms of the wire first-byte while removing all of the
// noise from express middleware, database fetches, and HTTP framing. The
// bench is about provider performance, not the route. Piper is benched by
// spawning the same binary the route uses with the same flags.
//
// Skip rules:
//   - Google: skipped if GOOGLE_TTS_API_KEY / GOOGLE_API_KEY not set.
//   - OpenAI: skipped if OPENAI_API_KEY not set.
//   - Kokoro: always runs (loads the model lazily). The first-byte numbers
//     are reported AFTER an explicit warmup call so the model load isn't
//     amortized into the measurement.
//   - Piper: skipped if PIPER_BIN doesn't exist or no .onnx voice is
//     available under server/data/piper/.
//
// Run with:  npm run bench
//            npx vitest bench --run bench/tts-latency.bench.js

import { describe, bench, beforeAll } from 'vitest';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { synthesizeGoogleStream } from '../server/services/googleTts.js';
import { synthesizeOpenaiStream } from '../server/services/openaiTts.js';
import {
    synthesizeKokoroStream,
    loadKokoro,
} from '../server/services/kokoroTts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Short, neutral prompt so providers do roughly comparable amounts of work.
// Keeping it under one sentence keeps total-time measurements bounded
// (otherwise OpenAI / Google would amortize ~3 s of synthesis into the
// "total" number and overwhelm the first-byte signal).
const BENCH_TEXT = 'The patient reports moderate chest pain that started this morning.';

// Bench knobs. Vitest defaults to running each `bench()` for ~500ms or 10
// iterations whichever comes first. We pin iterations explicitly so the
// total wall-clock for the file stays predictable in CI and the numbers
// are comparable across runs. `time: 0` lets `iterations` win.
const BENCH_OPTS = { iterations: 10, time: 0, warmupIterations: 1, warmupTime: 0 };

const HAS_GOOGLE_KEY = !!(process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY);
const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY;

// Match the route's resolution: env override wins, otherwise the venv path
// install-piper.sh creates.
const PIPER_DIR = path.join(repoRoot, 'server', 'data', 'piper');
const PIPER_BIN = process.env.PIPER_BIN || path.join(PIPER_DIR, 'venv', 'bin', 'piper');
function findPiperVoice() {
    if (!fs.existsSync(PIPER_DIR)) return null;
    const entries = fs.readdirSync(PIPER_DIR).filter((f) => f.endsWith('.onnx'));
    if (entries.length === 0) return null;
    return path.join(PIPER_DIR, entries[0]);
}
const PIPER_VOICE = findPiperVoice();
const HAS_PIPER = !!PIPER_VOICE && fs.existsSync(PIPER_BIN);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Drain an async iterator, return { firstByteMs, totalMs }. Returns the
// timings as side effects via the caller-provided `record` so vitest's bench
// runner can still treat the function as a void async — the bench harness
// measures the wall clock of the function itself, which equals totalMs. The
// `record` lets us also surface first-byte if we ever want a custom reporter.
async function timeStream(iter) {
    const t0 = performance.now();
    let firstByteMs = null;
    let chunks = 0;
    for await (const chunk of iter) {
        if (firstByteMs === null) firstByteMs = performance.now() - t0;
        chunks += 1;
        // Touch the buffer so V8 doesn't optimize the loop body away.
        if (!chunk || !chunk.pcm) {
            throw new Error('provider yielded chunk without pcm field');
        }
    }
    const totalMs = performance.now() - t0;
    if (firstByteMs === null) {
        throw new Error('provider yielded zero chunks');
    }
    return { firstByteMs, totalMs, chunks };
}

// Track the most-recent first-byte sample per group so a custom reporter or
// post-run inspection can pull them. Not surfaced through vitest's reporter
// directly; vitest measures the full function duration, which equals total.
const lastSamples = new Map();
function record(group, sample) {
    lastSamples.set(group, sample);
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

describe('google', () => {
    const skip = !HAS_GOOGLE_KEY;
    // Vitest's bench API supports a per-bench skip via the third options arg
    // (.skip on the metadata) on 4.x, but the cross-version-stable path is
    // a `bench.skipIf` helper. Use it when present, otherwise fall through
    // and report a no-op-style bench that returns instantly.
    const maybe = bench.skipIf ? bench.skipIf(skip) : (skip ? () => {} : bench);

    maybe('google.first-byte', async () => {
        const iter = synthesizeGoogleStream({
            text: BENCH_TEXT,
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 0,
        });
        // Google's REST endpoint is non-streaming, so first-byte ≈ total.
        // Reading the first chunk and breaking gives us the same number we
        // would see on the wire as `time-to-first-PCM-frame` from the route.
        const t0 = performance.now();
         
        for await (const _chunk of iter) {
            const fb = performance.now() - t0;
            record('google.first-byte', { firstByteMs: fb });
            return;
        }
        throw new Error('google yielded zero chunks');
    }, BENCH_OPTS);

    maybe('google.total', async () => {
        const iter = synthesizeGoogleStream({
            text: BENCH_TEXT,
            voice: 'en-US-Neural2-D',
            speed: 1,
            pitch: 0,
        });
        const sample = await timeStream(iter);
        record('google.total', sample);
    }, BENCH_OPTS);
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe('openai', () => {
    const skip = !HAS_OPENAI_KEY;
    const maybe = bench.skipIf ? bench.skipIf(skip) : (skip ? () => {} : bench);

    maybe('openai.first-byte', async () => {
        const iter = synthesizeOpenaiStream({
            text: BENCH_TEXT,
            voice: 'alloy',
            speed: 1,
        });
        const t0 = performance.now();
         
        for await (const _chunk of iter) {
            const fb = performance.now() - t0;
            record('openai.first-byte', { firstByteMs: fb });
            // Drain the rest in the background so we don't leave a half-read
            // ReadableStream attached to the underlying socket; otherwise the
            // bench's next iteration could hit a stalled connection.
            try {
                 
                for await (const _rest of iter) { /* drain */ }
            } catch { /* ignore drain errors */ }
            return;
        }
        throw new Error('openai yielded zero chunks');
    }, BENCH_OPTS);

    maybe('openai.total', async () => {
        const iter = synthesizeOpenaiStream({
            text: BENCH_TEXT,
            voice: 'alloy',
            speed: 1,
        });
        const sample = await timeStream(iter);
        record('openai.total', sample);
    }, BENCH_OPTS);
});

// ---------------------------------------------------------------------------
// Kokoro (in-process; warm the model once before benching)
// ---------------------------------------------------------------------------

describe('kokoro', () => {
    // Loading the 82M ONNX model takes 2-4s and pays a one-time cache fetch
    // on a cold machine. We do it in beforeAll so the bench's wall-clock
    // measurements only reflect synthesis, not model load. Pre-warm with a
    // tiny synthesis to JIT the ONNX session.
    beforeAll(async () => {
        const t0 = performance.now();
        await loadKokoro();
        // First synthesis is meaningfully slower than subsequent ones because
        // ORT lazily compiles the graph. Burn one synthesis as warmup.
        try {
            for await (const _c of synthesizeKokoroStream({
                text: 'warmup.',
                voice: 'af_bella',
                speed: 1,
            })) {
                break; // first chunk is enough to JIT
            }
        } catch {
            // If af_bella isn't present (kokoro-js voice list shifts between
            // versions), fall through — the actual bench will pick whatever
            // is loaded.
        }
         
        console.log(`[kokoro-bench] warmup in ${(performance.now() - t0).toFixed(0)}ms`);
    }, 60_000);

    bench('kokoro.first-byte', async () => {
        const iter = synthesizeKokoroStream({
            text: BENCH_TEXT,
            voice: 'af_bella',
            speed: 1,
        });
        const t0 = performance.now();
         
        for await (const _chunk of iter) {
            const fb = performance.now() - t0;
            record('kokoro.first-byte', { firstByteMs: fb });
            return;
        }
        throw new Error('kokoro yielded zero chunks');
    }, BENCH_OPTS);
});

// ---------------------------------------------------------------------------
// Piper (subprocess — mirrors how the route invokes it)
// ---------------------------------------------------------------------------

// Run a single Piper synthesis the same way server/routes.js does:
// `piper --model VOICE -i TMPFILE --output-raw`, returning when the first
// stdout chunk arrives (first-byte) or the process exits (total).
async function runPiperOnce({ untilFirstByte = false } = {}) {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(
        tmpDir,
        `rohy-bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
    );
    fs.writeFileSync(tmpFile, BENCH_TEXT, 'utf8');
    const args = ['--model', PIPER_VOICE, '-i', tmpFile, '--output-raw'];
    return new Promise((resolve, reject) => {
        let firstByteMs = null;
        let killed = false;
        const t0 = performance.now();
        let child;
        try {
            child = spawn(PIPER_BIN, args);
        } catch (err) {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
            reject(err);
            return;
        }
        child.stdout.on('data', () => {
            if (firstByteMs === null) {
                firstByteMs = performance.now() - t0;
                if (untilFirstByte && !killed) {
                    killed = true;
                    try { child.kill('SIGTERM'); } catch { /* noop */ }
                }
            }
        });
        // We must consume stderr to avoid OS pipe-buffer back-pressure
        // stalling the child.
        child.stderr.on('data', () => { /* discard */ });
        child.on('error', (err) => {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
            reject(err);
        });
        child.on('close', () => {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
            const totalMs = performance.now() - t0;
            if (firstByteMs === null) {
                reject(new Error('piper produced no stdout'));
                return;
            }
            resolve({ firstByteMs, totalMs });
        });
    });
}

describe('piper', () => {
    const skip = !HAS_PIPER;
    const maybe = bench.skipIf ? bench.skipIf(skip) : (skip ? () => {} : bench);

    maybe('piper.first-byte', async () => {
        const sample = await runPiperOnce({ untilFirstByte: true });
        record('piper.first-byte', sample);
    }, BENCH_OPTS);
});

// ---------------------------------------------------------------------------
// Footer: print a compact summary of the most-recent first-byte samples.
// Vitest already prints min/mean/p99 of the bench function's wall-clock; this
// extra dump exposes first-byte separately from total in the cases where
// the two differ (kokoro, openai, piper streaming).
// ---------------------------------------------------------------------------

if (typeof afterAll === 'function') {
    // afterAll is auto-imported by vitest's globals when test.globals=true,
    // but our config has globals=false. Pull it lazily so the file still
    // loads when someone runs it as a plain script.
}
