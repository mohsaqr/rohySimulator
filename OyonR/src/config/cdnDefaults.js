// Default asset URLs for Oyon's WASM runtimes and model weights.
//
// Two URL sets are exported:
//
// 1. *Public CDN* URLs (active defaults) — jsDelivr for npm-mirrored
//    WASM, Google Storage for the MediaPipe model bucket, GitHub raw
//    for EmotiEffLib emotion ONNX weights. Work today, no auth needed,
//    no setup beyond `npm install oyon`. Cost: depends on three third-
//    party services.
//
// 2. *Self-hosted* URLs — pinned to the `assets-v1` GitHub Release on
//    mohsaqr/Oyon. Same files, mirrored once. Currently require the
//    repo to be public (private repos auth-gate release downloads).
//    Use these to remove the third-party dependency by passing them
//    explicitly:
//
//      import {
//        EmotionRuntime,
//        SELF_HOSTED_ONNX_RUNTIME_WASM,
//        SELF_HOSTED_MEDIAPIPE_TASKS_WASM,
//        SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL,
//        SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL,
//      } from 'oyon';
//
//      new EmotionRuntime({
//        mediaPipe: {
//          wasmBaseUrl:    SELF_HOSTED_MEDIAPIPE_TASKS_WASM,
//          modelAssetPath: SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL,
//        },
//        onnx: { wasmPaths: SELF_HOSTED_ONNX_RUNTIME_WASM },
//        classifier: { modelUrl: SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL },
//      });
//
// Hosts that need fully local assets (CSP, offline, air-gapped) should
// instead use the bundled CLI:
//
//   npx oyon install-assets ./public
//   npx oyon download-models ./public

// ────────────────────────────────────────────────────────────────────
// Public CDN defaults (active)
// ────────────────────────────────────────────────────────────────────

// onnxruntime-web peer dep is `^1.20.0`. The actual installed version at
// build time can be any 1.x ≥ 1.20 — and the bundled WASM filenames diverge
// across minors (1.20.x ships only jsep; 1.21+ adds asyncify; 1.25+ adds
// jspi). To avoid version skew between the JS loader and the WASM it
// fetches, `OnnxEmotionClassifier.resolveWasmPaths` substitutes this URL's
// version against the runtime ORT version at init time. The hardcoded pin
// below is the static default for hosts that bundle ORT themselves at the
// same version; runtime substitution handles the npm-install case.
export const ONNX_RUNTIME_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/';

// MediaPipe Tasks WASM is loaded by FilesetResolver — jsDelivr serves
// the /wasm/ subdir of the published @mediapipe/tasks-vision package.
//
// Version note: this MUST be a version that actually exists on npm —
// 0.10.22 was never published as stable (only RCs), so the old pin 404'd.
// It SHOULD also match the tasks-vision JS the host bundles, because the
// FilesetResolver loader and the wasm must agree. 0.10.35 is what this
// repo installs and what the <oyon-app> element bundles.
export const MEDIAPIPE_TASKS_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/';

// Google's official MediaPipe model bucket. Matches scripts/download-models.sh.
export const MEDIAPIPE_FACE_LANDMARKER_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// EmotiEffLib (sb-ai-lab) emotion models, served from raw.githubusercontent.
export const EMOTION_MODEL_HSE_B0_URL =
  'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx';

export const EMOTION_MODEL_MOBILEVIT_MTL_URL =
  'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mobilevit_va_mtl.onnx';

export const EMOTION_MODEL_MOBILEFACENET_MTL_URL =
  'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mbf_va_mtl.onnx';

// Default emotion model — matches the "B0 default" decision from commit f3f9ad0.
export const DEFAULT_EMOTION_MODEL_URL = EMOTION_MODEL_HSE_B0_URL;

// ────────────────────────────────────────────────────────────────────
// Self-hosted alternatives — opt-in via runtime options
// ────────────────────────────────────────────────────────────────────

const SELF_HOSTED_RELEASE_BASE =
  'https://github.com/mohsaqr/Oyon/releases/download/assets-v1';

// All WASM and model files live flat under the assets-v1 release tag.
// (Filenames don't collide between MediaPipe and ONNX Runtime, and both
// loaders resolve siblings from a base URL — flat layout is fine.)
export const SELF_HOSTED_ONNX_RUNTIME_WASM = `${SELF_HOSTED_RELEASE_BASE}/`;
export const SELF_HOSTED_MEDIAPIPE_TASKS_WASM = `${SELF_HOSTED_RELEASE_BASE}/`;
export const SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL = `${SELF_HOSTED_RELEASE_BASE}/face_landmarker.task`;
export const SELF_HOSTED_EMOTION_MODEL_HSE_B0_URL = `${SELF_HOSTED_RELEASE_BASE}/enet_b0_8_va_mtl.onnx`;
export const SELF_HOSTED_EMOTION_MODEL_MOBILEVIT_MTL_URL = `${SELF_HOSTED_RELEASE_BASE}/mobilevit_va_mtl.onnx`;
export const SELF_HOSTED_EMOTION_MODEL_MOBILEFACENET_MTL_URL = `${SELF_HOSTED_RELEASE_BASE}/mbf_va_mtl.onnx`;
export const SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL = SELF_HOSTED_EMOTION_MODEL_HSE_B0_URL;

// One-stop snapshot for hosts that want to swap the entire defaults bundle.
export const SELF_HOSTED_DEFAULTS = Object.freeze({
  ONNX_RUNTIME_WASM_CDN: SELF_HOSTED_ONNX_RUNTIME_WASM,
  MEDIAPIPE_TASKS_WASM_CDN: SELF_HOSTED_MEDIAPIPE_TASKS_WASM,
  MEDIAPIPE_FACE_LANDMARKER_URL: SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL,
  EMOTION_MODEL_HSE_B0_URL: SELF_HOSTED_EMOTION_MODEL_HSE_B0_URL,
  EMOTION_MODEL_MOBILEVIT_MTL_URL: SELF_HOSTED_EMOTION_MODEL_MOBILEVIT_MTL_URL,
  EMOTION_MODEL_MOBILEFACENET_MTL_URL: SELF_HOSTED_EMOTION_MODEL_MOBILEFACENET_MTL_URL,
  DEFAULT_EMOTION_MODEL_URL: SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL,
});
