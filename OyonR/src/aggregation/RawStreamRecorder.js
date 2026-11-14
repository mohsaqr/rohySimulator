/**
 * RawStreamRecorder — the per-sample series that ride on every window as
 * `raw_streams`.
 *
 * Windows are convenient but coarse; synchrony, sequence and network work
 * wants the continuous series. Every per-sample value the runtime produces is
 * recorded here at the rate it is produced and drained onto the next window
 * (docs/GROUP_SYNCHRONY_PLAN.md §2.3, Appendix A). Research-grade data policy:
 * on by default, nothing thinned.
 *
 * Wire format — columnar, one block per stream:
 *
 *   raw_streams.affect = {
 *     fields: ['ts_ms', 'ts_group_ms', 'valence', 'arousal', 'confidence', 'label', 'face_present'],
 *     rows:   [[1767225600000, 1767225600040, 0.21, -0.1, 0.83, 'happy', 1], ...],
 *   }
 *
 * `ts_ms` is the member's local epoch ms; `ts_group_ms` is the group clock
 * (null when no clock is attached).
 *
 * Lossless. Nothing is ever dropped: when a stream reaches `maxRowsPerStream`
 * the recorder calls `onFull()` so the owner can send what it holds early (the
 * runtime sends a raw-only envelope), and keeps recording meanwhile. Rows are
 * drained by time (`drain({ before })`), so a sample at or after a window's end
 * waits for the next window instead of riding on the one that just closed.
 * Splitting a block that is too large for one POST is the transport's job
 * (src/transport/chunkWindowBatch.js), not a reason to cut rows here.
 */

/** Field lists of the streams the runtime records (after ts_ms, ts_group_ms). */
export const RAW_STREAM_FIELDS = Object.freeze({
  affect: ['valence', 'arousal', 'confidence', 'label', 'face_present'],
  eye: ['openness_l', 'openness_r', 'blink', 'zone', 'iris_x', 'iris_y', 'valid'],
  head: ['yaw', 'pitch', 'roll', 'facing_screen'],
  posture: ['lean', 'tilt', 'head_lateral', 'head_above', 'shoulder_width', 'visibility', 'valid'],
  heart_rate: ['bpm', 'snr', 'confidence'],
  /** EXPERIMENTAL beat-to-beat intervals from the rPPG pulse; ts_ms = beat time. */
  ibi: ['ibi_ms', 'quality'],
  respiration: ['brpm', 'snr', 'confidence'],
  illumination: ['mean_luma', 'luma_std', 'quality'],
  screen_gaze: ['x', 'y', 'on_screen', 'quality', 'aoi'],
});

export class RawStreamRecorder {
  /**
   * @param {object} [options]
   * @param {{ toGroupTime(ms:number): number|null }} [options.clock] group clock; null → ts_group_ms null
   * @param {number} [options.maxRowsPerStream=20000] rows held per stream before `onFull` fires (never a cut)
   * @param {() => void} [options.onFull] called once each time a stream reaches the bound
   */
  constructor(options = {}) {
    this.clock = options.clock || null;
    this.maxRowsPerStream = Number.isInteger(options.maxRowsPerStream) && options.maxRowsPerStream > 0
      ? options.maxRowsPerStream
      : 20000;
    this.onFull = typeof options.onFull === 'function' ? options.onFull : null;
    this._streams = new Map();
  }

  /**
   * Record one sample.
   *
   * @param {string} stream  stream name
   * @param {number} tsMs    local epoch ms of the sample
   * @param {object} values  field → value; fields not listed for a known stream
   *                         are kept (appended in first-seen order) so nothing is lost
   */
  record(stream, tsMs, values) {
    if (typeof stream !== 'string' || !stream || !Number.isFinite(tsMs) || !values || typeof values !== 'object') return;
    let block = this._streams.get(stream);
    if (!block) {
      const known = RAW_STREAM_FIELDS[stream];
      const fields = known ? [...known] : Object.keys(values).sort();
      block = { fields, rows: [] };
      this._streams.set(stream, block);
    }
    for (const key of Object.keys(values)) {
      if (!block.fields.includes(key)) {
        block.fields.push(key);
        for (const row of block.rows) row.push(null);
      }
    }
    const groupTs = this.clock && typeof this.clock.toGroupTime === 'function' ? this.clock.toGroupTime(tsMs) : null;
    block.rows.push([tsMs, Number.isFinite(groupTs) ? groupTs : null, ...block.fields.map(f => normalizeCell(values[f]))]);
    if (this.onFull && block.rows.length % this.maxRowsPerStream === 0) this.onFull(stream);
  }

  /** Rows held in the largest stream. */
  get maxRows() {
    let n = 0;
    for (const b of this._streams.values()) n = Math.max(n, b.rows.length);
    return n;
  }

  /** True when any stream holds rows. */
  get pending() {
    for (const b of this._streams.values()) if (b.rows.length) return true;
    return false;
  }

