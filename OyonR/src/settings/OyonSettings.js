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
    gaze_tracking_enabled: Boolean(settings.gaze_tracking_enabled),
    gaze_engine: normalizeGazeEngineSetting(settings.gaze_engine),
    gaze_window_share: settings.gaze_window_share !== false,
    gaze_calibration_required: settings.gaze_calibration_required !== false,
    gaze_min_calibration_samples: boundedInteger(settings.gaze_min_calibration_samples, 1, 100, OYON_DEFAULT_SETTINGS.gaze_min_calibration_samples),
    gaze_min_quality_score: boundedNumber(settings.gaze_min_quality_score, 0, 1, OYON_DEFAULT_SETTINGS.gaze_min_quality_score),
    gaze_zone_grid: boundedInteger(settings.gaze_zone_grid, 2, 10, OYON_DEFAULT_SETTINGS.gaze_zone_grid),
    gaze_aois: normalizeAois(settings.gaze_aois),
    gaze_drop_off_screen: settings.gaze_drop_off_screen !== false,
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

function normalizeRegression(value) {
  if (value === 'weightedRidge' || value === 'threadedRidge') return value;
  return 'ridge';
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
