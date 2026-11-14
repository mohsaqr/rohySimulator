export const OYON_SETTINGS_SCHEMA_VERSION = 'oyon-settings-v1';

const DEFAULT_FOCUS_SCORE_WEIGHTS = Object.freeze({
  blink_penalty: 0.30,
  openness: 0.20,
  gaze_stability: 0.50,
});

export const OYON_DEFAULT_SETTINGS = Object.freeze({
  schema_version: OYON_SETTINGS_SCHEMA_VERSION,
  profile_id: 'learning-analytics',
  model_profile: 'hse-emotion-mtl',
  sample_interval_ms: 1000,
  aggregate_window_ms: 10000,
  min_valid_frames: 6,
  smoothing_alpha: 0.28,
  min_hold_ms: 3000,
  switch_confidence: 0.5,
  capture_mode: 'local-browser',
  // Privacy-safe camera settings + decoded-frame timing. No pixels, device ID,
  // group ID, or label are retained. Cheap enough to keep on by default.
  capture_quality_enabled: true,
  capture_quality_window_share: true,
  logging_mode: 'windows-only',
  enable_sample_logs: false,
  enable_dynamics: true,
  eye_tracking_enabled: false,
  blink_mask_threshold: 0.2,
  gaze_zone_neutral_deg: 8,
  engagement_window_share: true,
  blink_rate_baseline_hz: 0.25,
  gaze_entropy_grid_n: 5,
  focus_score_weights: DEFAULT_FOCUS_SCORE_WEIGHTS,
  // Facial signals (Tier 0): head pose + action units, derived from the face
  // result the emotion pipeline already produces. Zero extra model/inference.
  facial_signals_enabled: false,
  facial_signals_window_share: true,
  facial_frontal_half_angle_deg: 20,
  // Body posture (MediaPipe PoseLandmarker; new model, same tasks-vision wasm).
  posture_tracking_enabled: false,
  posture_window_share: true,
  posture_model: 'lite', // 'lite' | 'full' | 'heavy'
  // Remote heart rate (rPPG). Retains a face-ROI colour buffer + FFT. Research-
  // grade trend only, NOT clinical (see docs/HEART_RATE.md).
  // Respiration (0.1-0.5 Hz band of the SAME ROI colour stream). Learning
  // analytics signal, not diagnostic — see docs/RESPIRATION.md. Needs a long
  // window because frequency resolution is 1/T.
  respiration_enabled: false,
  respiration_window_share: true,
  respiration_buffer_seconds: 45,
  respiration_min_window_seconds: 25,
  respiration_min_confidence: 0.4,
  respiration_plausible_min_brpm: 9,
  respiration_plausible_max_brpm: 24,
  respiration_rgb_corroboration: true,
  respiration_require_rgb_corroboration: false,
  respiration_min_sample_rate_hz: 2,
  respiration_max_sample_gap_ms: 2000,

  // Ambient illumination — the quality covariate for every other signal.
  // Cheap (one 32x18 canvas read per sample) so it defaults ON.
  illumination_enabled: true,
  illumination_window_share: true,

  heart_rate_enabled: false,
  heart_rate_window_share: true,
  heart_rate_buffer_seconds: 12,
  heart_rate_min_window_seconds: 8, // minimum integration before any BPM is emitted
  heart_rate_roi: 'forehead', // 'forehead' | 'cheeks' | 'face'
  heart_rate_method: 'pos',   // 'pos' | 'green'
  // ROI colour sampling rate. 16 fps sits comfortably above the 8 Hz Nyquist
  // floor for a 240 BPM (4 Hz) pulse while costing ~20% less CPU than 20 fps;
  // rPPG accuracy is limited by lighting and motion long before it is limited
  // by frame rate in this range.
  heart_rate_target_fps: 16,
  heart_rate_min_confidence: 0.5, // drop "unsure" estimates below this (0 disables)
  heart_rate_max_head_movement_deg: 3, // pause sampling when per-tick head rotation exceeds this (0 disables)
  // Robust mean (bpm_robust) — anomaly filtering over the window's estimates.
  heart_rate_anomaly_filter: true,      // master toggle for the robust pipeline
  heart_rate_harmonic_fold: true,       // fold ½×/2× octave errors toward the centre
  heart_rate_fold_tolerance: 0.10,      // ±fraction of ½×/2× that counts as an octave error
  heart_rate_mad_h: 3,                  // Hampel h — reject > h·max(1.4826·MAD, floor)
  heart_rate_mad_floor_bpm: 4,          // BPM floor for the scaled MAD (min gate half-width)
  heart_rate_confidence_weighted: true, // weight the mean by per-estimate confidence
  heart_rate_min_weight: 0.1,           // minimum weight so low-confidence still counts
  // Cross-window slew limit: HR can't move faster than this (bpm/sec) between
  // windows — rejects physiologically-impossible inter-window flips (a whole
  // window that coherently locked onto a wrong rate). 0 disables. Produces bpm_tracked.
  heart_rate_max_slew_bpm_per_s: 1.5,
  // Rolling robust median across the last N windows — anchors the LEVEL (slew
  // alone only bounds the rate, so a run of bad windows drags the tracker).
  //
  // A trailing median has NO phase response on a stationary signal but sits
  // half its span behind a trending one, so N buys bad-patch immunity and pays
  // for it in lag on a changing HR. N was 9 (a 90 s anchor at the default
  // window, i.e. ~45 s of lag), tuned only against the bad-patch failure;
  // scored against BOTH, mean |error| in bpm over 10 seeds was:
  //
  //     N        1     2     3     4     5     7     9
  //     ramp   1.29  1.48  2.04  2.62  3.22  4.38  5.42   ← 60→110 bpm
  //     patch  4.47  3.91  4.23  3.95  4.07  3.68  3.42   ← 50 s coherent lock
  //
  // The anchor's protection is worth ~1 bpm across that whole range while its
  // lag costs ~4. N=3 keeps a real anchor (a 5-window patch still cannot own
  // its median outright) at a third of the lag. The sweep's own optimum was
  // N=2; 3 is the conservative side of it, since the patch model is simulated
  // whereas the original N=9 was fitted to real captures.
  //
  // Cost is memory/lag (~N × window_ms). 1 disables the anchor.
  heart_rate_tracker_windows: 3,
  // Tracker seed/recovery guards. A window needs this many surviving estimates
  // before it may seed or feed the anchor (a 1-estimate window is not evidence
  // and poisons the anchor for many windows).
  heart_rate_tracker_min_estimates: 2,
  // Re-seed when the sensor disagrees with the tracker by more than this many
  // bpm for this many consecutive windows (same direction) — the tracker is
  // stale (bad seed, or a genuine HR change), so jump instead of crawling.
  heart_rate_tracker_reset_bpm: 10,
  heart_rate_tracker_reset_windows: 3,
  // Plausibility prior on ADOPTED values (seed or re-seed). 60-100 bpm is the
  // clinical normal resting range and is believed immediately; outside it we
  // require corroboration from this many consecutive agreeing windows first, so
  // one bad window can't establish an implausible baseline. A genuinely
  // brady/tachycardic subject still gets adopted once corroborated.
  heart_rate_plausible_min_bpm: 60,
  heart_rate_plausible_max_bpm: 100,
  heart_rate_implausible_corroboration: 3,
  gaze_tracking_enabled: false,
  gaze_engine: 'mediapipe',
  // WebGazer-specific runtime tunables. These flow into WebGazerAdapter
  // unchanged; when the active engine is mediapipe or webeyetrack they are
  // ignored.
  webgazer_show_face_overlay: false,
  webgazer_show_prediction_points: false,
  webgazer_show_face_feedback_box: false,
  webgazer_save_across_sessions: false,
  // WebGazer ships three regression backends. 'ridge' is the documented
  // default; 'weightedRidge' weights recent samples; 'threadedRidge' runs
  // in a worker but isn't available in every build.
  webgazer_regression: 'ridge',
  gaze_calibration_points: 5,
  gaze_window_share: true,
  gaze_calibration_required: true,
  gaze_min_calibration_samples: 9,
  gaze_min_quality_score: 0.3,
  gaze_zone_grid: 3,
  gaze_aois: [],
  gaze_drop_off_screen: true,
  // Coarse webcam fixations. Below 8 Hz the window reports the sampling as
  // inadequate and leaves fixation metrics null rather than inventing them.
  gaze_fixation_min_duration_ms: 150,
  gaze_fixation_dispersion_threshold: 0.08,
  gaze_fixation_min_sample_rate_hz: 8,
  gaze_max_sample_gap_ms: 250,

  // Typing / composer analytics (keystroke timing on a host-registered
  // composer element — see docs/TYPING.md). Off by default like the other
  // opt-in modalities above: cost and host opt-in, not privacy — see
  // CLAUDE.md's data policy.
  typing_enabled: false,
  typing_pause_buckets: [500, 1000, 2000, 5000],
  typing_burst_threshold_ms: 2000,
  typing_max_intervals: 5000,

  // Page-wide interaction analytics (pointer/click/scroll/selection/focus/
  // visibility — see docs/INTERACTION.md). Off by default like the other
  // opt-in modalities: cost and host opt-in, not privacy.
  interaction_enabled: false,
  // Discourse analytics (per-sentence speech acts + text-v1 metrics over
  // host-supplied message text — see docs/DISCOURSE.md). Off by default.
  discourse_enabled: false,
  // AI-assistance cycle analytics (host-reported suggestion request/shown/
  // accept/reject/dismiss — see docs/AI_ASSIST.md). Off by default.
  ai_assist_enabled: false,
  // Host-reported document edits and code runs (events only, no window —
  // see docs/HOST_SCOPES.md). Off by default like the other opt-in
  // modalities: host opt-in, not privacy.
  document_edit_enabled: false,
  code_run_enabled: false,

  // Voice-turn analytics (audio_text.md §5). Off by default like the other
  // opt-in modalities: cost and host opt-in, not privacy — see CLAUDE.md's
  // data policy. `voice_enabled` is condition 1 of the three-part
  // activation gate (settings + host enablement + per-turn user action);
  // it gates microphone HARDWARE access, never recorded signal.
  voice_enabled: false,
  // 32 ms = 512 samples at 16 kHz — Silero v5's exact chunk size. Other
  // values are for research/mock engines; the silero engine requires 32.
  voice_frame_ms: 32,
  voice_vad_threshold: 0.5,
  voice_min_speech_ms: 100,
  voice_min_silence_ms: 300,
  voice_pause_threshold_ms: 500,
  // §5.6 AGC policy: when Oyon owns the microphone stream, request
  // autoGainControl:false so absolute loudness is a measurement, not a
  // gain-controller artifact. Host-owned streams are reported, not forced.
  voice_request_agc_off: true,
  voice_engine: 'silero',
  // §5.2 thread split: run VAD + per-frame DSP (FFT/pitch) inside a
  // dedicated Worker (WorkerVoiceAnalyzer) instead of the main thread,
  // where the camera pipelines already run at 16 fps. Default ON — this is
  // a performance fix, and the analyzer falls back VISIBLY to same-thread
  // analysis (`processing_mode: 'main-thread'`) where Workers are
  // unavailable. false restores the original in-thread adapter path.
  voice_worker_enabled: true,

  // Group work (docs/GROUP_SYNCHRONY.md). `window_anchor_ms` is a GROUP-time
  // epoch ms: window k then covers [anchor + k·W, anchor + (k+1)·W) for every
  // member, so members' windows line up (null = free-running windows).
  // `group_clock_url` points at the group hub's `/clock` endpoint; when set
  // the runtime runs an NTP-style handshake on start and every
  // `group_clock_resync_ms`, and stamps ts_group_ms beside every local ts.
  window_anchor_ms: null,
  group_clock_url: null,
  group_clock_resync_ms: 60000,
  // One camera, several people (MultiFaceCapture; docs/MULTI_PERSON_RESEARCH.md).
  // Faces kept per frame (largest first), IoU gate for continuing a track,
  // consecutive matches before a track counts, and how long an unmatched
  // track coasts before it ends.
  multi_face_max_faces: 4,
  multi_face_iou_gate: 0.3,
  multi_face_confirm_hits: 3,
  multi_face_coast_ms: 2000,
  // Byte budget of one window-batch POST (HttpEmotionTransport). A batch over
  // it is split into several POSTs, and a single window whose raw_streams are
  // over it is split into raw-only continuation parts — losslessly, nothing is
  // cut. 240 KiB keeps each request under a common 256 KiB body-parser limit
  // (Rohy's) with headroom for headers and the envelope.
  transport_max_post_bytes: 245760,
});

