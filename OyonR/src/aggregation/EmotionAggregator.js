import { ALLOWED_EMOTIONS } from '../config/emotionLabels.js';

export class EmotionAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      minValidFrames: 3,
      sampleIntervalMs: 1000,
      // Default labels come from the canonical ALLOWED_EMOTIONS in
      // ../config/emotionLabels.js — the same source the validator and
      // every model config use. The runtime overrides this with the
      // actual classifier labels at construction; callers constructing
      // the aggregator directly without a classifier still get a sane
      // default that round-trips through the validator.
      labels: ALLOWED_EMOTIONS,
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
        anxious_index: null,
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
    const valenceMean = mean(valid.map(s => s.valence).filter(Number.isFinite));
    const arousalMean = mean(valid.map(s => s.arousal).filter(Number.isFinite));
    return {
      window_start: new Date(windowStart).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      expected_samples: expectedSamples,
      dominant_emotion: dominant,
      probabilities,
      // Bug 18 (18.5.2026): AffectNet 8-class models cannot emit anxiety —
      // it is not a label they have. Rather than fake a 9th class (which
      // would break the frozen ALLOWED_EMOTIONS validator/contract), we
      // expose a *derived* anxiety indicator in [0,1] from the circumplex:
      // anxiety = high arousal + negative valence, reinforced by fear.
      // It is a separate field, never injected into `probabilities`, so the
      // sum-to-one contract is untouched.
      anxious_index: anxiousIndex(probabilities, valenceMean, arousalMean),
      valence: valenceMean,
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

// Derived anxiety indicator (Bug 18). Not a model class — a composite of
// the circumplex affect axes the MTL models DO emit. valence/arousal are
// in [-1, 1]; fear is a probability in [0, 1]. Returns null when the
// inputs are unavailable so consumers can distinguish "not anxious" (0)
// from "unknown" (null).
export function anxiousIndex(probabilities, valence, arousal) {
  const fear = probabilities && Number.isFinite(probabilities.fear) ? probabilities.fear : 0;
  if (!Number.isFinite(valence) && !Number.isFinite(arousal) && !probabilities) return null;
  const v = Number.isFinite(valence) ? valence : 0;
  const a = Number.isFinite(arousal) ? arousal : 0;
  const arousalPos = clamp01((a + 1) / 2);   // high arousal → 1
  const valenceNeg = clamp01((1 - v) / 2);   // very negative valence → 1
  const quadrant = arousalPos * valenceNeg;  // high-arousal & negative quadrant
  return clamp01(0.6 * quadrant + 0.4 * fear);
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
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
