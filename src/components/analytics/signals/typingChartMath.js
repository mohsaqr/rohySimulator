/*
 * Ported from Oyon (standalone/app/src/lib/typingChartMath.js, commit 8e5d8b2)
 * so rohy's Text tab can draw the same writing-process charts over STORED
 * windows. The derivations are unchanged; only the chartMath import path
 * differs (rohy's chartMath.linearScale is byte-identical to Oyon's).
 * Tests: typingChartMath.test.js, ported from Oyon's app-typing-charts.test.js,
 * including the 200-episode agreement check against the real TypingAggregator.
 */

/*
 * typingChartMath — pure derivation/geometry functions behind the four
 * writing-process charts on /analyze/typing (TypingProgressionChart,
 * TypingProductionCurve, TypingIkiDistribution, TypingBurstStrip).
 *
 * Plain JS with a hand-written .d.ts sibling (same pattern as
 * timelineSlots.js / filterWindows.js) so the repo's framework-less node
 * test chain (tests/app-typing-charts.test.js) can exercise every function
 * directly — the derivations here are real analysis logic, not
 * presentation, and must be testable without React or a DOM.
 *
 * Honesty rules these functions enforce (see docs/TYPING.md and the chart
 * header comments):
 *
 *  - NOTHING is interpolated or invented. Every point returned corresponds
 *    to an observed edit in `typing.revision_locations` or an observed
 *    interval in `inter_event_intervals_ms`. When a required field is
 *    absent (no `offset`, no v3 `distance`), the derivation reports WHICH
 *    field is missing instead of fabricating a plausible series.
 *
 *  - Long idle gaps are COMPRESSED, never hidden and never left to squash
 *    the rest of the plot into a sliver. `compressTimeAxis` maps real
 *    episode time to a "compressed" time domain where any gap longer than
 *    `maxGapMs` collapses to a fixed `breakSpanMs` span; the returned
 *    `breaks` list carries the real duration of every compressed gap so
 *    the chart can label the compression explicitly (the same
 *    stated-not-silent stance as EmotionTimeline's break markers).
 *
 *  - Burst reconstruction mirrors TypingAggregator's `_closeCurrentBurst`
 *    rule EXACTLY (pause resolved before revision on a tie; a trailing
 *    open burst closes as a P-burst; a burst with no production closes
 *    nothing). tests/app-typing-charts.test.js asserts the reconstruction
 *    agrees with the aggregator's own reported `p_burst_count` /
 *    `r_burst_count` on scripted episodes.
 */

import { linearScale } from '../charts/chartMath.js';

/** Ops that terminate a burst as an R-burst — TypingAggregator's `isRevisionState`. */
const REVISION_OPS = new Set(['delete', 'replace']);

// ── Compressed time axis ────────────────────────────────────────────────────

/**
 * Piecewise-linear mapping from real episode time to a compressed time
 * domain in which any inter-anchor gap strictly longer than `maxGapMs`
 * occupies exactly `breakSpanMs` compressed units. Everything outside a
 * compressed gap keeps 1:1 time scale, so durations remain comparable
 * within (and across) un-compressed regions.
 *
 * @param {number[]} times monotonic anchor timestamps (ms). Typically the
 *   episode start, every edit `t`, and the episode end, in order.
 * @param {{maxGapMs?: number, breakSpanMs?: number}} [options]
 * @returns {{
 *   spanMs: number,
 *   breaks: Array<{realStart:number, realEnd:number, gapMs:number, compStart:number, compEnd:number}>,
 *   toCompressed: (t: number) => number,
 * }} `toCompressed` maps a real timestamp to compressed ms since the first
 *   anchor; timestamps inside a compressed gap map linearly within its span.
 */
export function compressTimeAxis(times, { maxGapMs = 15000, breakSpanMs = 3000 } = {}) {
  if (!Array.isArray(times) || times.length === 0) {
    return { spanMs: 0, breaks: [], toCompressed: () => 0 };
  }
  const t0 = times[0];
  const breaks = [];
  let removed = 0; // cumulative real-ms removed by compression so far
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap > maxGapMs) {
      const compStart = times[i - 1] - t0 - removed;
      breaks.push({
        realStart: times[i - 1],
        realEnd: times[i],
        gapMs: gap,
        compStart,
        compEnd: compStart + breakSpanMs,
      });
      removed += gap - breakSpanMs;
    }
  }
  const spanMs = times[times.length - 1] - t0 - removed;

  const toCompressed = (t) => {
    let removedBefore = 0;
    for (const b of breaks) {
      if (t <= b.realStart) break;
      if (t >= b.realEnd) {
        removedBefore += b.gapMs - breakSpanMs;
        continue;
      }
      // Inside a compressed gap: linear within its fixed span.
      return b.compStart + ((t - b.realStart) / b.gapMs) * breakSpanMs;
    }
    return t - t0 - removedBefore;
  };

  return { spanMs, breaks, toCompressed };
}

// ── Pause detection (fixed threshold, mirrors the aggregator) ───────────────

