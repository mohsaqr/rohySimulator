// Reusable msw handlers + helpers for intercepting /api/tts requests in
// client tests. Two endpoints are covered:
//
//   POST /api/tts            — non-streaming, returns a deterministic WAV
//                              of one second of silence at 24 kHz mono.
//   POST /api/tts?stream=1   — streaming PCM. Returns a single-frame
//                              ReadableStream containing one PCM chunk
//                              of silence so consumers can run their
//                              chunked-decode logic without real audio.
//
// Tests that need to assert what the client sent should call
// `getRecordedRequests()` and inspect the array. Reset between tests with
// `resetRecordedRequests()`.
//
// Usage:
//
//   import { setupServer } from 'msw/node';
//   import { ttsHandlers, getRecordedRequests, resetRecordedRequests }
//       from '../utils/mockTtsServer.js';
//
//   const server = setupServer(...ttsHandlers());
//   beforeAll(() => server.listen());
//   afterEach(() => { server.resetHandlers(); resetRecordedRequests(); });
//   afterAll(() => server.close());

import { http, HttpResponse } from 'msw';

const recorded = [];

export function getRecordedRequests() {
    return recorded.slice();
}

export function resetRecordedRequests() {
    recorded.length = 0;
}

// 1 second of silence at 24 kHz mono, 16-bit signed PCM, RIFF/WAVE wrapper.
// We build it once at module load.
function buildSilenceWav({ sampleRate = 24000, durationSec = 1 } = {}) {
    const numSamples = Math.floor(sampleRate * durationSec);
    const dataSize = numSamples * 2; // 16-bit mono
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (off, s) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);   // PCM chunk size
    view.setUint16(20, 1, true);    // PCM format
    view.setUint16(22, 1, true);    // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);    // block align
    view.setUint16(34, 16, true);   // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    // body is already zero-filled (silence)
    return new Uint8Array(buf);
}

const SILENCE_WAV = buildSilenceWav();

// One frame of 480 samples (20 ms at 24 kHz) of silence in 16-bit PCM.
function buildSilenceFrame() {
    return new Uint8Array(480 * 2);
}

const SILENCE_FRAME = buildSilenceFrame();

async function recordRequest(request) {
    let body = null;
    try {
        // msw clones the request internally so this doesn't drain the
        // original. If body parsing fails we still record the URL/headers.
        body = await request.clone().json();
    } catch {
        body = null;
    }
    const url = new URL(request.url);
    recorded.push({
        url: request.url,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body,
    });
    return body;
}

/**
 * Returns a list of msw handlers that intercept /api/tts on any host.
 *
 * Pass `{ baseUrl }` to scope to a specific server (eg. when tests run
 * against a real spawned server but you still want to intercept TTS).
 */
export function ttsHandlers({ baseUrl = '*' } = {}) {
    const ttsPath = baseUrl === '*' ? '*/api/tts' : `${baseUrl}/api/tts`;
    return [
        http.post(ttsPath, async ({ request }) => {
            const body = await recordRequest(request);
            const url = new URL(request.url);
            const isStream = url.searchParams.get('stream') === '1';
            if (isStream) {
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(SILENCE_FRAME);
                        controller.close();
                    },
                });
                return new HttpResponse(stream, {
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'X-Sample-Rate': '24000',
                        'X-Test-Echo': body ? 'json' : 'none',
                    },
                });
            }
            return new HttpResponse(SILENCE_WAV, {
                headers: { 'Content-Type': 'audio/wav' },
            });
        }),
    ];
}

export default ttsHandlers;