  /**
   * Take the rows recorded so far — all of them, or only those before a time.
   *
   * @param {object} [options]
   * @param {number} [options.before]     keep rows with ts_ms >= before for a later drain
   * @param {boolean} [options.inclusive] with `before`: also take rows AT `before`
   *   (free-running windows close on, and include, the sample at their end)
   * @returns {object|null} `{ [stream]: { fields, rows } }` or null when nothing is taken
   */
  drain(options = {}) {
    const before = Number.isFinite(options.before) ? options.before : Infinity;
    const inclusive = options.inclusive === true;
    const taken = (ts) => (inclusive ? ts <= before : ts < before);
    const out = {};
    let any = false;
    for (const [name, block] of this._streams) {
      if (!block.rows.length) continue;
      const take = [];
      const keep = [];
      for (const row of block.rows) (taken(row[0]) ? take : keep).push(row);
      block.rows = keep;
      if (!take.length) continue;
      out[name] = { fields: ['ts_ms', 'ts_group_ms', ...block.fields], rows: take };
      any = true;
    }
    for (const [name, block] of this._streams) if (!block.rows.length) this._streams.delete(name);
    return any ? out : null;
  }
}

/**
 * A raw-only envelope around drained rows (null when there are none): the
 * interval spans the earliest to just past the latest row it holds.
 */
export function rawOnlyEnvelope(rawStreams, reason) {
  if (!rawStreams) return null;
  let first = Infinity; let last = -Infinity;
  for (const block of Object.values(rawStreams)) {
    for (const row of block.rows) {
      if (row[0] < first) first = row[0];
      if (row[0] > last) last = row[0];
    }
  }
  if (!Number.isFinite(first)) return null;
  return {
    modality: 'raw',
    window_kind: 'interval',
    window_start: new Date(Math.floor(first)).toISOString(),
    window_end: new Date(Math.floor(last) + 1).toISOString(),
    raw_reason: reason,
    raw_streams: rawStreams,
  };
}

function normalizeCell(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || value === null) return value;
  return null;
}

// ── Sample → stream-row mappers ────────────────────────────────────────────
// One per producer, so the runtime only says *what* it recorded, never how a
// sample becomes a row (the runtime stays an orchestrator).

function num(value) {
  return Number.isFinite(value) ? value : null;
}

function avg(a, b) {
  const fa = Number.isFinite(a); const fb = Number.isFinite(b);
  if (fa && fb) return (a + b) / 2;
  return fa ? a : (fb ? b : null);
}

function argmax(probabilities) {
  let best = null; let bestValue = -Infinity;
  for (const [label, value] of Object.entries(probabilities || {})) {
    if (Number.isFinite(value) && value > bestValue) { best = label; bestValue = value; }
  }
  return best;
}

/** Classifier prediction → `affect` row; null prediction = no face. */
export function affectRow(prediction) {
  if (!prediction) return { valence: null, arousal: null, confidence: null, label: null, face_present: 0 };
  return {
    valence: num(prediction.valence),
    arousal: num(prediction.arousal),
    confidence: num(prediction.confidence),
    label: typeof prediction.label === 'string' ? prediction.label : argmax(prediction.probabilities),
    face_present: 1,
  };
}

/** Smoothed eye features → `eye` row. */
export function eyeRow(eye) {
  const l = eye?.iris_offset_normalized?.l; const r = eye?.iris_offset_normalized?.r;
  return {
    openness_l: num(eye?.eye_openness_l),
    openness_r: num(eye?.eye_openness_r),
    blink: eye?.blink_l === true || eye?.blink_r === true ? 1 : 0,
    zone: typeof eye?.gaze_zone === 'string' ? eye.gaze_zone : null,
    iris_x: avg(l?.x, r?.x),
    iris_y: avg(l?.y, r?.y),
    valid: eye?.valid === true ? 1 : 0,
  };
}

/** Head pose `{ yaw_deg, pitch_deg, roll_deg }` → `head` row. */
export function headRow(pose, facingScreen = null) {
  return {
    yaw: num(pose?.yaw_deg),
    pitch: num(pose?.pitch_deg),
    roll: num(pose?.roll_deg),
    facing_screen: facingScreen === true ? 1 : (facingScreen === false ? 0 : null),
  };
}

/** Posture features → `posture` row. */
export function postureRow(p) {
  return {
    lean: num(p?.torso_lean_deg),
    tilt: num(p?.shoulder_tilt_deg),
    head_lateral: num(p?.head_lateral_norm),
    head_above: num(p?.head_above_norm),
    shoulder_width: num(p?.shoulder_width_norm),
    visibility: num(p?.upper_visibility),
    valid: p?.valid === true ? 1 : 0,
  };
}

/** Heart-rate estimate → `heart_rate` row (all null while acquiring). */
export function heartRateRow(hr) {
  return { bpm: num(hr?.bpm), snr: num(hr?.snr), confidence: num(hr?.confidence) };
}

/** Respiration estimate → `respiration` row (all null while acquiring). */
export function respirationRow(resp) {
  return { brpm: num(resp?.brpm), snr: num(resp?.snr), confidence: num(resp?.confidence) };
}

/** Illumination sample → `illumination` row. */
export function illuminationRow(ill) {
  return { mean_luma: num(ill?.mean_luma), luma_std: num(ill?.luma_std), quality: num(ill?.quality) };
}

/**
 * Smoothed screen-gaze point → `screen_gaze` row, with the first AOI that
 * contains it (AOIs use the gaze convention: [-0.5, 0.5], x/y = top-left).
 */
export function screenGazeRow(sample, aois = []) {
  const x = num(sample?.x); const y = num(sample?.y);
  const onScreen = x !== null && y !== null && Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5;
  let aoi = null;
  if (onScreen && Array.isArray(aois)) {
    const hit = aois.find(a => x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height);
    aoi = hit ? hit.id : null;
  }
  return { x, y, on_screen: x === null || y === null ? null : (onScreen ? 1 : 0), quality: num(sample?.quality), aoi };
}
