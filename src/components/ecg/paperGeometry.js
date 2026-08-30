import { LEAD_NAMES, STANDARD_LAYOUT } from './constants.js';

export const PAPER_GEOMETRY = Object.freeze({
  width_mm: 260,
  height_mm: 128,
  data_origin_x_mm: 10,
  data_width_mm: 250,
  column_width_mm: 62.5,
  row_baselines_mm: Object.freeze([18, 48, 78, 112]),
});

/** Convert integer microvolts to vertical paper millimetres. */
export function microvolts_to_mm(microvolts, gain_mm_per_mv = 10) {
  if (!Number.isFinite(microvolts) || !Number.isFinite(gain_mm_per_mv) || gain_mm_per_mv <= 0) {
    throw new TypeError('microvolts_to_mm(): expected finite voltage and positive gain');
  }
  return (microvolts / 1000) * gain_mm_per_mv;
}

/** Convert a horizontal paper distance to milliseconds. */
export function millimetres_to_ms(millimetres, paper_speed_mm_per_second = 25) {
  if (!Number.isFinite(millimetres) || !Number.isFinite(paper_speed_mm_per_second)
      || paper_speed_mm_per_second <= 0) {
    throw new TypeError('millimetres_to_ms(): expected finite distance and positive speed');
  }
  return millimetres / paper_speed_mm_per_second * 1000;
}

/**
 * Convert a sample window into an SVG path in physical paper coordinates.
 *
 * @param {Int32Array|number[]} samples integer microvolts
 * @param {object} geometry plotting parameters
 * @returns {string}
 */
export function samples_to_svg_path(samples, geometry) {
  if (!(samples instanceof Int32Array) && !Array.isArray(samples)) {
    throw new TypeError('samples_to_svg_path(): samples must be an Int32Array or array');
  }
  if (!geometry || typeof geometry !== 'object') throw new TypeError('samples_to_svg_path(): geometry is required');
  const {
    start_index = 0,
    end_index = samples.length,
    sample_rate_hz,
    paper_speed_mm_per_second = 25,
    gain_mm_per_mv = 10,
    x_origin_mm = 0,
    baseline_mm = 0,
  } = geometry;
  if (![start_index, end_index, sample_rate_hz, paper_speed_mm_per_second,
    gain_mm_per_mv, x_origin_mm, baseline_mm].every(Number.isFinite)) {
    throw new TypeError('samples_to_svg_path(): geometry values must be finite');
  }
  if (!Number.isInteger(start_index) || !Number.isInteger(end_index)
      || start_index < 0 || end_index > samples.length || end_index <= start_index) {
    throw new RangeError('samples_to_svg_path(): invalid sample window');
  }
  if (sample_rate_hz <= 0 || paper_speed_mm_per_second <= 0 || gain_mm_per_mv <= 0) {
    throw new RangeError('samples_to_svg_path(): rates and gain must be positive');
  }

  return Array.from({ length: end_index - start_index }, (_unused, offset) => {
    const sample_index = start_index + offset;
    const x = x_origin_mm + offset / sample_rate_hz * paper_speed_mm_per_second;
    const y = baseline_mm - microvolts_to_mm(samples[sample_index], gain_mm_per_mv);
    const command = offset === 0 ? 'M' : 'L';
    return `${command}${x.toFixed(3)} ${y.toFixed(3)}`;
  }).join(' ');
}

/** Standard 1 mV, 200 ms calibration pulse path. */
export function calibration_pulse_path({ x_mm = 2, baseline_mm = 18, gain_mm_per_mv = 10,
  paper_speed_mm_per_second = 25 } = {}) {
  if (![x_mm, baseline_mm, gain_mm_per_mv, paper_speed_mm_per_second].every(Number.isFinite)
      || gain_mm_per_mv <= 0 || paper_speed_mm_per_second <= 0) {
    throw new TypeError('calibration_pulse_path(): invalid geometry');
  }
  const width = paper_speed_mm_per_second * 0.2;
  const shoulder = Math.min(1, width / 4);
  const top = baseline_mm - gain_mm_per_mv;
  return [
    `M${x_mm.toFixed(3)} ${baseline_mm.toFixed(3)}`,
    `L${(x_mm + shoulder).toFixed(3)} ${baseline_mm.toFixed(3)}`,
    `L${(x_mm + shoulder).toFixed(3)} ${top.toFixed(3)}`,
    `L${(x_mm + shoulder + width).toFixed(3)} ${top.toFixed(3)}`,
    `L${(x_mm + shoulder + width).toFixed(3)} ${baseline_mm.toFixed(3)}`,
    `L${(x_mm + shoulder * 2 + width).toFixed(3)} ${baseline_mm.toFixed(3)}`,
  ].join(' ');
}

/**
 * Build render-ready paths for the conventional 3 × 4 plus rhythm-strip ECG.
 *
 * @param {object} recording generated recording
 * @returns {object}
 */
