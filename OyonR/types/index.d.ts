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
  TypingContentEditableElement,
  TypingContentEditableAdapterOptions,
  EditablePosition,
  TypingTextCounters,
  TypingReportedEdit,
  TypingReportedSelection,
  TypingEditReporterOptions,
  TypingEditReporter,
  TypingEpisodeRecord,
  TypingAggregateSummary,
  TypingSummaryRow,
  TypingSummaryMeasureKind,
  TypingSummaryComparisonRow,
} from './typing';

export {
  TypingAggregator,
  createTypingComposerAdapter,
  createTypingContentEditableAdapter,
  readEditableText,
  createTypingEditReporter,
  classifyBoundaryContext,
  createTextCounters,
  countGraphemes,
  countTypingWords,
  BOUNDARY_CONTEXTS,
  BOUNDARY_CONTEXT_WINDOW,
  aggregateTypingEpisodes,
  summarizeTypingBy,
  compareTypingSummaries,
  episodeCharsPerMin,
  pauseBucketLabel,
  PAUSE_LOCATION_ORDER,
  TYPING_SUMMARY_MEASURES,
} from './typing';

export type {
  HostRecordKind,
  HostRecordsInput,
  HostRecordCounts,
  RefusedHostRecord,
  ValidatedHostRecords,
  RecordScopeName,
  ScopeRecordsOptions,
  LogEventMappingRule,
  RecordSummaryRow,
  RecordLevel,
  LogRowKind,
  LogRow,
  LogRecordsInput,
  LogRowSummary,
} from './records';

export {
  HOST_RECORD_KINDS,
  validateHostRecords,
  scopeRecords,
  countScopedRecords,
  listScopedSessions,
  listScopedPeople,
  recordSessionId,
  recordUserId,
  recordGroupId,
  recordContextId,
  recordUserLabel,
  mapLogEventsToSignalEvents,
  summarizeRecordsBy,
  recordKindsOf,
  listRecordLevels,
  recordLevelValue,
  RECORD_LEVELS,
  LOG_ROW_KINDS,
  toLogRows,
  summarizeLogRows,
  flattenLogRecord,
  joinRawParts,
} from './records';

export type {
  DocumentEditState,
  CodeRunState,
  HostActTrackerOptions,
  HostActEvent,
  DocumentEditDescriptor,
  DocumentEditTracker,
  CodeRunDescriptor,
  CodeRunTracker,
} from './host-acts';

export { createDocumentEditTracker, createCodeRunTracker } from './host-acts';

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

  // Group work (docs/GROUP_SYNCHRONY.md).
  /** Group-time epoch ms; window k covers [anchor + k·W, anchor + (k+1)·W) for every member. null = free-running. */
  window_anchor_ms?: number | null;
  /** Group hub `/clock` URL ({ ts_ms }); when set the runtime runs a GroupSessionClock and stamps ts_group_ms. */
  group_clock_url?: string | null;
  /** Re-run the clock handshake this often (ms, 5000–3600000; default 60000). */
  group_clock_resync_ms?: number;
  /** One camera, several people (MultiFaceCapture). */
  multi_face_max_faces?: number;
  multi_face_iou_gate?: number;
  multi_face_confirm_hits?: number;
  multi_face_coast_ms?: number;
  /**
   * Byte budget of one window-batch POST (16 KiB–64 MiB; default 245760 = 240 KiB).
   * Larger batches are split into several POSTs and an oversized window's
   * raw_streams into raw-only continuation parts — nothing is cut.
   */
  transport_max_post_bytes?: number;

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
  /** Host-reported document edits (events only; added in 3.6.0). */
  document_edit_enabled?: boolean;
  /** Host-reported code runs (events only; added in 3.6.0). */
  code_run_enabled?: boolean;

  [key: string]: unknown;
}

export const OYON_DEFAULT_SETTINGS: OyonSettings;
export const OYON_SETTINGS_PROFILES: Record<string, OyonSettings>;

export {
  OYON_VERSION,
  OYON_HOST_CONTRACT_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
  OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS,
  OYON_DOCUMENT_EDIT_STATES,
  OYON_DOCUMENT_EDIT_STATES_VERSION,
  OYON_CODE_RUN_STATES,
  OYON_CODE_RUN_STATES_VERSION,
} from './version';

