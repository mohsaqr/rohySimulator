import { AXIS_CATEGORIES, FINDING_IDS, RHYTHM_IDS } from './constants.js';

const normalize_text = (value) => String(value ?? '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const numeric_or_null = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** Empty structured learner response. */
export function create_empty_interpretation() {
  return {
    rate_bpm: null,
    rhythm: '',
    axis: '',
    intervals_ms: { pr: null, qrs: null, qt: null },
    finding_ids: [],
    impression: '',
  };
}

/** Normalize and validate a learner response without mutating it. */
export function normalize_interpretation(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError('normalize_interpretation(response): response must be an object');
  }
  const finding_ids = [...new Set(Array.isArray(response.finding_ids) ? response.finding_ids : [])];
  if (finding_ids.some((finding_id) => !FINDING_IDS.includes(finding_id))) {
    throw new RangeError('Interpretation contains an unknown finding id');
  }
  if (response.rhythm && !RHYTHM_IDS.includes(response.rhythm)) throw new RangeError('Interpretation contains an unknown rhythm');
  if (response.axis && !AXIS_CATEGORIES.includes(response.axis)) throw new RangeError('Interpretation contains an unknown axis category');
  const normalized = {
    rate_bpm: numeric_or_null(response.rate_bpm),
    rhythm: response.rhythm ?? '',
    axis: response.axis ?? '',
    intervals_ms: {
      pr: numeric_or_null(response.intervals_ms?.pr),
      qrs: numeric_or_null(response.intervals_ms?.qrs),
      qt: numeric_or_null(response.intervals_ms?.qt),
    },
    finding_ids,
    impression: String(response.impression ?? '').trim(),
  };
  const numeric_values = [normalized.rate_bpm, normalized.intervals_ms.pr,
    normalized.intervals_ms.qrs, normalized.intervals_ms.qt].filter((value) => value !== null);
  if (numeric_values.some((value) => value < 0 || value > 1000)) {
    throw new RangeError('Interpretation measurements must be between 0 and 1000');
  }
  return normalized;
}

/** Is a numeric answer inside an inclusive expected range? */
export function value_in_range(value, range) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) {
    throw new TypeError('value_in_range(value, range): range must be two ordered finite numbers');
  }
  if (!Number.isFinite(value)) return false;
  return value >= range[0] && value <= range[1];
}

/** Precision/recall/F1 for selected structured findings. */
export function score_findings(selected_ids, expected_ids) {
  if (!Array.isArray(selected_ids) || !Array.isArray(expected_ids)) {
    throw new TypeError('score_findings(): both arguments must be arrays');
  }
  const selected = new Set(selected_ids);
  const expected = new Set(expected_ids);
  const true_positive = [...selected].filter((id) => expected.has(id)).length;
  const false_positive = [...selected].filter((id) => !expected.has(id)).length;
  const false_negative = [...expected].filter((id) => !selected.has(id)).length;
  const precision = selected.size === 0 ? (expected.size === 0 ? 1 : 0) : true_positive / selected.size;
  const recall = expected.size === 0 ? 1 : true_positive / expected.size;
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  return { true_positive, false_positive, false_negative, precision, recall, f1 };
}

/**
 * Deterministically score a structured interpretation against a protected key.
 * This runs in the standalone/instructor host; the Rohy learner adapter does
 * not receive the key.
 */
export function score_interpretation(response, answer_key) {
  const normalized = normalize_interpretation(response);
  if (!answer_key || typeof answer_key !== 'object' || Array.isArray(answer_key)) {
    throw new TypeError('score_interpretation(): answer_key must be an object');
  }
  const interval_results = Object.fromEntries(['pr', 'qrs', 'qt'].map((name) => [
    name,
    answer_key.interval_ranges_ms?.[name] === null
      ? null
      : value_in_range(normalized.intervals_ms[name], answer_key.interval_ranges_ms?.[name]),
  ]));
  const findings = score_findings(normalized.finding_ids, answer_key.finding_ids ?? []);
  const diagnosis_normalized = normalize_text(normalized.impression);
  const diagnosis = diagnosis_normalized === '' ? null
    : (answer_key.accepted_diagnoses ?? []).map(normalize_text).includes(diagnosis_normalized);
  const criteria = {
    rate: { result: value_in_range(normalized.rate_bpm, answer_key.rate_range_bpm), weight: 15 },
    rhythm: { result: normalized.rhythm === '' ? null : normalized.rhythm === answer_key.rhythm, weight: 20 },
    axis: { result: normalized.axis === '' ? null : normalized.axis === answer_key.axis, weight: 10 },
    pr: { result: interval_results.pr, weight: 8 },
    qrs: { result: interval_results.qrs, weight: 7 },
    qt: { result: interval_results.qt, weight: 5 },
    findings: { result: findings.f1, weight: 25 },
    diagnosis: { result: diagnosis, weight: 10 },
  };
  const scored = Object.values(criteria).filter(({ result }) => result !== null);
  const possible = scored.reduce((sum, { weight }) => sum + weight, 0);
  const earned = scored.reduce((sum, { result, weight }) => sum + (typeof result === 'number' ? result : result ? 1 : 0) * weight, 0);
  const critical_missed = (answer_key.critical_finding_ids ?? [])
    .filter((finding_id) => !normalized.finding_ids.includes(finding_id));
  return {
    normalized,
    criteria,
    findings,
    critical_missed,
    earned_points: earned,
    possible_points: possible,
    score: possible === 0 ? null : earned / possible,
    diagnosis_decided: diagnosis !== null,
  };
}
