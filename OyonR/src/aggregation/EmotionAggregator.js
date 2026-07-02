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
  }

  addSample(sample) {
    if (this.windowStart === null) this.windowStart = sample.timestamp;
    this.samples.push(sample);
    if (sample.timestamp - this.windowStart < this.options.windowMs) return null;
    return this.flush(sample.timestamp);
  }

  flush(end = Date.now()) {
    if (!this.samples.length || this.windowStart === null) return null;
    const samples = this.samples;
    this.samples = [];
    const windowStart = this.windowStart;
    this.windowStart = null;

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
