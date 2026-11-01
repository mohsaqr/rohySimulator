// Type declarations for the Oyon FER package.
// These are hand-written and intentionally approximate; consult JSDoc and
// source for exhaustive option shapes.

export type CaptureMode = 'local-browser' | 'host-stream' | 'mock';

export type {
  GazeZone,
  IrisOffset2D,
  IrisOffsetPair,
  EyeFeatures,
  SmoothedEyeFeatures,
  FocusScoreWeights,
  GazeZoneProportions,
  FocusScoreComponents,
  EngagementWindow,
  EyeSmootherOptions,
  EngagementAggregatorOptions,
} from './engagement';

export {
  EyeSmoother,
  EngagementAggregator,
  extractEyeFeatures,
  normalizeIrisByHeadPose,
  classifyGazeZone,
} from './engagement';

import type {
  FocusScoreWeights as _FocusScoreWeights,
  EngagementWindow as _EngagementWindow,
  EyeSmoother as _EyeSmoother,
  EngagementAggregator as _EngagementAggregator,
} from './engagement';

export type {
  GazeSample,
  SmoothedGazeSample,
  GazeAoi,
  GazeCentroid,
  GazeWindow,
  GazeSmootherOptions,
  GazeAggregatorOptions,
  GazeCalibrationMeta,
  WebEyeTrackAdapterOptions,
  WebGazerAdapterOptions,
  MediaPipeLandmarkGazeAdapterOptions,
  GazeAdapterDiagnostics,
  GazeEngine,
  CalibrationResult,
} from './gaze';

export {
  GazeSmoother,
  GazeAggregator,
  WebEyeTrackAdapter,
  WebGazerAdapter,
  MediaPipeLandmarkGazeAdapter,
  featuresToGazeSample,
  MEDIAPIPE_GAZE_MODEL,
  SUPPORTED_GAZE_ENGINES,
  GAZE_ENGINE_MODEL_VERSIONS,
  createGazeAdapter,
  normalizeGazeEngine,
  normalizeGazeResult,
  normalizeWebGazerPrediction,
} from './gaze';

export type { DomRectLike, ScreenGeometry, DomAoiOptions } from './gaze-aoi';
export { domRectToGazeAoi, elementToGazeAoi } from './gaze-aoi';

export type {
  TypingCompositionState,
  TypingRecordEvent,
  TypingPauseHistogram,
  TypingMetrics,
  TypingQualityThresholds,
  TypingQuality,
  TypingTarget,
  TypingWindow,
  TypingAggregatorOptions,
  TypingStartArgs,
  TypingFinalizeArgs,
  TypingComposerElement,
  TypingAggregatorLike,
  TypingGraphemeSegmenter,
  TypingComposerAdapterOptions,
  TypingGraphemeMode,
  TypingComposerAdapter,
} from './typing';

export { TypingAggregator, createTypingComposerAdapter } from './typing';

export type {
  SignalEventSource,
  SignalEventModality,
  SignalEventTarget,
  SignalEventContext,
  SignalEventInput,
  SignalEvent,
  SignalEventLongRow,
  SignalEventLongFormatOptions,
  SignalEventSequenceOptions,
  SignalEventLogOptions,
} from './signal-events';

export { SignalEventLog } from './signal-events';

export type {
  SignalCaptureModality,
  SignalCaptureContext,
  SignalCaptureStore,
  SignalCaptureTransport,
  SignalWindowRow,
  SignalCaptureStats,
  SignalCaptureTypingHandle,
  SignalCaptureVoiceHandle,
  SignalCaptureInteractionHandle,
  SignalCaptureDiscourseHandle,
  SignalCaptureAiAssistHandle,
  SignalCaptureOptions,
  SignalCapture,
} from './signal-capture';

export { createSignalCapture } from './signal-capture';

import type {
  GazeWindow as _GazeWindow,
  GazeSmoother as _GazeSmoother,
  GazeAggregator as _GazeAggregator,
  WebEyeTrackAdapter as _WebEyeTrackAdapter,
  WebGazerAdapter as _WebGazerAdapter,
} from './gaze';

export interface OyonSettings {
  sample_interval_ms: number;
  aggregate_window_ms: number;
  min_valid_frames: number;
  capture_mode: CaptureMode;
  capture_quality_enabled?: boolean;
  capture_quality_window_share?: boolean;
  smoothing_alpha?: number;

  // Eye-tracking / engagement settings (added in 0.3.0).
  eye_tracking_enabled?: boolean;
  blink_mask_threshold?: number;
  gaze_zone_neutral_deg?: number;
  engagement_window_share?: boolean;
  blink_rate_baseline_hz?: number;
  gaze_entropy_grid_n?: number;
  focus_score_weights?: _FocusScoreWeights;

  // Screen-point gaze settings (added in 0.4.0; 'mediapipe' engine + new
  // default in 2.0.0).
  gaze_tracking_enabled?: boolean;
  gaze_engine?: 'mediapipe' | 'webeyetrack' | 'webgazer';
  gaze_window_share?: boolean;
  gaze_calibration_required?: boolean;
  gaze_min_calibration_samples?: number;
  gaze_min_quality_score?: number;
  gaze_zone_grid?: number;
  gaze_aois?: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  gaze_drop_off_screen?: boolean;
  gaze_fixation_min_duration_ms?: number;
  gaze_fixation_dispersion_threshold?: number;
  gaze_fixation_min_sample_rate_hz?: number;
  gaze_max_sample_gap_ms?: number;

