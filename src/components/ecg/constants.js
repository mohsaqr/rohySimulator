/** Standard 12-lead names in conventional display order. */
export const LEAD_NAMES = Object.freeze([
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF',
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6',
]);

/** Conventional 3 × 4 display followed by a full-width lead-II strip. */
export const STANDARD_LAYOUT = Object.freeze([
  Object.freeze(['I', 'aVR', 'V1', 'V4']),
  Object.freeze(['II', 'aVL', 'V2', 'V5']),
  Object.freeze(['III', 'aVF', 'V3', 'V6']),
]);

export const DEFAULT_RECORDING = Object.freeze({
  duration_seconds: 10,
  sample_rate_hz: 500,
  paper_speed_mm_per_second: 25,
  gain_mm_per_mv: 10,
  rhythm_lead: 'II',
  seed: 12031987,
});

export const RHYTHM_IDS = Object.freeze([
  'sinus',
  'atrial_fibrillation',
  'atrial_flutter',
  'complete_heart_block',
  'svt',
  'ventricular_tachycardia',
  'ventricular_fibrillation',
  'asystole',
]);

export const AXIS_CATEGORIES = Object.freeze([
  'normal', 'left', 'right', 'extreme', 'indeterminate',
]);

export const FINDING_CATALOG = Object.freeze([
  { id: 'sinus_rhythm', label: 'Sinus rhythm' },
  { id: 'sinus_bradycardia', label: 'Sinus bradycardia' },
  { id: 'sinus_tachycardia', label: 'Sinus tachycardia' },
  { id: 'atrial_fibrillation', label: 'Atrial fibrillation' },
  { id: 'atrial_flutter', label: 'Atrial flutter' },
  { id: 'supraventricular_tachycardia', label: 'Regular narrow-complex tachycardia' },
  { id: 'premature_ventricular_complexes', label: 'Premature ventricular complexes' },
  { id: 'ventricular_tachycardia', label: 'Ventricular tachycardia' },
  { id: 'st_elevation_anterior', label: 'Anterior ST elevation' },
  { id: 'st_elevation_inferior', label: 'Inferior ST elevation' },
  { id: 'st_elevation_lateral', label: 'Lateral ST elevation' },
  { id: 'st_depression', label: 'ST depression' },
  { id: 't_wave_inversion', label: 'T-wave inversion' },
  { id: 'pathological_q_waves', label: 'Pathological Q waves' },
  { id: 'diffuse_st_elevation', label: 'Diffuse ST elevation' },
  { id: 'pr_depression', label: 'PR depression' },
  { id: 'left_bundle_branch_block', label: 'Left bundle branch block' },
  { id: 'right_bundle_branch_block', label: 'Right bundle branch block' },
  { id: 'wide_qrs', label: 'Wide QRS complex' },
  { id: 'first_degree_av_block', label: 'First-degree AV block' },
  { id: 'pre_excitation', label: 'Ventricular pre-excitation' },
  { id: 'left_ventricular_hypertrophy', label: 'Left ventricular hypertrophy' },
  { id: 'strain_pattern', label: 'Lateral strain pattern' },
  { id: 'peaked_t_waves', label: 'Peaked T waves' },
  { id: 'prominent_u_waves', label: 'Prominent U waves' },
  { id: 'prolonged_qt', label: 'Prolonged QT interval' },
  { id: 'low_voltage', label: 'Low voltage' },
  { id: 'poor_r_wave_progression', label: 'Poor R-wave progression' },
]);

export const FINDING_IDS = Object.freeze(FINDING_CATALOG.map(({ id }) => id));

/**
 * Translation key per finding.
 *
 * The catalogue above is module-scope data: it cannot take a `t` prop, so its
 * `label` stays the English fallback and the CONSUMER translates at render time
 * from the stable id. `t(FINDING_KEYS[id], label)` would be invisible to a key
 * extractor — `t(variable)` cannot be read statically — so every key is written
 * out literally here instead. One entry per `FINDING_CATALOG` id, checked below.
 */
