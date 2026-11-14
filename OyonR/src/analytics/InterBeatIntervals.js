/**
 * Inter-beat intervals (IBI) from the rPPG pulse — EXPERIMENTAL.
 *
 * The heart-rate estimator reads BPM off a spectral peak, which is a ~10 s
 * average and carries no beat-to-beat variability. Synchrony work on HRV
 * (Tomashin, Gordon & Wallot 2022: MdRQA on IBI series) needs the beats
 * themselves, so this module finds them in the time domain:
 *
 *   ROI RGB buffer → uniform resample → POS (or green) → detrend →
 *   moving-average high-pass (~0.7 Hz) → moving-average low-pass (~4 Hz)
 *   → systolic peaks with a refractory period set from the spectral BPM
 *   → parabolic sub-sample refinement → intervals.
 *
 * Every interval carries a quality in 0..1: its agreement with the spectral
 * rate (an IBI far from 60000/bpm is more likely a missed or spurious peak)
 * times the spectral confidence. Nothing is dropped for being implausible
 * beyond the physiological range (300–1500 ms); the quality column says how
 * far to trust each one.
 *
 * Webcam IBIs are much noisier than ECG or contact PPG — RMSSD from them is
 * not trustworthy (docs/HEART_RATE.md). This is a research stream, labelled
 * experimental wherever it surfaces.
 */
import { posSignal, resampleUniform, detrend, movingAverageHighPass } from './HeartRateEstimator.js';

const MIN_IBI_MS = 300;   // 200 bpm
const MAX_IBI_MS = 1500;  // 40 bpm

/**
 * @param {Array<{r:number,g:number,b:number,ts:number}>} samples ROI colour samples (ts in ms)
 * @param {object} [options]
 * @param {number} [options.bpm_hint]       spectral BPM (sets the refractory period); estimated from the data when absent
 * @param {number} [options.hint_confidence=1] confidence of the hint, folded into each interval's quality
 * @param {'pos'|'green'} [options.method='pos']
 * @returns {{ fs:number|null, beats_ms:number[], intervals:Array<{ts_ms:number, ibi_ms:number, quality:number}> }}
 */
export function interBeatIntervals(samples, options = {}) {
  const method = options.method === 'green' ? 'green' : 'pos';
  const empty = { fs: null, beats_ms: [], intervals: [] };
  if (!Array.isArray(samples) || samples.length < 32) return empty;
  const t0 = samples[0].ts;
  const span = (samples[samples.length - 1].ts - t0) / 1000;
  if (!(span > 2)) return empty;
  const n = samples.length;
  const fs = (n - 1) / span;
  if (!(fs >= 8)) return empty; // below 8 Hz a 4 Hz pulse is not sampled

  const times = samples.map(s => s.ts / 1000);
  const g = resampleUniform(times, samples.map(s => s.g));
  let pulse = method === 'green'
    ? g
    : posSignal(resampleUniform(times, samples.map(s => s.r)), g, resampleUniform(times, samples.map(s => s.b)));
  pulse = detrend(pulse);
  pulse = movingAverageHighPass(pulse, Math.max(3, Math.round(fs * 0.7)));
  pulse = movingAverage(pulse, Math.max(1, Math.round(fs / 8)));

  const hint = Number.isFinite(options.bpm_hint) && options.bpm_hint > 0 ? options.bpm_hint : null;
  const expectedMs = hint ? 60000 / hint : null;
  // Refractory: 60 % of the expected period, or the physiological floor.
  const refractory = Math.max(1, Math.round(((expectedMs ? 0.6 * expectedMs : MIN_IBI_MS) / 1000) * fs));

  const peaks = [];
  for (let i = 1; i < pulse.length - 1; i += 1) {
    if (!(pulse[i] > pulse[i - 1] && pulse[i] >= pulse[i + 1] && pulse[i] > 0)) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < refractory) {
      if (pulse[i] > pulse[last]) peaks[peaks.length - 1] = i; // keep the taller of two close peaks
      continue;
    }
    peaks.push(i);
  }

  const beats = peaks.map((i) => {
    let delta = 0;
    const a = pulse[i - 1]; const b = pulse[i]; const c = pulse[i + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const d = (0.5 * (a - c)) / denom;
      if (Math.abs(d) < 1) delta = d;
    }
    return t0 + ((i + delta) / fs) * 1000;
  });

  const hintConf = Number.isFinite(options.hint_confidence) ? Math.max(0, Math.min(1, options.hint_confidence)) : 1;
  const ref = expectedMs ?? medianOf(beats.slice(1).map((b, k) => b - beats[k]));
  const intervals = [];
  for (let k = 1; k < beats.length; k += 1) {
    const ibi = beats[k] - beats[k - 1];
    if (ibi < MIN_IBI_MS || ibi > MAX_IBI_MS) continue;
    const agreement = Number.isFinite(ref) && ref > 0 ? Math.max(0, 1 - Math.abs(ibi - ref) / ref) : 0;
    intervals.push({ ts_ms: beats[k], ibi_ms: ibi, quality: agreement * hintConf });
  }
  return { fs, beats_ms: beats, intervals };
}

function movingAverage(x, win) {
  if (win <= 1) return Array.from(x);
  const half = Math.floor(win / 2);
  const out = new Array(x.length);
  let sum = 0; let lo = 0; let hi = -1;
  for (let i = 0; i < x.length; i += 1) {
    const want = Math.min(x.length - 1, i + half);
    while (hi < want) { hi += 1; sum += x[hi]; }
    const from = Math.max(0, i - half);
    while (lo < from) { sum -= x[lo]; lo += 1; }
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

function medianOf(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
