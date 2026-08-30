import { LEAD_NAMES } from './constants.js';
import { validate_render_spec } from './presets.js';
import { generate_twelve_lead_ecg } from './waveform.js';

export const SAMPLE_SOURCE_ENCODING = 'int32-le-base64';
export const MIN_ECG_SAMPLE_RATE_HZ = 50;
export const MAX_ECG_SAMPLE_RATE_HZ = 2000;
export const STATIC_ECG_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);

const is_plain_object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const decode_base64 = (encoded) => {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new TypeError('Encoded ECG samples must be valid base64.');
  }
  try {
    const binary = typeof atob === 'function'
      ? atob(encoded)
      : Buffer.from(encoded, 'base64').toString('binary');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError('Encoded ECG samples must be valid base64.');
  }
};

const data_url_parts = (data_url) => {
  if (typeof data_url !== 'string') throw new TypeError('The uploaded ECG asset is missing its data URL.');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(data_url);
  if (!match) throw new TypeError('The uploaded ECG asset must use a base64 data URL.');
  return { mime_type: match[1].toLowerCase(), bytes: decode_base64(match[2]) };
};

const bytes_match = (bytes, expected, offset = 0) =>
  expected.every((value, index) => bytes[offset + index] === value);

const ascii_at = (bytes, offset, length) =>
  Array.from(bytes.slice(offset, offset + length), (value) => String.fromCharCode(value)).join('');

/** Return the actual supported static-media type after checking file structure. */
export function validated_static_mime_type(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new TypeError('The uploaded ECG asset is empty.');
  }
  const is_png = bytes.length >= 24
    && bytes_match(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    && ascii_at(bytes, 12, 4) === 'IHDR';
  if (is_png) return 'image/png';

  const is_jpeg = bytes.length >= 4
    && bytes_match(bytes, [0xff, 0xd8, 0xff])
    && bytes_match(bytes, [0xff, 0xd9], bytes.length - 2);
  if (is_jpeg) return 'image/jpeg';

  const webp_declared_length = bytes.length >= 12
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8
    : 0;
  const is_webp = bytes.length >= 16
    && ascii_at(bytes, 0, 4) === 'RIFF'
    && ascii_at(bytes, 8, 4) === 'WEBP'
    && webp_declared_length === bytes.length;
  if (is_webp) return 'image/webp';

  const pdf_tail = ascii_at(bytes, Math.max(0, bytes.length - 1024), Math.min(1024, bytes.length));
  const is_pdf = bytes.length >= 12
    && ascii_at(bytes, 0, 5) === '%PDF-'
    && /%%EOF\s*$/.test(pdf_tail);
  if (is_pdf) return 'application/pdf';

  throw new TypeError('The ECG asset content is not a valid PNG, JPEG, WebP, or PDF file.');
}

const validated_asset = (asset) => {
  if (!is_plain_object(asset)) throw new TypeError('The ECG recording asset must be an object.');
  const { mime_type, bytes } = data_url_parts(asset.data_url);
  const detected_mime_type = validated_static_mime_type(bytes);
  if (mime_type !== detected_mime_type || asset.mime_type !== detected_mime_type) {
    throw new TypeError(`The ECG asset content is ${detected_mime_type}, but its declared media type does not match.`);
  }
  if (typeof asset.file_name !== 'string' || asset.file_name.trim() === '') {
    throw new TypeError('The ECG asset needs its original file name.');
  }
  if (!Number.isInteger(asset.byte_length) || asset.byte_length !== bytes.length) {
    throw new TypeError('The ECG asset byte length does not match its decoded content.');
  }
  return {
    data_url: asset.data_url,
    mime_type: detected_mime_type,
    file_name: asset.file_name,
    byte_length: bytes.length,
  };
};