export function createOyonSettings(input?: Partial<OyonSettings>): OyonSettings;
export function normalizeOyonSettings(input?: Partial<OyonSettings>): OyonSettings;
export function settingsSnapshot(s: OyonSettings): OyonSettings & { settings_hash: string };

export interface EmotionWindow {
  session_id?: string;
  /** Who the window belongs to; `user_label` is a display name. */
  user_id?: string;
  user_label?: string;
  /** The group the person works in (optional; 3.6.0). Required by `oyon/group`. */
  group_id?: string;
  /** The person's id inside the group; required by `oyon/group` (assigned by the study, never a face). */
  member_id?: string;
  /** Optional seat / role label inside the group (e.g. 'left', 'tutor'). */
  seat?: string;
  /** Group-clock alignment (present when a group clock or window anchor is configured). */
  clock_offset_ms?: number | null;
  clock_rtt_ms?: number | null;
  clock_source?: 'handshake' | 'marker' | null;
  window_anchor_ms?: number | null;
  window_start_group_ms?: number | null;
  window_end_group_ms?: number | null;
  /** Per-sample series recorded since the previous window (RawStreamRecorder). */
  raw_streams?: RawStreams | null;
  /** Present when the window was split across POSTs (see `chunkWindowBatch`, `joinRawParts`). */
  raw_part?: RawPart;
  /** Anchored windows: the group-grid index k (window k covers [anchor + kW, anchor + (k+1)W)). */
  window_index?: number;
  /** Anchored windows: how far the local anchor moved (clock re-sync) while this window was open; 0 = none. */
  anchor_correction_ms?: number;
  /** Anchored windows: how far the start was moved past the grid start so it does not overlap the previous window. */
  window_clipped_ms?: number;
  /** The document, case, conversation or task the work belongs to (optional; 3.6.0). */
  context_id?: string;
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

/** One columnar raw stream: `fields[0]` is 'ts_ms', `fields[1]` 'ts_group_ms'. */
export interface RawStreamBlock {
  fields: string[];
  rows: Array<Array<number | string | null>>;
  /** Legacy (Oyon ≤ 3.5.10): rows a capped recorder did not keep. The recorder is lossless now and never sets it. */
  dropped_rows?: number;
}

/** Which part of a window split across POSTs an event is (`chunkWindowBatch`); rebuild with `joinRawParts`. */
export interface RawPart {
  /** Shared by every part of one window. */
  id: string;
  /** 0 = the window itself; 1.. = raw-only continuation parts. */
  index: number;
  count: number;
  /** Set by `joinRawParts`: how many parts were found and joined. */
  joined?: number;
}
/** Streams the runtime records: affect, eye, head, au, blendshapes, posture, heart_rate, respiration, illumination, screen_gaze. */
export type RawStreams = Record<string, RawStreamBlock>;

export const RAW_STREAM_FIELDS: Readonly<Record<string, readonly string[]>>;
/**
 * Lossless per-sample recorder. `maxRowsPerStream` is when `onFull` fires (the
 * runtime then sends a raw-only envelope early), never a cut.
 */
export class RawStreamRecorder {
  constructor(options?: {
    clock?: { toGroupTime(ms: number): number | null } | null;
    maxRowsPerStream?: number;
    onFull?: (stream: string) => void;
  });
  record(stream: string, tsMs: number, values: Record<string, unknown>): void;
  readonly pending: boolean;
  /** Rows held in the largest stream. */
  readonly maxRows: number;
  /** All rows, or those before `before` (`inclusive`: also those at it); later rows stay. */
  drain(options?: { before?: number; inclusive?: boolean }): RawStreams | null;
}

/** A raw-only event (`modality: 'raw'`) around rows no window carries; null when there are none. */
export function rawOnlyEnvelope(rawStreams: RawStreams | null, reason: string): {
  modality: 'raw';
  window_kind: 'interval';
  window_start: string;
  window_end: string;
  raw_reason: string;
  raw_streams: RawStreams;
} | null;

/**
 * Split a window batch into POST bodies of at most `maxBytes` UTF-8 bytes,
 * losslessly: an oversized window's raw rows continue in raw-only parts that
 * share `raw_part.id`. Throws when an event cannot be brought under the budget.
 */
export const DEFAULT_MAX_POST_BYTES: number;
export function chunkWindowBatch<T extends Record<string, unknown>>(events: T[], options?: {
  maxBytes?: number;
  schemaVersion?: string;
  maxEvents?: number;
  maxRawStreamBytes?: number;
  /** Part-group id of an oversized event; default `rawPartId(event)` (deterministic). */
  newId?: (event: T) => string;
}): Array<Array<T | Record<string, unknown>>>;
/** Deterministic `raw_part.id` of a window: `rp-` + 16 hex chars from its identity and span. */
export function rawPartId(event: Record<string, unknown>): string;

export interface GroupClockSnapshot {
  clock_offset_ms: number | null;
  clock_rtt_ms: number | null;
  clock_source: 'handshake' | 'marker' | null;
  clock_synced_at_ms: number | null;
  clock_sync_failures: number;
}
export function estimateClockOffset(
  samples: Array<{ t0: number; ts: number; t1: number }>,
): { offset_ms: number; rtt_ms: number; n: number } | null;
export function httpClockSource(url: string, fetchImpl?: typeof fetch): () => Promise<number>;
export class GroupSessionClock {
  constructor(options?: {
    getServerTime?: () => Promise<number>;
    resyncMs?: number;
    probes?: number;
    now?: () => number;
    timers?: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void };
    onSync?: (snapshot: GroupClockSnapshot) => void;
    onError?: (error: Error) => void;
  });
  readonly synced: boolean;
  offsetMs: number | null;
  rttMs: number | null;
  sync(): Promise<GroupClockSnapshot>;
  markSync(marker: { group_ms: number; local_ms?: number }): GroupClockSnapshot;
  start(): Promise<GroupClockSnapshot>;
  stop(): void;
  toGroupTime(localMs: number): number | null;
  toLocalTime(groupMs: number): number | null;
  snapshot(): GroupClockSnapshot;
}

