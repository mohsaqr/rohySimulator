// Originally a verbatim port of generateDemoFixture / loadDemoData from
// standalone/logs-dashboard.js. Deliberately diverged from the frozen
// legacy fixture: each window now also carries a synthetic `engagement`
// block (focus / blink / openness / entropy) and `gaze` block (zone
// proportions / centroid / dispersion / calibration), so /analyze/engagement
// and /analyze/gaze actually demonstrate something with demo data instead
// of rendering empty. Block shapes mirror EngagementAggregator /
// GazeAggregator output so the same renderers consume real and demo data
// identically. Still writes the same localStorage keys the legacy reader
// expects.

export function generateDemoFixture() {
  const sessions = ['demo-session-1', 'demo-session-2', 'demo-session-3'];
  const states = ['neutral', 'happy', 'surprise', 'sad', 'anger', 'fear'];
  const transitionTendencies = {
    neutral:  { neutral: 0.55, happy: 0.20, surprise: 0.10, sad: 0.10, anger: 0.03, fear: 0.02 },
    happy:    { neutral: 0.25, happy: 0.55, surprise: 0.10, sad: 0.05, anger: 0.02, fear: 0.03 },
    surprise: { neutral: 0.30, happy: 0.30, surprise: 0.20, sad: 0.10, anger: 0.05, fear: 0.05 },
    sad:      { neutral: 0.25, happy: 0.10, surprise: 0.05, sad: 0.50, anger: 0.05, fear: 0.05 },
    anger:    { neutral: 0.15, happy: 0.05, surprise: 0.10, sad: 0.20, anger: 0.45, fear: 0.05 },
    fear:     { neutral: 0.20, happy: 0.05, surprise: 0.15, sad: 0.20, anger: 0.10, fear: 0.30 },
  };

  function pickNext(prev) {
    const probs = transitionTendencies[prev] || transitionTendencies.neutral;
    const r = Math.random();
    let acc = 0;
    for (const [state, p] of Object.entries(probs)) {
      acc += p;
      if (r <= acc) return state;
    }
    return states[states.length - 1];
  }

  function valenceArousal(state) {
    const map = {
      neutral:  [0.0,   0.0],
      happy:    [0.7,   0.3],
      surprise: [0.2,   0.7],
      sad:      [-0.6, -0.3],
      anger:    [-0.7,  0.6],
      fear:     [-0.5,  0.5],
    };
    const [v, a] = map[state] || [0, 0];
    return { valence: v + (Math.random() - 0.5) * 0.15, arousal: a + (Math.random() - 0.5) * 0.15 };
  }

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // 3×3 zone proportions, concentrated on whatever the gaze "settled" on
  // (usually middle_center) with the remainder scattered, normalized to 1.
  function makeZoneProportions() {
    const zones = [
      'top_left', 'top_center', 'top_right',
      'middle_left', 'middle_center', 'middle_right',
      'bottom_left', 'bottom_center', 'bottom_right',
    ];
    const dominant = Math.random() < 0.75
      ? 'middle_center'
      : zones[Math.floor(Math.random() * zones.length)];
    const raw = {};
    let total = 0;
    for (const z of zones) {
      const base = z === dominant ? 4 + Math.random() * 4 : Math.random();
      raw[z] = base;
      total += base;
    }
    const out = {};
    for (const z of zones) out[z] = Number((raw[z] / total).toFixed(4));
    return out;
  }

  // Engagement block — mirrors EngagementAggregator.flush() output. Focus is
  // biased by affective state (calm/positive → more focused) and scaled by
  // how many frames were valid, so the timelines have believable structure.
  function makeEngagement(state, missingRatio, entropy, stepMs) {
    const validRatio = clamp(1 - missingRatio, 0, 1);
    const focusBias = { neutral: 0.78, happy: 0.74, surprise: 0.58, sad: 0.42, anger: 0.40, fear: 0.36 };
    const opennessBias = { neutral: 0.70, happy: 0.74, surprise: 0.88, sad: 0.60, anger: 0.66, fear: 0.86 };
    const focusScore = clamp((focusBias[state] ?? 0.6) * (0.7 + 0.3 * validRatio) + (Math.random() - 0.5) * 0.12, 0, 1);
    const eyeOpennessMean = clamp((opennessBias[state] ?? 0.7) + (Math.random() - 0.5) * 0.1, 0.3, 0.98);
    const blinkRateHz = Number(clamp(0.15 + (state === 'fear' || state === 'anger' ? 0.2 : 0) + Math.random() * 0.3, 0, 1).toFixed(3));
    return {
      duration_ms: stepMs,
      valid_frame_ratio: Number(validRatio.toFixed(3)),
      blink_count: Math.round(blinkRateHz * (stepMs / 1000)),
      blink_rate_hz: blinkRateHz,
      eye_openness_mean: Number(eyeOpennessMean.toFixed(3)),
      eye_openness_std: Number((0.03 + Math.random() * 0.05).toFixed(3)),
      gaze_entropy: Number(clamp(entropy * (0.4 + Math.random() * 0.4), 0, 3).toFixed(3)),
      focus_score: Number(focusScore.toFixed(3)),
      focus_score_components: {
        stability: Number(clamp(focusScore + (Math.random() - 0.5) * 0.2, 0, 1).toFixed(3)),
        openness: Number(clamp(eyeOpennessMean, 0, 1).toFixed(3)),
        centrality: Number(clamp(focusScore + (Math.random() - 0.5) * 0.25, 0, 1).toFixed(3)),
      },
      model_version: 'demo-mock',
    };
  }

  // Gaze block — mirrors GazeAggregator.flush() output (aggregate stats only,
  // never a raw point stream — keeps the privacy contract intact).
  function makeGaze(calAgeMs, startIso, endIso, stepMs) {
    const nPoints = 14 + Math.floor(Math.random() * 7);
    const confRoll = Math.random();
    return {
      window_start: startIso,
      window_end: endIso,
      duration_ms: stepMs,
      n_points: nPoints,
      total_frames: 20,
      centroid: {
        x: Number(((Math.random() - 0.5) * 0.3).toFixed(4)),
        y: Number(((Math.random() - 0.5) * 0.3).toFixed(4)),
      },
      dispersion: Number((0.06 + Math.random() * 0.18).toFixed(4)),
      zone_proportions: makeZoneProportions(),
      aoi_dwell_ms: {
        stimulus_chart: Math.round(stepMs * (0.2 + Math.random() * 0.4)),
        stimulus_text: Math.round(stepMs * (0.1 + Math.random() * 0.3)),
      },
      calibration_age_ms: Math.round(calAgeMs),
      calibration_quality: Number((0.55 + Math.random() * 0.4).toFixed(3)),
      calibration_confidence: confRoll < 0.7 ? 'measured' : confRoll < 0.9 ? 'inferred' : 'unknown',
      valid_frame_ratio: Number((0.85 + Math.random() * 0.14).toFixed(3)),
      off_screen_ratio: Number((Math.random() * 0.08).toFixed(3)),
      model_version: 'demo-mock',
    };
  }

  const windows = [];
  const metrics = [];
  const events = [];
  const start = Date.now() - 30 * 60 * 1000;

  for (const sessionId of sessions) {
    const length = 24 + Math.floor(Math.random() * 12);
    let prev = 'neutral';
    let cursor = start + Math.floor(Math.random() * 5 * 60 * 1000);
    // Pretend calibration finished ~45s before the first window so
    // calibration_age_ms grows believably across the session.
    const calBaseMs = cursor - 45000;
    events.push({
      level: 'info',
      event_name: 'session.start',
      timestamp: new Date(cursor).toISOString(),
      session_id: sessionId,
      context: { session_id: sessionId, user_id: 'demo-user', model_profile: 'demo-mock' },
      source: 'demo',
    });
    for (let i = 0; i < length; i += 1) {
      const stepMs = 8000 + Math.floor(Math.random() * 4000);
      const startIso = new Date(cursor).toISOString();
      const endIso = new Date(cursor + stepMs).toISOString();
      const state = pickNext(prev);
      const { valence, arousal } = valenceArousal(state);
      const conf = 0.55 + Math.random() * 0.4;
      const entropy = 0.3 + Math.random() * 1.2;
      const missing = Math.random() * 0.08;
      windows.push({
        window_id: `${sessionId}-${i}`,
        window_start: startIso,
        window_end: endIso,
        window_end_ms: cursor + stepMs,
        dominant_emotion: state,
        confidence: conf,
        entropy,
        valence,
        arousal,
        missing_face_ratio: missing,
        valid_frames: Math.floor(20 * (1 - missing)),
        expected_samples: 20,
        model_profile: 'demo-mock',
        session_id: sessionId,
        context: { session_id: sessionId, user_id: 'demo-user', model_profile: 'demo-mock' },
        engagement: makeEngagement(state, missing, entropy, stepMs),
        gaze: makeGaze((cursor + stepMs) - calBaseMs, startIso, endIso, stepMs),
      });
      metrics.push({
        metric_name: 'oyon.sample.duration',
        metric_value: 14 + Math.random() * 18,
        metric_unit: 'ms',
        timestamp: endIso,
        session_id: sessionId,
        context: { session_id: sessionId },
      });
      cursor += stepMs;
      prev = state;
    }
    events.push({
      level: 'info',
      event_name: 'session.end',
      timestamp: new Date(cursor).toISOString(),
      session_id: sessionId,
      context: { session_id: sessionId, user_id: 'demo-user' },
      source: 'demo',
    });
  }
  return { windows, metrics, events };
}

/**
 * Write the demo fixture into the storage keys the new shell reads
 * (`oyon-app-windows` is the primary fallback target; we also populate
 * `standalone-fer-events` so the legacy logs.html sees the same data).
 */
export function loadDemoData() {
  const { windows, metrics, events } = generateDemoFixture();
  localStorage.setItem('oyon-app-windows', JSON.stringify(windows));
  localStorage.setItem('oyon-app-metrics', JSON.stringify(metrics));
  localStorage.setItem('oyon-app-logs', JSON.stringify(events));
  localStorage.setItem('standalone-fer-events', JSON.stringify(windows));
  localStorage.setItem('standalone-oyon-metrics', JSON.stringify(metrics));
  localStorage.setItem('standalone-oyon-logs', JSON.stringify(events));
}

export function clearAllStreams() {
  for (const key of [
    'oyon-app-windows',
    'oyon-app-metrics',
    'oyon-app-logs',
    'standalone-fer-events',
    'standalone-oyon-metrics',
    'standalone-oyon-logs',
  ]) {
    localStorage.removeItem(key);
  }
}
