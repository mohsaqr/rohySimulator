import { ECG_VERB_METADATA } from './ecgEvents.js';

// Derived from each verb's own `clinicalState` (RPS-1 1.6): one source of
// truth, so the fallback map cannot drift from the facet row.
export const ECG_VERB_FALLBACKS = Object.freeze(
  Object.fromEntries(Object.entries(ECG_VERB_METADATA).map(([verb, meta]) => [verb, meta.clinicalState])),
);

export const ECG_OBJECT_OVERRIDES = Object.freeze({
  ecg_recording: 'assessing',
  ecg_lead: 'examining',
  ecg_measurement: 'examining',
  ecg_note: 'documenting',
  ecg_interpretation: 'documenting',
  ecg_teaching_point: 'reflecting',
});

export const ECG_INTERPRETATIONS = Object.freeze({
  'OPENED_ECG_RECORDING:ecg_recording': 'assessing',
  'FOCUSED_ECG_LEAD:ecg_lead': 'examining',
  'RECORDED_ECG_NOTE:ecg_note': 'documenting',
  'SUBMITTED_ECG_INTERPRETATION:ecg_interpretation': 'documenting',
});

/** Merge ECG mappings into host maps with collision detection. */
export function merge_ecg_states(host_maps) {
  if (!host_maps || typeof host_maps !== 'object' || Array.isArray(host_maps)) {
    throw new TypeError('merge_ecg_states(host_maps): expected host state maps');
  }
  const pairs = [
    ['VERB_FALLBACKS', ECG_VERB_FALLBACKS],
    ['OBJECT_OVERRIDES', ECG_OBJECT_OVERRIDES],
    ['DEFAULT_INTERPRETATIONS', ECG_INTERPRETATIONS],
  ];
  const collisions = pairs.flatMap(([name, additions]) => Object.keys(additions)
    .filter((key) => Object.hasOwn(host_maps[name] ?? {}, key))
    .map((key) => `${name}.${key}`));
  if (collisions.length > 0) {
    throw new Error(`merge_ecg_states(): host collision at ${collisions.join(', ')}`);
  }
  return Object.fromEntries(pairs.map(([name, additions]) => [name, { ...(host_maps[name] ?? {}), ...additions }]));
}