export function build_standard_paper_model(recording) {
  if (!recording || typeof recording !== 'object' || !recording.leads) {
    throw new TypeError('build_standard_paper_model(recording): expected a generated recording');
  }
  if (LEAD_NAMES.some((lead) => !(recording.leads[lead] instanceof Int32Array))) {
    throw new TypeError('build_standard_paper_model(): every standard lead must be an Int32Array');
  }
  // How much time fits in a column is a fact about the paper, not a constant:
  // a 62.5 mm column holds 2.5 s at 25 mm/s and 1.25 s at 50 mm/s. Pinning it
  // would run the trace past the column edge at any non-standard speed.
  const segment_seconds = PAPER_GEOMETRY.column_width_mm / recording.paper_speed_mm_per_second;
  const segment_samples = Math.round(segment_seconds * recording.sample_rate_hz);
  // At a slow paper speed a column holds more time than the recording has, so
  // the later columns have no samples to draw. Emit only the cells that carry
  // data rather than a path built from an empty window.
  const rows = STANDARD_LAYOUT.map((lead_row, row_index) => lead_row.flatMap((lead, column_index) => {
    const start_index = column_index * segment_samples;
    if (start_index >= recording.leads[lead].length - 1) return [];
    const end_index = Math.min(start_index + segment_samples, recording.leads[lead].length);
    return [{
      lead,
      row_index,
      column_index,
      x_mm: PAPER_GEOMETRY.data_origin_x_mm + column_index * PAPER_GEOMETRY.column_width_mm,
      baseline_mm: PAPER_GEOMETRY.row_baselines_mm[row_index],
      start_seconds: column_index * segment_seconds,
      end_seconds: column_index * segment_seconds + (end_index - start_index) / recording.sample_rate_hz,
      path: samples_to_svg_path(recording.leads[lead], {
        start_index,
        end_index,
        sample_rate_hz: recording.sample_rate_hz,
        paper_speed_mm_per_second: recording.paper_speed_mm_per_second,
        gain_mm_per_mv: recording.gain_mm_per_mv,
        x_origin_mm: PAPER_GEOMETRY.data_origin_x_mm + column_index * PAPER_GEOMETRY.column_width_mm,
        baseline_mm: PAPER_GEOMETRY.row_baselines_mm[row_index],
      }),
    }];
  }));
  const rhythm_lead = recording.rhythm_lead;
  const strip_samples = Math.min(
    recording.leads[rhythm_lead].length,
    Math.round(PAPER_GEOMETRY.data_width_mm / recording.paper_speed_mm_per_second
      * recording.sample_rate_hz),
  );
  const rhythm_path = samples_to_svg_path(recording.leads[rhythm_lead], {
    start_index: 0,
    end_index: strip_samples,
    sample_rate_hz: recording.sample_rate_hz,
    paper_speed_mm_per_second: recording.paper_speed_mm_per_second,
    gain_mm_per_mv: recording.gain_mm_per_mv,
    x_origin_mm: PAPER_GEOMETRY.data_origin_x_mm,
    baseline_mm: PAPER_GEOMETRY.row_baselines_mm[3],
  });
  return {
    ...PAPER_GEOMETRY,
    segment_seconds,
    rows,
    // Flattened once here rather than in the render and again inside
    // locate_paper_cell, both of which run on every pointer move.
    cells: rows.flat(),
    rhythm: {
      lead: rhythm_lead,
      baseline_mm: PAPER_GEOMETRY.row_baselines_mm[3],
      seconds: strip_samples / recording.sample_rate_hz,
      path: rhythm_path,
    },
    calibration_paths: PAPER_GEOMETRY.row_baselines_mm.map((baseline_mm) =>
      calibration_pulse_path({
        x_mm: 1.5,
        baseline_mm,
        gain_mm_per_mv: recording.gain_mm_per_mv,
        paper_speed_mm_per_second: recording.paper_speed_mm_per_second,
      })),
  };
}

/** Build a full-width 10-second path for a single focused lead. */
export function build_focused_lead_model(recording, lead) {
  if (!recording || !recording.leads || !(recording.leads[lead] instanceof Int32Array)) {
    throw new RangeError(`build_focused_lead_model(): unknown lead '${lead}'`);
  }
  const strip_samples = Math.min(
    recording.leads[lead].length,
    Math.round(PAPER_GEOMETRY.data_width_mm / recording.paper_speed_mm_per_second
      * recording.sample_rate_hz),
  );
  return {
    width_mm: PAPER_GEOMETRY.width_mm,
    height_mm: 48,
    lead,
    baseline_mm: 26,
    seconds: strip_samples / recording.sample_rate_hz,
    path: samples_to_svg_path(recording.leads[lead], {
      start_index: 0,
      end_index: strip_samples,
      sample_rate_hz: recording.sample_rate_hz,
      paper_speed_mm_per_second: recording.paper_speed_mm_per_second,
      gain_mm_per_mv: recording.gain_mm_per_mv,
      x_origin_mm: PAPER_GEOMETRY.data_origin_x_mm,
      baseline_mm: 26,
    }),
    calibration_path: calibration_pulse_path({
      x_mm: 1.5,
      baseline_mm: 26,
      gain_mm_per_mv: recording.gain_mm_per_mv,
      paper_speed_mm_per_second: recording.paper_speed_mm_per_second,
    }),
  };
}