export function iou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number;
export interface FaceTrackRow {
  track_id: string;
  status: 'tentative' | 'confirmed';
  seat: string | null;
  born_ms: number;
  last_seen_ms: number;
  frames: number;
}
export class FaceTrackAssigner {
  constructor(options?: { maxFaces?: number; iouGate?: number; confirmHits?: number; coastMs?: number; prefix?: string });
  update(faces: Array<{ bbox: { x: number; y: number; width: number; height: number } }>, ts: number): Array<{
    track_id: string; status: 'tentative' | 'confirmed'; seat: string | null; face: unknown; iou: number | null;
  }>;
  seats(): Record<string, string>;
  status(): FaceTrackRow[];
  retired: Array<{ track_id: string; born_ms: number; last_seen_ms: number; confirmed: boolean }>;
}
export class MultiFaceCapture {
  constructor(options?: {
    settings?: Partial<OyonSettings>;
    camera?: unknown; faceTracker?: unknown; classifier?: unknown; transport?: EmotionTransport;
    groupClock?: GroupSessionClock; assigner?: FaceTrackAssigner;
    contextProvider?: () => Record<string, unknown>;
    memberMap?: Record<string, string> | ((trackId: string) => string);
    cameraOptions?: Record<string, unknown>; mediaPipe?: Record<string, unknown>; onnx?: Record<string, unknown>;
    transportOptions?: Record<string, unknown>;
  });
  settings: OyonSettings;
  on(type: 'window' | 'tracks' | 'status' | 'error', handler: (payload: any) => void): () => void;
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  sampleOnce(): Promise<void>;
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
  /** True on ticks where the head-motion gate paused ROI sampling (report only). */
  motion_paused?: boolean;
}

