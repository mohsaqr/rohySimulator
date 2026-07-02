/**
 * EngagementAggregator — Stage 4 of the eye-tracking pipeline.
 *
 * Consumes the smoothed per-frame eye stream produced by `EyeSmoother.update()`
 * and emits an aggregated `engagement` block on `flush()`, mirroring the
 * cadence and ISO-string conventions of `EmotionAggregator`.
 *
 * Privacy invariant: this class never retains references to the per-frame
 * smoothed frame or its `raw` payload (which contains landmark and matrix
 * data). `consumeFrame()` copies out the small set of scalars it needs and
 * drops the rest. `flush()` clears all internal state.
 *
 * Metric reference: see `docs/EYE_TRACKING_PLAN.md` §5 Stage 4.
 */

const MODEL_VERSION = 'mediapipe-blendshapes-v1';
const WEIGHT_SUM_TOLERANCE = 1e-6;

export class EngagementAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      sampleIntervalMs: 1000,
      blinkRateBaselineHz: 0.25,
      gazeEntropyGridN: 5,
      focusScoreWeights: {
        blink_penalty: 0.30,
        openness: 0.20,
        gaze_stability: 0.50,
      },
      ...options,
    };

    // Validate weights sum to 1 within tolerance.
    const w = this.options.focusScoreWeights;
    const weightSum =
      Number(w?.blink_penalty || 0) +
      Number(w?.openness || 0) +
      Number(w?.gaze_stability || 0);
    if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
      throw new Error('EngagementAggregator: focusScoreWeights must sum to 1');
    }

    this.windowStart = null;
    this.frames = [];
  }

  /**
   * Consume a smoothed eye frame. Only the scalars actually needed for the
   * aggregate metrics are retained; the input object reference (and its
   * `raw.landmarks` / `raw.transformationMatrix` payload) is intentionally
   * dropped here.
   */
  consumeFrame(smoothedFrame, timestamp = smoothedFrame?.ts_ms ?? Date.now()) {
    if (smoothedFrame == null) return null;

    if (this.windowStart === null) this.windowStart = timestamp;

    // Pull raw blink booleans from `frame.raw.*` if available, else fall back
    // to the top-level smoothed values. Blink edges must use the un-smoothed
    // boolean stream so blink detection isn't washed out by the smoother.
    const raw = smoothedFrame.raw || null;
    const blink_l_raw = (raw && typeof raw.blink_l === 'boolean')
      ? raw.blink_l
      : Boolean(smoothedFrame.blink_l);
    const blink_r_raw = (raw && typeof raw.blink_r === 'boolean')
      ? raw.blink_r
      : Boolean(smoothedFrame.blink_r);

    const iris = smoothedFrame.iris_offset_normalized || { l: null, r: null };
    const offsetL = iris.l
      ? { x: Number(iris.l.x), y: Number(iris.l.y) }
      : null;
    const offsetR = iris.r
      ? { x: Number(iris.r.x), y: Number(iris.r.y) }
      : null;

    // Scalar-only record. No reference to `smoothedFrame`, `raw`, landmarks,
    // or the transformation matrix is stored beyond this method.
    const record = {
      openness_l: Number.isFinite(smoothedFrame.eye_openness_l)
        ? smoothedFrame.eye_openness_l
        : null,
      openness_r: Number.isFinite(smoothedFrame.eye_openness_r)
        ? smoothedFrame.eye_openness_r
        : null,
      blink_l_raw,
      blink_r_raw,
      offsetL,
      offsetR,
      gaze_zone: smoothedFrame.gaze_zone ?? null,
      valid: smoothedFrame.valid === true,
      smoothed: smoothedFrame.smoothed === true,
    };

    this.frames.push(record);

    if (timestamp - this.windowStart >= this.options.windowMs) {
      return this.flush(timestamp);
    }
    return null;
  }

  flush(end = Date.now()) {
    if (this.frames.length === 0 && this.windowStart === null) return null;

    const frames = this.frames;
    const windowStart = this.windowStart;

    // Snapshot then reset state immediately so any further `flush()` calls
    // see an empty aggregator. Also null retained references explicitly.
    this.frames = [];
    this.windowStart = null;

    const totalFrames = frames.length;
    const durationMs = Math.max(0, end - (windowStart ?? end));
    const expectedSamples = Math.floor(durationMs / this.options.sampleIntervalMs) + 1;

    // Blink rising edges: count over ALL frames in buffer (raw booleans are
    // present even on invalid/passthrough frames — a blink itself causes the
    // input frame to be invalid, so excluding those would under-count).
    let blinkCount = 0;
    let prevBlink = false;
    for (let i = 0; i < frames.length; i += 1) {
      const cur = Boolean(frames[i].blink_l_raw || frames[i].blink_r_raw);
      if (cur && !prevBlink) blinkCount += 1;
      prevBlink = cur;
    }

    const blinkRateHz = durationMs > 0
      ? blinkCount / (durationMs / 1000)
      : null;

    // Valid frame set V: only frames where the smoother considered the input
    // valid AND produced a smoothed result (excludes passthrough on bad frames).
    const validFrames = frames.filter(f => f.valid && f.smoothed);
    const validCount = validFrames.length;
    const validFrameRatio = totalFrames > 0 ? validCount / totalFrames : 0;

    // Eye openness stats: per-frame mean across both eyes, over V.
    const opennessPerFrame = [];
    for (let i = 0; i < validFrames.length; i += 1) {
      const f = validFrames[i];
      const parts = [];
      if (Number.isFinite(f.openness_l)) parts.push(f.openness_l);
      if (Number.isFinite(f.openness_r)) parts.push(f.openness_r);
      if (parts.length > 0) {
        opennessPerFrame.push(parts.reduce((a, b) => a + b, 0) / parts.length);
      }
    }
    const eyeOpennessMean = opennessPerFrame.length > 0
      ? opennessPerFrame.reduce((a, b) => a + b, 0) / opennessPerFrame.length
      : null;
    // Population stddev. If fewer than 2 samples, we report 0 (a single sample
    // has zero observed dispersion). Documented choice — matches the audit's
    // preference for emitting a number rather than null when possible.
    let eyeOpennessStd = null;
    if (opennessPerFrame.length >= 2) {
      const m = eyeOpennessMean;
      const variance =
        opennessPerFrame.reduce((s, v) => s + (v - m) ** 2, 0) /
        opennessPerFrame.length;
      eyeOpennessStd = Math.sqrt(variance);
    } else if (opennessPerFrame.length === 1) {
      eyeOpennessStd = 0;
    }

    // Gaze zone proportions over V.
    let gazeZoneProportions = null;
    const zoneBuckets = { center: 0, left: 0, right: 0, up: 0, down: 0 };
    let zoneCount = 0;
    for (let i = 0; i < validFrames.length; i += 1) {
      const z = validFrames[i].gaze_zone;
      if (z != null && Object.prototype.hasOwnProperty.call(zoneBuckets, z)) {
        zoneBuckets[z] += 1;
        zoneCount += 1;
      }
    }
    if (zoneCount > 0) {
      gazeZoneProportions = {
        center: zoneBuckets.center / zoneCount,
        left: zoneBuckets.left / zoneCount,
        right: zoneBuckets.right / zoneCount,
        up: zoneBuckets.up / zoneCount,
        down: zoneBuckets.down / zoneCount,
      };
    }

    // Gaze entropy over V (only frames with at least one iris offset).
    const gazeEntropy = computeGazeEntropy(validFrames, this.options.gazeEntropyGridN);

    // Focus score and components.
    let focusScore = null;
    let focusScoreComponents = null;
    if (eyeOpennessMean !== null) {
      const blinkRateForScore = blinkRateHz ?? 0;
      const blinkComponent = 1 - clamp01(
        blinkRateForScore / Math.max(this.options.blinkRateBaselineHz, 1e-9),
      );
      const opennessComponent = clamp01(eyeOpennessMean);
      const gazeStabilityComponent = 1 - (gazeEntropy ?? 0);

      const w = this.options.focusScoreWeights;
      const weighted =
        w.blink_penalty * blinkComponent +
        w.openness * opennessComponent +
        w.gaze_stability * gazeStabilityComponent;
      focusScore = clamp01(weighted);
      focusScoreComponents = {
        blink: blinkComponent,
        openness: opennessComponent,
        gaze_stability: gazeStabilityComponent,
      };
    }
    // When eye_openness_mean is null (no valid frames at all), focus_score and
    // its components are null. Documented in the doc comment above.

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      expected_samples: expectedSamples,
      total_frames: totalFrames,
      valid_frames: validCount,
      valid_frame_ratio: validFrameRatio,
      blink_count: blinkCount,
      blink_rate_hz: blinkRateHz,
      eye_openness_mean: eyeOpennessMean,
      eye_openness_std: eyeOpennessStd,
      gaze_zone_proportions: gazeZoneProportions,
      gaze_entropy: gazeEntropy,
      focus_score: focusScore,
      focus_score_components: focusScoreComponents,
      model_version: MODEL_VERSION,
    };
  }
}

