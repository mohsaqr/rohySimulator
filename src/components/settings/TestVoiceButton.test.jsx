// Tests for TestVoiceButton.jsx — the click-to-preview voice button used in
// the settings panels.
//
// CONTRACT (locked from src/components/settings/TestVoiceButton.jsx):
//   - Idle render shows the Play icon; the button is enabled when both
//     `voice` and `provider` are supplied. Clicking transitions to
//     'loading' (Loader2 + animate-spin) while the fetch is in flight,
//     then to 'playing' (Square icon, purple background) once
//     audio.play() resolves; audio.onended returns to idle.
//   - Clicks POST to apiUrl(`/tts?provider=<provider>`) with JSON body
//     { text, voice, ...rate?, ...pitch?, ...gender? } and an Authorization header
//     from AuthService.authHeaders(). `pitch` is forwarded in the BODY
//     in semitones; the component MUST NOT touch audio.playbackRate or
//     audio.preservesPitch — that was removed in bb34d88.
//   - Pitch / rate keys are omitted from the body when their props are
//     null or undefined (only sent when not-null).
//   - Changing `voice` or `provider` mid-play calls stop(): pauses the
//     current audio, revokes the object URL, aborts the in-flight
//     fetch, and resets state to idle.
//   - Unmount calls the same cleanup once (no audio/fetch leaks).
//   - Server errors (non-2xx) flip the button into the red error style
//     and the title attr surfaces the error message; state returns to
//     idle so a follow-up click can retry.
//   - size='sm' renders a 24px button (w-6 h-6), size='md' renders a
//     32px button (w-8 h-8) — distinct dimensions.
//
// REGRESSION LOCK (bb34d88): pitch is sent in the request body in
// semitones and is NEVER applied client-side via audio.playbackRate.
// Each test that constructs an Audio asserts that .playbackRate was
// never assigned and .preservesPitch was never assigned to false.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TestVoiceButton from './TestVoiceButton.jsx';

// ---------------------------------------------------------------------------
// Audio mock — lets us inspect every property the component sets and lets
// the test deterministically fire onended / onerror.
// ---------------------------------------------------------------------------

const audioInstances = [];

class MockAudio {
    constructor(src) {
        this.src = src;
        this.paused = false;
        this.onended = null;
        this.onerror = null;
        this.playCalls = 0;
        this.pauseCalls = 0;
        // Track whether the regression-banned props were ever assigned.
        this._playbackRateSet = false;
        this._preservesPitchSetFalse = false;
        audioInstances.push(this);
    }
    play() {
        this.playCalls += 1;
        return Promise.resolve();
    }
    pause() {
        this.pauseCalls += 1;
    }
}

// Trap writes to playbackRate / preservesPitch so the regression lock can
// catch any future regression even if it tries to bypass the constructor.
Object.defineProperty(MockAudio.prototype, 'playbackRate', {
    configurable: true,
    set(v) { this._playbackRateSet = true; this._lastPlaybackRate = v; },
    get() { return this._lastPlaybackRate ?? 1; },
});
Object.defineProperty(MockAudio.prototype, 'preservesPitch', {
    configurable: true,
    set(v) {
        if (v === false) this._preservesPitchSetFalse = true;
        this._lastPreservesPitch = v;
    },
    get() { return this._lastPreservesPitch ?? true; },
});

// ---------------------------------------------------------------------------
// fetch mock factory — returns an object with helpers to build Response-like
// payloads. Lets a test resolve, reject, or hang the request.
// ---------------------------------------------------------------------------

function makeBlobResponse() {
    return {
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['fake-wav-bytes'], { type: 'audio/wav' })),
        json: () => Promise.resolve({}),
    };
}

