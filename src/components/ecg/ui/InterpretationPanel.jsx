import { FINDING_CATALOG, RHYTHM_IDS, AXIS_CATEGORIES } from '../constants.js';
import { create_empty_interpretation } from '../assessment.js';

const RHYTHM_LABELS = {
  sinus: 'Sinus rhythm',
  atrial_fibrillation: 'Atrial fibrillation',
  atrial_flutter: 'Atrial flutter',
  svt: 'Supraventricular tachycardia',
  complete_heart_block: 'Complete heart block',
  ventricular_tachycardia: 'Ventricular tachycardia',
  ventricular_fibrillation: 'Ventricular fibrillation',
  asystole: 'Asystole',
};

const AXIS_LABELS = {
  normal: 'Normal axis', left: 'Left axis deviation', right: 'Right axis deviation',
  extreme: 'Extreme axis', indeterminate: 'Indeterminate',
};

const FINDING_GROUPS = Object.freeze([
  ['Rate and rhythm', ['sinus_rhythm', 'sinus_bradycardia', 'sinus_tachycardia', 'atrial_fibrillation',
    'atrial_flutter', 'supraventricular_tachycardia', 'premature_ventricular_complexes',
    'ventricular_tachycardia']],
  ['Conduction', ['first_degree_av_block', 'left_bundle_branch_block', 'right_bundle_branch_block',
    'wide_qrs', 'pre_excitation', 'prolonged_qt']],
  ['ST segment and T wave', ['st_elevation_anterior', 'st_elevation_inferior', 'st_elevation_lateral',
    'diffuse_st_elevation', 'st_depression', 't_wave_inversion', 'peaked_t_waves', 'pr_depression',
    'prominent_u_waves']],
  ['Chambers and voltage', ['pathological_q_waves', 'left_ventricular_hypertrophy', 'strain_pattern',
    'low_voltage', 'poor_r_wave_progression']],
]);

/** Labels by id, so a keystroke does not trigger 28 linear scans of the catalogue. */
const FINDING_LABELS = Object.freeze(Object.fromEntries(
  FINDING_CATALOG.map(({ id, label }) => [id, label]),
));

const label_for = (finding_id) => FINDING_LABELS[finding_id] ?? finding_id;

/**
 * The systematic read, recorded into the case.
 *
 * This panel deliberately has no submit button and no score. The ECG is one
 * investigation inside a larger case, so what a reader writes here is evidence
 * the case carries forward — not an answer the room marks. Naming a diagnosis
 * is the case's business, and asking for one here would teach that a diagnosis
 * can be made from a tracing alone.
 *
 * Every edit is recorded immediately. There is nothing to lose by leaving a
 * field blank and nothing to gain by guessing.
 *
 * @param {object} props component props
 * @param {object} props.value current structured read
 * @param {(next: object) => void} props.on_change change handler; the host persists it
 * @returns {JSX.Element} the worksheet
 */
export function InterpretationPanel({ value = create_empty_interpretation(), on_change }) {
  if (typeof on_change !== 'function') throw new TypeError('InterpretationPanel requires on_change');
  const set_field = (field, next_value) => on_change({ ...value, [field]: next_value });
  const set_interval = (field, next_value) => on_change({
    ...value,
    intervals_ms: { ...(value.intervals_ms ?? {}), [field]: next_value },
  });
  const selected = new Set(value.finding_ids ?? []);
  const toggle_finding = (finding_id) => {
    const next = new Set(selected);
    if (next.has(finding_id)) next.delete(finding_id); else next.add(finding_id);
    set_field('finding_ids', [...next]);
  };

  return (
    <div className="ecg-interpretation" aria-label="Systematic ECG read">
      <div className="ecg-panel-heading">
        <h3>Systematic read</h3>
        <p>Rate, rhythm, axis, intervals, morphology — in that order, every time.</p>
      </div>

      <fieldset>
        <legend>Rate and rhythm</legend>
        <div className="ecg-form-grid ecg-form-grid-two">
          <label>
            Rate <span>bpm</span>
            <input type="number" min="20" max="240" value={value.rate_bpm ?? ''}
              onChange={(event) => set_field('rate_bpm', event.target.value)} />
          </label>
          <label>
            Rhythm
            <select value={value.rhythm ?? ''} onChange={(event) => set_field('rhythm', event.target.value)}>
              <option value="">Not recorded</option>
              {RHYTHM_IDS.map((rhythm) => <option value={rhythm} key={rhythm}>{RHYTHM_LABELS[rhythm]}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Axis and intervals</legend>
        <label>
          Frontal QRS axis
          <select value={value.axis ?? ''} onChange={(event) => set_field('axis', event.target.value)}>
            <option value="">Not recorded</option>
            {AXIS_CATEGORIES.map((axis) => <option value={axis} key={axis}>{AXIS_LABELS[axis]}</option>)}
          </select>
        </label>
        <div className="ecg-form-grid ecg-form-grid-three">
          {['pr', 'qrs', 'qt'].map((interval) => (
            <label key={interval}>
              {interval.toUpperCase()} <span>ms</span>
              <input type="number" min="0" max="700" value={value.intervals_ms?.[interval] ?? ''}
                onChange={(event) => set_interval(interval, event.target.value)} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Findings <span className="ecg-legend-count">{selected.size} selected</span></legend>
        {FINDING_GROUPS.map(([group, finding_ids]) => (
          <div className="ecg-finding-group" key={group}>
            <p className="ecg-finding-group-title">{group}</p>
            <div className="ecg-finding-list">
              {finding_ids.map((finding_id) => (
                <label
                  className={`ecg-finding-option${selected.has(finding_id) ? ' is-selected' : ''}`}
                  key={finding_id}
                >
                  <input type="checkbox" checked={selected.has(finding_id)}
                    onChange={() => toggle_finding(finding_id)} />
                  <span>{label_for(finding_id)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>ECG statement</legend>
        <label>
          What this tracing shows
          <textarea rows="3" value={value.impression ?? ''}
            placeholder="Example: Sinus rhythm at 78, normal axis, ST elevation in V2–V4 with reciprocal depression in III."
            onChange={(event) => set_field('impression', event.target.value)} />
        </label>
        <p className="ecg-panel-note">
          Describe the tracing, not the patient. What the findings mean for this patient is decided
          with the rest of the case.
        </p>
      </fieldset>
    </div>
  );
}
