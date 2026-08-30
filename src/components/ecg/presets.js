import { DEFAULT_RECORDING, LEAD_NAMES, RHYTHM_IDS } from './constants.js';

export const ENGINE_VERSION = '1.0.0';
export const INDEPENDENT_LEADS = Object.freeze(['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']);

const PRECORDIAL_NORMAL = Object.freeze({
  V1: { p: 0.05, q: -0.03, r: 0.22, s: -0.80, st: 0, t: -0.08, u: 0, r_prime: 0, pr_segment: 0 },
  V2: { p: 0.08, q: -0.04, r: 0.45, s: -1.00, st: 0, t: 0.15, u: 0, r_prime: 0, pr_segment: 0 },
  V3: { p: 0.10, q: -0.06, r: 0.85, s: -0.75, st: 0, t: 0.28, u: 0, r_prime: 0, pr_segment: 0 },
  V4: { p: 0.12, q: -0.08, r: 1.25, s: -0.35, st: 0, t: 0.38, u: 0, r_prime: 0, pr_segment: 0 },
  V5: { p: 0.10, q: -0.08, r: 1.35, s: -0.20, st: 0, t: 0.40, u: 0, r_prime: 0, pr_segment: 0 },
  V6: { p: 0.08, q: -0.06, r: 1.05, s: -0.12, st: 0, t: 0.32, u: 0, r_prime: 0, pr_segment: 0 },
});

const PRESET_ENTRIES = [
  ['normal_sinus', 'Normal sinus rhythm', 'foundation', 'rhythm'],
  ['atrial_fibrillation', 'Atrial fibrillation', 'foundation', 'rhythm'],
  ['atrial_flutter', 'Atrial flutter with 2:1 conduction', 'intermediate', 'rhythm'],
  ['frequent_pvcs', 'Sinus rhythm with frequent PVCs', 'intermediate', 'rhythm'],
  ['first_degree_av_block', 'First-degree AV block', 'foundation', 'conduction'],
  ['complete_heart_block', 'Complete heart block', 'advanced', 'conduction'],
  ['right_bundle_branch_block', 'Right bundle branch block', 'intermediate', 'conduction'],
  ['left_bundle_branch_block', 'Left bundle branch block', 'intermediate', 'conduction'],
  ['anterior_injury_pattern', 'Anterior acute injury pattern', 'advanced', 'ischemia'],
  ['inferior_injury_pattern', 'Inferior acute injury pattern', 'advanced', 'ischemia'],
  ['acute_pericarditis_pattern', 'Acute pericarditis pattern', 'intermediate', 'inflammation'],
  ['hyperkalemia_pattern', 'Hyperkalemia pattern', 'advanced', 'electrolyte'],
];

/** Curated authoring choices. Preset identity belongs in the protected rubric. */
export const PRESET_CATALOG = Object.freeze(PRESET_ENTRIES.map(([id, label, difficulty, category]) =>
  Object.freeze({ id, label, difficulty, category })));

export const PRESET_IDS = Object.freeze(PRESET_CATALOG.map(({ id }) => id));

const degrees_to_radians = (degrees) => degrees * Math.PI / 180;
const project_vector = (magnitude, vector_degrees, lead_degrees) =>
  magnitude * Math.cos(degrees_to_radians(vector_degrees - lead_degrees));

/**
 * Build the two independently sampled frontal channels. The remaining four
 * limb leads are derived sample-by-sample by the waveform engine.
 *
 * @param {number} axis_degrees mean frontal QRS axis
 * @returns {{I: object, II: object}}
 */
export function create_frontal_channels(axis_degrees) {
  if (!Number.isFinite(axis_degrees) || axis_degrees < -180 || axis_degrees > 180) {
    throw new RangeError('create_frontal_channels(axis_degrees): axis must be between -180 and 180');
  }
  const lead = (lead_degrees) => ({
    p: project_vector(0.16, 55, lead_degrees),
    q: project_vector(-0.09, axis_degrees, lead_degrees),
    r: project_vector(1.10, axis_degrees, lead_degrees),
    s: project_vector(-0.22, axis_degrees, lead_degrees),
    st: 0,
    t: project_vector(0.34, 45, lead_degrees),
    u: 0,
    r_prime: 0,
    pr_segment: 0,
  });
  return { I: lead(0), II: lead(60) };
}

const clone_channels = (channels) => Object.fromEntries(
  Object.entries(channels).map(([lead, values]) => [lead, { ...values }]),
);

