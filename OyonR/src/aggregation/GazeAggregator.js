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
const DEFAULT_FIXATION_MIN_DURATION_MS = 150;
const DEFAULT_FIXATION_DISPERSION_THRESHOLD = 0.08;
const DEFAULT_MIN_FIXATION_SAMPLE_RATE_HZ = 8;
const DEFAULT_MAX_SAMPLE_GAP_MS = 250;

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
      // Coarse webcam fixation detection. These values deliberately target
      // AOI-scale behaviour, not research-eye-tracker microsaccades.
      fixationMinDurationMs: DEFAULT_FIXATION_MIN_DURATION_MS,
      fixationDispersionThreshold: DEFAULT_FIXATION_DISPERSION_THRESHOLD,
      minFixationSampleRateHz: DEFAULT_MIN_FIXATION_SAMPLE_RATE_HZ,
      // A decoded-frame pause longer than this (or 4x the observed median
      // interval, whichever is larger) breaks a fixation/AOI sequence instead
      // of silently turning missing data into dwell time.
      maxSampleGapMs: DEFAULT_MAX_SAMPLE_GAP_MS,
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
    const timing = addFrameTiming(
      frames,
      this.options.sampleIntervalMs,
      this.options.maxSampleGapMs,
    );
    const timedFrames = timing.frames;
    const validFrames = timedFrames.filter(f => f.valid && f.smoothed);
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
    const aoi = computeAoiMetrics(timedFrames, this.options.aois, windowStart ?? end);
    const samplingAdequate = Number.isFinite(timing.observedSampleRateHz)
      && timing.observedSampleRateHz >= this.options.minFixationSampleRateHz;
    const fixation = samplingAdequate
      ? computeFixationMetrics(timedFrames, {
          minDurationMs: this.options.fixationMinDurationMs,
          dispersionThreshold: this.options.fixationDispersionThreshold,
        })
      : null;

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      n_points: onScreenValid.length,
      total_frames: totalFrames,
      centroid,
      dispersion,
      zone_proportions: zoneProportions,
      // Existing field, now time-weighted from the samples' real timestamps.
      // `sampleIntervalMs` remains the fallback when timestamps are absent.
      aoi_dwell_ms: aoi?.dwell ?? null,
      aoi_entries: aoi?.entries ?? null,
      aoi_revisits: aoi?.revisits ?? null,
      aoi_time_to_first_ms: aoi?.timeToFirst ?? null,
      aoi_transitions: aoi?.transitions ?? null,
      aoi_transition_count: aoi?.transitionCount ?? null,
      aoi_transition_entropy: aoi?.transitionEntropy ?? null,
      // Attention distribution over the AOIs (Yang et al. TVCG 2025;
      // Toreini et al. JAIS 2022). Aggregate scalars only.
      aoi_stationary_entropy: aoi?.stationaryEntropy ?? null,
      aoi_allocation_sd: aoi?.allocationSd ?? null,
      aoi_coverage: aoi?.coverage ?? null,
      aoi_count: aoi?.aoiCount ?? null,
      fixation_count: fixation?.count ?? null,
      fixation_duration_ms_total: fixation?.durationTotal ?? null,
      fixation_duration_ms_mean: fixation?.durationMean ?? null,
      fixation_duration_ms_median: fixation?.durationMedian ?? null,
      fixation_duration_ms_max: fixation?.durationMax ?? null,
      fixation_duration_ms_sd: fixation?.durationSd ?? null,
      scanpath_length: fixation?.scanpathLength ?? null,
      // Saccade amplitudes — the missing input for the ambient/focal
      // coefficient K, which is computed per-subject in the analysis layer.
      saccade_count: fixation?.saccadeCount ?? null,
      saccade_amplitude_mean: fixation?.saccadeAmplitudeMean ?? null,
      saccade_amplitude_median: fixation?.saccadeAmplitudeMedian ?? null,
      saccade_amplitude_max: fixation?.saccadeAmplitudeMax ?? null,
      saccade_amplitude_sd: fixation?.saccadeAmplitudeSd ?? null,
      fixation_sampling_adequate: samplingAdequate,
      fixation_algorithm: 'idt-coarse-v1',
      fixation_min_duration_ms: this.options.fixationMinDurationMs,
      fixation_dispersion_threshold: this.options.fixationDispersionThreshold,
      observed_sample_interval_ms: timing.observedSampleIntervalMs,
      observed_sample_rate_hz: timing.observedSampleRateHz,
      max_observed_sample_gap_ms: timing.maxObservedSampleGapMs,
      timing_source: timing.source,
      off_screen_episode_count: countOffScreenEpisodes(timedFrames),
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

