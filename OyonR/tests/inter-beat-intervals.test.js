// EXPERIMENTAL rPPG inter-beat intervals: recover known beat-to-beat
// variability from a synthetic pulse; refuse under-sampled input; quality
// reflects disagreement with the spectral rate.
import assert from 'node:assert/strict';
import { interBeatIntervals } from '../src/analytics/InterBeatIntervals.js';
import { HeartRateEstimator } from '../src/analytics/HeartRateEstimator.js';

/** Pulse = Gaussian bump per beat (systolic peak) + respiration wander + jittered frame times. */
function synth({ fs = 30, seconds = 12, intervals = [0.78, 0.88], drift = 3 } = {}) {
  const beats = [];
  let t = 0.3; let k = 0;
  while (t < seconds) { beats.push(t); t += intervals[k % intervals.length]; k += 1; }
  const samples = [];
  for (let i = 0; i < fs * seconds; i += 1) {
    const tt = i / fs + Math.sin(i) * 0.004; // ±4 ms frame jitter
    let p = 0;
    for (const b of beats) p += Math.exp(-((tt - b) ** 2) / (2 * 0.06 ** 2));
    samples.push({ r: 100, g: 128 + 1.5 * p + drift * Math.sin(2 * Math.PI * 0.25 * tt), b: 120, ts: 1e6 + tt * 1000 });
  }
  const truth = beats.slice(1).map((b, i) => (b - beats[i]) * 1000);
  return { samples, truth, beats };
}

// ---------- recovers alternating 780/880 ms intervals within 15 ms ----------
{
  const { samples, truth } = synth();
  const out = interBeatIntervals(samples, { bpm_hint: 60000 / 830, method: 'green' });
  assert.ok(Math.abs(out.fs - 30) < 0.1);
  assert.ok(out.intervals.length >= truth.length - 2, `found ${out.intervals.length} of ${truth.length}`);
  // Interior intervals (skip the first: the high-pass edge shifts it).
  for (const iv of out.intervals.slice(1)) {
    const nearest = Math.min(...truth.map(x => Math.abs(x - iv.ibi_ms)));
    assert.ok(nearest < 15, `ibi ${iv.ibi_ms.toFixed(1)} ms is ${nearest.toFixed(1)} ms from any true interval`);
  }
  // Variability survives: consecutive intervals alternate long/short.
  const diffs = out.intervals.slice(2).map((iv, i) => iv.ibi_ms - out.intervals[i + 1].ibi_ms);
  assert.ok(diffs.every((d, i) => i === 0 || Math.sign(d) !== Math.sign(diffs[i - 1])), 'alternation preserved');
}

// ---------- invariant: a constant offset of every timestamp shifts beats, not intervals ----------
{
  const { samples } = synth();
  const a = interBeatIntervals(samples, { bpm_hint: 72, method: 'green' });
  const b = interBeatIntervals(samples.map(s => ({ ...s, ts: s.ts + 5_000 })), { bpm_hint: 72, method: 'green' });
  assert.equal(a.intervals.length, b.intervals.length);
  a.intervals.forEach((iv, i) => {
    assert.ok(Math.abs(iv.ibi_ms - b.intervals[i].ibi_ms) < 1e-6);
    assert.ok(Math.abs(b.intervals[i].ts_ms - iv.ts_ms - 5_000) < 1e-6);
  });
}

// ---------- quality: agreement with the spectral hint × hint confidence ----------
{
  const { samples } = synth({ intervals: [0.8] });
  const good = interBeatIntervals(samples, { bpm_hint: 75, hint_confidence: 1, method: 'green' });
  const wrongHint = interBeatIntervals(samples, { bpm_hint: 110, hint_confidence: 1, method: 'green' });
  const lowConf = interBeatIntervals(samples, { bpm_hint: 75, hint_confidence: 0.5, method: 'green' });
  const mq = (r) => r.intervals.reduce((s, x) => s + x.quality, 0) / r.intervals.length;
  assert.ok(mq(good) > 0.9);
  assert.ok(mq(wrongHint) < mq(good));
  assert.ok(Math.abs(mq(lowConf) - mq(good) / 2) < 1e-9);
}

// ---------- refuses what it cannot measure ----------
{
  const { samples } = synth({ fs: 6 });
  assert.deepEqual(interBeatIntervals(samples, { bpm_hint: 72 }).intervals, [], 'below 8 Hz: no beats');
  assert.deepEqual(interBeatIntervals([], {}).intervals, []);
  assert.deepEqual(interBeatIntervals(null).intervals, []);
}

// ---------- estimator method uses its own buffer and spectral estimate ----------
{
  const { samples } = synth({ intervals: [0.8], seconds: 12 });
  const est = new HeartRateEstimator({ method: 'green', bufferSeconds: 12 });
  for (const s of samples) est.addSample({ r: s.r, g: s.g, b: s.b }, s.ts);
  assert.ok(Array.isArray(est.interBeatIntervals()), 'callable before any spectral estimate');
  const e = est.estimate();
  assert.ok(e && Math.abs(e.bpm - 75) < 3, `spectral bpm ${e?.bpm}`);
  const ibis = est.interBeatIntervals();
  assert.ok(ibis.length >= 10);
  const med = ibis.map(x => x.ibi_ms).sort((a, b) => a - b)[ibis.length >> 1];
  assert.ok(Math.abs(med - 800) < 15, `median ibi ${med}`);
}

console.log('inter-beat-intervals.test.js passed');
