import { LEAD_NAMES } from './constants.js';
import { create_seeded_random, random_normal } from './random.js';
import { INDEPENDENT_LEADS, validate_render_spec } from './presets.js';

const TAU = 2 * Math.PI;

/** Gaussian waveform primitive. */
export function gaussian(time_ms, amplitude_mv, center_ms, sigma_ms) {
  if (![time_ms, amplitude_mv, center_ms, sigma_ms].every(Number.isFinite) || sigma_ms <= 0) {
    throw new TypeError('gaussian(): arguments must be finite and sigma_ms must be positive');
  }
  const distance = (time_ms - center_ms) / sigma_ms;
  return amplitude_mv * Math.exp(-(distance * distance) / 2);
}

/** Smooth finite plateau used for PR and ST offsets. */
export function smooth_plateau(time_ms, start_ms, end_ms, edge_ms = 8) {
  if (![time_ms, start_ms, end_ms, edge_ms].every(Number.isFinite) || end_ms <= start_ms || edge_ms <= 0) {
    throw new TypeError('smooth_plateau(): expected finite ordered bounds and a positive edge');
  }
  const enter = 1 / (1 + Math.exp(-(time_ms - start_ms) / edge_ms));
  const leave = 1 / (1 + Math.exp((time_ms - end_ms) / edge_ms));
  return enter * leave;
}

/** Categorize an adult frontal QRS axis for the structured interpretation. */
export function classify_axis(axis_degrees) {
  if (!Number.isFinite(axis_degrees) || axis_degrees < -180 || axis_degrees > 180) {
    throw new RangeError('classify_axis(axis_degrees): axis must be between -180 and 180');
  }
  if (axis_degrees >= -30 && axis_degrees <= 90) return 'normal';
  if (axis_degrees < -30 && axis_degrees >= -90) return 'left';
  if (axis_degrees > 90 && axis_degrees <= 180) return 'right';
  return 'extreme';
}

/** Fridericia-corrected QT in milliseconds. */
export function fridericia_qtc(qt_ms, heart_rate_bpm) {
  if (!Number.isFinite(qt_ms) || qt_ms <= 0 || !Number.isFinite(heart_rate_bpm)
      || heart_rate_bpm <= 0) {
    throw new TypeError('fridericia_qtc(): QT and heart rate must be positive finite numbers');
  }
  const rr_seconds = 60 / heart_rate_bpm;
  return qt_ms / Math.cbrt(rr_seconds);
}

/**
 * Create the ventricular beat schedule shared by every channel.
 *
 * @param {object} spec validated render specification
 * @returns {Array<{time_seconds:number,index:number,is_pvc:boolean}>}
 */
export function build_beat_schedule(spec) {
  validate_render_spec(spec);
  const { duration_seconds } = spec.acquisition;
  const { ventricular_rate_bpm, rr_jitter_fraction, pvc_every_n_beats, mode } = spec.rhythm;
  const nominal_rr = 60 / ventricular_rate_bpm;
  const maximum_beats = Math.ceil(duration_seconds / Math.max(0.2, nominal_rr * 0.55)) + 4;
  const random = create_seeded_random(spec.seed ^ 0x4b1d5a77);
  const initial_time = mode === 'complete_heart_block' ? 0.45 : 0.36;

  return Array.from({ length: maximum_beats }).reduce((beats, _unused, index) => {
    if (index === 0) return [{ time_seconds: initial_time, index, is_pvc: false }];
    const previous = beats.at(-1);
    if (!previous || previous.time_seconds > duration_seconds + nominal_rr) return beats;
    const is_pvc = Number.isInteger(pvc_every_n_beats) && pvc_every_n_beats > 1
      && index % pvc_every_n_beats === pvc_every_n_beats - 1;
    const follows_pvc = previous.is_pvc;
    const jitter = mode === 'atrial_fibrillation'
      ? (random() * 2 - 1) * rr_jitter_fraction
      : random_normal(random) * rr_jitter_fraction * 0.35;
    const interval_scale = is_pvc ? 0.66 : follows_pvc ? 1.30 : 1;
    const next_time = previous.time_seconds + nominal_rr * interval_scale * (1 + jitter);
    return next_time <= duration_seconds + nominal_rr
      ? [...beats, { time_seconds: next_time, index, is_pvc }]
      : beats;
  }, []);
}

