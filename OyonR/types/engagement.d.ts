// Type declarations for the Oyon eye-tracking / engagement subpath.
// These are hand-written and intentionally approximate; consult JSDoc and
// `src/inference/EyeFeatureExtractor.js`, `src/smoothing/EyeSmoother.js`,
// and `src/aggregation/EngagementAggregator.js` for authoritative shapes.

export type GazeZone = 'center' | 'left' | 'right' | 'up' | 'down';

export interface IrisOffset2D {
  x: number;
  y: number;
}

export interface IrisOffsetPair {
  /** Left eye normalized iris offset, or null when blink-masked / unavailable. */
  l: IrisOffset2D | null;
  /** Right eye normalized iris offset, or null when blink-masked / unavailable. */
  r: IrisOffset2D | null;
}

/**
 * Per-frame eye features produced by `extractEyeFeatures`.
 *
 * Eye openness is in `[0, 1]` (1 = wide open, 0 = closed). The blink booleans
 * are `eye_openness_* < blink_mask_threshold`. `valid` is `false` when both
 * eyes are blink-masked or refined-iris landmarks are absent.
 */
export interface EyeFeatures {
  eye_openness_l: number;
  eye_openness_r: number;
  blink_l: boolean;
  blink_r: boolean;
  iris_offset_normalized: IrisOffsetPair;
  gaze_zone: GazeZone | null;
  valid: boolean;
  ts_ms: number;
}

/**
 * Output of `EyeSmoother.update(eyeFeatures)`. Extends EyeFeatures with the
 * raw input attached for downstream stages that need un-smoothed values
 * (e.g., `EngagementAggregator` reading raw blink booleans for rising-edge
 * detection).
 */
export interface SmoothedEyeFeatures extends EyeFeatures {
  /** The original `EyeFeatures` object passed into `update()`. */
  raw: EyeFeatures;
  /** True if this frame advanced EWMA state; false for passthrough on invalid frames. */
  smoothed: boolean;
}

/**
 * Focus-score weight contribution per component. Must sum to 1 (±1e-6).
 */
export interface FocusScoreWeights {
  blink_penalty: number;
  openness: number;
  gaze_stability: number;
}

export interface GazeZoneProportions {
  center: number;
  left: number;
  right: number;
  up: number;
  down: number;
}

export interface FocusScoreComponents {
  blink: number;
  openness: number;
  gaze_stability: number;
}

/**
 * Aggregated engagement metrics for a single window, returned by
 * `EngagementAggregator.flush()`. Mirrors the JSONC shape documented in
 * `docs/EYE_TRACKING.md` §3.
 */
export interface EngagementWindow {
  window_start: string;
  window_end: string;
  duration_ms: number;
  expected_samples: number;
  total_frames: number;
  valid_frames: number;
  valid_frame_ratio: number;
  blink_count: number;
  blink_rate_hz: number | null;
  eye_openness_mean: number | null;
  eye_openness_std: number | null;
  gaze_zone_proportions: GazeZoneProportions | null;
  gaze_entropy: number | null;
  focus_score: number | null;
  focus_score_components: FocusScoreComponents | null;
  model_version: string;
}

/**
 * Multiply the inverse rotation of a column-major 4x4 head-pose matrix
 * against a 3D iris offset. Exported for unit testing.
 */
export function normalizeIrisByHeadPose(
  irisPoint3d: { x: number; y: number; z: number },
  transformationMatrix: Float32Array | number[] | null | undefined,
): { x: number; y: number; z: number };

/**
 * Classify a normalized iris offset into one of five coarse zones.
 * `neutralDeg` is the half-width (in degrees) of the central neutral region.
 */
export function classifyGazeZone(
  normalizedOffsetXY: { x: number; y: number },
  neutralDeg: number,
): GazeZone;

/**
 * Extract per-frame eye features from a MediaPipe FaceLandmarker result.
 * Returns `null` when no face is present.
 */
export function extractEyeFeatures(
  mediaPipeResult: unknown,
  settings?: {
    blink_mask_threshold?: number;
    gaze_zone_neutral_deg?: number;
    [key: string]: unknown;
  },
): EyeFeatures | null;

export interface EyeSmootherOptions {
  /** EWMA blending factor in (0, 1]. Higher = more reactive. Default 0.3. */
  alpha?: number;
  /** Minimum time (ms) the currently visible gaze zone must hold before flipping. */
  gazeZoneMinHoldMs?: number;
  /** Number of consecutive frames a new candidate zone must be observed to flip. */
  gazeZoneMinSwitchVotes?: number;
}

export class EyeSmoother {
  constructor(options?: EyeSmootherOptions);
  options: Required<EyeSmootherOptions>;
  reset(): void;
  update(eyeFeatures: EyeFeatures | null, timestamp?: number): SmoothedEyeFeatures | null;
}

export interface EngagementAggregatorOptions {
  /** Window duration in ms. Default 10000. */
  windowMs?: number;
  /** Expected sample cadence in ms. Default 1000. */
  sampleIntervalMs?: number;
  /** Per-person resting blink-rate baseline (Hz) used to normalize the score. Default 0.25. */
  blinkRateBaselineHz?: number;
  /** N×N quantization grid used to compute gaze entropy over [-0.5, 0.5]. Default 5. */
  gazeEntropyGridN?: number;
  /** Component weights for the derived `focus_score`. Must sum to 1. */
  focusScoreWeights?: FocusScoreWeights;
}

export class EngagementAggregator {
  constructor(options?: EngagementAggregatorOptions);
  options: Required<EngagementAggregatorOptions>;
  /**
   * Consume a smoothed eye frame. Returns the engagement window if the
   * window duration has elapsed, otherwise `null`.
   *
   * Privacy invariant: this call drops references to the input's `raw` and
   * any landmark/matrix payloads — only the scalars it needs are retained.
   */
  consumeFrame(smoothedFrame: SmoothedEyeFeatures | null, timestamp?: number): EngagementWindow | null;
  /** Flush the current buffer and return the engagement window (or `null` if empty). */
  flush(end?: number): EngagementWindow | null;
}
