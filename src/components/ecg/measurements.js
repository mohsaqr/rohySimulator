/**
 * Caliper measurements.
 *
 * A measurement on ECG paper is two points and a claim about what lies between
 * them. The claim matters: 400 ms is a normal QT and a very short RR, and a
 * caliper that only reports "400 ms" has thrown away the half of the
 * measurement a reader actually needs later.
 *
 * So a measurement carries what it is. That is what lets the panel derive a
 * corrected QT without asking again, and what makes the record re-readable when
 * someone opens the case a week later.
 */

import { FILTER_CHAIN_IDS } from './filters.js';
import { next_prefixed_id } from './recordIds.js';
import { fridericia_qtc } from './waveform.js';

/**
 * What a caliper span can be called.
 *
 * Deliberately short. A list long enough to cover every possible span becomes a
 * list nobody reads, and "other" plus a note is a better answer than a
 * mislabelled interval.
 */
export const MEASUREMENT_LABELS = Object.freeze([
  { id: 'rr', label: 'RR', kind: 'interval', normal_ms: [600, 1000] },
  { id: 'pr', label: 'PR', kind: 'interval', normal_ms: [120, 200] },
  { id: 'qrs', label: 'QRS', kind: 'interval', normal_ms: [70, 110] },
  { id: 'qt', label: 'QT', kind: 'interval', normal_ms: [350, 450] },
  { id: 'p_duration', label: 'P duration', kind: 'interval', normal_ms: [60, 120] },
  { id: 'st_level', label: 'ST level', kind: 'amplitude', normal_ms: null },
  { id: 'amplitude', label: 'Amplitude', kind: 'amplitude', normal_ms: null },
  { id: 'other', label: 'Other', kind: 'interval', normal_ms: null },
]);

export const MEASUREMENT_LABEL_IDS = Object.freeze(MEASUREMENT_LABELS.map(({ id }) => id));

/** Label definitions by id, so a lookup is not a scan per row per render. */
const LABEL_BY_ID = Object.freeze(Object.fromEntries(
  MEASUREMENT_LABELS.map((definition) => [definition.id, definition]),
));

/**
 * Definition behind a label id.
 *
 * @param {string} label_id one of `MEASUREMENT_LABEL_IDS`
 * @returns {{id:string,label:string,kind:string,normal_ms:Array<number>|null}|null} definition, or null
 */
export function measurement_label(label_id) {
  return LABEL_BY_ID[label_id] ?? null;
}

const MEASUREMENT_PREFIX = 'ecg-measure';

/**
 * The cart settings a span was read under.
 *
 * `filters.js` is explicit that a 40 Hz roof shrinks R waves, so "0.42 mV"
 * without the chain behind it is a number nobody can check later. Gain and
 * speed matter for the same reason the paper distance is stored rather than
 * recomputed: the cart may be set differently by the time the record is read.
 */
function normalize_settings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const gain_mm_per_mv = Number(raw.gain_mm_per_mv);
  const paper_speed_mm_per_second = Number(raw.paper_speed_mm_per_second);
  const filter_preset_id = FILTER_CHAIN_IDS.includes(raw.filter_preset_id) ? raw.filter_preset_id : null;
  if (!Number.isFinite(gain_mm_per_mv) && !Number.isFinite(paper_speed_mm_per_second)
      && filter_preset_id === null) {
    return null;
  }
  return {
    filter_preset_id,
    gain_mm_per_mv: Number.isFinite(gain_mm_per_mv) ? gain_mm_per_mv : null,
    paper_speed_mm_per_second: Number.isFinite(paper_speed_mm_per_second) ? paper_speed_mm_per_second : null,
  };
}

/**
 * Heart rate implied by one RR interval.
 *
 * @param {number} rr_ms RR interval in milliseconds
 * @returns {number} rate in beats per minute
 */
export function heart_rate_from_rr(rr_ms) {
  if (!Number.isFinite(rr_ms) || rr_ms <= 0) {
    throw new RangeError('heart_rate_from_rr(rr_ms): RR must be a positive number of milliseconds');
  }
  return 60000 / rr_ms;
}

/**
 * Bazett-corrected QT.
 *
 * Kept alongside Fridericia rather than instead of it: Bazett is what most
 * bedside reporting still quotes, and it over-corrects at high rates, so
 * showing the two together is the honest presentation of a disagreement a
 * reader will meet in practice.
 *
 * @param {number} qt_ms measured QT in milliseconds
 * @param {number} rr_ms measured RR in milliseconds
 * @returns {number} corrected QT in milliseconds
 */
export function qtc_bazett(qt_ms, rr_ms) {
  if (!Number.isFinite(qt_ms) || qt_ms <= 0 || !Number.isFinite(rr_ms) || rr_ms <= 0) {
    throw new RangeError('qtc_bazett(): QT and RR must be positive numbers of milliseconds');
  }
  return qt_ms / Math.sqrt(rr_ms / 1000);
}

/**
 * Next collision-free measurement id, derived from the collection.
 *
 * @param {Array<object>} measurements existing measurements
 * @returns {string} unused id
 */
export function next_measurement_id(measurements) {
  return next_prefixed_id(measurements, MEASUREMENT_PREFIX);
}

/**
 * Normalize stored measurements, dropping entries that cannot be trusted.
 *
 * @param {unknown} raw stored value of unknown provenance
 * @returns {Array<object>} canonical measurements
 */
