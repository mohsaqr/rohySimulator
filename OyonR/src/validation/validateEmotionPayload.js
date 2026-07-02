export const ALLOWED_EMOTIONS = ['neutral', 'happy', 'sad', 'surprise', 'anger', 'fear', 'disgust', 'contempt'];

const MAX_BATCH_EVENTS = 120;
const MAX_JSON_STRING_LENGTH = 20_000;

const FORBIDDEN_TOP_LEVEL_FIELDS = [
  'frame', 'frames', 'image', 'images', 'video', 'blob', 'base64', 'pixels', 'landmarks',
  'iris_landmarks_raw', 'gaze_points_raw', 'pupil_diameter_px',
];

const FORBIDDEN_ENGAGEMENT_FIELDS = [
  'frame', 'frames', 'image', 'images', 'video', 'blob', 'base64', 'pixels', 'landmarks',
  'iris_landmarks_raw', 'gaze_points_raw', 'pupil_diameter_px',
];

const FORBIDDEN_GAZE_FIELDS = [
  'frame', 'frames', 'image', 'images', 'video', 'blob', 'base64', 'pixels', 'landmarks',
  'gaze_points_raw', 'gaze_raw', 'gaze_trace', 'points', 'points_raw',
  'eye_patch', 'eye_image',
];

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
  const maxBatchEvents = options.maxBatchEvents || MAX_BATCH_EVENTS;

  if (!Array.isArray(events)) {
    return { ok: false, errors: ['events must be an array'] };
  }
  if (events.length === 0) errors.push('events must not be empty');
  if (events.length > maxBatchEvents) errors.push(`events must contain at most ${maxBatchEvents} items`);

  events.forEach((event, index) => {
    errors.push(...validateEmotionEvent(event, index, options));
  });

  return { ok: errors.length === 0, errors };
}

export function validateEmotionEvent(event, index = 0, options = {}) {
  const errors = [];
  const prefix = `events[${index}]`;

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return [`${prefix} must be an object`];
  }

  rejectRawMediaFields(event, prefix, errors);
  rejectEyeImagePrefix(event, prefix, errors);
  requiredIsoDate(event.window_start, `${prefix}.window_start`, errors);
  requiredIsoDate(event.window_end, `${prefix}.window_end`, errors);

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

  // For research-only "engagement_only" events, the emotion-scalar fields may be
  // absent. Otherwise enforce the v0.2.2 contract.
  if (event.engagement_only === true) {
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

  return errors;
}

function rejectRawMediaFields(event, prefix, errors) {
  for (const field of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(event, field)) {
      errors.push(`${prefix}.${field} is forbidden; raw media and landmarks must not be sent`);
    }
  }
}

function rejectEyeImagePrefix(event, prefix, errors) {
  for (const key of Object.keys(event)) {
    if (key.startsWith('eye_image_')) {
      errors.push(`${prefix}.${key} is forbidden; eye image fields must not be sent`);
    }
  }
}

export function validateEngagementBlock(engagement, prefix, errors) {
  if (engagement === null || engagement === undefined) return;
  if (!isPlainObject(engagement)) {
    errors.push(`${prefix} must be an object or null`);
    return;
  }

  // Reject forbidden nested fields (landmarks, frames, raw media, etc.).
  for (const field of FORBIDDEN_ENGAGEMENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(engagement, field)) {
      errors.push(`${prefix}.${field} is forbidden; raw media and landmarks must not be sent`);
    }
  }
  for (const key of Object.keys(engagement)) {
    if (key.startsWith('eye_image_')) {
      errors.push(`${prefix}.${key} is forbidden; eye image fields must not be sent`);
    }
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
  nullableFiniteNumberMin(gaze.duration_ms, `${prefix}.duration_ms`, 0, errors);
  nullableFiniteNumberMin(gaze.calibration_age_ms, `${prefix}.calibration_age_ms`, 0, errors);

  // Bounded ratios.
  nullableBoundedNumber(gaze.valid_frame_ratio, `${prefix}.valid_frame_ratio`, 0, 1, errors);
  nullableBoundedNumber(gaze.off_screen_ratio, `${prefix}.off_screen_ratio`, 0, 1, errors);
  nullableBoundedNumber(gaze.calibration_quality, `${prefix}.calibration_quality`, 0, 1, errors);

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

  // ISO date strings (optional inside gaze, mirror engagement).
  if (gaze.window_start !== null && gaze.window_start !== undefined) {
    requiredIsoDate(gaze.window_start, `${prefix}.window_start`, errors);
  }
  if (gaze.window_end !== null && gaze.window_end !== undefined) {
    requiredIsoDate(gaze.window_end, `${prefix}.window_end`, errors);
  }

  optionalShortString(gaze.model_version, `${prefix}.model_version`, 100, errors);
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