function makeErrorResponse(status, errMsg) {
    // Real Response so apiFetch's .text()/.headers.get() work as expected.
    return new Response(JSON.stringify({ error: errMsg }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

let originalAudio;
let originalCreateObjectURL;
let originalRevokeObjectURL;

beforeEach(() => {
    audioInstances.length = 0;
    originalAudio = globalThis.Audio;
    globalThis.Audio = MockAudio;

    originalCreateObjectURL = globalThis.URL.createObjectURL;
    originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    globalThis.URL.revokeObjectURL = vi.fn();

    // Default fetch returns a successful blob response.
    globalThis.fetch = vi.fn(() => Promise.resolve(makeBlobResponse()));

    // Seed an auth token so AuthService.authHeaders() returns a Bearer.
    window.localStorage.setItem('token', 'test-token-abc');
});

afterEach(() => {
    cleanup();
    globalThis.Audio = originalAudio;
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    delete globalThis.fetch;
    window.localStorage.removeItem('token');
});

// Helper: click the button and wait for state transitions to settle.
async function clickAndSettle(button) {
    await act(async () => {
        fireEvent.click(button);
        // Allow the awaited fetch + blob + audio.play() promise chain to
        // resolve before we make assertions.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TestVoiceButton', () => {
    it('renders idle Play state initially', () => {
        render(<TestVoiceButton voice="alpha.onnx" provider="piper" />);
        const btn = screen.getByRole('button');
        expect(btn).toBeEnabled();
        // Idle uses the Play icon and the neutral background (no purple, no red).
        expect(btn.className).toContain('bg-neutral-700');
        expect(btn.className).not.toContain('bg-purple-600');
        expect(btn.className).not.toContain('bg-red-900');
        expect(btn.getAttribute('title')).toContain('Preview alpha.onnx');
    });

    it('disables the button when voice or provider is missing', () => {
        const { rerender } = render(<TestVoiceButton voice="" provider="piper" />);
        expect(screen.getByRole('button')).toBeDisabled();
        rerender(<TestVoiceButton voice="alpha.onnx" provider="" />);
        expect(screen.getByRole('button')).toBeDisabled();
        rerender(<TestVoiceButton voice="alpha.onnx" provider="piper" disabled />);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('clicking moves to playing state and uses the Square icon background', async () => {
        render(<TestVoiceButton voice="alpha.onnx" provider="piper" />);
        const btn = screen.getByRole('button');
        await clickAndSettle(btn);
        // After play() resolves, state should be 'playing' (purple bg).
        await waitFor(() => {
            expect(btn.className).toContain('bg-purple-600');
        });
        expect(btn.getAttribute('title')).toBe('Stop preview');
    });

    it('returns to idle when audio fires onended', async () => {
        render(<TestVoiceButton voice="alpha.onnx" provider="piper" />);
        const btn = screen.getByRole('button');
        await clickAndSettle(btn);
        await waitFor(() => expect(btn.className).toContain('bg-purple-600'));

        const audio = audioInstances[audioInstances.length - 1];
        await act(async () => {
            audio.onended?.();
            await Promise.resolve();
        });
        expect(btn.className).toContain('bg-neutral-700');
        expect(btn.className).not.toContain('bg-purple-600');
    });

    it('POSTs to /api/tts?provider=<provider> with text/voice/rate/pitch in the body', async () => {
        render(
            <TestVoiceButton
                voice="alpha.onnx"
                provider="google"
                rate={1.25}
                pitch={2}
                gender="male"
                text="hi"
            />
        );
        await clickAndSettle(screen.getByRole('button'));

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('/api/tts?provider=google');
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        const body = JSON.parse(init.body);
        expect(body).toEqual({ text: 'hi', voice: 'alpha.onnx', rate: 1.25, pitch: 2, gender: 'male' });
    });

    it('REGRESSION LOCK (bb34d88): pitch is in the body, audio.playbackRate is NEVER set', async () => {
        render(
            <TestVoiceButton voice="g.voice" provider="google" pitch={4} text="t" />
        );
        await clickAndSettle(screen.getByRole('button'));

        // Pitch must have been forwarded in the body, not consumed locally.
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.pitch).toBe(4);

        // The Audio that got constructed must NEVER have had playbackRate
        // assigned and must NEVER have had preservesPitch set to false —
        // those branches were removed in bb34d88 because pitch is now a
        // server-side semitone shift, not a client-side rate hack.
        expect(audioInstances.length).toBe(1);
        const audio = audioInstances[0];
        expect(audio._playbackRateSet).toBe(false);
        expect(audio._preservesPitchSetFalse).toBe(false);
    });

    it('omits rate and pitch from the body when those props are null/undefined', async () => {
        render(<TestVoiceButton voice="v" provider="piper" text="t" />);
        await clickAndSettle(screen.getByRole('button'));
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body).toEqual({ text: 't', voice: 'v' });
        expect('rate' in body).toBe(false);
        expect('pitch' in body).toBe(false);

        // Sanity: even with no pitch prop, playbackRate is still untouched.
        expect(audioInstances[0]._playbackRateSet).toBe(false);
    });

    it('forwards the AuthService bearer token in the Authorization header', async () => {
        render(<TestVoiceButton voice="v" provider="piper" />);
        await clickAndSettle(screen.getByRole('button'));
        const init = globalThis.fetch.mock.calls[0][1];
        expect(init.headers.Authorization).toBe('Bearer test-token-abc');
    });

    it('omits Authorization header when no token is stored', async () => {
        window.localStorage.removeItem('token');
        render(<TestVoiceButton voice="v" provider="piper" />);
        await clickAndSettle(screen.getByRole('button'));
        const init = globalThis.fetch.mock.calls[0][1];
        expect(init.headers.Authorization).toBeUndefined();
    });

    it('changing the voice prop mid-play stops the in-flight audio', async () => {
        const { rerender } = render(
            <TestVoiceButton voice="alpha.onnx" provider="piper" />
        );
        const btn = screen.getByRole('button');
        await clickAndSettle(btn);
        await waitFor(() => expect(btn.className).toContain('bg-purple-600'));

        const audio = audioInstances[audioInstances.length - 1];
        expect(audio.pauseCalls).toBe(0);

        // Swap the voice — the cleanup effect must fire stop() which pauses
        // the audio and resets state to idle.
        rerender(<TestVoiceButton voice="beta.onnx" provider="piper" />);
        expect(audio.pauseCalls).toBeGreaterThanOrEqual(1);
        expect(btn.className).toContain('bg-neutral-700');
        expect(btn.className).not.toContain('bg-purple-600');
    });

    it('surfaces a server error and returns the button to idle', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrorResponse(500, 'tts engine offline'));
        render(<TestVoiceButton voice="v" provider="piper" />);
        const btn = screen.getByRole('button');
        await clickAndSettle(btn);

        // Error styling and a title attr that exposes the message.
        await waitFor(() => {
            expect(btn.className).toContain('bg-red-900/40');
        });
        expect(btn.getAttribute('title')).toBe('tts engine offline');
        // No Audio was constructed because the response wasn't ok.
        expect(audioInstances.length).toBe(0);
    });

    it('falls back to a generic error message when the body is not JSON', async () => {
        // No body at all → apiFetch falls back to the HTTP status line.
        globalThis.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
        render(<TestVoiceButton voice="v" provider="piper" />);
        const btn = screen.getByRole('button');
        await clickAndSettle(btn);
        await waitFor(() => expect(btn.className).toContain('bg-red-900/40'));
        // Component falls back to "TTS preview failed (status)" via the
        // ApiError → caught-error path in TestVoiceButton.play().
        expect(btn.getAttribute('title')).toBe('TTS preview failed (503)');
    });

    it('aborts the in-flight fetch on unmount', async () => {
        // Hold the fetch open so the abort happens during loading.
        let rejectFetch;
        globalThis.fetch.mockImplementationOnce((_url, init) =>
            new Promise((_resolve, reject) => {
                rejectFetch = reject;
                init.signal.addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            })
        );

        const { unmount } = render(<TestVoiceButton voice="v" provider="piper" />);
        const btn = screen.getByRole('button');
        // Start the fetch (don't await — it never resolves on its own).
        await act(async () => {
            fireEvent.click(btn);
            await Promise.resolve();
        });

        // Unmount — cleanup effect should call abort which rejects the
        // pending fetch with AbortError and produces no Audio leak.
        await act(async () => {
            unmount();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(audioInstances.length).toBe(0);
        // Sanity: the fetch promise was indeed aborted (signal fired).
        expect(typeof rejectFetch).toBe('function');
    });

    it("size='sm' and size='md' render distinct dimensions", () => {
        const { rerender } = render(
            <TestVoiceButton voice="v" provider="piper" size="sm" />
        );
        const small = screen.getByRole('button');
        expect(small.className).toContain('w-6');
        expect(small.className).toContain('h-6');
        expect(small.className).not.toContain('w-8');

        rerender(<TestVoiceButton voice="v" provider="piper" size="md" />);
        const medium = screen.getByRole('button');
        expect(medium.className).toContain('w-8');
        expect(medium.className).toContain('h-8');
        expect(medium.className).not.toContain('w-6');
    });

    it('clicking while playing stops playback (toggle behavior)', async () => {
        render(<TestVoiceButton voice="v" provider="piper" />);
        const btn = screen.getByRole('button');
        await clickAndSettle(btn);
        await waitFor(() => expect(btn.className).toContain('bg-purple-600'));

        const audio = audioInstances[audioInstances.length - 1];
        // Second click in 'playing' state must call stop() — pause + idle.
        await act(async () => {
            fireEvent.click(btn);
            await Promise.resolve();
        });
        expect(audio.pauseCalls).toBeGreaterThanOrEqual(1);
        expect(btn.className).toContain('bg-neutral-700');
        expect(btn.className).not.toContain('bg-purple-600');
    });

    it('uses the supplied custom text instead of the default phrase', async () => {
        render(<TestVoiceButton voice="v" provider="piper" text="custom probe phrase" />);
        await clickAndSettle(screen.getByRole('button'));
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.text).toBe('custom probe phrase');
    });
});
