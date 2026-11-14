import {
  OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS,
  OYON_MODALITIES,
  OYON_WINDOW_KINDS,
} from '../version.js';

export const ALLOWED_EMOTIONS = ['neutral', 'happy', 'sad', 'surprise', 'anger', 'fear', 'disgust', 'contempt'];

const MAX_BATCH_EVENTS = 120;
const MAX_JSON_STRING_LENGTH = 20_000;

/**
 * Modality-scoped windows the runtime emits on their own cadence, without a
 * camera/emotion classification attached (see EmotionRuntime.sendWindows).
 * Such an event carries `<modality>_only: true` plus its own block, so the
 * emotion scalars (`confidence`, `valid_frames`, `missing_face_ratio`) are
 * legitimately absent and must not be required.
 */
export const MODALITY_ONLY_FLAGS = Object.freeze([
  'engagement_only',
  'facial_only',
  'gaze_only',
  'heart_rate_only',
  'posture_only',
]);

/**
 * True when the event is a modality-scoped window rather than an emotion window.
 *
 * Two spellings are accepted. `modality: '<name>'` (batch schema v4) is the one
 * to write; the `<x>_only: true` booleans are the v3 spelling and stay valid so
 * existing hosts keep working. `MODALITY_ONLY_FLAGS` is the migration seam —
 * once no host emits the booleans it can go, and this collapses to a check on
 * `modality`.
 */
export function isModalityOnlyEvent(event) {
  if (typeof event?.modality === 'string' && event.modality !== 'emotion') return true;
  return MODALITY_ONLY_FLAGS.some(flag => event?.[flag] === true);
}

const FORBIDDEN_RAW_MEDIA_FIELDS = new Set([
  'frame', 'frames', 'image', 'images', 'video', 'blob', 'base64', 'pixels', 'landmarks',
  'iris_landmarks_raw', 'gaze_points_raw', 'pupil_diameter_px',
  'gaze_raw', 'gaze_trace', 'points_raw', 'eye_patch', 'eye_image',
]);

const FORBIDDEN_GAZE_FIELDS = [
  'points',
];

/** Allowlisted host references a window may name. Never content, never a selector. */
const ALLOWED_TARGET_KINDS = [
  'chat_composer',
  'text_input',
  'textarea',
  'voice_control',
  // Editors a host attaches through the contenteditable adapter or reports
  // through createTypingEditReporter.
  'document_editor',
  'code_editor',
  'form_field',
];

/**
 * The composed text is the host's record, not Oyon's — carrying it in a signal
 * window would duplicate storage the host already owns. This is a redundancy
 * rule, not a privacy rule: the raw timing series IS carried (see
 * validateTypingBlock).
 */
const FORBIDDEN_TYPING_FIELDS = ['text', 'value', 'content', 'draft', 'snapshot', 'clipboard'];

/** Transport bound on the per-window interval series; longer episodes split. */
const MAX_TYPING_INTERVALS = 5_000;

/**
 * `typing-v2` bounds `revision_locations` by the SAME cap as
 * `inter_event_intervals_ms` (`options.maxIntervals` in `TypingAggregator`),
 * so the validator reuses `MAX_TYPING_INTERVALS` / `options.maxTypingIntervals`
 * here too rather than introducing a second, independently-tunable limit.
 */
const MAX_TYPING_REVISION_LOCATION_OP_LENGTH = 40;

/**
 * `typing-v3` `pause_location_counts` keys — mirrors the `boundaryContext`
 * enum `TypingAggregator.record()` accepts (`src/aggregation/TypingAggregator.js`).
 * Kept local, not in `src/version.js`: it describes a `record()` input shape,
 * not a per-event state on the `OYON_TYPING_STATES` wire vocabulary.
 */
const TYPING_PAUSE_LOCATION_KEYS = ['mid_word', 'word_boundary', 'sentence_boundary', 'paragraph_boundary'];

/**
 * `ai_assist` never carries the suggestion text either — same redundancy
 * rule as `FORBIDDEN_TYPING_FIELDS` above (the host already stores it), plus
 * `AiAssistTracker` (`src/capture/AiAssistTracker.js`) enforces the identical
 * check client-side before an event is ever built. Kept as a second,
 * server-side gate in case a host bypasses the tracker and builds windows
 * by hand.
 */
const FORBIDDEN_AI_ASSIST_FIELDS = ['text', 'content', 'suggestion', 'body'];

/**
 * `discourse` (`text-v1`) never carries the composed text, per-sentence text,
 * or a raw text dump — same redundancy rule as `FORBIDDEN_TYPING_FIELDS` /
 * `FORBIDDEN_AI_ASSIST_FIELDS` above: the host already stores the message
 * the sentences came from. `DiscourseAggregator`
 * (`src/aggregation/DiscourseAggregator.js`) never builds these fields to
 * begin with; this is a second, server-side gate in case a host assembles a
 * `text` block by hand.
 */
const FORBIDDEN_TEXT_FIELDS = ['text', 'content', 'sentences', 'raw'];

/**
 * Transport bound on `ai_assist.chosen_index_counts` — mirrors
 * `AiAssistAggregator`'s own `maxChosenIndexKeys` default
 * (`src/aggregation/AiAssistAggregator.js`).
 */
const MAX_AI_ASSIST_CHOSEN_INDEX_KEYS = 64;

/**
 * `voice-v1` transport bounds (`src/aggregation/VoiceTurnAggregator.js`).
 * `insufficient_reasons` is a handful of short machine-readable slugs;
 * `pause_histogram` has one key per configured bucket (five by default).
 * Length caps, not censorship — see the note on validateVoiceBlock.
 */
const MAX_VOICE_INSUFFICIENT_REASONS = 16;
const MAX_VOICE_REASON_LENGTH = 64;
const MAX_VOICE_HISTOGRAM_KEYS = 32;

/**
 * Transport bound on `interaction.aoi_dwell_ms` / `interaction.aoi_click_counts`
 * key counts — a page-wide AOI set stays small (a handful of registered
 * regions), so this is a defense-in-depth cap, not an expected ceiling; a
 * transport-shape check, never a privacy gate (CLAUDE.md's data policy).
 */
const MAX_INTERACTION_AOI_KEYS = 200;

const NAMED_3x3_ZONES = new Set([
  'top_left',    'top_center',    'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
]);

const MAX_GAZE_ARRAY_LENGTH = 100;

const ALLOWED_GAZE_ZONES = ['center', 'left', 'right', 'up', 'down'];

export function validateEmotionBatch(payload, options = {}) {
  const errors = [];
  const events = payload?.events;
  const schemaVersion = payload?.schema_version ?? null;
  const maxBatchEvents = options.maxBatchEvents || MAX_BATCH_EVENTS;

  if (schemaVersion !== null) {
    if (typeof schemaVersion !== 'string') {
      errors.push('schema_version must be a string when provided');
    } else if (!OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS.includes(schemaVersion)) {
      errors.push(`schema_version '${schemaVersion}' is not supported`);
    }
  }

  if (!Array.isArray(events)) {
    errors.push('events must be an array');
    return { ok: false, errors, schemaVersion };
  }
  if (events.length === 0) errors.push('events must not be empty');
  if (events.length > maxBatchEvents) errors.push(`events must contain at most ${maxBatchEvents} items`);

  events.forEach((event, index) => {
    errors.push(...validateEmotionEvent(event, index, options));
  });

  return { ok: errors.length === 0, errors, schemaVersion };
}