/**
 * Gaps between consecutive edit timestamps that meet the episode's FIXED
 * pause threshold — the same `interval >= burstThresholdMs` comparison
 * `TypingAggregator.record()` applies (>=, not >).
 *
 * @param {number[]} times monotonic edit timestamps (ms), in order
 * @param {number} thresholdMs the episode's `quality.thresholds.burst_threshold_ms`
 * @returns {Array<{startT:number, endT:number, gapMs:number}>}
 */
export function findPauses(times, thresholdMs) {
  const pauses = [];
  if (!Array.isArray(times)) return pauses;
  for (let i = 1; i < times.length; i += 1) {
    const gap = Math.max(0, times[i] - times[i - 1]);
    if (gap >= thresholdMs) {
      pauses.push({ startT: times[i - 1], endT: times[i], gapMs: gap });
    }
  }
  return pauses;
}

// ── Leading edge (frontier) ─────────────────────────────────────────────────

/**
 * The document's leading edge over time: at each positioned edit, the
 * furthest point the text has reached so far. Where the v3 `distance`
 * field is present, the document end at that edit is recovered EXACTLY as
 * `offset + distance` (the aggregator computed `distance` as
 * `currentGraphemes - caretOffset`); on v2 entries without `distance` the
 * caret `offset` itself is used, making the frontier an honest lower
 * bound rather than an invention. Entries without a finite `offset`
 * contribute nothing.
 *
 * @param {Array<{offset?:number, distance?:number, t:number}>} entries
 *   `typing.revision_locations`, already in time order
 * @returns {Array<{t:number, frontier:number}>} one point per usable entry
 */
export function computeFrontier(entries) {
  const points = [];
  if (!Array.isArray(entries)) return points;
  let frontier = 0;
  for (const e of entries) {
    if (!Number.isFinite(e?.offset)) continue;
    const docEnd = Number.isFinite(e.distance) ? e.offset + e.distance : e.offset;
    frontier = Math.max(frontier, docEnd);
    points.push({ t: e.t, frontier });
  }
  return points;
}

// ── Cumulative production ───────────────────────────────────────────────────

/**
 * Committed document length (graphemes) at each edit — the production
 * curve's y series. Recovered exactly from each entry's `offset + distance`
 * (see `computeFrontier`); deletions therefore appear as REAL downward
 * steps, not reconstructed guesses. No accumulation heuristics: if any
 * entry lacks the fields needed for an exact value, the whole series is
 * declared underivable and the missing field is named, so the chart can
 * render an explicit degraded state instead of a plausible-looking lie.
 *
 * @param {Array<{offset?:number, distance?:number, t:number}>} entries
 *   `typing.revision_locations`, already in time order
 * @returns {{points: Array<{t:number, committed:number}>, missing: string|null}}
 *   `missing` is `'revision_locations'` (none recorded), `'offset'`, or
 *   `'distance'` (typing-v2 rows) when the series cannot be derived.
 */
export function productionSeries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { points: [], missing: 'revision_locations' };
  }
  const points = [];
  for (const e of entries) {
    if (!Number.isFinite(e?.offset)) return { points: [], missing: 'offset' };
    if (!Number.isFinite(e.distance)) return { points: [], missing: 'distance' };
    points.push({ t: e.t, committed: e.offset + e.distance });
  }
  return { points, missing: null };
}

// ── Log-spaced IKI histogram ────────────────────────────────────────────────

/**
 * Bin index (0-based) of an interval on the log-spaced axis. Bin 0 is the
 * underflow bin [0, minMs); bin k >= 1 covers
 * [minMs·10^((k−1)/binsPerDecade), minMs·10^(k/binsPerDecade)). A small
 * epsilon absorbs floating-point error so exact decade edges land in the
 * bin they open (e.g. 100 ms with minMs 10 opens a new bin, never falls
 * a hair short into the previous one).
 *
 * @param {number} intervalMs
 * @param {{binsPerDecade?: number, minMs?: number}} [options]
 * @returns {number}
 */
export function logBinIndex(intervalMs, { binsPerDecade = 4, minMs = 10 } = {}) {
  if (!(intervalMs >= minMs)) return 0;
  return 1 + Math.floor(Math.log10(intervalMs / minMs) * binsPerDecade + 1e-9);
}

/**
 * Log-spaced histogram of inter-event intervals. IKI distributions are
 * heavy-tailed (log-normal-ish): a linear axis renders them as one spike
 * against an empty plain, so the axis here is log-spaced with
 * `binsPerDecade` bins per decade above `minMs` plus a single underflow
 * bin for sub-`minMs` intervals.
 *
 * @param {number[]} intervals `typing.inter_event_intervals_ms`
 * @param {{binsPerDecade?: number, minMs?: number}} [options]
 * @returns {{bins: Array<{lo:number, hi:number, count:number}>, total: number}}
 *   bins in ascending order, trailing empty bins trimmed; `bins[0]` is the
 *   underflow bin (lo 0). Empty input → `{bins: [], total: 0}`.
 */
