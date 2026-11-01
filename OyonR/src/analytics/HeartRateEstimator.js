/**
 * HeartRateEstimator — remote photoplethysmography (rPPG). Recovers a Blood
 * Volume Pulse trend from the tiny colour fluctuations of a facial skin ROI.
 *
 *   sampleFaceRoiRgb(video, face) → {r,g,b} per frame  (DOM helper, below)
 *      → addSample() into a rolling buffer (~bufferSeconds)
 *      → estimate(): build pulse (windowed POS or green) → detrend → Hann →
 *        FFT → peak in the [minBpm,maxBpm] band → BPM + SNR + confidence.
 *
 * TWO WINDOWS, NOT ONE. POS (Wang et al. 2017) extracts the pulse in short
 * sliding windows of l ≈ 1.6 s (`posWindowSeconds`), overlap-adding each
 * window's projection; the rolling `bufferSeconds` buffer (~12 s) is only the
 * spectral window the BPM is read from. Projecting the whole 12 s buffer as a
 * single POS window (the pre-fix behaviour, PRV-75) fits one alpha to 12 s and
 * cannot follow a change in illumination colour or motion direction.
 *
 * ACCURACY: webcam rPPG is dominated by motion, lighting, and video
 * compression. This is a research-grade TREND signal, NOT a clinical
 * measurement (see docs/HEART_RATE.md). The estimator therefore also exposes
 * SNR/confidence and the raw per-frame RGB is available on the `sample` event
 * so researchers can apply their own method.
 *
 * The DSP core is dependency-free and DOM-free (testable in Node with
 * synthetic RGB); only `sampleFaceRoiRgb` touches the DOM.
 */

import { powerSpectrum } from './fft.js';

export class HeartRateEstimator {
  constructor(options = {}) {
    this.options = {
      bufferSeconds: 12,        // rolling analysis buffer
      method: 'pos',            // 'pos' | 'green'
      // POS projection window l (Wang et al. 2017: 1.6 s, i.e. 32 frames at
      // 20 fps). Distinct from bufferSeconds, the spectral (HR) window.
      posWindowSeconds: 1.6,
      minBpm: 42,               // 0.7 Hz
      maxBpm: 240,              // 4 Hz
      minSamples: 32,
      // Below this rate the advertised 0.7–4 Hz band is not sampled robustly;
      // reject the window instead of returning a plausible-looking alias.
      minSampleRateHz: 8,
      // Frequency-domain HR needs a multi-second window to resolve at all: the
      // literature uses ~10 s analysis windows and reports a minimum of ~8–10 s
      // for a usable estimate. We refuse to emit a number before the buffer
      // spans this long — no "instantaneous" BPM.
      minWindowSeconds: 8,
      // The estimate is recomputed at most this often. HR does not change on a
      // sub-second timescale, and each estimate already integrates the whole
      // window; recomputing every frame would imply a precision that isn't real.
      updateIntervalMs: 1000,
      // Drop "unsure" estimates whose SNR-derived confidence is below this.
      // 0 keeps every estimate (the library default); the runtime raises it.
      minConfidence: 0,
      ...options,
    };
    this.samples = []; // [{ r, g, b, ts }]
    this.lastEstimate = null;
    this.lastEstimateTs = -Infinity;
  }

  reset() {
    this.samples = [];
    this.lastEstimate = null;
    this.lastEstimateTs = -Infinity;
  }

  /**
   * Acquisition status without forcing a recompute. `ready` is false while the
   * buffer is still filling toward `minWindowSeconds`.
   * @returns {{ready:boolean, span_seconds:number, n_samples:number, progress:number,
   * sample_rate_hz:number, minimum_sample_rate_hz:number, reason:string|null}}
   */
  status() {
    const n = this.samples.length;
    const span = n >= 2 ? (this.samples[n - 1].ts - this.samples[0].ts) / 1000 : 0;
    const need = this.options.minWindowSeconds;
    const sampleRate = span > 0 ? (n - 1) / span : 0;
    let reason = null;
    if (n < this.options.minSamples) reason = 'insufficient_samples';
    else if (span < need) reason = 'insufficient_window';
    else if (sampleRate < this.options.minSampleRateHz) reason = 'low_sample_rate';
    return {
      ready: reason === null,
      span_seconds: span,
      n_samples: n,
      progress: need > 0 ? Math.min(1, span / need) : 1,
      sample_rate_hz: sampleRate,
      minimum_sample_rate_hz: this.options.minSampleRateHz,
      reason,
    };
  }

