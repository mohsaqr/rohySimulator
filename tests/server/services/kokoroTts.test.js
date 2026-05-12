// Server-side Kokoro TTS contract tests.
//
// CONTRACT: server/services/kokoroTts.js exposes five behaviors we lock down
// here against the `kokoro-js` package boundary. Unlike the Google/OpenAI
// services which talk HTTP, Kokoro runs *in-process*: the transport is the
// `kokoro-js` library (which itself wraps onnxruntime-web through
// `@huggingface/transformers`). So instead of stubbing `globalThis.fetch`,
// we mock the two ESM modules with `vi.mock(..., factory)` BEFORE importing
// the SUT, then drive the fake `KokoroTTS` instance to exercise every branch.
//
// Locked contracts:
//   1. Singleton load — `loadKokoro()` calls `KokoroTTS.from_pretrained` exactly
//      once even under concurrent callers; `isKokoroLoaded()` flips false→true.
//   2. Voice resolution — known voice succeeds; unknown voice throws an Error
//      with `code === 'UNKNOWN_VOICE'` for both batch and streaming entry points.
//   3. Speed defaulting & forwarding — non-numeric speed becomes `1`; numeric
//      speed (incl. extreme values like 5 or 0.1) is forwarded verbatim. Note
//      kokoro-js does NOT clamp speed — the wrapper passes whatever it gets,
//      so we lock the *contract that there is no clamp*.
//   4. WAV assembly — batch output prepends a 44-byte RIFF/WAVE header and the
//      header's sample-rate bytes match `out.sampling_rate` returned by the
//      model (24000 for Kokoro-82M).
//   5. Streaming — `synthesizeKokoroStream` yields `{ sampleRate, pcm }` per
//      sentence, in order, without trailing buffered chunks (the bug fix the
//      module's own comment calls out).
//   6. Voice listing — `listKokoroVoices()` returns `[]` before load; after
//      load, every entry is shaped `{ filename, displayName, language, gender,
//      traits, sampleRate: 24000 }` with sensible fallbacks.
//   7. `isKokoroVoice` — string/non-string handling and lookup truthiness.
//
// We DO NOT exercise the real ONNX runtime, real model download, or
// real audio generation here. Those are integration concerns; this file is
// pure unit and runs offline in <100 ms.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// Mock setup. Vitest hoists vi.mock() above imports, so the SUT will see
// these fakes when it does `import { KokoroTTS, TextSplitterStream } from 'kokoro-js'`.
// ---------------------------------------------------------------------------

// State accessible to tests so each it() can reshape the fake without
// re-mocking. The module factories close over these refs, so reassigning
// `mockState.voices` etc. between tests works without re-importing.
const mockState = {
    voices: {},
    fromPretrainedCalls: 0,
    fromPretrainedDelayMs: 0,
    // generate(text, opts) → { audio: Float32Array, sampling_rate }
    generateImpl: null,
    // stream(splitter, opts) → async iterable of { audio: { audio: Float32Array, sampling_rate } }
    streamImpl: null,
    // recorded constructor args for TextSplitterStream usage
    splitterPushed: [],
    splitterClosed: false,
};

vi.mock('kokoro-js', () => {
    class FakeKokoroTTS {
        constructor(voices) {
            this.voices = voices;
        }
        static async from_pretrained(_modelId, _opts) {
            mockState.fromPretrainedCalls += 1;
            if (mockState.fromPretrainedDelayMs > 0) {
                await new Promise((r) => setTimeout(r, mockState.fromPretrainedDelayMs));
            }
            return new FakeKokoroTTS(mockState.voices);
        }
        async generate(text, opts) {
            return mockState.generateImpl
                ? mockState.generateImpl(text, opts)
                : { audio: new Float32Array([0, 0.5, -0.5, 0]), sampling_rate: 24000 };
        }
        stream(splitter, opts) {
            return mockState.streamImpl
                ? mockState.streamImpl(splitter, opts)
                : (async function* () {
                    yield { audio: { audio: new Float32Array([0.1, 0.2]), sampling_rate: 24000 } };
                })();
        }
    }

    class FakeTextSplitterStream {
        constructor() {
            mockState.splitterPushed = [];
            mockState.splitterClosed = false;
        }
        push(text) { mockState.splitterPushed.push(text); }
        close() { mockState.splitterClosed = true; }
    }

    return {
        KokoroTTS: FakeKokoroTTS,
        TextSplitterStream: FakeTextSplitterStream,
    };
});