export interface EmotionRuntimeEvents {
  /** Capture lifecycle only (idle → running → paused → stopped). Sub-system
   *  progress (e.g. gaze calibration) never arrives here. */
  status: (payload: { state: string }) => void;
  /** Gaze-calibration progress — deliberately separate from `status` so
   *  lifecycle reducers can't mistake a calibration note for capture ending. */
  'gaze-calibration': (payload: {
    state: 'calibrating' | 'calibrated' | 'calibration_failed';
    confidence?: 'measured' | 'inferred' | 'unknown';
    reason?: string;
  }) => void;
  error: (err: unknown) => void;
  window: (windows: EmotionWindow[]) => void;
  sample: (payload: {
    /** Local epoch ms of the tick, and its group-clock time (null without a synced clock). */
    ts_ms?: number;
    ts_group_ms?: number | null;
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
  /** Group clock (else built from settings.group_clock_url). */
  groupClock?: GroupSessionClock;
  /** Raw per-sample stream recorder (default: a RawStreamRecorder on the group clock). */
  rawStreams?: RawStreamRecorder;
}

export class EmotionRuntime {
  constructor(options?: EmotionRuntimeOptions);
  /** Push a host-supplied per-sample value (e.g. VAD speaking state) into raw_streams. */
  recordHostSample(stream: string, values: Record<string, number | string | boolean | null>, tsMs?: number): boolean;
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

export interface OnnxEmotionClassifierOptions {
  /** Model weights: a URL (absolute or same-origin path) or the raw bytes. */
  modelUrl?: string | ArrayBuffer | ArrayBufferView;
  /** Extra URLs tried in order when `modelUrl` fails (non-2xx or network error). */
  modelFallbackUrls?: string[];
  /**
   * Cache API bucket that keeps downloaded weights across page loads
   * (default `'oyon-models-v1'`) so a model is fetched once per browser
   * rather than on every reload. `false` disables.
   */
  modelCache?: string | false;
  /** Directory of the ONNX Runtime WASM files (default: pinned jsDelivr URL). */
  wasmPaths?: string;
  executionProviders?: string[] | null;
  labels?: string[];
  inputSize?: number;
  inputName?: string;
  outputName?: string | null;
  inputScale?: number;
  inputChannels?: number;
  colorOrder?: 'RGB' | 'BGR';
  mean?: number[];
  std?: number[];
  emotionOffset?: number;
  valenceIndex?: number | null;
  arousalIndex?: number | null;
  modelName?: string;
  modelVersion?: string;
  /** Test hook: a pre-loaded `onnxruntime-web` module instead of the dynamic import. */
  ortModule?: unknown;
  [key: string]: unknown;
}

export class OnnxEmotionClassifier {
  constructor(options?: OnnxEmotionClassifierOptions);
  /** URL the loaded weights came from (`'bytes'` when `modelUrl` was a buffer); `null` before `init()`. */
  modelSource: string | null;
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
    /** Byte budget per POST (default 245760); see `chunkWindowBatch`. */
    maxPostBytes?: number;
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

/** One `oyon-log-v1` event, as OyonLogger writes it and a host feeds it back as `logEvents`. */
export interface OyonLogEvent {
  schema_version: 'oyon-log-v1';
  /** ISO 8601. */
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  event_name: string;
  /** Who and where: session_id, user_id, … from the logger's contextProvider. */
  context: Record<string, unknown>;
  /** Raw-media keys (frame, image, landmarks, …) are replaced by '[forbidden]'. */
  details: Record<string, unknown>;
}

/** One `oyon-metric-v1` numeric metric, as OyonMetricRecorder writes it. */
export interface OyonMetric {
  schema_version: 'oyon-metric-v1';
  /** ISO 8601. */
  timestamp: string;
  source: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string | null;
  context: Record<string, unknown>;
  tags: Record<string, unknown>;
}

export interface OyonLogTransportLike {
  sendLogs(events: OyonLogEvent[], context?: Record<string, unknown>): void | Promise<void>;
}
export interface OyonMetricTransportLike {
  sendMetrics(metrics: OyonMetric[], context?: Record<string, unknown>): void | Promise<void>;
}

export class OyonLogger {
  constructor(options?: {
    /** Default 'oyon'. */
    source?: string;
    /** In-memory ring size; default 1000. */
    maxEvents?: number;
    clock?: () => Date;
    contextProvider?: () => Record<string, unknown>;
    transports?: OyonLogTransportLike[];
    /** Called on every failed transport write (the events are kept and retried). */
    onTransportError?: (info: OyonDeliveryError) => void;
    /** Events held per transport while it fails; default 100000 (the oldest beyond it are counted in `lost`). */
    maxPending?: number;
  });
  debug(eventName: string, details?: Record<string, unknown>, context?: Record<string, unknown>): OyonLogEvent;
  info(eventName: string, details?: Record<string, unknown>, context?: Record<string, unknown>): OyonLogEvent;
  warn(eventName: string, details?: Record<string, unknown>, context?: Record<string, unknown>): OyonLogEvent;
  error(eventName: string, errorOrDetails?: Error | Record<string, unknown>, context?: Record<string, unknown>): OyonLogEvent;
  log(level: OyonLogEvent['level'], eventName: string, details?: Record<string, unknown>, context?: Record<string, unknown>): OyonLogEvent;
  /** The in-memory events, oldest first. */
  read(): OyonLogEvent[];
  clear(): void;
  /** Retry every event a transport has not written yet. */
  flush(): Promise<void>;
  /** Per transport: events waiting, failed writes, events lost, last error. */
  deliveryStatus(): OyonDeliveryStatus[];
}

/** What a logger / metric recorder reports when a transport write fails. */
export interface OyonDeliveryError {
  error: unknown;
  transport: unknown;
  /** Records now waiting for that transport. */
  pending: number;
  failures: number;
  lost: number;
}

export interface OyonDeliveryStatus {
  index: number;
  transport: string;
  pending: number;
  failures: number;
  lost: number;
  last_error: string | null;
}

/** Keeps the last `maxEvents` log events in localStorage (in memory without it). */
export class LocalLogTransport implements OyonLogTransportLike {
  constructor(options?: { storageKey?: string; maxEvents?: number; storage?: Storage | null });
  sendLogs(events: OyonLogEvent[]): void;
  read(): OyonLogEvent[];
  clear(): void;
}

/** POSTs `{ events }` to `endpoint` (default '/api/oyon/logs'). */
export class HttpLogTransport implements OyonLogTransportLike {
  constructor(options?: { endpoint?: string; tokenProvider?: () => string | null; fetchImpl?: typeof fetch });
  sendLogs(events: OyonLogEvent[]): Promise<void>;
}

export function createLogEvent(input: {
  level?: string;
  event_name: string;
  /** Default 'oyon'. */
  source?: string;
  /** ISO time; default now. */
  timestamp?: string;
  context?: Record<string, unknown>;
  details?: Record<string, unknown>;
}): OyonLogEvent;

export class OyonMetricRecorder {
  constructor(options?: {
    source?: string;
    /** In-memory ring size; default 2000. */
    maxMetrics?: number;
    clock?: () => Date;
    contextProvider?: () => Record<string, unknown>;
    transports?: OyonMetricTransportLike[];
    /** Called on every failed transport write (the metrics are kept and retried). */
    onTransportError?: (info: OyonDeliveryError) => void;
    maxPending?: number;
  });
  /** Null (nothing recorded) when the value is not finite. */
  record(
    metricName: string,
    metricValue: number,
    options?: { unit?: string; context?: Record<string, unknown>; tags?: Record<string, unknown> },
  ): OyonMetric | null;
  read(): OyonMetric[];
  clear(): void;
  /** Retry every metric a transport has not written yet. */
  flush(): Promise<void>;
  deliveryStatus(): OyonDeliveryStatus[];
}

/** Keeps the last `maxMetrics` metrics in localStorage (in memory without it). */
export class LocalMetricTransport implements OyonMetricTransportLike {
  constructor(options?: { storageKey?: string; maxMetrics?: number; storage?: Storage | null });
  sendMetrics(metrics: OyonMetric[]): void;
  read(): OyonMetric[];
  clear(): void;
}

/** POSTs `{ metrics }` to `endpoint` (default '/api/oyon/metrics'). */
export class HttpMetricTransport implements OyonMetricTransportLike {
  constructor(options?: { endpoint?: string; tokenProvider?: () => string | null; fetchImpl?: typeof fetch });
  sendMetrics(metrics: OyonMetric[]): Promise<void>;
}

/** Where an IndexedDB transport writes: an open store, or a database name (default 'oyon'). */
export interface IndexedDbTransportOptions {
  /** Default: the store shared by every transport on `dbName` (one connection). */
  store?: {
    put(storeName: string, record: unknown): Promise<unknown>;
    getAll(storeName: string): Promise<unknown[]>;
    clear(storeName: string): Promise<unknown>;
    bulkPut?(storeName: string, records: unknown[]): Promise<unknown>;
    getAllAbove?(storeName: string, indexName: string, lower: unknown, options?: { inclusive?: boolean }): Promise<unknown[]>;
  };
  dbName?: string;
}

/** Read options of the IndexedDB transports. */
export interface IndexedDbReadOptions {
  /** ISO timestamp: only entries at or after it (inclusive — merge by key). */
  since?: string;
}

/** The IndexedDbOyonStore shared by every transport on one database. */
export function sharedOyonStore(dbName?: string): IndexedDbOyonStore;

/**
 * Keeps EVERY log event in IndexedDB (`runtime_events`), uncapped, beside the
 * windows and events. Adds an `event_id` key when an event has none.
 */
export class IndexedDbLogTransport implements OyonLogTransportLike {
  constructor(options?: IndexedDbTransportOptions);
  sendLogs(events: OyonLogEvent[]): Promise<void>;
  /** Stored events, oldest first; `since` reads only the newer ones. */
  read(options?: IndexedDbReadOptions): Promise<Array<OyonLogEvent & { event_id: string }>>;
  clear(): Promise<void>;
}

/** Keeps EVERY metric in IndexedDB (`metrics`), uncapped. Adds a `metric_id` key when a metric has none. */
export class IndexedDbMetricTransport implements OyonMetricTransportLike {
  constructor(options?: IndexedDbTransportOptions);
  sendMetrics(metrics: OyonMetric[]): Promise<void>;
  /** Stored metrics, oldest first; `since` reads only the newer ones. */
  read(options?: IndexedDbReadOptions): Promise<Array<OyonMetric & { metric_id: string }>>;
  clear(): Promise<void>;
}

/** Oyon's IndexedDB database; every call names the object store. */
export type OyonStoreName =
  | 'captures' | 'emotion_windows' | 'signal_windows' | 'signal_events'
  | 'runtime_events' | 'metrics' | 'settings_profiles' | 'consents' | 'dynamics';
export class IndexedDbOyonStore {
  constructor(options?: { dbName?: string; dbVersion?: number; indexedDB?: IDBFactory | null; IDBKeyRange?: typeof IDBKeyRange });
  init(): Promise<IDBDatabase>;
  put(storeName: OyonStoreName, record: unknown): Promise<IDBValidKey>;
  add(storeName: OyonStoreName, record: unknown): Promise<IDBValidKey>;
  bulkAdd(storeName: OyonStoreName, records: unknown[]): Promise<IDBValidKey[]>;
  /** One transaction: all written, or none. */
  bulkPut(storeName: OyonStoreName, records: unknown[]): Promise<IDBValidKey[]>;
  /** `limit`: the last n records. */
  getAll(storeName: OyonStoreName, options?: { limit?: number }): Promise<unknown[]>;
  /** Records whose index value is above `lower` (at or above with `inclusive`). */
  getAllAbove(storeName: OyonStoreName, indexName: string, lower: IDBValidKey, options?: { inclusive?: boolean }): Promise<unknown[]>;
  clear(storeName: OyonStoreName): Promise<void>;
}

export function oyonRecordId(prefix?: string): string;

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
  options?: { maxBatchEvents?: number; maxRawStreamBytes?: number; [key: string]: unknown },
): EmotionBatchValidationResult;
/** Shape/size check of a window's `raw_streams` (transport bounds, never a signal gate). */
export function validateRawStreamsBlock(
  rawStreams: unknown,
  prefix: string,
  errors: string[],
  options?: { maxRawStreamBytes?: number },
): void;
/** Shape of `raw_part: { id, index, count }` on a split window's parts (pushes onto `errors`). */
export function validateRawPart(part: unknown, path: string, errors: string[]): void;

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

export {
  WRITING_ORIGINS,
  writingOrigin,
  writingActs,
  summarizeWriting,
  summarizeWritingBy,
  writingTimeline,
  writingByDayAndPerson,
  WRITING_ACTS,
  WRITING_PAUSE_MS,
  writingActOf,
  writingActSequences,
  writingActEvents,
  summarizeWritingActs,
} from './writing';
export type {
  WritingActName,
  WritingOrigin,
  WritingAct,
  WritingSummary,
  WritingSummaryRow,
  WritingOriginSummary,
  WritingTimelinePoint,
  WritingByDayAndPerson,
  WritingDayPersonCell,
} from './writing';