  /**
   * @param {{r:number,g:number,b:number}} rgb  ROI channel means (0–255)
   * @param {number} [ts]  timestamp in ms
   */
  addSample(rgb, ts = Date.now()) {
    if (!rgb || !Number.isFinite(rgb.g)) return;
    this.samples.push({ r: num(rgb.r), g: num(rgb.g), b: num(rgb.b), ts });
    const cutoff = ts - this.options.bufferSeconds * 1000;
    while (this.samples.length > 0 && this.samples[0].ts < cutoff) this.samples.shift();
  }

  /**
   * @returns {{bpm:number,snr:number|null,confidence:number,fs:number,n_samples:number,method:string}|null}
   */
  estimate() {
    const s = this.samples;
    const n = s.length;
    if (n < this.options.minSamples) return null;

    const spanMs = s[n - 1].ts - s[0].ts;
    if (spanMs <= 0) return null;
    // Refuse to estimate before the buffer spans the minimum analysis window.
    const spanSeconds = spanMs / 1000;
    if (spanSeconds < this.options.minWindowSeconds) return null;

    const fs = (n - 1) / spanSeconds; // effective (uniform-grid) sample rate, Hz
    if (!Number.isFinite(fs) || fs <= 0) return null;
    if (fs < this.options.minSampleRateHz) return null;

    // Throttle: HR is a slow signal and each estimate integrates the whole
    // window, so recompute at most every updateIntervalMs. Between recomputes we
    // return the same (unchanged) estimate rather than a spurious new number.
    const nowTs = s[n - 1].ts;
    if (this.lastEstimate && (nowTs - this.lastEstimateTs) < this.options.updateIntervalMs) {
      return this.lastEstimate;
    }

    // CRITICAL: webcam frames arrive at irregular intervals (variable model
    // latency, RAF jitter), but the FFT assumes uniform spacing. Feeding raw
    // jittered samples smears the spectral peak and yields a wrong BPM. Resample
    // each channel onto a uniform time grid (linear interpolation) first — the
    // standard alternative to a Lomb–Scargle periodogram.
    const times = s.map((x) => x.ts / 1000);
    const gUniform = resampleUniform(times, s.map((x) => x.g));

    let pulse;
    if (this.options.method === 'green') {
      pulse = gUniform;
    } else {
      const rUniform = resampleUniform(times, s.map((x) => x.r));
      const bUniform = resampleUniform(times, s.map((x) => x.b));
      pulse = posSignalWindowed(rUniform, gUniform, bUniform, fs, this.options.posWindowSeconds);
    }
    // Detrend (remove DC + linear drift), then an aggressive moving-average
    // high-pass. Window ≈ 0.7·fs puts the high-pass corner near ~0.7 Hz, which
    // strips not just baseline wander but the respiration AND slow head-motion
    // band (~0.2–0.7 Hz) that otherwise leaks into the lowest pulse bins and
    // pins the peak at the band floor (the 42–46 BPM "floor-sticking" failure).
    // The real pulse band (≥ ~48 BPM / 0.8 Hz) is above the corner and survives.
    pulse = detrend(pulse);
    pulse = movingAverageHighPass(pulse, Math.max(3, Math.round(fs * 0.7)));
    applyHann(pulse);

    const spec = powerSpectrum(pulse);
    const nfft = (spec.length - 1) * 2;
    const binHz = fs / nfft;

    const loHz = this.options.minBpm / 60;
    const hiHz = this.options.maxBpm / 60;

    let peakBin = -1;
    let peakPow = -Infinity;
    let bandSum = 0;
    let bandCount = 0;
    for (let i = 1; i < spec.length; i += 1) {
      const f = i * binHz;
      if (f < loHz || f > hiHz) continue;
      bandSum += spec[i];
      bandCount += 1;
      if (spec[i] > peakPow) { peakPow = spec[i]; peakBin = i; }
    }
    if (peakBin < 0 || bandCount === 0) return null;

    // OCTAVE-ERROR CORRECTION via Harmonic Product Spectrum. A weak pulse can
    // make the sub-harmonic (½ the true rate) the tallest single bin, so the raw
    // peak reads ~half the real HR (the 44↔88 flip). HPS MULTIPLIES the energy
    // at f, 2f, 3f: a true fundamental is reinforced by its real harmonics, while
    // a sub-harmonic collapses because one of its "harmonics" (e.g. 3×44=132) is
    // absent. We compare the raw peak against its own 2× and 3× (the candidate
    // true fundamentals if the raw peak is itself a sub-harmonic).
    const specAt = (bin) => {
      if (bin < 1 || bin >= spec.length) return 0;
      let v = spec[bin];
      if (bin - 1 >= 1) v = Math.max(v, spec[bin - 1]); // ±1 bin slack
      if (bin + 1 < spec.length) v = Math.max(v, spec[bin + 1]);
      return v;
    };
    const FLOOR = 1e-12;
    const hps = (bin) => {
      let p = 1;
      for (let k = 1; k <= 3; k += 1) {
        const v = specAt(bin * k);
        p *= v > 0 ? v : FLOOR; // a missing harmonic collapses the product
      }
      return p;
    };
    let bestBin = peakBin;
    let bestHps = hps(peakBin);
    for (const mult of [2, 3]) {
      const hb = peakBin * mult;
      if (hb >= spec.length || hb * binHz > hiHz) continue;
      const h = hps(hb);
      if (h > bestHps * 1.15) { bestHps = h; bestBin = hb; } // clear margin to promote
    }
    peakBin = bestBin;
    peakPow = spec[peakBin];

    // Parabolic (quadratic) interpolation around the peak → sub-bin frequency,
    // removing the coarse ~fs/nfft BPM quantization.
    let refinedBin = peakBin;
    if (peakBin > 1 && peakBin < spec.length - 1) {
      const a = spec[peakBin - 1];
      const b = spec[peakBin];
      const c = spec[peakBin + 1];
      const denom = a - 2 * b + c;
      if (denom !== 0) {
        const delta = (0.5 * (a - c)) / denom;
        if (Math.abs(delta) < 1) refinedBin = peakBin + delta;
      }
    }

    const bpm = refinedBin * binHz * 60;
    const meanBand = bandSum / bandCount;
    const snr = meanBand > 0 ? peakPow / meanBand : null;
    // Heuristic confidence: SNR of 1 (peak == band mean) → 0; SNR ≥ 10 → 1.
    const confidence = snr != null ? clamp01((snr - 1) / 9) : 0;

    const est = {
      bpm,
      snr,
      confidence,
      // Confidence is evidence, not a deletion switch. Consumers use this flag
      // for colour/annotation while the window aggregator gives low-quality
      // readings proportionally less weight. Suppressing the candidate here
      // made a living heart rate disappear whenever one update was noisy.
      quality_accepted: confidence >= this.options.minConfidence,
      fs,
      n_samples: n,
      window_seconds: spanSeconds, // integration window this BPM reflects
      // POS projection window actually used, in samples (null for 'green', or
      // when the buffer is shorter than one window and POS fell back to the
      // whole-buffer projection).
      pos_window_samples: this.options.method === 'green'
        ? null
        : posWindowUsed(n, fs, this.options.posWindowSeconds),
      method: this.options.method,
    };
    this.lastEstimate = est;
    this.lastEstimateTs = nowTs;
    return est;
  }
}