const validated_sample_source = (sample_source) => {
  if (!is_plain_object(sample_source) || sample_source.kind !== 'samples') {
    throw new TypeError("The ECG sample source must have kind 'samples'.");
  }
  if (sample_source.encoding !== SAMPLE_SOURCE_ENCODING) {
    throw new TypeError(`The ECG sample encoding must be '${SAMPLE_SOURCE_ENCODING}'.`);
  }
  if (sample_source.units !== 'microvolts') {
    throw new TypeError("Encoded ECG sample units must be 'microvolts'.");
  }
  if (!Number.isFinite(sample_source.sample_rate_hz) || sample_source.sample_rate_hz <= 0
      || !Number.isInteger(sample_source.sample_count) || sample_source.sample_count <= 0) {
    throw new TypeError('Encoded ECG samples need a positive sample rate and integer sample count.');
  }
  if (sample_source.sample_rate_hz < MIN_ECG_SAMPLE_RATE_HZ
      || sample_source.sample_rate_hz > MAX_ECG_SAMPLE_RATE_HZ) {
    throw new RangeError(`Encoded ECG sample rate must be ${MIN_ECG_SAMPLE_RATE_HZ}–${MAX_ECG_SAMPLE_RATE_HZ} Hz.`);
  }
  if (!Number.isFinite(sample_source.duration_seconds) || sample_source.duration_seconds <= 0
      || Math.abs(sample_source.sample_count / sample_source.sample_rate_hz - sample_source.duration_seconds) > 0.01) {
    throw new TypeError('Encoded ECG sample count, rate, and duration are inconsistent.');
  }
  if (!Array.isArray(sample_source.lead_names)
      || sample_source.lead_names.length !== LEAD_NAMES.length
      || !LEAD_NAMES.every((lead, index) => sample_source.lead_names[index] === lead)) {
    throw new TypeError('Encoded ECG samples must list all 12 standard leads in conventional order.');
  }
  if (!is_plain_object(sample_source.leads)
      || !LEAD_NAMES.every((lead) => typeof sample_source.leads[lead] === 'string')) {
    throw new TypeError('Encoded ECG samples must include data for all 12 standard leads.');
  }
  const decoded_leads = Object.fromEntries(LEAD_NAMES.map((lead) => {
    const bytes = decode_base64(sample_source.leads[lead]);
    if (bytes.byteLength !== sample_source.sample_count * Int32Array.BYTES_PER_ELEMENT) {
      throw new TypeError(`Encoded lead ${lead} does not contain ${sample_source.sample_count} samples.`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = Int32Array.from({ length: sample_source.sample_count }, (_unused, index) =>
      view.getInt32(index * Int32Array.BYTES_PER_ELEMENT, true));
    return [lead, samples];
  }));
  return { ...sample_source, leads: decoded_leads };
};

const source_candidates = (recording_document) => {
  if (!is_plain_object(recording_document)) return [];
  return [
    ['generated', recording_document.render_spec, (value) => validate_render_spec(value)],
    ['samples', recording_document.sample_source, (value) => validated_sample_source(value)],
    ['asset', recording_document.asset, (value) => validated_asset(value)],
  ].filter(([, value]) => value !== undefined && value !== null)
    .map(([candidate_kind, value, validator]) => {
      try {
        return { candidate_kind, value: validator(value) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

/** Classify the single valid source on a stored recording document. */
export function recording_source_kind(recording_document) {
  const candidates = source_candidates(recording_document);
  if (candidates.length !== 1) return 'unknown';
  const candidate = candidates[0];
  if (candidate.candidate_kind !== 'asset') return candidate.candidate_kind;
  return candidate.value.mime_type === 'application/pdf' ? 'pdf' : 'image';
}

/** Can a generated, uploaded-sample, image, or PDF recording be shown? */
export function recording_document_is_renderable(recording_document) {
  return recording_source_kind(recording_document) !== 'unknown';
}

/**
 * Materialize a stored recording source for a viewer.
 * Generated and uploaded numeric sources return the common waveform shape.
 */
export function recording_from_document(recording_document) {
  if (!is_plain_object(recording_document)) throw new TypeError('The ECG recording document must be an object.');
  const kind = recording_source_kind(recording_document);
  if (kind === 'generated') {
    return { source_kind: 'generated', ...generate_twelve_lead_ecg(recording_document.render_spec) };
  }
  if (kind === 'samples') {
    const decoded = validated_sample_source(recording_document.sample_source);
    return {
      source_kind: 'samples',
      engine_version: null,
      units: decoded.units,
      sample_rate_hz: decoded.sample_rate_hz,
      duration_seconds: decoded.duration_seconds,
      sample_count: decoded.sample_count,
      paper_speed_mm_per_second: decoded.paper_speed_mm_per_second ?? 25,
      gain_mm_per_mv: decoded.gain_mm_per_mv ?? 10,
      rhythm_lead: LEAD_NAMES.includes(decoded.rhythm_lead) ? decoded.rhythm_lead : 'II',
      lead_names: [...LEAD_NAMES],
      leads: decoded.leads,
      beat_schedule: [],
      measurements: null,
    };
  }
  if (kind === 'image' || kind === 'pdf') {
    return { source_kind: kind, asset: validated_asset(recording_document.asset) };
  }
  throw new TypeError('The ECG recording has no single valid generated, sample, image, or PDF source.');
}
