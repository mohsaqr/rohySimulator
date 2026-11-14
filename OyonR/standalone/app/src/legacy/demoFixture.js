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
    const fixationCount = 2 + Math.floor(Math.random() * 4);
    const fixationMeanMs = 180 + Math.random() * 280;
    // Saccades sit between fixations, so there is always exactly one fewer —
    // the same invariant GazeAggregator produces, and the pairing coefficient
    // K relies on. scanpath_length is derived rather than drawn independently,
    // so mean x count === length holds here as it does in real windows.
    const saccadeCount = Math.max(0, fixationCount - 1);
    const saccadeMean = 0.08 + Math.random() * 0.28;
    const scanpathLength = saccadeCount * saccadeMean;
    const offScreenRatio = Math.random() < 0.12
      ? 0.35 + Math.random() * 0.4
      : Math.random() * 0.12;
    const chartToText = Math.floor(Math.random() * 3);
    const textToChart = Math.floor(Math.random() * 3);
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
      aoi_entries: {
        stimulus_chart: 1 + Math.floor(Math.random() * 3),
        stimulus_text: 1 + Math.floor(Math.random() * 3),
      },
      aoi_revisits: {
        stimulus_chart: Math.floor(Math.random() * 2),
        stimulus_text: Math.floor(Math.random() * 2),
      },
      // U+2192, matching what GazeAggregator actually emits. This used the
      // ASCII '->' for a long time; nothing split the key until
      // AoiTransitionMatrix, so the divergence from the real emit format was
      // never exercised.
      aoi_transitions: {
        'stimulus_chart\u2192stimulus_text': chartToText,
        'stimulus_text\u2192stimulus_chart': textToChart,
      },
      aoi_transition_count: chartToText + textToChart,
      aoi_transition_entropy: Number((0.25 + Math.random() * 0.7).toFixed(3)),
      observed_sample_rate_hz: Number((nPoints / (stepMs / 1000)).toFixed(1)),
      max_observed_sample_gap_ms: Math.round(70 + Math.random() * 70),
      fixation_sampling_adequate: true,
      fixation_count: fixationCount,
      fixation_duration_ms_total: Math.round(fixationCount * fixationMeanMs),
      fixation_duration_ms_mean: Math.round(fixationMeanMs),
      fixation_duration_ms_median: Math.round(fixationMeanMs * (0.9 + Math.random() * 0.15)),
      fixation_duration_ms_max: Math.round(fixationMeanMs * (1.2 + Math.random() * 0.5)),
      // Per-window SDs — the inputs coefficient K pools into a session sigma.
      fixation_duration_ms_sd: Number((fixationMeanMs * (0.15 + Math.random() * 0.25)).toFixed(1)),
      scanpath_length: Number(scanpathLength.toFixed(3)),
      saccade_count: saccadeCount,
      saccade_amplitude_mean: Number(saccadeMean.toFixed(4)),
      saccade_amplitude_median: Number((saccadeMean * (0.85 + Math.random() * 0.2)).toFixed(4)),
      saccade_amplitude_max: Number((saccadeMean * (1.3 + Math.random() * 0.6)).toFixed(4)),
      saccade_amplitude_sd: Number((saccadeMean * (0.2 + Math.random() * 0.3)).toFixed(4)),
      off_screen_episode_count: offScreenRatio >= 0.35 ? 1 : 0,
      calibration_age_ms: Math.round(calAgeMs),
      calibration_quality: Number((0.55 + Math.random() * 0.4).toFixed(3)),
      calibration_confidence: confRoll < 0.7 ? 'measured' : confRoll < 0.9 ? 'inferred' : 'unknown',
      valid_frame_ratio: Number((0.85 + Math.random() * 0.14).toFixed(3)),
      off_screen_ratio: Number(offScreenRatio.toFixed(3)),
      model_version: 'demo-mock',
    };
  }

  // Facial-signals block — mirrors FacialSignalAggregator.flush(). Head pose,
  // movement, facing ratio, and action units biased by affective state.
  function makeFacial(state, missingRatio, stepMs) {
    const validRatio = clamp(1 - missingRatio, 0, 1);
    const moveBias = { neutral: 0.5, happy: 0.7, surprise: 1.6, sad: 0.9, anger: 1.4, fear: 2.0 };
    const movement = Number(clamp((moveBias[state] ?? 0.8) + Math.random() * 0.8, 0, 8).toFixed(3));
    const facing = Number(clamp(0.95 - movement * 0.07 + (Math.random() - 0.5) * 0.08, 0, 1).toFixed(3));
    const au = (v) => Number(clamp(v, 0, 1).toFixed(3));
    return {
      duration_ms: stepMs,
      total_frames: 20,
      valid_frames: Math.floor(20 * validRatio),
      valid_frame_ratio: Number(validRatio.toFixed(3)),
      head_pose_mean: {
        pitch_deg: Number(((state === 'sad' ? -6 : -1) + (Math.random() - 0.5) * 8).toFixed(2)),
        yaw_deg: Number(((Math.random() - 0.5) * 16).toFixed(2)),
        roll_deg: Number(((Math.random() - 0.5) * 8).toFixed(2)),
      },
      head_pose_std: {
        pitch_deg: Number((1 + Math.random() * 3).toFixed(2)),
        yaw_deg: Number((1 + Math.random() * 4).toFixed(2)),
        roll_deg: Number((1 + Math.random() * 2).toFixed(2)),
      },
      head_movement_deg: movement,
      facing_screen_ratio: facing,
      // All 14 proxies ACTION_UNIT_MAP emits. The fixture must mirror the real
      // extractor: with only 7 here, demo data would hide exactly the coverage
      // bug the Position tab was fixed for.
      action_units_mean: {
        smile: au(state === 'happy' ? 0.6 + Math.random() * 0.3 : Math.random() * 0.15),
        frown: au(state === 'sad' ? 0.3 + Math.random() * 0.3 : Math.random() * 0.1),
        brow_furrow: au(state === 'anger' || state === 'fear' ? 0.4 + Math.random() * 0.4 : Math.random() * 0.15),
        brow_raise_inner: au(state === 'surprise' || state === 'fear' ? 0.35 + Math.random() * 0.35 : Math.random() * 0.12),
        brow_raise_outer: au(state === 'surprise' ? 0.3 + Math.random() * 0.35 : Math.random() * 0.12),
        jaw_open: au(state === 'surprise' ? 0.4 + Math.random() * 0.4 : Math.random() * 0.2),
        mouth_open: au(state === 'surprise' ? 0.35 + Math.random() * 0.35 : Math.random() * 0.18),
        mouth_pucker: au(Math.random() * 0.2),
        mouth_press: au(state === 'anger' ? 0.25 + Math.random() * 0.3 : Math.random() * 0.18),
        eye_wide: au(state === 'surprise' || state === 'fear' ? 0.4 + Math.random() * 0.4 : Math.random() * 0.15),
        eye_squint: au(state === 'happy' ? 0.3 + Math.random() * 0.3 : Math.random() * 0.25),
        cheek_raise: au(state === 'happy' ? 0.4 + Math.random() * 0.3 : Math.random() * 0.1),
        cheek_puff: au(Math.random() * 0.1),
        nose_sneer: au(state === 'anger' ? 0.2 + Math.random() * 0.3 : Math.random() * 0.1),
      },
      // A representative slice of the raw blendshapes the AUs average over.
      blendshapes_mean: {
        mouthSmileLeft: au(state === 'happy' ? 0.6 + Math.random() * 0.3 : Math.random() * 0.15),
        mouthSmileRight: au(state === 'happy' ? 0.6 + Math.random() * 0.3 : Math.random() * 0.15),
        browDownLeft: au(state === 'anger' ? 0.4 + Math.random() * 0.3 : Math.random() * 0.15),
        browDownRight: au(state === 'anger' ? 0.4 + Math.random() * 0.3 : Math.random() * 0.15),
        browInnerUp: au(state === 'surprise' ? 0.4 + Math.random() * 0.3 : Math.random() * 0.12),
        eyeSquintLeft: au(state === 'happy' ? 0.3 + Math.random() * 0.3 : Math.random() * 0.25),
        eyeSquintRight: au(state === 'happy' ? 0.3 + Math.random() * 0.3 : Math.random() * 0.25),
        eyeBlinkLeft: au(Math.random() * 0.3),
        eyeBlinkRight: au(Math.random() * 0.3),
        jawOpen: au(state === 'surprise' ? 0.4 + Math.random() * 0.4 : Math.random() * 0.2),
        mouthPressLeft: au(state === 'anger' ? 0.25 + Math.random() * 0.3 : Math.random() * 0.18),
        mouthPressRight: au(state === 'anger' ? 0.25 + Math.random() * 0.3 : Math.random() * 0.18),
      },
      model_version: 'demo-mock',
    };
  }

  // Body-posture block — mirrors PostureAggregator.flush(). Lean drifts slowly
  // across the session; sway rises with arousing/negative states.
  function makePosture(state, missingRatio, stepMs, idx) {
    const validRatio = clamp(1 - missingRatio, 0, 1);
    const lean = Number((Math.sin(idx * 0.3) * 6 + (Math.random() - 0.5) * 4).toFixed(2));
    const slouchBias = { neutral: 0.55, happy: 0.6, surprise: 0.62, sad: 0.42, anger: 0.5, fear: 0.45 };
    const above = Number(clamp((slouchBias[state] ?? 0.55) + (Math.random() - 0.5) * 0.15, 0.2, 0.9).toFixed(3));
    const sway = Number(clamp(state === 'fear' || state === 'anger' ? 2 + Math.random() * 3 : 0.5 + Math.random() * 1.5, 0, 8).toFixed(3));
    return {
      duration_ms: stepMs,
      total_frames: 20,
      valid_frames: Math.floor(20 * validRatio),
      valid_frame_ratio: Number(validRatio.toFixed(3)),
      shoulder_tilt_deg_mean: Number(((Math.random() - 0.5) * 8).toFixed(2)),
      shoulder_tilt_deg_std: Number((1 + Math.random() * 3).toFixed(2)),
      torso_lean_deg_mean: lean,
      torso_lean_deg_std: Number((1 + Math.random() * 3).toFixed(2)),
      head_lateral_norm_mean: Number(((Math.random() - 0.5) * 0.3).toFixed(3)),
      head_lateral_norm_std: Number((0.02 + Math.random() * 0.05).toFixed(3)),
      head_above_norm_mean: above,
      head_above_norm_std: Number((0.02 + Math.random() * 0.05).toFixed(3)),
      shoulder_width_norm_mean: Number((0.28 + Math.random() * 0.08).toFixed(3)),
      shoulder_width_norm_std: Number((0.01 + Math.random() * 0.02).toFixed(3)),
      upper_visibility_mean: Number(clamp(0.9 + Math.random() * 0.09, 0, 1).toFixed(3)),
      upper_visibility_std: Number((0.01 + Math.random() * 0.03).toFixed(3)),
      postural_sway_deg: sway,
      model_version: 'demo-mock',
    };
  }

  // Cross-window tracker state for the demo, mirroring HeartRateAggregator:
  // the first windows are withheld while the value is corroborated, and moves
  // are slew-limited afterwards. Without this the Heart rate tab's headline
  // series (bpm_tracked) would be empty for demo data.
  let hrTracked = null;
  let hrSeeded = 0;

  // rPPG heart-rate block — mirrors HeartRateAggregator.flush(). BPM tracks
  // arousal (+ fear/anger bump); confidence follows valid-frame ratio.
  function makeHeartRate(state, arousal, missingRatio, stepMs) {
    const validRatio = clamp(1 - missingRatio, 0, 1);
    const base = 68 + arousal * 22 + (state === 'fear' ? 10 : state === 'anger' ? 8 : 0);
    const bpm = clamp(base + (Math.random() - 0.5) * 8, 50, 130);
    const conf = clamp(0.55 + validRatio * 0.3 + (Math.random() - 0.5) * 0.2, 0.2, 0.98);
    const snr = 2 + conf * 8 + Math.random() * 2;

    // Settle for the first two windows, then follow with a slew limit of
    // ~1.5 bpm/s (the heart_rate_max_slew_bpm_per_s default).
    hrSeeded += 1;
    let slewClamped = false;
    if (hrSeeded > 2) {
      if (hrTracked == null) {
        hrTracked = bpm;
      } else {
        const maxMove = 1.5 * (stepMs / 1000);
        const delta = bpm - hrTracked;
        slewClamped = Math.abs(delta) > maxMove;
        hrTracked += slewClamped ? Math.sign(delta) * maxMove : delta;
      }
    }

    return {
      duration_ms: stepMs,
      total_frames: 20,
      valid_frames: Math.floor(20 * validRatio),
      valid_frame_ratio: Number(validRatio.toFixed(3)),
      bpm_mean: Number(bpm.toFixed(1)),
      bpm_median: Number((bpm + (Math.random() - 0.5) * 2).toFixed(1)),
      bpm_robust: Number((bpm + (Math.random() - 0.5) * 1.5).toFixed(1)),
      bpm_tracked: hrTracked == null ? null : Number(hrTracked.toFixed(1)),
      slew_clamped: slewClamped,
      anomaly: {
        folded: 0,
        dropped: 0,
        kept: 20,
        total: 20,
        corrected_fraction: Number((Math.random() * 0.06).toFixed(3)),
      },
      bpm_std: Number((1.5 + Math.random() * 3).toFixed(2)),
      bpm_last: Number((bpm + (Math.random() - 0.5) * 3).toFixed(1)),
      snr_mean: Number(snr.toFixed(2)),
      confidence_mean: Number(conf.toFixed(3)),
      analysis_window_seconds: 10,
      distinct_estimates: 3 + Math.floor(Math.random() * 4),
      method: 'pos',
      model_version: 'rppg-demo',
    };
  }

  // Respiration block — mirrors RespirationAggregator.flush(). Keep the demo
  // close to a steady resting baseline instead of fabricating an emotion-rate
  // relationship that can be mistaken for sensor behaviour or a real finding.
  function makeRespiration(_state, _arousal, missingRatio, stepMs) {
    const validRatio = clamp(1 - missingRatio, 0, 1);
    const brpm = 12.6 + (Math.random() - 0.5);
    const conf = clamp(0.45 + validRatio * 0.3 + (Math.random() - 0.5) * 0.15, 0.2, 0.95);
    return {
      duration_ms: stepMs,
      total_frames: 20,
      valid_frames: Math.floor(20 * validRatio),
      valid_frame_ratio: Number(validRatio.toFixed(3)),
      brpm_mean: Number(brpm.toFixed(1)),
      brpm_median: Number((brpm + (Math.random() - 0.5) * 0.6).toFixed(1)),
      brpm_last: Number((brpm + (Math.random() - 0.5) * 0.8).toFixed(1)),
      brpm_std: Number((0.4 + Math.random() * 0.9).toFixed(2)),
      confidence_mean: Number(conf.toFixed(3)),
      sample_rate_hz: Number((16 + (Math.random() - 0.5) * 2).toFixed(1)),
      max_sample_gap_ms: Math.round(75 + Math.random() * 45),
      sampling_adequate: true,
      rgb_corroboration_available_ratio: Number((0.75 + Math.random() * 0.23).toFixed(3)),
      rgb_corroboration_agreement_ratio: Number((0.78 + Math.random() * 0.2).toFixed(3)),
      rgb_corroboration_required: false,
      snr_mean: Number((2 + conf * 5).toFixed(2)),
      // Long by physics — the estimator integrates ~45s (see docs/RESPIRATION.md).
      analysis_window_seconds: 45,
      distinct_estimates: 1 + Math.floor(Math.random() * 2),
      method: 'green-lowband',
      model_version: 'respiration-demo',
    };
  }

  // Illumination block — mirrors IlluminationAggregator.flush(). Drifts through
  // a dim patch and a flicker patch so the demo exercises every assessment,
  // not just 'good'; otherwise the tile looks like a constant.
  function makeIllumination(idx, stepMs) {
    const dim = idx > 8 && idx < 13;
    const flicker = idx > 20 && idx < 24;
    const mean = dim ? 0.17 + Math.random() * 0.05 : 0.42 + Math.sin(idx * 0.4) * 0.06;
    const delta = flicker ? 0.05 + Math.random() * 0.05 : Math.random() * 0.006;
    const clippedLow = dim ? 0.12 + Math.random() * 0.08 : Math.random() * 0.01;
    const stability = clamp(1 - delta / 0.08, 0, 1);
    const quality = clamp((dim ? 0.55 : 1) * (1 - clippedLow * 1.5), 0, 1);
    const assessment = stability < 0.6 ? 'unstable' : mean < 0.25 ? 'dim' : mean > 0.75 ? 'bright' : 'good';
    return {
      duration_ms: stepMs,
      total_frames: 20,
      valid_frames: 20,
      valid_frame_ratio: 1,
      mean_luma: Number(mean.toFixed(3)),
      luma_std: Number((0.1 + Math.random() * 0.05).toFixed(3)),
      luma_temporal_std: Number((delta * 0.8).toFixed(4)),
      clipped_low: Number(clippedLow.toFixed(3)),
      clipped_high: Number((Math.random() * 0.01).toFixed(3)),
      stability: Number(stability.toFixed(3)),
      quality_mean: Number(quality.toFixed(3)),
      quality_min: Number(clamp(quality - Math.random() * 0.12, 0, 1).toFixed(3)),
      assessment,
      model_version: 'illumination-demo',
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
        facial: makeFacial(state, missing, stepMs),
        posture: makePosture(state, missing, stepMs, i),
        heart_rate: makeHeartRate(state, arousal, missing, stepMs),
        respiration: makeRespiration(state, arousal, missing, stepMs),
        illumination: makeIllumination(i, stepMs),
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