export function validateEmotionEvent(event, index = 0, options = {}) {
  const errors = [];
  const prefix = `events[${index}]`;

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return [`${prefix} must be an object`];
  }

  rejectNestedRawMediaFields(event, prefix, errors);
  requiredIsoDate(event.window_start, `${prefix}.window_start`, errors);
  requiredIsoDate(event.window_end, `${prefix}.window_end`, errors);

  if (event.modality !== null && event.modality !== undefined) {
    if (!OYON_MODALITIES.includes(event.modality)) {
      errors.push(`${prefix}.modality '${event.modality}' is not a known modality`);
    }
  }
  if (event.window_kind !== null && event.window_kind !== undefined) {
    if (!OYON_WINDOW_KINDS.includes(event.window_kind)) {
      errors.push(`${prefix}.window_kind must be one of ${OYON_WINDOW_KINDS.join(', ')}`);
    }
  }
  optionalShortString(event.feature_profile, `${prefix}.feature_profile`, 100, errors);
  optionalShortString(event.settings_hash, `${prefix}.settings_hash`, 128, errors);
  // Raw-only envelopes and split windows: transport shape only (the rows
  // themselves are checked by validateRawStreamsBlock).
  optionalShortString(event.raw_reason, `${prefix}.raw_reason`, 64, errors);
  validateRawPart(event.raw_part, `${prefix}.raw_part`, errors);
  validateTargetBlock(event.target, `${prefix}.target`, errors);

  if (event.dominant_emotion !== null && event.dominant_emotion !== undefined) {
    if (!ALLOWED_EMOTIONS.includes(event.dominant_emotion)) {
      errors.push(`${prefix}.dominant_emotion is not allowed`);
    }
  }

  if (event.probabilities !== null && event.probabilities !== undefined) {
    if (!isPlainObject(event.probabilities)) {
      errors.push(`${prefix}.probabilities must be an object or null`);
    } else {
      const labels = Object.keys(event.probabilities);
      if (labels.some(label => !ALLOWED_EMOTIONS.includes(label))) {
        errors.push(`${prefix}.probabilities contains unsupported labels`);
      }
      for (const [label, value] of Object.entries(event.probabilities)) {
        boundedNumber(value, `${prefix}.probabilities.${label}`, 0, 1, errors);
      }
      const sum = Object.values(event.probabilities).reduce((total, value) => total + (Number(value) || 0), 0);
      if (sum > 0 && (sum < 0.95 || sum > 1.05)) {
        errors.push(`${prefix}.probabilities should sum close to 1`);
      }
    }
  }

  nullableBoundedNumber(event.valence, `${prefix}.valence`, -1, 1, errors);
  nullableBoundedNumber(event.arousal, `${prefix}.arousal`, -1, 1, errors);

  nullableBoundedNumber(event.entropy, `${prefix}.entropy`, 0, 8, errors);

  // Modality-scoped windows (engagement/facial/gaze/heart-rate/posture) carry no
  // emotion classification, so the emotion scalars may be absent — validate them
  // only when present. Emotion windows still enforce the v0.2.2 contract.
  if (isModalityOnlyEvent(event)) {
    if (event.confidence !== null && event.confidence !== undefined) {
      boundedNumber(event.confidence, `${prefix}.confidence`, 0, 1, errors);
    }
    if (event.valid_frames !== null && event.valid_frames !== undefined) {
      integerAtLeast(event.valid_frames, `${prefix}.valid_frames`, 0, errors);
    }
    if (event.missing_face_ratio !== null && event.missing_face_ratio !== undefined) {
      boundedNumber(event.missing_face_ratio, `${prefix}.missing_face_ratio`, 0, 1, errors);
    }
  } else {
    boundedNumber(event.confidence, `${prefix}.confidence`, 0, 1, errors);
    integerAtLeast(event.valid_frames, `${prefix}.valid_frames`, 0, errors);
    boundedNumber(event.missing_face_ratio, `${prefix}.missing_face_ratio`, 0, 1, errors);
  }

  optionalShortString(event.model_name, `${prefix}.model_name`, 200, errors);
  optionalShortString(event.model_version, `${prefix}.model_version`, 100, errors);
  optionalShortString(event.capture_mode, `${prefix}.capture_mode`, 100, errors);
  optionalShortString(event.consent_version, `${prefix}.consent_version`, 100, errors);

  jsonSize(event.quality, `${prefix}.quality`, options.maxJsonStringLength || MAX_JSON_STRING_LENGTH, errors);

  validateEngagementBlock(event.engagement, `${prefix}.engagement`, errors);
  validateGazeBlock(event.gaze, `${prefix}.gaze`, errors);
  validateCaptureQualityBlock(event.capture_quality, `${prefix}.capture_quality`, errors);
  validateTypingBlock(event.typing, `${prefix}.typing`, errors, options);
  validateAiAssistBlock(event.ai_assist, `${prefix}.ai_assist`, errors, options);
  validateInteractionBlock(event.interaction, `${prefix}.interaction`, errors);
  validateTextBlock(event.text, `${prefix}.text`, errors);
  validateVoiceBlock(event.voice, `${prefix}.voice`, errors);
  validateRawStreamsBlock(event.raw_streams, `${prefix}.raw_streams`, errors, options);

  return errors;
}

/**
 * Transport bounds for `raw_streams` — the per-sample series every window
 * carries (src/aggregation/RawStreamRecorder.js). Shape and size only: this is
 * NOT a gate on which signals may travel (CLAUDE.md data policy) — any stream
 * name and any field list is accepted; only the columnar layout and the
 * per-event byte budget are checked.
 */
const MAX_RAW_STREAM_BYTES = 1_000_000;
const MAX_RAW_STREAM_FIELDS = 256;
const MAX_RAW_STREAM_NAME = 64;
const MAX_RAW_STREAM_CELL_STRING = 200;
const RAW_STREAM_NAME = /^[a-z][a-z0-9_]*$/;

