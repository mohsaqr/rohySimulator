// Kokoro-82M TTS via kokoro-js. Singleton: the model is ~330 MB on disk
// and ~600 MB resident, so we lazy-load it once and reuse the instance for
// every /api/tts call.
//
// First call to load() will download model+tokenizer+voicepacks from the
// Hugging Face Hub into the user's transformers.js cache (~330 MB). After
// that, startup is ~2 s and inference is ~0.7× realtime on M-series CPU.

import { Buffer } from 'node:buffer';
import os from 'node:os';
import { env as TRANSFORMERS_ENV } from '@huggingface/transformers';
import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import { buildWavHeader, float32ToInt16Buffer } from './wav.js';
import { logger } from '../logger.js';

const kokoroLog = logger('kokoro');

// onnxruntime-web (which @huggingface/transformers uses on Node) defaults to
// single-threaded WASM. Benchmarked at ~20% faster at 4 threads vs 1; past
// 4 it actually gets slower (thread overhead beats parallelism for an 82M
// model). Must be set before any ORT session is created.
const _wasmThreads = Math.min(4, Math.max(1, os.cpus().length));
try {
    TRANSFORMERS_ENV.backends.onnx.wasm.numThreads = _wasmThreads;
} catch (err) {
    kokoroLog.warn('failed to configure wasm threads', { error: err.message });
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// q4 (4-bit quantized) is ~40% faster than q8 with imperceptible quality loss
// for speech. Synthesis runs at ~0.38× realtime on M-series CPU vs q8's 0.66×.
const DTYPE = 'q4';

let _instance = null;
let _loading = null;
// "Permanently disabled until restart" flag. Set when load fails AND the
// failure is the unrecoverable kind (truncated/corrupt ONNX, missing
// model files). Once set, every subsequent loadKokoro() call rejects
// fast — the route layer can then catch and switch to Piper instead of
// each request triggering another 80MB re-download attempt.
//
// Per AGENT-NOTE-DEPLOY-2026-05-07.md §4: an ORT-WASM crash on a
// truncated .onnx file used to take the entire Node process with it.
// Now we contain the failure inside this module, log loudly, and let
// callers recover. The deploy-side fix (TRANSFORMERS_CACHE outside
// node_modules) is still recommended to prevent the bad-cache state
// in the first place — this guard is defense-in-depth.
let _disabled = null;

const KOKORO_FATAL_PATTERNS = [
    /protobuf parsing/i,         // truncated .onnx file — most common
    /failed to allocate/i,       // OOM / WASM heap exhaustion
    /onnxruntime/i,              // ORT-internal failures
    /onnx model/i,               // generic ORT model errors
    /no such file/i,             // missing model files post-cache-wipe
    /cannot find module/i,
];

function classifyLoadError(err) {
    const msg = (err?.message || String(err)).slice(0, 500);
    return KOKORO_FATAL_PATTERNS.some(rx => rx.test(msg)) ? 'fatal' : 'transient';
}

export async function loadKokoro() {
    if (_disabled) {
        const err = new Error(`Kokoro disabled until restart: ${_disabled}`);
        err.code = 'KOKORO_DISABLED';
        throw err;
    }
    if (_instance) return _instance;
    if (_loading) return _loading;

    _loading = (async () => {
        const t0 = Date.now();
        try {
            const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE });
            kokoroLog.info('model loaded', {
                duration_ms: Date.now() - t0,
                wasm_threads: _wasmThreads,
                voice_count: Object.keys(tts.voices).length
            });
            _instance = tts;
            _loading = null;
            return tts;
        } catch (err) {
            _loading = null;
            const kind = classifyLoadError(err);
            kokoroLog.error('model load failed', {
                duration_ms: Date.now() - t0,
                kind,
                error: err.message,
                stack: err.stack || null,
            });
            if (kind === 'fatal') {
                // Don't re-attempt on every request — that just re-runs the
                // 80MB download/load that already failed. Mark disabled
                // until process restart so the route layer can fall back
                // cleanly. systemd-restart-on-deploy will clear it.
                _disabled = err.message;
                const fatal = new Error(`Kokoro permanently failed this process: ${err.message}`);
                fatal.code = 'KOKORO_DISABLED';
                throw fatal;
            }
            // Transient — re-throw so the caller sees the original error.
            // Subsequent calls will retry (no _disabled set).
            throw err;
        }
    })();

    return _loading;
}

