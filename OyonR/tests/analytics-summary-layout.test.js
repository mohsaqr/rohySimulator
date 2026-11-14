import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `${start} must appear before ${end}`);
  return source.slice(from, to);
}

function assertMetricBand(source, start, end, count) {
  const band = section(source, start, end);
  assert.equal((band.match(/<Metric\b/g) || []).length, count, `${start} must expose ${count} aligned headline metrics`);
  assert.match(band, /grid-cols-2[^"']*gap-3/, `${start} needs the shared compact metric grid`);
}

const sequence = read('standalone/app/src/routes/analyze/sequence.tsx');
assertMetricBand(sequence, 'id="seq-overview"', 'id="seq-network"', 6);
assert.match(sequence, /includeOverview: false/, 'spell detail must not repeat the headline sequence metrics');

const patterns = read('standalone/app/src/components/patterns/PatternsPanel.tsx');
assertMetricBand(patterns, 'id="pat-overview"', 'id="pat-simplicial"', 6);

const comparison = read('standalone/app/src/routes/analyze/comparison.tsx');
assertMetricBand(comparison, 'id="cmp-overview"', 'id="cmp-timelines"', 6);
assert.match(comparison, /id="cmp-distribution"[\s\S]*className="flex flex-col gap-4"/,
  'variable comparison groups must stack symmetrically instead of leaving an orphan card');

const logs = read('standalone/app/src/routes/analyze/logs.tsx');
// The one log: counts live in the kind tabs (no metric band above the table),
// and the rows are oyon's toLogRows, read through useLogRows.
assert.match(logs, /useLogRows\(\)/, 'Logs reads every record kind through useLogRows');
assert.match(logs, /<LogTable /, 'Logs lists rows in the LogTable');
assert.doesNotMatch(logs, /<Metric /, 'no metric band before the log');

const heart = read('standalone/app/src/routes/analyze/heartRate.tsx');
assertMetricBand(heart, 'id="hr-kpis"', 'id="hr-trend"', 8);
assert.doesNotMatch(heart, /id="hr-lighting"/, 'lighting quality belongs on Sensor diagnostics');

const position = read('standalone/app/src/routes/analyze/sensing.tsx');
const positionBand = section(position, 'id="position-kpis"', 'id="position-facial"');
assert.match(positionBand, /hasFacial && hasPosture \? 'lg:grid-cols-4' : 'lg:grid-cols-2'/,
  'conditional position metrics must use two or four complete columns');

// Statistics live in ladyna (Codex review #25): the app shows them, never computes them.
{
  const dyn = read('standalone/app/src/components/analytics/AffectDynamicsPanel.tsx');
  assert.match(dyn, /from 'ladyna\/stats'/, 'affect dynamics come from ladyna seriesDynamics');
  assert.doesNotMatch(dyn, /Math\.sqrt|instability \/ |STRUCTURE_THRESHOLD/, 'no RMSSD/SD arithmetic or thresholds in the panel');
  assert.match(sequence, /describeSequences/, 'sequence overview uses ladyna describeSequences');
  assert.doesNotMatch(sequence, /Math\.log2/, 'no hand-rolled entropy');
  const regime = read('standalone/app/src/components/group/RegimeBand.tsx');
  assert.doesNotMatch(regime, /n \/ outOf/, 'transition shares are ladyna tna probabilities');
  const timeline = read('src/group/timeline.js');
  assert.doesNotMatch(timeline, /person_z'\s*\?|\(raw - m\) \/ s/, 'person-z is ladyna normalizeTimeline, not oyon/group');
}

console.log('analytics-summary-layout.test.js — all cases passed');
