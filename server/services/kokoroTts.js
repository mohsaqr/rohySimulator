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

// onnxruntime-web (which @huggingface/transformers uses on Node) defaults to
// single-threaded WASM. Benchmarked at ~20% faster at 4 threads vs 1; past
// 4 it actually gets slower (thread overhead beats parallelism for an 82M
// model). Must be set before any ORT session is created.
const _wasmThreads = Math.min(4, Math.max(1, os.cpus().length));
try {
    TRANSFORMERS_ENV.backends.onnx.wasm.numThreads = _wasmThreads;
} catch (err) {
    console.warn('[kokoro] failed to set wasm numThreads:', err.message);
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// q4 (4-bit quantized) is ~40% faster than q8 with imperceptible quality loss
// for speech. Synthesis runs at ~0.38× realtime on M-series CPU vs q8's 0.66×.
const DTYPE = 'q4';

let _instance = null;
let _loading = null;

export async function loadKokoro() {
    if (_instance) return _instance;
    if (_loading) return _loading;

    _loading = (async () => {
        const t0 = Date.now();
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE });
        console.log(`[kokoro] model loaded in ${Date.now() - t0}ms (wasm threads=${_wasmThreads}) with ${Object.keys(tts.voices).length} voices`);
        _instance = tts;
        _loading = null;
        return tts;
    })();

    return _loading;
}

export function isKokoroLoaded() {
    return !!_instance;
}

// Pack a Float32Array of mono PCM samples (range -1..1) into a 16-bit
// little-endian WAV buffer. Browsers decode this directly.
export function float32ToWav(float32, sampleRate) {
    const numSamples = float32.length;
    const dataBytes = numSamples * 2;
    const buf = Buffer.alloc(44 + dataBytes);

    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataBytes, 40);

    // Convert Float32 -1..1 to Int16 -32768..32767 with clipping.
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        let s = Math.max(-1, Math.min(1, float32[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        buf.writeInt16LE(s | 0, offset);
        offset += 2;
    }
    return buf;
}

export async function synthesizeKokoro({ text, voice, speed }) {
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
    return float32ToWav(out.audio, out.sampling_rate);
}

// Convert Float32 -1..1 PCM to little-endian Int16 bytes.
function float32ToInt16Buffer(float32) {
    const buf = Buffer.alloc(float32.length * 2);
    for (let i = 0; i < float32.length; i++) {
        let s = Math.max(-1, Math.min(1, float32[i]));
        buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2);
    }
    return buf;
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
    return Object.entries(_instance.voices).map(([id, meta]) => ({
        filename: id,
        displayName: meta.name || id,
        language: meta.language || 'en',
        gender: meta.gender || '',
        traits: meta.traits || '',
        sampleRate: 24000
    }));
}