  // Facial signals — head pose + action units (added in 3.0.0). Free-rides on
  // the face result; no extra model.
  facial_signals_enabled?: boolean;
  facial_signals_window_share?: boolean;
  facial_frontal_half_angle_deg?: number;

  // Body posture — MediaPipe PoseLandmarker (added in 3.0.0).
  posture_tracking_enabled?: boolean;
  posture_window_share?: boolean;
  posture_model?: 'lite' | 'full' | 'heavy';

  // Remote heart rate — rPPG (added in 3.0.0). Research-grade trend, not clinical.
  /** Breathing rate from the 0.1-0.5 Hz band of the same ROI colour stream.
   *  Keeps the ROI sampler alive even when heart_rate_enabled is false. */
  respiration_enabled?: boolean;
  respiration_window_share?: boolean;
  respiration_buffer_seconds?: number;
  respiration_min_window_seconds?: number;
  respiration_min_confidence?: number;
  respiration_rgb_corroboration?: boolean;
  respiration_require_rgb_corroboration?: boolean;
  respiration_min_sample_rate_hz?: number;
  respiration_max_sample_gap_ms?: number;
  /** Ambient lighting quality — the covariate for every other signal. On by default. */
  illumination_enabled?: boolean;
  illumination_window_share?: boolean;
  heart_rate_enabled?: boolean;
  heart_rate_window_share?: boolean;
  heart_rate_buffer_seconds?: number;
  heart_rate_min_window_seconds?: number;
  heart_rate_roi?: 'forehead' | 'cheeks' | 'face';
  heart_rate_method?: 'pos' | 'green';
  heart_rate_target_fps?: number;
  heart_rate_min_confidence?: number;
  heart_rate_max_head_movement_deg?: number;
  heart_rate_anomaly_filter?: boolean;
  heart_rate_harmonic_fold?: boolean;
  heart_rate_fold_tolerance?: number;
  heart_rate_mad_h?: number;
  heart_rate_mad_floor_bpm?: number;
  heart_rate_confidence_weighted?: boolean;
  heart_rate_min_weight?: number;
  heart_rate_max_slew_bpm_per_s?: number;
  heart_rate_tracker_windows?: number;
  heart_rate_tracker_min_estimates?: number;
  heart_rate_tracker_reset_bpm?: number;
  heart_rate_tracker_reset_windows?: number;
  heart_rate_plausible_min_bpm?: number;
  heart_rate_plausible_max_bpm?: number;
  heart_rate_implausible_corroboration?: number;

  // Typing / composer analytics — keystroke timing on a host-registered
  // composer element (added in 3.1.0). Off by default like the other
  // opt-in modalities above: cost and host opt-in, not privacy.
  typing_enabled?: boolean;
  typing_pause_buckets?: number[];
  typing_burst_threshold_ms?: number;
  typing_max_intervals?: number;

  // Non-camera signal modalities orchestrated by `createSignalCapture`
  // (added in 3.1.0). Off by default: cost and host opt-in, not privacy.
  /** Page-wide pointer/click/scroll/selection/focus analytics. */
  interaction_enabled?: boolean;
  /** Per-sentence speech acts + text metrics on host-supplied message text. */
  discourse_enabled?: boolean;
  /** Host-reported AI suggestion cycle (request/shown/accept/reject/dismiss). */
  ai_assist_enabled?: boolean;
  /** Voice-turn analytics; condition 1 of the microphone activation gate. */
  voice_enabled?: boolean;

  [key: string]: unknown;
}

export const OYON_DEFAULT_SETTINGS: OyonSettings;
export const OYON_SETTINGS_PROFILES: Record<string, OyonSettings>;

export {
  OYON_VERSION,
  OYON_HOST_CONTRACT_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
  OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS,
} from './version';

export function createOyonSettings(input?: Partial<OyonSettings>): OyonSettings;
export function normalizeOyonSettings(input?: Partial<OyonSettings>): OyonSettings;
export function settingsSnapshot(s: OyonSettings): OyonSettings & { settings_hash: string };

export interface EmotionWindow {
  session_id?: string;
  window_start: string;
  window_end: string;
  window_start_ms?: number;
  window_end_ms?: number;
  duration_ms?: number;
  expected_samples?: number;
  dominant_emotion: string | null;
  probabilities: Record<string, number> | null;
  valence?: number | null;
  arousal?: number | null;
  confidence: number;
  entropy?: number | null;
  valid_frames: number;
  missing_face_ratio?: number;
  quality?: Record<string, unknown> | null;
  model_name?: string | null;
  model_version?: string | null;
  /** Optional engagement block; present only when `eye_tracking_enabled` is set. */
  engagement?: _EngagementWindow | null;
  /** Optional screen-point gaze block; present only when `gaze_tracking_enabled` is set
   *  AND calibration completed (when `gaze_calibration_required` is true). */
  gaze?: _GazeWindow | null;
  /** Optional facial-signals block (head pose + action units); present only
   *  when `facial_signals_enabled` is set. */
  facial?: FacialSignalWindow | null;
  /** Optional body-posture block; present only when `posture_tracking_enabled` is set. */
  posture?: PostureWindow | null;
  /** Optional respiration block; present only when `respiration_enabled` is set. */
  respiration?: Record<string, unknown>;
  /** Optional lighting-quality block; present unless `illumination_enabled` is false. */
  illumination?: Record<string, unknown>;
  /** Optional rPPG heart-rate block; present only when `heart_rate_enabled` is set. */
  heart_rate?: HeartRateWindow | null;
  /** Privacy-safe actual camera settings and decoded-frame timing. */
  capture_quality?: CameraDiagnostics | null;
  [key: string]: unknown;
}