function addFrameTiming(frames, fallbackIntervalMs, minimumGapLimitMs) {
  const deltas = [];
  for (let i = 0; i + 1 < frames.length; i += 1) {
    const a = frames[i].ts_ms;
    const b = frames[i + 1].ts_ms;
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) deltas.push(b - a);
  }
  const observedSampleIntervalMs = median(deltas);
  const fallback = positive(fallbackIntervalMs, 33);
  const representative = positive(observedSampleIntervalMs, fallback);
  const gapLimit = Math.max(positive(minimumGapLimitMs, DEFAULT_MAX_SAMPLE_GAP_MS), representative * 4);
  const maxObservedSampleGapMs = deltas.length > 0 ? Math.max(...deltas) : null;

  const timed = frames.map((frame, index) => {
    const next = frames[index + 1];
    const rawDelta = next && Number.isFinite(frame.ts_ms) && Number.isFinite(next.ts_ms)
      ? next.ts_ms - frame.ts_ms
      : null;
    const gapAfter = Number.isFinite(rawDelta) && rawDelta > gapLimit;
    // The final sample represents one typical interval, never the entire tail
    // until a later forced flush. This prevents stop/transport latency from
    // becoming fictitious gaze dwell.
    const durationMs = Number.isFinite(rawDelta) && rawDelta > 0 && !gapAfter
      ? rawDelta
      : representative;
    return { ...frame, duration_ms: durationMs, gap_after: gapAfter, sequence_index: index };
  });

  return {
    frames: timed,
    observedSampleIntervalMs,
    observedSampleRateHz: observedSampleIntervalMs == null ? null : 1000 / observedSampleIntervalMs,
    maxObservedSampleGapMs,
    source: deltas.length > 0 ? 'timestamps' : 'fallback',
  };
}

function computeAoiMetrics(frames, aois, windowStart) {
  const validAois = Array.isArray(aois)
    ? aois.filter(a => validAoi(a))
    : [];
  if (validAois.length === 0) return null;

  const dwell = {};
  const entries = {};
  const timeToFirst = {};
  const transitions = {};
  for (const a of validAois) {
    dwell[a.id] = 0;
    entries[a.id] = 0;
    timeToFirst[a.id] = null;
  }

  let activeAoi = null;
  let transitionCount = 0;
  for (const frame of frames) {
    const usable = frame.valid && frame.smoothed && !frame.off_screen
      && Number.isFinite(frame.x) && Number.isFinite(frame.y);
    const aoiId = usable ? matchingAoiId(frame, validAois) : null;
    if (aoiId == null) {
      activeAoi = null;
      continue;
    }

    dwell[aoiId] += positive(frame.duration_ms, 0);
    if (timeToFirst[aoiId] == null && Number.isFinite(frame.ts_ms)) {
      timeToFirst[aoiId] = Math.max(0, frame.ts_ms - windowStart);
    }
    if (aoiId !== activeAoi) {
      entries[aoiId] += 1;
      if (activeAoi != null) {
        const key = `${activeAoi}→${aoiId}`;
        transitions[key] = (transitions[key] || 0) + 1;
        transitionCount += 1;
      }
      activeAoi = aoiId;
    }
    if (frame.gap_after) activeAoi = null;
  }

  const revisits = {};
  for (const id of Object.keys(entries)) revisits[id] = Math.max(0, entries[id] - 1);
  const dwellValues = Object.values(dwell);
  const visited = dwellValues.filter(value => value > 0).length;
  return {
    dwell,
    entries,
    revisits,
    timeToFirst,
    transitions,
    transitionCount,
    transitionEntropy: normalizedCountEntropy(Object.values(transitions)),
    // How evenly attention was spread over the AOIs that existed, and how
    // much of the layout was reached at all. Both are aggregate scalars —
    // no point stream — so they satisfy the raw-gaze privacy contract.
    stationaryEntropy: normalizedDistributionEntropy(dwellValues, validAois.length),
    allocationSd: distributionSd(dwellValues),
    coverage: validAois.length > 0 ? visited / validAois.length : null,
    aoiCount: validAois.length,
  };
}