/** Create the independent atrial schedule used by complete heart block. */
export function build_atrial_schedule(spec) {
  validate_render_spec(spec);
  const { duration_seconds } = spec.acquisition;
  const { atrial_rate_bpm, mode } = spec.rhythm;
  if (mode !== 'complete_heart_block' || atrial_rate_bpm <= 0) return [];
  const rr = 60 / atrial_rate_bpm;
  const count = Math.ceil((duration_seconds + rr) / rr);
  return Array.from({ length: count }, (_unused, index) => 0.12 + index * rr)
    .filter((time_seconds) => time_seconds <= duration_seconds + rr);
}

const time_relative_ms = (time_seconds, center_seconds) => (time_seconds - center_seconds) * 1000;

const atrial_component = (relative_ms, channel, spec) => {
  const { p_duration, pr, qrs } = spec.intervals_ms;
  const qrs_onset_ms = -qrs * 0.36;
  const p_center_ms = qrs_onset_ms - pr + p_duration / 2;
  return gaussian(relative_ms, channel.p, p_center_ms, Math.max(12, p_duration / 4.8));
};

const ventricular_component = (relative_ms, channel, spec, is_pvc) => {
  const qrs_ms = is_pvc ? Math.max(152, spec.intervals_ms.qrs) : spec.intervals_ms.qrs;
  const qt_ms = is_pvc ? Math.max(420, spec.intervals_ms.qt) : spec.intervals_ms.qt;
  const qrs_onset_ms = -qrs_ms * 0.36;
  const q_center_ms = qrs_onset_ms + qrs_ms * 0.20;
  const r_center_ms = 0;
  const s_center_ms = qrs_onset_ms + qrs_ms * 0.72;
  const r_prime_center_ms = qrs_onset_ms + qrs_ms * 0.86;
  const qrs_end_ms = qrs_onset_ms + qrs_ms;
  const t_sigma_ms = spec.morphology.t_width_ms / 2.35;
  const t_end_ms = qrs_onset_ms + qt_ms;
  const t_center_ms = t_end_ms - 2.15 * t_sigma_ms;
  const st_end_ms = Math.max(qrs_end_ms + 18, t_center_ms - 1.45 * t_sigma_ms);
  const ventricular_scale = spec.morphology.ventricular_scale;
  const pvc_polarity = is_pvc ? -1 : 1;
  const q_amplitude = is_pvc ? channel.q * -1.7 : channel.q;
  const r_amplitude = is_pvc ? Math.max(0.55, Math.abs(channel.r)) * pvc_polarity : channel.r;
  const s_amplitude = is_pvc ? -Math.max(0.45, Math.abs(channel.s) + 0.25) * pvc_polarity : channel.s;
  const t_amplitude = is_pvc ? -Math.sign(r_amplitude || 1) * Math.max(0.24, Math.abs(channel.t)) : channel.t;

  const qrs = gaussian(relative_ms, q_amplitude * ventricular_scale, q_center_ms, Math.max(5, qrs_ms * 0.075))
    + gaussian(relative_ms, r_amplitude * ventricular_scale, r_center_ms, Math.max(6, qrs_ms * 0.085))
    + gaussian(relative_ms, s_amplitude * ventricular_scale, s_center_ms, Math.max(7, qrs_ms * 0.10))
    + gaussian(relative_ms, channel.r_prime * ventricular_scale, r_prime_center_ms, Math.max(7, qrs_ms * 0.105));
  const delta = spec.morphology.delta_wave_mv === 0 ? 0
    : gaussian(relative_ms, spec.morphology.delta_wave_mv, qrs_onset_ms + 16, 18);
  const st = channel.st === 0 ? 0
    : channel.st * smooth_plateau(relative_ms, qrs_end_ms - 8, st_end_ms, 9);
  const twave = gaussian(relative_ms, t_amplitude, t_center_ms, t_sigma_ms);
  const uwave = channel.u === 0 ? 0
    : gaussian(relative_ms, channel.u, t_end_ms + 80, 34);
  return qrs + delta + st + twave + uwave;
};

const pr_segment_component = (relative_ms, channel, spec) => {
  if (channel.pr_segment === 0) return 0;
  const { p_duration, pr, qrs } = spec.intervals_ms;
  const qrs_onset_ms = -qrs * 0.36;
  const p_end_ms = qrs_onset_ms - pr + p_duration;
  return channel.pr_segment * smooth_plateau(relative_ms, p_end_ms, qrs_onset_ms - 5, 7);
};