export interface HeadPose {
  pitch_deg: number;
  yaw_deg: number;
  roll_deg: number;
  /** Row-major 3×3 rotation entries [r00,r01,r02,r10,r11,r12,r20,r21,r22]. */
  rotation: number[];
}

export interface FacialSignals {
  head_pose: HeadPose | null;
  facing_screen: boolean | null;
  action_units: Record<string, number>;
  blendshapes: Record<string, number>;
  valid: boolean;
  ts_ms: number;
}

export interface FacialSignalWindow {
  window_start: string;
  window_end: string;
  duration_ms: number;
  total_frames: number;
  valid_frames: number;
  valid_frame_ratio: number;
  head_pose_mean: { pitch_deg: number; yaw_deg: number; roll_deg: number } | null;
  head_pose_std: { pitch_deg: number; yaw_deg: number; roll_deg: number } | null;
  head_movement_deg: number | null;
  facing_screen_ratio: number | null;
  action_units_mean: Record<string, number> | null;
  blendshapes_mean: Record<string, number> | null;
  model_version: string;
}

export interface PostureFeatures {
  shoulder_tilt_deg: number | null;
  torso_lean_deg: number | null;
  head_lateral_norm: number | null;
  head_above_norm: number | null;
  shoulder_width_norm: number | null;
  upper_visibility: number | null;
  valid: boolean;
  ts_ms: number;
}

export interface PostureWindow {
  window_start: string;
  window_end: string;
  duration_ms: number;
  total_frames: number;
  valid_frames: number;
  valid_frame_ratio: number;
  postural_sway_deg: number | null;
  model_version: string;
  [metricMeanOrStd: string]: number | string | null;
}

export interface HeartRateEstimate {
  bpm: number;
  snr: number | null;
  confidence: number;
  fs: number;
  n_samples: number;
  /** Seconds of signal this BPM integrates over — it is not instantaneous. */
  window_seconds: number;
  /** POS projection window used, in samples (null for 'green' or a sub-window buffer). */
  pos_window_samples: number | null;
  method: 'pos' | 'green';
}

export interface HeartRateWindow {
  window_start: string;
  window_end: string;
  duration_ms: number;
  total_frames: number;
  valid_frames: number;
  valid_frame_ratio: number;
  bpm_mean: number | null;
  bpm_median: number | null;
  /** Anomaly-filtered central BPM within this window (fold octaves → Hampel/MAD → weighted mean). */
  bpm_robust: number | null;
  /** Cross-window slew-limited HR — the stable number to display. */
  bpm_tracked: number | null;
  /** True when the slew limit clamped this window's move (implausible inter-window flip). */
  slew_clamped?: boolean;
  bpm_std: number | null;
  bpm_last: number | null;
  /** Anomaly-filter accounting for bpm_robust. */
  anomaly?: {
    folded: number;
    dropped: number;
    kept: number;
    total: number;
    corrected_fraction: number;
  };
  snr_mean: number | null;
  confidence_mean: number | null;
  /** Integration window (s) of the last estimate — distinct from the emotion window. */
  analysis_window_seconds: number | null;
  /** How many independent (~1 Hz throttled) BPM estimates the mean averages. */
  distinct_estimates: number;
  method: 'pos' | 'green' | null;
  model_version: string;
}

export interface EyeSampleSnapshot {
  valid: boolean;
  smoothed: boolean;
  blink_l: boolean;
  blink_r: boolean;
  eye_openness_l: number | null;
  eye_openness_r: number | null;
  gaze_zone: string | null;
  ts_ms: number;
}

export interface HeartRateStatus {
  ready: boolean;
  progress: number;
  buffered_seconds: number;
  sample_rate_hz: number;
  reason: 'insufficient_samples' | 'insufficient_window' | 'low_sample_rate' | 'no_stable_rate' | null;
}

export interface EmotionRuntimeEvents {
  status: (payload: { state: string }) => void;
  error: (err: unknown) => void;
  window: (windows: EmotionWindow[]) => void;
  sample: (payload: {
    face?: unknown;
    prediction?: unknown;
    eye?: EyeSampleSnapshot | null;
    facial?: FacialSignals | null;
    posture?: PostureFeatures | null;
    heart_rate?: HeartRateEstimate | null;
    heart_rate_status?: HeartRateStatus | null;
    respiration?: RespirationEstimate | null;
    respiration_status?: ReturnType<RespirationEstimator['status']> | null;
    illumination?: unknown;
    durationMs?: number;
  }) => void;
}

