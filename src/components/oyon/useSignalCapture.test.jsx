// Lifecycle contract for the lazy SignalCapture host.
//
// The properties worth pinning are the ones whose failure is invisible: a
// chunk fetched for a tenant that has signals off, a capture that outlives its
// session, a stop() that never runs so an in-flight typing episode is lost,
// and voice reaching getUserMedia because a flag defaulted the wrong way.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// `imported` counts module evaluations, which is how we observe that the
// dynamic import really is deferred — not merely that start() wasn't called.
const h = vi.hoisted(() => ({ imported: 0, instances: [] }));

vi.mock('oyon/signal-capture', () => {
    h.imported += 1;
    return {
        createSignalCapture: vi.fn((options) => {
            const instance = {
                options,
                started: null,
                stopped: 0,
                disposed: 0,
                start: vi.fn(function (ctx) { this.started = ctx; return this; }),
                stop: vi.fn(function () { this.stopped += 1; return Promise.resolve(); }),
                dispose: vi.fn(function () { this.disposed += 1; }),
            };
            h.instances.push(instance);
            return instance;
        }),
    };
});
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));
vi.mock('./signalTransport', () => ({ createSignalTransport: vi.fn(fn => ({ send: fn })) }));

const { useSignalCapture, captureSettings, anyModalityEnabled, voiceAssetOptions } = await import('./useSignalCapture.js');

const CONFIG = { typing_enabled: true, interaction_enabled: true, discourse_enabled: false, ai_assist_enabled: false };
const PROPS = { enabled: true, persist: true, runtimeConfig: CONFIG, sessionId: 's1', caseId: 'c1', room: 'chat' };

beforeEach(() => {
    h.imported = 0;
    h.instances.length = 0;
});

describe('captureSettings', () => {
    // Same trap captureBridge.elementSettings documents: createOyonSettings
    // merges over its own defaults with a type check, so a SQLite 0/1 int is
    // read as "no opinion" rather than as off.
    it('forwards only real booleans', () => {
        expect(captureSettings({ typing_enabled: 1, interaction_enabled: 'true', discourse_enabled: false }))
            .toEqual({ voice_enabled: false, discourse_enabled: false, typing_max_intervals: 2000 });
    });

    // Voice reaches getUserMedia, so only an EXPLICIT true opens it. Before
    // consent v3 this forced voice off unconditionally; the tenant flag and the
    // accepted contract now decide, and coveredRuntime has already switched it
    // off for anyone who has not accepted v3.
    it('turns voice on only for an explicit true', () => {
        expect(captureSettings({ voice_enabled: true }).voice_enabled).toBe(true);
    });

    // An omitted or truthy-but-not-boolean flag is "no opinion" to Oyon's
    // settings merge, which could fall back to Oyon's own default and open the
    // microphone. Every such value must read as OFF.
    it('keeps voice off for a missing, 0/1 or string flag', () => {
        expect(captureSettings({}).voice_enabled).toBe(false);
        expect(captureSettings({ voice_enabled: 1 }).voice_enabled).toBe(false);
        expect(captureSettings({ voice_enabled: 'true' }).voice_enabled).toBe(false);
        expect(captureSettings({ voice_enabled: false }).voice_enabled).toBe(false);
    });

    it('counts voice as a modality that starts capture', () => {
        expect(anyModalityEnabled({ voice_enabled: true })).toBe(true);
        expect(anyModalityEnabled({ voice_enabled: 1 })).toBe(false);
    });

    it('survives a missing or malformed config', () => {
        expect(captureSettings(null)).toEqual({ voice_enabled: false, typing_max_intervals: 2000 });
        expect(anyModalityEnabled(null)).toBe(false);
        expect(anyModalityEnabled({ typing_enabled: 1 })).toBe(false);
        expect(anyModalityEnabled({ typing_enabled: true })).toBe(true);
    });
});

describe('useSignalCapture — when it stays out of the way', () => {
    // The lazy guarantee. Asserting the module was never evaluated is stronger
    // than asserting start() wasn't called: it means the chunk is not fetched.
    it.each([
        ['the addon is disabled', { enabled: false }],
        ['consent is not open', { persist: false }],
        ['there is no session', { sessionId: null }],
        ['the tenant enabled no modality', { runtimeConfig: { typing_enabled: false } }],
    ])('never imports the chunk when %s', async (_label, override) => {
        const { result } = renderHook(() => useSignalCapture({ ...PROPS, ...override }));
        await act(async () => {});
        expect(h.imported).toBe(0);
        expect(result.current.capture).toBeNull();
    });
});