export function validateRawStreamsBlock(rawStreams, prefix, errors, options = {}) {
  if (rawStreams === null || rawStreams === undefined) return;
  if (!isPlainObject(rawStreams)) {
    errors.push(`${prefix} must be an object of streams`);
    return;
  }
  for (const [name, block] of Object.entries(rawStreams)) {
    const path = `${prefix}.${name}`;
    if (name.length > MAX_RAW_STREAM_NAME || !RAW_STREAM_NAME.test(name)) {
      errors.push(`${path}: stream names are lower_snake_case, at most ${MAX_RAW_STREAM_NAME} characters`);
      continue;
    }
    if (!isPlainObject(block) || !Array.isArray(block.fields) || !Array.isArray(block.rows)) {
      errors.push(`${path} must be { fields: string[], rows: any[][] }`);
      continue;
    }
    const { fields, rows } = block;
    if (fields.length < 1 || fields.length > MAX_RAW_STREAM_FIELDS
      || fields.some(f => typeof f !== 'string' || !f || f.length > MAX_RAW_STREAM_NAME)) {
      errors.push(`${path}.fields must be 1-${MAX_RAW_STREAM_FIELDS} non-empty strings`);
      continue;
    }
    if (fields[0] !== 'ts_ms') errors.push(`${path}.fields[0] must be 'ts_ms'`);
    if (new Set(fields).size !== fields.length) errors.push(`${path}.fields must be unique`);
    const badRow = rows.findIndex(row => !Array.isArray(row) || row.length !== fields.length
      || row.some(cell => !(cell === null || Number.isFinite(cell)
        || (typeof cell === 'string' && cell.length <= MAX_RAW_STREAM_CELL_STRING))));
    if (badRow >= 0) {
      errors.push(`${path}.rows[${badRow}] must have one number/short-string/null cell per field`);
    }
    if (block.dropped_rows !== undefined) integerAtLeast(block.dropped_rows, `${path}.dropped_rows`, 0, errors);
  }
  jsonSize(rawStreams, prefix, options.maxRawStreamBytes || MAX_RAW_STREAM_BYTES, errors);
}

function rejectNestedRawMediaFields(root, prefix, errors) {
  const seen = new WeakSet();
  const pending = [{ value: root, path: prefix }];

  while (pending.length > 0) {
    const { value, path } = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);

    for (const [key, item] of Object.entries(value)) {
      const itemPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (FORBIDDEN_RAW_MEDIA_FIELDS.has(key)) {
        errors.push(`${itemPath} is forbidden; raw media and landmarks must not be sent`);
      } else if (key.startsWith('eye_image_')) {
        errors.push(`${itemPath} is forbidden; eye image fields must not be sent`);
      }
      if (item && typeof item === 'object') pending.push({ value: item, path: itemPath });
    }
  }
}