export interface EmotionRuntimeOptions {
  sampleIntervalMs?: number;
  captureMode?: CaptureMode;
  consentVersion?: string;
  settings?: Partial<OyonSettings>;
  contextProvider?: () => Record<string, unknown>;
  camera?: CameraController;
  cameraOptions?: Record<string, unknown>;
  faceTracker?: MediaPipeFaceTracker;
  mediaPipe?: Record<string, unknown>;
  classifier?: OnnxEmotionClassifier;
  onnx?: Record<string, unknown>;
  aggregator?: EmotionAggregator;
  aggregation?: Record<string, unknown>;
  transport?: EmotionTransport;
  transportOptions?: Record<string, unknown>;
  logger?: OyonLogger;
  logTransports?: unknown[];
  metrics?: OyonMetricRecorder;
  metricTransports?: unknown[];
  dynamics?: DynamicalFeatureTracker;
  dynamicsOptions?: Record<string, unknown>;
  gaze?: Record<string, unknown>;
  gazeAdapter?: _WebEyeTrackAdapter | _WebGazerAdapter;
  webEyeTrackAdapter?: _WebEyeTrackAdapter;
  eyeExtractor?: { extract(face: unknown): unknown };
  eyeSmoother?: _EyeSmoother;
  engagementAggregator?: _EngagementAggregator;
  gazeSmoother?: _GazeSmoother;
  gazeAggregator?: _GazeAggregator;
  facialExtractor?: { extract(face: unknown): FacialSignals | null };
  facialAggregator?: FacialSignalAggregator;
  poseTracker?: MediaPipePoseTracker;
  pose?: Record<string, unknown>;
  postureExtractor?: { extract(pose: unknown): PostureFeatures | null };
  postureAggregator?: PostureAggregator;
  roiSampler?: (video: unknown, face: unknown) => { r: number; g: number; b: number } | null;
  heartRateEstimator?: HeartRateEstimator;
  heartRateAggregator?: HeartRateAggregator;
}

export class EmotionRuntime {
  constructor(options?: EmotionRuntimeOptions);
  options: EmotionRuntimeOptions;
  settings: OyonSettings;
  running: boolean;
  paused: boolean;
  initialized: boolean;
  eyeEnabled: boolean;
  gazeEnabled: boolean;
  gazeCalibrated: boolean;
  facialEnabled: boolean;
  postureEnabled: boolean;
  heartRateEnabled: boolean;
  on<K extends keyof EmotionRuntimeEvents>(type: K, handler: EmotionRuntimeEvents[K]): () => void;
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  flush(): Promise<void>;
  /** Drives WebEyeTrack calibration via the configured adapter.
   *  Returns `{ ok: false, reason: 'gaze_tracking_not_enabled' }` when off. */
  calibrateGaze(points: Array<{ x: number; y: number }>): Promise<
    | { ok: true; quality: number | null; confidence?: 'measured' | 'inferred' | 'unknown'; model: string }
    | { ok: false; reason: string; message?: string }
  >;
}

export class CameraController {
  constructor(options?: Record<string, unknown>);
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  start(): Promise<HTMLVideoElement>;
  stop(): void;
  getStream(): MediaStream | null;
  getVideoTrack(): MediaStreamTrack | null;
  getSettings(): Record<string, unknown> | null;
  getCapabilities(): Record<string, unknown> | null;
  getConstraints(): Record<string, unknown> | null;
  applyVideoConstraints(constraints?: MediaTrackConstraints): Promise<Record<string, unknown> | null>;
  getDiagnostics(options?: { resetWindow?: boolean }): CameraDiagnostics;
}

export interface CameraTimingSummary {
  frames_observed: number;
  estimated_dropped_frames: number;
  drop_ratio: number;
  /** selected_frame_rate is the bounded default; presented_frames is fallback. */
  drop_estimate_source: 'selected_frame_rate' | 'presented_frames';
  observed_fps: number | null;
  frame_interval_ms_mean: number | null;
  frame_interval_ms_std: number | null;
  max_frame_gap_ms: number | null;
  span_ms: number;
}

export interface CameraDiagnostics {
  available: boolean;
  settings: Record<string, unknown> | null;
  constraints: Record<string, unknown> | null;
  capabilities: Record<string, unknown> | null;
  timing: {
    source: 'requestVideoFrameCallback' | 'unavailable';
    window: CameraTimingSummary;
    lifetime: CameraTimingSummary;
    callback_age_ms: number | null;
    media_time_ms: number | null;
    presented_frames: number | null;
    frame_width: number | null;
    frame_height: number | null;
  };
}

export class MediaPipeFaceTracker {
  constructor(options?: Record<string, unknown>);
  init(): Promise<void>;
  analyze(video: HTMLVideoElement, timestampMs: number): Promise<unknown>;
}

export class OnnxEmotionClassifier {
  constructor(options?: Record<string, unknown>);
  init(): Promise<void>;
  classify(
    video: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    face?: { bbox?: { x: number; y: number; width: number; height: number }; landmarks?: unknown },
  ): Promise<{
    probabilities: Record<string, number>;
    confidence: number;
    entropy: number;
    valence: number | null;
    arousal: number | null;
    model: { name: string; version: string };
  }>;
}

export class EmotionAggregator {
  constructor(options?: { windowMs?: number; minValidFrames?: number; sampleIntervalMs?: number; labels?: string[] });
  addSample(sample: Record<string, unknown> & { timestamp: number; facePresent?: boolean; probabilities?: Record<string, number> | null }): EmotionWindow | null;
  flush(end?: number): EmotionWindow | null;
}

export class PredictionSmoother {
  constructor(options?: { alpha?: number });
  push(probabilities: Record<string, number>): Record<string, number>;
  reset(): void;
}

