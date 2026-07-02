import { MEDIAPIPE_TASKS_WASM_CDN, MEDIAPIPE_FACE_LANDMARKER_URL } from '../config/cdnDefaults.js';

/**
 * Strip a trailing slash from the WASM base URL. tasks-vision's
 * FilesetResolver joins `${base}/${file}` itself, so a slash-terminated
 * base produces `wasm//vision_wasm_internal.js` — which jsDelivr rejects
 * with HTTP 400. Normalizing at the single consumption point makes every
 * caller safe (CDN constants ship with a trailing slash; host-provided
 * paths may or may not). Exported for tests.
 */
export function normalizeWasmBaseUrl(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\/+$/, '');
}

export class MediaPipeFaceTracker {
  constructor(options = {}) {
    this.options = {
      wasmBaseUrl: MEDIAPIPE_TASKS_WASM_CDN,
      modelAssetPath: MEDIAPIPE_FACE_LANDMARKER_URL,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      ...options,
    };
    this.options.wasmBaseUrl = normalizeWasmBaseUrl(this.options.wasmBaseUrl);
    this.faceLandmarker = null;
    this.lastVideoTime = -1;
  }

  async init() {
    resetLegacyMediapipeSolutionGlobals();
    const mod = await import('@mediapipe/tasks-vision');
    const vision = await mod.FilesetResolver.forVisionTasks(this.options.wasmBaseUrl);
    this.faceLandmarker = await mod.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: this.options.modelAssetPath,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: this.options.minFaceDetectionConfidence,
      minFacePresenceConfidence: this.options.minFacePresenceConfidence,
      minTrackingConfidence: this.options.minTrackingConfidence,
    });
  }

  async analyze(video, timestampMs) {
    if (!this.faceLandmarker) throw new Error('MediaPipeFaceTracker.init() must run first.');
    if (video.currentTime === this.lastVideoTime) {
      return { facePresent: false, reason: 'duplicate-frame' };
    }
    this.lastVideoTime = video.currentTime;

    const result = this.faceLandmarker.detectForVideo(video, timestampMs);
    const landmarks = result.faceLandmarks?.[0] || null;
    if (!landmarks) return { facePresent: false, reason: 'no-face' };

    const bbox = bboxFromLandmarks(landmarks);
    const rawBlendshapes = result.faceBlendshapes?.[0]?.categories || [];
    const quality = {
      bbox,
      faceAreaRatio: bbox.width * bbox.height,
      blendshapeCount: rawBlendshapes.length,
    };

    const blendshapes = rawBlendshapes.map(item => ({
      categoryName: item.categoryName,
      score: item.score,
    }));
    const transformationMatrix = toFloat32Matrix(result.facialTransformationMatrixes?.[0]);

    return {
      facePresent: true,
      landmarks,
      bbox,
      blendshapes,
      matrix: result.facialTransformationMatrixes?.[0] || null,
      transformationMatrix,
      quality,
    };
  }
}

/**
 * WebGazer's bundled FaceMesh runtime is the *legacy* MediaPipe Solutions
 * stack (not Tasks Vision). When WebGazer ran earlier in the page session it
 * left module factories + a few helper globals on the window. Loading
 * `@mediapipe/tasks-vision` afterwards can hit Emscripten "Module.arguments
 * has been replaced" errors because the legacy Module is still around.
 *
 * Defensive cleanup: remove every WebGazer-side hook we know about so a
 * fresh Tasks Vision import gets a clean slate. Each entry is wrapped in a
 * try/catch — none are critical, and clearing them is best-effort.
 */
function resetLegacyMediapipeSolutionGlobals() {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (!g) return;
  const keys = [
    // Emscripten-generated factories that produced "Module.arguments has been
    // replaced" when both loaders raced for the same Module global.
    'createMediapipeSolutionsWasm',
    'createMediapipeSolutionsPackedAssets',
    // The shared Emscripten Module object itself — the root of the
    // "Module.arguments has been replaced" abort. Cleared before
    // FilesetResolver.forVisionTasks() so Tasks Vision gets a fresh Module.
    'Module',
  ];
  for (const key of keys) {
    try { delete g[key]; } catch { g[key] = undefined; }
  }
}

function toFloat32Matrix(matrixLike) {
  // MediaPipe returns either a Float32Array(16) or an object with a `data` Float32Array.
  // Default to a 4x4 identity matrix when missing.
  if (matrixLike == null) return identityMatrix4();
  if (matrixLike instanceof Float32Array && matrixLike.length === 16) return matrixLike;
  if (matrixLike?.data instanceof Float32Array && matrixLike.data.length === 16) return matrixLike.data;
  if (Array.isArray(matrixLike) && matrixLike.length === 16) return Float32Array.from(matrixLike);
  if (matrixLike?.data && matrixLike.data.length === 16) return Float32Array.from(matrixLike.data);
  return identityMatrix4();
}

function identityMatrix4() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function bboxFromLandmarks(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: clamp(minX, 0, 1),
    y: clamp(minY, 0, 1),
    width: clamp(maxX - minX, 0, 1),
    height: clamp(maxY - minY, 0, 1),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