const MAX_AOIS = 32;

export const OYON_SETTINGS_PROFILES = Object.freeze({
  'learning-analytics': Object.freeze({
    profile_id: 'learning-analytics',
    sample_interval_ms: 1000,
    aggregate_window_ms: 10000,
    min_valid_frames: 6,
    smoothing_alpha: 0.28,
    min_hold_ms: 3000,
    switch_confidence: 0.5,
    logging_mode: 'windows-only',
    enable_sample_logs: false,
    enable_dynamics: true,
  }),
  'low-power': Object.freeze({
    profile_id: 'low-power',
    sample_interval_ms: 2000,
    aggregate_window_ms: 15000,
    min_valid_frames: 5,
    smoothing_alpha: 0.22,
    min_hold_ms: 4000,
    switch_confidence: 0.55,
    logging_mode: 'windows-only',
    enable_sample_logs: false,
    enable_dynamics: true,
  }),
  research: Object.freeze({
    profile_id: 'research',
    sample_interval_ms: 500,
    aggregate_window_ms: 5000,
    min_valid_frames: 6,
    smoothing_alpha: 0.35,
    min_hold_ms: 1500,
    switch_confidence: 0.45,
    logging_mode: 'windows-and-samples',
    enable_sample_logs: true,
    enable_dynamics: true,
  }),
  debug: Object.freeze({
    profile_id: 'debug',
    model_profile: 'mock',
    sample_interval_ms: 1000,
    aggregate_window_ms: 5000,
    min_valid_frames: 2,
    smoothing_alpha: 0.4,
    min_hold_ms: 1000,
    switch_confidence: 0.35,
    logging_mode: 'windows-and-runtime',
    enable_sample_logs: false,
    enable_dynamics: true,
  }),
});