/**
 * POS projection (Plane-Orthogonal-to-Skin) applied over the whole buffer as
 * ONE window. This is a single step of Wang et al.'s algorithm, not the
 * algorithm: `estimate()` uses `posSignalWindowed`. Kept for callers that pass
 * a buffer already cut to one projection window.
 */
export function posSignal(r, g, b) {
  const n = r.length;
  const mr = mean(r);
  const mg = mean(g);
  const mb = mean(b);
  const s1 = new Array(n);
  const s2 = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const cr = mr !== 0 ? r[i] / mr : 0;
    const cg = mg !== 0 ? g[i] / mg : 0;
    const cb = mb !== 0 ? b[i] / mb : 0;
    s1[i] = cg - cb;
    s2[i] = cg + cb - 2 * cr;
  }
  const sd1 = std(s1);
  const sd2 = std(s2);
  const alpha = sd2 !== 0 ? sd1 / sd2 : 0;
  const h = new Array(n);
  for (let i = 0; i < n; i += 1) h[i] = s1[i] + alpha * s2[i];
  const mh = mean(h);
  return h.map((v) => v - mh);
}

/**
 * Number of samples in a POS projection window: round(windowSeconds · fs).
 * Returns 0 for a non-finite or non-positive rate or window.
 * @param {number} fs  sample rate (Hz)
 * @param {number} [windowSeconds=1.6]
 * @returns {number}
 */
