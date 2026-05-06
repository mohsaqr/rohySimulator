// Contract tests for server/services/openaiTts.js.
//
// What this file locks down (source of truth: the JS file under test, not
// OpenAI docs — when the two diverge, the file's behaviour is what ships):
//
//   1. The voice allow-list is exactly the 6 tts-1 voices. Newer voices
//      (ash, ballad, coral, sage, verse) reject because they need a model
//      we don't expose.
//   2. The wire body sent to api.openai.com/v1/audio/speech contains
//      response_format='pcm', model defaults to 'tts-1', and the speed
//      parameter is forwarded literally if numeric (no clamp in source —
//      see CONTRACT note on speed).
//   3. Streaming yields { sampleRate: 24000, pcm: Buffer } chunks. The
//      iterator coalesces to >= MIN_CHUNK_BYTES (4096) before emitting,
//      so test fixtures use chunks large enough to cross that threshold,
//      with one test exercising the small-chunk-coalesce path.
//   4. Even-byte alignment: an odd-length total payload drops the trailing
//      half-sample (EvenByteAligner.flush() return value is ignored).
//   5. Error mapping: 401 -> err.code === 'BAD_API_KEY', others ->
//      'UPSTREAM_ERROR'. Body's error.message is preferred when JSON.
//   6. API key resolution: env var wins; caller-supplied falls back; missing
//      throws NO_API_KEY before any fetch.
//   7. synthesizeOpenaiWav wraps the collected PCM in a 44-byte RIFF/WAVE
//      header.
//
// Approach: stub globalThis.fetch with vi.stubGlobal, hand back a
// ReadableStream constructed with Web Streams API (Node 22+ has it native),
// and inspect the captured request body. No server, no DB.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import {
    synthesizeOpenaiStream,
    synthesizeOpenaiWav,
    isOpenaiVoice,
    listOpenaiVoices,
    OPENAI_VOICES,
} from '../../../server/services/openaiTts.js';

// --- helpers ---------------------------------------------------------------

// Build a ReadableStream that emits the given Uint8Array chunks in order
// and then closes. Mirrors what the global fetch's res.body looks like for
// a streaming OpenAI audio response.
function streamOf(chunks) {
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(c);
            controller.close();
        },
    });
}

// Stand in for a successful fetch response. We intentionally don't set
// Content-Type or Content-Length — the iterator only reads `ok`, `status`,
// and `body`.
function okResponse(stream) {
    return { ok: true, status: 200, body: stream };
}

function errResponse(status, json) {
    return {
        ok: false,
        status,
        json: async () => json,
    };
}

// Drain an async iterator into an array of yielded values.
async function collect(iter) {
    const out = [];
    for await (const v of iter) out.push(v);
    return out;
}

// --- env hygiene -----------------------------------------------------------
//
// resolveApiKey() reads process.env.OPENAI_API_KEY first. Any test that
// wants to validate the "no key" path must scrub it, and any test that
// wants the env path must set it. We snapshot/restore around every test.

let originalEnvKey;

beforeEach(() => {
    originalEnvKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
    if (originalEnvKey === undefined) {
        delete process.env.OPENAI_API_KEY;
    } else {
        process.env.OPENAI_API_KEY = originalEnvKey;
    }
    vi.unstubAllGlobals();
});

// ===========================================================================
// 1. Voice allow-list
// ===========================================================================