export function createOyonSettings(overrides = {}) {
  const profileId = overrides.profile_id || overrides.profileId || OYON_DEFAULT_SETTINGS.profile_id;
  const profile = OYON_SETTINGS_PROFILES[profileId] || {};
  return normalizeOyonSettings({
    ...OYON_DEFAULT_SETTINGS,
    ...profile,
    ...normalizeLegacySettingKeys(overrides),
    schema_version: OYON_SETTINGS_SCHEMA_VERSION,
  });
}

export function normalizeOyonSettings(settings = {}) {
  const sampleIntervalMs = boundedInteger(settings.sample_interval_ms, 250, 10000, OYON_DEFAULT_SETTINGS.sample_interval_ms);
  const aggregateWindowMs = boundedInteger(settings.aggregate_window_ms, 1000, 60000, OYON_DEFAULT_SETTINGS.aggregate_window_ms);
  const expectedSamples = expectedSamplesPerWindow(sampleIntervalMs, aggregateWindowMs);
  const minValidFrames = boundedInteger(settings.min_valid_frames, 1, expectedSamples, OYON_DEFAULT_SETTINGS.min_valid_frames);

  return {
    schema_version: OYON_SETTINGS_SCHEMA_VERSION,
    profile_id: safeString(settings.profile_id, OYON_DEFAULT_SETTINGS.profile_id),
    model_profile: safeString(settings.model_profile, OYON_DEFAULT_SETTINGS.model_profile),
    sample_interval_ms: sampleIntervalMs,
    aggregate_window_ms: aggregateWindowMs,
    min_valid_frames: minValidFrames,
    smoothing_alpha: boundedNumber(settings.smoothing_alpha, 0.01, 0.95, OYON_DEFAULT_SETTINGS.smoothing_alpha),
    min_hold_ms: boundedInteger(settings.min_hold_ms, 0, 60000, OYON_DEFAULT_SETTINGS.min_hold_ms),
    switch_confidence: boundedNumber(settings.switch_confidence, 0, 1, OYON_DEFAULT_SETTINGS.switch_confidence),
    capture_mode: safeString(settings.capture_mode, OYON_DEFAULT_SETTINGS.capture_mode),
    capture_quality_enabled: settings.capture_quality_enabled !== false,
    capture_quality_window_share: settings.capture_quality_window_share !== false,
    logging_mode: safeString(settings.logging_mode, OYON_DEFAULT_SETTINGS.logging_mode),
    enable_sample_logs: Boolean(settings.enable_sample_logs),
    enable_dynamics: settings.enable_dynamics !== false,
    eye_tracking_enabled: Boolean(settings.eye_tracking_enabled),
    blink_mask_threshold: boundedNumber(settings.blink_mask_threshold, 0, 1, OYON_DEFAULT_SETTINGS.blink_mask_threshold),
    gaze_zone_neutral_deg: boundedNumber(settings.gaze_zone_neutral_deg, 0, 45, OYON_DEFAULT_SETTINGS.gaze_zone_neutral_deg),
    engagement_window_share: settings.engagement_window_share !== false,
    blink_rate_baseline_hz: boundedNumber(settings.blink_rate_baseline_hz, 0.01, 2, OYON_DEFAULT_SETTINGS.blink_rate_baseline_hz),
    gaze_entropy_grid_n: boundedInteger(settings.gaze_entropy_grid_n, 2, 20, OYON_DEFAULT_SETTINGS.gaze_entropy_grid_n),
    focus_score_weights: normalizeFocusScoreWeights(settings.focus_score_weights),
    facial_signals_enabled: Boolean(settings.facial_signals_enabled),
    facial_signals_window_share: settings.facial_signals_window_share !== false,
    facial_frontal_half_angle_deg: boundedNumber(settings.facial_frontal_half_angle_deg, 1, 89, OYON_DEFAULT_SETTINGS.facial_frontal_half_angle_deg),
    posture_tracking_enabled: Boolean(settings.posture_tracking_enabled),
    posture_window_share: settings.posture_window_share !== false,
    posture_model: normalizePostureModel(settings.posture_model),
    respiration_enabled: Boolean(settings.respiration_enabled),
    respiration_window_share: settings.respiration_window_share !== false,
    respiration_buffer_seconds: boundedInteger(settings.respiration_buffer_seconds, 20, 120, OYON_DEFAULT_SETTINGS.respiration_buffer_seconds),
    respiration_min_window_seconds: boundedInteger(settings.respiration_min_window_seconds, 15, 90, OYON_DEFAULT_SETTINGS.respiration_min_window_seconds),
    respiration_min_confidence: boundedNumber(settings.respiration_min_confidence, 0, 1, OYON_DEFAULT_SETTINGS.respiration_min_confidence),
    respiration_plausible_min_brpm: boundedNumber(settings.respiration_plausible_min_brpm, 4, 30, OYON_DEFAULT_SETTINGS.respiration_plausible_min_brpm),
    respiration_plausible_max_brpm: boundedNumber(settings.respiration_plausible_max_brpm, 8, 40, OYON_DEFAULT_SETTINGS.respiration_plausible_max_brpm),
    respiration_rgb_corroboration: settings.respiration_rgb_corroboration !== false,
    respiration_require_rgb_corroboration: settings.respiration_rgb_corroboration !== false
      && Boolean(settings.respiration_require_rgb_corroboration),
    respiration_min_sample_rate_hz: boundedNumber(settings.respiration_min_sample_rate_hz, 1, 30, OYON_DEFAULT_SETTINGS.respiration_min_sample_rate_hz),
    respiration_max_sample_gap_ms: boundedInteger(settings.respiration_max_sample_gap_ms, 250, 10000, OYON_DEFAULT_SETTINGS.respiration_max_sample_gap_ms),
    illumination_enabled: settings.illumination_enabled !== false,
    illumination_window_share: settings.illumination_window_share !== false,
    heart_rate_enabled: Boolean(settings.heart_rate_enabled),
    heart_rate_window_share: settings.heart_rate_window_share !== false,
    heart_rate_buffer_seconds: boundedInteger(settings.heart_rate_buffer_seconds, 4, 30, OYON_DEFAULT_SETTINGS.heart_rate_buffer_seconds),
    heart_rate_min_window_seconds: boundedInteger(settings.heart_rate_min_window_seconds, 4, 20, OYON_DEFAULT_SETTINGS.heart_rate_min_window_seconds),
    heart_rate_roi: normalizeHeartRateRoi(settings.heart_rate_roi),
    heart_rate_method: normalizeHeartRateMethod(settings.heart_rate_method),
    heart_rate_target_fps: boundedInteger(settings.heart_rate_target_fps, 5, 60, OYON_DEFAULT_SETTINGS.heart_rate_target_fps),
    heart_rate_min_confidence: boundedNumber(settings.heart_rate_min_confidence, 0, 1, OYON_DEFAULT_SETTINGS.heart_rate_min_confidence),
    heart_rate_max_head_movement_deg: boundedNumber(settings.heart_rate_max_head_movement_deg, 0, 90, OYON_DEFAULT_SETTINGS.heart_rate_max_head_movement_deg),
    heart_rate_anomaly_filter: settings.heart_rate_anomaly_filter !== false,
    heart_rate_harmonic_fold: settings.heart_rate_harmonic_fold !== false,
    heart_rate_fold_tolerance: boundedNumber(settings.heart_rate_fold_tolerance, 0.01, 0.3, OYON_DEFAULT_SETTINGS.heart_rate_fold_tolerance),
    heart_rate_mad_h: boundedNumber(settings.heart_rate_mad_h, 1, 10, OYON_DEFAULT_SETTINGS.heart_rate_mad_h),
    heart_rate_mad_floor_bpm: boundedNumber(settings.heart_rate_mad_floor_bpm, 0, 30, OYON_DEFAULT_SETTINGS.heart_rate_mad_floor_bpm),
    heart_rate_confidence_weighted: settings.heart_rate_confidence_weighted !== false,
    heart_rate_min_weight: boundedNumber(settings.heart_rate_min_weight, 0, 1, OYON_DEFAULT_SETTINGS.heart_rate_min_weight),
    heart_rate_max_slew_bpm_per_s: boundedNumber(settings.heart_rate_max_slew_bpm_per_s, 0, 60, OYON_DEFAULT_SETTINGS.heart_rate_max_slew_bpm_per_s),
    heart_rate_tracker_windows: boundedInteger(settings.heart_rate_tracker_windows, 1, 30, OYON_DEFAULT_SETTINGS.heart_rate_tracker_windows),
    heart_rate_tracker_min_estimates: boundedInteger(settings.heart_rate_tracker_min_estimates, 1, 50, OYON_DEFAULT_SETTINGS.heart_rate_tracker_min_estimates),
    heart_rate_tracker_reset_bpm: boundedNumber(settings.heart_rate_tracker_reset_bpm, 1, 100, OYON_DEFAULT_SETTINGS.heart_rate_tracker_reset_bpm),
    heart_rate_tracker_reset_windows: boundedInteger(settings.heart_rate_tracker_reset_windows, 1, 20, OYON_DEFAULT_SETTINGS.heart_rate_tracker_reset_windows),
    heart_rate_plausible_min_bpm: boundedNumber(settings.heart_rate_plausible_min_bpm, 30, 120, OYON_DEFAULT_SETTINGS.heart_rate_plausible_min_bpm),
    heart_rate_plausible_max_bpm: boundedNumber(settings.heart_rate_plausible_max_bpm, 60, 220, OYON_DEFAULT_SETTINGS.heart_rate_plausible_max_bpm),
    heart_rate_implausible_corroboration: boundedInteger(settings.heart_rate_implausible_corroboration, 1, 20, OYON_DEFAULT_SETTINGS.heart_rate_implausible_corroboration),
    gaze_tracking_enabled: Boolean(settings.gaze_tracking_enabled),
    gaze_engine: normalizeGazeEngineSetting(settings.gaze_engine),
    gaze_window_share: settings.gaze_window_share !== false,
    gaze_calibration_required: settings.gaze_calibration_required !== false,
    gaze_min_calibration_samples: boundedInteger(settings.gaze_min_calibration_samples, 1, 100, OYON_DEFAULT_SETTINGS.gaze_min_calibration_samples),
    gaze_min_quality_score: boundedNumber(settings.gaze_min_quality_score, 0, 1, OYON_DEFAULT_SETTINGS.gaze_min_quality_score),
    gaze_zone_grid: boundedInteger(settings.gaze_zone_grid, 2, 10, OYON_DEFAULT_SETTINGS.gaze_zone_grid),
    gaze_aois: normalizeAois(settings.gaze_aois),
    gaze_drop_off_screen: settings.gaze_drop_off_screen !== false,
    gaze_fixation_min_duration_ms: boundedInteger(settings.gaze_fixation_min_duration_ms, 60, 2000, OYON_DEFAULT_SETTINGS.gaze_fixation_min_duration_ms),
    gaze_fixation_dispersion_threshold: boundedNumber(settings.gaze_fixation_dispersion_threshold, 0.005, 1, OYON_DEFAULT_SETTINGS.gaze_fixation_dispersion_threshold),
    gaze_fixation_min_sample_rate_hz: boundedNumber(settings.gaze_fixation_min_sample_rate_hz, 1, 60, OYON_DEFAULT_SETTINGS.gaze_fixation_min_sample_rate_hz),
    gaze_max_sample_gap_ms: boundedInteger(settings.gaze_max_sample_gap_ms, 50, 5000, OYON_DEFAULT_SETTINGS.gaze_max_sample_gap_ms),
    typing_enabled: Boolean(settings.typing_enabled),
    typing_pause_buckets: normalizeTypingPauseBuckets(settings.typing_pause_buckets),
    typing_burst_threshold_ms: boundedInteger(settings.typing_burst_threshold_ms, 100, 30000, OYON_DEFAULT_SETTINGS.typing_burst_threshold_ms),
    typing_max_intervals: boundedInteger(settings.typing_max_intervals, 1, 50000, OYON_DEFAULT_SETTINGS.typing_max_intervals),
    interaction_enabled: Boolean(settings.interaction_enabled),
    discourse_enabled: Boolean(settings.discourse_enabled),
    ai_assist_enabled: Boolean(settings.ai_assist_enabled),
    document_edit_enabled: Boolean(settings.document_edit_enabled),
    code_run_enabled: Boolean(settings.code_run_enabled),
    voice_enabled: Boolean(settings.voice_enabled),
    voice_frame_ms: boundedInteger(settings.voice_frame_ms, 10, 100, OYON_DEFAULT_SETTINGS.voice_frame_ms),
    voice_vad_threshold: boundedNumber(settings.voice_vad_threshold, 0, 1, OYON_DEFAULT_SETTINGS.voice_vad_threshold),
    voice_min_speech_ms: boundedInteger(settings.voice_min_speech_ms, 0, 5000, OYON_DEFAULT_SETTINGS.voice_min_speech_ms),
    voice_min_silence_ms: boundedInteger(settings.voice_min_silence_ms, 0, 10000, OYON_DEFAULT_SETTINGS.voice_min_silence_ms),
    voice_pause_threshold_ms: boundedInteger(settings.voice_pause_threshold_ms, 0, 30000, OYON_DEFAULT_SETTINGS.voice_pause_threshold_ms),
    voice_request_agc_off: settings.voice_request_agc_off !== false,
    voice_engine: normalizeVoiceEngineSetting(settings.voice_engine),
    voice_worker_enabled: settings.voice_worker_enabled !== false,
    window_anchor_ms: normalizeEpochMs(settings.window_anchor_ms),
    group_clock_url: typeof settings.group_clock_url === 'string' && settings.group_clock_url.trim()
      ? settings.group_clock_url.trim()
      : null,
    group_clock_resync_ms: boundedInteger(settings.group_clock_resync_ms, 5000, 3600000, OYON_DEFAULT_SETTINGS.group_clock_resync_ms),
    multi_face_max_faces: boundedInteger(settings.multi_face_max_faces, 1, 8, OYON_DEFAULT_SETTINGS.multi_face_max_faces),
    multi_face_iou_gate: boundedNumber(settings.multi_face_iou_gate, 0.05, 0.95, OYON_DEFAULT_SETTINGS.multi_face_iou_gate),
    multi_face_confirm_hits: boundedInteger(settings.multi_face_confirm_hits, 1, 30, OYON_DEFAULT_SETTINGS.multi_face_confirm_hits),
    multi_face_coast_ms: boundedInteger(settings.multi_face_coast_ms, 0, 60000, OYON_DEFAULT_SETTINGS.multi_face_coast_ms),
    transport_max_post_bytes: boundedInteger(settings.transport_max_post_bytes, 16384, 67108864, OYON_DEFAULT_SETTINGS.transport_max_post_bytes),
    webgazer_show_face_overlay: Boolean(settings.webgazer_show_face_overlay),
    webgazer_show_prediction_points: Boolean(settings.webgazer_show_prediction_points),
    webgazer_show_face_feedback_box: Boolean(settings.webgazer_show_face_feedback_box),
    webgazer_save_across_sessions: Boolean(settings.webgazer_save_across_sessions),
    webgazer_regression: normalizeRegression(settings.webgazer_regression),
    gaze_calibration_points: settings.gaze_calibration_points === 9 ? 9 : 5,
  };
}

