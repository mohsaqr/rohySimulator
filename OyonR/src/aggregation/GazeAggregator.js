/**
 * GazeAggregator — Stage 3 of the screen-point gaze pipeline.
 *
 * Consumes the smoothed per-frame `GazeSample` stream produced by
 * `GazeSmoother.update()` and emits an aggregated `gaze` block on `flush()`.
 * Shape and cadence mirror `EngagementAggregator`; the runtime pairs the two
 * at the same window boundary so both blocks live in one window payload.
 *
 * Privacy invariant: this class never retains references to upstream
 * objects. `consumeFrame()` copies out the scalars it needs (x, y, quality,
 * valid, smoothed, off_screen) and drops the rest. `flush()` clears all
 * internal state, including the AOI option (which is by-reference but not
 * persisted beyond `flush()` output, which contains only aggregate scalars).
 *
 * Coordinate convention: WebEyeTrack's normalized point-of-gaze,
 * `[-0.5, 0.5]` on each axis. Origin = screen center. +X right, +Y down.
 *
 * Metric reference: see `docs/SCREEN_POINT_GAZE_PLAN.md` §3.1 + §5 Stage 3.
 */

const MODEL_VERSION_DEFAULT = 'webeyetrack-0.0.2';
const SCREEN_HALF = 0.5;

export class GazeAggregator {
  /**
   * @param {object} options
   * @param {number} [options.windowMs=10000]
   * @param {number} [options.sampleIntervalMs=33]    For per-AOI dwell math
   *        (when explicit per-frame timestamps aren't available).
   * @param {number} [options.zoneGrid=3]             3 (named 9 zones) or 5+ (indexed).
   * @param {Array<{id:string,x:number,y:number,width:number,height:number}>} [options.aois=[]]
   * @param {boolean} [options.dropOffScreen=true]    Exclude off-screen points
   *        from centroid/dispersion. They still count in off_screen_ratio.
   * @param {string} [options.modelVersion='webeyetrack-0.0.2']
   */
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      sampleIntervalMs: 33,
      zoneGrid: 3,
      aois: [],
      dropOffScreen: true,
      modelVersion: MODEL_VERSION_DEFAULT,
      ...options,
    };
    if (!Number.isInteger(this.options.zoneGrid) || this.options.zoneGrid < 1) {
      throw new Error('GazeAggregator: zoneGrid must be a positive integer.');
    }
    this.windowStart = null;
    this.frames = [];
    this.lastFrameTs = null;
  }

  /**
   * Consume one smoothed gaze frame.
   * @param {SmoothedGazeSample|null} frame
   * @param {number} [timestamp]  ms; defaults to frame.ts_ms or now.
   * @returns {GazeWindow|null}  Window block when the buffer crossed windowMs.
   */
  consumeFrame(frame, timestamp = frame?.ts_ms ?? Date.now()) {
    if (frame == null) return null;
    if (this.windowStart === null) this.windowStart = timestamp;

    const x = Number(frame.x);
    const y = Number(frame.y);
    const xFinite = Number.isFinite(x);
    const yFinite = Number.isFinite(y);
    const offScreen = xFinite && yFinite
      ? Math.abs(x) > SCREEN_HALF || Math.abs(y) > SCREEN_HALF
      : false;

    // Scalar record only. No references to `frame.raw`, no carryover.
    this.frames.push({
      x: xFinite ? x : null,
      y: yFinite ? y : null,
      quality: Number.isFinite(frame.quality) ? frame.quality : 0,
      valid: frame.valid === true,
      smoothed: frame.smoothed === true,
      gaze_state: frame.gaze_state === 'closed' ? 'closed' : 'open',
      off_screen: offScreen,
      ts_ms: Number.isFinite(timestamp) ? timestamp : null,
    });
    this.lastFrameTs = timestamp;

    if (timestamp - this.windowStart >= this.options.windowMs) {
      return this.flush(timestamp);
    }
    return null;
  }

  /**
   * Flush the current window. Returns null when nothing has been buffered.
   *
   * Calibration metadata is passed in by the runtime at flush time — the
   * aggregator does NOT own calibration state.
   *
   * @param {number} [end=Date.now()]
   * @param {object} [calibrationMeta]
   * @param {number|null} [calibrationMeta.calibrationAgeMs]
   * @param {number|null} [calibrationMeta.calibrationQuality]
   * @param {'measured'|'inferred'|'unknown'} [calibrationMeta.calibrationConfidence]
   * @param {object} [flushOptions]
   * @param {boolean} [flushOptions.emitEmpty=false]  When true, an empty
   *        buffer yields an honest zero window (n_points: 0, total_frames: 0,
   *        valid_frame_ratio: 0) instead of null. The runtime uses this so
   *        gaze-enabled windows never silently omit the gaze block — silent
   *        absence is indistinguishable from "pipeline broken" downstream
   *        (see AGENT-NOTE-GAZE-INTEGRATION.md).
   * @returns {GazeWindow|null}
   */
  flush(end = Date.now(), calibrationMeta = {}, { emitEmpty = false } = {}) {
    if (this.frames.length === 0 && this.windowStart === null && !emitEmpty) return null;

    const frames = this.frames;
    const windowStart = this.windowStart;
    this.frames = [];
    this.windowStart = null;

    const totalFrames = frames.length;
    const durationMs = Math.max(0, end - (windowStart ?? end));
    const validFrames = frames.filter(f => f.valid && f.smoothed);
    const onScreenValid = this.options.dropOffScreen
      ? validFrames.filter(f => !f.off_screen)
      : validFrames;
    const offScreenInValid = validFrames.filter(f => f.off_screen).length;

    const validFrameRatio = totalFrames > 0 ? validFrames.length / totalFrames : 0;
    const offScreenRatio = validFrames.length > 0 ? offScreenInValid / validFrames.length : 0;

    let centroid = null;
    let dispersion = null;
    if (onScreenValid.length > 0) {
      const sumX = onScreenValid.reduce((s, f) => s + f.x, 0);
      const sumY = onScreenValid.reduce((s, f) => s + f.y, 0);
      const meanX = sumX / onScreenValid.length;
      const meanY = sumY / onScreenValid.length;
      centroid = { x: meanX, y: meanY };
      if (onScreenValid.length >= 2) {
        // Pooled std (sqrt(var_x + var_y)): single "spread of the gaze cloud" scalar.
        let varX = 0;
        let varY = 0;
        for (const f of onScreenValid) {
          varX += (f.x - meanX) ** 2;
          varY += (f.y - meanY) ** 2;
        }
        varX /= onScreenValid.length;
        varY /= onScreenValid.length;
        dispersion = Math.sqrt(varX + varY);
      } else {
        dispersion = 0;
      }
    }

    const zoneProportions = computeZoneProportions(onScreenValid, this.options.zoneGrid);
    const aoiDwell = computeAoiDwell(onScreenValid, this.options.aois, this.options.sampleIntervalMs);

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      n_points: onScreenValid.length,
      total_frames: totalFrames,
      centroid,
      dispersion,
      zone_proportions: zoneProportions,
      aoi_dwell_ms: aoiDwell,
      calibration_age_ms: Number.isFinite(calibrationMeta?.calibrationAgeMs)
        ? calibrationMeta.calibrationAgeMs
        : null,
      calibration_quality: Number.isFinite(calibrationMeta?.calibrationQuality)
        ? calibrationMeta.calibrationQuality
        : null,
      calibration_confidence: normalizeCalibrationConfidence(calibrationMeta?.calibrationConfidence),
      valid_frame_ratio: validFrameRatio,
      off_screen_ratio: offScreenRatio,
      model_version: this.options.modelVersion,
    };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function normalizeCalibrationConfidence(value) {
  return value === 'measured' || value === 'inferred' ? value : 'unknown';
}

