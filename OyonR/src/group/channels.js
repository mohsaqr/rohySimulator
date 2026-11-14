/**
 * Channel catalogue for the group layer: how each named channel is read from
 * an Oyon window's `raw_streams` (and, for older data without raw streams,
 * from the window's own blocks), what kind of signal it is, and its default
 * resampling grid.
 *
 * Raw streams are columnar: `raw_streams.<stream> = { fields: [...], rows: [[...]] }`
 * with `ts_ms` (member's local epoch ms) and `ts_group_ms` (group clock, or
 * null) as the first two fields. See `RawStreamRecorder` and
 * `docs/GROUP_SYNCHRONY.md`.
 */

/**
 * kind:       'continuous' | 'categorical'
 * stream:     raw stream name
 * field:      field in that stream (or `read(row)` for derived values)
 * quality:    field holding a 0..1 quality, or null (present value ⇒ quality 1)
 * grid_hz:    default resampling grid
 * fallback:   window-level reader `(window) => value` used when a window has no raw stream
 * evidence:   'primary' | 'secondary' | 'experimental' — the synchrony-evidence
 *             ranking from docs/PHYSIOLOGICAL_SYNCHRONY_LITERATURE.md
 */
export const GROUP_CHANNELS = Object.freeze({
  valence: { kind: 'continuous', stream: 'affect', field: 'valence', quality: 'confidence', grid_hz: 1, evidence: 'primary', fallback: w => w.valence },
  arousal: { kind: 'continuous', stream: 'affect', field: 'arousal', quality: 'confidence', grid_hz: 1, evidence: 'primary', fallback: w => w.arousal },
  emotion: { kind: 'categorical', stream: 'affect', field: 'label', quality: 'confidence', grid_hz: 1, evidence: 'primary', fallback: w => w.dominant_emotion },
  'emotion.confidence': { kind: 'continuous', stream: 'affect', field: 'confidence', quality: null, grid_hz: 1, evidence: 'primary', fallback: w => w.confidence },

  'gaze.zone': { kind: 'categorical', stream: 'eye', field: 'zone', quality: 'valid', grid_hz: 5, evidence: 'primary' },
  'gaze.iris_x': { kind: 'continuous', stream: 'eye', field: 'iris_x', quality: 'valid', grid_hz: 5, evidence: 'primary' },
  'gaze.iris_y': { kind: 'continuous', stream: 'eye', field: 'iris_y', quality: 'valid', grid_hz: 5, evidence: 'primary' },
  'eye.openness': { kind: 'continuous', stream: 'eye', read: r => avg2(r.openness_l, r.openness_r), quality: 'valid', grid_hz: 5, evidence: 'secondary' },
  'eye.blink': { kind: 'continuous', stream: 'eye', field: 'blink', quality: 'valid', grid_hz: 5, evidence: 'secondary' },

  'screen_gaze.x': { kind: 'continuous', stream: 'screen_gaze', field: 'x', quality: 'quality', grid_hz: 5, evidence: 'primary' },
  'screen_gaze.y': { kind: 'continuous', stream: 'screen_gaze', field: 'y', quality: 'quality', grid_hz: 5, evidence: 'primary' },
  'screen_gaze.zone': { kind: 'categorical', stream: 'screen_gaze', read: r => screenZone(r.x, r.y, r.on_screen), quality: 'quality', grid_hz: 5, evidence: 'primary' },
  'screen_gaze.aoi': { kind: 'categorical', stream: 'screen_gaze', read: r => (r.on_screen === 0 ? 'off_screen' : (r.aoi ?? 'none')), quality: 'quality', grid_hz: 5, evidence: 'primary' },

  'head.yaw': { kind: 'continuous', stream: 'head', field: 'yaw', quality: null, grid_hz: 5, evidence: 'secondary' },
  'head.pitch': { kind: 'continuous', stream: 'head', field: 'pitch', quality: null, grid_hz: 5, evidence: 'secondary' },
  'head.roll': { kind: 'continuous', stream: 'head', field: 'roll', quality: null, grid_hz: 5, evidence: 'secondary' },
  /** Derived after resampling: angular speed of the head in deg/s. */
  'head.speed': { kind: 'continuous', derived: true, grid_hz: 5, evidence: 'secondary' },

  'posture.lean': { kind: 'continuous', stream: 'posture', field: 'lean', quality: 'valid', grid_hz: 5, evidence: 'secondary' },
  'posture.tilt': { kind: 'continuous', stream: 'posture', field: 'tilt', quality: 'valid', grid_hz: 5, evidence: 'secondary' },
  'posture.head_lateral': { kind: 'continuous', stream: 'posture', field: 'head_lateral', quality: 'valid', grid_hz: 5, evidence: 'secondary' },

  'heart_rate.bpm': { kind: 'continuous', stream: 'heart_rate', field: 'bpm', quality: 'confidence', grid_hz: 1, evidence: 'experimental', fallback: w => w.heart_rate?.bpm_robust ?? w.heart_rate?.bpm_mean },
  /** EXPERIMENTAL beat-to-beat intervals (ms) from the rPPG pulse — for HRV synchrony (Tomashin 2022). */
  'heart_rate.ibi': { kind: 'continuous', stream: 'ibi', field: 'ibi_ms', quality: 'quality', grid_hz: 4, evidence: 'experimental' },
  'respiration.brpm': { kind: 'continuous', stream: 'respiration', field: 'brpm', quality: 'confidence', grid_hz: 1, evidence: 'experimental', fallback: w => w.respiration?.brpm_median },

  /**
   * Host-supplied speaking turns (`runtime.recordHostSample('speech', { state })`,
   * e.g. from VoiceTurnController events). Event channel: a state HOLDS until
   * the next event (`hold: true`), instead of expiring after a tolerance.
   */
  speaking: { kind: 'categorical', stream: 'speech', read: r => speakingState(r.state ?? r.speaking), quality: null, grid_hz: 5, hold: true, evidence: 'primary' },
  'illumination.luma': { kind: 'continuous', stream: 'illumination', field: 'mean_luma', quality: null, grid_hz: 1, evidence: 'secondary', fallback: w => w.illumination?.mean_luma_mean ?? w.illumination?.mean_luma },
});

