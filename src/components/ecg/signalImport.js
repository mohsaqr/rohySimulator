/**
 * Importing a 12-lead signal from a published ECG corpus.
 *
 * `app/ecgUpload.js` already accepts a CSV a clinician might export: one column
 * per lead, a header row, a time column. Research corpora are not shaped like
 * that. MedalCare-XL stores one ROW per lead and 5,000 columns of samples, with
 * no header and no metadata at all — the layout is documented in the paper, not
 * in the file. So the file cannot describe itself, and the importer has to be
 * told what it is looking at.
 *
 * That is the whole reason this module is separate from the uploader rather
 * than another branch inside it. The uploader's contract is "the file declares
 * its own units and rate, and is refused if it does not" — deliberately
 * adversarial, because it takes files from learners. This module's contract is
 * "an author states what the corpus is, and every assumption is reported back",
 * because it takes files from a citable dataset an author chose on purpose.
 *
 * Two things are checked and reported rather than assumed:
 *
 *   1. The source's own limb leads are compared against Einthoven and
 *      Goldberger before being DISCARDED. Only the eight independent channels
 *      are stored (`sampleCodec.js`), so III, aVR, aVL and aVF are recomputed
 *      on read. If the source disagreed with the algebra, the author should
 *      know what is being thrown away — silently substituting our arithmetic
 *      for their data is how a lead-order mistake becomes invisible.
 *   2. The case id is derived by hash, never from the file name. Upstream
 *      naming states the finding (`S62_LCX_1.0_raw.csv` names the occluded
 *      artery), and a case id is searchable prose here.
 */

import { LEAD_NAMES } from './constants.js';
import { anonymous_source_id } from './recordIds.js';
import { DELTA_VARINT_ENCODING, INDEPENDENT_CHANNELS, encode_sample_channels } from './sampleCodec.js';
import { MAX_ECG_SAMPLE_RATE_HZ, MIN_ECG_SAMPLE_RATE_HZ } from './recordingSource.js';

/** Shortest recording worth importing; a 12-lead is conventionally ten seconds. */
export const MIN_IMPORT_SECONDS = 5;

/** Amplitude units an imported corpus may be stated in. */
export const IMPORT_UNITS = Object.freeze(['mV', 'uV']);

/** How a corpus lays its samples out on disk. */
export const IMPORT_LAYOUTS = Object.freeze(['lead-major', 'sample-major']);

/**
 * The limb-lead identities every 12-lead recording must satisfy.
 *
 * Stated once, as data, so the importer's report and the engine's own test
 * cannot drift apart in what they mean by "the algebra holds".
 */
export const LIMB_RELATIONS = Object.freeze([
  Object.freeze({ lead: 'III', relation: 'III = II - I', of: (l, i) => l.II[i] - l.I[i] }),
  Object.freeze({ lead: 'aVR', relation: 'aVR = -(I + II) / 2', of: (l, i) => -(l.I[i] + l.II[i]) / 2 }),
  Object.freeze({ lead: 'aVL', relation: 'aVL = I - II / 2', of: (l, i) => l.I[i] - l.II[i] / 2 }),
  Object.freeze({ lead: 'aVF', relation: 'aVF = II - I / 2', of: (l, i) => l.II[i] - l.I[i] / 2 }),
]);

const is_plain_object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const parse_row = (line, row_index) => line.split(',').map((cell, column) => {
  const value = Number(cell.trim());
  if (!Number.isFinite(value)) {
    throw new TypeError(`Imported signal has a non-numeric value at row ${row_index + 1}, column ${column + 1}.`);
  }
  return value;
});

/**
 * Read a delimited 12-lead signal into integer microvolts.
 *
 * `lead-major` is one row per lead in conventional order and one column per
 * sample; `sample-major` is the transpose. Neither carries a header — a corpus
 * file that has one belongs in `app/ecgUpload.js`, which reads the header.
 *
 * @param {string} text the file contents
 * @param {{layout?:string, units?:string}} options stated shape of the corpus
 * @returns {{leads: Record<string, Int32Array>, sample_count: number}} signals by lead
 * @throws {TypeError} when the text is not a rectangular 12-lead table
 * @throws {RangeError} when `layout` or `units` is not a supported value
 */
export function parse_signal_table(text, { layout = 'lead-major', units = 'mV' } = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('parse_signal_table(): text must be a non-empty string');
  }
  if (!IMPORT_LAYOUTS.includes(layout)) {
    throw new RangeError(`parse_signal_table(): layout must be one of ${IMPORT_LAYOUTS.join(', ')}`);
  }
  if (!IMPORT_UNITS.includes(units)) {
    throw new RangeError(`parse_signal_table(): units must be one of ${IMPORT_UNITS.join(', ')}`);
  }
  const rows = text.trim().split(/\r?\n/).filter((line) => line.trim() !== '').map(parse_row);
  const widths = new Set(rows.map((row) => row.length));
  if (widths.size !== 1) {
    throw new TypeError(`Imported signal is ragged: rows have ${[...widths].sort((a, b) => a - b).join(', ')} columns.`);
  }
  const table = layout === 'lead-major'
    ? rows
    : rows[0].map((_unused, column) => rows.map((row) => row[column]));
  if (table.length !== LEAD_NAMES.length) {
    throw new TypeError(`Imported signal has ${table.length} leads; all ${LEAD_NAMES.length} standard leads are required.`);
  }
  const sample_count = table[0].length;
  const to_microvolts = units === 'mV' ? 1000 : 1;
  return {
    sample_count,
    leads: Object.fromEntries(LEAD_NAMES.map((lead, index) =>
      [lead, Int32Array.from(table[index], (value) => Math.round(value * to_microvolts))])),
  };
}

