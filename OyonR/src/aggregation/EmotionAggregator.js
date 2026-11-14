export class EmotionAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      minValidFrames: 6,
      sampleIntervalMs: 1000,
      labels: ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
      ...options,
    };
    this.windowStart = null;
    this.samples = [];
    // Anchored mode only: the open window's grid index k, the anchor it was
    // opened under, how far its start was pushed past the grid start (a clock
    // correction would otherwise make it overlap the window before), and the
    // end of the last closed window.
    this.windowIndex = null;
    this.windowOpenAnchor = null;
    this.windowClippedMs = 0;
    this.lastWindowEnd = null;
  }

  addSample(sample) {
    const anchor = this.anchorMs();
    if (anchor === null) {
      if (this.windowStart === null) this.windowStart = sample.timestamp;
      this.samples.push(sample);
      if (sample.timestamp - this.windowStart < this.options.windowMs) return null;
      return this.flush(sample.timestamp);
    }
    // Anchored windows (docs/GROUP_SYNCHRONY_PLAN.md §2.2): window k covers
    // [anchor + k·W, anchor + (k+1)·W) for every member, so member windows
    // line up. A sample past the current window closes it at its grid end
    // and opens the window that contains the sample; windows a member was
    // absent for (late join, pause) are simply missing.
    //
    // The anchor is read on every sample because a group-clock re-sync moves
    // it (the runtime converts the group-time anchor to local time). The open
    // window keeps its index k and closes at k's end on the CURRENT grid, so a
    // correction lengthens or shortens that one window instead of producing two
    // windows that overlap; the next window never starts before the last one
    // ended. Both windows say so (`anchor_correction_ms`, `window_clipped_ms`).
    let completed = null;
    if (this.windowStart !== null && this.windowIndex === null) {
      // Opened free-running (no anchor yet): adopt the grid window it starts in.
      this.windowIndex = Math.floor((this.windowStart - anchor) / this.options.windowMs);
      this.windowOpenAnchor = anchor;
    }
    if (this.windowStart !== null) {
      const end = this.anchoredEnd(anchor);
      if (sample.timestamp >= end) completed = this.flush(end);
    }
    if (this.windowStart === null) this.openAnchored(sample.timestamp, anchor);
    this.samples.push(sample);
    return completed;
  }

  /** End of the open anchored window on the current grid, never before its last sample. */
  anchoredEnd(anchor) {
    const w = this.options.windowMs;
    const gridEnd = anchor + (this.windowIndex + 1) * w;
    const lastTs = this.samples.length ? this.samples[this.samples.length - 1].timestamp : this.windowStart;
    return Math.max(gridEnd, this.windowStart, lastTs + 1);
  }

  openAnchored(timestamp, anchor) {
    const w = this.options.windowMs;
    const index = Math.floor((timestamp - anchor) / w);
    const gridStart = anchor + index * w;
    const start = this.lastWindowEnd !== null && this.lastWindowEnd > gridStart && this.lastWindowEnd <= timestamp
      ? this.lastWindowEnd
      : gridStart;
    this.windowStart = start;
    this.windowIndex = index;
    this.windowOpenAnchor = anchor;
    this.windowClippedMs = start - gridStart;
  }

  /**
   * The window anchor in this aggregator's timestamp domain (local epoch ms),
   * or null for free-running windows. `options.windowAnchorMs` may be a number
   * or a function (the runtime passes one that converts the group-time anchor
   * through the group clock, so a re-sync moves it).
   */
  anchorMs() {
    const a = this.options.windowAnchorMs;
    const value = typeof a === 'function' ? a() : a;
    return Number.isFinite(value) ? value : null;
  }

  gridStart(timestamp, anchor) {
    const w = this.options.windowMs;
    return anchor + Math.floor((timestamp - anchor) / w) * w;
  }

  flush(end = Date.now()) {
    if (!this.samples.length || this.windowStart === null) return null;
    const window = this.summarize(end);
    if (this.windowIndex !== null) {
      // Anchored: the grid index and any clock correction, on the window.
      const anchorNow = this.anchorMs();
      const correction = Number.isFinite(anchorNow) && Number.isFinite(this.windowOpenAnchor)
        ? anchorNow - this.windowOpenAnchor
        : 0;
      window.window_index = this.windowIndex;
      window.anchor_correction_ms = correction;
      window.window_clipped_ms = this.windowClippedMs;
    }
    this.lastWindowEnd = Math.max(end, this.windowStart);
    this.samples = [];
    this.windowStart = null;
    this.windowIndex = null;
    this.windowOpenAnchor = null;
    this.windowClippedMs = 0;
    return window;
  }

  /** @internal The window summary of the buffered samples, closed at `end`. */
  summarize(end) {
    const samples = this.samples;
    const windowStart = this.windowStart;

    const valid = samples.filter(s => s.facePresent && s.probabilities);
    const missing = samples.length - valid.length;
    const probabilities = meanProbabilities(valid, this.options.labels);
    const dominant = dominantLabel(probabilities);
    const confidence = dominant ? probabilities[dominant] : 0;
    const durationMs = Math.max(0, end - windowStart);
    const expectedSamples = Math.floor(durationMs / this.options.sampleIntervalMs) + 1 || samples.length;

    if (valid.length < this.options.minValidFrames) {
      return {
        window_start: new Date(windowStart).toISOString(),
        window_end: new Date(end).toISOString(),
        duration_ms: durationMs,
        expected_samples: expectedSamples,
        dominant_emotion: null,
        probabilities: null,
        valence: null,
        arousal: null,
        confidence: 0,
        entropy: null,
        valid_frames: valid.length,
        missing_face_ratio: samples.length ? missing / samples.length : 1,
        quality: { insufficientValidFrames: true },
        model_name: null,
        model_version: null,
      };
    }

    const model = valid.find(s => s.model)?.model || {};
    return {
      window_start: new Date(windowStart).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      expected_samples: expectedSamples,
      dominant_emotion: dominant,
      probabilities,
      valence: mean(valid.map(s => s.valence).filter(Number.isFinite)),
      valence_std: std(valid.map(s => s.valence).filter(Number.isFinite)),
      valence_min: min(valid.map(s => s.valence).filter(Number.isFinite)),
      valence_max: max(valid.map(s => s.valence).filter(Number.isFinite)),
      arousal: mean(valid.map(s => s.arousal).filter(Number.isFinite)),
      arousal_std: std(valid.map(s => s.arousal).filter(Number.isFinite)),
      arousal_min: min(valid.map(s => s.arousal).filter(Number.isFinite)),
      arousal_max: max(valid.map(s => s.arousal).filter(Number.isFinite)),
      confidence,
      confidence_std: std(valid.map(s => s.confidence).filter(Number.isFinite)),
      entropy: mean(valid.map(s => s.entropy).filter(Number.isFinite)),
      entropy_std: std(valid.map(s => s.entropy).filter(Number.isFinite)),
      stability_score: stabilityScore(valid),
      label_switch_count: labelSwitchCount(valid, this.options.labels),
      valid_frames: valid.length,
      missing_face_ratio: samples.length ? missing / samples.length : 0,
      quality: summarizeQuality(samples),
      model_name: model.name || null,
      model_version: model.version || null,
    };
  }
}