const NAMED_3x3 = [
  'top_left',    'top_center',    'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

function zoneKey(gridN, row, col) {
  if (gridN === 3) return NAMED_3x3[row * 3 + col];
  return `r${row}c${col}`;
}

function emptyZoneProportions(gridN) {
  const out = {};
  for (let r = 0; r < gridN; r += 1) {
    for (let c = 0; c < gridN; c += 1) {
      out[zoneKey(gridN, r, c)] = 0;
    }
  }
  return out;
}

function computeZoneProportions(frames, gridN) {
  if (frames.length === 0) return null;
  const buckets = emptyZoneProportions(gridN);
  let placed = 0;
  for (const f of frames) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
    const col = quantizeBin(f.x, gridN);
    const row = quantizeBin(f.y, gridN);
    buckets[zoneKey(gridN, row, col)] += 1;
    placed += 1;
  }
  if (placed === 0) return null;
  for (const k of Object.keys(buckets)) buckets[k] = buckets[k] / placed;
  return buckets;
}

function quantizeBin(value, N) {
  // Map [-0.5, 0.5] into [0, N-1]; clip out-of-range to edges.
  let bin = Math.floor((value + 0.5) * N);
  if (bin < 0) bin = 0;
  if (bin > N - 1) bin = N - 1;
  return bin;
}

function computeAoiDwell(frames, aois, sampleIntervalMs) {
  if (!Array.isArray(aois) || aois.length === 0) return null;
  const dwell = {};
  for (const a of aois) {
    if (a && typeof a.id === 'string') dwell[a.id] = 0;
  }

  for (const f of frames) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
    for (const a of aois) {
      if (!a || typeof a.id !== 'string') continue;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      if (!Number.isFinite(a.width) || !Number.isFinite(a.height)) continue;
      const inside =
        f.x >= a.x && f.x < a.x + a.width &&
        f.y >= a.y && f.y < a.y + a.height;
      if (inside) {
        dwell[a.id] += sampleIntervalMs;
        break; // first match wins — AOIs do not double-count.
      }
    }
  }

  return dwell;
}