export function validateEngagementBlock(engagement, prefix, errors) {
  if (engagement === null || engagement === undefined) return;
  if (!isPlainObject(engagement)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Counts (non-negative integers, nullable).
  nullableIntegerAtLeast(engagement.blink_count, `${prefix}.blink_count`, 0, errors);
  nullableIntegerAtLeast(engagement.valid_frames, `${prefix}.valid_frames`, 0, errors);
  nullableIntegerAtLeast(engagement.total_frames, `${prefix}.total_frames`, 0, errors);
  nullableIntegerAtLeast(engagement.expected_samples, `${prefix}.expected_samples`, 0, errors);
  nullableFiniteNumberMin(engagement.duration_ms, `${prefix}.duration_ms`, 0, errors);

  // Bounded numbers (nullable).
  nullableBoundedNumber(engagement.blink_rate_hz, `${prefix}.blink_rate_hz`, 0, 100, errors);
  nullableBoundedNumber(engagement.eye_openness_mean, `${prefix}.eye_openness_mean`, 0, 1, errors);
  nullableBoundedNumber(engagement.eye_openness_std, `${prefix}.eye_openness_std`, 0, 1, errors);
  nullableBoundedNumber(engagement.gaze_entropy, `${prefix}.gaze_entropy`, 0, 1, errors);
  nullableBoundedNumber(engagement.focus_score, `${prefix}.focus_score`, 0, 1, errors);
  nullableBoundedNumber(engagement.valid_frame_ratio, `${prefix}.valid_frame_ratio`, 0, 1, errors);

  // gaze_zone_proportions.
  if (engagement.gaze_zone_proportions !== null && engagement.gaze_zone_proportions !== undefined) {
    if (!isPlainObject(engagement.gaze_zone_proportions)) {
      errors.push(`${prefix}.gaze_zone_proportions must be an object or null`);
    } else {
      const keys = Object.keys(engagement.gaze_zone_proportions);
      const badKey = keys.find(k => !ALLOWED_GAZE_ZONES.includes(k));
      if (badKey) {
        errors.push(`${prefix}.gaze_zone_proportions has unsupported zone '${badKey}'`);
      }
      let sum = 0;
      let sawValid = true;
      for (const [zone, value] of Object.entries(engagement.gaze_zone_proportions)) {
        if (!Number.isFinite(value)) {
          errors.push(`${prefix}.gaze_zone_proportions.${zone} must be a finite number`);
          sawValid = false;
          continue;
        }
        if (value < 0 || value > 1) {
          errors.push(`${prefix}.gaze_zone_proportions.${zone} must be between 0 and 1`);
          sawValid = false;
          continue;
        }
        sum += value;
      }
      if (sawValid && keys.length > 0 && (sum < 0.95 || sum > 1.05)) {
        errors.push(`${prefix}.gaze_zone_proportions should sum close to 1`);
      }
    }
  }

  // focus_score_components.
  if (engagement.focus_score_components !== null && engagement.focus_score_components !== undefined) {
    if (!isPlainObject(engagement.focus_score_components)) {
      errors.push(`${prefix}.focus_score_components must be an object or null`);
    } else {
      nullableBoundedNumber(engagement.focus_score_components.blink, `${prefix}.focus_score_components.blink`, 0, 1, errors);
      nullableBoundedNumber(engagement.focus_score_components.openness, `${prefix}.focus_score_components.openness`, 0, 1, errors);
      nullableBoundedNumber(engagement.focus_score_components.gaze_stability, `${prefix}.focus_score_components.gaze_stability`, 0, 1, errors);
    }
  }

  // ISO date strings (optional inside engagement).
  if (engagement.window_start !== null && engagement.window_start !== undefined) {
    requiredIsoDate(engagement.window_start, `${prefix}.window_start`, errors);
  }
  if (engagement.window_end !== null && engagement.window_end !== undefined) {
    requiredIsoDate(engagement.window_end, `${prefix}.window_end`, errors);
  }

  optionalShortString(engagement.model_version, `${prefix}.model_version`, 100, errors);
}

export function validateGazeBlock(gaze, prefix, errors) {
  if (gaze === null || gaze === undefined) return;
  if (!isPlainObject(gaze)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Reject forbidden nested fields (raw frames, raw point arrays, eye patches).
  for (const field of FORBIDDEN_GAZE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(gaze, field)) {
      errors.push(`${prefix}.${field} is forbidden; raw media and raw point arrays must not be sent`);
    }
  }

  // Defense in depth: any unexpectedly large array inside `gaze` is a PII smell.
  for (const [key, value] of Object.entries(gaze)) {
    if (Array.isArray(value) && value.length > MAX_GAZE_ARRAY_LENGTH) {
      errors.push(`${prefix}.${key} array length ${value.length} exceeds ${MAX_GAZE_ARRAY_LENGTH}; aggregate-only payloads`);
    }
    if (key.endsWith('_array') || key.endsWith('_trace') || key.endsWith('_raw')) {
      errors.push(`${prefix}.${key} is forbidden by naming convention; aggregate-only payloads`);
    }
  }

  // Counts and durations.
  nullableIntegerAtLeast(gaze.n_points, `${prefix}.n_points`, 0, errors);
  nullableIntegerAtLeast(gaze.total_frames, `${prefix}.total_frames`, 0, errors);
  nullableIntegerAtLeast(gaze.fixation_count, `${prefix}.fixation_count`, 0, errors);
  nullableIntegerAtLeast(gaze.off_screen_episode_count, `${prefix}.off_screen_episode_count`, 0, errors);
  nullableIntegerAtLeast(gaze.aoi_transition_count, `${prefix}.aoi_transition_count`, 0, errors);
  nullableFiniteNumberMin(gaze.duration_ms, `${prefix}.duration_ms`, 0, errors);
  nullableFiniteNumberMin(gaze.calibration_age_ms, `${prefix}.calibration_age_ms`, 0, errors);
  for (const field of [
    'fixation_duration_ms_total',
    'fixation_duration_ms_mean',
    'fixation_duration_ms_median',
    'fixation_duration_ms_max',
    'scanpath_length',
    'fixation_min_duration_ms',
    'fixation_dispersion_threshold',
    'observed_sample_interval_ms',
    'observed_sample_rate_hz',
    'max_observed_sample_gap_ms',
  ]) {
    nullableFiniteNumberMin(gaze[field], `${prefix}.${field}`, 0, errors);
  }

  // Bounded ratios.
  nullableBoundedNumber(gaze.valid_frame_ratio, `${prefix}.valid_frame_ratio`, 0, 1, errors);
  nullableBoundedNumber(gaze.off_screen_ratio, `${prefix}.off_screen_ratio`, 0, 1, errors);
  nullableBoundedNumber(gaze.calibration_quality, `${prefix}.calibration_quality`, 0, 1, errors);
  nullableBoundedNumber(gaze.aoi_transition_entropy, `${prefix}.aoi_transition_entropy`, 0, 1, errors);

  if (gaze.fixation_sampling_adequate !== undefined && typeof gaze.fixation_sampling_adequate !== 'boolean') {
    errors.push(`${prefix}.fixation_sampling_adequate must be a boolean`);
  }
  if (gaze.timing_source !== undefined && gaze.timing_source !== 'timestamps' && gaze.timing_source !== 'fallback') {
    errors.push(`${prefix}.timing_source must be 'timestamps' or 'fallback'`);
  }

  // calibration_confidence: optional enum disclosing how `calibration_quality`
  // was derived. Missing field is allowed for back-compat with older windows.
  if (gaze.calibration_confidence !== undefined && gaze.calibration_confidence !== null) {
    if (
      gaze.calibration_confidence !== 'measured' &&
      gaze.calibration_confidence !== 'inferred' &&
      gaze.calibration_confidence !== 'unknown'
    ) {
      errors.push(`${prefix}.calibration_confidence must be 'measured', 'inferred', or 'unknown'`);
    }
  }

  // Centroid: object with x, y in [-0.5, 0.5] (allow a small overshoot tolerance
  // for floating-point noise around the screen edge).
  if (gaze.centroid !== null && gaze.centroid !== undefined) {
    if (!isPlainObject(gaze.centroid)) {
      errors.push(`${prefix}.centroid must be an object or null`);
    } else {
      nullableBoundedNumber(gaze.centroid.x, `${prefix}.centroid.x`, -0.6, 0.6, errors);
      nullableBoundedNumber(gaze.centroid.y, `${prefix}.centroid.y`, -0.6, 0.6, errors);
    }
  }

  // Dispersion: non-negative scalar.
  nullableFiniteNumberMin(gaze.dispersion, `${prefix}.dispersion`, 0, errors);

  // zone_proportions: keys must all be from 3x3 named set OR all of form r<n>c<n>.
  if (gaze.zone_proportions !== null && gaze.zone_proportions !== undefined) {
    if (!isPlainObject(gaze.zone_proportions)) {
      errors.push(`${prefix}.zone_proportions must be an object or null`);
    } else {
      const keys = Object.keys(gaze.zone_proportions);
      const all3x3 = keys.every(k => NAMED_3x3_ZONES.has(k));
      const allIndexed = keys.every(k => /^r\d+c\d+$/.test(k));
      if (keys.length > 0 && !all3x3 && !allIndexed) {
        errors.push(`${prefix}.zone_proportions keys must all be 3x3 named or all r<n>c<n>`);
      }
      let sum = 0;
      let sawValid = true;
      for (const [zone, value] of Object.entries(gaze.zone_proportions)) {
        if (!Number.isFinite(value)) {
          errors.push(`${prefix}.zone_proportions.${zone} must be a finite number`);
          sawValid = false;
          continue;
        }
        if (value < 0 || value > 1) {
          errors.push(`${prefix}.zone_proportions.${zone} must be between 0 and 1`);
          sawValid = false;
          continue;
        }
        sum += value;
      }
      if (sawValid && keys.length > 0 && (sum < 0.95 || sum > 1.05)) {
        errors.push(`${prefix}.zone_proportions should sum close to 1`);
      }
    }
  }

  // aoi_dwell_ms: optional object whose values are non-negative numbers.
  if (gaze.aoi_dwell_ms !== null && gaze.aoi_dwell_ms !== undefined) {
    if (!isPlainObject(gaze.aoi_dwell_ms)) {
      errors.push(`${prefix}.aoi_dwell_ms must be an object or null`);
    } else {
      for (const [aoiId, value] of Object.entries(gaze.aoi_dwell_ms)) {
        if (typeof aoiId !== 'string' || aoiId.length > 100) {
          errors.push(`${prefix}.aoi_dwell_ms has invalid id`);
          continue;
        }
        if (!Number.isFinite(value) || value < 0) {
          errors.push(`${prefix}.aoi_dwell_ms.${aoiId} must be a non-negative number`);
        }
      }
    }
  }

  validateNonNegativeMap(gaze.aoi_entries, `${prefix}.aoi_entries`, errors, { integers: true });
  validateNonNegativeMap(gaze.aoi_revisits, `${prefix}.aoi_revisits`, errors, { integers: true });
  validateNonNegativeMap(gaze.aoi_time_to_first_ms, `${prefix}.aoi_time_to_first_ms`, errors, { nullable: true });
  validateNonNegativeMap(gaze.aoi_transitions, `${prefix}.aoi_transitions`, errors, { integers: true, maxKeyLength: 201 });

  // ISO date strings (optional inside gaze, mirror engagement).
  if (gaze.window_start !== null && gaze.window_start !== undefined) {
    requiredIsoDate(gaze.window_start, `${prefix}.window_start`, errors);
  }
  if (gaze.window_end !== null && gaze.window_end !== undefined) {
    requiredIsoDate(gaze.window_end, `${prefix}.window_end`, errors);
  }

  optionalShortString(gaze.model_version, `${prefix}.model_version`, 100, errors);
  optionalShortString(gaze.fixation_algorithm, `${prefix}.fixation_algorithm`, 100, errors);
}

export function validateCaptureQualityBlock(capture, prefix, errors) {
  if (capture === null || capture === undefined) return;
  if (!isPlainObject(capture)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }
  jsonSize(capture, prefix, MAX_JSON_STRING_LENGTH, errors);
  rejectPrivateCameraKeys(capture, prefix, errors, 0);
  if (capture.available !== undefined && typeof capture.available !== 'boolean') {
    errors.push(`${prefix}.available must be a boolean`);
  }
  const timing = capture.timing;
  if (timing == null) return;
  if (!isPlainObject(timing)) {
    errors.push(`${prefix}.timing must be an object or null`);
    return;
  }
  if (timing.source !== undefined && timing.source !== 'requestVideoFrameCallback' && timing.source !== 'unavailable') {
    errors.push(`${prefix}.timing.source is unsupported`);
  }
  for (const name of ['window', 'lifetime']) {
    const summary = timing[name];
    if (summary == null) continue;
    if (!isPlainObject(summary)) {
      errors.push(`${prefix}.timing.${name} must be an object`);
      continue;
    }
    nullableIntegerAtLeast(summary.frames_observed, `${prefix}.timing.${name}.frames_observed`, 0, errors);
    nullableIntegerAtLeast(summary.estimated_dropped_frames, `${prefix}.timing.${name}.estimated_dropped_frames`, 0, errors);
    nullableBoundedNumber(summary.drop_ratio, `${prefix}.timing.${name}.drop_ratio`, 0, 1, errors);
    if (
      summary.drop_estimate_source !== undefined
      && summary.drop_estimate_source !== 'selected_frame_rate'
      && summary.drop_estimate_source !== 'presented_frames'
    ) {
      errors.push(`${prefix}.timing.${name}.drop_estimate_source is unsupported`);
    }
    for (const field of ['observed_fps', 'frame_interval_ms_mean', 'frame_interval_ms_std', 'max_frame_gap_ms', 'span_ms']) {
      nullableFiniteNumberMin(summary[field], `${prefix}.timing.${name}.${field}`, 0, errors);
    }
  }
}

/**
 * `target` is the host's own reference to whatever the learner was interacting
 * with (a composer, a voice control). It is an allowlisted kind plus an opaque
 * host-safe id — never content, never a selector, never a DOM path.
 */
export function validateTargetBlock(target, prefix, errors) {
  if (target === null || target === undefined) return;
  if (!isPlainObject(target)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }
  if (!ALLOWED_TARGET_KINDS.includes(target.kind)) {
    errors.push(`${prefix}.kind must be one of ${ALLOWED_TARGET_KINDS.join(', ')}`);
  }
  optionalShortString(target.id, `${prefix}.id`, 200, errors);
  for (const key of Object.keys(target)) {
    if (key !== 'kind' && key !== 'id') {
      errors.push(`${prefix}.${key} is not part of the target contract`);
    }
  }
}

/**
 * `typing-v1` block. Shape and range only.
 *
 * Note on `inter_event_intervals_ms`: the raw interval series is carried
 * deliberately — the pause histogram is derived from it, so discarding it
 * would lose signal that cannot be recovered. The length cap below is a
 * transport bound (keep one window from growing without limit), not a privacy
 * measure; an episode that exceeds it splits into multiple windows rather than
 * being truncated. See docs/TYPING.md and audio_text.md §4.3.
 */
export function validateTypingBlock(typing, prefix, errors, options = {}) {
  if (typing === null || typing === undefined) return;
  if (!isPlainObject(typing)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Oyon never carries the composed text — the host already stores it.
  for (const field of FORBIDDEN_TYPING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(typing, field)) {
      errors.push(`${prefix}.${field} is forbidden; the host owns the message text`);
    }
  }

  for (const field of [
    'elapsed_ms', 'active_input_ms', 'first_input_latency_ms',
  ]) {
    nullableFiniteNumberMin(typing[field], `${prefix}.${field}`, 0, errors);
  }

  for (const field of [
    'committed_graphemes', 'inserted_graphemes', 'deleted_graphemes',
    'replacement_graphemes', 'pasted_graphemes', 'edit_event_count',
    'composition_count', 'correction_count', 'burst_count',
  ]) {
    nullableIntegerAtLeast(typing[field], `${prefix}.${field}`, 0, errors);
  }

  nullableFiniteNumberMin(typing.revision_ratio, `${prefix}.revision_ratio`, 0, errors);
  nullableFiniteNumberMin(typing.production_rate_per_active_min, `${prefix}.production_rate_per_active_min`, 0, errors);

  if (typing.submitted !== undefined && typing.submitted !== null && typeof typing.submitted !== 'boolean') {
    errors.push(`${prefix}.submitted must be a boolean`);
  }
  if (typing.abandoned !== undefined && typing.abandoned !== null && typeof typing.abandoned !== 'boolean') {
    errors.push(`${prefix}.abandoned must be a boolean`);
  }

  validateNonNegativeMap(typing.pause_histogram, `${prefix}.pause_histogram`, errors);

  const intervals = typing.inter_event_intervals_ms;
  if (intervals !== null && intervals !== undefined) {
    const maxLength = options.maxTypingIntervals || MAX_TYPING_INTERVALS;
    if (!Array.isArray(intervals)) {
      errors.push(`${prefix}.inter_event_intervals_ms must be an array or null`);
    } else if (intervals.length > maxLength) {
      errors.push(`${prefix}.inter_event_intervals_ms must contain at most ${maxLength} items; split the episode into multiple windows`);
    } else if (intervals.some(value => !Number.isFinite(value) || value < 0)) {
      errors.push(`${prefix}.inter_event_intervals_ms must contain only non-negative finite numbers`);
    }
  }

  // `typing-v2` addition. Additive and optional — a `typing-v1` payload that
  // omits `revision_locations` entirely stays valid (see docs/TYPING.md).
  // One entry per positioned edit event: `{ offset, length, op, t }`, giving
  // revision LOCATION (where/when), never the edited text itself.
  const revisionLocations = typing.revision_locations;
  if (revisionLocations !== null && revisionLocations !== undefined) {
    const maxLength = options.maxTypingIntervals || MAX_TYPING_INTERVALS;
    if (!Array.isArray(revisionLocations)) {
      errors.push(`${prefix}.revision_locations must be an array or null`);
    } else if (revisionLocations.length > maxLength) {
      errors.push(`${prefix}.revision_locations must contain at most ${maxLength} items; split the episode into multiple windows`);
    } else {
      revisionLocations.forEach((entry, index) => {
        const entryPrefix = `${prefix}.revision_locations[${index}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${entryPrefix} must be an object`);
          return;
        }
        boundedNumber(entry.offset, `${entryPrefix}.offset`, 0, Number.MAX_SAFE_INTEGER, errors);
        boundedNumber(entry.length, `${entryPrefix}.length`, 0, Number.MAX_SAFE_INTEGER, errors);
        optionalShortString(entry.op, `${entryPrefix}.op`, MAX_TYPING_REVISION_LOCATION_OP_LENGTH, errors);
        if (typeof entry.op !== 'string' || entry.op.length === 0) {
          errors.push(`${entryPrefix}.op must be a non-empty string`);
        }
        if (!Number.isFinite(entry.t)) {
          errors.push(`${entryPrefix}.t must be a finite number`);
        }
        // typing-v3 additions on each entry — both optional, so a
        // typing-v2-shaped entry (no `wall_ms` / `distance`) stays valid.
        nullableFiniteNumberMin(entry.wall_ms, `${entryPrefix}.wall_ms`, 0, errors);
        nullableFiniteNumberMin(entry.distance, `${entryPrefix}.distance`, 0, errors);
      });
    }
  }

  if (typing.revision_locations_truncated !== undefined && typing.revision_locations_truncated !== null
    && typeof typing.revision_locations_truncated !== 'boolean') {
    errors.push(`${prefix}.revision_locations_truncated must be a boolean`);
  }

  // ---- typing-v3 ----
  // Absolute-time anchor for `inter_event_intervals_ms`; same shape/cap rules.
  const editTimestamps = typing.edit_timestamps_ms;
  if (editTimestamps !== null && editTimestamps !== undefined) {
    const maxLength = options.maxTypingIntervals || MAX_TYPING_INTERVALS;
    if (!Array.isArray(editTimestamps)) {
      errors.push(`${prefix}.edit_timestamps_ms must be an array or null`);
    } else if (editTimestamps.length > maxLength) {
      errors.push(`${prefix}.edit_timestamps_ms must contain at most ${maxLength} items; split the episode into multiple windows`);
    } else if (editTimestamps.some(value => !Number.isFinite(value) || value < 0)) {
      errors.push(`${prefix}.edit_timestamps_ms must contain only non-negative finite numbers`);
    }
  }

  // P-burst / R-burst counts and grapheme/word means. `mean_burst_words` is
  // nullable (absent when the episode never carried word counts).
  for (const field of ['p_burst_count', 'r_burst_count']) {
    nullableIntegerAtLeast(typing[field], `${prefix}.${field}`, 0, errors);
  }
  for (const field of ['p_burst_mean_graphemes', 'r_burst_mean_graphemes', 'mean_burst_graphemes', 'mean_burst_words']) {
    nullableFiniteNumberMin(typing[field], `${prefix}.${field}`, 0, errors);
  }

  // Revision distance from the point of inscription — nullable as a group
  // (no caretOffset was ever supplied) rather than individually.
  nullableFiniteNumberMin(typing.revision_distance_mean, `${prefix}.revision_distance_mean`, 0, errors);
  nullableFiniteNumberMin(typing.revision_distance_median, `${prefix}.revision_distance_median`, 0, errors);
  nullableBoundedNumber(typing.leading_edge_revision_ratio, `${prefix}.leading_edge_revision_ratio`, 0, 1, errors);

  // Fluency in the field's reporting units. ALL rates are nullable — null
  // means the denominator was 0 (unmeasurable), never coerced to 0; the
  // rates themselves are episode-scoped net production (floored at 0), so
  // non-negative when present.
  for (const field of ['chars_per_min', 'chars_per_min_active', 'words_per_min', 'words_per_min_active']) {
    nullableFiniteNumberMin(typing[field], `${prefix}.${field}`, 0, errors);
  }

  // Process vs. product. `product_ratio` is bounded to [0, 1] by definition
  // (max(0, produced - deleted) / produced); `baseline_graphemes` /
  // `baseline_words` are the document size the episode found before its
  // first edit (null when there were no edits / no word counts).
  nullableIntegerAtLeast(typing.produced_graphemes, `${prefix}.produced_graphemes`, 0, errors);
  nullableBoundedNumber(typing.product_ratio, `${prefix}.product_ratio`, 0, 1, errors);
  nullableIntegerAtLeast(typing.baseline_graphemes, `${prefix}.baseline_graphemes`, 0, errors);
  nullableIntegerAtLeast(typing.baseline_words, `${prefix}.baseline_words`, 0, errors);

  // Adaptive-mode-only figures — optional even when the window's quality
  // block says `pause_threshold_mode: 'adaptive'`, so an older payload never
  // fails validation over their absence.
  nullableIntegerAtLeast(typing.adaptive_burst_count, `${prefix}.adaptive_burst_count`, 0, errors);
  nullableFiniteNumberMin(typing.adaptive_active_input_ms, `${prefix}.adaptive_active_input_ms`, 0, errors);

  // Pause location (boundary context) — null unless boundaryContext was ever
  // supplied; when present, exactly the four known keys, each a non-negative
  // integer count.
  const pauseLocationCounts = typing.pause_location_counts;
  if (pauseLocationCounts !== null && pauseLocationCounts !== undefined) {
    if (!isPlainObject(pauseLocationCounts)) {
      errors.push(`${prefix}.pause_location_counts must be an object or null`);
    } else {
      const badKey = Object.keys(pauseLocationCounts).find(key => !TYPING_PAUSE_LOCATION_KEYS.includes(key));
      if (badKey) errors.push(`${prefix}.pause_location_counts has unsupported key '${badKey}'`);
      for (const key of TYPING_PAUSE_LOCATION_KEYS) {
        nullableIntegerAtLeast(pauseLocationCounts[key], `${prefix}.pause_location_counts.${key}`, 0, errors);
      }
    }
  }
}

