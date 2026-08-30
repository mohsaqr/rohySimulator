import { useId, useMemo, useRef, useState } from 'react';
import {
  build_focused_lead_model,
  build_standard_paper_model,
  client_point_to_paper,
  locate_paper_cell,
  measure_paper_points,
  snap_paper_point,
} from '../paperGeometry.js';

/** How close a pointer must come, in paper millimetres, to grab a caliper leg. */
const HANDLE_GRAB_MM = 3.5;

/** Radius of the magnifier, in paper millimetres. */
const LENS_RADIUS_MM = 22;

const READOUT_FORMATTERS = Object.freeze({
  interval: (reading) => `${Math.round(reading.duration_ms)} ms`,
  amplitude: (reading) => `${reading.amplitude_mv.toFixed(2)} mV`,
  rate: (reading) => (reading.duration_ms > 0 ? `${Math.round(60000 / reading.duration_ms)} bpm` : null),
});

const CALIPER_HINTS = Object.freeze({
  interval: 'Click two points to span an interval. Drag either leg to adjust it.',
  amplitude: 'Click above and below a deflection to measure its height.',
  rate: 'Click two consecutive R waves to read the rate they imply.',
});

/** State the filter chain the way a recording would print it. */
function describe_chain(chain) {
  if (!chain) return 'unfiltered';
  const band = chain.high_pass_hz && chain.low_pass_hz
    ? `${chain.high_pass_hz}–${chain.low_pass_hz} Hz`
    : chain.low_pass_hz ? `≤${chain.low_pass_hz} Hz`
      : chain.high_pass_hz ? `≥${chain.high_pass_hz} Hz` : 'unfiltered';
  return chain.notch_hz ? `${band} · ${chain.notch_hz} Hz notch` : band;
}

const distance_mm = (a, b) => Math.hypot(a.x_mm - b.x_mm, a.y_mm - b.y_mm);

function GridDefinitions() {
  return (
    <defs>
      <pattern id="ecg-minor-grid" width="1" height="1" patternUnits="userSpaceOnUse">
        <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#f5c6ca" strokeWidth="0.08" />
      </pattern>
      <pattern id="ecg-major-grid" width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="5" height="5" fill="url(#ecg-minor-grid)" />
        <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#e69199" strokeWidth="0.16" />
      </pattern>
    </defs>
  );
}

/**
 * The magnifier.
 *
 * A loupe over paper, not a zoom of the page: the surrounding tracing stays at
 * its own scale so the enlarged detail keeps its context. It re-draws the same
 * content group through a circular clip, so the grid magnifies with the trace —
 * which is the point, because the grid is the ruler.
 */
function Lens({ centre, content_id, clip_id, power, width_mm, height_mm }) {
  const { x_mm, y_mm } = centre;
  return (
    <g className="ecg-lens" aria-hidden="true">
      <defs>
        <clipPath id={clip_id}>
          <circle cx={x_mm} cy={y_mm} r={LENS_RADIUS_MM} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip_id})`}>
        <rect width={width_mm} height={height_mm} fill="#fffafa" />
        <g transform={`translate(${x_mm - power * x_mm} ${y_mm - power * y_mm}) scale(${power})`}>
          <use href={`#${content_id}`} />
        </g>
      </g>
      <circle className="ecg-lens-ring" cx={x_mm} cy={y_mm} r={LENS_RADIUS_MM} />
      <text className="ecg-lens-power" x={x_mm} y={y_mm - LENS_RADIUS_MM - 2}>{power}×</text>
    </g>
  );
}

/**
 * Caliper legs, the span between them, and what the span reads.
 *
 * The legs are draggable because a first placement is a guess: on real paper a
 * reader walks the caliper onto the exact onset, and a tool that forces a
 * restart for every 0.4 mm correction teaches people to accept the first
 * answer.
 */
function Calipers({ points, height_mm, width_mm, mode, reading, march }) {
  if (points.length === 0) return null;
  const vertical = mode !== 'amplitude';
  const horizontal = mode === 'amplitude';
  const [first, second] = points;
  const span_mm = points.length === 2 ? Math.abs(second.x_mm - first.x_mm) : 0;
  const mid_x = points.length === 2 ? (first.x_mm + second.x_mm) / 2 : first.x_mm;
  const label_y = Math.max(6, Math.min(first.y_mm, points.length === 2 ? second.y_mm : first.y_mm) - 4);

  return (
    <g className="ecg-calipers">
      {/* Walking the span out along the strip is how a reader tests whether a
          rhythm is regular, or whether a P wave marches through a QRS. */}
      {march && points.length === 2 && span_mm > 1 && Array.from(
        { length: Math.floor((width_mm - Math.max(first.x_mm, second.x_mm)) / span_mm) },
        (_unused, step) => Math.max(first.x_mm, second.x_mm) + span_mm * (step + 1),
      ).map((x_mm) => (
        <line className="ecg-caliper-march" key={`march-${x_mm}`} x1={x_mm} y1="0" x2={x_mm} y2={height_mm} />
      ))}
      {points.map((point, index) => (
        <g className="ecg-caliper-leg" key={`leg-${index}`}>
          {vertical && <line x1={point.x_mm} y1="0" x2={point.x_mm} y2={height_mm} />}
          {horizontal && <line x1="0" y1={point.y_mm} x2={width_mm} y2={point.y_mm} />}
          <circle className="ecg-caliper-grip" cx={point.x_mm} cy={point.y_mm} r="1.6" />
        </g>
      ))}
      {points.length === 2 && (
        <>
          <line
            className="ecg-caliper-span"
            x1={first.x_mm}
            y1={first.y_mm}
            x2={second.x_mm}
            y2={second.y_mm}
          />
          {reading && (
            <g className="ecg-caliper-readout">
              <rect x={mid_x - 15} y={label_y - 4.6} width="30" height="6.4" rx="1.4" />
              <text x={mid_x} y={label_y}>{reading}</text>
            </g>
          )}
        </>
      )}
    </g>
  );
}