/**
 * Compare a source's own limb leads against the identities that define them.
 *
 * Reported in microvolts because that is what the reader measures in. A source
 * that derived its limb leads in floating point will show a fraction of a
 * microvolt here; one that mislabelled a row will show hundreds.
 *
 * @param {Record<string, Int32Array>} leads all twelve signals
 * @returns {Array<{lead:string, relation:string, max_error_uv:number, holds:boolean}>} one row per derived lead
 * @throws {TypeError} when a required lead is missing
 */
export function lead_algebra_report(leads) {
  if (!is_plain_object(leads) || !LEAD_NAMES.every((lead) => leads[lead] instanceof Int32Array)) {
    throw new TypeError('lead_algebra_report(): leads must contain an Int32Array for all 12 standard leads');
  }
  return LIMB_RELATIONS.map(({ lead, relation, of }) => {
    let max_error_uv = 0;
    for (let index = 0; index < leads[lead].length; index += 1) {
      max_error_uv = Math.max(max_error_uv, Math.abs(of(leads, index) - leads[lead][index]));
    }
    const rounded = Math.round(max_error_uv * 100) / 100;
    // One microvolt is the quantisation step, so a disagreement at or below it
    // is rounding, not a different signal.
    return { lead, relation, max_error_uv: rounded, holds: rounded <= 1 };
  });
}

/**
 * Import a published 12-lead signal as a stored recording source.
 *
 * One call with named arguments; everything the import assumed comes back in
 * the result rather than being left for the caller to reconstruct.
 *
 * @param {object} options import request
 * @param {string} options.text file contents
 * @param {string} options.file_name name the file arrived under, hashed for the id
 * @param {number} options.sample_rate_hz rate the corpus documents
 * @param {string} [options.layout] `lead-major` or `sample-major`
 * @param {string} [options.units] `mV` or `uV`
 * @param {string} [options.corpus_id] short prefix naming the corpus
 * @returns {{case_id:string, sample_source:object, sample_count:number, sample_rate_hz:number,
 *   duration_seconds:number, lead_algebra:Array<object>, stored_bytes:number}} the import result
 * @throws {TypeError} when the signal is unreadable or too short
 * @throws {RangeError} when the stated sample rate is out of range
 */
export function import_ecg_signal({
  text, file_name, sample_rate_hz, layout = 'lead-major', units = 'mV', corpus_id = 'ecg',
}) {
  if (typeof file_name !== 'string' || file_name.trim() === '') {
    throw new TypeError('import_ecg_signal(): file_name must be a non-empty string');
  }
  if (!Number.isFinite(sample_rate_hz)
      || sample_rate_hz < MIN_ECG_SAMPLE_RATE_HZ || sample_rate_hz > MAX_ECG_SAMPLE_RATE_HZ) {
    throw new RangeError(`import_ecg_signal(): sample_rate_hz must be ${MIN_ECG_SAMPLE_RATE_HZ}–${MAX_ECG_SAMPLE_RATE_HZ} Hz`);
  }
  const { leads, sample_count } = parse_signal_table(text, { layout, units });
  const duration_seconds = sample_count / sample_rate_hz;
  if (duration_seconds < MIN_IMPORT_SECONDS) {
    throw new TypeError(`Imported signal is ${duration_seconds.toFixed(2)} s; at least ${MIN_IMPORT_SECONDS} seconds are required.`);
  }
  const lead_algebra = lead_algebra_report(leads);
  const channels = encode_sample_channels(leads);
  const stored_bytes = Object.values(channels).reduce((total, payload) => total + payload.length, 0);
  return {
    case_id: anonymous_source_id(file_name, corpus_id),
    sample_count,
    sample_rate_hz,
    duration_seconds,
    lead_algebra,
    stored_bytes,
    sample_source: {
      kind: 'samples',
      encoding: DELTA_VARINT_ENCODING,
      units: 'microvolts',
      sample_rate_hz,
      sample_count,
      duration_seconds,
      lead_names: [...LEAD_NAMES],
      channels,
    },
  };
}

/**
 * Shape an import result the way `create_uploaded_case_document` expects an
 * inspected upload, so an imported signal travels the same authoring path as a
 * file a person picked.
 *
 * @param {object} imported result of `import_ecg_signal`
 * @param {string} file_name name to record on the upload
 * @returns {{kind:'samples', file_name:string, mime_type:string, byte_length:number,
 *   suggested_id:string, suggested_title:string, sample_source:object}} an inspected upload
 * @throws {TypeError} when `imported` is not an import result
 */
export function upload_from_import(imported, file_name) {
  if (!is_plain_object(imported) || !is_plain_object(imported.sample_source)) {
    throw new TypeError('upload_from_import(): expected the result of import_ecg_signal');
  }
  return {
    kind: 'samples',
    file_name,
    mime_type: 'text/csv',
    byte_length: imported.stored_bytes,
    suggested_id: imported.case_id,
    // Never the file name: it states the finding. The neutral title is what the
    // library shows for a tracing whose identity has not been revealed.
    suggested_title: 'Resting 12-lead ECG',
    sample_source: imported.sample_source,
  };
}

/** The channels an import stores; the rest are derived on read. */
export const IMPORT_STORED_CHANNELS = INDEPENDENT_CHANNELS;