// Test/diagnostic hook: lets a route or healthcheck see whether Kokoro
// has been permanently disabled this process and surface that to admins.
export function kokoroDisabledReason() {
    return _disabled;
}

// Test-only — clears the disabled flag and instance so each test can
// exercise its own load scenario. Not exported from the package barrel.
export function _resetForTest() {
    _instance = null;
    _loading = null;
    _disabled = null;
}

export function isKokoroLoaded() {
    return !!_instance;
}

// Test-only fake (mirrors ROHY_TEST_FAKE_GOOGLE_TTS): synthesize without
// the ~330 MB model so route tests can exercise kokoro-played fallbacks in
// CI. Voice validity is still enforced upstream by the derivation layer's
// static package catalogue.
function fakeKokoroActive() {
    return process.env.NODE_ENV === 'test' && process.env.ROHY_TEST_FAKE_KOKORO_TTS === '1';
}

export async function synthesizeKokoro({ text, voice, speed }) {
    if (fakeKokoroActive()) {
        const pcm = Buffer.alloc(2400 * 2); // 0.1s of silence @24kHz int16
        return Buffer.concat([buildWavHeader(pcm.length, 24000), pcm]);
    }
    const tts = await loadKokoro();
    if (!tts.voices[voice]) {
        const err = new Error(`unknown Kokoro voice "${voice}"`);
        err.code = 'UNKNOWN_VOICE';
        throw err;
    }
    const out = await tts.generate(text, {
        voice,
        speed: typeof speed === 'number' ? speed : 1
    });
    const pcm = float32ToInt16Buffer(out.audio);
    return Buffer.concat([buildWavHeader(pcm.length, out.sampling_rate), pcm]);
}

// Streaming synthesis: yields per-sentence chunks so the client can start
// playing the first sentence while the rest are still being synthesized.
// Format per chunk handed to the caller:
//   { sampleRate: number, pcm: Buffer (int16 LE) }
//
// We build the TextSplitterStream ourselves and explicitly close() it.
// kokoro-js's overload that accepts a plain string never closes its internal
// splitter, so the last sentence stays buffered and the async iterator
// awaits forever. Using the splitter directly fixes both the dropped
// last sentence and the hung "fails to end" symptoms.
export async function* synthesizeKokoroStream({ text, voice, speed }) {
    if (fakeKokoroActive()) {
        yield { sampleRate: 24000, pcm: Buffer.alloc(2400 * 2) };
        return;
    }
    const tts = await loadKokoro();
    if (!tts.voices[voice]) {
        const err = new Error(`unknown Kokoro voice "${voice}"`);
        err.code = 'UNKNOWN_VOICE';
        throw err;
    }
    const splitter = new TextSplitterStream();
    splitter.push(text);
    splitter.close();

    const stream = tts.stream(splitter, {
        voice,
        speed: typeof speed === 'number' ? speed : 1
    });
    for await (const out of stream) {
        yield {
            sampleRate: out.audio.sampling_rate,
            pcm: float32ToInt16Buffer(out.audio.audio)
        };
    }
}

export function listKokoroVoices() {
    if (!_instance) return [];
    // kokoro-js ships its frozen voice map with Title-Case genders ("Female",
    // "Male"). Every other provider in this codebase emits lowercase, and
    // server/routes/proxy-routes.js#voiceGenderMatchesSlot compares against
    // lowercase slot names. Normalise here so kokoro doesn't silently fall
    // through the gender check and re-route every voice to the hardcoded
    // af_bella / am_michael pair.
    return Object.entries(_instance.voices).map(([id, meta]) => ({
        filename: id,
        displayName: meta.name || id,
        language: meta.language || 'en',
        gender: (meta.gender || '').toLowerCase(),
        traits: meta.traits || '',
        sampleRate: 24000
    }));
}

// Async because the model has to be loaded before we know the voice list.
// First call may take ~3s (download + load); subsequent calls are O(1).
export async function isKokoroVoice(name) {
    if (typeof name !== 'string' || !name) return false;
    const tts = await loadKokoro();
    return !!tts.voices[name];
}