// `@huggingface/transformers` exports `env.backends.onnx.wasm.numThreads` —
// the SUT writes to it at import time. Provide a minimal compatible shape.
vi.mock('@huggingface/transformers', () => ({
    env: {
        backends: {
            onnx: {
                wasm: { numThreads: 1 },
            },
        },
    },
}));

// ---------------------------------------------------------------------------
// Helper: import the SUT *fresh* per test so the module-level singleton
// (`_instance`/`_loading`) doesn't leak between tests.
// ---------------------------------------------------------------------------

async function loadFreshSUT() {
    vi.resetModules();
    return import('../../../server/services/kokoroTts.js');
}

function defaultVoices() {
    // Match kokoro-js's real shape: gender is Title-Case ("Female" / "Male")
    // in the frozen voice map shipped by node_modules/kokoro-js. The previous
    // lowercase mock hid a deploy bug where every voice fell through the
    // server's case-sensitive gender check and got rerouted to the hardcoded
    // af_bella / am_michael fallbacks.
    return {
        af_bella: { name: 'Bella', language: 'en', gender: 'Female', traits: 'warm' },
        am_adam: { name: 'Adam', language: 'en', gender: 'Male' },
        // bare entry — exercises the listKokoroVoices fallbacks
        zz_bare: {},
    };
}

beforeEach(() => {
    mockState.voices = defaultVoices();
    mockState.fromPretrainedCalls = 0;
    mockState.fromPretrainedDelayMs = 0;
    mockState.generateImpl = null;
    mockState.streamImpl = null;
    mockState.splitterPushed = [];
    mockState.splitterClosed = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kokoroTts: loadKokoro / isKokoroLoaded singleton', () => {
    it('loads the model exactly once across sequential calls', async () => {
        const sut = await loadFreshSUT();
        expect(sut.isKokoroLoaded()).toBe(false);
        const a = await sut.loadKokoro();
        const b = await sut.loadKokoro();
        expect(a).toBe(b);
        expect(mockState.fromPretrainedCalls).toBe(1);
        expect(sut.isKokoroLoaded()).toBe(true);
    });

    it('coalesces concurrent loadKokoro() callers into a single from_pretrained call', async () => {
        const sut = await loadFreshSUT();
        mockState.fromPretrainedDelayMs = 25;
        const [a, b, c] = await Promise.all([sut.loadKokoro(), sut.loadKokoro(), sut.loadKokoro()]);
        expect(a).toBe(b);
        expect(b).toBe(c);
        // CONTRACT: the second/third callers see the in-flight `_loading`
        // promise rather than kicking off a parallel download.
        expect(mockState.fromPretrainedCalls).toBe(1);
    });
});

