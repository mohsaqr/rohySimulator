// The payoff test for SignalEventLog (audio_text.md §3.6): a realistic mixed
// typing session recorded through the public record() API must be directly
// consumable by the existing TNA machinery via toSequences(), with no
// adapter/reshape code in between — exactly the same vendored ladyna used by
// tests/transition-network.test.js and the app's TNA pooling.
import assert from 'node:assert/strict';
import { SignalEventLog } from '../src/logging/SignalEventLog.js';
import {
  tna,
  ftna,
  centralities,
  stateCounts,
  discoverPatterns,
} from '../standalone/vendor/ladyna/dist/index.js';

const log = new SignalEventLog({
  now: () => 1_700_000_000_000,
  monotonicNow: () => 0,
});
log.start({ capture_id: 'cap-1', session_id: 'sess-1' });

// One realistic composition episode: opening inserts, a pause, a run of
// deletes, another pause, an IME composition sequence (start/update/update/
// commit — a plausible CJK input), a final insert, a last pause, then submit.
// `target` and `source` are stamped to mirror real host usage (a co-writing
// chat composer, with the IME segment plausibly AI-suggested); neither field
// participates in the state chain ladyna consumes.
const target = { kind: 'chat_composer', id: 'composer-1' };
const session = [
  { state: 'start', source: 'user' },
  { state: 'insert', source: 'user' },
  { state: 'insert', source: 'user' },
  { state: 'pause', source: 'user' },
  { state: 'insert', source: 'user' },
  { state: 'delete', source: 'user' },
  { state: 'delete', source: 'user' },
  { state: 'pause', source: 'user' },
  { state: 'compose', source: 'ai' },
  { state: 'composing', source: 'ai' },
  { state: 'composing', source: 'ai' },
  { state: 'commit', source: 'ai' },
  { state: 'insert', source: 'user' },
  { state: 'pause', source: 'user' },
  { state: 'insert', source: 'user' },
  { state: 'submit', source: 'user' },
];

for (const { state, source } of session) {
  log.record({ modality: 'typing', state, source, target });
}

assert.equal(log.size, session.length);
assert.equal(log.droppedEvents, 0);

const sequences = log.toSequences();
assert.equal(sequences.length, 1, 'a single session must produce a single chain');
assert.deepEqual(sequences[0], session.map((e) => e.state), 'chain must match record() order (sequence_index)');

// --- shape: 8 distinct states, alphabetically labelled by ladyna -------------------
const EXPECTED_LABELS = [
  'start',
  'commit',
  'compose',
  'composing',
  'pause',
  'submit',
  'delete',
  'insert',
].sort();

const relModel = tna(sequences);
assert.deepEqual([...relModel.labels].sort(), EXPECTED_LABELS);
assert.equal(relModel.weights.rows, EXPECTED_LABELS.length);
assert.equal(relModel.weights.cols, EXPECTED_LABELS.length);

// Row sums must equal 1 for any state that has an outgoing transition
// (relative/row-normalized weights — same invariant transition-network.test.js checks).
for (let i = 0; i < relModel.weights.rows; i += 1) {
  let rowSum = 0;
  for (let j = 0; j < relModel.weights.cols; j += 1) rowSum += relModel.weights.get(i, j);
  if (rowSum > 0) assert.ok(Math.abs(rowSum - 1) < 1e-9, `row ${i} sum ${rowSum}`);
}

// --- hand-computed transition counts, via the frequency (raw-count) model ----------
//
// Walking the 16-state chain above by hand, `insert -> pause` occurs at
// positions (2,3) and (12,13) = 2 times; `pause -> insert` occurs at
// positions (3,4) and (13,14) = 2 times. Every other transition in this
// chain is unique (count 1) except the self-loop `delete -> delete`
// (also 2 — see below), so these are clean, unambiguous counts to assert.
const freqModel = ftna(sequences);
const idx = (label) => freqModel.labels.indexOf(label);
assert.equal(freqModel.weights.get(idx('insert'), idx('pause')), 2, 'insert -> pause count');
assert.equal(freqModel.weights.get(idx('pause'), idx('insert')), 2, 'pause -> insert count');

// A second, independent hand-computed pair for extra confidence: the deletion
// self-loop and the unique IME hand-off, both count 1.
assert.equal(freqModel.weights.get(idx('delete'), idx('delete')), 1, 'delete self-loop count');
assert.equal(freqModel.weights.get(idx('commit'), idx('insert')), 1, 'commit -> insert count');

// Total edge count must equal (chain length - 1) = 15 for a single session.
let totalEdges = 0;
for (let i = 0; i < freqModel.weights.rows; i += 1) {
  for (let j = 0; j < freqModel.weights.cols; j += 1) totalEdges += freqModel.weights.get(i, j);
}
assert.equal(totalEdges, session.length - 1);

// --- stateCounts: hand-counted occurrences per state --------------------------
const freq = stateCounts(sequences);
assert.equal(freq.insert, 5);
assert.equal(freq.pause, 3);
assert.equal(freq.delete, 2);
assert.equal(freq.composing, 2);
assert.equal(freq.start, 1);
assert.equal(freq.compose, 1);
assert.equal(freq.commit, 1);
assert.equal(freq.submit, 1);

// --- centralities: same shape check as tests/transition-network.test.js -----------
const cent = centralities(relModel, { loops: true, normalize: true });
assert.equal(cent.labels.length, EXPECTED_LABELS.length);
assert.ok(cent.measures.InStrength instanceof Float64Array);
assert.ok(cent.measures.OutStrength instanceof Float64Array);

// --- pattern discovery still works unmodified over the log's sequences -------------
const patterns = discoverPatterns(sequences, { type: 'ngram', len: [2], minFreq: 1 });
assert.ok(Array.isArray(patterns.patterns) && patterns.patterns.length > 0);
// ladyna joins n-gram states with "->"; pause->insert occurs twice (see
// the hand count above), so it must surface here with frequency 2.
const pauseToInsert = patterns.patterns.find((p) => p.pattern === 'pause->insert');
assert.ok(pauseToInsert, 'the pause->insert 2-gram must be discoverable from the log-derived sequence');
assert.equal(pauseToInsert.frequency, 2);

// --- toLongFormat is directly usable alongside toSequences (same event set) --------
const rows = log.toLongFormat();
assert.equal(rows.length, session.length);
assert.deepEqual(rows.map((r) => r.state), sequences[0]);

console.log('signal-event-tna.test.js passed');
