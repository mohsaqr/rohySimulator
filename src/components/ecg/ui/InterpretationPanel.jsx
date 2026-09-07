import {
  AXIS_CATEGORIES,
  AXIS_KEYS,
  AXIS_LABELS,
  FINDING_CATALOG,
  FINDING_KEYS,
  RHYTHM_IDS,
  RHYTHM_KEYS,
  RHYTHM_LABELS,
} from '../constants.js';
import { create_empty_interpretation } from '../assessment.js';
import { format_message, identity_t } from '../i18n.js';

/** `[translation key, English heading, finding ids]` per worksheet group. */
const FINDING_GROUPS = Object.freeze([
  ['finding_group_rate_rhythm', 'Rate and rhythm',
    ['sinus_rhythm', 'sinus_bradycardia', 'sinus_tachycardia', 'atrial_fibrillation',
      'atrial_flutter', 'supraventricular_tachycardia', 'premature_ventricular_complexes',
      'ventricular_tachycardia']],
  ['finding_group_conduction', 'Conduction',
    ['first_degree_av_block', 'left_bundle_branch_block', 'right_bundle_branch_block',
      'wide_qrs', 'pre_excitation', 'prolonged_qt']],
  ['finding_group_st_t', 'ST segment and T wave',
    ['st_elevation_anterior', 'st_elevation_inferior', 'st_elevation_lateral',
      'diffuse_st_elevation', 'st_depression', 't_wave_inversion', 'peaked_t_waves', 'pr_depression',
      'prominent_u_waves']],
  ['finding_group_chambers', 'Chambers and voltage',
    ['pathological_q_waves', 'left_ventricular_hypertrophy', 'strain_pattern',
      'low_voltage', 'poor_r_wave_progression']],
]);

/** Labels by id, so a keystroke does not trigger 28 linear scans of the catalogue. */
const FINDING_LABELS = Object.freeze(Object.fromEntries(
  FINDING_CATALOG.map(({ id, label }) => [id, label]),
));

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
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {JSX.Element} the worksheet
 */
export function InterpretationPanel({
  value = create_empty_interpretation(),
  on_change,
  t = identity_t,
}) {
  if (typeof on_change !== 'function') throw new TypeError('InterpretationPanel requires on_change');
  const label_for = (finding_id) => t(FINDING_KEYS[finding_id] ?? finding_id, FINDING_LABELS[finding_id] ?? finding_id);
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
    <div className="ecg-interpretation" aria-label={t('systematic_ecg_read', 'Systematic ECG read')}>
      <div className="ecg-panel-heading">
        <h3>{t('systematic_read', 'Systematic read')}</h3>
        <p>{t('systematic_read_method', 'Rate, rhythm, axis, intervals, morphology — in that order, every time.')}</p>
      </div>

      <fieldset>
        <legend>{t('rate_and_rhythm', 'Rate and rhythm')}</legend>
        <div className="ecg-form-grid ecg-form-grid-two">
          <label>
            {t('rate', 'Rate')} <span>{t('unit_bpm', 'bpm')}</span>
            <input type="number" min="20" max="240" value={value.rate_bpm ?? ''}
              onChange={(event) => set_field('rate_bpm', event.target.value)} />
          </label>
          <label>
            {t('rhythm', 'Rhythm')}
            <select value={value.rhythm ?? ''} onChange={(event) => set_field('rhythm', event.target.value)}>
              <option value="">{t('not_recorded', 'Not recorded')}</option>
              {RHYTHM_IDS.map((rhythm) => (
                <option value={rhythm} key={rhythm}>{t(RHYTHM_KEYS[rhythm], RHYTHM_LABELS[rhythm])}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('axis_and_intervals', 'Axis and intervals')}</legend>
        <label>
          {t('frontal_qrs_axis', 'Frontal QRS axis')}
          <select value={value.axis ?? ''} onChange={(event) => set_field('axis', event.target.value)}>
            <option value="">{t('not_recorded', 'Not recorded')}</option>
            {AXIS_CATEGORIES.map((axis) => (
              <option value={axis} key={axis}>{t(AXIS_KEYS[axis], AXIS_LABELS[axis])}</option>
            ))}
          </select>
        </label>
        <div className="ecg-form-grid ecg-form-grid-three">
          {/* PR, QRS and QT are symbols rather than words: they are written the
              same way on a cart in every language, so they are not translated. */}
          {['pr', 'qrs', 'qt'].map((interval) => (
            <label key={interval}>
              {interval.toUpperCase()} <span>{t('unit_ms', 'ms')}</span>
              <input type="number" min="0" max="700" value={value.intervals_ms?.[interval] ?? ''}
                onChange={(event) => set_interval(interval, event.target.value)} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        {/* One sentence, one key. "selected" stranded beside the number cannot
            agree with its noun in French, and Finnish and Kazakh attach that
            relation morphologically rather than by position. */}
        <legend>
          {t('findings', 'Findings')}{' '}
          <span className="ecg-legend-count">
            {format_message(t, 'findings_selected', '{count} selected', { count: selected.size })}
          </span>
        </legend>
        {FINDING_GROUPS.map(([group_key, group_label, finding_ids]) => (
          <div className="ecg-finding-group" key={group_key}>
            <p className="ecg-finding-group-title">{t(group_key, group_label)}</p>
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
        <legend>{t('ecg_statement', 'ECG statement')}</legend>
        <label>
          {t('what_this_tracing_shows', 'What this tracing shows')}
          <textarea rows="3" value={value.impression ?? ''}
            placeholder={t('impression_placeholder',
              'Example: Sinus rhythm at 78, normal axis, ST elevation in V2–V4 with reciprocal depression in III.')}
            onChange={(event) => set_field('impression', event.target.value)} />
        </label>
        <p className="ecg-panel-note">
          {t('impression_note',
            'Describe the tracing, not the patient. What the findings mean for this patient is decided with the rest of the case.')}
        </p>
      </fieldset>
    </div>
  );
}