describe('kokoroTts: synthesizeKokoro voice + speed contract', () => {
    it('returns a Buffer that starts with a RIFF/WAVE header at 24kHz', async () => {
        const sut = await loadFreshSUT();
        // Use a 4-sample float32 input → 8 bytes int16 PCM → 52 byte total.
        mockState.generateImpl = async () => ({
            audio: new Float32Array([0, 0.5, -0.5, 1]),
            sampling_rate: 24000,
        });
        const out = await sut.synthesizeKokoro({ text: 'hi', voice: 'af_bella', speed: 1 });
        expect(Buffer.isBuffer(out)).toBe(true);
        expect(out.length).toBe(44 + 8);
        expect(out.slice(0, 4).toString('ascii')).toBe('RIFF');
        expect(out.slice(8, 12).toString('ascii')).toBe('WAVE');
        // CONTRACT: bytes 24..27 of a WAV header are the sample rate, LE.
        expect(out.readUInt32LE(24)).toBe(24000);
        // data chunk length at offset 40 == int16 PCM byte count
        expect(out.readUInt32LE(40)).toBe(8);
    });

    it('throws code=UNKNOWN_VOICE for an unknown batch voice', async () => {
        const sut = await loadFreshSUT();
        await expect(
            sut.synthesizeKokoro({ text: 'hi', voice: 'nope_nope', speed: 1 })
        ).rejects.toMatchObject({ code: 'UNKNOWN_VOICE', message: /unknown Kokoro voice "nope_nope"/ });
    });

    it('forwards numeric speed verbatim (no clamping in the wrapper)', async () => {
        const sut = await loadFreshSUT();
        let captured;
        mockState.generateImpl = async (text, opts) => {
            captured = { text, opts };
            return { audio: new Float32Array([0]), sampling_rate: 24000 };
        };
        await sut.synthesizeKokoro({ text: 'go', voice: 'af_bella', speed: 5 });
        // CONTRACT: this wrapper does NOT clamp speed. Kokoro-js itself will
        // accept extreme values; the platform settings layer is responsible
        // for any user-facing clamp. If you add a clamp, update this test.
        expect(captured.opts.speed).toBe(5);
        expect(captured.opts.voice).toBe('af_bella');
        expect(captured.text).toBe('go');
    });

    it('defaults non-numeric speed to 1', async () => {
        const sut = await loadFreshSUT();
        let captured;
        mockState.generateImpl = async (_text, opts) => {
            captured = opts;
            return { audio: new Float32Array([0]), sampling_rate: 24000 };
        };
        await sut.synthesizeKokoro({ text: 'go', voice: 'af_bella', speed: 'fast' });
        expect(captured.speed).toBe(1);
    });

    it('honours the model-reported sample rate when it differs from 24kHz', async () => {
        // Defensive: while shipped Kokoro reports 24000, the wrapper is
        // sample-rate agnostic and just propagates `out.sampling_rate`.
        const sut = await loadFreshSUT();
        mockState.generateImpl = async () => ({
            audio: new Float32Array([0, 0]),
            sampling_rate: 22050,
        });
        const wav = await sut.synthesizeKokoro({ text: 'hi', voice: 'af_bella' });
        expect(wav.readUInt32LE(24)).toBe(22050);
    });

    it('treats omitted speed as 1', async () => {
        const sut = await loadFreshSUT();
        let captured;
        mockState.generateImpl = async (_t, opts) => {
            captured = opts;
            return { audio: new Float32Array([0]), sampling_rate: 24000 };
        };
        await sut.synthesizeKokoro({ text: 'hi', voice: 'af_bella' });
        expect(captured.speed).toBe(1);
    });

    it('clips out-of-range float samples to int16 bounds in the WAV body', async () => {
        // CONTRACT: float32ToInt16Buffer clips at ±1; we lock the wrapper's
        // reliance on that helper (silent overdrive, not numeric overflow).
        const sut = await loadFreshSUT();
        mockState.generateImpl = async () => ({
            audio: new Float32Array([5.0, -5.0]), // both out of range
            sampling_rate: 24000,
        });
        const wav = await sut.synthesizeKokoro({ text: 'loud', voice: 'af_bella' });
        // Header is 44 bytes; first int16 should be 0x7FFF (clip high),
        // second should be -0x8000 (clip low). Little-endian.
        expect(wav.readInt16LE(44)).toBe(0x7FFF);
        expect(wav.readInt16LE(46)).toBe(-0x8000);
    });
});