/** Calculate caliper deltas from two points expressed in paper millimetres. */
export function measure_paper_points(first, second, { paper_speed_mm_per_second = 25,
  gain_mm_per_mv = 10 } = {}) {
  if (![first?.x_mm, first?.y_mm, second?.x_mm, second?.y_mm,
    paper_speed_mm_per_second, gain_mm_per_mv].every(Number.isFinite)) {
    throw new TypeError('measure_paper_points(): two finite points, speed, and gain are required');
  }
  if (paper_speed_mm_per_second <= 0 || gain_mm_per_mv <= 0) {
    throw new RangeError('measure_paper_points(): speed and gain must be positive');
  }
  const delta_x_mm = Math.abs(second.x_mm - first.x_mm);
  const delta_y_mm = Math.abs(second.y_mm - first.y_mm);
  return {
    delta_x_mm,
    delta_y_mm,
    duration_ms: millimetres_to_ms(delta_x_mm, paper_speed_mm_per_second),
    amplitude_mv: delta_y_mm / gain_mm_per_mv,
  };
}

/** Convert a browser pointer coordinate into SVG paper coordinates. */
export function client_point_to_paper(client_point, bounding_rect, view_box) {
  if (![client_point?.x, client_point?.y, bounding_rect?.left, bounding_rect?.top,
    bounding_rect?.width, bounding_rect?.height, view_box?.width_mm, view_box?.height_mm]
    .every(Number.isFinite)) {
    throw new TypeError('client_point_to_paper(): complete finite point, rect, and view box are required');
  }
  if (bounding_rect.width <= 0 || bounding_rect.height <= 0
      || view_box.width_mm <= 0 || view_box.height_mm <= 0) {
    throw new RangeError('client_point_to_paper(): dimensions must be positive');
  }
  return {
    x_mm: (client_point.x - bounding_rect.left) / bounding_rect.width * view_box.width_mm,
    y_mm: (client_point.y - bounding_rect.top) / bounding_rect.height * view_box.height_mm,
  };
}

/**
 * Snap a paper point to the printed grid.
 *
 * Reading an ECG is counting squares, so snapping to the grid is not a
 * convenience that costs accuracy — it is the accuracy a paper reading actually
 * has. A caliper landing on 3.87 small squares implies a precision the tracing
 * does not carry.
 *
 * @param {{x_mm:number,y_mm:number}} point paper point in millimetres
 * @param {number} step_mm grid step to snap to; 0 or less disables snapping
 * @returns {{x_mm:number,y_mm:number}} snapped point
 */
export function snap_paper_point(point, step_mm) {
  if (!Number.isFinite(point?.x_mm) || !Number.isFinite(point?.y_mm)) {
    throw new TypeError('snap_paper_point(point, step_mm): point must have finite millimetres');
  }
  if (!Number.isFinite(step_mm) || step_mm <= 0) return { x_mm: point.x_mm, y_mm: point.y_mm };
  return {
    x_mm: Math.round(point.x_mm / step_mm) * step_mm,
    y_mm: Math.round(point.y_mm / step_mm) * step_mm,
  };
}

/**
 * Which lead cell of a standard 3 x 4 layout a paper point falls in.
 *
 * Used to dim the rest of the sheet around the lead being inspected, and to
 * attribute a measurement to the lead it was actually taken on rather than to
 * whichever lead happened to be focused.
 *
 * @param {object} model a standard paper model
 * @param {{x_mm:number,y_mm:number}} point paper point in millimetres
 * @returns {{lead:string, row_index:number, column_index:number}|null} the cell, or null outside every band
 */
export function locate_paper_cell(model, point) {
  if (!model?.rows || !Number.isFinite(point?.x_mm) || !Number.isFinite(point?.y_mm)) return null;
  const band_mm = 15;
  const cells = model.cells ?? model.rows.flat();
  const found = cells.find((cell) => point.x_mm >= cell.x_mm
    && point.x_mm < cell.x_mm + model.column_width_mm
    && Math.abs(point.y_mm - cell.baseline_mm) <= band_mm);
  if (found) return { lead: found.lead, row_index: found.row_index, column_index: found.column_index };
  if (model.rhythm && Math.abs(point.y_mm - model.rhythm.baseline_mm) <= band_mm
      && point.x_mm >= model.data_origin_x_mm) {
    return { lead: model.rhythm.lead, row_index: 3, column_index: 0 };
  }
  return null;
}
