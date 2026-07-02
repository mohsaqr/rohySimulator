// Type declarations for the Oyon screen-point gaze subpath.
// Hand-written; consult JSDoc and the source modules
// (`src/inference/WebEyeTrackAdapter.js`, `src/smoothing/GazeSmoother.js`,
// `src/aggregation/GazeAggregator.js`) for authoritative shapes.

/**
 * One sample emitted by a gaze adapter (WebEyeTrack or WebGazer).
 * Coordinates are normalized point-of-gaze in `[-0.5, 0.5]` on each
 * axis: origin = screen center, +X right, +Y down.
 *
 * `quality` is a `[0, 1]` confidence proxy (1 = best, 0 = blink/unusable).
 *
 * `quality_source` discloses how the number was produced so downstream
 * consumers (smoother, aggregator, host UI) can compare like-with-like:
 *   - `'model'`     — upstream library reported a real per-frame confidence.
 *   - `'geometric'` — Oyon derived the number from off-axis distance / blink
 *                     state because the upstream library does not surface a
 *                     confidence value. Treat as a coarse proxy, not a
 *                     calibrated probability.
 *   - `'unknown'`   — adapter could not determine a meaningful number; the
 *                     `quality` field is a placeholder.
 *
 * `valid` is true only when `gaze_state === 'open'` AND quality ≥ the
 * configured threshold.
 */
export type GazeQualitySource = 'model' | 'geometric' | 'unknown';

export interface GazeSample {
  x: number;
  y: number;
  quality: number;
  quality_source: GazeQualitySource;
  valid: boolean;
  gaze_state: 'open' | 'closed';
  /** Wall-clock ms at receive time on the main thread. */
  ts_ms: number;
  /** Upstream video-relative timestamp (ms since stream start), or null. */
  ts_video_ms: number | null;
}

/**
 * Output of `GazeSmoother.update(sample)`. Extends `GazeSample` with the
 * raw input attached and a `smoothed` flag indicating whether this frame
 * advanced the EWMA state (false for blinks, below-quality, or
 * passthrough).
 */
export interface SmoothedGazeSample extends GazeSample {
  raw: GazeSample;
  smoothed: boolean;
}

/**
 * One area-of-interest rectangle, in WebEyeTrack's normalized coords.
 * Define rectangles via the same `[-0.5, 0.5]` axes as `GazeSample`.
 */
