// Type declarations for the Oyon voice subpaths:
//   oyon/voice            → src/aggregation/VoiceTurnAggregator.js
//   oyon/voice/controller → src/capture/VoiceTurnController.js
//   oyon/voice-features   → src/analytics/voiceFeatures.js
//   oyon/voice/worker     → src/inference/WorkerVoiceAnalyzer.js
// Hand-written; consult the JSDoc in those modules for authoritative shapes.
// See audio_text.md §5 (voice pipeline), §5.2 (thread split), and §5.6
// (`voice-v1` profile).

// ─────────────────────────────────────────────────────────────────────────────
// DSP surface (oyon/voice-features — src/analytics/voiceFeatures.js + pitch.js)
// ─────────────────────────────────────────────────────────────────────────────

/** Samples at or beyond this magnitude count as clipped (0.999). */
export declare const CLIP_THRESHOLD: number;

/**
 * Symmetric Hann window of length n. Cached per length — repeat calls return
 * the SAME Float64Array instance; treat it as read-only.
 */
export declare function hannWindow(n: number): Float64Array;

/** Element-wise product of a frame and a same-length window (new array). */
export declare function applyWindow(
  frame: ArrayLike<number>,
  window: ArrayLike<number>,
): Float64Array;

/**
 * Time-domain energy of one frame. Samples are nominally in [-1, 1] (Web
 * Audio float PCM). All-zero result for an empty frame — never NaN.
 */
export declare function frameEnergy(frame: ArrayLike<number>): {
  rms: number;
  peak: number;
  clippedSamples: number;
  zeroCrossingRate: number;
};

/**
 * Spectral centroid and roll-off of one frame. Both are `null` (not NaN, not
 * 0) for a silent or sub-2-sample frame — a frame with no power has no
 * spectral shape, and downstream statistics exclude nulls.
 */
export declare function spectralFeatures(
  frame: ArrayLike<number>,
  sampleRate: number,
  options?: { rolloffFraction?: number },
): {
  centroidHz: number | null;
  rolloffHz: number | null;
  /** One-sided power spectrum of the windowed frame (research-grade: exposed, not withheld). */
  spectrum: Float64Array;
};

/**
 * NSDF (normalized square difference) curve, lags 0..maxLag — the raw curve
 * behind `estimateF0`, exposed per the record-everything data policy.
 */
export declare function computeNsdf(frame: ArrayLike<number>, maxLag: number): Float64Array;

/**
 * McLeod/NSDF F0 estimate for one frame. `f0Hz` is `null` — never 0 — on an
 * unvoiced frame; `confidence` is the NSDF peak value clamped to [0, 1].
 */
export declare function estimateF0(
  frame: ArrayLike<number>,
  sampleRate: number,
  options?: {
    minHz?: number;
    maxHz?: number;
    clarityThreshold?: number;
    peakSelectionRatio?: number;
  },
): { f0Hz: number | null; confidence: number; voiced: boolean };

/**
 * Full per-frame analysis (energy + spectral shape + F0): the flat record the
 * capture layer hands to `VoiceTurnAggregator.recordFrame()`. Null
 * conventions: `centroidHz`/`rolloffHz` null on silence; `f0Hz` null on an
 * unvoiced frame. No field is ever NaN.
 */
export declare function analyzeFrame(
  frame: ArrayLike<number>,
  sampleRate: number,
  options?: {
    rolloffFraction?: number;
    minHz?: number;
    maxHz?: number;
    clarityThreshold?: number;
    peakSelectionRatio?: number;
  },
): VoiceFrameFeatures;