describe('OpenAI voice allow-list', () => {
    it('OPENAI_VOICES exposes exactly alloy/echo/fable/onyx/nova/shimmer', () => {
        const names = OPENAI_VOICES.map((v) => v.filename).sort();
        expect(names).toEqual(['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']);
    });

    it('isOpenaiVoice accepts the 6 known voices and rejects newer-tier names', () => {
        expect(isOpenaiVoice('alloy')).toBe(true);
        expect(isOpenaiVoice('shimmer')).toBe(true);
        // Newer voices require tts-1-hd / gpt-4o-mini-tts and are
        // intentionally excluded — see file comment.
        expect(isOpenaiVoice('ash')).toBe(false);
        expect(isOpenaiVoice('coral')).toBe(false);
        expect(isOpenaiVoice('verse')).toBe(false);
        expect(isOpenaiVoice('not-a-voice')).toBe(false);
        expect(isOpenaiVoice(undefined)).toBe(false);
        expect(isOpenaiVoice(123)).toBe(false);
    });

    it('synthesizeOpenaiStream throws UNKNOWN_VOICE for unlisted voices before fetching', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        process.env.OPENAI_API_KEY = 'sk-test';

        const iter = synthesizeOpenaiStream({
            text: 'hi', voice: 'verse', speed: 1, apiKey: 'sk-test',
        });
        await expect(collect(iter)).rejects.toMatchObject({
            code: 'UNKNOWN_VOICE',
            message: expect.stringMatching(/unknown OpenAI voice/i),
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// 2. Request body shape (model / format / speed pass-through)
// ===========================================================================

describe('OpenAI TTS request body', () => {
    let captured;

    beforeEach(() => {
        captured = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            captured = { url: _url, init, body: JSON.parse(init.body) };
            // Empty stream — iterator finishes cleanly, we don't care about
            // payload bytes for these assertions.
            return okResponse(streamOf([]));
        }));
    });

    it('POSTs to /v1/audio/speech with default model tts-1 and response_format=pcm', async () => {
        await collect(synthesizeOpenaiStream({
            text: 'hello world', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        }));
        expect(captured.url).toBe('https://api.openai.com/v1/audio/speech');
        expect(captured.init.method).toBe('POST');
        expect(captured.init.headers['Authorization']).toBe('Bearer sk-test');
        expect(captured.init.headers['Content-Type']).toBe('application/json');
        expect(captured.body.model).toBe('tts-1');
        expect(captured.body.response_format).toBe('pcm');
        expect(captured.body.input).toBe('hello world');
        expect(captured.body.voice).toBe('alloy');
    });

    it('forwards explicit model="tts-1-hd" through to the request body', async () => {
        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'nova', speed: 1, apiKey: 'sk-test', model: 'tts-1-hd',
        }));
        expect(captured.body.model).toBe('tts-1-hd');
    });

    // CONTRACT: the file does NOT clamp `speed` — it only checks
    // `typeof speed === 'number'` and uses 1 otherwise. OpenAI's documented
    // accepted range is 0.25..4.0; out-of-range values are passed through
    // verbatim and OpenAI itself enforces the range with a 400. If the
    // server gains a clamp later, REPLACE these expectations rather than
    // adding new ones — the new clamp behaviour is what should be locked.
    it('forwards speed=1 (mid) verbatim to the request body', async () => {
        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        }));
        expect(captured.body.speed).toBe(1);
    });

    it('forwards speed=0.25 (OpenAI min) and speed=4 (OpenAI max) verbatim', async () => {
        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 0.25, apiKey: 'sk-test',
        }));
        expect(captured.body.speed).toBe(0.25);

        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 4, apiKey: 'sk-test',
        }));
        expect(captured.body.speed).toBe(4);
    });

    it('forwards out-of-range speed=10 verbatim (no client-side clamp) and falls back to 1 for non-numeric speed', async () => {
        // CONTRACT: source has no clamp; this lets OpenAI 400 instead.
        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 10, apiKey: 'sk-test',
        }));
        expect(captured.body.speed).toBe(10);

        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 'fast', apiKey: 'sk-test',
        }));
        expect(captured.body.speed).toBe(1);

        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', apiKey: 'sk-test',
        }));
        expect(captured.body.speed).toBe(1);
    });
});

// ===========================================================================
// 3. Streaming PCM iterator: coalescing + 24kHz reporting
// ===========================================================================