export function posWindowLength(fs, windowSeconds = 1.6) {
  if (!(Number.isFinite(fs) && fs > 0) || !(Number.isFinite(windowSeconds) && windowSeconds > 0)) return 0;
  return Math.round(fs * windowSeconds);
}

function posWindowUsed(n, fs, windowSeconds) {
  const l = posWindowLength(fs, windowSeconds);
  return l >= 2 && l <= n ? l : null;
}

/**
 * POS as specified by Wang, den Brinker, Stuijk & de Haan (2017), Algorithm 1:
 * a window of l = round(windowSeconds · fs) samples slides with step 1. In each
 * window every channel is divided by its own temporal mean, projected onto
 * S1 = G − B and S2 = G + B − 2R, combined as h = S1 + (σ(S1)/σ(S2))·S2,
 * mean-centred, and overlap-ADDED into the output. Re-fitting alpha per window
 * is what lets POS follow slowly changing illumination colour and motion.
 *
 * A buffer shorter than one window falls back to the whole-buffer projection.
 * A zero channel mean normalises to 0 and σ(S2) = 0 gives alpha = 0, so the
 * output is always finite. Returns a new array of the input length.
 *
 * @param {ArrayLike<number>} r
 * @param {ArrayLike<number>} g
 * @param {ArrayLike<number>} b
 * @param {number} fs  sample rate (Hz)
 * @param {number} [windowSeconds=1.6]
 * @returns {number[]}
 */
export function posSignalWindowed(r, g, b, fs, windowSeconds = 1.6) {
  const n = r.length;
  const l = posWindowLength(fs, windowSeconds);
  if (l < 2 || l > n) return posSignal(r, g, b);
  const out = new Float64Array(n);
  const s1 = new Float64Array(l);
  const s2 = new Float64Array(l);
  for (let start = 0; start + l <= n; start += 1) {
    const end = start + l;
    const mr = meanRange(r, start, end);
    const mg = meanRange(g, start, end);
    const mb = meanRange(b, start, end);
    for (let i = 0; i < l; i += 1) {
      const cr = mr !== 0 ? r[start + i] / mr : 0;
      const cg = mg !== 0 ? g[start + i] / mg : 0;
      const cb = mb !== 0 ? b[start + i] / mb : 0;
      s1[i] = cg - cb;
      s2[i] = cg + cb - 2 * cr;
    }
    const sd2 = std(s2);
    const alpha = sd2 !== 0 ? std(s1) / sd2 : 0;
    let sum = 0;
    for (let i = 0; i < l; i += 1) sum += s1[i] + alpha * s2[i];
    const mh = sum / l;
    for (let i = 0; i < l; i += 1) {
      const v = s1[i] + alpha * s2[i] - mh;
      out[start + i] += Number.isFinite(v) ? v : 0;
    }
  }
  return Array.from(out);
}

function meanRange(a, start, end) {
  let s = 0;
  for (let i = start; i < end; i += 1) s += Number.isFinite(a[i]) ? a[i] : 0;
  return end > start ? s / (end - start) : 0;
}

/**
 * Resample `values` (sampled at irregular `times`, seconds, ascending) onto a
 * uniform grid of the same count spanning [times[0], times[n-1]], via linear
 * interpolation. Turns jittered webcam frames into an evenly-spaced series the
 * FFT can validly transform.
 */
