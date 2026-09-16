// Build-time stub for `onnxruntime-web`, aliased in vite.config.js.
//
// Why this exists: importing `oyon/signal-capture` reaches
// `VoiceTurnController → WorkerVoiceAnalyzer → voiceAnalysisWorker →
// SileroVadAdapter → import('onnxruntime-web')`. That import is already lazy
// at RUNTIME, but a bundler still has to emit everything it can reach, which
// added ~48.7 MB of `ort-wasm-simd-threaded*.wasm` plus ~500 KB of JS glue to
// dist/ — and therefore to frontend/ and the Docker image.
//
// None of it was reachable in practice. Rohy forces `voice_enabled: false`
// (VoiceService owns the microphone; see useSignalCapture.js), so the VAD
// never runs. And the SPA has no other bundled ONNX path: the emotion
// classifier runs inside the <oyon-app> element, which loads its own runtime
// same-origin from /oyon/standalone/vendor/onnxruntime-web. Bundling a second
// copy shipped the same megabytes twice.
//
// Settings gate CONSTRUCTION, not the import graph — that distinction is the
// whole reason this file is needed. Oyon's own doc comment promises a disabled
// modality's collaborators are never constructed, and that is true at runtime;
// it says nothing about what a bundler must still emit.
//
// This is deliberately NOT an empty object. If a bundled path ever genuinely
// needs ONNX, it should fail loudly here with a message naming the fix, rather
// than fail somewhere deep in an inference call with `undefined is not a
// function`.
//
// ── Voice (consent v3) changed the premise above ──────────────────────────
// Voice is no longer forced off, so the Silero speech detector DOES run — and
// it runs inside the voice analysis Web Worker. The bundling reason still
// holds (48.7 MB), so the alias stays; instead, INSIDE A WORKER this module
// loads the real runtime at run time from this server: the vendored
// onnxruntime-web the camera path already serves at
// /api/addons/oyon/assets/vendor/onnxruntime-web/ort.min.mjs — version 1.27.0,
// the same Rohy bundles, which the runtime requires of its wasm.
//
// Worker-only on purpose. The main SPA thread never needs ONNX, and loading it
// there would put ~360 KB of runtime on the path of every page that happens to
// evaluate this module. Outside a worker — the main thread, and node, where
// onnxRuntimeStub.test.js imports it — the loud stub below is unchanged.
//
// If the runtime cannot be loaded (download-models.sh never ran, so the vendor
// directory is empty), the stub stays loud and says so: the detector fails to
// initialise, and the voice analyzer falls back to DSP-only, reported through
// its own `fallbackReason`.

const MESSAGE =
    'onnxruntime-web is stubbed out of the Rohy SPA bundle (vite.config.js alias → ' +
    'src/components/oyon/onnxRuntimeStub.js). Nothing in the SPA should need it: ' +
    'Oyon voice capture is disabled, and the <oyon-app> element loads its own ONNX ' +
    'runtime from /oyon/standalone/vendor/onnxruntime-web. If you are adding a ' +
    'bundled inference path, remove the alias and re-measure the dist/ size first — ' +
    'it was worth ~48.7 MB.';

/** True inside a (module) Web Worker; false on the main thread and in node. */
function inWorker() {
    return typeof WorkerGlobalScope !== 'undefined'
        && typeof globalThis !== 'undefined'
        && globalThis instanceof WorkerGlobalScope; // eslint-disable-line no-undef
}

/** The vendored runtime this server already serves, honouring the base path. */
function runtimeUrl() {
    const base = import.meta.env?.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    return `${globalThis.location.origin}${prefix}api/addons/oyon/assets/vendor/onnxruntime-web/ort.min.mjs`;
}

let real = null;
let loadError = null;
if (inWorker()) {
    try {
        real = await import(/* @vite-ignore */ runtimeUrl());
    } catch (err) {
        loadError = err;
    }
}

function unavailable() {
    if (loadError) {
        throw new Error(
            `The ONNX runtime could not be loaded from ${runtimeUrl()} (${loadError.message}). ` +
            'Voice speech detection needs the vendored runtime — run OyonR/scripts/download-models.sh. ' +
            MESSAGE,
        );
    }
    throw new Error(MESSAGE);
}

// The surface SileroVadAdapter/OnnxEmotionClassifier touch. Accessing any
// other export throws through the Proxy below.
export const InferenceSession = real ? real.InferenceSession : { create: unavailable };
export const Tensor = real ? real.Tensor : unavailable;
export const env = real ? real.env : {};

export default real ? (real.default || real) : new Proxy({ InferenceSession, Tensor, env }, {
    get(target, prop) {
        if (prop in target) return target[prop];
        return unavailable;
    },
});
