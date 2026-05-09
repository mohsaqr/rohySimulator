// Verifies the dynajs library (vendored under standalone/vendor/dynajs)
// produces the expected TNA shape when fed the same window data the Oyon
// logs dashboard groups by session. We exercise the same conversion the
// dashboard performs (grouping windows by session_id, normalising
// dominant_emotion to lowercase tokens) so that any drift between the
// emit format and the dynajs input contract trips this test.
import assert from 'node:assert/strict';
import {
  tna,
  centralities,
  stateFrequencies,
  discoverPatterns,
} from '../standalone/vendor/dynajs/index.js';

function normalize(value) {
  if (!value) return 'insufficient';
  return String(value).toLowerCase().replace(/\s+/g, '-');
}

function buildSequencesFromWindows(windows) {
  const bySession = new Map();
  const sorted = windows.slice().sort((a, b) => Date.parse(a.window_end) - Date.parse(b.window_end));
  for (const w of sorted) {
    const sid = w?.context?.session_id || w?.session_id || '__default__';
    const state = normalize(w.dominant_emotion);
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(state);
  }
  return Array.from(bySession.values());
}

const baseWindow = (i, emotion, sessionId = 's1') => ({
  window_id: `w${i}`,
  window_start: new Date(Date.UTC(2026, 4, 8, 0, 0, i * 10)).toISOString(),
  window_end: new Date(Date.UTC(2026, 4, 8, 0, 0, (i + 1) * 10)).toISOString(),
  dominant_emotion: emotion,
  session_id: sessionId,
});

const windows = [
  baseWindow(0, 'neutral'),
  baseWindow(1, 'happy'),
  baseWindow(2, 'happy'),
  baseWindow(3, 'sad'),
  baseWindow(4, 'happy'),
  baseWindow(5, 'happy'),
  baseWindow(6, 'neutral'),
  baseWindow(7, 'neutral'),
  baseWindow(8, 'sad'),
];

const sequences = buildSequencesFromWindows(windows);
assert.equal(sequences.length, 1);
assert.equal(sequences[0].length, 9);

const model = tna(sequences);

// Labels should contain exactly the three observed emotions.
const labels = [...model.labels].sort();
assert.deepEqual(labels, ['happy', 'neutral', 'sad']);

// Row sums must equal 1 for any state that has an outgoing transition.
for (let i = 0; i < model.weights.rows; i += 1) {
  let rowSum = 0;
  for (let j = 0; j < model.weights.cols; j += 1) rowSum += model.weights.get(i, j);
  if (rowSum > 0) assert.ok(Math.abs(rowSum - 1) < 1e-9, `row ${i} sum ${rowSum}`);
}

// Self-loops must be retained (happy -> happy occurs twice in this sequence).
const happyIdx = model.labels.indexOf('happy');
assert.ok(model.weights.get(happyIdx, happyIdx) > 0, 'happy self-loop should be kept');

const cent = centralities(model, { loops: true, normalize: true });
assert.equal(cent.labels.length, 3);
assert.ok(cent.measures.InStrength instanceof Float64Array);

const freq = stateFrequencies(sequences);
assert.equal(freq.happy, 4);
assert.equal(freq.neutral, 3);
assert.equal(freq.sad, 2);

const patterns = discoverPatterns(sequences, { type: 'ngram', len: [2], minFreq: 1 });
assert.ok(Array.isArray(patterns.patterns) && patterns.patterns.length > 0);

console.log('transition-network.test.js passed');
