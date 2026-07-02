import { WebEyeTrackAdapter } from './WebEyeTrackAdapter.js';
import { WebGazerAdapter } from './WebGazerAdapter.js';
import { MediaPipeLandmarkGazeAdapter, MEDIAPIPE_GAZE_MODEL } from './MediaPipeLandmarkGazeAdapter.js';

export const GAZE_ENGINE_MEDIAPIPE = 'mediapipe';
export const GAZE_ENGINE_WEBEYETRACK = 'webeyetrack';
export const GAZE_ENGINE_WEBGAZER = 'webgazer';
export const SUPPORTED_GAZE_ENGINES = Object.freeze([
  GAZE_ENGINE_MEDIAPIPE,
  GAZE_ENGINE_WEBEYETRACK,
  GAZE_ENGINE_WEBGAZER,
]);

// What each engine writes into the gaze window's model_version field.
export const GAZE_ENGINE_MODEL_VERSIONS = Object.freeze({
  [GAZE_ENGINE_MEDIAPIPE]: MEDIAPIPE_GAZE_MODEL,
  [GAZE_ENGINE_WEBEYETRACK]: 'webeyetrack-0.0.2',
  [GAZE_ENGINE_WEBGAZER]: 'webgazer',
});

export function normalizeGazeEngine(engine) {
  const value = typeof engine === 'string' ? engine.toLowerCase().trim() : '';
  // Unknown engines fall back to the landmark adapter: it is the only engine
  // with no second camera, no second FaceMesh stack, and no global-singleton
  // state, so it is the safe default for host integrations (see
  // AGENT-NOTE-GAZE-INTEGRATION.md).
  return SUPPORTED_GAZE_ENGINES.includes(value) ? value : GAZE_ENGINE_MEDIAPIPE;
}

export function createGazeAdapter(options = {}) {
  const engine = normalizeGazeEngine(options.engine);
  // Only forward fields that were actually provided. Spreading
  // `clock: options.clock` when the caller never set it overrides the
  // adapter's default `clock: () => Date.now()` with `undefined`, which
  // then crashes in `_handlePrediction` (`this.options.clock is not a
  // function`). Same logic for the other optional fields.
  const common = {};
  if (typeof options.onGaze === 'function') common.onGaze = options.onGaze;
  if (typeof options.onError === 'function') common.onError = options.onError;
  if (Number.isFinite(options.minQualityScore)) common.minQualityScore = options.minQualityScore;
  if (typeof options.clock === 'function') common.clock = options.clock;
  if (engine === GAZE_ENGINE_WEBGAZER) {
    return new WebGazerAdapter({
      ...common,
      ...(options.webgazer || {}),
    });
  }
  if (engine === GAZE_ENGINE_WEBEYETRACK) {
    return new WebEyeTrackAdapter({
      ...common,
      videoElementId: options.videoElementId,
      ...(options.webeyetrack || {}),
    });
  }
  return new MediaPipeLandmarkGazeAdapter({
    ...common,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.mediapipe || {}),
  });
}