function normalizeGazeEngineSetting(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  // The MediaPipe landmark engine is the project default: it reuses the one
  // face tracker the runtime already runs (no second camera/FaceMesh, no
  // WebGazer singleton — see AGENT-NOTE-GAZE-INTEGRATION.md). 'webgazer' and
  // 'webeyetrack' are explicit opt-ins for calibrated screen-point engines.
  if (v === 'webgazer' || v === 'webeyetrack') return v;
  return 'mediapipe';
}

function normalizeVoiceEngineSetting(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  // Silero is the only production VAD engine today; unknown values fall
  // back to it (mirrors normalizeGazeEngineSetting). Mock adapters are
  // injected directly, not selected here.
  return v === 'silero' ? v : 'silero';
}

/** A finite, non-negative epoch-ms number (or numeric string), else null. */
function normalizeEpochMs(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeRegression(value) {
  if (value === 'weightedRidge' || value === 'threadedRidge') return value;
  return 'ridge';
}

function normalizePostureModel(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (v === 'full' || v === 'heavy') return v;
  return 'lite';
}

function normalizeHeartRateRoi(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (v === 'cheeks' || v === 'face') return v;
  return 'forehead';
}

function normalizeHeartRateMethod(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (v === 'green') return v;
  return 'pos';
}

/**
 * `typing_pause_buckets` must be a strictly ascending array of positive
 * finite numbers (the upper bounds of the pause histogram — see
 * `TypingAggregator.buildPauseHistogramKeys`). Any malformed input falls
 * back to the default array entirely, since a partially-fixed bucket list
 * would silently reorder/re-key the histogram.
 */
function normalizeTypingPauseBuckets(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [...OYON_DEFAULT_SETTINGS.typing_pause_buckets];
  }
  for (let i = 0; i < value.length; i += 1) {
    const n = value[i];
    if (!Number.isFinite(n) || n <= 0) return [...OYON_DEFAULT_SETTINGS.typing_pause_buckets];
    if (i > 0 && n <= value[i - 1]) return [...OYON_DEFAULT_SETTINGS.typing_pause_buckets];
  }
  return value.map(Number);
}

