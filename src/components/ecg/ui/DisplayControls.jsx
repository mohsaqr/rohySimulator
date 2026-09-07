import { useState } from 'react';
import { FILTER_CHAIN_IDS } from '../filters.js';
import { identity_t } from '../i18n.js';

/**
 * Sensitivities a 12-lead cart offers, in mm/mV.
 *
 * `label` is a numeral — the same in every language — so only the hint carries a
 * key. Every catalogue below states its keys as literal strings so an extractor
 * can read them; `t(option.hint_key, option.hint)` at the call site could not be
 * read statically on its own.
 */
export const GAIN_OPTIONS = Object.freeze([
  { value: 5, label: '5', hint: 'Half standard — for a tracing that clips', hint_key: 'gain_hint_half' },
  { value: 10, label: '10', hint: 'Standard', hint_key: 'gain_hint_standard' },
  { value: 20, label: '20', hint: 'Double standard — for low voltage', hint_key: 'gain_hint_double' },
]);

/** Paper speeds a 12-lead cart offers, in mm/s. */
export const SPEED_OPTIONS = Object.freeze([
  { value: 12.5, label: '12.5', hint: 'Half standard — more beats, less detail', hint_key: 'speed_hint_half' },
  { value: 25, label: '25', hint: 'Standard', hint_key: 'speed_hint_standard' },
  { value: 50, label: '50', hint: 'Double standard — for separating close deflections', hint_key: 'speed_hint_double' },
]);

/**
 * How each chain is offered to a reader, named for what it is FOR — the choice
 * is clinical rather than cosmetic.
 *
 * Copy only. The chains themselves belong to `filters.js`, so what a preset id
 * does to the signal does not depend on a React component, and a consumer that
 * needs to resolve a stored measurement's chain need not import any UI.
 */
export const FILTER_PRESETS = Object.freeze([
  { id: 'raw', label: 'Raw', label_key: 'filter_raw',
    hint: 'Unfiltered as acquired', hint_key: 'filter_raw_hint' },
  { id: 'diagnostic', label: 'Diagnostic', label_key: 'filter_diagnostic',
    hint: '0.05–150 Hz — the band a 12-lead should be reported from', hint_key: 'filter_diagnostic_hint' },
  { id: 'monitor', label: 'Monitor', label_key: 'filter_monitor',
    hint: '0.5–40 Hz — steadier, but can create ST change. Not for reporting', hint_key: 'filter_monitor_hint' },
  { id: 'mains_50', label: '50 Hz', label_key: 'filter_mains_50',
    hint: 'Diagnostic band plus a 50 Hz mains notch', hint_key: 'filter_mains_50_hint' },
  { id: 'mains_60', label: '60 Hz', label_key: 'filter_mains_60',
    hint: 'Diagnostic band plus a 60 Hz mains notch', hint_key: 'filter_mains_60_hint' },
]);

// Every offered preset must name a chain that exists, or the control silently
// falls back to unfiltered while claiming otherwise.
FILTER_PRESETS.forEach(({ id }) => {
  if (!FILTER_CHAIN_IDS.includes(id)) {
    throw new RangeError(`DisplayControls: '${id}' is not a filter chain in filters.js`);
  }
});

/** Caliper behaviours. */
export const CALIPER_MODES = Object.freeze([
  { id: 'interval', label: 'Interval', label_key: 'caliper_interval',
    hint: 'Time between two points', hint_key: 'caliper_interval_hint' },
  { id: 'amplitude', label: 'Amplitude', label_key: 'caliper_amplitude',
    hint: 'Height between two points', hint_key: 'caliper_amplitude_hint' },
  { id: 'rate', label: 'Rate', label_key: 'caliper_rate',
    hint: 'Read one RR span as beats per minute', hint_key: 'caliper_rate_hint' },
]);

