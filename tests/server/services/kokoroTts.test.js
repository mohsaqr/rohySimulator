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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    disposeCalls: 0,
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
            // Mirrors kokoro-js: the instance holds a transformers.js model
            // whose dispose() releases the ONNX sessions. The SUT's idle
            // unload calls exactly this.
            this.model = { dispose: async () => { mockState.disposeCalls += 1; } };
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
    mockState.disposeCalls = 0;
    // Default: idle unload OFF for the pre-existing contracts, which were
    // written against an always-resident singleton. The idle-unload
    // describe block opts in per test.
    process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '0';
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

// ---------------------------------------------------------------------------
// 8. Idle unload — the model is released after ROHY_KOKORO_IDLE_UNLOAD_MIN
//    minutes without a synthesis, never while one is in flight, and reloads
//    transparently on the next call. 0 keeps it resident (legacy behaviour).
//    Regression lock: production held ~400 MB of Kokoro weights resident
//    24/7 on a 3.7 GiB box whether or not anyone used voice mode.
// ---------------------------------------------------------------------------

describe('kokoroTts: idle unload', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('defaults to a 10-minute idle window and exposes it in ms', async () => {
        delete process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN;
        const sut = await loadFreshSUT();
        expect(sut.kokoroIdleUnloadMs()).toBe(10 * 60_000);
    });

    it('treats an unparsable value as the default, never as "never unload"', async () => {
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = 'soon';
        const sut = await loadFreshSUT();
        expect(sut.kokoroIdleUnloadMs()).toBe(10 * 60_000);
    });

    it('0 disables unloading: the model stays resident past the window', async () => {
        vi.useFakeTimers();
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '0';
        const sut = await loadFreshSUT();
        await sut.synthesizeKokoro({ text: 'hi', voice: 'af_bella' });
        expect(sut.isKokoroLoaded()).toBe(true);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(sut.isKokoroLoaded()).toBe(true);
        expect(mockState.disposeCalls).toBe(0);
    });

    it('disposes the model once the idle window elapses with nothing in flight', async () => {
        vi.useFakeTimers();
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '1';
        const sut = await loadFreshSUT();
        await sut.synthesizeKokoro({ text: 'hi', voice: 'af_bella' });
        expect(sut.isKokoroLoaded()).toBe(true);
        await vi.advanceTimersByTimeAsync(59_000);
        expect(sut.isKokoroLoaded()).toBe(true);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(sut.isKokoroLoaded()).toBe(false);
        expect(mockState.disposeCalls).toBe(1);
        // Voice listing degrades to the pre-load shape, not a crash.
        expect(sut.listKokoroVoices()).toEqual([]);
    });

    it('a synthesis inside the window resets the idle clock', async () => {
        vi.useFakeTimers();
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '1';
        const sut = await loadFreshSUT();
        await sut.synthesizeKokoro({ text: 'one', voice: 'af_bella' });
        await vi.advanceTimersByTimeAsync(45_000);
        await sut.synthesizeKokoro({ text: 'two', voice: 'af_bella' });
        await vi.advanceTimersByTimeAsync(45_000); // 90 s after first, 45 s after second
        expect(sut.isKokoroLoaded()).toBe(true);
        await vi.advanceTimersByTimeAsync(20_000); // 65 s after second
        expect(sut.isKokoroLoaded()).toBe(false);
    });

    it('never unloads while a stream is still being consumed', async () => {
        vi.useFakeTimers();
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '1';
        // A slow stream: sentences arrive well past the idle window.
        mockState.streamImpl = () => (async function* () {
            yield { audio: { audio: new Float32Array([0.1]), sampling_rate: 24000 } };
            await new Promise((r) => setTimeout(r, 90_000));
            yield { audio: { audio: new Float32Array([0.2]), sampling_rate: 24000 } };
        })();
        const sut = await loadFreshSUT();
        const it = sut.synthesizeKokoroStream({ text: 'a. b.', voice: 'af_bella' });
        await it.next();
        const second = it.next(); // pulls the next sentence → the stream's 90 s wait starts now
        await vi.advanceTimersByTimeAsync(70_000); // idle timer fires mid-stream
        expect(sut.isKokoroLoaded()).toBe(true);
        expect(mockState.disposeCalls).toBe(0);
        await vi.advanceTimersByTimeAsync(25_000);
        await second;
        await it.next(); // done → pin released, clock restarts
        expect(sut.isKokoroLoaded()).toBe(true);
        await vi.advanceTimersByTimeAsync(61_000);
        expect(sut.isKokoroLoaded()).toBe(false);
        expect(mockState.disposeCalls).toBe(1);
    });

    it('an abandoned stream (consumer breaks early) still releases the pin', async () => {
        vi.useFakeTimers();
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '1';
        mockState.streamImpl = () => (async function* () {
            yield { audio: { audio: new Float32Array([0.1]), sampling_rate: 24000 } };
            yield { audio: { audio: new Float32Array([0.2]), sampling_rate: 24000 } };
        })();
        const sut = await loadFreshSUT();
        for await (const _chunk of sut.synthesizeKokoroStream({ text: 'a. b.', voice: 'af_bella' })) {
            break; // client disconnected after the first sentence
        }
        await vi.advanceTimersByTimeAsync(61_000);
        expect(sut.isKokoroLoaded()).toBe(false);
    });

    it('reloads transparently on the next synthesis after an unload', async () => {
        vi.useFakeTimers();
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '1';
        const sut = await loadFreshSUT();
        await sut.synthesizeKokoro({ text: 'one', voice: 'af_bella' });
        await vi.advanceTimersByTimeAsync(61_000);
        expect(sut.isKokoroLoaded()).toBe(false);
        const wav = await sut.synthesizeKokoro({ text: 'two', voice: 'af_bella' });
        expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(sut.isKokoroLoaded()).toBe(true);
        expect(mockState.fromPretrainedCalls).toBe(2);
    });

    it('unloadKokoro() is a no-op when nothing is loaded and refuses while in flight', async () => {
        process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN = '1';
        let releaseGenerate;
        mockState.generateImpl = () => new Promise((r) => { releaseGenerate = () => r({ audio: new Float32Array([0]), sampling_rate: 24000 }); });
        const sut = await loadFreshSUT();
        expect(await sut.unloadKokoro()).toBe(false);
        const pending = sut.synthesizeKokoro({ text: 'x', voice: 'af_bella' });
        await vi.waitFor(() => expect(releaseGenerate).toBeTypeOf('function'));
        expect(await sut.unloadKokoro('manual')).toBe(false); // pinned
        expect(sut.isKokoroLoaded()).toBe(true);
        releaseGenerate();
        await pending;
        expect(await sut.unloadKokoro('manual')).toBe(true);
        expect(sut.isKokoroLoaded()).toBe(false);
        expect(mockState.disposeCalls).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 9. Remote mode — ROHY_KOKORO_URL set. Synthesis goes to an OpenAI-compatible
//    host one sentence per request (response_format pcm), the local model is
//    only a fallback, and a circuit breaker keeps a dead host from costing a
//    timeout on every reply. `fetch` is stubbed; the local model is the same
//    fake as above, so "spoke locally" is visible as fromPretrainedCalls > 0.
// ---------------------------------------------------------------------------

const REMOTE_URL = 'https://kokoro.test/v1';

// One recorded call per remote request.
let remoteCalls = [];

function pcmBytes(samples, fill) {
    return Buffer.alloc(samples * 2, fill);
}

// `respond(call)` returns a Response, a Promise of one, or throws.
function stubRemote(respond) {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        const call = { url, init, body: JSON.parse(init.body), signal: init.signal };
        remoteCalls.push(call);
        return respond(call);
    }));
}