/** `analyzeFrame` output — one flat DSP record per audio frame. */
export interface VoiceFrameFeatures {
  rms: number;
  peak: number;
  clippedSamples: number;
  zeroCrossingRate: number;
  /** `null` on a silent frame — excluded from spectral means, never coerced to 0. */
  centroidHz: number | null;
  /** `null` on a silent frame. */
  rolloffHz: number | null;
  /** `null` on an unvoiced frame — a frame with no pitch is not a frame at 0 Hz. */
  f0Hz: number | null;
  /** NSDF confidence in [0, 1]; 0 when no peak exists at all. `null` on the
   *  legacy in-thread path, where pitch is not measured. */
  f0Confidence: number | null;
  /** `null` on the legacy in-thread path — voicing unmeasured, not false. */
  voiced: boolean | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture surface (oyon/voice/controller — src/capture/VoiceTurnController.js)
// ─────────────────────────────────────────────────────────────────────────────

/** One `voice-states-v1` label (`OYON_VOICE_STATES`, src/version.js). */
export type VoiceStateLabel =
  | 'start'
  | 'speech'
  | 'silence'
  | 'pause'
  | 'clipped'
  | 'muted'
  | 'playback'
  | 'contaminated'
  | 'end';

/** One controller state event (the controller's `onEvent` payload). */
export interface VoiceControllerEvent {
  state: VoiceStateLabel;
  timestamp_ms: number;
  states_version: string;
  detail: Record<string, unknown>;
}

/**
 * Capture conditions read from `track.getSettings()` (§5.6 quality block).
 * `loudness_contaminated` is derived: AGC on — or a host-owned stream whose
 * AGC state is unknowable — makes absolute loudness a gain-controller
 * artifact, not a measurement.
 */
export interface VoiceTrackSettings {
  echo_cancellation: boolean | null;
  noise_suppression: boolean | null;
  auto_gain_control: boolean | null;
  sample_rate: number | null;
  channel_count: number | null;
  stream_owner: 'oyon' | 'host';
  loudness_contaminated: boolean;
}

/** One host AI-playback interval recorded by `aiPlaybackStart()`/`aiPlaybackEnd()`. */
export interface VoicePlaybackInterval {
  start_ms: number;
  end_ms: number | null;
}

/**
 * Which thread performed the per-frame analysis (VAD + DSP): `'worker'` =
 * the dedicated voice analysis Worker; `'main-thread'` = same-thread
 * analysis (the analyzer's visible fallback, or the legacy in-thread path
 * when `voice_worker_enabled` is false).
 */
export type VoiceProcessingMode = 'worker' | 'main-thread';

/** The report returned by `stopTurn()` — pass it to `VoiceTurnAggregator.finalize()`. */
export interface VoiceTurnReport {
  reason: string;
  turn_duration_ms: number | null;
  frames_processed: number;
  /** Frame-duration accumulation (frames × frame_ms) — deterministic in tests. */
  frame_coverage_ms: number;
  /** Count of contiguous VAD-speech-during-playback runs (§5.9). */
  contaminated_runs: number;
  playback_intervals: VoicePlaybackInterval[];
  track_settings: VoiceTrackSettings | null;
  resample_mode: 'native-16k' | 'linear-interpolation';
  /** Thread that measured this turn (feeds `quality.processing_mode`). */
  processing_mode: VoiceProcessingMode;
  /** Frames dropped by the analyzer's bounded backpressure this turn. */
  dropped_frames: number;
  /** dropped_frames / frames_processed; `null` with no frames. */
  dropped_frame_ratio: number | null;
}

/** The per-frame record the controller hands to `onFrameFeatures`. */
export interface VoiceControllerFrame {
  frame_index: number;
  timestamp_ms: number;
  /**
   * The raw 16 kHz sample frame (research-grade: nothing withheld). On the
   * worker path the buffer round-trips by transfer; when the frame's
   * analysis was dropped under backpressure (`analysis_dropped: true`) the
   * buffer is gone and this is an EMPTY (length-0) Float32Array.
   */
  frame: Float32Array;
  sample_rate: number;
  rms: number;
  peak: number;
  clipped_count: number;
  zcr: number;
  speech_probability: number | null;
  vad_state: 'start' | 'speech' | 'silence';
  in_playback: boolean;
  muted: boolean;
  resampled: boolean;
  /**
   * The `analyzeFrame` DSP record computed by the analysis path (off-thread
   * in worker mode) — `null` on dropped frames and on analysis errors. On
   * the legacy in-thread path (`voice_worker_enabled: false`) this is a
   * MINIMAL time-domain record built from the worklet scalars (rms, peak,
   * clippedSamples, zeroCrossingRate) with the spectral/pitch/voicing
   * fields null — unmeasured, never fabricated.
   */
  features: VoiceFrameFeatures | null;
  /** True when this frame's analysis was dropped by backpressure. */
  analysis_dropped: boolean;
  /** Thread that analyzed this frame ('main-thread' on the legacy path). */
  processing_mode: VoiceProcessingMode;
}

/** VAD adapter contract (`SileroVadAdapter` satisfies this; Worker proxies may too). */
export interface VoiceVadAdapter {
  init?(): Promise<void> | void;
  process(frame: Float32Array): Promise<{ speechProbability: number }> | { speechProbability: number };
  reset?(): void;
  dispose?(): void;
}

export interface VoiceTurnControllerOptions {
  settings?: Record<string, unknown>;
  vad?: VoiceVadAdapter | null;
  onFrameFeatures?: ((frame: VoiceControllerFrame) => void) | null;
  onEvent?: ((event: VoiceControllerEvent) => void) | null;
  onError?: ((error: unknown) => void) | null;
  /** Host-side activation gate: boolean or a live predicate. Default false. */
  hostEnabled?: boolean | (() => boolean);
  getUserMedia?: (constraints: unknown) => Promise<unknown> | unknown;
  audioContextFactory?: (options?: { sampleRate?: number }) => unknown;
  createWorkletNode?: (audioContext: unknown, name: string, options: unknown) => unknown;
  workletUrl?: string;
  now?: () => number;
  sampleRate?: number;
  stopHostStreamTracks?: boolean;
  clipThreshold?: number;
  /**
   * Pre-built analysis path (WorkerVoiceAnalyzer surface). The controller
   * inits/resets it per turn but does NOT dispose it — the caller owns it.
   */
  analyzer?: WorkerVoiceAnalyzer | null;
  /** Injectable analyzer constructor (tests); default `createWorkerVoiceAnalyzer`. */
  analyzerFactory?: ((options: WorkerVoiceAnalyzerOptions) => WorkerVoiceAnalyzer) | null;
  /** Extra options forwarded into the analyzer factory (`vadEnabled`, `modelUrl`, `wasmPaths`, `maxInFlight`, …). */
  analyzerOptions?: Partial<WorkerVoiceAnalyzerOptions>;
}

/** `startTurn()` gate refusal reasons — refusals resolve, they never throw. */
export type VoiceTurnRefusalReason =
  | 'voice_disabled_in_settings'
  | 'host_not_enabled'
  | 'no_user_action'
  | 'turn_already_active'
  /** A concurrent startTurn() is still between its gate and activation. */
  | 'start_in_progress'
  /** stopTurn() landed while this start was pending — cancelled, mic stopped. */
  | 'stopped_during_start'
  | 'disposed';

export interface VoiceTurnController {
  startTurn(options?: {
    userAction?: boolean;
    stream?: unknown;
  }): Promise<{ ok: true } | { ok: false; reason: VoiceTurnRefusalReason }>;
  stopTurn(reason?: string): VoiceTurnReport | null;
  aiPlaybackStart(): void;
  aiPlaybackEnd(): void;
  dispose(): void;
  getTrackSettings(): VoiceTrackSettings | null;
  readonly active: boolean;
  readonly state: VoiceStateLabel | null;
}

/**
 * Turn lifecycle + activation gate for voice capture (audio_text.md §5.1,
 * §5.2, §5.9). Never touches microphone hardware until settings, host, and a
 * deliberate per-turn user action all agree.
 */
export declare function createVoiceTurnController(
  options?: VoiceTurnControllerOptions,
): VoiceTurnController;

/**
 * Linear-interpolation resampler — the documented FALLBACK for platforms
 * refusing a 16 kHz AudioContext. Not a general resampler (no anti-alias
 * filtering); see audio_text.md §5.3.
 */
export declare function linearResample(
  frame: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array;

// ─────────────────────────────────────────────────────────────────────────────
// Worker surface (oyon/voice/worker — src/inference/WorkerVoiceAnalyzer.js,
// re-exporting src/workers/voiceAnalysisWorker.js; audio_text.md §5.2)
// ─────────────────────────────────────────────────────────────────────────────

/** Protocol tag of the worker message contract ('voice-worker-v1'). */
export declare const VOICE_WORKER_PROTOCOL_VERSION: string;

/** One resolved `analyze()` round trip. */
export interface VoiceAnalysisResult {
  /** The analyzer-assigned sequence number of the frame. */
  seq: number;
  /** True when the frame's analysis was dropped by bounded backpressure. */
  dropped: boolean;
  /** `analyzeFrame` DSP record; `null` on drops and errors. */
  features: VoiceFrameFeatures | null;
  /** VAD probability; `null` without a VAD, on drops, and on VAD errors. */
  speechProbability: number | null;
  /**
   * The sample frame, transferred back from the worker. On DROPS: the
   * untouched samples when the frame was dropped from the held slot (its
   * buffer was never transferred), `null` when it was already inside the
   * worker. `null` on errors.
   */
  frame: Float32Array | null;
  /** Error message when analysis (or the VAD) failed; `null` otherwise. */
  error: string | null;
}

export interface WorkerVoiceAnalyzerOptions {
  /** Oyon settings; the `voice_*` keys are forwarded to the worker. */
  settings?: Record<string, unknown>;
  /** Default sample rate for `analyze()` (16000). */
  sampleRate?: number;
  /**
   * VAD adapter INSTANCE — forces main-thread mode (an object cannot cross
   * a thread boundary) and is used by the same-thread fallback core.
   */
  vad?: VoiceVadAdapter | null;
  /** True → the WORKER constructs its own adapter (Silero by default). */
  vadEnabled?: boolean | null;
  /** Forwarded to the worker-constructed adapter. */
  modelUrl?: string | null;
  wasmPaths?: string | Record<string, unknown> | null;
  /** Injectable worker constructor; `null` return → main-thread fallback. */
  workerFactory?: (workerUrl?: string | URL | null) => unknown | null;
  /** Override the worker module URL (bundler edge cases). */
  workerUrl?: string | URL | null;
  /** Backpressure bound (worker mode): max frames outstanding. Default 2. */
  maxInFlight?: number;
  /** Worker init deadline before falling back to main-thread mode. Default 8000. */
  initTimeoutMs?: number;
  onError?: ((error: unknown) => void) | null;
  /** Extra options for the in-process fallback core (tests inject `createAdapter`). */
  coreOptions?: Record<string, unknown>;
}

/**
 * Main-thread proxy for the voice analysis Worker: VAD + per-frame DSP off
 * the main thread, with a VISIBLE same-thread fallback (`mode`,
 * `fallbackReason`) and bounded, counted backpressure (`droppedFrames`).
 */
export interface WorkerVoiceAnalyzer {
  init(): Promise<void>;
  analyze(frame: Float32Array, sampleRate?: number): Promise<VoiceAnalysisResult>;
  /** Turn boundary: zero VAD state + the dropped-frame counter. */
  reset(): Promise<void>;
  /** Terminate the worker; idempotent. */
  dispose(): void;
  /** 'silero' | 'none' (reported by the analysis backend at init). */
  readonly engine: string;
  /** null before `init()` resolves. */
  readonly mode: VoiceProcessingMode | null;
  /** Frames dropped by backpressure since the last `reset()`. */
  readonly droppedFrames: number;
  /** Why the analyzer is not in worker mode; `null` in worker mode. */
  readonly fallbackReason: string | null;
  /** Frames POSTED into the backend pipeline awaiting a response — the true
   *  worker inbound-queue depth, bounded by `maxInFlight` in worker mode. */
  readonly inFlight: number;
  /** Frames parked in the one-deep held slot while the pipeline is full (0 or 1). */
  readonly heldFrames: number;
}

export declare function createWorkerVoiceAnalyzer(
  options?: WorkerVoiceAnalyzerOptions,
): WorkerVoiceAnalyzer;

/**
 * The worker's pure message-handling core (protocol `voice-worker-v1`),
 * exported so Node tests can drive it without a real Worker. `post` is
 * called with every outbound message (+ optional transfer list).
 */
export declare function createVoiceAnalysisWorkerCore(options?: {
  createAdapter?: (adapterOptions: Record<string, unknown>) => VoiceVadAdapter;
  analyze?: (frame: Float32Array, sampleRate: number) => VoiceFrameFeatures;
}): {
  handleMessage(
    message: unknown,
    post?: (message: Record<string, unknown>, transfer?: unknown[]) => void,
  ): Promise<void>;
};

/**
 * Worker-shaped wrapper around the core for SAME-THREAD use — the
 * analyzer's fallback backend, so the fallback path runs the identical
 * analysis code as the worker path.
 */
export declare function createInProcessVoiceAnalysisWorker(options?: {
  createAdapter?: (adapterOptions: Record<string, unknown>) => VoiceVadAdapter;
  analyze?: (frame: Float32Array, sampleRate: number) => VoiceFrameFeatures;
}): {
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  postMessage(message: Record<string, unknown>, transfer?: unknown[]): Promise<void>;
  terminate(): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Window surface (oyon/voice — src/aggregation/VoiceTurnAggregator.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal-pause histogram bucket counts, keyed by upper bound — same key
 * convention as the typing pause histogram. For the default `pauseBuckets`
 * of `[500, 1000, 2000, 5000]` the keys are exactly `lt_500_ms`,
 * `500_to_1000_ms`, `1000_to_2000_ms`, `2000_to_5000_ms`, `gte_5000_ms`.
 */
export type VoicePauseHistogram = Record<string, number>;

/** Machine-readable `insufficient_reasons` slugs (§10.3 uncertainty states). */
export type VoiceInsufficientReason =
  | 'turn_too_short'
  | 'insufficient_analyzable_speech'
  | 'excessive_clipping'
  | 'poor_vad_coverage'
  | 'dropped_frames';

/**
 * The `voice` block of a `voice-v1` episode window — §5.6's deliberately
 * TRIMMED set (~15 measurements + quality/uncertainty). Jitter, shimmer,
 * HNR, formants, and further spectral shape are §5.7 deferrals.
 *
 * Null discipline: every statistic that could not be measured is `null`,
 * never 0 — pitch statistics below the voiced-frame floor, spectral means on
 * a silent turn, and every ratio/coverage whose denominator was 0.
 */
export interface VoiceMetrics {
  // ── turn and speech structure ──
  /** finalize timestamp − start timestamp (monotonic ms). */
  turn_duration_ms: number;
  /** VAD-speech frame time (non-playback, non-muted), ms. */
  speech_duration_ms: number;
  /**
   * speech_duration_ms over the LEARNER (non-playback) timeline — muted
   * learner time included, AI playback time excluded (§5.9) — clamped to
   * [0, 1]; `null` when the turn had no learner frames.
   */
  speech_ratio: number | null;
  /** Non-playback frame time before the first speech frame (the whole turn when no speech occurred). */
  initial_silence_ms: number;
  /** Non-playback frame time after the last speech frame (0 when no speech occurred). */
  trailing_silence_ms: number;
  /** Internal silence runs (between speech runs) at/above `pauseThresholdMs`. */
  internal_pause_count: number;
  /** Total duration of those qualifying internal pauses, ms. */
  internal_pause_total_ms: number;
  /** Histogram over ALL internal silence runs (any length), bucketed by `pauseBuckets`. */
  pause_histogram: VoicePauseHistogram;
  /** Count of contiguous speech runs. */
  speech_segment_count: number;
  /** speech_duration_ms / speech_segment_count; `null` when there were no segments. */
  segment_duration_mean_ms: number | null;
  /** Frame time inside host AI-playback intervals — excluded from every speech measurement (§5.9). */
  excluded_playback_ms: number;
  /** Frame time while the track was muted (structural silence; excluded from loudness/pitch/spectrum). */
  muted_ms: number;

  // ── pitch and voicing ──
  // Pitch statistics are measured on VAD-speech frames only (frames the VAD
  // explicitly called non-speech contribute no pitch candidate); with no VAD
  // supplied at all, the DSP voicing decision stands on its own.
  /** DSP-voiced frames / analyzable frames (deliberately NOT VAD-gated); `null` with no analyzable frames. */
  voiced_frame_ratio: number | null;
  /** Median F0 over confident voiced speech frames; `null` below `minVoicedFramesForPitch`. */
  pitch_median_hz: number | null;
  /** Interquartile range of the same F0 distribution; `null` below the floor. */
  pitch_iqr_hz: number | null;
  /** OLS slope of F0 (Hz) vs time (s) over confident voiced frames; `null` below the floor. */
  pitch_slope_hz_per_s: number | null;
  /** Mean NSDF confidence of the kept voiced frames; `null` below the floor. */
  pitch_confidence_mean: number | null;
  /** Share of voiced candidates dropped for confidence < `minPitchConfidence`; `null` with no candidates. */
  pitch_frames_excluded_ratio: number | null;

  // ── loudness and energy (see VoiceQuality.loudness_contaminated) ──
  // A frame with no finite rms is an ABSENT loudness measurement: excluded
  // from these statistics (and from analyzable_speech_ms), never coerced to 0.
  /** Mean per-frame rms over rms-measured speech frames; `null` with none. ABSOLUTE — not comparable under AGC. */
  rms_mean: number | null;
  /** Population SD of per-frame rms over rms-measured speech frames; `null` with none. Relative — usable under AGC. */
  rms_variability: number | null;
  /** Max speech-frame peak / rms_mean; `null` with no rms-measured speech frames or zero rms_mean. */
  peak_to_average_ratio: number | null;
  /** Clipped analyzable frames / analyzable frames; `null` with no analyzable frames. */
  clipping_ratio: number | null;
  /** Near-silent rms-measured frames / rms-measured analyzable frames; `null` with none. */
  near_silence_ratio: number | null;

  // ── spectrum (centroid + roll-off ONLY; §5.7 defers the rest) ──
  /** Mean spectral centroid over non-silent frames; `null` on a silent turn. */
  spectral_centroid_mean_hz: number | null;
  /** Mean spectral roll-off over non-silent frames; `null` on a silent turn. */
  spectral_rolloff_mean_hz: number | null;

  // ── quality and uncertainty ──
  /** Effective capture sample rate from `track.getSettings()`; `null` when unknown. */
  sample_rate: number | null;
  channel_count: number | null;
  echo_cancellation: boolean | null;
  noise_suppression: boolean | null;
  auto_gain_control: boolean | null;
  stream_owner: 'oyon' | 'host' | null;
  // Learner-scoped coverages divide by NON-PLAYBACK frames only (§5.9 —
  // playback contributes to nothing but excluded_playback_ms and
  // contaminated_coverage); `null` when the turn had no learner frames.
  /** Clipped learner frames / learner frames; `null` with no learner frames. */
  clipped_coverage: number | null;
  /** Muted learner frames / learner frames; `null` with no learner frames. */
  muted_coverage: number | null;
  /** Hidden learner frames / learner frames; `null` unless `hidden` was ever supplied on a learner frame. */
  hidden_coverage: number | null;
  /** VAD-speech frames inside playback intervals / ALL frames — the one deliberately turn-wide coverage (§5.9 leakage). */
  contaminated_coverage: number | null;
  /** Learner frames with a finite VAD probability / learner frames; `null` with no learner frames. */
  vad_coverage: number | null;
  /** Confident voiced frames / speech frames, clamped to [0, 1]; `null` with no speech frames. */
  pitch_coverage: number | null;
  /** Clip-free, rms-measured speech frame time, ms — the denominator quality gates care about. */
  analyzable_speech_ms: number;
  /** True when any `insufficient_reasons` entry applies (§10.3: uncertainty states, not confident values). */
  insufficient_data: boolean;
  insufficient_reasons: VoiceInsufficientReason[];
}

export interface VoiceQualityThresholds {
  frame_ms: number;
  vad_threshold: number;
  pause_threshold_ms: number;
  pause_buckets: number[];
  min_voiced_frames_for_pitch: number;
  min_pitch_confidence: number;
  min_turn_ms: number;
  min_analyzable_ms: number;
  max_clipping_ratio: number;
  min_vad_coverage: number;
  near_silence_rms: number;
  max_dropped_frame_ratio: number;
}

export interface VoiceQuality {
  thresholds: VoiceQualityThresholds;
  /**
   * Which thread measured this turn: 'worker' = the dedicated analysis
   * Worker (off the main thread); 'main-thread' = same-thread analysis
   * (visible fallback or legacy path); `null` = no controller report.
   * Lets a researcher tell whether a turn was measured under main-thread
   * contention.
   */
  processing_mode: VoiceProcessingMode | null;
  /** Frames dropped by the analyzer's bounded backpressure; `null` without a report. */
  dropped_frames: number | null;
  /** Dropped share of processed frames; above `max_dropped_frame_ratio` ⇒ `insufficient_reasons: ['dropped_frames']`. */
  dropped_frame_ratio: number | null;
  /**
   * True when AGC was active (or the stream is host-owned with AGC
   * unknowable): ABSOLUTE loudness figures (`rms_mean`) are then artifacts
   * of the gain controller and not comparable across turns/users, while
   * within-turn RELATIVE measures (`rms_variability`,
   * `peak_to_average_ratio`, `near_silence_ratio`) stay usable. The figures
   * are still emitted — flagged, never withheld. `null` = capture
   * conditions unknown (no report/track settings).
   */
  loudness_contaminated: boolean | null;
}

/** Identifies which host voice control produced the turn. */
export interface VoiceTarget {
  kind: string | null;
  id: string | null;
}

/**
 * Aggregated `voice-v1` window for one authorized voice turn, returned by
 * `VoiceTurnAggregator.finalize()`. `target` is present only when `start()`
 * was called with a non-null `targetKind` or `targetId`.
 */
export interface VoiceWindow {
  modality: 'voice';
  window_kind: 'episode';
  feature_profile: 'voice-v1';
  window_start: string;
  window_end: string;
  voice: VoiceMetrics;
  quality: VoiceQuality;
  target?: VoiceTarget;
}

/**
 * One entry of the per-event stream `VoiceTurnAggregator.recordEvent()`
 * re-emits through `options.onEvent` — SignalEventLog `record()` shape, so
 * it feeds the per-event log (and ladyna `tna()`) directly.
 */
export interface VoiceAggregatorEvent {
  modality: 'voice';
  state: VoiceStateLabel;
  /** 'ai' for playback/contaminated (the AI speaking or leaking); 'user' otherwise. */
  source: 'user' | 'ai';
  timestamp: number;
  monotonic_ms: number;
  detail: Record<string, unknown> | null;
}

export interface VoiceTurnAggregatorOptions {
  /** Frame duration (ms); must match the capture layer's framing. Default 32. */
  frameMs?: number;
  /** speechProbability at/above this makes a frame speech-like. Default 0.5. */
  vadThreshold?: number;
  /** Internal silence runs at/above this (ms) count as internal pauses. Default 500. */
  pauseThresholdMs?: number;
  /** Histogram upper bounds (ms), strictly ascending. Default [500, 1000, 2000, 5000]. */
  pauseBuckets?: number[];
  /** Below this many confident voiced frames every pitch statistic is `null`. Default 5. */
  minVoicedFramesForPitch?: number;
  /** A voiced frame joins pitch statistics only at/above this confidence. Default 0.6. */
  minPitchConfidence?: number;
  /** Turn shorter than this (ms) sets 'turn_too_short'. Default 1000. */
  minTurnMs?: number;
  /** Less clip-free speech than this (ms) sets 'insufficient_analyzable_speech'. Default 500. */
  minAnalyzableMs?: number;
  /** clipped_coverage above this sets 'excessive_clipping'. Default 0.05. */
  maxClippingRatio?: number;
  /** vad_coverage below this sets 'poor_vad_coverage'. Default 0.5. */
  minVadCoverage?: number;
  /** Frame rms below this counts as near-silence. Default 0.01. */
  nearSilenceRms?: number;
  /** dropped_frame_ratio above this sets 'dropped_frames'. Default 0.2. */
  maxDroppedFrameRatio?: number;
  /** Wall clock, used only for the ISO window_start / window_end strings. */
  now?: () => number;
  /** Per-event sink for `recordEvent()` re-emission; null (default) emits nothing. */
  onEvent?: ((event: VoiceAggregatorEvent) => void) | null;
}

export interface VoiceStartArgs {
  /** Monotonic ms marking the start of the turn. */
  timestamp: number;
  targetKind?: string | null;
  targetId?: string | null;
}

export interface VoiceRecordFrameMeta {
  /** Monotonic ms of this frame (time axis for the pitch-slope fit). */
  timestamp: number;
  /** VAD probability for this frame; null when no VAD ran. */
  speechProbability?: number | null;
  /** True inside a host AI-playback interval — excludes the frame from speech measurement (§5.9). */
  inPlayback?: boolean;
  /** True while the track is muted — structural silence, excluded from loudness/pitch/spectrum. */
  muted?: boolean;
  /** Optional tab-visibility flag; `hidden_coverage` stays `null` unless ever supplied. */
  hidden?: boolean;
}

export interface VoiceFinalizeArgs {
  /** Monotonic ms marking the end of the turn. */
  timestamp: number;
  /** The controller's `stopTurn()` report; capture-condition fields degrade to null without it. */
  report?: VoiceTurnReport | null;
}

/**
 * Aggregates one authorized voice turn into a `voice-v1` episode window.
 * Pure: no DOM, no audio, no timers — per-frame DSP records and controller
 * events are pushed in; all timing arrives as arguments.
 */
export class VoiceTurnAggregator {
  constructor(options?: VoiceTurnAggregatorOptions);
  options: Required<VoiceTurnAggregatorOptions>;
  /** True while a turn is in progress (between `start()` and `finalize()`). */
  readonly active: boolean;
  /** Begin a new turn. Discards any prior unfinished turn. */
  start(args: VoiceStartArgs): void;
  /** Consume one per-frame DSP record. No-op when not active. */
  recordFrame(features: VoiceFrameFeatures, meta: VoiceRecordFrameMeta): void;
  /**
   * Re-emit one controller state event in SignalEventLog shape. Throws on a
   * state outside `voice-states-v1`. No-op when not active.
   */
  recordEvent(event: { state: VoiceStateLabel; timestamp_ms?: number; detail?: Record<string, unknown> | null }): void;
  /** End the turn and return its window, or `null` when no turn was active. */
  finalize(args: VoiceFinalizeArgs): VoiceWindow | null;
}