describe('useSignalCapture — lifecycle', () => {
    it('starts under rohy\'s session id and exposes the handle', async () => {
        const { result } = renderHook(() => useSignalCapture(PROPS));
        await waitFor(() => expect(result.current.capture).not.toBeNull());

        expect(h.imported).toBe(1);
        expect(h.instances[0].started).toMatchObject({ session_id: 's1' });
        expect(h.instances[0].options.settings).toEqual({
            voice_enabled: false,
            typing_max_intervals: 2000,
            typing_enabled: true,
            interaction_enabled: true,
            discourse_enabled: false,
            ai_assist_enabled: false,
        });
    });

    // stop() finalizes an in-flight typing episode as abandoned and flushes
    // pending writes; disposing first would discard those windows.
    it('stops before disposing on unmount', async () => {
        const { result, unmount } = renderHook(() => useSignalCapture(PROPS));
        await waitFor(() => expect(result.current.capture).not.toBeNull());

        const instance = h.instances[0];
        unmount();
        await waitFor(() => expect(instance.disposed).toBe(1));
        expect(instance.stopped).toBe(1);
        expect(instance.stop.mock.invocationCallOrder[0])
            .toBeLessThan(instance.dispose.mock.invocationCallOrder[0]);
    });

    // Session identity is baked into the shared event log at start().
    it('restarts on a session change', async () => {
        const { result, rerender } = renderHook(props => useSignalCapture(props), { initialProps: PROPS });
        await waitFor(() => expect(result.current.capture).not.toBeNull());

        rerender({ ...PROPS, sessionId: 's2' });
        await waitFor(() => expect(h.instances).toHaveLength(2));
        expect(h.instances[0].stopped).toBe(1);
        expect(h.instances[1].started).toMatchObject({ session_id: 's2' });
    });

    // Regression lock: room and case are read at SEND time by the transport.
    // Restarting on them would abandon a typing episode on every navigation.
    it('does not restart when the learner changes room or case', async () => {
        const { result, rerender } = renderHook(props => useSignalCapture(props), { initialProps: PROPS });
        await waitFor(() => expect(result.current.capture).not.toBeNull());

        rerender({ ...PROPS, room: 'examination', caseId: 'c2' });
        await act(async () => {});

        expect(h.instances).toHaveLength(1);
        expect(h.instances[0].stopped).toBe(0);
    });

    // Regression lock: without a capture_id every event is refused (400), and
    // two captures sharing one would collide on the server's dedup key.
    it('starts each capture under its own capture_id and sends events to the event transport', async () => {
        const first = renderHook(props => useSignalCapture(props), { initialProps: PROPS });
        await waitFor(() => expect(first.result.current.capture).not.toBeNull());
        first.rerender({ ...PROPS, sessionId: 's2' });
        await waitFor(() => expect(h.instances).toHaveLength(2));

        const ids = h.instances.map(i => i.started?.capture_id);
        expect(ids.every(id => typeof id === 'string' && id.length > 4)).toBe(true);
        expect(new Set(ids).size).toBe(2);
        expect(typeof h.instances[0].options.onEvent).toBe('function');
    });

    // The transport reads context lazily so a room hop reaches the next batch
    // without disturbing capture.
    it('gives the transport the current room, not the one at start', async () => {
        const { result, rerender } = renderHook(props => useSignalCapture(props), { initialProps: PROPS });
        await waitFor(() => expect(result.current.capture).not.toBeNull());

        const readContext = h.instances[0].options.transport.send;
        expect(readContext().room).toBe('chat');
        rerender({ ...PROPS, room: 'radiology' });
        expect(readContext().room).toBe('radiology');
    });

    // The async gap. Unmounting while the chunk is still loading must not
    // construct anything: the import is the only await, so bailing there means
    // no aggregators, no DOM listeners, and no capture left running with
    // nobody holding a reference to stop it.
    it('constructs nothing when unmounted while the chunk is still loading', async () => {
        const { unmount } = renderHook(() => useSignalCapture(PROPS));
        unmount();
        await act(async () => {});
        await act(async () => {});
        expect(h.instances).toHaveLength(0);
    });
});

// Regression lock: where the voice worker loads its speech detector from.
//
// Four defects each left voice storing windows while the Silero detector never
// ran (vad_coverage 0). tests/e2e/oyon-voice.spec.js catches all four in a real
// browser, but needs installed models; these pin the URL decisions cheaply, in
// every CI run.
describe('voiceAssetOptions', () => {
    const { analyzerOptions } = voiceAssetOptions('https://rohy.example');

    it('turns the speech detector ON — left unset the worker runs DSP-only', () => {
        expect(analyzerOptions.vadEnabled).toBe(true);
    });

    it('loads the model from this server, never raw.githubusercontent.com', () => {
        expect(analyzerOptions.modelUrl)
            .toBe('https://rohy.example/api/addons/oyon/assets/models/vad/silero_vad.onnx');
    });

    // apiUrl() already prepends /api; passing a path that starts with /api too
    // produced /api/api/… and a 404 for every file.
    it('never doubles /api', () => {
        const all = [analyzerOptions.modelUrl, analyzerOptions.wasmPaths.mjs, analyzerOptions.wasmPaths.wasm];
        for (const url of all) expect(url).not.toContain('/api/api/');
    });

    // Given only a directory, onnxruntime-web 1.27.0 asks for JSEP glue the
    // installer never ships. Naming the plain simd pair is what makes it load.
    it('pins the exact single-threaded simd pair, not a directory and not JSEP', () => {
        expect(analyzerOptions.wasmPaths).toEqual({
            mjs: 'https://rohy.example/api/addons/oyon/assets/vendor/onnxruntime-web/ort-wasm-simd-threaded.mjs',
            wasm: 'https://rohy.example/api/addons/oyon/assets/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
        });
        expect(JSON.stringify(analyzerOptions.wasmPaths)).not.toMatch(/jsep|jspi|webgpu/);
    });

    it('never points at a third-party CDN', () => {
        expect(JSON.stringify(analyzerOptions)).not.toMatch(/jsdelivr|githubusercontent|unpkg|cdn\./);
    });
});