function computeFixationMetrics(frames, { minDurationMs, dispersionThreshold }) {
  const segments = [];
  let segment = [];
  for (const frame of frames) {
    const usable = frame.valid && frame.smoothed && !frame.off_screen
      && Number.isFinite(frame.x) && Number.isFinite(frame.y);
    if (!usable) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      continue;
    }
    segment.push(frame);
    if (frame.gap_after) {
      segments.push(segment);
      segment = [];
    }
  }
  if (segment.length > 0) segments.push(segment);

  const fixations = [];
  for (const points of segments) {
    let start = 0;
    while (start < points.length) {
      let end = start;
      while (
        end + 1 < points.length
        && fixationDispersion(points, start, end + 1) <= dispersionThreshold
      ) {
        end += 1;
      }
      const duration = sumDuration(points, start, end);
      if (duration >= minDurationMs) {
        fixations.push(summarizeFixation(points, start, end, duration));
        start = end + 1;
      } else {
        start += 1;
      }
    }
  }

  const durations = fixations.map(f => f.duration);
  // The inter-fixation distances summed into scanpathLength ARE the saccade
  // amplitudes; they were being discarded. Keeping them is what makes the
  // ambient/focal coefficient K computable downstream — K is the z-scored
  // fixation duration minus the z-scored amplitude of the NEXT saccade
  // (Krejtz et al. 2016). The z-scores are per-subject over a whole scanpath,
  // so K itself belongs in the analysis layer, not in a single window.
  const saccadeAmplitudes = [];
  for (let i = 1; i < fixations.length; i += 1) {
    const dx = fixations[i].x - fixations[i - 1].x;
    const dy = fixations[i].y - fixations[i - 1].y;
    saccadeAmplitudes.push(Math.sqrt(dx * dx + dy * dy));
  }
  const scanpathLength = saccadeAmplitudes.reduce((sum, value) => sum + value, 0);
  return {
    count: fixations.length,
    durationTotal: durations.reduce((sum, value) => sum + value, 0),
    durationMean: mean(durations),
    durationMedian: median(durations),
    durationMax: durations.length > 0 ? Math.max(...durations) : null,
    // Within-window SDs exist so a session-level σ can be POOLED exactly:
    //   σ² = Σ nᵢ(σᵢ² + (μᵢ − μ)²) / Σ nᵢ
    // Coefficient K needs σ over the whole scanpath. Computed from window
    // means alone it would capture only between-window variance and overstate
    // every K. See src/analytics/GazeDynamics.js.
    durationSd: populationSd(durations),
    scanpathLength,
    saccadeCount: saccadeAmplitudes.length,
    saccadeAmplitudeMean: mean(saccadeAmplitudes),
    saccadeAmplitudeMedian: median(saccadeAmplitudes),
    saccadeAmplitudeMax: saccadeAmplitudes.length > 0 ? Math.max(...saccadeAmplitudes) : null,
    saccadeAmplitudeSd: populationSd(saccadeAmplitudes),
  };
}

function fixationDispersion(points, start, end) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = start; i <= end; i += 1) {
    minX = Math.min(minX, points[i].x);
    maxX = Math.max(maxX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);
  }
  return (maxX - minX) + (maxY - minY);
}

function sumDuration(points, start, end) {
  let total = 0;
  for (let i = start; i <= end; i += 1) total += positive(points[i].duration_ms, 0);
  return total;
}

function summarizeFixation(points, start, end, duration) {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  for (let i = start; i <= end; i += 1) {
    const w = positive(points[i].duration_ms, 1);
    weightedX += points[i].x * w;
    weightedY += points[i].y * w;
    weight += w;
  }
  return { x: weightedX / weight, y: weightedY / weight, duration };
}