export interface GazeAoi {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GazeCentroid {
  x: number;
  y: number;
}

/**
 * Aggregated gaze metrics for a single window, returned by
 * `GazeAggregator.flush()`. Mirrors the JSONC shape documented in
 * `docs/SCREEN_POINT_GAZE.md` §3.
 *
 * `zone_proportions` keys are either the 9 named 3x3 zones
 * (`top_left`, `top_center`, …, `bottom_right`) or `r<n>c<n>` indexed keys
 * for grids ≥ 4. The validator (`oyon/validation`) enforces this.
 */
export interface GazeWindow {
  window_start: string;
  window_end: string;
  duration_ms: number;
  /** Count of on-screen valid points contributing to centroid/dispersion. */
  n_points: number;
  /** Total frames buffered, including invalid and off-screen. */
  total_frames: number;
  centroid: GazeCentroid | null;
  /** Pooled standard deviation of (x, y) over the on-screen valid set. */
  dispersion: number | null;
  zone_proportions: Record<string, number> | null;
  /** Only populated when `gaze_aois` is non-empty; otherwise null. */
  aoi_dwell_ms: Record<string, number> | null;
  calibration_age_ms: number | null;
  calibration_quality: number | null;
  /**
   * How much the adapter trusts `calibration_quality`. When `'unknown'`,
   * downstream code MUST NOT treat `calibration_quality` as a comparable
   * probability — it is either null or a placeholder.
   */
  calibration_confidence: CalibrationConfidence;
  valid_frame_ratio: number;
  off_screen_ratio: number;
  model_version: string;
}

export interface GazeSmootherOptions {
  /** EWMA blending factor in (0, 1]. Default 0.5. */
  alpha?: number;
  /** Below-threshold samples pass through with `smoothed:false`. Default 0.3. */
  minQualityScore?: number;
}

export class GazeSmoother {
  constructor(options?: GazeSmootherOptions);
  options: Required<GazeSmootherOptions>;
  reset(): void;
  update(sample: GazeSample | null): SmoothedGazeSample | null;
}

export interface GazeAggregatorOptions {
  /** Window duration in ms. Default 10000. */
  windowMs?: number;
  /** ms credited per in-AOI sample for `aoi_dwell_ms`. Default 33. */
  sampleIntervalMs?: number;
  /** 3 (named 9 zones) or ≥4 (indexed r<n>c<n>). Default 3. */
  zoneGrid?: number;
  /** Host-configured AOIs. Empty array (default) → `aoi_dwell_ms: null`. */
  aois?: GazeAoi[];
  /** Exclude off-screen points from centroid/dispersion. Default true. */
  dropOffScreen?: boolean;
  /** Model version string emitted in the window payload. */
  modelVersion?: string;
}

export interface GazeCalibrationMeta {
  calibrationAgeMs?: number | null;
  calibrationQuality?: number | null;
}

export class GazeAggregator {
  constructor(options?: GazeAggregatorOptions);
  options: Required<GazeAggregatorOptions>;
  consumeFrame(frame: SmoothedGazeSample | null, timestamp?: number): GazeWindow | null;
  flush(end?: number, calibrationMeta?: GazeCalibrationMeta): GazeWindow | null;
}

export interface WebEyeTrackAdapterOptions {
  /** ID of the host's <video> element. Required. */
  videoElementId: string;
  /** Per-sample callback. Required. */
  onGaze: (sample: GazeSample) => void;
  /** Optional error handler for caller-side throws. */
  onError?: (err: Error) => void;
  /** Quality gate used by the adapter. Default 0.3. */
  minQualityScore?: number;
  /** Test-injectable clock; defaults to `() => Date.now()`. */
  clock?: () => number;
}

export interface WebGazerAdapterOptions {
  /** Per-sample callback. Required. */
  onGaze: (sample: GazeSample) => void;
  /** Optional error handler for caller-side throws. */
  onError?: (err: Error) => void;
  /** Quality gate used by the adapter. Default 0.3. */
  minQualityScore?: number;
  /** Test-injectable clock; defaults to `() => Date.now()`. */
  clock?: () => number;
  /** Test/browser viewport override; defaults to window dimensions. */
  viewport?: { width: number; height: number } | (() => { width: number; height: number });
  /** Existing MediaStream or lazy getter. Avoids WebGazer opening a second camera stream. */
  stream?: unknown | (() => unknown);
  /** MediaPipe FaceMesh solution path used internally by WebGazer. */
  faceMeshSolutionPath?: string | null;
  /** Optional injected WebGazer singleton for tests or custom loading. */
  webgazer?: unknown;
  regression?: string | null;
  showVideoPreview?: boolean;
  showFaceOverlay?: boolean;
  showFaceFeedbackBox?: boolean;
  showPredictionPoints?: boolean;
  saveDataAcrossSessions?: boolean;
}

/**
 * How much the adapter trusts the `quality` number in a CalibrationResult.
 *   - `'measured'` — adapter read a real quality value from the upstream engine.
 *   - `'inferred'` — adapter computed a coarse number from auxiliary signals.
 *   - `'unknown'`  — adapter cannot quantify calibration quality; `quality` is null.
 */
export type CalibrationConfidence = 'measured' | 'inferred' | 'unknown';

export type CalibrationResult =
  | { ok: true; quality: number | null; confidence: CalibrationConfidence; model: string }
  | { ok: false; reason: string; message?: string };

export class WebEyeTrackAdapter {
  constructor(options: WebEyeTrackAdapterOptions);
  init(): Promise<void>;
  start(): Promise<void>;
  calibrate(points: Array<{ x: number; y: number }>): Promise<CalibrationResult>;
  status(): 'idle' | 'inference' | 'calib' | null;
  dispose(): void;
}

export class WebGazerAdapter {
  constructor(options: WebGazerAdapterOptions);
  init(): Promise<void>;
  start(): Promise<void>;
  calibrate(points: Array<{ x: number; y: number }>): Promise<CalibrationResult>;
  status(): 'idle' | 'starting' | 'inference' | 'error' | null;
  lastError(): unknown;
  dispose(): void;
}

export interface MediaPipeLandmarkGazeAdapterOptions {
  /** Per-sample callback. Required. */
  onGaze: (sample: GazeSample) => void;
  /** Optional error handler for caller-side throws. */
  onError?: (err: Error) => void;
  /** Quality gate used by the adapter. Default 0.3. */
  minQualityScore?: number;
  /** Test-injectable clock; defaults to `() => Date.now()`. */
  clock?: () => number;
  /** Partial OyonSettings forwarded to extractEyeFeatures. */
  settings?: Record<string, unknown>;
  /** Iris-offset → screen gain on the X axis. Default 2.0. */
  xGain?: number;
  /** Iris-offset → screen gain on the Y axis. Default 2.5. */
  yGain?: number;
  /** Mirror camera-space X into screen-space. Default true. */
  flipX?: boolean;
}

/** Counters for debugging silent gaze absence (chatoyon post-mortem). */
export interface GazeAdapterDiagnostics {
  adapterStatus: string | null;
  rawFrames: number;
  validSamples: number;
  invalidSamples: number;
  lastSampleAt: number | null;
  lastError: string | null;
  calibrationRuns: number;
}

/**
 * Calibration-free gaze derived from the runtime's own MediaPipe face
 * tracker — the default engine. The runtime feeds it via handleFace();
 * it owns no camera and no second FaceMesh stack.
 */
export class MediaPipeLandmarkGazeAdapter {
  constructor(options: MediaPipeLandmarkGazeAdapterOptions);
  /** Always false: bypasses the runtime's gaze_calibration_required gate. */
  readonly requiresCalibration: boolean;
  init(): Promise<void>;
  start(): Promise<void>;
  /** Honest no-op: resolves { ok: true, quality: null, confidence: 'inferred' }. */
  calibrate(points?: Array<{ x: number; y: number }>): Promise<CalibrationResult>;
  status(): 'idle' | 'inference' | null;
  /** Idempotent and non-terminal — re-init()/start() after dispose is legal. */
  dispose(): void;
  /** Push one MediaPipeFaceTracker.analyze() result through the gaze mapping. */
  handleFace(face: unknown, timestampMs?: number): void;
  diagnostics(): GazeAdapterDiagnostics;
}

/** Pure mapping from EyeFeatureExtractor output to a GazeSample (for tests). */
export function featuresToGazeSample(
  features: unknown,
  opts?: Pick<MediaPipeLandmarkGazeAdapterOptions, 'minQualityScore' | 'xGain' | 'yGain' | 'flipX'>,
  wallClockMs?: number,
  videoMs?: number | null,
): GazeSample | null;

export const MEDIAPIPE_GAZE_MODEL: string;

export type GazeEngine = 'mediapipe' | 'webeyetrack' | 'webgazer';

export function normalizeGazeEngine(engine: unknown): GazeEngine;

export const SUPPORTED_GAZE_ENGINES: readonly GazeEngine[];

/** model_version string each engine writes into gaze windows. */
export const GAZE_ENGINE_MODEL_VERSIONS: Readonly<Record<GazeEngine, string>>;

export function createGazeAdapter(options: {
  engine?: GazeEngine | string;
  videoElementId?: string;
  onGaze: (sample: GazeSample) => void;
  onError?: (err: Error) => void;
  minQualityScore?: number;
  clock?: () => number;
  /** Partial OyonSettings forwarded to the mediapipe adapter. */
  settings?: Record<string, unknown>;
  mediapipe?: Partial<MediaPipeLandmarkGazeAdapterOptions>;
  webgazer?: Partial<WebGazerAdapterOptions>;
  webeyetrack?: Partial<WebEyeTrackAdapterOptions>;
}): WebEyeTrackAdapter | WebGazerAdapter | MediaPipeLandmarkGazeAdapter;

/**
 * Pure normalization helper exported for testing.
 */
export function normalizeGazeResult(
  gazeResult: unknown,
  wallClockMs: number,
  minQualityScore?: number,
): GazeSample | null;

export function normalizeWebGazerPrediction(
  prediction: unknown,
  elapsedTime: number | null,
  wallClockMs: number,
  minQualityScore?: number,
  viewport?: { width: number; height: number },
): GazeSample | null;

/**
 * One target dot in a calibration sequence — normalized [-0.5, 0.5] on each
 * axis, same convention as `GazeSample`.
 */
export interface GazeCalibrationPoint {
  x: number;
  y: number;
}

export interface GazeCalibrationClickEvent {
  pixelX: number;
  pixelY: number;
  point: GazeCalibrationPoint;
  index: number;
}

export interface GazeCalibrationPhaseEvent {
  point: GazeCalibrationPoint;
  index: number;
  total: number;
  pixelX: number;
  pixelY: number;
}

export type GazeCalibrationProgressEvent =
  | ({ type: 'show' } & GazeCalibrationPhaseEvent)
  | ({ type: 'capture' } & GazeCalibrationPhaseEvent)
  | { type: 'advance'; index: number; total: number }
  | { type: 'complete'; result: CalibrationResult }
  | { type: 'aborted'; reason: string };

export interface GazeCalibrationDriverOptions {
  /** Target sequence in normalized [-0.5, 0.5] coords. Default: 5-point center+corners. */
  points?: GazeCalibrationPoint[];
  /** Per-dot fixation wait before the click fires. Default 500. */
  fixationMs?: number;
  /** Per-dot capture wait after the click fires. Default 1000. */
  captureMs?: number;
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called per dot once the fixation wait completes; the overlay uses this to dispatch a synthetic MouseEvent at the dot's pixel coords. */
  clickDispatcher?: (evt: GazeCalibrationClickEvent) => void;
  onShow?: (evt: GazeCalibrationPhaseEvent) => void;
  onCapture?: (evt: GazeCalibrationPhaseEvent) => void;
  onProgress?: (evt: GazeCalibrationProgressEvent) => void;
  onComplete?: (result: CalibrationResult) => void;
  onAbort?: (reason: string) => void;
  onHookError?: (info: { hook: string; error: unknown }) => void;
}

export interface GazeCalibrationStartOptions {
  viewport: { width: number; height: number };
}

export class GazeCalibrationDriver {
  constructor(options?: GazeCalibrationDriverOptions);
  readonly state: 'idle' | 'showing' | 'capturing' | 'finalizing' | 'complete' | 'aborted';
  readonly currentIndex: number | null;
  readonly totalPoints: number;
  start(
    runtime: { calibrateGaze: (points: GazeCalibrationPoint[]) => Promise<CalibrationResult> },
    options: GazeCalibrationStartOptions,
  ): Promise<CalibrationResult>;
  abort(reason?: string): void;
}

export const DEFAULT_CALIBRATION_POINTS: readonly GazeCalibrationPoint[];

/**
 * Register the `<oyon-gaze-calibration>` custom element. Idempotent.
 * No-op in environments without `customElements` (Node).
 */
export function defineGazeCalibrationOverlay(tagName?: string): void;
