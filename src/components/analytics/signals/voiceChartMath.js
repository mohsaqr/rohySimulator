/*
 * voiceChartMath — the across-turn derivations behind the Voice tab's session
 * view, ported from Oyon (standalone/app/src/lib/voiceChartMath.js, commit
 * 8e5d8b2): turnTimeComposition, turnMetricSeries and measuredRuns, unchanged.
 *
 * Only these three: they read the per-turn `voice` block rohy stores. Oyon's
 * other voice charts (speech strip, pitch contour, loudness envelope) read a
 * per-frame `frame_series` that only Oyon's own test page records — the
 * library's capture sends per-turn summaries, so rohy has nothing to draw them
 * from, and does not pretend to.
 *
 * Tests: voiceChartMath.test.js, ported from Oyon's app-voice-charts.test.js
 * sections 8 and 9.
 */

// ── Turn time composition ───────────────────────────────────────────────────

/**
 * Decompose a turn's wall-clock duration into the structural parts the
 * aggregator reports, as a proportion bar. Turns four separate numbers
 * (initial silence / speech / pause total / trailing silence) into ONE
 * legible shape: a turn that is mostly leading silence and a turn that is
 * mostly mid-turn hesitation have very different meanings and identical
 * `speech_ratio`s.
 *
 * The residual is REPORTED, never hidden. The parts are measured on the
 * aggregator's frame-time accounting while `turn_duration_ms` is wall-clock,
 * so they need not sum to the whole (dropped frames, a turn stopped between
 * frames). A silently-normalised bar would claim exact accounting the data
 * does not support; instead the leftover appears as an explicit
 * `unaccounted` part, and a NEGATIVE leftover (parts exceeding the
 * wall clock, possible when frame time overruns) is clamped to 0 and
 * surfaced through `overrunMs`.
 *
 * @param {object} voice  a `voice-v1` metrics block
 * @returns {{parts: Array<{key: string, label: string, ms: number}>, totalMs: number,
 *   accountedMs: number, unaccountedMs: number, overrunMs: number} | null}
 *   `null` when the turn has no positive duration — nothing to compose.
 */
export function turnTimeComposition(voice) {
  if (!voice || !Number.isFinite(voice.turn_duration_ms) || voice.turn_duration_ms <= 0) return null;
  const totalMs = voice.turn_duration_ms;
  const ms = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

  // Speech time minus nothing: internal pauses are silence, already outside
  // speech_duration_ms. Playback and muted are separate exclusions the
  // aggregator tracks in their own fields.
  const parts = [
    { key: 'initial_silence', label: 'Initial silence', ms: ms(voice.initial_silence_ms) },
    { key: 'speech', label: 'Speech', ms: ms(voice.speech_duration_ms) },
    { key: 'pause', label: 'Internal pauses', ms: ms(voice.internal_pause_total_ms) },
    { key: 'trailing_silence', label: 'Trailing silence', ms: ms(voice.trailing_silence_ms) },
    { key: 'playback', label: 'AI playback', ms: ms(voice.excluded_playback_ms) },
    { key: 'muted', label: 'Muted', ms: ms(voice.muted_ms) },
  ].filter((part) => part.ms > 0);

  const accountedMs = parts.reduce((sum, part) => sum + part.ms, 0);
  return {
    parts,
    totalMs,
    accountedMs,
    unaccountedMs: Math.max(0, totalMs - accountedMs),
    overrunMs: Math.max(0, accountedMs - totalMs),
  };
}

// ── Across-turn trends ──────────────────────────────────────────────────────

/**
 * Pull one metric across every turn, in order, PRESERVING nulls as gaps.
 * The cross-turn view is the one thing per-turn charts cannot show: whether
 * a speaker got quieter, faster or more hesitant over a session.
 *
 * A turn whose metric was not measured (pitch below the voiced-frame floor,
 * a ratio with a zero denominator) yields `value: null` and is NOT dropped —
 * dropping it would silently close the gap and draw a continuous trend
 * through turns where nothing was measured. `measured` counts the ones that
 * carry a value, so a caller can state "3 of 9 turns" rather than implying
 * the series is complete.
 *
 * @param {Array<object>} turns  stored voice windows (each with a `voice` block)
 * @param {(voice: object, turn: object) => number|null} pick  metric accessor
 * @returns {{points: Array<{index: number, value: number|null, flagged: boolean}>,
 *   n: number, measured: number, min: number|null, max: number|null}}
 */
export function turnMetricSeries(turns, pick) {
  const usable = Array.isArray(turns) ? turns : [];
  const points = [];
  let min = null;
  let max = null;
  let measured = 0;

  usable.forEach((turn, index) => {
    const voice = turn?.voice ?? null;
    const raw = voice ? pick(voice, turn) : null;
    const value = Number.isFinite(raw) ? raw : null;
    if (value !== null) {
      measured += 1;
      if (min === null || value < min) min = value;
      if (max === null || value > max) max = value;
    }
    points.push({ index, value, flagged: voice?.insufficient_data === true });
  });

  return { points, n: points.length, measured, min, max };
}

/**
 * Split a metric series into runs of CONSECUTIVE measured points, so a
 * polyline never bridges a turn where the metric was not measured — the
 * same no-interpolation rule `pitchSegments` enforces within a turn.
 *
 * @param {Array<{index: number, value: number|null}>} points  from `turnMetricSeries`
 * @returns {Array<Array<{index: number, value: number}>>}
 */
export function measuredRuns(points) {
  const usable = Array.isArray(points) ? points : [];
  const runs = [];
  let current = null;
  for (const point of usable) {
    if (point.value === null) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push({ index: point.index, value: point.value });
  }
  return runs;
}