export function buildLogHistogram(intervals, options = {}) {
  const { binsPerDecade = 4, minMs = 10 } = options;
  const usable = Array.isArray(intervals)
    ? intervals.filter((v) => Number.isFinite(v) && v >= 0)
    : [];
  if (usable.length === 0) return { bins: [], total: 0 };

  const counts = [];
  for (const v of usable) {
    const k = logBinIndex(v, { binsPerDecade, minMs });
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const bins = [];
  for (let k = 0; k < counts.length; k += 1) {
    const lo = k === 0 ? 0 : minMs * 10 ** ((k - 1) / binsPerDecade);
    const hi = minMs * 10 ** (k / binsPerDecade);
    bins.push({ lo, hi, count: counts[k] ?? 0 });
  }
  return { bins, total: usable.length };
}

// ── Burst reconstruction (P- vs R-bursts) ───────────────────────────────────

/**
 * Reconstruct the episode's burst segmentation from the per-edit op/time
 * series, applying EXACTLY the rule TypingAggregator uses (class doc
 * "P-burst / R-burst tie-break rule" + `_closeCurrentBurst`):
 *
 *   1. For each edit after the first, a gap >= `thresholdMs` since the
 *      previous edit closes the in-progress burst as a P-burst FIRST.
 *   2. Then, if the edit's own op is `delete`/`replace`, it closes the
 *      (possibly already-emptied) burst as an R-burst. Pause wins the tie.
 *   3. A revision never contributes production; any other op does.
 *   4. A burst still open when the series ends closes as a P-burst
 *      (`closedBy: 'end'` — episode termination is not a revision).
 *   5. A burst with no production closes nothing.
 *
 * `ops`/`times` are parallel arrays (one entry per committed edit, e.g.
 * from `revision_locations`). When some edits lacked a caret offset the
 * reconstruction can disagree with the aggregator's reported counts — the
 * caller must compare against `p_burst_count`/`r_burst_count` and disclose
 * a mismatch rather than present the strip as authoritative.
 *
 * @param {string[]} ops per-edit op labels, time order
 * @param {number[]} times per-edit monotonic timestamps (ms), time order
 * @param {number} thresholdMs fixed pause threshold (`burst_threshold_ms`)
 * @returns {{
 *   segments: Array<{kind:'p'|'r', closedBy:'pause'|'revision'|'end', startT:number, endT:number, edits:number}>,
 *   pCount: number,
 *   rCount: number,
 * }}
 */
export function reconstructBursts(ops, times, thresholdMs) {
  const segments = [];
  let pCount = 0;
  let rCount = 0;
  let cur = null;

  const close = (kind, closedBy) => {
    if (!cur) return; // no production in the in-progress burst → closes nothing
    segments.push({ kind, closedBy, startT: cur.startT, endT: cur.endT, edits: cur.edits });
    if (kind === 'r') rCount += 1;
    else pCount += 1;
    cur = null;
  };

  const n = Math.min(
    Array.isArray(ops) ? ops.length : 0,
    Array.isArray(times) ? times.length : 0,
  );
  for (let i = 0; i < n; i += 1) {
    if (i > 0 && Math.max(0, times[i] - times[i - 1]) >= thresholdMs) {
      close('p', 'pause');
    }
    if (REVISION_OPS.has(ops[i])) {
      close('r', 'revision');
    } else {
      if (!cur) cur = { startT: times[i], endT: times[i], edits: 0 };
      cur.endT = times[i];
      cur.edits += 1;
    }
  }
  close('p', 'end');

  return { segments, pCount, rCount };
}

// ── Axis ticks through the compressed mapping ───────────────────────────────

/**
 * "Nice" episode-time tick positions mapped through a compressed axis.
 * Ticks are generated on REAL episode time (d3-style nice values via
 * chartMath's linearScale) and any tick that would land inside a
 * compressed break is dropped — a tick inside a break band would imply
 * the band has 1:1 time scale, which is exactly what it does not have.
 *
 * @param {{breaks: Array<{realStart:number, realEnd:number}>, toCompressed: (t:number)=>number}} axis
 * @param {number} startT real timestamp of episode start
 * @param {number} endT real timestamp of episode end
 * @param {number} [count=6]
 * @returns {Array<{realMs:number, comp:number}>} realMs is ms since episode start
 */
export function axisTimeTicks(axis, startT, endT, count = 6) {
  if (!(endT > startT)) return [];
  const scale = linearScale([0, endT - startT], [0, 1]);
  return scale
    .ticks(count)
    .filter((v) => v >= 0 && v <= endT - startT)
    .filter((v) => !axis.breaks.some((b) => startT + v > b.realStart && startT + v < b.realEnd))
    .map((v) => ({ realMs: v, comp: axis.toCompressed(startT + v) }));
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Compact duration label for axis ticks and compressed-gap markers:
 * "850ms", "12s", "1m05s", "1.2h".
 * @param {number} ms
 * @returns {string}
 */
export function formatDurationShort(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) {
    const s = ms / 1000;
    return Number.isInteger(s) ? `${s}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`;
  }
  if (ms < 3600000) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, '0')}s`;
  }
  return `${(ms / 3600000).toFixed(1)}h`;
}