function meanProbabilities(samples, labels) {
  const out = Object.fromEntries(labels.map(label => [label, 0]));
  if (!samples.length) return out;
  for (const sample of samples) {
    for (const label of labels) {
      out[label] += sample.probabilities?.[label] || 0;
    }
  }
  for (const label of labels) out[label] /= samples.length;
  return out;
}

function dominantLabel(probabilities) {
  let best = null;
  let bestValue = -Infinity;
  for (const [label, value] of Object.entries(probabilities || {})) {
    if (value > bestValue) {
      best = label;
      bestValue = value;
    }
  }
  return best;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function min(values) {
  return values.length ? Math.min(...values) : null;
}

function max(values) {
  return values.length ? Math.max(...values) : null;
}

function stabilityScore(samples) {
  const labels = samples.map(sample => dominantLabel(sample.probabilities));
  if (labels.length < 2) return 1;
  const switches = labels.slice(1).filter((label, index) => label !== labels[index]).length;
  return 1 - switches / (labels.length - 1);
}

function labelSwitchCount(samples) {
  const labels = samples.map(sample => dominantLabel(sample.probabilities));
  return labels.slice(1).filter((label, index) => label !== labels[index]).length;
}

function summarizeQuality(samples) {
  const faceArea = samples
    .map(s => s.quality?.faceAreaRatio)
    .filter(Number.isFinite);
  return {
    meanFaceAreaRatio: mean(faceArea),
    totalFrames: samples.length,
  };
}