export const FINDING_KEYS = Object.freeze({
  sinus_rhythm: 'finding_sinus_rhythm',
  sinus_bradycardia: 'finding_sinus_bradycardia',
  sinus_tachycardia: 'finding_sinus_tachycardia',
  atrial_fibrillation: 'finding_atrial_fibrillation',
  atrial_flutter: 'finding_atrial_flutter',
  supraventricular_tachycardia: 'finding_supraventricular_tachycardia',
  premature_ventricular_complexes: 'finding_premature_ventricular_complexes',
  ventricular_tachycardia: 'finding_ventricular_tachycardia',
  st_elevation_anterior: 'finding_st_elevation_anterior',
  st_elevation_inferior: 'finding_st_elevation_inferior',
  st_elevation_lateral: 'finding_st_elevation_lateral',
  st_depression: 'finding_st_depression',
  t_wave_inversion: 'finding_t_wave_inversion',
  pathological_q_waves: 'finding_pathological_q_waves',
  diffuse_st_elevation: 'finding_diffuse_st_elevation',
  pr_depression: 'finding_pr_depression',
  left_bundle_branch_block: 'finding_left_bundle_branch_block',
  right_bundle_branch_block: 'finding_right_bundle_branch_block',
  wide_qrs: 'finding_wide_qrs',
  first_degree_av_block: 'finding_first_degree_av_block',
  pre_excitation: 'finding_pre_excitation',
  left_ventricular_hypertrophy: 'finding_left_ventricular_hypertrophy',
  strain_pattern: 'finding_strain_pattern',
  peaked_t_waves: 'finding_peaked_t_waves',
  prominent_u_waves: 'finding_prominent_u_waves',
  prolonged_qt: 'finding_prolonged_qt',
  low_voltage: 'finding_low_voltage',
  poor_r_wave_progression: 'finding_poor_r_wave_progression',
});

/** English rhythm names, the fallback behind `RHYTHM_KEYS`. */
export const RHYTHM_LABELS = Object.freeze({
  sinus: 'Sinus rhythm',
  atrial_fibrillation: 'Atrial fibrillation',
  atrial_flutter: 'Atrial flutter',
  svt: 'Supraventricular tachycardia',
  complete_heart_block: 'Complete heart block',
  ventricular_tachycardia: 'Ventricular tachycardia',
  ventricular_fibrillation: 'Ventricular fibrillation',
  asystole: 'Asystole',
});

/** Translation key per recordable rhythm. */
export const RHYTHM_KEYS = Object.freeze({
  sinus: 'rhythm_sinus',
  atrial_fibrillation: 'rhythm_atrial_fibrillation',
  atrial_flutter: 'rhythm_atrial_flutter',
  complete_heart_block: 'rhythm_complete_heart_block',
  svt: 'rhythm_svt',
  ventricular_tachycardia: 'rhythm_ventricular_tachycardia',
  ventricular_fibrillation: 'rhythm_ventricular_fibrillation',
  asystole: 'rhythm_asystole',
});

/** English axis names, the fallback behind `AXIS_KEYS`. */
export const AXIS_LABELS = Object.freeze({
  normal: 'Normal axis',
  left: 'Left axis deviation',
  right: 'Right axis deviation',
  extreme: 'Extreme axis',
  indeterminate: 'Indeterminate',
});

/** Translation key per frontal-axis category. */
export const AXIS_KEYS = Object.freeze({
  normal: 'axis_normal',
  left: 'axis_left',
  right: 'axis_right',
  extreme: 'axis_extreme',
  indeterminate: 'axis_indeterminate',
});

// A catalogue entry with no key would silently fall back to its raw id in every
// language, so the omission is caught at load rather than in a screenshot.
FINDING_IDS.forEach((id) => {
  if (!FINDING_KEYS[id]) throw new RangeError(`constants.js: finding '${id}' has no translation key`);
});
RHYTHM_IDS.forEach((id) => {
  if (!RHYTHM_KEYS[id]) throw new RangeError(`constants.js: rhythm '${id}' has no translation key`);
});
AXIS_CATEGORIES.forEach((id) => {
  if (!AXIS_KEYS[id]) throw new RangeError(`constants.js: axis '${id}' has no translation key`);
});