function countOffScreenEpisodes(frames) {
  let count = 0;
  let active = false;
  for (const frame of frames) {
    const offScreen = frame.valid && frame.smoothed && frame.off_screen;
    if (offScreen && !active) count += 1;
    active = offScreen && !frame.gap_after;
  }
  return count;
}

function validAoi(a) {
  return a && typeof a.id === 'string'
    && Number.isFinite(a.x) && Number.isFinite(a.y)
    && Number.isFinite(a.width) && Number.isFinite(a.height);
}

function matchingAoiId(frame, aois) {
  for (const a of aois) {
    if (
      frame.x >= a.x && frame.x < a.x + a.width
      && frame.y >= a.y && frame.y < a.y + a.height
    ) return a.id;
  }
  return null;
}

function normalizedCountEntropy(counts) {
  const positiveCounts = counts.filter(v => Number.isFinite(v) && v > 0);
  if (positiveCounts.length <= 1) return 0;
  const total = positiveCounts.reduce((sum, value) => sum + value, 0);
  let entropy = 0;
  for (const value of positiveCounts) {
    const p = value / total;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(positiveCounts.length);
}

/*
 * Shannon entropy over a distribution, normalized by the TOTAL number of
 * categories rather than by how many carry non-zero mass.
 *
 * normalizedCountEntropy divides by log2(observed) — right for transitions,
 * where the alphabet IS the set of transitions that occurred. It is wrong for
 * stationary entropy: a viewer who split time evenly over 2 of 6 AOIs would
 * score 1.0, identical to one who covered all 6 evenly, when the whole point
 * of the measure is that the first viewer explored less.
 */
function normalizedDistributionEntropy(values, categories) {
  const withMass = values.filter(v => Number.isFinite(v) && v > 0);
  if (withMass.length === 0 || categories <= 1) return 0;
  const total = withMass.reduce((sum, value) => sum + value, 0);
  let entropy = 0;
  for (const value of withMass) {
    const p = value / total;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(categories);
}

/*
 * NO TRANSITION-ENTROPY SCALAR IS EMITTED HERE, deliberately.
 *
 * A per-window Krejtz entropy was implemented and removed. Two reasons, both
 * decisive:
 *
 * 1. It does not belong to Oyon. `transitionEntropy()` already exists in
 *    tnaj (`tna-js/src/analysis/diagnostics.ts`, a verified port of
 *    Nestimate's `transition_entropy()`), returning row entropies, the
 *    stationary distribution from the eigenvector of Pᵀ, the entropy rate
 *    h(P) = Σ πᵢ H(Pᵢ·) and the redundancy H(π) − h(P). Oyon senses; the
 *    network packages own network algorithms.
 *
 * 2. A 3-second window holds too few transitions to estimate a conditional
 *    distribution. Measured over 400 stationary sessions, the per-window
 *    estimate had a 95% interval of [0.00, 1.17] bits against a true value of
 *    1.585 — an interval that includes zero. Nestimate's own docs say the
 *    same thing: within a short window the chain is routinely non-ergodic.
 *
 * What crosses the boundary instead is `aoi_transitions`, the raw counts.
 * `src/analytics/AoiTransitionMatrix.js` pools them across windows into a
 * labelled matrix, and the entropy is computed from THAT, where there are
 * enough observations for it to mean something.
 */

/*
 * Standard deviation of attention share across AOIs, in percentage points.
 *
 * Toreini et al. (JAIS 2022) use exactly this as "attentional resource
 * management": lower SD means attention was spread evenly over the available
 * regions, higher means it pooled in a few. Zero-dwell AOIs are INCLUDED —
 * an ignored region is precisely the imbalance being measured, so dropping it
 * would flatter a viewer who never looked at half the screen.
 */
function distributionSd(values) {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  const shares = values.map(value => (value / total) * 100);
  const m = shares.reduce((sum, value) => sum + value, 0) / shares.length;
  const variance = shares.reduce((sum, value) => sum + (value - m) ** 2, 0) / shares.length;
  return Math.sqrt(variance);
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population (not sample) SD — this is a complete window, not a sample of one. */
function populationSd(values) {
  if (values.length === 0) return null;
  const m = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
