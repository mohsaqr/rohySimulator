/*
 * writingChartMath — the time axis of the writing process graph.
 *
 * A document is written over sittings hours or days apart. On a true time axis the sittings are slivers
 * and the gaps are the picture. So the axis is PIECEWISE: each sitting (a run of edits with no gap longer
 * than `maxGapMs`) takes width in proportion to its length, with a floor so a short sitting is still
 * legible; each gap between sittings takes one fixed, labelled band. Slopes can be compared inside a
 * sitting, never across a band — the band says how long it stands for.
 *
 * Pure; no DOM.
 */

export interface Sitting { start: number; end: number; from: number; to: number; x0: number; x1: number }
export interface SittingGap { start: number; end: number; x0: number; x1: number }
export interface SittingAxis {
  sittings: Sitting[];
  gaps: SittingGap[];
  /** A time → x in [0, width]. Times inside a gap fall on the gap band, linearly. */
  x: (t: number) => number;
}

/**
 * @param times     ascending edit times (ms)
 * @param width     plot width in px
 * @param maxGapMs  a longer silence starts a new sitting (default 10 min)
 * @param gapPx     width of one gap band (default 30)
 * @param minPx     least width of one sitting (default 36)
 */
export function sittingAxis(times: number[], width: number, maxGapMs = 10 * 60 * 1000, gapPx = 30, minPx = 36): SittingAxis {
  if (times.length === 0) return { sittings: [], gaps: [], x: () => 0 };
  const runs: Array<{ start: number; end: number; from: number; to: number }> = [];
  let from = 0;
  for (let i = 1; i <= times.length; i += 1) {
    if (i === times.length || times[i] - times[i - 1] > maxGapMs) {
      runs.push({ start: times[from], end: times[i - 1], from, to: i - 1 });
      from = i;
    }
  }
  // Too many sittings for the width: the bands and floors would not fit. Shrink both in step.
  const fit = Math.min(1, width / Math.max(1, runs.length * minPx + (runs.length - 1) * gapPx));
  const band = gapPx * fit, floor = minPx * fit;
  const free = Math.max(0, width - (runs.length - 1) * band - runs.length * floor);
  const total = runs.reduce((sum, run) => sum + (run.end - run.start), 0);
  const sittings: Sitting[] = [];
  const gaps: SittingGap[] = [];
  let cursor = 0;
  runs.forEach((run, i) => {
    const w = floor + (total > 0 ? (free * (run.end - run.start)) / total : free / runs.length);
    sittings.push({ ...run, x0: cursor, x1: cursor + w });
    cursor += w;
    if (i < runs.length - 1) {
      gaps.push({ start: run.end, end: runs[i + 1].start, x0: cursor, x1: cursor + band });
      cursor += band;
    }
  });
  const x = (t: number): number => {
    for (const s of sittings) {
      if (t >= s.start && t <= s.end) return s.end === s.start ? (s.x0 + s.x1) / 2 : s.x0 + ((t - s.start) / (s.end - s.start)) * (s.x1 - s.x0);
    }
    for (const g of gaps) {
      if (t > g.start && t < g.end) return g.x0 + ((t - g.start) / (g.end - g.start)) * (g.x1 - g.x0);
    }
    return t < sittings[0].start ? 0 : width;
  };
  return { sittings, gaps, x };
}

/** "45 s", "12 min", "3 h", "2 d": how long a gap band stands for. */
export function gapWords(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/** Round axis maximum and a few ticks for a count axis starting at 0 (or spanning below it). */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
