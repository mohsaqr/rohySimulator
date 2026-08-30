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