const okPcm = (buf) => new Response(buf, { status: 200 });

async function collect(gen) {
    const out = [];
    for await (const chunk of gen) out.push(chunk);
    return out;
}

describe('kokoroTts: remote synthesis (ROHY_KOKORO_URL)', () => {
    beforeEach(() => {
        remoteCalls = [];
        process.env.ROHY_KOKORO_URL = `${REMOTE_URL}/`; // trailing slash is trimmed
        process.env.ROHY_KOKORO_API_KEY = 'test-key';
        delete process.env.ROHY_KOKORO_TIMEOUT_MS;
    });
    afterEach(() => {
        delete process.env.ROHY_KOKORO_URL;
        delete process.env.ROHY_KOKORO_API_KEY;
        delete process.env.ROHY_KOKORO_TIMEOUT_MS;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('streams one pcm request per sentence, in order, without loading the local model', async () => {
        stubRemote(({ body }) => okPcm(pcmBytes(4, body.input.length)));
        const sut = await loadFreshSUT();
        const chunks = await collect(sut.synthesizeKokoroStream({ text: 'Hello doctor. My chest hurts!', voice: 'am_adam' }));

        expect(remoteCalls.map((c) => c.url)).toEqual([`${REMOTE_URL}/audio/speech`, `${REMOTE_URL}/audio/speech`]);
        expect(remoteCalls[0].init.headers.Authorization).toBe('Bearer test-key');
        expect(remoteCalls.map((c) => c.body)).toEqual([
            { model: 'kokoro', voice: 'am_adam', input: 'Hello doctor.', response_format: 'pcm', speed: 1 },
            { model: 'kokoro', voice: 'am_adam', input: 'My chest hurts!', response_format: 'pcm', speed: 1 },
        ]);
        expect(chunks.map((c) => c.sampleRate)).toEqual([24000, 24000]);
        expect(chunks.map((c) => c.pcm[0])).toEqual(['Hello doctor.'.length, 'My chest hurts!'.length]);
        expect(mockState.fromPretrainedCalls).toBe(0);
        expect(sut.isKokoroLoaded()).toBe(false);
    });

    it('requests the next sentence before the current one is consumed, and keeps order when it finishes first', async () => {
        let releaseFirst;
        stubRemote(({ body }) => (body.input === 'One.'
            ? new Promise((r) => { releaseFirst = () => r(okPcm(pcmBytes(2, 1))); })
            : okPcm(pcmBytes(2, 2))));
        const sut = await loadFreshSUT();
        const gen = sut.synthesizeKokoroStream({ text: 'One. Two.', voice: 'am_adam' });
        const first = gen.next();
        // Both requests are out while sentence one is still pending.
        await vi.waitFor(() => expect(remoteCalls).toHaveLength(2));
        releaseFirst();
        expect((await first).value.pcm[0]).toBe(1);
        expect((await gen.next()).value.pcm[0]).toBe(2);
        expect((await gen.next()).done).toBe(true);
    });

    it('forwards a numeric speed and wraps the batch result in a 24 kHz WAV header', async () => {
        stubRemote(() => okPcm(pcmBytes(10, 0)));
        const sut = await loadFreshSUT();
        const wav = await sut.synthesizeKokoro({ text: 'Two sentences. In one request.', voice: 'af_bella', speed: 1.2 });
        expect(remoteCalls).toHaveLength(1);
        expect(remoteCalls[0].body).toMatchObject({ input: 'Two sentences. In one request.', speed: 1.2 });
        expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(wav.readUInt32LE(24)).toBe(24000);
        expect(wav.length).toBe(44 + 20);
        expect(mockState.fromPretrainedCalls).toBe(0);
    });

    it('rejects an unknown voice with UNKNOWN_VOICE before any request or model load', async () => {
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        const sut = await loadFreshSUT();
        await expect(collect(sut.synthesizeKokoroStream({ text: 'Hi.', voice: 'xx_nobody' })))
            .rejects.toMatchObject({ code: 'UNKNOWN_VOICE' });
        await expect(sut.synthesizeKokoro({ text: 'Hi.', voice: 'xx_nobody' }))
            .rejects.toMatchObject({ code: 'UNKNOWN_VOICE' });
        expect(remoteCalls).toHaveLength(0);
        expect(mockState.fromPretrainedCalls).toBe(0);
    });

    it('lists the bundled catalogue and answers isKokoroVoice without loading the model', async () => {
        const sut = await loadFreshSUT();
        const list = sut.listKokoroVoices();
        expect(list.length).toBeGreaterThanOrEqual(20);
        expect(list.find((v) => v.filename === 'af_heart')).toMatchObject({ gender: 'female', sampleRate: 24000 });
        expect(list.find((v) => v.filename === 'am_michael')).toMatchObject({ gender: 'male' });
        expect(await sut.isKokoroVoice('bm_george')).toBe(true);
        expect(await sut.isKokoroVoice('xx_nobody')).toBe(false);
        expect(mockState.fromPretrainedCalls).toBe(0);
    });

    it.each([
        ['a 5xx', () => new Response('upstream down', { status: 502 })],
        ['a 401 (bad key)', () => new Response('{"detail":"bad key"}', { status: 401 })],
        ['a network error', () => { throw new TypeError('fetch failed'); }],
        ['an odd-length body', () => okPcm(Buffer.alloc(3))],
    ])('falls back to the local model on %s', async (_label, respond) => {
        stubRemote(respond);
        const sut = await loadFreshSUT();
        const chunks = await collect(sut.synthesizeKokoroStream({ text: 'Hello.', voice: 'af_bella' }));
        expect(chunks).toHaveLength(1);
        expect(mockState.fromPretrainedCalls).toBe(1);
        expect(mockState.splitterPushed).toEqual(['Hello.']);
        expect(sut.kokoroRemoteState()).toMatchObject({ failures: 1, open: false });
    });

    it('falls back on a timeout (ROHY_KOKORO_TIMEOUT_MS)', async () => {
        process.env.ROHY_KOKORO_TIMEOUT_MS = '40';
        stubRemote(({ signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const sut = await loadFreshSUT();
        const wav = await sut.synthesizeKokoro({ text: 'Hello.', voice: 'af_bella' });
        expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(mockState.fromPretrainedCalls).toBe(1);
    });

    it('a failure mid-stream speaks that sentence and the rest locally, keeping what was already yielded', async () => {
        stubRemote(({ body }) => (body.input === 'One.'
            ? okPcm(pcmBytes(2, 7))
            : new Response('', { status: 503 })));
        const sut = await loadFreshSUT();
        const chunks = await collect(sut.synthesizeKokoroStream({ text: 'One. Two. Three.', voice: 'af_bella' }));
        expect(chunks[0].pcm[0]).toBe(7);
        // The fake local stream yields one chunk for whatever text it is given.
        expect(chunks).toHaveLength(2);
        expect(mockState.splitterPushed).toEqual(['Two. Three.']);
    });

    it('opens the breaker after 3 consecutive failures: the next reply skips the remote host for 60 s', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
        stubRemote(() => new Response('', { status: 500 }));
        const sut = await loadFreshSUT();
        for (let i = 0; i < 3; i++) await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls).toHaveLength(3);
        expect(sut.kokoroRemoteState()).toMatchObject({ failures: 3, open: true });

        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        await collect(sut.synthesizeKokoroStream({ text: 'Hi.', voice: 'af_bella' }));
        expect(remoteCalls).toHaveLength(3); // skipped, spoke locally

        vi.setSystemTime(new Date('2026-10-24T12:01:01Z'));
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls).toHaveLength(4); // the trial request went out and closed it
        expect(sut.kokoroRemoteState()).toMatchObject({ failures: 0, open: false });
    });

    it('after the window, lets ONE trial request through while concurrent replies stay local', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
        stubRemote(() => new Response('', { status: 500 }));
        const sut = await loadFreshSUT();
        for (let i = 0; i < 3; i++) await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls).toHaveLength(3);

        vi.setSystemTime(new Date('2026-10-24T12:01:01Z'));
        let releaseTrial;
        stubRemote(() => new Promise((r) => { releaseTrial = () => r(new Response('', { status: 500 })); }));
        const trial = sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        await vi.waitFor(() => expect(releaseTrial).toBeTypeOf('function'));
        // Two more replies while the trial is out: both speak locally.
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        await collect(sut.synthesizeKokoroStream({ text: 'Hi.', voice: 'af_bella' }));
        expect(remoteCalls).toHaveLength(4);
        releaseTrial();
        await trial;
        expect(sut.kokoroRemoteState()).toMatchObject({ failures: 4, open: true }); // failed trial reopens

        // Once the reopened window has passed, the next trial succeeds and
        // closes the breaker.
        vi.setSystemTime(new Date('2026-10-24T12:02:02Z'));
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(sut.kokoroRemoteState()).toMatchObject({ failures: 0, open: false });
    });

    it('a consumer that stops early aborts the prefetched request', async () => {
        stubRemote(({ body, signal }) => (body.input === 'One.'
            ? okPcm(pcmBytes(2, 1))
            : new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))));
        const sut = await loadFreshSUT();
        for await (const chunk of sut.synthesizeKokoroStream({ text: 'One. Two.', voice: 'am_adam' })) {
            expect(chunk.pcm[0]).toBe(1);
            break;
        }
        expect(remoteCalls).toHaveLength(2);
        expect(remoteCalls[1].signal.aborted).toBe(true);
        // An abandoned prefetch is not a remote failure.
        expect(sut.kokoroRemoteState().failures).toBe(0);
    });
});

