export const OYON_SETTINGS_SCHEMA_VERSION = 'oyon-settings-v1';

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
});

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
  };
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