const update_channels = (channels, leads, updates) => {
  const lead_set = new Set(leads);
  return Object.fromEntries(Object.entries(channels).map(([lead, values]) => [
    lead,
    lead_set.has(lead)
      ? { ...values, ...(typeof updates === 'function' ? updates(values, lead) : updates) }
      : { ...values },
  ]));
};

const scale_channels = (channels, field, multiplier) => Object.fromEntries(
  Object.entries(channels).map(([lead, values]) => [lead, { ...values, [field]: values[field] * multiplier }]),
);

/**
 * Create a neutral low-level render specification. It names waveform
 * coefficients and acquisition settings, never the clinical preset.
 *
 * @param {object} overrides safe authoring overrides
 * @returns {object}
 */
export function create_base_render_spec(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('create_base_render_spec(overrides): overrides must be an object');
  }
  const heart_rate_bpm = Number(overrides.heart_rate_bpm ?? 72);
  const axis_degrees = Number(overrides.axis_degrees ?? 60);
  const seed = Number(overrides.seed ?? DEFAULT_RECORDING.seed);
  if (!Number.isFinite(heart_rate_bpm) || heart_rate_bpm < 20 || heart_rate_bpm > 240) {
    throw new RangeError('heart_rate_bpm must be between 20 and 240');
  }
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');

  return {
    engine_version: ENGINE_VERSION,
    acquisition: {
      duration_seconds: DEFAULT_RECORDING.duration_seconds,
      sample_rate_hz: DEFAULT_RECORDING.sample_rate_hz,
      paper_speed_mm_per_second: DEFAULT_RECORDING.paper_speed_mm_per_second,
      gain_mm_per_mv: DEFAULT_RECORDING.gain_mm_per_mv,
      rhythm_lead: DEFAULT_RECORDING.rhythm_lead,
      placement: 'standard_resting_12_lead',
    },
    seed,
    rhythm: {
      mode: 'sinus',
      ventricular_rate_bpm: heart_rate_bpm,
      atrial_rate_bpm: heart_rate_bpm,
      rr_jitter_fraction: 0.015,
      pvc_every_n_beats: null,
    },
    intervals_ms: {
      p_duration: 90,
      pr: Number(overrides.pr_ms ?? 160),
      qrs: Number(overrides.qrs_ms ?? 90),
      qt: Number(overrides.qt_ms ?? 400),
    },
    morphology: {
      axis_degrees,
      t_width_ms: 92,
      delta_wave_mv: 0,
      ventricular_scale: 1,
      channels: {
        ...create_frontal_channels(axis_degrees),
        ...clone_channels(PRECORDIAL_NORMAL),
      },
    },
    artifact: {
      baseline_wander_mv: Number(overrides.baseline_wander_mv ?? 0.012),
      muscle_noise_mv: Number(overrides.muscle_noise_mv ?? 0.003),
      mains_noise_mv: 0,
      mains_frequency_hz: 50,
    },
  };
}

