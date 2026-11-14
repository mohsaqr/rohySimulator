// PRV-75 (first fixed in Rohy's vendored copy, upstreamed here): POS rPPG
// projects in short sliding windows of l ≈ 1.6 s (Wang, den Brinker, Stuijk &
// de Haan 2017, IEEE TBME, "Algorithmic principles of remote PPG",
// Algorithm 1), normalising each window by its own temporal mean, re-fitting
// alpha = σ(S1)/σ(S2) per window and overlap-adding the mean-centred h. The
// 12 s buffer is only the spectral window the BPM is read from.
// Plain node, throws on failure.
import assert from 'node:assert/strict';
import {
  HeartRateEstimator, posSignal, posSignalWindowed, posWindowLength,
} from '../src/analytics/HeartRateEstimator.js';
import * as root from '../src/index.js';

// mulberry32 — seeded, so every run sees the same noise.
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (u) => () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());

/**
 * Synthetic face-ROI RGB: a 1.2 Hz (72 bpm) pulse along the skin pulsatility
 * direction under slow illumination drift, in-band "specular" distortion and
 * sensor noise, with ±3 ms timestamp jitter. With `flip` the distortion's
 * colour direction changes half-way — what one 12 s alpha cannot follow.
 */
function synth({ fps = 20, seconds = 12, seed = 1, noise = 0.2, amp = 0.008, specular = 0, flip = false, hz = 1.2 } = {}) {
  const u = rng(seed);
  const g = gaussian(u);
  const base = { r: 150, g: 110, b: 90 };
  const pulseDir = { r: 0.33, g: 0.77, b: 0.53 };
  const comps = Array.from({ length: 6 }, () => ({ f: 0.8 + 1.7 * u(), ph: 2 * Math.PI * u() }));
  const n = Math.round(fps * seconds);
  return Array.from({ length: n }, (_, i) => {
    const t = i / fps;
    const late = t > seconds / 2;
    const illum = 1 + 0.08 * Math.sin(2 * Math.PI * 0.05 * t) + 0.01 * t;
    const chroma = { r: 1 + 0.03 * t / seconds, g: 1, b: 1 - 0.03 * t / seconds };
    const d = specular * comps.reduce((s, c) => s + Math.sin(2 * Math.PI * c.f * t + c.ph), 0) / 3;
    const dir = flip && late ? { r: 0.33, g: 0, b: 1 } : { r: -0.6, g: 0.2, b: 1 };
    const pulse = Math.sin(2 * Math.PI * hz * t);
    const ch = (k) => base[k] * illum * chroma[k] * (1 + d * dir[k]) * (1 + amp * pulseDir[k] * pulse) + noise * g();
    return { rgb: { r: ch('r'), g: ch('g'), b: ch('b') }, ts: 1000 * t + (u() - 0.5) * 6 };
  });
}
const channels = (frames) => ['r', 'g', 'b'].map((k) => frames.map((f) => f.rgb[k]));
function estimateFrom(frames, options = {}) {
  const est = new HeartRateEstimator({ method: 'pos', bufferSeconds: 12, ...options });
  frames.forEach(({ rgb, ts }) => est.addSample(rgb, ts));
  return est.estimate();
}

// Defaults: a 1.6 s projection window, separate from the 12 s spectral buffer.
{
  const est = new HeartRateEstimator();
  assert.equal(est.options.posWindowSeconds, 1.6);
  assert.equal(est.options.bufferSeconds, 12);
  assert.equal(root.posSignalWindowed, posSignalWindowed);
  assert.equal(root.posWindowLength, posWindowLength);
}

// l = round(1.6 s × fps), reported on the estimate; none for 'green'.
for (const [fps, samples] of [[20, 32], [30, 48], [16, 26]]) {
  assert.equal(posWindowLength(fps), samples);
  const out = estimateFrom(synth({ fps, seed: 1 }));
  assert.ok(out);
  assert.equal(Math.round(out.fs), fps);
  assert.equal(out.pos_window_samples, posWindowLength(out.fs, 1.6));
  assert.equal(out.pos_window_samples, samples);
}
assert.equal(estimateFrom(synth({ seed: 1 }), { method: 'green' }).pos_window_samples, null);
assert.equal(posWindowLength(0), 0);
assert.equal(posWindowLength(20, -1), 0);

// Sliding window + overlap-add of step 1: perturbing input k changes output
// only in [k − l + 1, k + l − 1]; a whole-buffer projection changes all of it.
{
  const [r, g, b] = channels(synth({ fps: 20, seed: 3 }));
  const l = posWindowLength(20);
  const k = 120;
  const bumped = r.map((v, i) => (i === k ? v + 5 : v));
  const before = posSignalWindowed(r, g, b, 20);
  const after = posSignalWindowed(bumped, g, b, 20);
  const changedIdx = before.flatMap((v, i) => (v !== after[i] ? [i] : []));
  assert.equal(changedIdx[0], k - l + 1);
  assert.equal(changedIdx.at(-1), k + l - 1);
  assert.equal(changedIdx.length, 2 * l - 1);
  const wholeBefore = posSignal(r, g, b);
  const wholeAfter = posSignal(bumped, g, b);
  assert.ok(wholeBefore.every((v, i) => v !== wholeAfter[i]));
}

// Per-window normalisation: an exposure step in the first 40 samples leaves
// windows past it untouched and windows inside it (scale-invariant) equal.
{
  const [r, g, b] = channels(synth({ fps: 20, seed: 4 }));
  const scale = (a) => a.map((v, i) => (i < 40 ? v * 1.5 : v));
  const base = posSignalWindowed(r, g, b, 20);
  const stepped = posSignalWindowed(scale(r), scale(g), scale(b), 20);
  const l = posWindowLength(20);
  base.slice(40 + l, 200).forEach((v, i) => assert.equal(stepped[40 + l + i], v));
  base.slice(0, 40 - l).forEach((v, i) => assert.ok(Math.abs(stepped[i] - v) < 1e-9));
}

// Accuracy: 72 bpm within ±3 bpm under drift and noise, ten seeds.
for (let seed = 1; seed <= 10; seed += 1) {
  const out = estimateFrom(synth({ fps: 20, seed }));
  assert.ok(out && Math.abs(out.bpm - 72) <= 3, `seed ${seed}: ${out?.bpm}`);
}

// A distortion whose colour direction flips mid-buffer: the 1.6 s window
// follows it on every seed; one 12 s window (the pre-fix behaviour) misses
// most of the same seeds.
{
  const flipErrors = (posWindowSeconds) => Array.from({ length: 20 }, (_, i) => {
    const out = estimateFrom(synth({ fps: 20, seed: i + 1, specular: 0.015, flip: true }), { posWindowSeconds });
    return out ? Math.abs(out.bpm - 72) : Infinity;
  });
  assert.deepEqual(flipErrors(1.6).filter((e) => e > 3), []);
  assert.ok(flipErrors(12).filter((e) => e > 3).length >= 10);
}

// Always finite; shorter than one window → the whole-buffer projection.
{
  const zeros = new Array(64).fill(0);
  const flat = new Array(64).fill(100);
  assert.ok(posSignalWindowed(zeros, zeros, zeros, 20).every(Number.isFinite));
  assert.ok(posSignalWindowed(flat, flat, flat, 20).every((v) => v === 0));
  const [r, g, b] = channels(synth({ fps: 20, seed: 5 }).slice(0, 20));
  assert.deepEqual(posSignalWindowed(r, g, b, 20), posSignal(r, g, b));
}

console.log('heart-rate-pos-window.test.js passed');