/**
 * `ai-assist-v1` block (`src/aggregation/AiAssistAggregator.js`). Shape and
 * range only, mirroring `validateTypingBlock`. See docs/AI_ASSIST.md.
 *
 * `null` (not `0`) is valid on every rate/mean field below: `AiAssistAggregator`
 * deliberately emits `null` when the denominator was 0 (e.g. `acceptance_rate`
 * when nothing was ever shown) so "never measured" stays distinguishable from
 * "measured as zero" — the validator must accept that `null`, not force a 0.
 */
export function validateAiAssistBlock(aiAssist, prefix, errors, options = {}) {
  if (aiAssist === null || aiAssist === undefined) return;
  if (!isPlainObject(aiAssist)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Oyon never carries the suggestion text — the host already stores it.
  for (const field of FORBIDDEN_AI_ASSIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(aiAssist, field)) {
      errors.push(`${prefix}.${field} is forbidden; the host owns the suggestion text`);
    }
  }

  for (const field of [
    'request_count', 'shown_count', 'accept_count', 'reject_count', 'dismiss_count',
    'accepted_graphemes_total', 'ai_turn_count', 'ai_authored_graphemes',
  ]) {
    nullableIntegerAtLeast(aiAssist[field], `${prefix}.${field}`, 0, errors);
  }

  nullableBoundedNumber(aiAssist.acceptance_rate, `${prefix}.acceptance_rate`, 0, 1, errors);

  for (const field of [
    'mean_latency_ms', 'median_latency_ms', 'mean_accepted_graphemes', 'ai_turn_total_ms',
  ]) {
    nullableFiniteNumberMin(aiAssist[field], `${prefix}.${field}`, 0, errors);
  }

  const chosenIndexCounts = aiAssist.chosen_index_counts;
  if (chosenIndexCounts !== null && chosenIndexCounts !== undefined) {
    if (!isPlainObject(chosenIndexCounts)) {
      errors.push(`${prefix}.chosen_index_counts must be an object or null`);
    } else {
      const maxKeys = options.maxAiAssistChosenIndexKeys || MAX_AI_ASSIST_CHOSEN_INDEX_KEYS;
      const keys = Object.keys(chosenIndexCounts);
      if (keys.length > maxKeys) {
        errors.push(`${prefix}.chosen_index_counts must contain at most ${maxKeys} keys`);
      }
      for (const key of keys) {
        if (!/^\d+$/.test(key)) {
          errors.push(`${prefix}.chosen_index_counts has non-index key '${key}'`);
          continue;
        }
        integerAtLeast(chosenIndexCounts[key], `${prefix}.chosen_index_counts.${key}`, 0, errors);
      }
    }
  }
}

