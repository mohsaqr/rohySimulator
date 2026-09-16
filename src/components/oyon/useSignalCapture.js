// Lazy host for Oyon's host-driven signal capture (typing, interaction,
// discourse, ai_assist).
//
// `createSignalCapture` is the SIBLING of the camera runtime: the camera path
// is driven by the `<oyon-app>` element, which rohy loads as a served <script>
// (loadOyonElement.js) and so costs the SPA bundle nothing. There is no such
// escape here — the element bundle contains the typing ADAPTER and aggregator
// for its own demo page, but not the `createSignalCapture` orchestrator, and
// exposes no host-facing API to drive them. So this genuinely has to be a
// bundler import, which is why it is a DYNAMIC one: the chunk is fetched only
// when a tenant has a signal modality enabled and the learner has consented.
// v2 previously pulled the whole oyon library into the main bundle graph
// (see the note in OyonCaptureWidget.jsx) — the dynamic import is what keeps
// that from happening again. Measure the dist/ delta if you change it.
//
// What this owns: lifecycle only. Attaching a composer, feeding messages, and
// reporting interactions are the callers' jobs, through the returned handle.

import { useEffect, useRef, useState } from 'react';
import { createSignalTransport } from './signalTransport';
import { createSignalEventTransport } from './signalEventTransport';
import { apiUrl } from '../../config/api';
import { oyonClientLog } from './clientLogger';

// Voice reaches getUserMedia, so it has three gates and none may be defaulted:
//   1. the tenant's voice_enabled (migration 0057, off by default);
//   2. the learner's contract naming it — oyon-consent-v3 — which
//      useOyonSignalGate's coveredRuntime has already applied, so runtime's
//      voice_enabled is false for anyone who has not accepted v3;
//   3. a learner-initiated voice turn, which the patient chat starts in its
//      click handler (ChatInterface.startVoiceTurn).
// There is no single mic owner to share with: Rohy's STT is the browser's
// SpeechRecognition, which captures internally and exposes no MediaStream. So
// Oyon opens its own measurement stream for the length of the turn and releases
// it when the turn ends.
const MODALITY_FLAGS = Object.freeze([
    'typing_enabled',
    'interaction_enabled',
    'discourse_enabled',
    'ai_assist_enabled',
    'voice_enabled',
]);

/**
 * Where the voice worker loads its speech detector (Silero VAD) and the ONNX
 * runtime wasm — from THIS server, never a third party.
 *
 * Left unset, Oyon's defaults are raw.githubusercontent.com for the model and
 * cdn.jsdelivr.net for the runtime: fetched from the learner's browser every
 * time they speak, which sends their traffic to GitHub and jsDelivr during a
 * voice turn and simply fails on an air-gapped or firewalled install. It failed
 * silently in testing too — the detector never ran, every voice window reported
 * `vad_coverage: 0` and `poor_vad_coverage`, and nothing logged an error.
 *
 * Both files are already served: the model from OyonR/standalone/models/vad/ and
 * the wasm from OyonR/standalone/vendor/onnxruntime-web/ (installed by
 * download-models.sh), under /api/addons/oyon/assets. The vendored wasm is
 * onnxruntime-web 1.27.0, the same version Rohy bundles — ORT refuses a wasm
 * from a different build, so bumping one means bumping the other.
 *
 * Absolute URLs: the analyzer runs in a Web Worker, which resolves a relative
 * URL against the worker script rather than the page. apiUrl() applies the
 * deployment's base path, so a /rohy/-prefixed install still resolves.
 */
export function voiceAssetOptions(origin = globalThis.location?.origin || '') {
    // apiUrl() prepends the base path AND `/api` — so the path passed to it
    // must NOT start with /api, or the URL doubles to /api/api/… and 404s.
    const asset = (path) => `${origin}${apiUrl(`/addons/oyon/assets/${path}`)}`;
    return {
        analyzerOptions: {
            // OFF unless asked. WorkerVoiceAnalyzer only builds a speech detector
            // when `vadEnabled === true` (or a `vad` instance is injected); left
            // unset the worker runs DSP-only and speechProbability stays null, so
            // every window reports vad_coverage 0, speech_ratio 0 and is flagged
            // insufficient. The URLs below matter BECAUSE of this switch: with the
            // detector on and no paths, it would fetch from GitHub and jsDelivr.
            vadEnabled: true,
            modelUrl: asset('models/vad/silero_vad.onnx'),
            // The exact files, not the directory. Given only a directory,
            // onnxruntime-web 1.27.0 asks for its JSEP glue — which
            // download-models.sh deliberately does not install (it copies
            // ort.min.mjs plus the plain and asyncify simd pairs, from Rohy's own
            // node_modules, so they always match the bundled version). On a fresh
            // install that request 404s; on a machine holding an older download
            // it found a stale 1.20.1 JSEP file and died with `t.getValue is not
            // a function`. Naming the plain simd pair works on both. It runs
            // single-threaded (the adapter sets numThreads = 1), so no
            // cross-origin isolation is needed.
            wasmPaths: {
                mjs: asset('vendor/onnxruntime-web/ort-wasm-simd-threaded.mjs'),
                wasm: asset('vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm'),
            },
        },
    };
}