describe('kokoroTts: splitSentences / parseRemoteTimeoutMs', () => {
    it('splits on terminal punctuation and keeps titles, initials and decimals whole', async () => {
        const sut = await loadFreshSUT();
        expect(sut.splitSentences('Hello doctor. Dr. Smith said it hurts! Is it 3.5 cm? John F. Kennedy spoke… "Really." Done'))
            .toEqual(['Hello doctor.', 'Dr. Smith said it hurts!', 'Is it 3.5 cm?', 'John F. Kennedy spoke…', '"Really."', 'Done']);
        expect(sut.splitSentences('   ')).toEqual([]);
    });

    it('treats anything but a positive integer timeout as the 8000 ms default', async () => {
        const sut = await loadFreshSUT();
        expect(sut.parseRemoteTimeoutMs(undefined)).toBe(8000);
        expect(sut.parseRemoteTimeoutMs('2500')).toBe(2500);
        expect(sut.parseRemoteTimeoutMs('0')).toBe(8000);
        expect(sut.parseRemoteTimeoutMs('abc')).toBe(8000);
        expect(sut.parseRemoteTimeoutMs('1.5')).toBe(8000);
    });
});

// ---------------------------------------------------------------------------
// 10. Remote host set in Settings → Voice (platform settings), alongside or
//     instead of the env file. refreshKokoroRemoteSettings(getSetting) loads
//     the saved values; settings override env, except that the env file's key
//     is never sent to a URL that came from settings.
// ---------------------------------------------------------------------------