export interface EmotionTransport {
  send(windows: EmotionWindow[], ctx?: Record<string, unknown>): Promise<unknown>;
}

export interface EmotionBatchPayload {
  /** Optional for v2/legacy hosts; emitted by Oyon v3.0.3+ transports. */
  schema_version?: string;
  events: EmotionWindow[];
}

export interface EmotionBatchValidationResult {
  ok: boolean;
  errors: string[];
  /** Null means a legacy/unversioned payload. */
  schemaVersion: string | null;
}

export class HttpEmotionTransport implements EmotionTransport {
  constructor(options?: {
    baseUrl?: string;
    endpointForSession?: (sessionId: string) => string;
    tokenProvider?: () => string | null | Promise<string | null>;
    fetchImpl?: typeof fetch;
    validate?: boolean;
    validationOptions?: Record<string, unknown>;
  });
  send(windows: EmotionWindow[], ctx?: Record<string, unknown>): Promise<unknown>;
}

export class LocalEmotionTransport implements EmotionTransport {
  constructor(options?: { storageKey?: string; maxEvents?: number; storage?: Storage | null });
  send(windows: EmotionWindow[], ctx?: Record<string, unknown>): Promise<unknown>;
  read(): EmotionWindow[];
  drain(): EmotionWindow[];
  clear(): void;
}

export class FallbackEmotionTransport implements EmotionTransport {
  constructor(options: {
    transport: EmotionTransport;
    maxFailures?: number;
    retryOnce?: boolean;
    disabled?: boolean;
    onDrop?: (payload: unknown) => void;
    onDisabled?: (payload: unknown) => void;
    onRecovered?: () => void;
  });
  send(windows: EmotionWindow[], ctx?: Record<string, unknown>): Promise<unknown>;
  reset(): void;
  disable(error?: Error): void;
}

export interface OyonLogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  type: string;
  ts: number;
  context?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export class OyonLogger {
  constructor(options?: {
    contextProvider?: () => Record<string, unknown>;
    transports?: unknown[];
  });
  debug(type: string, data?: Record<string, unknown>): void;
  info(type: string, data?: Record<string, unknown>): void;
  warn(type: string, data?: Record<string, unknown>): void;
  error(type: string, data?: Record<string, unknown>): void;
}

export class LocalLogTransport {
  constructor(options?: { storageKey?: string; maxEntries?: number });
  send(event: OyonLogEvent): void;
  drain(): OyonLogEvent[];
  clear(): void;
}

export class HttpLogTransport {
  constructor(options?: { url: string; fetchImpl?: typeof fetch });
  send(event: OyonLogEvent): Promise<void>;
}

export function createLogEvent(input: Partial<OyonLogEvent>): OyonLogEvent;

export class OyonMetricRecorder {
  constructor(options?: {
    contextProvider?: () => Record<string, unknown>;
    transports?: unknown[];
  });
  record(name: string, value: number, tags?: Record<string, string>): void;
}

export class LocalMetricTransport {
  constructor(options?: { storageKey?: string; maxEntries?: number });
}

export class HttpMetricTransport {
  constructor(options?: { url: string; fetchImpl?: typeof fetch });
}

export class IndexedDbOyonStore {
  constructor(options?: { dbName?: string; storeName?: string });
  put(record: unknown): Promise<string>;
  getAll(): Promise<unknown[]>;
  clear(): Promise<void>;
}

export function oyonRecordId(): string;

export class DynamicalFeatureTracker {
  constructor(options?: Record<string, unknown>);
  ingest(window: EmotionWindow): void;
  snapshot(): Record<string, number>;
}

export function computeDynamicalFeatures(windows: EmotionWindow[], options?: Record<string, unknown>): Record<string, number>;
export function enrichWindowsWithDynamics(windows: EmotionWindow[], options?: Record<string, unknown>): EmotionWindow[];

export function defineEmotionCaptureElement(tagName?: string): void;

export interface OyonAttachmentOptions {
  /** Identity/context for every window. `session_id` (or `sessionId`) is
   *  required; all other keys are preserved as join keys. */
  getContext?: () => Record<string, unknown>;
  /** Ergonomic alias for `getContext`. */
  getSession?: () => Record<string, unknown>;
  getToken?: () => string | null | Promise<string | null>;
  apiBaseUrl?: string;
  consentProvider?: (ctx: Record<string, unknown>) => boolean | Promise<boolean>;
  runtimeOptions?: EmotionRuntimeOptions;
  transport?: EmotionTransport;
  transportOptions?: Record<string, unknown>;
  mount?: (runtime: EmotionRuntime) => void;
}

export interface OyonAttachment {
  runtime: EmotionRuntime;
  attach(): Promise<EmotionRuntime>;
  detach(): Promise<void>;
}

export function createOyonAttachment(options: OyonAttachmentOptions): OyonAttachment;
export function normalizeContext(ctx?: Record<string, unknown>): Record<string, unknown>;

export interface RohyFerAttachmentOptions {
  apiBaseUrl?: string;
  endpointForSession?: (ctx: Record<string, unknown>) => string;
  getSession?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  getToken?: () => string | null | Promise<string | null>;
  consentProvider?: () => boolean | Promise<boolean>;
  runtimeOptions?: EmotionRuntimeOptions;
  fetchImpl?: typeof fetch;
  mount?: (runtime: EmotionRuntime) => void;
  transport?: EmotionTransport;
}

