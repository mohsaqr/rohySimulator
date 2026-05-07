// OpenAI TTS — cloud-hosted, lowest latency option in the platform.
//
// Why we offer this in addition to Piper / Kokoro:
//   - Piper: very fast but robotic, runs locally as a subprocess.
//   - Kokoro: natural quality, runs locally — but pays a ~330 MB model load
//     and ~0.7× realtime CPU inference. First-byte after warmup ~600 ms.
//   - OpenAI TTS: cloud round-trip + zero local cost. Typical first-byte
//     ~300–500 ms. Native streaming PCM at 24 kHz s16le mono — matches the
//     wire format our /api/tts route already emits for Kokoro, so the
//     browser's PCM frame parser doesn't need any changes.
//
// API ref: https://platform.openai.com/docs/api-reference/audio/createSpeech
//   POST https://api.openai.com/v1/audio/speech
//   { model, input, voice, response_format: 'pcm', speed }
//
// `tts-1` is what we default to: cheapest tier and the lowest latency. The
// `tts-1-hd` and `gpt-4o-mini-tts` tiers exist but trade ~150 ms extra
// first-byte for marginally better quality and aren't worth it for the
// "patient is mid-conversation" use case.

import { Buffer } from 'node:buffer';
import { EvenByteAligner } from '../lib/pcmAlign.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const SAMPLE_RATE = 24000;   // OpenAI returns s16le mono at 24 kHz when response_format='pcm'

// The 6 voices supported by tts-1. The newer voices (ash, ballad, coral,
// sage, verse) are tts-1-hd / gpt-4o-mini-tts only — keep them out of the
// list until we expose the model picker.
export const OPENAI_VOICES = [
    { filename: 'alloy',   displayName: 'Alloy',   gender: 'neutral', language: 'en' },
    { filename: 'echo',    displayName: 'Echo',    gender: 'male',    language: 'en' },
    { filename: 'fable',   displayName: 'Fable',   gender: 'male',    language: 'en' },
    { filename: 'onyx',    displayName: 'Onyx',    gender: 'male',    language: 'en' },
    { filename: 'nova',    displayName: 'Nova',    gender: 'female',  language: 'en' },
    { filename: 'shimmer', displayName: 'Shimmer', gender: 'female',  language: 'en' }
];

const VALID_VOICES = new Set(OPENAI_VOICES.map(v => v.filename));

export function isOpenaiVoice(name) {
    return typeof name === 'string' && VALID_VOICES.has(name);
}

function resolveApiKey(platformApiKey) {
    // Env var wins so admins can keep the API key out of the database. Falls
    // back to whatever the platform LLM settings hold IF that platform is
    // also configured for OpenAI (otherwise the key likely belongs to a
    // different vendor and would 401).
    return process.env.OPENAI_API_KEY || platformApiKey || '';
}

// Streaming synth. Yields { sampleRate, pcm: Buffer } — same shape Kokoro
// emits, so the route handler can wrap both behind one frame writer.
//
// OpenAI doesn't give us sentence boundaries: it streams a continuous PCM
// blob as it synthesises. We yield chunks at whatever granularity the
// network layer hands us. The client schedules them gaplessly onto its
// audio timeline, so first audio plays as soon as the first chunk arrives.
export async function* synthesizeOpenaiStream({ text, voice, speed, apiKey, model = 'tts-1' }) {
    if (!VALID_VOICES.has(voice)) {
        const err = new Error(`unknown OpenAI voice "${voice}" (expected one of: ${[...VALID_VOICES].join(', ')})`);
        err.code = 'UNKNOWN_VOICE';
        throw err;
    }
    const key = resolveApiKey(apiKey);
    if (!key) {
        const err = new Error('OpenAI TTS requires OPENAI_API_KEY in env (or platform LLM provider set to OpenAI with a valid key)');
        err.code = 'NO_API_KEY';
        throw err;
    }

    // 30s upper bound: clinical sim lines are short (1-2 sentences), so a
    // round-trip > 30s is a stuck request. Audit #10: uniform timeout via
    // fetchWithTimeout so all providers share the same policy.
    const res = await fetchWithTimeout(OPENAI_TTS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model,
            input: text,
            voice,
            response_format: 'pcm',
            speed: typeof speed === 'number' ? speed : 1
        })
    }, { timeoutMs: 30_000 });

    if (!res.ok) {
        let msg = `OpenAI TTS HTTP ${res.status}`;
        try {
            const j = await res.json();
            if (j?.error?.message) msg = j.error.message;
        } catch { /* not json */ }
        const err = new Error(msg);
        err.code = res.status === 401 ? 'BAD_API_KEY' : 'UPSTREAM_ERROR';
        throw err;
    }

    // res.body is a web-stream ReadableStream. OpenAI flushes PCM in
    // arbitrarily-small network chunks (we've seen runs of 6–98 bytes,
    // ie. 3–50 samples at 24 kHz). Yielding each one as its own frame
    // makes the browser schedule thousands of micro-AudioBuffers per
    // second, which produces audible "chec chec sshhh" at every frame
    // boundary. Coalesce inbound bytes until we have at least
    // MIN_CHUNK_BYTES before handing off to the aligner — that's still
    // ~85 ms first-byte latency, well below the LLM streaming cadence,
    // and playback is gapless. The aligner enforces the s16le even-byte
    // invariant; without it a half-sample would shift every subsequent
    // frame and produce pure noise.
    const MIN_CHUNK_BYTES = 4096; // ≈ 85 ms at 24 kHz mono int16
    const reader = res.body.getReader();
    const aligner = new EvenByteAligner();
    let pending = [];
    let pendingLen = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                if (pendingLen > 0) {
                    const aligned = aligner.push(Buffer.concat(pending, pendingLen));
                    if (aligned) yield { sampleRate: SAMPLE_RATE, pcm: aligned };
                }
                aligner.flush(); // residual odd byte dropped
                return;
            }
            if (!value || value.length === 0) continue;
            pending.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
            pendingLen += value.byteLength;
            if (pendingLen >= MIN_CHUNK_BYTES) {
                const aligned = aligner.push(Buffer.concat(pending, pendingLen));
                pending = [];
                pendingLen = 0;
                if (aligned) yield { sampleRate: SAMPLE_RATE, pcm: aligned };
            }
        }
    } finally {
        try { reader.releaseLock(); } catch { /* noop */ }
    }
}

// Non-streaming convenience — collects the full PCM into a single WAV. Used
// by the /api/tts non-stream fallback path. Implemented as a thin loop over
// the streaming version so we have one synthesiser, not two.
export async function synthesizeOpenaiWav({ text, voice, speed, apiKey, model = 'tts-1' }) {
    const chunks = [];
    let totalLen = 0;
    for await (const { pcm } of synthesizeOpenaiStream({ text, voice, speed, apiKey, model })) {
        chunks.push(pcm);
        totalLen += pcm.length;
    }
    const pcm = Buffer.concat(chunks, totalLen);
    return wrapPcmAsWav(pcm, SAMPLE_RATE);
}

function wrapPcmAsWav(pcm, sampleRate) {
    const numChannels = 1, bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);          // PCM fmt chunk size
    header.writeUInt16LE(1, 20);           // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

export function listOpenaiVoices() {
    return OPENAI_VOICES.map(v => ({ ...v, sampleRate: SAMPLE_RATE }));
}