/** Does the tenant config turn on any modality we are prepared to capture? */
export function anyModalityEnabled(runtimeConfig) {
    const cfg = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
    return MODALITY_FLAGS.some(key => cfg[key] === true);
}

/**
 * Build the settings bag `createSignalCapture` gates construction on. Only
 * real booleans are forwarded — `createOyonSettings` merges over its own
 * defaults, and a 0/1 int from a SQLite row would be read as "no opinion"
 * rather than as off. Same trap `captureBridge.elementSettings` documents.
 */
export function captureSettings(runtimeConfig) {
    const cfg = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
    const out = {};
    for (const key of MODALITY_FLAGS) {
        if (typeof cfg[key] === 'boolean') out[key] = cfg[key];
    }
    // Always explicit. createOyonSettings merges over Oyon's own defaults, so an
    // OMITTED voice_enabled would be "no opinion" and could open the microphone.
    // Only an explicit `true` — tenant on AND contract accepted — turns it on.
    out.voice_enabled = cfg.voice_enabled === true;
    return out;
}

/**
 * Start one signal capture for the current session and tear it down cleanly.
 *
 * Returns `{ capture, error }`. `capture` is Oyon's handle — `capture.typing`,
 * `capture.interaction`, `capture.discourse`, `capture.ai_assist`, `capture.voice` — or null
 * while inactive. A modality the tenant disabled is `null` on the handle, not
 * a no-op stub, so callers should branch on it rather than call into silence.
 *
 * `caseId` and `room` are deliberately NOT in the restart condition: they are
 * read at send time by the transport. Restarting on a room hop would abandon
 * an in-flight typing episode every time the learner navigates.
 */
export function useSignalCapture({ enabled, persist, runtimeConfig, sessionId, caseId, room }) {
    const [capture, setCapture] = useState(null);
    const [error, setError] = useState(null);

    // Live context for the transport, refreshed without restarting capture.
    // Written in an effect rather than during render: a render React discards
    // must not leave its values behind in a ref, and nothing reads this until
    // a window flushes — long after commit.
    const contextRef = useRef({ persist, sessionId, caseId, room });
    useEffect(() => {
        contextRef.current = { persist, sessionId, caseId, room };
    });

    const active = Boolean(enabled && persist && sessionId && anyModalityEnabled(runtimeConfig));
    // Restart only on a real settings change, not on every parent render.
    const settingsKey = JSON.stringify(captureSettings(runtimeConfig));

    useEffect(() => {
        if (!active) return undefined;

        // Guards the async gap: an unmount or session change while the import
        // is in flight must not install a capture nobody will ever stop.
        let cancelled = false;
        let started = null;
        // The per-event state log (typing and voice), batched to its own route
        // for sequence analysis. Windows keep travelling through `transport`.
        const eventTransport = createSignalEventTransport(() => contextRef.current);

        (async () => {
            try {
                const { createSignalCapture } = await import('oyon/signal-capture');
                // The only await in this path, so this is the only place a
                // teardown can interleave. Returning here means nothing was
                // ever constructed — no listeners, no capture to leak — which
                // is why there is no second guard further down: everything
                // below runs synchronously.
                if (cancelled) return;

                started = createSignalCapture({
                    settings: JSON.parse(settingsKey),
                    // Self-hosted speech detector — see voiceAssetOptions.
                    voice: voiceAssetOptions(),
                    // Transport only — no IndexedDB store. The camera path keeps
                    // a local copy because the element owns one already; adding a
                    // second client-side store here would be an unasked-for copy
                    // of learner data with no reader.
                    transport: createSignalTransport(() => contextRef.current),
                    onEvent: eventTransport.write,
                    onError: (e, info) => oyonClientLog('warn', 'signal capture error', {
                        scope: info?.scope || null,
                        error: e?.message || String(e),
                    }),
                });
                // A fresh capture_id per start. Oyon restarts sequence_index at 0
                // for every capture and does not invent an id, so without one a
                // second capture in the same session would reuse the first
                // one's (session, index) keys and the server's dedup would drop
                // its events as retries.
                started.start({ session_id: sessionId, capture_id: `cap_${crypto.randomUUID()}` });
                setCapture(started);
                setError(null);
                oyonClientLog('debug', 'signal capture started', {
                    session_id: sessionId,
                    modalities: MODALITY_FLAGS.filter(k => JSON.parse(settingsKey)[k]),
                });
            } catch (e) {
                if (cancelled) return;
                setError(e);
                oyonClientLog('warn', 'signal capture failed to start', {
                    session_id: sessionId,
                    error: e?.message || String(e),
                });
            }
        })();

        return () => {
            cancelled = true;
            setCapture(null);
            if (!started) return;
            // stop() finalizes in-flight episodes (typing as abandoned) and
            // flushes pending writes; dispose() only after it resolves, or the
            // last windows never reach the transport.
            started.stop()
                .catch(e => oyonClientLog('warn', 'signal capture stop failed', {
                    error: e?.message || String(e),
                }))
                // stop() emits the closing events (submit/abandon, end), so the
                // event buffer is flushed after it and before dispose().
                .then(() => eventTransport.flush())
                .finally(() => started.dispose());
        };
    }, [active, sessionId, settingsKey]);

    return { capture, error };
}