/**
 * Quantize each frame's mean iris offset (averaged across available eyes) into
 * an N×N grid spanning [-0.5, 0.5] on each axis, then return the normalized
 * Shannon entropy of the resulting bin distribution.
 *
 * Returns `null` if no frame in `frames` had any iris offset available.
 */
function computeGazeEntropy(frames, gridN) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const N = Math.max(1, Math.floor(gridN));
  const bins = new Map();
  let placed = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const xs = [];
    const ys = [];
    if (f.offsetL && Number.isFinite(f.offsetL.x) && Number.isFinite(f.offsetL.y)) {
      xs.push(f.offsetL.x); ys.push(f.offsetL.y);
    }
    if (f.offsetR && Number.isFinite(f.offsetR.x) && Number.isFinite(f.offsetR.y)) {
      xs.push(f.offsetR.x); ys.push(f.offsetR.y);
    }
    if (xs.length === 0) continue;
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

    const bx = quantizeBin(meanX, N);
    const by = quantizeBin(meanY, N);
    const key = bx * N + by;
    bins.set(key, (bins.get(key) || 0) + 1);
    placed += 1;
  }

  if (placed === 0) return null;

  let H = 0;
  for (const count of bins.values()) {
    const p = count / placed;
    if (p > 0) H += -p * Math.log2(p);
  }
  const maxH = Math.log2(N * N);
  if (!Number.isFinite(maxH) || maxH <= 0) return 0;
  return H / maxH;
}

function quantizeBin(value, N) {
  // Map [-0.5, 0.5] into [0, N-1], clipping out-of-range values to the edges.
  let bin = Math.floor((value + 0.5) * N);
  if (bin < 0) bin = 0;
  if (bin > N - 1) bin = N - 1;
  return bin;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
