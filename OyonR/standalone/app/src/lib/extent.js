/*
 * extent — the smallest and largest finite number in a series, in one pass.
 *
 * `Math.min(...values)` passes every value as a call argument, and engines cap
 * the argument count (V8 throws RangeError somewhere past ~100 000), so a long
 * per-sample series broke the chart that drew it. Drawing every observation
 * needs nothing else: this is a display range, not a statistic.
 */

/**
 * @param {Iterable<unknown>} values  non-finite entries are skipped
 * @param {{ include?: number[] }} [opts]  values the range must also cover (e.g. 0)
 * @returns {{ min: number, max: number } | null}  null when nothing is finite
 */
export function extent(values, { include = [] } = {}) {
  let min = Infinity;
  let max = -Infinity;
  const take = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  };
  for (const v of values ?? []) take(v);
  if (min === Infinity) return null;
  include.forEach(take);
  return { min, max };
}