/**
 * Calibrated ECG paper with viewing and measuring tools.
 *
 * Everything drawable lives in one content group so the magnifier can re-draw
 * it through a clip. Zoom scales the rendered sheet inside a scrolling frame
 * rather than changing the viewBox, which keeps millimetres meaning
 * millimetres: a caliper reading must not depend on how far the reader has
 * zoomed in.
 *
 * @param {object} props component props
 * @param {object} props.recording materialized recording
 * @param {'standard'|'focus'} [props.mode] sheet layout
 * @param {string} [props.focused_lead] lead drawn in focus mode
 * @param {((measurement: object) => void)|null} [props.on_measurement] caliper handler
 * @param {boolean} [props.show_grid] draw the 1 mm / 5 mm grid
 * @param {'interval'|'amplitude'|'rate'} [props.caliper_mode] caliper behaviour
 * @param {number} [props.zoom] rendered scale of the sheet
 * @param {number} [props.lens_power] magnifier power; 0 or less disables it
 * @param {number} [props.snap_mm] grid step the calipers snap to; 0 disables
 * @param {boolean} [props.march] repeat the measured span along the sheet
 * @param {boolean} [props.spotlight] dim every lead but the one under the pointer
 * @returns {JSX.Element} the paper
 */
export function ECGPaper({ recording, mode = 'standard', focused_lead = 'II', on_measurement = null,
  show_grid = true, caliper_mode = 'interval', zoom = 1, lens_power = 0, snap_mm = 0,
  march = false, spotlight = false }) {
  const svg_ref = useRef(null);
  const unique = useId().replace(/:/g, '');
  const content_id = `ecg-content-${unique}`;
  const clip_id = `ecg-lens-${unique}`;

  const [caliper_points, set_caliper_points] = useState([]);
  const [dragging, set_dragging] = useState(null);
  const [pointer, set_pointer] = useState(null);

  const model = useMemo(
    () => mode === 'focus'
      ? build_focused_lead_model(recording, focused_lead)
      : build_standard_paper_model(recording),
    [focused_lead, mode, recording],
  );
  const height_mm = model.height_mm;
  const width_mm = model.width_mm;

  const paper_point = (event) => {
    const rect = svg_ref.current?.getBoundingClientRect();
    if (!rect) return null;
    return snap_paper_point(
      client_point_to_paper({ x: event.clientX, y: event.clientY }, rect, { width_mm, height_mm }),
      snap_mm,
    );
  };

  const reading_for = (points) => {
    if (points.length !== 2) return null;
    return measure_paper_points(points[0], points[1], {
      paper_speed_mm_per_second: recording.paper_speed_mm_per_second,
      gain_mm_per_mv: recording.gain_mm_per_mv,
    });
  };

  const emit = (points) => {
    const reading = reading_for(points);
    if (!reading || typeof on_measurement !== 'function') return;
    // Attribute the measurement to the lead it was taken on, not to whichever
    // lead the focus control happens to be set to.
    const cell = mode === 'focus' ? { lead: focused_lead } : locate_paper_cell(model, points[0]);
    on_measurement({ ...reading, lead: cell?.lead ?? null, caliper_mode });
  };

  const handle_down = (event) => {
    const point = paper_point(event);
    if (!point) return;
    const grabbed = caliper_points.findIndex((leg) => distance_mm(leg, point) <= HANDLE_GRAB_MM);
    if (grabbed >= 0) {
      set_dragging(grabbed);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    const next = caliper_points.length === 2 ? [point] : [...caliper_points, point];
    set_caliper_points(next);
    if (next.length === 2) emit(next);
  };

  const tracks_pointer = lens_power > 0 || spotlight;
  const handle_move = (event) => {
    // Pointer moves arrive at display refresh rate, and each state write
    // re-renders all thirteen traces. Only the magnifier and lead isolation
    // read this position, so nothing else pays for it.
    if (!tracks_pointer && dragging === null) return;
    const point = paper_point(event);
    if (!point) return;
    if (tracks_pointer) set_pointer(point);
    if (dragging === null) return;
    set_caliper_points((current) => current.map((leg, index) => (index === dragging ? point : leg)));
  };

  const handle_up = () => {
    if (dragging === null) return;
    set_dragging(null);
    emit(caliper_points);
  };

  const reading = reading_for(caliper_points);
  const format_readout = READOUT_FORMATTERS[caliper_mode] ?? READOUT_FORMATTERS.interval;
  const readout = reading ? format_readout(reading) : null;
  const hovered = spotlight && mode === 'standard' && pointer ? locate_paper_cell(model, pointer) : null;

  return (
    <section className="ecg-paper-shell" aria-label="12-lead electrocardiogram">
      {/* A recording states the settings it was made under. Reading a tracing
          without them is guessing, and these are adjustable. */}
      <div className="ecg-paper-meta">
        <span>{recording.paper_speed_mm_per_second} mm/s</span>
        <span>{recording.gain_mm_per_mv} mm/mV</span>
        <span>{recording.sample_rate_hz} Hz</span>
        <span>{describe_chain(recording.filter_chain)}</span>
        {zoom !== 1 && <span>{Math.round(zoom * 100)}% view</span>}
      </div>
      <div className="ecg-paper-scroll">
        <svg
          ref={svg_ref}
          className={`ecg-paper${lens_power > 0 ? ' has-lens' : ''}`}
          style={{ width: `${zoom * 100}%` }}
          viewBox={`0 0 ${width_mm} ${height_mm}`}
          role="img"
          aria-label={mode === 'focus' ? `Ten-second ECG, lead ${focused_lead}` : 'Standard 3 by 4 12-lead ECG with lead II rhythm strip'}
          onPointerDown={handle_down}
          onPointerMove={handle_move}
          onPointerUp={handle_up}
          onPointerLeave={() => set_pointer(null)}
        >
          <title>{mode === 'focus' ? `ECG lead ${focused_lead}` : 'Standard 12-lead ECG'}</title>
          <GridDefinitions />
          <g id={content_id}>
            <rect
              width={width_mm}
              height={height_mm}
              fill={show_grid ? 'url(#ecg-major-grid)' : '#fffafa'}
            />
            {mode === 'standard' ? (
              <>
                {model.cells.map((cell) => (
                  <g
                    key={`${cell.row_index}-${cell.column_index}-${cell.lead}`}
                    className={hovered && hovered.lead !== cell.lead ? 'ecg-cell is-dimmed' : 'ecg-cell'}
                  >
                    <text className="ecg-lead-label" x={cell.x_mm + 1.5} y={cell.baseline_mm - 10.5}>{cell.lead}</text>
                    <path className="ecg-trace" d={cell.path} />
                  </g>
                ))}
                <g className={hovered && hovered.lead !== model.rhythm.lead ? 'ecg-cell is-dimmed' : 'ecg-cell'}>
                  <text className="ecg-lead-label" x={model.data_origin_x_mm + 1.5} y={model.rhythm.baseline_mm - 10.5}>
                    {model.rhythm.lead} rhythm
                  </text>
                  <path className="ecg-trace" d={model.rhythm.path} />
                </g>
                {model.calibration_paths.map((path, index) => (
                  <path className="ecg-calibration" d={path} key={`cal-${index}`} />
                ))}
              </>
            ) : (
              <>
                <text className="ecg-lead-label ecg-lead-label-focus" x="11.5" y="8">Lead {model.lead}</text>
                <path className="ecg-trace" d={model.path} />
                <path className="ecg-calibration" d={model.calibration_path} />
              </>
            )}
          </g>
          <Calipers
            points={caliper_points}
            height_mm={height_mm}
            width_mm={width_mm}
            mode={caliper_mode}
            reading={readout}
            march={march}
          />
          {lens_power > 0 && pointer && dragging === null && (
            <Lens
              centre={pointer}
              content_id={content_id}
              clip_id={clip_id}
              power={lens_power}
              width_mm={width_mm}
              height_mm={height_mm}
            />
          )}
        </svg>
      </div>
      <div className="ecg-caliper-bar">
        <span>{CALIPER_HINTS[caliper_mode] ?? CALIPER_HINTS.interval}</span>
        {reading && (
          <output className="ecg-caliper-detail">
            {Math.round(reading.duration_ms)} ms · {reading.amplitude_mv.toFixed(2)} mV
            · {reading.delta_x_mm.toFixed(1)} mm
            {reading.duration_ms > 0 && <> · {Math.round(60000 / reading.duration_ms)} bpm</>}
          </output>
        )}
        <button type="button" onClick={() => set_caliper_points([])} disabled={caliper_points.length === 0}>
          Clear calipers
        </button>
      </div>
    </section>
  );
}