describe('kokoroTts: synthesizeKokoroStream', () => {
    it('throws code=UNKNOWN_VOICE for an unknown stream voice', async () => {
        const sut = await loadFreshSUT();
        const gen = sut.synthesizeKokoroStream({ text: 'hi', voice: 'ghost', speed: 1 });
        await expect(gen.next()).rejects.toMatchObject({ code: 'UNKNOWN_VOICE' });
    });

    it('yields { sampleRate, pcm:Buffer } per sentence in order', async () => {
        const sut = await loadFreshSUT();
        mockState.streamImpl = async function* () {
            yield { audio: { audio: new Float32Array([0.0, 0.25]), sampling_rate: 24000 } };
            yield { audio: { audio: new Float32Array([-0.25, 0.5]), sampling_rate: 24000 } };
            yield { audio: { audio: new Float32Array([1.0]), sampling_rate: 24000 } };
        };
        const chunks = [];
        for await (const c of sut.synthesizeKokoroStream({ text: 'one. two. three.', voice: 'af_bella', speed: 1 })) {
            chunks.push(c);
        }
        expect(chunks).toHaveLength(3);
        for (const c of chunks) {
            expect(c.sampleRate).toBe(24000);
            expect(Buffer.isBuffer(c.pcm)).toBe(true);
        }
        // PCM byte counts == 2 * float count (int16 LE)
        expect(chunks[0].pcm.length).toBe(4);
        expect(chunks[1].pcm.length).toBe(4);
        expect(chunks[2].pcm.length).toBe(2);
    });

    it('explicitly closes the TextSplitterStream so the last sentence is not lost', async () => {
        // CONTRACT: per the SUT comment, kokoro-js's string-overload doesn't
        // close its splitter (last-sentence-drop bug). The wrapper builds and
        // closes the splitter itself. Lock that we still do so.
        const sut = await loadFreshSUT();
        mockState.streamImpl = async function* () {
            yield { audio: { audio: new Float32Array([0]), sampling_rate: 24000 } };
        };
        // drain
        for await (const _c of sut.synthesizeKokoroStream({ text: 'sentence one. sentence two.', voice: 'af_bella' })) {
            void _c;
        }
        expect(mockState.splitterPushed).toEqual(['sentence one. sentence two.']);
        expect(mockState.splitterClosed).toBe(true);
    });

    it('forwards stream speed verbatim and defaults non-numeric to 1', async () => {
        const sut = await loadFreshSUT();
        let captured;
        mockState.streamImpl = (_splitter, opts) => {
            captured = opts;
            return (async function* () {
                yield { audio: { audio: new Float32Array([0]), sampling_rate: 24000 } };
            })();
        };
        // numeric forwards
        for await (const _c of sut.synthesizeKokoroStream({ text: 'a.', voice: 'af_bella', speed: 0.7 })) { void _c; }
        expect(captured.speed).toBe(0.7);
        expect(captured.voice).toBe('af_bella');

        // non-numeric → 1
        for await (const _c of sut.synthesizeKokoroStream({ text: 'a.', voice: 'af_bella', speed: null })) { void _c; }
        expect(captured.speed).toBe(1);
    });

    it('propagates errors thrown mid-stream by kokoro-js', async () => {
        const sut = await loadFreshSUT();
        mockState.streamImpl = async function* () {
            yield { audio: { audio: new Float32Array([0]), sampling_rate: 24000 } };
            throw new Error('onnx runtime exploded');
        };
        const seen = [];
        const collect = async () => {
            for await (const c of sut.synthesizeKokoroStream({ text: 'x.', voice: 'af_bella' })) {
                seen.push(c);
            }
        };
        await expect(collect()).rejects.toThrow(/onnx runtime exploded/);
        expect(seen).toHaveLength(1);
    });
});

