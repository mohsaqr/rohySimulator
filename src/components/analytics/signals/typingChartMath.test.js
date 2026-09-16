// Ported from Oyon's tests/app-typing-charts.test.js (node:assert blocks, kept
// verbatim) so the chart derivations rohy draws are held to the same contract,
// including agreement with the real TypingAggregator on 200 seeded episodes.

import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  compressTimeAxis,
  axisTimeTicks,
  findPauses,
  computeFrontier,
  productionSeries,
  logBinIndex,
  buildLogHistogram,
  reconstructBursts,
  formatDurationShort,
} from './typingChartMath.js';
import { TypingAggregator } from '../../../../OyonR/src/aggregation/TypingAggregator.js';


// ---- 1. compressTimeAxis ----
it('1. compressTimeAxis', () => {
  const axis = compressTimeAxis([0, 1000, 2000, 62000, 63000], { maxGapMs: 15000, breakSpanMs: 3000 });
  assert.equal(axis.breaks.length, 1, 'one gap above maxGapMs -> one break');
  const b = axis.breaks[0];
  assert.deepEqual(
    { realStart: b.realStart, realEnd: b.realEnd, gapMs: b.gapMs, compStart: b.compStart, compEnd: b.compEnd },
    { realStart: 2000, realEnd: 62000, gapMs: 60000, compStart: 2000, compEnd: 5000 },
  );
  assert.equal(axis.spanMs, 6000, 'span = real span minus (gap - breakSpan)');
  assert.equal(axis.toCompressed(0), 0);
  assert.equal(axis.toCompressed(2000), 2000, '1:1 before the break');
  assert.equal(axis.toCompressed(32000), 3500, 'mid-gap maps linearly inside the fixed span');
  assert.equal(axis.toCompressed(62000), 5000);
  assert.equal(axis.toCompressed(63000), 6000, '1:1 after the break');

  // Monotonicity across the whole domain.
  let prev = -Infinity;
  for (let t = 0; t <= 63000; t += 250) {
    const x = axis.toCompressed(t);
    assert.ok(x >= prev, `toCompressed monotonic at t=${t}`);
    prev = x;
  }

  // A gap exactly at maxGapMs is NOT compressed (strictly-greater rule).
  const edge = compressTimeAxis([0, 15000], { maxGapMs: 15000, breakSpanMs: 3000 });
  assert.equal(edge.breaks.length, 0);
  assert.equal(edge.spanMs, 15000);

  // Degenerate inputs.
  assert.equal(compressTimeAxis([]).spanMs, 0);
  assert.equal(compressTimeAxis([5]).spanMs, 0);
});

// ---- axisTimeTicks ----
it('axisTimeTicks', () => {
  const axis = compressTimeAxis([0, 1000, 2000, 62000, 63000], { maxGapMs: 15000, breakSpanMs: 3000 });
  const ticks = axisTimeTicks(axis, 0, 63000, 6);
  assert.ok(ticks.length > 0, 'ticks exist');
  // No tick may land strictly inside the compressed break (2000..62000).
  assert.ok(
    ticks.every((tk) => !(tk.realMs > 2000 && tk.realMs < 62000)),
    'no tick inside a compressed break',
  );
  // Ticks map through the same compression as the data.
  for (const tk of ticks) assert.equal(tk.comp, axis.toCompressed(tk.realMs));
  assert.deepEqual(axisTimeTicks(axis, 5, 5, 6), [], 'degenerate domain -> no ticks');
});

// ---- findPauses (threshold is inclusive, mirroring the aggregator's >=) ----
it("findPauses (threshold is inclusive, mirroring the aggregator's >=)", () => {
  const pauses = findPauses([0, 2000, 2500, 6000], 2000);
  assert.deepEqual(pauses, [
    { startT: 0, endT: 2000, gapMs: 2000 },
    { startT: 2500, endT: 6000, gapMs: 3500 },
  ]);
  assert.deepEqual(findPauses([0, 1999], 2000), []);
});

// ---- 2. computeFrontier ----
it('2. computeFrontier', () => {
  const points = computeFrontier([
    { offset: 5, distance: 0, t: 1 },
    { offset: 10, distance: 0, t: 2 },
    { offset: 3, distance: 7, t: 3 }, // mid-doc edit: doc end = 3 + 7 = 10
    { offset: 4, distance: 2, t: 4 }, // doc shrank to 6 — frontier must NOT drop
    { offset: 12, distance: 0, t: 5 },
  ]);
  assert.deepEqual(points.map((p) => p.frontier), [5, 10, 10, 10, 12]);

  // v2 entry without distance: offset alone is the (lower-bound) doc end.
  assert.deepEqual(computeFrontier([{ offset: 7, t: 1 }]).map((p) => p.frontier), [7]);
  // Entries with no usable offset contribute nothing.
  assert.deepEqual(computeFrontier([{ offset: null, t: 1 }, { t: 2 }]), []);
  assert.deepEqual(computeFrontier([]), []);
});

