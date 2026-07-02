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

  [key: string]: unknown;
}

export const OYON_DEFAULT_SETTINGS: OyonSettings;
export const OYON_SETTINGS_PROFILES: Record<string, OyonSettings>;

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
  [key: string]: unknown;
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

export interface EmotionRuntimeEvents {
  status: (payload: { state: string }) => void;
  error: (err: unknown) => void;
  window: (windows: EmotionWindow[]) => void;
  sample: (payload: {
    face?: unknown;
    prediction?: unknown;
    eye?: EyeSampleSnapshot | null;
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
export function validateEmotionBatch(payload: unknown): { ok: boolean; errors: string[] };

export const ONNX_RUNTIME_WASM_CDN: string;
export const MEDIAPIPE_TASKS_WASM_CDN: string;
export const MEDIAPIPE_FACE_LANDMARKER_URL: string;
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