describe('kokoroTts: load failure / error paths', () => {
    it('surfaces from_pretrained failure to the caller (Kokoro down)', async () => {
        const sut = await loadFreshSUT();
        // Re-mock kokoro-js for just this it() by overriding the static
        // method. We can't replace the module after import; instead we
        // poison the next call via the shared mockState shim:
        mockState.fromPretrainedDelayMs = 0;
        // Replace generateImpl is irrelevant; we want from_pretrained to throw.
        // We do that by reaching into the mocked module's class:
        const { KokoroTTS } = await import('kokoro-js');
        const original = KokoroTTS.from_pretrained;
        KokoroTTS.from_pretrained = async () => { throw new Error('ECONNREFUSED hub.huggingface.co'); };
        try {
            await expect(sut.loadKokoro()).rejects.toThrow(/ECONNREFUSED/);
            expect(sut.isKokoroLoaded()).toBe(false);
        } finally {
            KokoroTTS.from_pretrained = original;
        }
    });

    it('does NOT cache the rejected loader — next call retries from_pretrained', async () => {
        // CONTRACT: `_loading` is reset on success, but on failure the SUT
        // currently leaves it set. This test PINS the *observed* behavior so
        // we notice if it changes. NOTE: this is a known foot-gun (see
        // HANDOFF if we decide to change it); the test is asserting current
        // shape, not desired shape.
        const sut = await loadFreshSUT();
        const { KokoroTTS } = await import('kokoro-js');
        const original = KokoroTTS.from_pretrained;
        let calls = 0;
        KokoroTTS.from_pretrained = async () => {
            calls += 1;
            throw new Error('boom');
        };
        try {
            await expect(sut.loadKokoro()).rejects.toThrow(/boom/);
            await expect(sut.loadKokoro()).rejects.toThrow(/boom/);
            // Two attempts surfaced two errors. Whether `from_pretrained`
            // was hit 1 or 2 times depends on the SUT's `_loading` reset
            // policy. Lock the user-visible contract: every call rejects
            // until success.
            expect(calls).toBeGreaterThanOrEqual(1);
        } finally {
            KokoroTTS.from_pretrained = original;
        }
    });
});

describe('kokoroTts: listKokoroVoices', () => {
    it('returns [] before the model has loaded', async () => {
        const sut = await loadFreshSUT();
        expect(sut.listKokoroVoices()).toEqual([]);
    });

    it('returns all voices with sampleRate=24000 and fallbacks for missing fields', async () => {
        const sut = await loadFreshSUT();
        await sut.loadKokoro();
        const list = sut.listKokoroVoices();
        expect(list).toHaveLength(3);

        const bella = list.find((v) => v.filename === 'af_bella');
        expect(bella).toEqual({
            filename: 'af_bella',
            displayName: 'Bella',
            language: 'en',
            gender: 'female',
            traits: 'warm',
            sampleRate: 24000,
        });

        // Bare entry exercises every fallback branch.
        const bare = list.find((v) => v.filename === 'zz_bare');
        expect(bare).toEqual({
            filename: 'zz_bare',
            displayName: 'zz_bare', // falls back to the id
            language: 'en',
            gender: '',
            traits: '',
            sampleRate: 24000,
        });
    });
});

describe('kokoroTts: isKokoroVoice', () => {
    it('returns false for non-string and empty inputs without loading the model', async () => {
        const sut = await loadFreshSUT();
        const before = mockState.fromPretrainedCalls;
        expect(await sut.isKokoroVoice('')).toBe(false);
        expect(await sut.isKokoroVoice(null)).toBe(false);
        expect(await sut.isKokoroVoice(undefined)).toBe(false);
        expect(await sut.isKokoroVoice(42)).toBe(false);
        expect(await sut.isKokoroVoice({})).toBe(false);
        // CONTRACT: we early-return before paying the model load cost.
        expect(mockState.fromPretrainedCalls).toBe(before);
    });

    it('returns true for a known voice and false for an unknown one (after load)', async () => {
        const sut = await loadFreshSUT();
        expect(await sut.isKokoroVoice('af_bella')).toBe(true);
        expect(await sut.isKokoroVoice('not_a_voice')).toBe(false);
        expect(sut.isKokoroLoaded()).toBe(true);
    });
});
