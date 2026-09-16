// Ported from Oyon's tests/app-voice-charts.test.js, sections 8 and 9
// (node:assert blocks kept verbatim).

import assert from 'node:assert/strict';
import { it } from 'vitest';
import { turnTimeComposition, turnMetricSeries, measuredRuns } from './voiceChartMath.js';

it('turnTimeComposition reports the residual and the overrun instead of normalising them away', () => {
  assert.equal(turnTimeComposition(null), null);
  assert.equal(turnTimeComposition({ turn_duration_ms: 0 }), null, 'no duration, nothing to compose');

  const composition = turnTimeComposition({
    turn_duration_ms: 10000,
    initial_silence_ms: 1000,
    speech_duration_ms: 6000,
    internal_pause_total_ms: 1500,
    trailing_silence_ms: 500,
    excluded_playback_ms: 0,
    muted_ms: 0,
  });
  assert.deepEqual(composition.parts.map((p) => p.key), [
    'initial_silence', 'speech', 'pause', 'trailing_silence',
  ], 'zero-length parts are dropped, order is fixed');
  assert.equal(composition.accountedMs, 9000);
  assert.equal(composition.unaccountedMs, 1000, 'the residual is reported, not normalised away');
  assert.equal(composition.overrunMs, 0);

  // Frame time overrunning wall clock is surfaced, not clamped into a
  // silently-shrunk bar.
  const over = turnTimeComposition({
    turn_duration_ms: 1000,
    initial_silence_ms: 0,
    speech_duration_ms: 1400,
    internal_pause_total_ms: 0,
    trailing_silence_ms: 0,
    excluded_playback_ms: 0,
    muted_ms: 0,
  });
  assert.equal(over.unaccountedMs, 0);
  assert.equal(over.overrunMs, 400);
});

it('turnMetricSeries keeps unmeasured turns as gaps and measuredRuns never bridges them', () => {
  const turns = [
    { voice: { pitch_median_hz: 120, insufficient_data: false } },
    { voice: { pitch_median_hz: null, insufficient_data: true } },
    { voice: { pitch_median_hz: 140, insufficient_data: false } },
    { voice: { pitch_median_hz: 150, insufficient_data: true } },
  ];
  const series = turnMetricSeries(turns, (voice) => voice.pitch_median_hz);
  assert.equal(series.n, 4, 'every turn keeps a slot — unmeasured turns are not dropped');
  assert.equal(series.measured, 3);
  assert.equal(series.points[1].value, null, 'an unmeasured turn is null, never 0');
  assert.deepEqual(series.points.map((p) => p.flagged), [false, true, false, true]);
  assert.equal(series.min, 120);
  assert.equal(series.max, 150);

  // The polyline must BREAK at the gap rather than bridging turns 0 → 2.
  const runs = measuredRuns(series.points);
  assert.deepEqual(
    runs.map((run) => run.map((point) => point.index)),
    [[0], [2, 3]],
    'a run never spans an unmeasured turn',
  );

  // Non-finite values are treated as absent, not plotted at their raw value.
  const dirty = turnMetricSeries(
    [{ voice: { x: Number.NaN } }, { voice: { x: Infinity } }, { voice: { x: 3 } }],
    (voice) => voice.x,
  );
  assert.equal(dirty.measured, 1);
  assert.equal(dirty.min, 3);

  assert.deepEqual(turnMetricSeries(null, () => 1).points, []);
  assert.deepEqual(measuredRuns(null), []);
});
