export class DynamicalFeatureTracker {
  constructor(options = {}) {
    this.options = {
      maxHistory: 120,
      ...options,
    };
    this.history = [];
  }

  update(window) {
    const previous = this.history[this.history.length - 1] || null;
    const beforePrevious = this.history[this.history.length - 2] || null;
    const features = computeDynamicalFeatures(window, previous, beforePrevious);
    this.history.push({ ...window, dynamics: features });
    if (this.history.length > this.options.maxHistory) {
      this.history.splice(0, this.history.length - this.options.maxHistory);
    }
    return features;
  }

  reset() {
    this.history = [];
  }
}

export function computeDynamicalFeatures(window, previous = null, beforePrevious = null) {
  const dtSeconds = deltaSeconds(previous?.window_end, window.window_end);
  const prevDtSeconds = deltaSeconds(beforePrevious?.window_end, previous?.window_end);

  const valenceVelocity = slope(previous?.valence, window.valence, dtSeconds);
  const arousalVelocity = slope(previous?.arousal, window.arousal, dtSeconds);
  const prevValenceVelocity = slope(beforePrevious?.valence, previous?.valence, prevDtSeconds);
  const prevArousalVelocity = slope(beforePrevious?.arousal, previous?.arousal, prevDtSeconds);

  const valenceAcceleration = slope(prevValenceVelocity, valenceVelocity, dtSeconds);
  const arousalAcceleration = slope(prevArousalVelocity, arousalVelocity, dtSeconds);
  const affectSpeed = Number.isFinite(valenceVelocity) && Number.isFinite(arousalVelocity)
    ? Math.hypot(valenceVelocity, arousalVelocity)
    : null;

  const confidenceTrend = slope(previous?.confidence, window.confidence, dtSeconds);
  const entropyTrend = slope(previous?.entropy, window.entropy, dtSeconds);
  const missingnessTrend = slope(previous?.missing_face_ratio, window.missing_face_ratio, dtSeconds);
  const transitionFrom = previous?.dominant_emotion || null;
  const transitionTo = window.dominant_emotion || null;
  const labelChanged = Boolean(transitionFrom && transitionTo && transitionFrom !== transitionTo);
  const affectVolatility = volatility([
    previous?.valence,
    window.valence,
    previous?.arousal,
    window.arousal,
  ]);

  return {
    schema_version: 'oyon-dynamics-v1',
    window_id: window.window_id || null,
    window_start: window.window_start,
    window_end: window.window_end,
    valence_velocity: nullable(valenceVelocity),
    arousal_velocity: nullable(arousalVelocity),
    valence_acceleration: nullable(valenceAcceleration),
    arousal_acceleration: nullable(arousalAcceleration),
    affect_speed: nullable(affectSpeed),
    affect_volatility: nullable(affectVolatility),
    confidence_trend: nullable(confidenceTrend),
    entropy_trend: nullable(entropyTrend),
    missingness_trend: nullable(missingnessTrend),
    phase_quadrant: phaseQuadrant(window.valence, window.arousal),
    transition_from: transitionFrom,
    transition_to: transitionTo,
    label_changed: labelChanged,
    instability_score: instabilityScore({
      affectSpeed,
      affectVolatility,
      entropy: window.entropy,
      missingFaceRatio: window.missing_face_ratio,
      labelChanged,
    }),
  };
}

export function enrichWindowsWithDynamics(windows) {
  const tracker = new DynamicalFeatureTracker();
  return windows.map(window => ({
    ...window,
    dynamics: tracker.update(window),
  }));
}

function deltaSeconds(previousIso, currentIso) {
  if (!previousIso || !currentIso) return null;
  const previous = Date.parse(previousIso);
  const current = Date.parse(currentIso);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return null;
  return (current - previous) / 1000;
}

function slope(previous, current, seconds) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return (current - previous) / seconds;
}

function volatility(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance = valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length;
  return Math.sqrt(variance);
}

function phaseQuadrant(valence, arousal) {
  if (!Number.isFinite(valence) || !Number.isFinite(arousal)) return null;
  if (valence >= 0 && arousal >= 0) return 'positive-activated';
  if (valence >= 0 && arousal < 0) return 'positive-calm';
  if (valence < 0 && arousal >= 0) return 'negative-activated';
  return 'negative-calm';
}

function instabilityScore({ affectSpeed, affectVolatility, entropy, missingFaceRatio, labelChanged }) {
  const parts = [
    clamp01((affectSpeed || 0) / 0.2),
    clamp01((affectVolatility || 0) / 0.5),
    clamp01((entropy || 0) / 3),
    clamp01(missingFaceRatio || 0),
    labelChanged ? 0.2 : 0,
  ];
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function nullable(value) {
  return Number.isFinite(value) ? value : null;
}