export function normalize_measurements(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const id = String(entry.id ?? '');
    const duration_ms = Number(entry.duration_ms);
    const amplitude_mv = Number(entry.amplitude_mv);
    if (id === '' || seen.has(id) || !Number.isFinite(duration_ms) || !Number.isFinite(amplitude_mv)) {
      return [];
    }
    seen.add(id);
    const label_id = MEASUREMENT_LABEL_IDS.includes(entry.label_id) ? entry.label_id : 'other';
    // The paper distance is kept as measured. Recomputing it later from the
    // duration would silently restate the measurement at whatever speed the
    // cart happens to be set to now.
    const delta_x_mm = Number(entry.delta_x_mm);
    const delta_y_mm = Number(entry.delta_y_mm);
    return [{
      id,
      label_id,
      duration_ms,
      amplitude_mv,
      delta_x_mm: Number.isFinite(delta_x_mm) ? delta_x_mm : null,
      delta_y_mm: Number.isFinite(delta_y_mm) ? delta_y_mm : null,
      lead: entry.lead ? String(entry.lead) : null,
      recorded_through: normalize_settings(entry.recorded_through),
      created_at: entry.created_at ? String(entry.created_at) : null,
    }];
  });
}

/**
 * Append a caliper reading.
 *
 * @param {Array<object>} measurements existing measurements
 * @param {object} reading caliper output plus a label and optional lead
 * @returns {Array<object>} new collection; the input is not mutated
 */
export function add_measurement(measurements, reading) {
  const existing = normalize_measurements(measurements);
  return [...existing, ...normalize_measurements([{
    id: next_measurement_id(existing),
    label_id: reading?.label_id ?? 'other',
    duration_ms: reading?.duration_ms,
    amplitude_mv: reading?.amplitude_mv,
    delta_x_mm: reading?.delta_x_mm,
    delta_y_mm: reading?.delta_y_mm,
    lead: reading?.lead ?? null,
    recorded_through: reading?.recorded_through ?? null,
    created_at: reading?.created_at ?? null,
  }])];
}

/**
 * Re-label a measurement without re-measuring it.
 *
 * @param {Array<object>} measurements existing measurements
 * @param {string} measurement_id measurement to relabel
 * @param {string} label_id new label
 * @returns {Array<object>} new collection; the input is not mutated
 */
export function label_measurement(measurements, measurement_id, label_id) {
  if (!MEASUREMENT_LABEL_IDS.includes(label_id)) {
    throw new RangeError(`label_measurement(): unknown label '${label_id}'`);
  }
  return normalize_measurements(measurements).map((entry) => entry.id === String(measurement_id)
    ? { ...entry, label_id }
    : entry);
}

/**
 * Remove a measurement.
 *
 * @param {Array<object>} measurements existing measurements
 * @param {string} measurement_id measurement to remove
 * @returns {Array<object>} new collection; the input is not mutated
 */
export function remove_measurement(measurements, measurement_id) {
  return normalize_measurements(measurements).filter((entry) => entry.id !== String(measurement_id));
}

/**
 * Whether a measurement falls inside the conventional adult range.
 *
 * Returns null where no range applies rather than guessing — an amplitude has
 * no single normal, and a fabricated verdict is worse than none.
 *
 * @param {object} measurement a normalized measurement
 * @returns {'normal'|'short'|'long'|null} verdict, or null when undefined
 */
export function measurement_verdict(measurement) {
  const definition = LABEL_BY_ID[measurement?.label_id];
  if (!definition?.normal_ms) return null;
  const [low, high] = definition.normal_ms;
  if (measurement.duration_ms < low) return 'short';
  if (measurement.duration_ms > high) return 'long';
  return 'normal';
}

/**
 * Corrected QT derived from the record, when the record supports it.
 *
 * Uses the most recent QT and the most recent RR, and returns null unless both
 * exist: a QTc computed from an assumed rate is a number with no measurement
 * behind it.
 *
 * @param {Array<object>} measurements existing measurements
 * @returns {{qt_ms:number, rr_ms:number, heart_rate_bpm:number, bazett_ms:number, fridericia_ms:number}|null}
 */
export function derived_qtc(measurements) {
  const normalized = normalize_measurements(measurements);
  const latest = (label_id) => normalized.filter((entry) => entry.label_id === label_id).at(-1) ?? null;
  const qt = latest('qt');
  const rr = latest('rr');
  if (!qt || !rr || qt.duration_ms <= 0 || rr.duration_ms <= 0) return null;
  const heart_rate_bpm = heart_rate_from_rr(rr.duration_ms);
  return {
    qt_ms: qt.duration_ms,
    rr_ms: rr.duration_ms,
    heart_rate_bpm,
    bazett_ms: qtc_bazett(qt.duration_ms, rr.duration_ms),
    fridericia_ms: fridericia_qtc(qt.duration_ms, heart_rate_bpm),
  };
}

/**
 * A measurement stated in squares, the way ECG paper is actually read.
 *
 * At 25 mm/s a small square is 40 ms and a large square 200 ms, which is the
 * arithmetic a reader does at the bedside. Returns null when the paper distance
 * was not recorded, rather than back-computing it at the current speed.
 *
 * @param {object} measurement a normalized measurement
 * @returns {{small:number, large:number}|null} square counts
 */
export function measurement_in_squares(measurement) {
  const millimetres = Number(measurement?.delta_x_mm);
  if (!Number.isFinite(millimetres)) return null;
  return { small: millimetres, large: millimetres / 5 };
}