export interface RohyFerAttachment {
  attach(): Promise<EmotionRuntime>;
  detach(): Promise<void>;
  getRuntime(): EmotionRuntime | null;
}

export function createRohyFerAttachment(options: RohyFerAttachmentOptions): RohyFerAttachment;

export interface OyonAddonOptions extends OyonAttachmentOptions {
  enabled: boolean;
  /** Opt into Rohy's addon endpoint + fixed-four-field session shape. */
  rohy?: boolean;
  disabledReason?: string;
  endpointForSession?: (sessionId: string) => string;
  maxSaveFailures?: number;
  retryOnce?: boolean;
  fetchImpl?: typeof fetch;
  attachmentFactory?: (options: OyonAttachmentOptions) => OyonAttachment;
  onUnavailable?: (err: unknown) => void;
  onError?: (err: unknown) => void;
  onStatus?: (payload: { state?: string }) => void;
  onWindow?: (events: EmotionWindow[]) => void;
  onDrop?: (info: unknown) => void;
  onRecovered?: () => void;
}

export interface OyonAddon {
  id: 'oyon';
  name: string;
  variant: 'oyon' | 'rohy';
  enabled: boolean;
  available: boolean;
  status: string;
  getStatus(): {
    enabled: boolean;
    available: boolean;
    status: string;
    variant?: string;
    reason?: string;
    error?: string | null;
  };
  start(): Promise<{ ok: boolean; reason?: string; runtime?: EmotionRuntime; error?: unknown }>;
  stop(): Promise<{ ok: boolean; noop?: boolean; error?: unknown }>;
  pause(): { ok: boolean; noop?: boolean; error?: unknown };
  resume(): { ok: boolean; noop?: boolean; error?: unknown };
  getRuntime(): EmotionRuntime | null;
}

export function createOyonAddon(options: OyonAddonOptions): OyonAddon;

export interface RohyOyonAddonOptions extends RohyFerAttachmentOptions {
  enabled: boolean;
  disabledReason?: string;
  onUnavailable?: (err: unknown) => void;
}

export interface RohyOyonAddon {
  id: 'oyon';
  name: string;
  enabled: boolean;
  available: boolean;
  reason?: string;
  status: 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'unavailable' | 'disabled';
  getStatus(): { enabled: boolean; available: boolean; status: string; reason?: string };
  start(): Promise<{ ok: boolean; reason?: string }>;
  stop(): Promise<{ ok: boolean; noop?: boolean }>;
  pause(): { ok: boolean; noop?: boolean };
  resume(): { ok: boolean; noop?: boolean };
  getRuntime(): EmotionRuntime | null;
}

export function createRohyOyonAddon(options: RohyOyonAddonOptions): RohyOyonAddon;
export function createNoopOyonAddon(reason?: string): RohyOyonAddon;

export function createStandaloneFerAttachment(options?: Record<string, unknown>): RohyFerAttachment;

export const ALLOWED_EMOTIONS: readonly string[];
export function validateEmotionBatch(
  payload: unknown,
  options?: { maxBatchEvents?: number; [key: string]: unknown },
): EmotionBatchValidationResult;

// ── Facial signals (head pose + action units) ───────────────────────
export function extractFacialSignals(faceResult: unknown, settings?: Partial<OyonSettings>): FacialSignals | null;
export function headPoseFromMatrix(matrix: Float32Array | number[]): HeadPose | null;
export function actionUnitsFromBlendshapes(
  blendshapes: Array<{ categoryName?: string; score?: number }>,
): { blendshapes: Record<string, number>; action_units: Record<string, number> };
export const ACTION_UNIT_MAP: Readonly<Record<string, string[]>>;

export class FacialSignalAggregator {
  constructor(options?: { windowMs?: number; sampleIntervalMs?: number });
  consumeFrame(sample: FacialSignals | null, timestamp?: number): FacialSignalWindow | null;
  flush(end?: number): FacialSignalWindow | null;
}

// ── Body posture ────────────────────────────────────────────────────
export class MediaPipePoseTracker {
  constructor(options?: Record<string, unknown>);
  init(): Promise<void>;
  analyze(video: HTMLVideoElement, timestampMs: number): Promise<unknown>;
}
export function extractPostureFeatures(poseResult: unknown, settings?: Partial<OyonSettings>): PostureFeatures | null;
export class PostureAggregator {
  constructor(options?: { windowMs?: number; sampleIntervalMs?: number });
  consumeFrame(sample: PostureFeatures | null, timestamp?: number): PostureWindow | null;
  flush(end?: number): PostureWindow | null;
}
export class MockPoseTracker {
  constructor(options?: { mockLandmarks?: unknown[]; posePresent?: boolean });
  setLandmarks(landmarks: unknown[] | null): void;
  init(): Promise<void>;
  analyze(): Promise<unknown>;
}
export function buildPoseLandmarks(overrides?: Record<number, unknown>): unknown[];