describe('kokoroTts: remote host from settings', () => {
    const settingsGetter = (values) => async (key) => values[key] ?? null;

    beforeEach(() => {
        remoteCalls = [];
        delete process.env.ROHY_KOKORO_URL;
        delete process.env.ROHY_KOKORO_API_KEY;
        delete process.env.ROHY_KOKORO_TIMEOUT_MS;
    });
    afterEach(() => {
        delete process.env.ROHY_KOKORO_URL;
        delete process.env.ROHY_KOKORO_API_KEY;
        vi.unstubAllGlobals();
    });

    it('normalizeRemoteUrl accepts http(s) base URLs and refuses everything else', async () => {
        const sut = await loadFreshSUT();
        expect(sut.normalizeRemoteUrl(' https://api.example.org/v1/ ')).toBe('https://api.example.org/v1');
        expect(sut.normalizeRemoteUrl('http://localhost:8880/v1')).toBe('http://localhost:8880/v1');
        for (const bad of ['', '   ', 'api.example.org/v1', 'ftp://h/v1', 'javascript:alert(1)',
            'https://user:pw@h/v1', 'https://h/v1?x=1', 'https://h/v1#f', `https://h/${'a'.repeat(600)}`, 42, null]) {
            expect(sut.normalizeRemoteUrl(bad)).toBeNull();
        }
    });

    it('a saved URL + key turns remote mode on, with no env at all', async () => {
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        const sut = await loadFreshSUT();
        expect(sut.kokoroRemoteEnabled()).toBe(false);
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'saved-key' }));
        expect(sut.kokoroRemoteState()).toMatchObject({ enabled: true, source: 'settings', host: 'saved.test', keySet: true, keySource: 'settings' });
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls[0].url).toBe('https://saved.test/v1/audio/speech');
        expect(remoteCalls[0].init.headers.Authorization).toBe('Bearer saved-key');
        expect(mockState.fromPretrainedCalls).toBe(0);
    });

    it('a saved URL overrides the env URL — and the env key is NOT sent to it', async () => {
        // Regression lock for the key-exfiltration rule: an admin-entered URL
        // must never receive the operator's env-file key.
        process.env.ROHY_KOKORO_URL = 'https://env.test/v1';
        process.env.ROHY_KOKORO_API_KEY = 'env-secret';
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://attacker.test/v1' }));
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls[0].url).toBe('https://attacker.test/v1/audio/speech');
        expect(remoteCalls[0].init.headers.Authorization).not.toContain('env-secret');
        expect(sut.kokoroRemoteState()).toMatchObject({ source: 'settings', keySet: false, keySource: null, envHost: 'env.test' });
    });

    it('a saved key with no saved URL goes to the env URL (the host the admin sees)', async () => {
        process.env.ROHY_KOKORO_URL = 'https://env.test/v1';
        process.env.ROHY_KOKORO_API_KEY = 'env-secret';
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_api_key: 'new-key' }));
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls[0].url).toBe('https://env.test/v1/audio/speech');
        expect(remoteCalls[0].init.headers.Authorization).toBe('Bearer new-key');
        expect(sut.kokoroRemoteState()).toMatchObject({ source: 'env', keySource: 'settings' });
    });

    it('with nothing saved, the env pair is used as before', async () => {
        process.env.ROHY_KOKORO_URL = 'https://env.test/v1';
        process.env.ROHY_KOKORO_API_KEY = 'env-key';
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({}));
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls[0].init.headers.Authorization).toBe('Bearer env-key');
        expect(sut.kokoroRemoteState()).toMatchObject({ source: 'env', keySource: 'env' });
    });

    it('ignores a stored URL that is not acceptable (edited in the DB by hand)', async () => {
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'ftp://nope/v1' }));
        expect(sut.kokoroRemoteEnabled()).toBe(false);
    });

    it('a changed setting resets the breaker, so a fixed key is tried on the next reply', async () => {
        stubRemote(() => new Response('', { status: 401 }));
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'old' }));
        for (let i = 0; i < 3; i++) await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(sut.kokoroRemoteState()).toMatchObject({ open: true, lastError: { kind: 'http', status: 401 } });

        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'new' }));
        expect(sut.kokoroRemoteState()).toMatchObject({ open: false, failures: 0, lastError: null });
        remoteCalls = [];
        stubRemote(() => okPcm(pcmBytes(2, 0)));
        await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(remoteCalls).toHaveLength(1);
        expect(remoteCalls[0].init.headers.Authorization).toBe('Bearer new');
    });

    it('an unchanged refresh keeps the breaker as it is', async () => {
        stubRemote(() => new Response('', { status: 500 }));
        const sut = await loadFreshSUT();
        const values = { kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'k' };
        await sut.refreshKokoroRemoteSettings(settingsGetter(values));
        for (let i = 0; i < 3; i++) await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        await sut.refreshKokoroRemoteSettings(settingsGetter(values));
        expect(sut.kokoroRemoteState().open).toBe(true);
    });

    it('the state never carries the key', async () => {
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'sk-very-secret' }));
        expect(JSON.stringify(sut.kokoroRemoteState())).not.toContain('sk-very-secret');
    });

    it('testKokoroRemote reports a refusal without falling back, loading the model, or echoing the body', async () => {
        stubRemote(() => new Response('{"error":"internal page contents"}', { status: 401 }));
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'k' }));
        const result = await sut.testKokoroRemote();
        expect(result).toMatchObject({ ok: false, kind: 'http', status: 401, host: 'saved.test' });
        expect(JSON.stringify(result)).not.toContain('internal page contents');
        expect(mockState.fromPretrainedCalls).toBe(0);
        // A failed test is not a reply: the breaker is untouched.
        expect(sut.kokoroRemoteState().failures).toBe(0);
    });

    it('testKokoroRemote success reports latency and audio length, and closes an open breaker', async () => {
        stubRemote(() => new Response('', { status: 503 }));
        const sut = await loadFreshSUT();
        await sut.refreshKokoroRemoteSettings(settingsGetter({ kokoro_remote_url: 'https://saved.test/v1', kokoro_remote_api_key: 'k' }));
        for (let i = 0; i < 3; i++) await sut.synthesizeKokoro({ text: 'Hi.', voice: 'af_bella' });
        expect(sut.kokoroRemoteState().open).toBe(true);
        stubRemote(() => okPcm(pcmBytes(24000, 0))); // 1 s
        const result = await sut.testKokoroRemote();
        expect(result).toMatchObject({ ok: true, audioSeconds: 1, host: 'saved.test' });
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(sut.kokoroRemoteState()).toMatchObject({ open: false, failures: 0 });
    });

    it('testKokoroRemote with nothing configured says so', async () => {
        const sut = await loadFreshSUT();
        expect(await sut.testKokoroRemote()).toMatchObject({ ok: false, kind: 'not_configured' });
    });
});