describe('synthesizeOpenaiStream — PCM streaming', () => {
    it('yields { sampleRate: 24000, pcm: Buffer } and concatenates the bytes losslessly', async () => {
        // Two even-length chunks, each large enough on its own to cross
        // MIN_CHUNK_BYTES (4096), so each maps to one yielded frame.
        const a = new Uint8Array(5000).fill(0xAA);
        const b = new Uint8Array(5000).fill(0xBB);
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(streamOf([a, b]))));

        const out = await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        }));

        expect(out.length).toBeGreaterThanOrEqual(1);
        for (const frame of out) {
            expect(frame.sampleRate).toBe(24000);
            expect(Buffer.isBuffer(frame.pcm)).toBe(true);
        }
        const total = Buffer.concat(out.map((f) => f.pcm));
        expect(total.length).toBe(a.length + b.length);
        // First half should be 0xAA, second half 0xBB after concatenation.
        expect(total[0]).toBe(0xAA);
        expect(total[total.length - 1]).toBe(0xBB);
    });

    it('coalesces tiny network chunks below MIN_CHUNK_BYTES until the threshold is crossed', async () => {
        // 10 small chunks of 600 bytes = 6000 bytes total. The iterator's
        // MIN_CHUNK_BYTES is 4096, so we expect coalesced output rather
        // than one frame per network read.
        const small = Array.from({ length: 10 }, () => new Uint8Array(600).fill(0x55));
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(streamOf(small))));

        const out = await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        }));

        // Far fewer frames than network chunks (coalescing works), and
        // total bytes equal sum of inputs.
        expect(out.length).toBeLessThan(small.length);
        expect(out.length).toBeGreaterThanOrEqual(1);
        const total = out.reduce((n, f) => n + f.pcm.length, 0);
        expect(total).toBe(6000);
    });

    it('drops the trailing odd byte (PCM s16le even-byte alignment) at end of stream', async () => {
        // 4097 bytes total: aligner emits 4096, holds 1, end-of-stream
        // flushes the carry and the source intentionally ignores it.
        // CONTRACT: half a sample is dropped, not emitted — locks the
        // EvenByteAligner.flush() return-value-discard in openaiTts.js.
        const odd = new Uint8Array(4097).fill(0x77);
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(streamOf([odd]))));

        const out = await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        }));

        const total = out.reduce((n, f) => n + f.pcm.length, 0);
        expect(total).toBe(4096);
        // Every emitted frame must itself have even length.
        for (const f of out) {
            expect(f.pcm.length % 2).toBe(0);
        }
    });

    it('handles empty network chunks without yielding empty frames', async () => {
        // The reader sometimes hands back zero-length values; the iterator
        // should `continue` past them. Mix in a real chunk so we have
        // something to assert non-empty output on.
        const empty = new Uint8Array(0);
        const real = new Uint8Array(5000).fill(0x33);
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(streamOf([empty, real, empty]))));

        const out = await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        }));
        for (const f of out) expect(f.pcm.length).toBeGreaterThan(0);
        const total = out.reduce((n, f) => n + f.pcm.length, 0);
        expect(total).toBe(5000);
    });
});

// ===========================================================================
// 4. HTTP error mapping
// ===========================================================================

describe('synthesizeOpenaiStream — error mapping', () => {
    async function expectThrowOnStatus(status, expectedCode) {
        vi.stubGlobal('fetch', vi.fn(async () => errResponse(status, {
            error: { message: `oai-${status}-message` },
        })));
        const iter = synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        });
        await expect(collect(iter)).rejects.toMatchObject({
            code: expectedCode,
            message: `oai-${status}-message`,
        });
    }

    it('maps HTTP 401 to err.code = BAD_API_KEY with OpenAI error.message', async () => {
        await expectThrowOnStatus(401, 'BAD_API_KEY');
    });

    it('maps HTTP 400, 403, 429, 500 to err.code = UPSTREAM_ERROR', async () => {
        await expectThrowOnStatus(400, 'UPSTREAM_ERROR');
        await expectThrowOnStatus(403, 'UPSTREAM_ERROR');
        await expectThrowOnStatus(429, 'UPSTREAM_ERROR');
        await expectThrowOnStatus(500, 'UPSTREAM_ERROR');
    });

    it('falls back to "OpenAI TTS HTTP <status>" when the error body is not JSON', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 503,
            json: async () => { throw new Error('not json'); },
        })));
        const iter = synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        });
        await expect(collect(iter)).rejects.toMatchObject({
            code: 'UPSTREAM_ERROR',
            message: 'OpenAI TTS HTTP 503',
        });
    });
});