/**
 * `interaction-v1` block (`src/aggregation/InteractionAggregator.js`). Shape
 * and range only, mirroring `validateGazeBlock`'s AOI-map handling
 * (`aoi_dwell_ms` reuses the exact same `validateNonNegativeMap` helper) and
 * `validateAiAssistBlock`'s null-when-never-measured convention
 * (`selection_mean_length` is `null`, not `0`, when no selection ever
 * occurred). A transport-shape check only — never a privacy gate; Oyon never
 * carries selected/typed text in this block to begin with (see
 * docs/INTERACTION.md), so there is nothing here to censor, only shape/range
 * to validate.
 */
export function validateInteractionBlock(interaction, prefix, errors) {
  if (interaction === null || interaction === undefined) return;
  if (!isPlainObject(interaction)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  nullableFiniteNumberMin(interaction.pointer_path_length, `${prefix}.pointer_path_length`, 0, errors);
  nullableIntegerAtLeast(interaction.pointer_sample_count, `${prefix}.pointer_sample_count`, 0, errors);
  nullableFiniteNumberMin(interaction.idle_ms, `${prefix}.idle_ms`, 0, errors);
  nullableBoundedNumber(interaction.idle_ratio, `${prefix}.idle_ratio`, 0, 1, errors);
  nullableIntegerAtLeast(interaction.click_count, `${prefix}.click_count`, 0, errors);
  nullableIntegerAtLeast(interaction.double_click_count, `${prefix}.double_click_count`, 0, errors);
  nullableIntegerAtLeast(interaction.scroll_events, `${prefix}.scroll_events`, 0, errors);
  nullableBoundedNumber(interaction.scroll_depth_max, `${prefix}.scroll_depth_max`, 0, 1, errors);
  nullableIntegerAtLeast(interaction.scroll_reversals, `${prefix}.scroll_reversals`, 0, errors);
  nullableIntegerAtLeast(interaction.selection_count, `${prefix}.selection_count`, 0, errors);
  nullableFiniteNumberMin(interaction.selection_mean_length, `${prefix}.selection_mean_length`, 0, errors);
  nullableIntegerAtLeast(interaction.focus_loss_count, `${prefix}.focus_loss_count`, 0, errors);
  nullableFiniteNumberMin(interaction.hidden_ms, `${prefix}.hidden_ms`, 0, errors);

  for (const [mapField, integers] of [['aoi_dwell_ms', false], ['aoi_click_counts', true]]) {
    const value = interaction[mapField];
    validateNonNegativeMap(value, `${prefix}.${mapField}`, errors, { integers });
    if (isPlainObject(value) && Object.keys(value).length > MAX_INTERACTION_AOI_KEYS) {
      errors.push(`${prefix}.${mapField} must contain at most ${MAX_INTERACTION_AOI_KEYS} keys; aggregate-only payloads`);
    }
  }
}

/**
 * `text-v1` block (`src/aggregation/DiscourseAggregator.js`, produced by
 * `src/analytics/TextAnalyzer.js`). Shape and range only, mirroring
 * `validateTypingBlock`/`validateAiAssistBlock`. `deep_question_ratio` is
 * nullable — `null` (not `0`) when the episode asked no questions at all, so
 * "never asked" stays distinguishable from "asked only shallow questions"
 * (see docs/DISCOURSE.md).
 */
export function validateTextBlock(text, prefix, errors) {
  if (text === null || text === undefined) return;
  if (!isPlainObject(text)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Oyon never carries the composed text, per-sentence text, or a raw dump —
  // the host already stores the message the sentences came from.
  for (const field of FORBIDDEN_TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(text, field)) {
      errors.push(`${prefix}.${field} is forbidden; the host owns the message text`);
    }
  }

  for (const field of [
    'word_count', 'sentence_count', 'paragraph_count',
    'question_count', 'directive_count', 'request_count', 'statement_count', 'thinking_count',
    'deep_question_count', 'shallow_question_count', 'polar_question_count',
  ]) {
    nullableIntegerAtLeast(text[field], `${prefix}.${field}`, 0, errors);
  }

  for (const field of ['mean_words_per_sentence', 'mean_word_length']) {
    nullableFiniteNumberMin(text[field], `${prefix}.${field}`, 0, errors);
  }

  for (const field of ['type_token_ratio', 'long_word_ratio', 'question_ratio']) {
    nullableBoundedNumber(text[field], `${prefix}.${field}`, 0, 1, errors);
  }

  // null (not 0) is valid — see doc comment above.
  nullableBoundedNumber(text.deep_question_ratio, `${prefix}.deep_question_ratio`, 0, 1, errors);

  optionalShortString(text.speech_act_lang, `${prefix}.speech_act_lang`, 20, errors);
}

/**
 * `voice-v1` block (`src/aggregation/VoiceTurnAggregator.js`, audio_text.md
 * §5.6). Shape and range only, mirroring `validateTypingBlock` — a
 * transport-shape sanity check, NEVER a privacy gate (this repo's data policy
 * is explicit: validators exist to keep batches well-formed in transit, not
 * to censor or withhold signal a researcher wants).
 *
 * `null` is valid on every statistic that can legitimately be unmeasurable —
 * the aggregator's null discipline is the contract: pitch statistics are
 * `null` below the voiced-frame floor (a turn with no detectable pitch is
 * not a turn at 0 Hz), spectral means are `null` on a silent turn, and every
 * coverage/ratio with a zero denominator is `null`. The validator must
 * accept those nulls, never force a 0.
 */
export function validateVoiceBlock(voice, prefix, errors) {
  if (voice === null || voice === undefined) return;
  if (!isPlainObject(voice)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Durations: non-negative finite ms, nullable.
  for (const field of [
    'turn_duration_ms', 'speech_duration_ms', 'initial_silence_ms', 'trailing_silence_ms',
    'internal_pause_total_ms', 'segment_duration_mean_ms', 'excluded_playback_ms', 'muted_ms',
    'analyzable_speech_ms',
  ]) {
    nullableFiniteNumberMin(voice[field], `${prefix}.${field}`, 0, errors);
  }

  // Counts: non-negative integers, nullable.
  for (const field of ['internal_pause_count', 'speech_segment_count', 'channel_count']) {
    nullableIntegerAtLeast(voice[field], `${prefix}.${field}`, 0, errors);
  }

  // Ratios and coverages: 0–1, nullable.
  for (const field of [
    'speech_ratio', 'voiced_frame_ratio', 'pitch_confidence_mean', 'pitch_frames_excluded_ratio',
    'clipping_ratio', 'near_silence_ratio', 'clipped_coverage', 'muted_coverage',
    'hidden_coverage', 'contaminated_coverage', 'vad_coverage', 'pitch_coverage',
  ]) {
    nullableBoundedNumber(voice[field], `${prefix}.${field}`, 0, 1, errors);
  }

  // Pitch: plausible human-speech band when non-null (a 5 Hz or 5 kHz median
  // is a pipeline defect, not a voice). Slope may be negative (falling
  // contour) — bounded magnitude, not sign.
  nullableBoundedNumber(voice.pitch_median_hz, `${prefix}.pitch_median_hz`, 20, 1000, errors);
  nullableBoundedNumber(voice.pitch_iqr_hz, `${prefix}.pitch_iqr_hz`, 0, 1000, errors);
  nullableBoundedNumber(voice.pitch_slope_hz_per_s, `${prefix}.pitch_slope_hz_per_s`, -1000, 1000, errors);

  // Loudness: float-PCM scale (nominally [-1, 1]; Web Audio floats may
  // overshoot slightly, hence the headroom).
  nullableBoundedNumber(voice.rms_mean, `${prefix}.rms_mean`, 0, 2, errors);
  nullableBoundedNumber(voice.rms_variability, `${prefix}.rms_variability`, 0, 2, errors);
  nullableBoundedNumber(voice.peak_to_average_ratio, `${prefix}.peak_to_average_ratio`, 0, 1000, errors);

  // Spectrum: within any plausible audio Nyquist.
  nullableBoundedNumber(voice.spectral_centroid_mean_hz, `${prefix}.spectral_centroid_mean_hz`, 0, 24000, errors);
  nullableBoundedNumber(voice.spectral_rolloff_mean_hz, `${prefix}.spectral_rolloff_mean_hz`, 0, 24000, errors);

  // Capture conditions.
  nullableBoundedNumber(voice.sample_rate, `${prefix}.sample_rate`, 1, 384000, errors);
  for (const field of ['echo_cancellation', 'noise_suppression', 'auto_gain_control', 'insufficient_data']) {
    if (voice[field] !== undefined && voice[field] !== null && typeof voice[field] !== 'boolean') {
      errors.push(`${prefix}.${field} must be a boolean or null`);
    }
  }
  if (voice.stream_owner !== undefined && voice.stream_owner !== null
    && voice.stream_owner !== 'oyon' && voice.stream_owner !== 'host') {
    errors.push(`${prefix}.stream_owner must be 'oyon', 'host', or null`);
  }

  // Internal-pause histogram: bounded non-negative integer map.
  validateNonNegativeMap(voice.pause_histogram, `${prefix}.pause_histogram`, errors, { integers: true });
  if (isPlainObject(voice.pause_histogram) && Object.keys(voice.pause_histogram).length > MAX_VOICE_HISTOGRAM_KEYS) {
    errors.push(`${prefix}.pause_histogram must contain at most ${MAX_VOICE_HISTOGRAM_KEYS} keys`);
  }

  // insufficient_reasons: short machine-readable slugs, length-capped for
  // transport sanity.
  const reasons = voice.insufficient_reasons;
  if (reasons !== null && reasons !== undefined) {
    if (!Array.isArray(reasons)) {
      errors.push(`${prefix}.insufficient_reasons must be an array or null`);
    } else if (reasons.length > MAX_VOICE_INSUFFICIENT_REASONS) {
      errors.push(`${prefix}.insufficient_reasons must contain at most ${MAX_VOICE_INSUFFICIENT_REASONS} items`);
    } else {
      reasons.forEach((reason, index) => {
        if (typeof reason !== 'string' || reason.length === 0 || reason.length > MAX_VOICE_REASON_LENGTH) {
          errors.push(`${prefix}.insufficient_reasons[${index}] must be a short non-empty string`);
        }
      });
    }
  }
}

function validateNonNegativeMap(value, prefix, errors, options = {}) {
  if (value === null || value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }
  const maxKeyLength = options.maxKeyLength || 100;
  for (const [key, item] of Object.entries(value)) {
    if (key.length === 0 || key.length > maxKeyLength) {
      errors.push(`${prefix} has invalid key`);
      continue;
    }
    if (item == null && options.nullable) continue;
    if (!Number.isFinite(item) || item < 0 || (options.integers && !Number.isInteger(item))) {
      errors.push(`${prefix}.${key} must be a non-negative${options.integers ? ' integer' : ' number'}`);
    }
  }
}

const PRIVATE_CAMERA_FIELDS = new Set(['deviceId', 'groupId', 'device_id', 'group_id', 'label']);

function rejectPrivateCameraKeys(value, prefix, errors, depth) {
  if (depth > 6 || !value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_CAMERA_FIELDS.has(key)) {
      errors.push(`${prefix}.${key} is forbidden; camera identity must not be sent`);
      continue;
    }
    rejectPrivateCameraKeys(item, `${prefix}.${key}`, errors, depth + 1);
  }
}

function requiredIsoDate(value, path, errors) {
  if (typeof value !== 'string') {
    errors.push(`${path} must be an ISO date string`);
    return;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) errors.push(`${path} must be a valid ISO date string`);
}

function nullableBoundedNumber(value, path, min, max, errors) {
  if (value === null || value === undefined) return;
  boundedNumber(value, path, min, max, errors);
}

function boundedNumber(value, path, min, max, errors) {
  if (!Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
    return;
  }
  if (value < min || value > max) errors.push(`${path} must be between ${min} and ${max}`);
}

function integerAtLeast(value, path, min, errors) {
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
    return;
  }
  if (value < min) errors.push(`${path} must be at least ${min}`);
}

