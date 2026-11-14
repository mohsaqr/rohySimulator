/*
 * Raw-only records in a window list.
 *
 * Besides its interval windows the runtime sends raw-only envelopes
 * (`modality: 'raw'`): rows no window carried (sent at stop, at the recorder's
 * row bound, or when a track ends), and the continuation parts of a window too
 * large for one POST (`raw_part`). They share the window store and the host
 * feed with the camera windows, but they are not emotion windows: counting
 * them as such would add empty windows to every measure.
 *
 * splitRawOnly joins split windows back first (oyon joinRawParts), then
 * separates the two: `windows` for analysis, `rawOnly` kept for export, so no
 * row is lost.
 *
 * Plain JS with a .d.ts so the node tests run it.
 */
import { joinRawParts } from '../../../../src/records/rawParts.js';

/** A raw-only envelope (rows only, no emotion window). */
export function isRawOnly(record) {
  return Boolean(record) && typeof record === 'object' && record.modality === 'raw';
}

/**
 * @param {object[]} windows  stored or fed windows, raw-only envelopes included
 * @returns {{ windows: object[], rawOnly: object[] }}
 */
export function splitRawOnly(windows) {
  if (!Array.isArray(windows)) throw new TypeError('splitRawOnly: `windows` must be an array');
  const joined = joinRawParts(windows);
  return {
    windows: joined.filter((w) => !isRawOnly(w)),
    rawOnly: joined.filter(isRawOnly),
  };
}