// ── Remote heart rate (rPPG) ────────────────────────────────────────
export class HeartRateEstimator {
  constructor(options?: {
    bufferSeconds?: number;
    method?: 'pos' | 'green';
    /** POS projection window in seconds (Wang et al. 2017; default 1.6). */
    posWindowSeconds?: number;
    minBpm?: number;
    maxBpm?: number;
    minSamples?: number;
    /** Hard floor below which aliased BPMs are rejected (default 8 Hz). */
    minSampleRateHz?: number;
    /** Minimum seconds of buffered signal before any BPM is emitted (default 8). */
    minWindowSeconds?: number;
    /** Minimum ms between recomputes; HR is throttled to ~this cadence (default 1000). */
    updateIntervalMs?: number;
    /** Drop estimates whose confidence is below this (default 0 = keep all). */
    minConfidence?: number;
  });
  reset(): void;
  addSample(rgb: { r: number; g: number; b: number }, ts?: number): void;
  /** Estimate over the rolling window, or null while acquiring / between throttled updates. */
  estimate(): HeartRateEstimate | null;
  /** Acquisition status without forcing a recompute. */
  status(): {
    ready: boolean;
    span_seconds: number;
    n_samples: number;
    progress: number;
    sample_rate_hz: number;
    minimum_sample_rate_hz: number;
    reason: 'insufficient_samples' | 'insufficient_window' | 'low_sample_rate' | null;
  };
}
export interface RobustBpmOptions {
  enabled?: boolean;
  fold?: boolean;
  foldTol?: number;
  madH?: number;
  madFloor?: number;
  weighted?: boolean;
  minWeight?: number;
  priorBpm?: number | null;
  maxJump?: number;
}
export interface RobustBpmResult {
  bpm: number | null;
  centre: number | null;
  folded: number;
  dropped: number;
  kept: number;
  total: number;
  corrected_fraction: number;
}
/** Anomaly-filtered central BPM (harmonic fold → Hampel/MAD gate → confidence-weighted mean). */
export function robustBpm(items: Array<{ bpm: number; weight?: number }>, options?: RobustBpmOptions): RobustBpmResult;

export class HeartRateAggregator {
  constructor(options?: { windowMs?: number; sampleIntervalMs?: number; robust?: RobustBpmOptions; maxSlewBpmPerS?: number; trackerWindows?: number; minEstimatesForAnchor?: number; resetBpm?: number; resetWindows?: number; plausibleMinBpm?: number; plausibleMaxBpm?: number; implausibleCorroboration?: number });
  consumeFrame(estimate: HeartRateEstimate | null, timestamp?: number): HeartRateWindow | null;
  flush(end?: number): HeartRateWindow | null;
}
export function sampleFaceRoiRgb(video: unknown, face: unknown, roi?: 'forehead' | 'cheeks' | 'face'): { r: number; g: number; b: number } | null;
export function faceRoiRect(bbox: { x: number; y: number; width: number; height: number }, roi: 'forehead' | 'cheeks' | 'face'): { x: number; y: number; w: number; h: number } | null;
export function posSignal(r: number[], g: number[], b: number[]): number[];
/** POS with Wang et al.'s (2017) sliding window + overlap-add; l = round(windowSeconds·fs). */
export function posSignalWindowed(r: ArrayLike<number>, g: ArrayLike<number>, b: ArrayLike<number>, fs: number, windowSeconds?: number): number[];
/** POS projection window length in samples: round(windowSeconds·fs), 0 if invalid. */
export function posWindowLength(fs: number, windowSeconds?: number): number;
export function detrend(x: number[]): number[];
export function movingAverageHighPass(x: number[], win: number): number[];
export function resampleUniform(times: number[], values: number[]): number[];
export function fftRadix2(re: Float64Array, im: Float64Array): void;
export function powerSpectrum(signal: ArrayLike<number>): Float64Array;
export function nextPow2(n: number): number;

/** Shares the ROI colour stream between consumers (heart rate + respiration)
 *  so the per-frame canvas read happens exactly once. */
export class HeartRateRoiSampler {
  constructor(options?: {
    getVideo?: () => unknown;
    sampleRoi?: (video: unknown, face: unknown) => { r: number; g: number; b: number } | null;
    estimator?: { addSample(rgb: { r: number; g: number; b: number }, ts?: number): void } | null;
    /** Additional consumers of the same samples. */
    estimators?: Array<{ addSample(rgb: { r: number; g: number; b: number }, ts?: number): void }>;
    targetFps?: number;
    maxFaceAgeMs?: number;
    onError?: (err: unknown) => void;
  });
  start(): void;
  stop(): void;
  updateFace(face: unknown, timestamp?: number): void;
  sampleOnce(timestamp?: number): boolean;
}

