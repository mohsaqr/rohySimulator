// Phase 1 — voiceService regression + contract tests.
//
// Three blocks combined into one file because all three exercise
// src/services/voiceService.js:
//
//   1.3 — Pitch coupling regression. Pitch must NOT modulate
//         AudioBufferSourceNode.playbackRate.value. After commit bb34d88
//         pitch is forwarded to the server (Google semitones) and the
//         client always plays at playbackRate=1.0. Locks that down.
//
//   1.4 — TTS request body shape contract. Asserts the JSON body sent to
//         /api/tts?stream=1 only contains the fields voiceService.js
//         actually emits, and that pitch is omitted (not sent as 0) when
//         the caller doesn't pass it.
//
//   1.5 — auditionWirePayload re-fires /api/tts (non-streaming) and
//         registers the resulting BufferSource via attachSource so the
//         shared cancelSpeech() teardown stops it.
//
// All msw is configured in-file via setupServer (we deliberately do NOT
// modify tests/utils/mockTtsServer.js). The Phase-0 AudioContext stub in
// tests/setup.js is enriched LOCALLY here via vi.spyOn so we can capture
// every BufferSource instance and inspect its playbackRate.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// wawa-lipsync uses the global AudioContext on construction. The Phase-0
// setup stub is functional but each test wants its own per-test capturing
// stub. We mock the module so Lipsync is a controllable plain class.
vi.mock('wawa-lipsync', () => {
    class Lipsync {
        constructor() {
            this.audioContext = new globalThis.AudioContext();
            this.analyser = {
                connect: () => {},
                disconnect: () => {},
            };
            this.viseme = 'viseme_sil';
        }
        processAudio() { /* no-op for tests */ }
    }
    return { Lipsync };
});

// AuthService.getToken() is called inside ttsFetch to set the Authorization
// header. Stub it so we don't pull in the real auth module / localStorage.
vi.mock('./authService.js', () => ({
    AuthService: { getToken: () => 'test-token' },
}));

// ---------------------------------------------------------------------------
// Local AudioContext enrichment.
//
// The shared stub in tests/setup.js returns a fresh BufferSource each call
// to createBufferSource(), but it does NOT remember instances and its
// playbackRate is a plain { value: 1 } object whose writes we can't observe
// across the module boundary. We replace AudioContext on `window` for the
// duration of this test file with a richer stub that:
//
//   - records every BufferSource it creates (so we can assert on
//     playbackRate.value writes);
//   - tracks createdSources for every instance;
//   - returns a real ArrayBuffer-shaped audio buffer from decodeAudioData
//     so scheduleChunk has a `.duration` to read.
//
// We restore the original at afterAll so other client tests that run later
// in the same vitest worker still see the Phase-0 stub.
// ---------------------------------------------------------------------------

const createdSources = [];

function makeStubBufferSource() {
    // Use a getter/setter on playbackRate.value so we observe every write,
    // not just the final state. This lets us prove the assertion even if
    // some future code path *also* sets it back to 1.0 after a stray write.
    let _rate = 1;
    const writes = [];
    const playbackRate = {};
    Object.defineProperty(playbackRate, 'value', {
        get() { return _rate; },
        set(v) { _rate = v; writes.push(v); },
    });
    const source = {
        buffer: null,
        playbackRate,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: () => {},
        removeEventListener: () => {},
        onended: null,
        // Test-only field so assertions can read every observed write.
        __rateWrites: writes,
    };
    createdSources.push(source);
    return source;
}

class CapturingAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
        this.sampleRate = 48000;
    }
    createBuffer(_channels, length, _sampleRate) {
        return {
            duration: length / 24000,
            getChannelData: () => new Float32Array(length || 0),
        };
    }
    createBufferSource() {
        return makeStubBufferSource();
    }
    createGain() {
        return {
            gain: { value: 1, setValueAtTime: () => {} },
            connect: () => {},
            disconnect: () => {},
        };
    }
    decodeAudioData(_buf) {
        // Return a non-zero-duration buffer so scheduleChunk advances the
        // session.nextStartTime cursor.
        return Promise.resolve({
            duration: 0.05,
            getChannelData: () => new Float32Array(2400),
        });
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
}