// ===========================================================================
// 5. API key resolution
// ===========================================================================

describe('OpenAI TTS API key resolution', () => {
    it('throws NO_API_KEY before fetching when neither env nor caller key is set', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const iter = synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: '',
        });
        await expect(collect(iter)).rejects.toMatchObject({
            code: 'NO_API_KEY',
            message: expect.stringMatching(/OPENAI_API_KEY/i),
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('uses process.env.OPENAI_API_KEY in preference to the caller-supplied key', async () => {
        let captured;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            captured = init.headers['Authorization'];
            return okResponse(streamOf([]));
        }));
        process.env.OPENAI_API_KEY = 'sk-from-env';
        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-from-caller',
        }));
        expect(captured).toBe('Bearer sk-from-env');
    });

    it('falls back to the caller-supplied apiKey when env is unset', async () => {
        let captured;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            captured = init.headers['Authorization'];
            return okResponse(streamOf([]));
        }));
        await collect(synthesizeOpenaiStream({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-from-caller',
        }));
        expect(captured).toBe('Bearer sk-from-caller');
    });
});

// ===========================================================================
// 6. synthesizeOpenaiWav — non-streaming wrapper
// ===========================================================================

describe('synthesizeOpenaiWav', () => {
    it('collects all PCM chunks into a 44-byte-RIFF-header WAV at 24 kHz mono s16le', async () => {
        // Two chunks, even-length, total 8000 bytes of PCM.
        const a = new Uint8Array(4000).fill(0x11);
        const b = new Uint8Array(4000).fill(0x22);
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(streamOf([a, b]))));

        const wav = await synthesizeOpenaiWav({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        });

        expect(Buffer.isBuffer(wav)).toBe(true);
        expect(wav.length).toBe(44 + 8000);
        // Header invariants — locks the file's wrapPcmAsWav.
        expect(wav.slice(0, 4).toString('ascii')).toBe('RIFF');
        expect(wav.slice(8, 12).toString('ascii')).toBe('WAVE');
        expect(wav.slice(12, 16).toString('ascii')).toBe('fmt ');
        expect(wav.slice(36, 40).toString('ascii')).toBe('data');
        expect(wav.readUInt16LE(20)).toBe(1);       // PCM format
        expect(wav.readUInt16LE(22)).toBe(1);       // mono
        expect(wav.readUInt32LE(24)).toBe(24000);   // sample rate
        expect(wav.readUInt16LE(34)).toBe(16);      // bits/sample
        expect(wav.readUInt32LE(40)).toBe(8000);    // data chunk size
    });

    it('propagates errors from the underlying stream (UPSTREAM_ERROR on 429)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => errResponse(429, {
            error: { message: 'rate limited' },
        })));
        await expect(synthesizeOpenaiWav({
            text: 'hi', voice: 'alloy', speed: 1, apiKey: 'sk-test',
        })).rejects.toMatchObject({
            code: 'UPSTREAM_ERROR',
            message: 'rate limited',
        });
    });
});

// ===========================================================================
// 7. listOpenaiVoices — convenience exporter
// ===========================================================================

describe('listOpenaiVoices', () => {
    it('annotates every voice with sampleRate=24000 and preserves filename/displayName/gender/language', () => {
        const list = listOpenaiVoices();
        expect(list).toHaveLength(6);
        for (const v of list) {
            expect(v.sampleRate).toBe(24000);
            expect(typeof v.filename).toBe('string');
            expect(typeof v.displayName).toBe('string');
            expect(typeof v.gender).toBe('string');
            expect(v.language).toBe('en');
        }
        // Spot-check a known entry.
        const alloy = list.find((v) => v.filename === 'alloy');
        expect(alloy).toMatchObject({
            filename: 'alloy', displayName: 'Alloy', gender: 'neutral',
            language: 'en', sampleRate: 24000,
        });
    });
});