/** Facial action-unit channels are open-ended: `au.<name>` reads `raw_streams.au.<name>`. */
export function channelSpec(channel) {
  if (Object.prototype.hasOwnProperty.call(GROUP_CHANNELS, channel)) return GROUP_CHANNELS[channel];
  if (typeof channel === 'string' && channel.startsWith('au.') && channel.length > 3) {
    return { kind: 'continuous', stream: 'au', field: channel.slice(3), quality: null, grid_hz: 5, evidence: 'secondary' };
  }
  return null;
}

/** All catalogue channels as a tidy table (one row per channel). */
export function listGroupChannels() {
  return Object.entries(GROUP_CHANNELS).map(([channel, spec]) => ({
    channel,
    kind: spec.kind,
    stream: spec.stream ?? null,
    grid_hz: spec.grid_hz,
    evidence: spec.evidence,
    derived: spec.derived === true,
    hold: spec.hold === true,
  }));
}

function avg2(a, b) {
  const fa = Number.isFinite(a); const fb = Number.isFinite(b);
  if (fa && fb) return (a + b) / 2;
  if (fa) return a;
  if (fb) return b;
  return null;
}

/**
 * Voice-turn state → speaking channel state. `speech` → speaking; silence,
 * pause and turn start → silent; `end` closes the turn (missing after it);
 * the quality states (muted, clipped, playback, contaminated) are kept as
 * themselves so nothing is hidden. Booleans/0-1 map to speaking/silent.
 */
export function speakingState(state) {
  if (state === true || state === 1) return 'speaking';
  if (state === false || state === 0) return 'silent';
  if (typeof state !== 'string' || !state) return null;
  if (state === 'speech') return 'speaking';
  if (state === 'silence' || state === 'pause' || state === 'start') return 'silent';
  if (state === 'end') return null;
  return state;
}

/** 3 × 3 named zone of a screen point in the [-0.5, 0.5] gaze convention. */
export function screenZone(x, y, onScreen) {
  if (onScreen === 0 || onScreen === false) return 'off_screen';
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const col = x < -1 / 6 ? 'left' : (x > 1 / 6 ? 'right' : 'center');
  const row = y < -1 / 6 ? 'top' : (y > 1 / 6 ? 'bottom' : 'middle');
  return `${row}_${col}`;
}