const _originalAudioContext = globalThis.window?.AudioContext;
beforeAll(() => {
    if (typeof window !== 'undefined') {
        window.AudioContext = CapturingAudioContext;
        window.webkitAudioContext = CapturingAudioContext;
    }
});
afterAll(() => {
    if (typeof window !== 'undefined' && _originalAudioContext) {
        window.AudioContext = _originalAudioContext;
        window.webkitAudioContext = _originalAudioContext;
    }
});

// ---------------------------------------------------------------------------
// msw handlers — local to this file.
//
// We intentionally don't reuse tests/utils/mockTtsServer.js because:
//   (a) we want a strictly-framed application/x-rohy-pcm-stream so the
//       voiceService streaming path runs end-to-end (the shared mock
//       responds with octet-stream which would force the fallback);
//   (b) we want to record requests with both URL + parsed body in one
//       structure for precise assertions in 1.4.
// ---------------------------------------------------------------------------

const sentRequests = [];

// Build a valid rohy-pcm-stream:
//   [4 LE: sampleRate][4 LE: frameLen][frameLen bytes PCM][4 LE: 0 (EOF)]
function buildPcmStreamBody({ sampleRate = 24000, samples = 480 } = {}) {
    const pcm = new Uint8Array(samples * 2); // silent
    const total = 4 + 4 + pcm.byteLength + 4;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let off = 0;
    view.setUint32(off, sampleRate, true); off += 4;
    view.setUint32(off, pcm.byteLength, true); off += 4;
    out.set(pcm, off); off += pcm.byteLength;
    view.setUint32(off, 0, true); // EOF
    return out;
}

function buildSilenceWav({ sampleRate = 24000, samples = 240 } = {}) {
    const dataSize = samples * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (off, s) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    return new Uint8Array(buf);
}

const server = setupServer(
    http.post('*/api/tts', async ({ request }) => {
        let parsedBody = null;
        try {
            parsedBody = await request.clone().json();
        } catch {
            parsedBody = null;
        }
        const url = new URL(request.url);
        const isStream = url.searchParams.get('stream') === '1';
        sentRequests.push({
            url: request.url,
            path: url.pathname,
            isStream,
            body: parsedBody,
            headers: Object.fromEntries(request.headers.entries()),
        });
        if (isStream) {
            const payload = buildPcmStreamBody();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(payload);
                    controller.close();
                },
            });
            return new HttpResponse(stream, {
                headers: { 'Content-Type': 'application/x-rohy-pcm-stream' },
            });
        }
        return new HttpResponse(buildSilenceWav(), {
            headers: { 'Content-Type': 'audio/wav' },
        });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    sentRequests.length = 0;
    createdSources.length = 0;
});
afterAll(() => server.close());

// Pull voiceService AFTER the mocks above are registered so the module
// gets the mocked Lipsync + AuthService at import time.
let VoiceService;
let auditionWirePayload;
let getRecentTtsRequests;

beforeAll(async () => {
    const mod = await import('./voiceService.js');
    VoiceService = mod.VoiceService;
    auditionWirePayload = mod.auditionWirePayload;
    getRecentTtsRequests = mod.getRecentTtsRequests;
});

beforeEach(() => {
    // Defensive: if a previous test left a session active, kill it.
    VoiceService?.cancelSpeech?.();
});

// Wait until at least N source nodes have been created, then resolve.
// Returns when condition is met or when the timeout window elapses, so a
// failing test still produces a useful expect() diff rather than hanging.
async function waitForSources(minCount, timeoutMs = 1000) {
    const start = Date.now();
    while (createdSources.length < minCount && Date.now() - start < timeoutMs) {
        // Yield to the event loop so streaming reads + promise chains run.
        await new Promise(r => setTimeout(r, 5));
    }
}

// ---------------------------------------------------------------------------
// Block 1.3 — Pitch coupling regression
// ---------------------------------------------------------------------------

