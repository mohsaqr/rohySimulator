export const ALLOWED_EMOTIONS = ['neutral', 'happy', 'sad', 'surprise', 'anger', 'fear', 'disgust', 'contempt'];

const MAX_BATCH_EVENTS = 120;
const MAX_JSON_STRING_LENGTH = 20_000;

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
  boundedNumber(event.confidence, `${prefix}.confidence`, 0, 1, errors);
  nullableBoundedNumber(event.entropy, `${prefix}.entropy`, 0, 8, errors);
  integerAtLeast(event.valid_frames, `${prefix}.valid_frames`, 0, errors);
  boundedNumber(event.missing_face_ratio, `${prefix}.missing_face_ratio`, 0, 1, errors);

  optionalShortString(event.model_name, `${prefix}.model_name`, 200, errors);
  optionalShortString(event.model_version, `${prefix}.model_version`, 100, errors);
  optionalShortString(event.capture_mode, `${prefix}.capture_mode`, 100, errors);
  optionalShortString(event.consent_version, `${prefix}.consent_version`, 100, errors);

  jsonSize(event.quality, `${prefix}.quality`, options.maxJsonStringLength || MAX_JSON_STRING_LENGTH, errors);

  return errors;
}

function rejectRawMediaFields(event, prefix, errors) {
  const forbidden = ['frame', 'frames', 'image', 'images', 'video', 'blob', 'base64', 'pixels', 'landmarks'];
  for (const field of forbidden) {
    if (Object.prototype.hasOwnProperty.call(event, field)) {
      errors.push(`${prefix}.${field} is forbidden; raw media and landmarks must not be sent`);
    }
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