// ---- 3. productionSeries ----
it('3. productionSeries', () => {
  // Type 5 chars at the end, delete one, insert mid-document.
  const series = productionSeries([
    { offset: 1, distance: 0, t: 10 },
    { offset: 2, distance: 0, t: 20 },
    { offset: 3, distance: 0, t: 30 },
    { offset: 4, distance: 0, t: 40 },
    { offset: 5, distance: 0, t: 50 },
    { offset: 4, distance: 0, t: 60 }, // backspace: committed drops 5 -> 4
    { offset: 3, distance: 2, t: 70 }, // mid-doc insert: committed 5
  ]);
  assert.equal(series.missing, null);
  assert.deepEqual(series.points.map((p) => p.committed), [1, 2, 3, 4, 5, 4, 5]);
  assert.ok(
    series.points[5].committed < series.points[4].committed,
    'a deletion must appear as a real downward step',
  );

  // Underivable series name the missing field — never fabricate points.
  assert.deepEqual(productionSeries([]), { points: [], missing: 'revision_locations' });
  assert.equal(productionSeries([{ offset: 1, t: 0 }]).missing, 'distance');
  assert.equal(productionSeries([{ distance: 1, t: 0 }]).missing, 'offset');
  assert.equal(productionSeries([{ offset: 1, distance: 0, t: 0 }, { offset: 2, t: 1 }]).missing, 'distance');
});

// ---- 4. log-spaced IKI bucketing ----
it('4. log-spaced IKI bucketing', () => {
  const opts = { binsPerDecade: 4, minMs: 10 };
  assert.equal(logBinIndex(0, opts), 0, 'sub-minMs intervals land in the underflow bin');
  assert.equal(logBinIndex(9.9, opts), 0);
  assert.equal(logBinIndex(10, opts), 1, 'minMs opens bin 1');
  assert.equal(logBinIndex(17, opts), 1);
  assert.equal(logBinIndex(99, opts), 4);
  assert.equal(logBinIndex(100, opts), 5, 'an exact decade edge opens its own bin (epsilon guard)');
  assert.equal(logBinIndex(2000, opts), 10);

  const hist = buildLogHistogram([5, 12, 12, 150, 3000], opts);
  assert.equal(hist.total, 5);
  assert.equal(hist.bins.length, 11, 'bins run up to the largest occupied index');
  assert.deepEqual(hist.bins[0], { lo: 0, hi: 10, count: 1 });
  assert.equal(hist.bins[1].count, 2);
  assert.ok(Math.abs(hist.bins[1].lo - 10) < 1e-9);
  assert.ok(Math.abs(hist.bins[1].hi - 10 * 10 ** 0.25) < 1e-9);
  assert.equal(hist.bins[5].count, 1);
  assert.equal(hist.bins[10].count, 1);
  assert.equal(hist.bins.reduce((s, b) => s + b.count, 0), 5);

  assert.deepEqual(buildLogHistogram([], opts), { bins: [], total: 0 });
  assert.deepEqual(buildLogHistogram([NaN, -5], opts), { bins: [], total: 0 });
});

// ---- 5. burst reconstruction vs the real aggregator ----

/** Run a scripted list of {t, prev, cur, replaced?} edits through TypingAggregator. */
function runEpisode(edits, { finalizeAt, reason = 'submitted' }) {
  const agg = new TypingAggregator({ now: () => 1700000000000 });
  agg.start({ timestamp: 0 });
  for (const e of edits) {
    agg.record({
      timestamp: e.t,
      previousGraphemes: e.prev,
      currentGraphemes: e.cur,
      replacedSelection: e.replaced === true,
      caretOffset: e.cur, // caret at the document end — every edit is positioned
    });
  }
  return agg.finalize({ timestamp: finalizeAt, reason });
}

/** Reconstruct from the window exactly as TypingBurstStrip does. */
function reconstructFromWindow(win) {
  const entries = win.typing.revision_locations;
  return reconstructBursts(
    entries.map((e) => e.op),
    entries.map((e) => e.t),
    win.quality.thresholds.burst_threshold_ms,
  );
}