const fibrillatory_component = (time_seconds, channel, lead_index, spec) => {
  const phase = spec.seed * 0.000013 + lead_index * 0.37;
  const scale = Math.max(0.025, Math.abs(channel.p) * 0.42);
  return scale * (
    Math.sin(TAU * 6.2 * time_seconds + phase)
    + 0.55 * Math.sin(TAU * 8.1 * time_seconds + phase * 1.9)
  );
};

const flutter_component = (time_seconds, channel, lead_index, spec) => {
  const frequency = spec.rhythm.atrial_rate_bpm / 60;
  const phase = (time_seconds * frequency + lead_index * 0.043) % 1;
  const saw = 2 * phase - 1;
  const inferior_scale = lead_index === 1 ? -0.11 : -Math.max(0.045, Math.abs(channel.p) * 0.55);
  return saw * inferior_scale;
};

const fibrillation_component = (time_seconds, lead_index, spec) => {
  const phase = spec.seed * 0.000031 + lead_index * 0.61;
  return 0.36 * Math.sin(TAU * 4.9 * time_seconds + phase)
    + 0.22 * Math.sin(TAU * 6.7 * time_seconds + phase * 1.7)
    + 0.12 * Math.sin(TAU * 9.3 * time_seconds + phase * 0.7);
};

const artifact_series = (spec, lead_index, sample_count) => {
  const random = create_seeded_random((spec.seed + lead_index * 0x9e3779b1) | 0);
  return Array.from({ length: sample_count }, (_unused, index) => {
    const time_seconds = index / spec.acquisition.sample_rate_hz;
    const wander = spec.artifact.baseline_wander_mv
      * Math.sin(TAU * 0.22 * time_seconds + lead_index * 0.13);
    const muscle = spec.artifact.muscle_noise_mv * random_normal(random);
    const mains = spec.artifact.mains_noise_mv
      * Math.sin(TAU * spec.artifact.mains_frequency_hz * time_seconds);
    return wander + muscle + mains;
  });
};

/**
 * Generate one independent channel as integer microvolts.
 *
 * @param {string} lead independent lead name
 * @param {object} spec validated render specification
 * @param {Array<object>} beat_schedule shared ventricular schedule
 * @param {Array<number>} atrial_schedule independent P-wave schedule
 * @returns {Int32Array}
 */
export function generate_independent_lead(lead, spec, beat_schedule, atrial_schedule = []) {
  validate_render_spec(spec);
  if (!INDEPENDENT_LEADS.includes(lead)) throw new RangeError(`Cannot independently generate lead '${lead}'`);
  if (!Array.isArray(beat_schedule) || !Array.isArray(atrial_schedule)) {
    throw new TypeError('Beat schedules must be arrays');
  }
  const channel = spec.morphology.channels[lead];
  const lead_index = INDEPENDENT_LEADS.indexOf(lead);
  const sample_count = Math.round(spec.acquisition.duration_seconds * spec.acquisition.sample_rate_hz);
  const artifacts = artifact_series(spec, lead_index, sample_count);
  const mode = spec.rhythm.mode;

  return Int32Array.from(Array.from({ length: sample_count }, (_unused, sample_index) => {
    const time_seconds = sample_index / spec.acquisition.sample_rate_hz;
    if (mode === 'ventricular_fibrillation') {
      return Math.round((fibrillation_component(time_seconds, lead_index, spec) + artifacts[sample_index]) * 1000);
    }
    if (mode === 'asystole') return Math.round(artifacts[sample_index] * 320);

    const ventricular = beat_schedule.reduce((sum, beat) => {
      const relative_ms = time_relative_ms(time_seconds, beat.time_seconds);
      const in_window = relative_ms > -500 && relative_ms < 850;
      return in_window ? sum + ventricular_component(relative_ms, channel, spec, beat.is_pvc) : sum;
    }, 0);
    const coupled_atrial = (mode === 'sinus' || mode === 'svt')
      ? beat_schedule.reduce((sum, beat) => {
        const relative_ms = time_relative_ms(time_seconds, beat.time_seconds);
        return relative_ms > -500 && relative_ms < 80
          ? sum + atrial_component(relative_ms, channel, spec) + pr_segment_component(relative_ms, channel, spec)
          : sum;
      }, 0)
      : 0;
    const independent_atrial = mode === 'complete_heart_block'
      ? atrial_schedule.reduce((sum, center_seconds) => {
        const relative_ms = time_relative_ms(time_seconds, center_seconds);
        return Math.abs(relative_ms) < 180
          ? sum + gaussian(relative_ms, channel.p, 0, Math.max(12, spec.intervals_ms.p_duration / 4.8))
          : sum;
      }, 0)
      : 0;
    const atrial_activity = mode === 'atrial_fibrillation'
      ? fibrillatory_component(time_seconds, channel, lead_index, spec)
      : mode === 'atrial_flutter'
        ? flutter_component(time_seconds, channel, lead_index, spec)
        : coupled_atrial + independent_atrial;
    return Math.round((ventricular + atrial_activity + artifacts[sample_index]) * 1000);
  }));
}