describe('voiceService — pitch never modulates client playbackRate (1.3)', () => {
    it('pitch=0: every BufferSource keeps playbackRate.value === 1.0', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en-test',
            provider: 'google',
            pitch: 0,
        });
        session.enqueue('hello world');
        await session.flush();
        await waitForSources(1);

        expect(createdSources.length).toBeGreaterThan(0);
        for (const src of createdSources) {
            expect(src.playbackRate.value).toBe(1.0);
            // Either never written, or written only with the value 1.0.
            for (const w of src.__rateWrites) expect(w).toBe(1.0);
        }
    });

    it('pitch=5 (semitones up): playbackRate stays at 1.0 — proves no client-side pitch coupling', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en-test',
            provider: 'google',
            pitch: 5,
        });
        session.enqueue('a sentence');
        await session.flush();
        await waitForSources(1);

        expect(createdSources.length).toBeGreaterThan(0);
        for (const src of createdSources) {
            expect(src.playbackRate.value).toBe(1.0);
            for (const w of src.__rateWrites) expect(w).toBe(1.0);
        }
    });

    it('pitch=-5 (semitones down): playbackRate stays at 1.0', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en-test',
            provider: 'google',
            pitch: -5,
        });
        session.enqueue('another sentence');
        await session.flush();
        await waitForSources(1);

        expect(createdSources.length).toBeGreaterThan(0);
        for (const src of createdSources) {
            expect(src.playbackRate.value).toBe(1.0);
            for (const w of src.__rateWrites) expect(w).toBe(1.0);
        }
    });
});

// ---------------------------------------------------------------------------
// Block 1.4 — TTS request body shape contract
// ---------------------------------------------------------------------------

describe('voiceService — TTS request body shape (1.4)', () => {
    it('hits /api/tts?stream=1 first (the streaming path is the runtime default)', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en-test',
            provider: 'google',
            rate: 1.1,
            pitch: 2,
            gender: 'male',
        });
        session.enqueue('hi');
        await session.flush();
        await waitForSources(1);

        expect(sentRequests.length).toBeGreaterThan(0);
        const first = sentRequests[0];
        expect(first.path).toBe('/api/tts');
        expect(first.isStream).toBe(true);
    });

    it('forwards every passed field with the exact value the caller supplied', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en-female-1',
            provider: 'google',
            rate: 1.1,
            pitch: 2,
            gender: 'female',
        });
        session.enqueue('hello there');
        await session.flush();
        await waitForSources(1);

        const body = sentRequests[0].body;
        expect(body).toMatchObject({
            text: 'hello there',
            voice: 'en-female-1',
            provider: 'google',
            rate: 1.1,
            pitch: 2,
            gender: 'female',
        });
        // CONTRACT: voiceService.js does NOT add `streaming: true` to the
        // body — streaming is signalled by the `?stream=1` query param plus
        // the Accept header. Asserting absence is what the production code
        // promises today, not presence.
        expect(body).not.toHaveProperty('streaming');
    });

    it('omits pitch from the body entirely when caller did not pass it (clamp-zero contract)', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en-test',
            provider: 'google',
            // pitch deliberately omitted; rate / gender also omitted
        });
        session.enqueue('no pitch here');
        await session.flush();
        await waitForSources(1);

        const body = sentRequests[0].body;
        expect(body.text).toBe('no pitch here');
        expect(body.voice).toBe('en-test');
        expect(body.provider).toBe('google');
        // The whole point of 1.4: pitch must be ABSENT, not pitch:0. Server
        // route clamps; the client must not lie about user intent.
        expect(body).not.toHaveProperty('pitch');
        expect(body).not.toHaveProperty('rate');
        expect(body).not.toHaveProperty('gender');
    });

    it('piper uses the non-streaming WAV endpoint directly (no throwaway stream probe)', async () => {
        const session = VoiceService.beginSpeechSession({
            voice: 'en_US-amy-medium.onnx',
            provider: 'piper',
        });
        session.enqueue('piper sentence');
        await session.flush();
        await waitForSources(1);

        expect(sentRequests.length).toBe(1);
        expect(sentRequests[0].path).toBe('/api/tts');
        expect(sentRequests[0].isStream).toBe(false);
        expect(sentRequests[0].body).toMatchObject({
            text: 'piper sentence',
            voice: 'en_US-amy-medium.onnx',
            provider: 'piper',
        });
    });
});