function nullableIntegerAtLeast(value, path, min, errors) {
  if (value === null || value === undefined) return;
  integerAtLeast(value, path, min, errors);
}

function nullableFiniteNumberMin(value, path, min, errors) {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
    return;
  }
  if (value < min) errors.push(`${path} must be at least ${min}`);
}

/** `raw_part: { id, index, count }` of a window split across POSTs (chunkWindowBatch). */
export function validateRawPart(part, path, errors) {
  if (part === null || part === undefined) return;
  if (!isPlainObject(part)) {
    errors.push(`${path} must be an object or null`);
    return;
  }
  if (typeof part.id !== 'string' || part.id.length === 0 || part.id.length > 128) {
    errors.push(`${path}.id must be a non-empty string of at most 128 characters`);
  }
  integerAtLeast(part.index, `${path}.index`, 0, errors);
  integerAtLeast(part.count, `${path}.count`, 1, errors);
  if (Number.isInteger(part.index) && Number.isInteger(part.count) && part.index >= part.count) {
    errors.push(`${path}.index must be less than ${path}.count`);
  }
  if (part.joined !== undefined) integerAtLeast(part.joined, `${path}.joined`, 1, errors);
}

function optionalShortString(value, path, maxLength, errors) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string`);
    return;
  }
  if (value.length > maxLength) errors.push(`${path} is too long`);
}

function jsonSize(value, path, maxLength, errors) {
  if (value === null || value === undefined) return;
  try {
    const text = JSON.stringify(value);
    if (text.length > maxLength) errors.push(`${path} JSON is too large`);
  } catch {
    errors.push(`${path} must be JSON serializable`);
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