export function resampleUniform(times, values) {
  const n = times.length;
  if (n < 2) return values.slice();
  const t0 = times[0];
  const t1 = times[n - 1];
  const span = t1 - t0;
  if (span <= 0) return values.slice();
  const out = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const t = t0 + (span * i) / (n - 1);
    while (j < n - 2 && times[j + 1] < t) j += 1;
    const ta = times[j];
    const tb = times[j + 1];
    const denom = tb - ta;
    const frac = denom > 0 ? (t - ta) / denom : 0;
    out[i] = values[j] + (values[j + 1] - values[j]) * frac;
  }
  return out;
}

/** Linear least-squares detrend (removes DC + slow drift). */
export function detrend(x) {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i];
  }
  const denom = n * sxx - sx * sx;
  let slope = 0;
  let intercept = n > 0 ? sy / n : 0;
  if (denom !== 0) {
    slope = (n * sxy - sx * sy) / denom;
    intercept = (sy - slope * sx) / n;
  }
  return x.map((v, i) => v - (slope * i + intercept));
}

function applyHann(a) {
  const n = a.length;
  if (n < 2) return;
  for (let i = 0; i < n; i += 1) {
    a[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
}

/**
 * High-pass by subtracting a centered running mean of the given window (in
 * samples). Removes slow baseline wander/respiration below ~0.5/win·fs Hz while
 * preserving the pulse band. O(n) via a prefix sum.
 */
export function movingAverageHighPass(x, win) {
  const n = x.length;
  if (win < 2 || win >= n) return x.slice();
  const half = Math.floor(win / 2);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) pre[i + 1] = pre[i] + x[i];
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    const avg = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    out[i] = x[i] - avg;
  }
  return out;
}

// ── DOM ROI sampler ─────────────────────────────────────────────────

let sharedRoiCanvas = null;

/**
 * Normalized ROI sub-rect within a face bbox (all values in [0,1]).
 * @param {{x:number,y:number,width:number,height:number}} bbox
 * @param {'forehead'|'cheeks'|'face'} roi
 */
export function faceRoiRect(bbox, roi) {
  if (!bbox) return null;
  const { x, y, width: w, height: h } = bbox;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (roi === 'face') return { x, y, w, h };
  if (roi === 'cheeks') return { x: x + w * 0.2, y: y + h * 0.45, w: w * 0.6, h: h * 0.25 };
  // forehead (default) — central forehead skin, below the hairline (bbox top
  // sits near the hairline) and above the brows.
  return { x: x + w * 0.3, y: y + h * 0.12, w: w * 0.4, h: h * 0.16 };
}

/**
 * Average R/G/B (0–255) over a face ROI, read from a <video> via an offscreen
 * canvas. Returns null when there's no DOM, no frame, or the canvas is tainted
 * (cross-origin video). The full-fidelity per-frame RGB is what downstream
 * buffers; the raw pixels are never retained.
 *
 * @param {HTMLVideoElement} video
 * @param {{bbox:object}} face
 * @param {'forehead'|'cheeks'|'face'} [roi]
 * @returns {{r:number,g:number,b:number}|null}
 */
export function sampleFaceRoiRgb(video, face, roi = 'forehead') {
  if (typeof document === 'undefined') return null;
  if (!video || !face || !face.bbox) return null;
  const vw = video.videoWidth || video.width;
  const vh = video.videoHeight || video.height;
  if (!vw || !vh) return null;

  const rect = faceRoiRect(face.bbox, roi);
  if (!rect) return null;
  const sx = clampInt(rect.x * vw, 0, vw - 1);
  const sy = clampInt(rect.y * vh, 0, vh - 1);
  const sw = clampInt(rect.w * vw, 1, vw - sx);
  const sh = clampInt(rect.h * vh, 1, vh - sy);

  const dw = 24;
  const dh = 24;
  if (!sharedRoiCanvas) sharedRoiCanvas = document.createElement('canvas');
  const c = sharedRoiCanvas;
  c.width = dw;
  c.height = dh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    const data = ctx.getImageData(0, 0, dw, dh).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count += 1;
    }
    if (count === 0) return null;
    return { r: r / count, g: g / count, b: b / count };
  } catch {
    return null; // tainted/cross-origin canvas
  }
}

function num(v) { return Number.isFinite(v) ? v : 0; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clampInt(v, lo, hi) {
  const r = Math.round(v);
  return r < lo ? lo : r > hi ? hi : r;
}