/** Derive the four dependent frontal leads from integer I and II samples. */
export function derive_limb_leads(lead_i, lead_ii) {
  if (!(lead_i instanceof Int32Array) || !(lead_ii instanceof Int32Array) || lead_i.length !== lead_ii.length) {
    throw new TypeError('derive_limb_leads(): I and II must be equal-length Int32Array values');
  }
  const indexes = Array.from({ length: lead_i.length }, (_unused, index) => index);
  return {
    III: Int32Array.from(indexes, (index) => lead_ii[index] - lead_i[index]),
    aVR: Int32Array.from(indexes, (index) => Math.round(-(lead_i[index] + lead_ii[index]) / 2)),
    aVL: Int32Array.from(indexes, (index) => Math.round(lead_i[index] - lead_ii[index] / 2)),
    aVF: Int32Array.from(indexes, (index) => Math.round(lead_ii[index] - lead_i[index] / 2)),
  };
}

/**
 * Generate a complete deterministic 12-lead ECG.
 *
 * @param {object} render_spec low-level render specification
 * @returns {object} integer-microvolt signals plus acquisition metadata
 */
export function generate_twelve_lead_ecg(render_spec) {
  const spec = validate_render_spec(render_spec);
  const beat_schedule = build_beat_schedule(spec);
  const atrial_schedule = build_atrial_schedule(spec);
  const independent = Object.fromEntries(INDEPENDENT_LEADS.map((lead) => [
    lead,
    generate_independent_lead(lead, spec, beat_schedule, atrial_schedule),
  ]));
  const derived = derive_limb_leads(independent.I, independent.II);
  const leads = Object.fromEntries(LEAD_NAMES.map((lead) => [lead, independent[lead] ?? derived[lead]]));

  return {
    engine_version: spec.engine_version,
    units: 'microvolts',
    sample_rate_hz: spec.acquisition.sample_rate_hz,
    duration_seconds: spec.acquisition.duration_seconds,
    sample_count: leads.I.length,
    paper_speed_mm_per_second: spec.acquisition.paper_speed_mm_per_second,
    gain_mm_per_mv: spec.acquisition.gain_mm_per_mv,
    rhythm_lead: spec.acquisition.rhythm_lead,
    lead_names: [...LEAD_NAMES],
    leads,
    beat_schedule,
    measurements: {
      rate_bpm: spec.rhythm.ventricular_rate_bpm,
      atrial_rate_bpm: spec.rhythm.atrial_rate_bpm,
      rhythm: spec.rhythm.mode,
      axis_degrees: spec.morphology.axis_degrees,
      axis_category: classify_axis(spec.morphology.axis_degrees),
      pr_ms: spec.rhythm.mode === 'complete_heart_block' ? null : spec.intervals_ms.pr,
      qrs_ms: spec.intervals_ms.qrs,
      qt_ms: spec.intervals_ms.qt,
      qtc_fridericia_ms: Math.round(fridericia_qtc(spec.intervals_ms.qt, spec.rhythm.ventricular_rate_bpm)),
    },
  };
}

/** Inspect a recording without serialising the full sample arrays. */
export function summarize_recording(recording) {
  if (!recording || typeof recording !== 'object' || !recording.leads) {
    throw new TypeError('summarize_recording(recording): expected a generated recording');
  }
  return {
    class: recording.constructor?.name ?? 'Object',
    lead_names: Object.keys(recording.leads),
    dimensions: [Object.keys(recording.leads).length, recording.sample_count],
    sample_rate_hz: recording.sample_rate_hz,
    duration_seconds: recording.duration_seconds,
    first_samples_uv: Object.fromEntries(Object.entries(recording.leads)
      .map(([lead, samples]) => [lead, Array.from(samples.slice(0, 5))])),
    finite: Object.values(recording.leads).every((samples) =>
      Array.from(samples).every(Number.isFinite)),
    measurements: { ...recording.measurements },
  };
}
