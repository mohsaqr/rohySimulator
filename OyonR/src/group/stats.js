/**
 * The few helpers `groupTimeline` needs for resampling (the LOCF tolerance).
 * Analysis maths — standardising, correlations, regressions, RNGs, nulls —
 * lives in ladyna (`ladyna/synchrony`), not here.
 */

/** Error raised for a broken input contract in `oyon/group`; `code` is the contract. */
export class GroupInputError extends Error {
  constructor(message, code = 'oyon_group_bad_input') {
    super(message);
    this.name = 'GroupInputError';
    this.code = code;
  }
}

export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Median of the finite entries; null when there are none. */
export function median(values) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