export function normalizeAois(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const a of input) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    if (typeof a.id !== 'string' || a.id.length === 0 || a.id.length > 100) continue;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    if (!Number.isFinite(a.width) || !Number.isFinite(a.height)) continue;
    if (a.width <= 0 || a.height <= 0) continue;
    out.push({ id: a.id, x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) });
    if (out.length >= MAX_AOIS) break;
  }
  return out;
}

export function settingsSnapshot(settings = {}) {
  const normalized = normalizeOyonSettings(settings);
  return {
    ...normalized,
    settings_hash: stableHash(normalized),
  };
}

export function expectedSamplesPerWindow(sampleIntervalMs, aggregateWindowMs) {
  return Math.max(1, Math.floor(aggregateWindowMs / sampleIntervalMs) + 1);
}

export function normalizeFocusScoreWeights(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_FOCUS_SCORE_WEIGHTS };
  }

  const readField = (key) => {
    const raw = Number(input[key]);
    if (!Number.isFinite(raw)) return null;
    if (raw < 0) return 0;
    return raw;
  };

  const blink = readField('blink_penalty');
  const openness = readField('openness');
  const gaze = readField('gaze_stability');

  // If any field is missing/invalid, fall back to defaults entirely.
  if (blink === null || openness === null || gaze === null) {
    return { ...DEFAULT_FOCUS_SCORE_WEIGHTS };
  }

  const sum = blink + openness + gaze;
  if (sum <= 0) return { ...DEFAULT_FOCUS_SCORE_WEIGHTS };

  if (Math.abs(sum - 1) <= 1e-6) {
    return { blink_penalty: blink, openness, gaze_stability: gaze };
  }

  return {
    blink_penalty: blink / sum,
    openness: openness / sum,
    gaze_stability: gaze / sum,
  };
}

function normalizeLegacySettingKeys(settings) {
  const normalized = { ...settings };
  if ('profileId' in normalized) normalized.profile_id = normalized.profileId;
  if ('model' in normalized) normalized.model_profile = normalized.model;
  if ('sampleIntervalMs' in normalized) normalized.sample_interval_ms = normalized.sampleIntervalMs;
  if ('windowMs' in normalized) normalized.aggregate_window_ms = normalized.windowMs;
  if ('minValidFrames' in normalized) normalized.min_valid_frames = normalized.minValidFrames;
  if ('smoothingAlpha' in normalized) normalized.smoothing_alpha = normalized.smoothingAlpha;
  if ('minHoldMs' in normalized) normalized.min_hold_ms = normalized.minHoldMs;
  if ('minSwitchConfidence' in normalized) normalized.switch_confidence = normalized.minSwitchConfidence;
  if ('eyeTrackingEnabled' in normalized) normalized.eye_tracking_enabled = normalized.eyeTrackingEnabled;
  if ('gazeTrackingEnabled' in normalized) normalized.gaze_tracking_enabled = normalized.gazeTrackingEnabled;
  return normalized;
}

function safeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function stableHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
