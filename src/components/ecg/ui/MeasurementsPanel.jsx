import { PanelHeader } from './PanelHeader.jsx';
import {
  MEASUREMENT_LABELS,
  MEASUREMENT_LABEL_KEYS,
  MEASUREMENT_VERDICT_KEYS,
  derived_qtc,
  measurement_in_squares,
  measurement_label,
  measurement_verdict,
} from '../measurements.js';
import { format_message, identity_t } from '../i18n.js';

/** English fallbacks; the keys live beside the ranges in `measurements.js`. */
const VERDICT_WORDS = { short: 'short', normal: 'normal', long: 'long' };

function MeasurementRow({ measurement, on_label, on_remove, t }) {
  const verdict = measurement_verdict(measurement);
  const squares = measurement_in_squares(measurement);
  const definition = measurement_label(measurement.label_id);
  const is_amplitude = definition?.kind === 'amplitude';
  return (
    <li className="ecg-measurement">
      <div className="ecg-measurement-value">
        <strong>
          {is_amplitude
            ? `${measurement.amplitude_mv.toFixed(2)} mV`
            : `${Math.round(measurement.duration_ms)} ms`}
        </strong>
        <span>
          {is_amplitude
            ? format_message(t, 'span_ms_wide', '{ms} ms wide',
              { ms: Math.round(measurement.duration_ms) })
            : `${measurement.amplitude_mv.toFixed(2)} mV`}
        </span>
        {squares && (
          <span title={t('squares_hint', 'How the span reads off the paper')}>
            {format_message(t, 'span_large_squares', '{squares} large sq',
              { squares: squares.large.toFixed(1) })}
          </span>
        )}
        {measurement.lead && <span className="ecg-measurement-lead">{measurement.lead}</span>}
      </div>
      <div className="ecg-measurement-controls">
        <label>
          <span className="ecg-visually-hidden">{t('label_this_measurement', 'Label this measurement')}</span>
          <select
            value={measurement.label_id}
            onChange={(event) => on_label(measurement.id, event.target.value)}
          >
            {MEASUREMENT_LABELS.map(({ id, label }) => (
              <option key={id} value={id}>{t(MEASUREMENT_LABEL_KEYS[id], label)}</option>
            ))}
          </select>
        </label>
        {verdict && (
          <span className={`ecg-verdict is-${verdict}`}>
            {t(MEASUREMENT_VERDICT_KEYS[verdict], VERDICT_WORDS[verdict])}
          </span>
        )}
        <button
          type="button"
          className="ecg-chip-button is-quiet"
          // The record id is an identifier, so the translated verb is composed
          // around it rather than the message carrying a placeholder.
          aria-label={`${t('discard_measurement', 'Discard measurement')} ${measurement.id}`}
          onClick={() => on_remove(measurement.id)}
        >
          {t('discard', 'Discard')}
        </button>
      </div>
    </li>
  );
}

/**
 * What the calipers found.
 *
 * A span only becomes a measurement once it is named, so every row carries a
 * label the reader sets. Naming is what lets the panel derive a corrected QT
 * without asking a second time, and what makes a normal range applicable at
 * all — 400 ms is a normal QT and a very fast RR.
 *
 * Nothing here is scored. A range verdict says what the convention is, not
 * whether the reader was right to measure there.
 *
 * @param {object} props component props
 * @param {Array<object>} props.measurements recorded measurements
 * @param {(id: string, label_id: string) => void} props.on_label relabel handler
 * @param {(id: string) => void} props.on_remove removal handler
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {JSX.Element} the measurements panel
 */
export function MeasurementsPanel({
  measurements = [],
  on_label,
  on_remove,
  t = identity_t,
}) {
  if (typeof on_label !== 'function') throw new TypeError('MeasurementsPanel: on_label must be a function');
  const qtc = derived_qtc(measurements);

  return (
    <section className="ecg-measurements" aria-label={t('caliper_measurements', 'Caliper measurements')}>
      <PanelHeader title={t('measurements', 'Measurements')} count={measurements.length} />

      {measurements.length === 0 ? (
        <p className="ecg-notes-empty">
          {t('measurements_empty',
            'No measurements yet. Click two points on the paper to span an interval, then name it.')}
        </p>
      ) : (
        <ul className="ecg-measurement-list">
          {measurements.map((measurement) => (
            <MeasurementRow
              key={measurement.id}
              measurement={measurement}
              on_label={on_label}
              on_remove={on_remove}
              t={t}
            />
          ))}
        </ul>
      )}

      {qtc && (
        <div className="ecg-qtc" aria-label={t('corrected_qt', 'Corrected QT')}>
          <p className="ecg-qtc-head">
            {t('corrected_qt', 'Corrected QT')}
            {/* The provenance line is two measured numbers with their symbols and
                the interval's own name. Written as values rather than as an
                English sentence, it needs no word order to be right. */}
            <span>QT {Math.round(qtc.qt_ms)} ms · {Math.round(qtc.heart_rate_bpm)} bpm</span>
          </p>
          <dl>
            {/* Bazett and Fridericia are the people the formulae are named after. */}
            <div><dt>Bazett</dt><dd>{Math.round(qtc.bazett_ms)} ms</dd></div>
            <div><dt>Fridericia</dt><dd>{Math.round(qtc.fridericia_ms)} ms</dd></div>
          </dl>
          <p className="ecg-panel-note">
            {t('qtc_note',
              'The two disagree most at fast and slow rates — Bazett over-corrects above 100 bpm. '
              + 'Both are shown because a report that quotes one should know what the other said.')}
          </p>
        </div>
      )}
    </section>
  );
}

export default MeasurementsPanel;