const PRESET_TRANSFORMS = {
  normal_sinus: (spec) => spec,
  atrial_fibrillation: (spec) => ({
    ...spec,
    rhythm: { ...spec.rhythm, mode: 'atrial_fibrillation', ventricular_rate_bpm: 118, atrial_rate_bpm: 0, rr_jitter_fraction: 0.28 },
    morphology: { ...spec.morphology, channels: scale_channels(spec.morphology.channels, 'p', 0) },
  }),
  atrial_flutter: (spec) => ({
    ...spec,
    rhythm: { ...spec.rhythm, mode: 'atrial_flutter', ventricular_rate_bpm: 150, atrial_rate_bpm: 300, rr_jitter_fraction: 0 },
    morphology: { ...spec.morphology, channels: scale_channels(spec.morphology.channels, 'p', 0) },
  }),
  frequent_pvcs: (spec) => ({
    ...spec,
    rhythm: { ...spec.rhythm, pvc_every_n_beats: 4, rr_jitter_fraction: 0.01 },
  }),
  first_degree_av_block: (spec) => ({
    ...spec,
    intervals_ms: { ...spec.intervals_ms, pr: 240 },
  }),
  complete_heart_block: (spec) => ({
    ...spec,
    rhythm: { ...spec.rhythm, mode: 'complete_heart_block', ventricular_rate_bpm: 38, atrial_rate_bpm: 92, rr_jitter_fraction: 0.01 },
    intervals_ms: { ...spec.intervals_ms, qrs: 132, pr: 160, qt: 470 },
  }),
  right_bundle_branch_block: (spec) => {
    let channels = update_channels(spec.morphology.channels, ['V1', 'V2'], (values, lead) => ({
      r: lead === 'V1' ? 0.38 : 0.52,
      s: lead === 'V1' ? -0.34 : -0.48,
      r_prime: lead === 'V1' ? 1.00 : 0.82,
      t: -Math.abs(values.t) - 0.10,
    }));
    channels = update_channels(channels, ['I', 'II', 'V5', 'V6'], (values, lead) => ({
      s: lead === 'V5' || lead === 'V6' ? -0.62 : values.s * 1.7,
    }));
    return { ...spec, intervals_ms: { ...spec.intervals_ms, qrs: 132 }, morphology: { ...spec.morphology, channels } };
  },
  left_bundle_branch_block: (spec) => {
    let channels = update_channels(spec.morphology.channels, ['I', 'II', 'V5', 'V6'], (values, lead) => ({
      q: 0,
      r: lead === 'V5' ? 1.62 : lead === 'V6' ? 1.42 : Math.max(0.85, values.r * 1.25),
      s: Math.min(0, values.s * 0.25),
      r_prime: lead === 'V5' || lead === 'V6' ? 0.52 : 0.28,
      t: -Math.abs(values.t),
    }));
    channels = update_channels(channels, ['V1', 'V2', 'V3'], (values) => ({
      r: Math.max(0.05, values.r * 0.3), s: -Math.max(0.9, Math.abs(values.s) * 1.25), t: Math.abs(values.t) + 0.12,
    }));
    return { ...spec, intervals_ms: { ...spec.intervals_ms, qrs: 154 }, morphology: { ...spec.morphology, channels } };
  },
  anterior_injury_pattern: (spec) => {
    let channels = update_channels(spec.morphology.channels, ['I', 'II'], (values, lead) => ({
      st: lead === 'I' ? 0.10 : 0.05,
      t: values.t * 1.15,
    }));
    channels = update_channels(channels, ['V1', 'V2', 'V3', 'V4'], (values, lead) => ({
      q: lead === 'V2' || lead === 'V3' ? -0.22 : values.q,
      r: lead === 'V1' || lead === 'V2' ? values.r * 0.55 : values.r,
      st: { V1: 0.18, V2: 0.30, V3: 0.34, V4: 0.24 }[lead],
      t: Math.abs(values.t) * 1.25,
    }));
    channels = update_channels(channels, ['V5', 'V6'], (values) => ({ ...values, st: 0.08 }));
    return { ...spec, rhythm: { ...spec.rhythm, ventricular_rate_bpm: 92, atrial_rate_bpm: 92 }, morphology: { ...spec.morphology, channels } };
  },
  inferior_injury_pattern: (spec) => {
    let channels = update_channels(spec.morphology.channels, ['I', 'II'], (values, lead) => ({
      st: lead === 'I' ? -0.04 : 0.20,
      t: lead === 'I' ? values.t * 0.5 : Math.abs(values.t) * 1.25,
    }));
    channels = update_channels(channels, ['V1', 'V2'], (values) => ({ ...values, st: -0.08 }));
    channels = update_channels(channels, ['V4', 'V5', 'V6'], (values) => ({ ...values, st: -0.04 }));
    return { ...spec, rhythm: { ...spec.rhythm, ventricular_rate_bpm: 86, atrial_rate_bpm: 86 }, morphology: { ...spec.morphology, channels } };
  },
  acute_pericarditis_pattern: (spec) => {
    let channels = update_channels(spec.morphology.channels, ['I', 'II'], (values, lead) => ({
      st: lead === 'I' ? 0.13 : 0.17,
      pr_segment: lead === 'I' ? -0.05 : -0.07,
    }));
    channels = update_channels(channels, ['V2', 'V3', 'V4', 'V5', 'V6'], (values, lead) => ({
      ...values,
      st: { V2: 0.12, V3: 0.16, V4: 0.18, V5: 0.16, V6: 0.12 }[lead],
      pr_segment: -0.05,
    }));
    return { ...spec, rhythm: { ...spec.rhythm, ventricular_rate_bpm: 96, atrial_rate_bpm: 96 }, morphology: { ...spec.morphology, channels } };
  },
  hyperkalemia_pattern: (spec) => {
    let channels = scale_channels(spec.morphology.channels, 'p', 0.24);
    channels = scale_channels(channels, 't', 2.15);
    return {
      ...spec,
      rhythm: { ...spec.rhythm, ventricular_rate_bpm: 62, atrial_rate_bpm: 62 },
      intervals_ms: { ...spec.intervals_ms, pr: 210, qrs: 148, qt: 330 },
      morphology: { ...spec.morphology, t_width_ms: 54, ventricular_scale: 1.12, channels },
    };
  },
};