// ── Respiration (rPPG low band) ─────────────────────────────────────
export interface RespirationEstimate {
  brpm: number;
  snr: number | null;
  confidence: number;
  window_seconds: number;
  n_samples: number;
  fs: number;
  method: string;
  sampling_quality: {
    sample_rate_hz: number;
    median_sample_interval_ms: number | null;
    max_sample_gap_ms: number | null;
    adequate: boolean;
  };
  rgb_corroboration: {
    enabled: boolean;
    required: boolean;
    available: boolean;
    brpm: number | null;
    snr: number | null;
    confidence: number;
    delta_brpm: number | null;
    agrees: boolean;
    method: 'green-share-lowband';
  };
}
export class RespirationEstimator {
  constructor(options?: {
    /** Analysis window. Long by necessity: resolution is 1/T (default 45). */
    bufferSeconds?: number;
    /** Buffered signal required before any rate is emitted (default 25). */
    minWindowSeconds?: number;
    /** Minimum ms between recomputes (default 5000). */
    updateIntervalMs?: number;
    workingHz?: number;
    minConfidence?: number;
    rgbCorroboration?: boolean;
    requireRgbCorroboration?: boolean;
    rgbAgreementToleranceBrpm?: number;
    minimumSampleRateHz?: number;
    maxSampleGapMs?: number;
  });
  addSample(rgb: { r: number; g: number; b: number }, ts?: number): void;
  estimate(now?: number): RespirationEstimate | null;
  status(now?: number): {
    buffered_seconds: number;
    min_window_seconds: number;
    progress: number;
    ready: boolean;
    reason: 'acquiring' | 'ready' | 'low_sample_rate' | 'sample_gap';
    n_samples: number;
    sample_rate_hz: number;
    minimum_sample_rate_hz: number;
    median_sample_interval_ms: number | null;
    max_sample_gap_ms: number | null;
    maximum_sample_gap_ms: number;
    sampling_adequate: boolean;
    last_update_ms: number | null;
  };
  spanSeconds(): number;
  sampleRateHz(): number;
  reset(): void;
}
export class RespirationAggregator {
  constructor(options?: { windowMs?: number; sampleIntervalMs?: number });
  consumeFrame(estimate: RespirationEstimate | null, timestamp?: number): Record<string, unknown> | null;
  flush(end?: number): Record<string, unknown> | null;
}
export function meanDecimate(values: number[], factor: number): number[];
export const MIN_BRPM: number;
export const MAX_BRPM: number;

// ── Ambient illumination (signal-quality covariate) ──────────────────
export interface LumaStats {
  mean_luma: number;
  luma_std: number;
  clipped_low: number;
  clipped_high: number;
}
export type IlluminationAssessment = 'good' | 'dim' | 'bright' | 'backlit' | 'unstable';
export class IlluminationEstimator {
  constructor(options?: { sampler?: ((video: unknown) => LumaStats | null) | null });
  estimate(video: unknown): (LumaStats & {
    luma_delta: number;
    quality: number;
    assessment: IlluminationAssessment;
    valid: boolean;
    ts_ms: number;
  }) | null;
  reset(): void;
}
export class IlluminationAggregator {
  constructor(options?: { windowMs?: number; sampleIntervalMs?: number; deltaFloor?: number });
  consumeFrame(sample: unknown, timestamp?: number): Record<string, unknown> | null;
  flush(end?: number): Record<string, unknown> | null;
}
export function lumaStats(rgba: ArrayLike<number>): LumaStats | null;
export function illuminationQuality(stats: Pick<LumaStats, 'mean_luma' | 'clipped_low' | 'clipped_high'>): number;
export function illuminationAssessment(
  stats: Pick<LumaStats, 'mean_luma' | 'clipped_low' | 'clipped_high'>,
  stability?: number,
): IlluminationAssessment;
export function sampleFrameLuma(video: unknown, canvas?: unknown): LumaStats | null;

export const ONNX_RUNTIME_WASM_CDN: string;
export const MEDIAPIPE_TASKS_WASM_CDN: string;
export const MEDIAPIPE_FACE_LANDMARKER_URL: string;
export const MEDIAPIPE_POSE_LANDMARKER_LITE_URL: string;
export const MEDIAPIPE_POSE_LANDMARKER_FULL_URL: string;
export const MEDIAPIPE_POSE_LANDMARKER_HEAVY_URL: string;
export function poseLandmarkerUrlForModel(model: 'lite' | 'full' | 'heavy'): string;
export const EMOTION_MODEL_HSE_B0_URL: string;
export const EMOTION_MODEL_MOBILEVIT_MTL_URL: string;
export const EMOTION_MODEL_MOBILEFACENET_MTL_URL: string;
export const DEFAULT_EMOTION_MODEL_URL: string;

export const SELF_HOSTED_ONNX_RUNTIME_WASM: string;
export const SELF_HOSTED_MEDIAPIPE_TASKS_WASM: string;
export const SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL: string;
export const SELF_HOSTED_EMOTION_MODEL_HSE_B0_URL: string;
export const SELF_HOSTED_EMOTION_MODEL_MOBILEVIT_MTL_URL: string;
export const SELF_HOSTED_EMOTION_MODEL_MOBILEFACENET_MTL_URL: string;
export const SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL: string;
export const SELF_HOSTED_DEFAULTS: Readonly<{
  ONNX_RUNTIME_WASM_CDN: string;
  MEDIAPIPE_TASKS_WASM_CDN: string;
  MEDIAPIPE_FACE_LANDMARKER_URL: string;
  EMOTION_MODEL_HSE_B0_URL: string;
  EMOTION_MODEL_MOBILEVIT_MTL_URL: string;
  EMOTION_MODEL_MOBILEFACENET_MTL_URL: string;
  DEFAULT_EMOTION_MODEL_URL: string;
}>;

export const OPENVINO_RETAIL_0003_CONFIG: Record<string, unknown>;
export const EMOTIEFF_MOBILEVIT_MTL_CONFIG: Record<string, unknown>;
export const EMOTIEFF_MBF_MTL_CONFIG: Record<string, unknown>;
export const HSE_EMOTION_MTL_CONFIG: Record<string, unknown>;

export class MockFaceTracker extends MediaPipeFaceTracker {}
export class MockEmotionClassifier extends OnnxEmotionClassifier {}