/** Grid step the calipers snap to. */
export const SNAP_OPTIONS = Object.freeze([
  { value: 0, label: 'Free', label_key: 'snap_free',
    hint: 'No snapping', hint_key: 'snap_free_hint' },
  { value: 0.5, label: '½ mm', label_key: 'snap_half_mm',
    hint: 'Half a small square', hint_key: 'snap_half_mm_hint' },
  { value: 1, label: '1 mm', label_key: 'snap_one_mm',
    hint: 'One small square — how paper is read', hint_key: 'snap_one_mm_hint' },
]);

/** Magnifier powers offered once the lens is on. */
export const LENS_POWERS = Object.freeze([2, 3, 4]);

/** Zoom stops for the sheet itself, as a fraction of fit-to-width. */
export const ZOOM_STOPS = Object.freeze([1, 1.5, 2.5, 4]);

/** The default power the lens comes back at, so the toggle is one click. */
export const DEFAULT_LENS_POWER = 3;

function Segments({ label, options, value, on_change, hide_label = false, t }) {
  return (
    <div className={`ecg-control-group${hide_label ? ' ecg-tool-inline' : ''}`}>
      <span className={hide_label ? 'ecg-visually-hidden' : 'ecg-control-label'}>{label}</span>
      <div className="ecg-control-segments" role="group" aria-label={label}>
        {options.map((option) => {
          const option_value = option.value ?? option.id;
          return (
            <button
              key={option_value}
              type="button"
              aria-pressed={option_value === value}
              // A catalogue entry carries its own key; an entry whose label is a
              // numeral (gain, speed) has none, and stays as it is in every
              // language rather than being routed through a key that says '25'.
              title={option.hint_key ? t(option.hint_key, option.hint) : option.hint}
              onClick={() => on_change(option_value)}
            >
              {option.label_key ? t(option.label_key, option.label) : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LensGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="ecg-tool-glyph" aria-hidden="true">
      <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="10.2" y1="10.2" x2="14.2" y2="14.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The tools a reader reaches for, and the cart settings behind them.
 *
 * An earlier version put all twenty-odd controls in one bar. Everything was
 * available and nothing was findable — the magnifier in particular, which is
 * the tool a reader wants first and which was two clicks deep inside an
 * unlabelled group of three.
 *
 * So the split is by frequency of use, not by category. The four things touched
 * constantly — magnifier, zoom, lead isolation, caliper mode — are single
 * controls on the bar. Gain, speed, filter chain, snapping and march are
 * recording settings a reader sets once and leaves; they live behind Cart.
 *
 * @param {object} props component props
 * @param {(next: object) => void} props.on_change partial-settings change handler
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {JSX.Element} the tool bar
 */
export function DisplayControls({
  gain_mm_per_mv,
  paper_speed_mm_per_second,
  filter_preset_id,
  caliper_mode,
  show_grid,
  snap_mm = 0,
  zoom = 1,
  lens_power = 0,
  spotlight = false,
  march = false,
  on_change,
  t = identity_t,
}) {
  if (typeof on_change !== 'function') throw new TypeError('DisplayControls: on_change must be a function');
  const [cart_open, set_cart_open] = useState(false);
  const zoom_index = ZOOM_STOPS.indexOf(zoom);
  const step_zoom = (direction) => {
    const next = Math.min(ZOOM_STOPS.length - 1, Math.max(0, (zoom_index < 0 ? 0 : zoom_index) + direction));
    on_change({ zoom: ZOOM_STOPS[next] });
  };

  return (
    <div className="ecg-tools">
      <button
        type="button"
        className={`ecg-tool-button${lens_power > 0 ? ' is-active' : ''}`}
        aria-pressed={lens_power > 0}
        title={t('lens_hint', 'Magnifier — hover the paper to enlarge the trace and the grid under the pointer')}
        onClick={() => on_change({ lens_power: lens_power > 0 ? 0 : DEFAULT_LENS_POWER })}
      >
        <LensGlyph />
        <span>{t('lens', 'Lens')}</span>
        {lens_power > 0 && <span className="ecg-tool-badge">{lens_power}×</span>}
      </button>

      {lens_power > 0 && (
        <div className="ecg-control-segments ecg-tool-inline" role="group" aria-label={t('lens_power', 'Lens power')}>
          {LENS_POWERS.map((power) => (
            <button
              key={power}
              type="button"
              aria-pressed={power === lens_power}
              onClick={() => on_change({ lens_power: power })}
            >
              {power}×
            </button>
          ))}
        </div>
      )}

      <div className="ecg-zoom-stepper" role="group" aria-label={t('zoom', 'Zoom')}>
        <button type="button" aria-label={t('zoom_out', 'Zoom out')} disabled={zoom_index <= 0} onClick={() => step_zoom(-1)}>−</button>
        <output>{zoom === 1 ? t('fit', 'Fit') : `${Math.round(zoom * 100)}%`}</output>
        <button type="button" aria-label={t('zoom_in', 'Zoom in')} disabled={zoom_index >= ZOOM_STOPS.length - 1} onClick={() => step_zoom(1)}>+</button>
      </div>

      <button
        type="button"
        className={`ecg-tool-button${spotlight ? ' is-active' : ''}`}
        aria-pressed={spotlight}
        title={t('isolate_hint', 'Dim every lead but the one under the pointer')}
        onClick={() => on_change({ spotlight: !spotlight })}
      >
        <span>{t('isolate', 'Isolate')}</span>
      </button>

      <Segments
        label={t('caliper', 'Caliper')}
        hide_label
        options={CALIPER_MODES}
        value={caliper_mode}
        on_change={(value) => on_change({ caliper_mode: value })}
        t={t}
      />

      <div className="ecg-cart">
        <button
          type="button"
          className={`ecg-tool-button${cart_open ? ' is-active' : ''}`}
          aria-expanded={cart_open}
          title={t('cart_hint', 'Gain, paper speed, filters, and caliper behaviour')}
          onClick={() => set_cart_open((open) => !open)}
        >
          <span>{t('cart', 'Cart')}</span>
          <span className="ecg-tool-caret" aria-hidden="true">{cart_open ? '▴' : '▾'}</span>
        </button>
        {cart_open && (
          <div className="ecg-cart-panel" aria-label={t('recording_settings', 'Recording settings')}>
            <Segments
              label={t('gain_label', 'Gain mm/mV')}
              options={GAIN_OPTIONS}
              value={gain_mm_per_mv}
              on_change={(value) => on_change({ gain_mm_per_mv: value })}
              t={t}
            />
            <Segments
              label={t('speed_label', 'Speed mm/s')}
              options={SPEED_OPTIONS}
              value={paper_speed_mm_per_second}
              on_change={(value) => on_change({ paper_speed_mm_per_second: value })}
              t={t}
            />
            <Segments
              label={t('filter_label', 'Filter')}
              options={FILTER_PRESETS}
              value={filter_preset_id}
              on_change={(value) => on_change({ filter_preset_id: value })}
              t={t}
            />
            <Segments
              label={t('caliper_snap', 'Caliper snap')}
              options={SNAP_OPTIONS}
              value={snap_mm}
              on_change={(value) => on_change({ snap_mm: value })}
              t={t}
            />
            <div className="ecg-control-group">
              <span className="ecg-control-label">{t('paper', 'Paper')}</span>
              <div className="ecg-control-segments">
                <button type="button" aria-pressed={show_grid}
                  title={t('grid_hint', 'Draw the 1 mm and 5 mm grid')}
                  onClick={() => on_change({ show_grid: !show_grid })}>{t('grid', 'Grid')}</button>
                <button type="button" aria-pressed={march}
                  title={t('march_hint', 'Repeat the measured span along the sheet, to walk out a rhythm')}
                  onClick={() => on_change({ march: !march })}>{t('march', 'March')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DisplayControls;