// ---------------------------------------------------------------------------
// Block 1.5 — auditionWirePayload routes through ttsFetch + attachSource
// ---------------------------------------------------------------------------

describe('voiceService — auditionWirePayload routes through ttsFetch + attachSource (1.5)', () => {
    it('audition POSTs the non-streaming /api/tts path with the wire payload values', async () => {
        const wire = {
            id: 42,
            sentAt: Date.now(),
            voice: 'en-test',
            provider: 'google',
            rate: 1.0,
            pitch: 3,
            gender: 'male',
            text: 'replay this please',
            textPreview: 'replay this please',
            status: 'ok',
        };

        const handle = await auditionWirePayload(wire);
        expect(handle).toBeTruthy();
        expect(typeof handle.stop).toBe('function');

        // Audition should hit the *non-streaming* endpoint (no ?stream=1).
        const auditionReq = sentRequests.find(r => r.isStream === false);
        expect(auditionReq).toBeTruthy();
        expect(auditionReq.path).toBe('/api/tts');
        expect(auditionReq.body).toMatchObject({
            text: 'replay this please',
            voice: 'en-test',
            provider: 'google',
            rate: 1.0,
            pitch: 3,
            gender: 'male',
        });

        // And the audition should appear in the wire history (proves it
        // went through ttsFetch, not a bypass fetch).
        const recent = getRecentTtsRequests();
        const ours = recent.find(r => r.streaming === false && r.text === 'replay this please');
        expect(ours).toBeTruthy();
        expect(['ok', 'pending']).toContain(ours.status);
    });

    it('audition source is registered with attachSource so cancelSpeech() stops it', async () => {
        const wire = {
            id: 7,
            sentAt: Date.now(),
            voice: 'en-test',
            provider: 'google',
            text: 'cancel me',
            textPreview: 'cancel me',
            status: 'ok',
        };

        await auditionWirePayload(wire);
        // The audition path: createBufferSource() is called once for the
        // decoded WAV. The same call path also runs internally for any
        // ensureLipsync warmup, but only the BufferSource we constructed
        // is the playback source. We grab the most recent.
        expect(createdSources.length).toBeGreaterThan(0);
        const auditionSource = createdSources[createdSources.length - 1];
        expect(auditionSource.start).toHaveBeenCalled();

        VoiceService.cancelSpeech();

        // CONTRACT: cancelSpeech() calls teardown(), which iterates
        // _activeSources and invokes .stop() on each. Because audition
        // pushes its source via attachSource, this transitively proves
        // the audition source was registered.
        expect(auditionSource.stop).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Block 2.0 — Voice 2.0 v1.4 wire truth
// ---------------------------------------------------------------------------
// Sovereignty semantics: the wire IS the truth — the server plays the
// literal requested voice or errors, never a stand-in. What the ring
// buffer must carry is the `language` field each request keyed on (shown
// in the DiagnosticBar's lang column and re-sent by the ▶ replay so an
// audition reproduces the same request).

describe('voiceService — wire entries are literal and carry the language (2.0)', () => {
    it('the session language reaches the /api/tts body AND the wire history', async () => {
        const session = VoiceService.beginSpeechSession({ voice: 'alloy', language: 'de' });
        session.enqueue('ein satz');
        await session.flush();

        const sent = sentRequests.find(r => r.body?.voice === 'alloy');
        expect(sent).toBeTruthy();
        expect(sent.body.language).toBe('de');
        const entry = getRecentTtsRequests().find(w => w.voice === 'alloy');
        expect(entry.language).toBe('de');
    });

    it('an ok wire entry is literal — no substitution metadata exists', async () => {
        const session = VoiceService.beginSpeechSession({ voice: 'af_bella', language: 'en' });
        session.enqueue('plain sentence');
        await session.flush();

        const entry = getRecentTtsRequests().find(w => w.voice === 'af_bella');
        expect(entry).toBeTruthy();
        expect(entry.status).toBe('ok');
        expect(entry.substitutedVoice).toBeUndefined();
        expect(entry.requestedVoice).toBeUndefined();
    });
});
