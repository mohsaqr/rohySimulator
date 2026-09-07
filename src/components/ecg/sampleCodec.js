/**
 * Compact, synchronous encoding for stored ECG samples.
 *
 * The existing `int32-le-base64` encoding stores four bytes per sample per
 * lead, for all twelve leads. That is 312 KB of base64 for a 10 s recording —
 * 488% of Rohy's 64 KB case-config cap, which is why uploaded cases have only
 * ever worked in the standalone host.
 *
 * Almost all of that is waste. Adjacent ECG samples differ by a few microvolts,
 * so the DIFFERENCE between them fits in one byte where the value needs four,
 * and four of the twelve leads are exact linear combinations of the other two
 * (`derive_limb_leads`) so they need not be stored at all. Delta-encoding the
 * eight independent channels as zigzag varints brings the same recording to
 * roughly 53 KB — inside the cap, with headroom that `case_document_issues`
 * reports rather than leaves to chance.
 *
 * Why varints and not gzip: `recording_from_document` is called synchronously
 * inside a `useMemo`, and the platform's only built-in decompressor
 * (`DecompressionStream`) is asynchronous. gzip would store this signal in
 * ~35 KB instead of ~53 KB, but making the decode path async ripples through
 * every component that renders a recording. A byte budget is worth less than a
 * synchronous contract, so this codec buys the size with arithmetic that needs
 * no dependency and no await.
 *
 * The encoding is lossless over integer microvolts: `decode` of `encode` is the
 * identical Int32Array, which `tests/sample-codec.test.js` asserts by round trip.
 */

/** Encoding tag stored on a `sample_source` that uses this codec. */
export const DELTA_VARINT_ENCODING = 'delta-varint-base64';

/**
 * The channels that must be stored, in order.
 *
 * These are exactly the eight the waveform engine treats as independent; the
 * remaining four limb leads are reconstructed by `derive_limb_leads` so the
 * Einthoven and Goldberger relations hold by construction rather than by
 * having been serialised correctly.
 */
export const INDEPENDENT_CHANNELS = Object.freeze(['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']);

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Base64-encode bytes without assuming a Node or browser global.
 *
 * `src/` may not import anything, so this picks whichever primitive the host
 * provides. Chunked so a long recording cannot blow the argument limit of
 * `String.fromCharCode` on a large spread.
 */
const to_base64 = (bytes) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
};

const from_base64 = (text) => {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) {
    throw new TypeError('Encoded ECG samples must be valid base64.');
  }
  const binary = typeof atob === 'function'
    ? atob(text)
    : Buffer.from(text, 'base64').toString('binary');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

/**
 * Encode one channel as base64 zigzag-varint deltas.
 *
 * Zigzag maps signed deltas onto unsigned integers without sign-extending
 * small negatives into five-byte varints: -1 becomes 1, not 0xFFFFFFFF. An ECG
 * spends most of its time on a flat baseline, so most deltas land in one byte.
 *
 * @param {Int32Array} samples integer microvolts
 * @returns {string} base64 of the varint stream
 * @throws {TypeError} when `samples` is not an Int32Array
 */
export function encode_delta_varint(samples) {
  if (!(samples instanceof Int32Array)) {
    throw new TypeError('encode_delta_varint(): samples must be an Int32Array');
  }
  const bytes = [];
  let previous = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const delta = samples[index] - previous;
    previous = samples[index];
    let value = ((delta << 1) ^ (delta >> 31)) >>> 0;
    while (value > 0x7f) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(value);
  }
  return to_base64(Uint8Array.from(bytes));
}

/**
 * Decode a base64 zigzag-varint delta stream back to integer microvolts.
 *
 * A truncated stream, a varint that never terminates, or a sample count that
 * disagrees with the payload all throw. Returning a short or zero-padded
 * channel would put a silently wrong signal in front of a reader who is about
 * to measure it.
 *
 * @param {string} text base64 produced by `encode_delta_varint`
 * @param {number} sample_count samples the stream must contain
 * @returns {Int32Array} integer microvolts
 * @throws {TypeError} when the payload is malformed or the wrong length
 */
export function decode_delta_varint(text, sample_count) {
  if (!Number.isInteger(sample_count) || sample_count <= 0) {
    throw new TypeError('decode_delta_varint(): sample_count must be a positive integer');
  }
  const bytes = from_base64(text);
  const samples = new Int32Array(sample_count);
  let offset = 0;
  let previous = 0;
  for (let index = 0; index < sample_count; index += 1) {
    let value = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (offset >= bytes.length) {
        throw new TypeError(`Encoded ECG samples ended after ${index} of ${sample_count} samples.`);
      }
      if (shift > 28) throw new TypeError('Encoded ECG samples contain an over-long varint.');
      byte = bytes[offset];
      offset += 1;
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    const unsigned = value >>> 0;
    previous += (unsigned >>> 1) ^ -(unsigned & 1);
    samples[index] = previous;
  }
  if (offset !== bytes.length) {
    throw new TypeError(`Encoded ECG samples contain ${bytes.length - offset} trailing bytes.`);
  }
  return samples;
}

/**
 * Encode the eight independent channels of a recording.
 *
 * @param {Record<string, Int32Array>} leads signals by lead name
 * @returns {Record<string, string>} base64 varint payload per stored channel
 * @throws {TypeError} when a required channel is missing or ragged
 */
export function encode_sample_channels(leads) {
  if (leads === null || typeof leads !== 'object') {
    throw new TypeError('encode_sample_channels(): leads must be an object of Int32Array signals');
  }
  const missing = INDEPENDENT_CHANNELS.filter((channel) => !(leads[channel] instanceof Int32Array));
  if (missing.length > 0) {
    throw new TypeError(`encode_sample_channels(): missing Int32Array channels ${missing.join(', ')}`);
  }
  const lengths = new Set(INDEPENDENT_CHANNELS.map((channel) => leads[channel].length));
  if (lengths.size !== 1) {
    throw new TypeError('encode_sample_channels(): every stored channel must have the same length');
  }
  return Object.fromEntries(INDEPENDENT_CHANNELS.map((channel) =>
    [channel, encode_delta_varint(leads[channel])]));
}

/**
 * Decode the eight stored channels. Limb-lead derivation is the caller's job,
 * so this module stays about bytes and the signal module stays about leads.
 *
 * @param {Record<string, string>} channels base64 payload per stored channel
 * @param {number} sample_count samples each channel must contain
 * @returns {Record<string, Int32Array>} the eight independent signals
 * @throws {TypeError} when a channel is missing or malformed
 */
export function decode_sample_channels(channels, sample_count) {
  if (channels === null || typeof channels !== 'object') {
    throw new TypeError('decode_sample_channels(): channels must be an object of base64 strings');
  }
  const missing = INDEPENDENT_CHANNELS.filter((channel) => typeof channels[channel] !== 'string');
  if (missing.length > 0) {
    throw new TypeError(`decode_sample_channels(): missing channels ${missing.join(', ')}`);
  }
  return Object.fromEntries(INDEPENDENT_CHANNELS.map((channel) =>
    [channel, decode_delta_varint(channels[channel], sample_count)]));
}