it('burst reconstruction matches the aggregator on a scripted episode (pause wins the tie)', () => {
  // Type 5 chars, pause 2.5 s, delete (pause wins the tie), type 3, delete
  // immediately (R-burst), type 2, submit (trailing P-burst).
  const win = runEpisode([
    { t: 500, prev: 0, cur: 1 },
    { t: 800, prev: 1, cur: 2 },
    { t: 1100, prev: 2, cur: 3 },
    { t: 1400, prev: 3, cur: 4 },
    { t: 1700, prev: 4, cur: 5 },
    { t: 4200, prev: 5, cur: 4 }, // 2500 ms gap then delete
    { t: 4400, prev: 4, cur: 5 },
    { t: 4600, prev: 5, cur: 6 },
    { t: 4800, prev: 6, cur: 7 },
    { t: 4900, prev: 7, cur: 6 }, // immediate delete
    { t: 5100, prev: 6, cur: 7 },
    { t: 5300, prev: 7, cur: 8 },
  ], { finalizeAt: 6000 });

  assert.equal(win.typing.p_burst_count, 2, 'aggregator: pause-closed + trailing burst');
  assert.equal(win.typing.r_burst_count, 1, 'aggregator: one revision-closed burst');

  const rec = reconstructFromWindow(win);
  assert.equal(rec.pCount, win.typing.p_burst_count, 'reconstruction agrees on P-bursts');
  assert.equal(rec.rCount, win.typing.r_burst_count, 'reconstruction agrees on R-bursts');
  assert.deepEqual(rec.segments.map((s) => s.kind), ['p', 'r', 'p']);
  assert.deepEqual(rec.segments.map((s) => s.closedBy), ['pause', 'revision', 'end']);
  assert.deepEqual(rec.segments.map((s) => s.edits), [5, 3, 2]);
  // The pause-then-delete tie: the delete at t=4200 must NOT have closed an
  // R-burst (the 2500 ms pause already closed the run as a P-burst).
  assert.equal(rec.segments[0].endT, 1700);
});

it('burst reconstruction: leading deletes with no production close nothing', () => {
  // Leading deletes with no prior production close nothing.
  const win = runEpisode([
    { t: 100, prev: 5, cur: 4 },
    { t: 300, prev: 4, cur: 3 },
    { t: 600, prev: 3, cur: 4 },
  ], { finalizeAt: 1000, reason: 'abandoned' });
  assert.equal(win.typing.p_burst_count, 1);
  assert.equal(win.typing.r_burst_count, 0);
  const rec = reconstructFromWindow(win);
  assert.equal(rec.pCount, 1);
  assert.equal(rec.rCount, 0);
  assert.deepEqual(rec.segments.map((s) => s.closedBy), ['end']);
});

it('burst reconstruction matches the aggregator on 200 seeded random episodes', () => {
  // Fuzz: 200 seeded random episodes; the reconstruction must match the
  // aggregator's counts on every one (all edits carry a caretOffset, so the
  // two views see the identical edit sequence).
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let ep = 0; ep < 200; ep += 1) {
    const edits = [];
    let t = 0;
    let cur = 0;
    const n = 2 + Math.floor(rand() * 40);
    for (let i = 0; i < n; i += 1) {
      // Gaps straddle the 2000 ms threshold, including exact-threshold ties.
      const gapChoice = rand();
      t += gapChoice < 0.55 ? Math.floor(rand() * 800)
        : gapChoice < 0.7 ? 2000
          : 2000 + Math.floor(rand() * 4000);
      const del = cur > 0 && rand() < 0.35;
      const prev = cur;
      cur = del ? cur - 1 : cur + 1;
      edits.push({ t, prev, cur });
    }
    const win = runEpisode(edits, { finalizeAt: t + Math.floor(rand() * 5000) });
    const rec = reconstructFromWindow(win);
    assert.equal(rec.pCount, win.typing.p_burst_count, `fuzz episode ${ep}: P-burst counts diverge`);
    assert.equal(rec.rCount, win.typing.r_burst_count, `fuzz episode ${ep}: R-burst counts diverge`);
  }
});

it('burst reconstruction: degenerate input', () => {
  // Degenerate reconstruction inputs.
  assert.deepEqual(reconstructBursts([], [], 2000), { segments: [], pCount: 0, rCount: 0 });
});

// ---- formatDurationShort ----
it('formatDurationShort', () => {
  assert.equal(formatDurationShort(850), '850ms');
  assert.equal(formatDurationShort(12000), '12s');
  assert.equal(formatDurationShort(65000), '1m05s');
  assert.equal(formatDurationShort(120000), '2m');
  assert.equal(formatDurationShort(4320000), '1.2h');
});