/**
 * Compile an educator-facing clinical preset into a neutral waveform recipe.
 *
 * @param {string} preset_id one of PRESET_IDS
 * @param {object} overrides validated acquisition/morphology overrides
 * @returns {object} low-level render specification
 */
export function compile_preset(preset_id, overrides = {}) {
  if (!PRESET_IDS.includes(preset_id)) {
    throw new RangeError(`compile_preset(): unknown preset '${preset_id}'`);
  }
  const base = create_base_render_spec(overrides);
  const compiled = PRESET_TRANSFORMS[preset_id](base);
  return validate_render_spec(compiled);
}

/**
 * Validate and return a render specification.
 *
 * @param {object} spec render specification
 * @returns {object}
 */
export function validate_render_spec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('validate_render_spec(spec): spec must be an object');
  }
  if (spec.engine_version !== ENGINE_VERSION) throw new RangeError(`Unsupported engine_version '${spec.engine_version}'`);
  const { acquisition, rhythm, intervals_ms, morphology, artifact } = spec;
  if (!acquisition || !rhythm || !intervals_ms || !morphology || !artifact) {
    throw new TypeError('Render spec is missing acquisition, rhythm, intervals_ms, morphology, or artifact');
  }
  if (!Number.isInteger(acquisition.sample_rate_hz) || acquisition.sample_rate_hz < 100 || acquisition.sample_rate_hz > 1000) {
    throw new RangeError('sample_rate_hz must be an integer between 100 and 1000');
  }
  if (!Number.isFinite(acquisition.duration_seconds) || acquisition.duration_seconds < 2.5 || acquisition.duration_seconds > 30) {
    throw new RangeError('duration_seconds must be between 2.5 and 30');
  }
  if (acquisition.paper_speed_mm_per_second !== 25 || acquisition.gain_mm_per_mv !== 10) {
    throw new RangeError('v1 requires 25 mm/s paper speed and 10 mm/mV gain');
  }
  if (!LEAD_NAMES.includes(acquisition.rhythm_lead)) throw new RangeError('rhythm_lead must be a standard lead');
  if (!RHYTHM_IDS.includes(rhythm.mode)) throw new RangeError(`Unsupported rhythm mode '${rhythm.mode}'`);
  if (!Number.isFinite(rhythm.ventricular_rate_bpm) || rhythm.ventricular_rate_bpm < 20 || rhythm.ventricular_rate_bpm > 240) {
    throw new RangeError('ventricular_rate_bpm must be between 20 and 240');
  }
  if (!Number.isFinite(rhythm.atrial_rate_bpm) || rhythm.atrial_rate_bpm < 0 || rhythm.atrial_rate_bpm > 400) {
    throw new RangeError('atrial_rate_bpm must be between 0 and 400');
  }
  if (!Number.isFinite(intervals_ms.pr) || intervals_ms.pr < 80 || intervals_ms.pr > 400) throw new RangeError('PR interval must be between 80 and 400 ms');
  if (!Number.isFinite(intervals_ms.qrs) || intervals_ms.qrs < 50 || intervals_ms.qrs > 240) throw new RangeError('QRS duration must be between 50 and 240 ms');
  if (!Number.isFinite(intervals_ms.qt) || intervals_ms.qt < 200 || intervals_ms.qt > 700) throw new RangeError('QT interval must be between 200 and 700 ms');
  const channel_names = Object.keys(morphology.channels ?? {});
  if (channel_names.length !== INDEPENDENT_LEADS.length || INDEPENDENT_LEADS.some((lead) => !channel_names.includes(lead))) {
    throw new TypeError(`morphology.channels must contain exactly ${INDEPENDENT_LEADS.join(', ')}`);
  }
  const values_are_finite = Object.values(morphology.channels).every((channel) =>
    ['p', 'q', 'r', 's', 'st', 't', 'u', 'r_prime', 'pr_segment'].every((field) => Number.isFinite(channel[field])));
  if (!values_are_finite) throw new TypeError('Every channel coefficient must be finite');
  return spec;
}

/** Return author-facing metadata for a preset. */
export function preset_metadata(preset_id) {
  const metadata = PRESET_CATALOG.find(({ id }) => id === preset_id);
  if (!metadata) throw new RangeError(`preset_metadata(): unknown preset '${preset_id}'`);
  return metadata;
}
