// Per-session TNA pooling (standalone/app/src/lib/tnaPooling.js):
// aggregating DISTINCT sessions must not fabricate a transition between one
// session's last state and the next session's first state.

import assert from 'node:assert/strict';
import {
  buildSessionSequences,
  pooledTransitionCounts,
} from '../standalone/app/src/lib/tnaPooling.js';

const w = (session, emotion, end) => ({
  session_id: session,
  dominant_emotion: emotion,
  window_end: end,
});

// Session A ends in 'sad'; session B begins with 'happy'. A mega-sequence
// would count a phantom sad→happy transition; per-session chains must not.
const WINDOWS = [
  w('A', 'neutral', '2026-06-11T10:00:10Z'),
  w('A', 'happy', '2026-06-11T10:00:20Z'),
  w('A', 'sad', '2026-06-11T10:00:30Z'),
  w('B', 'happy', '2026-06-11T11:00:10Z'),
  w('B', 'happy', '2026-06-11T11:00:20Z'),
  w('B', 'sad', '2026-06-11T11:00:30Z'),
];

// ─── chains are per-session and time-ordered ──────────────────────────────
const sequences = buildSessionSequences(WINDOWS);
assert.equal(sequences.length, 2);
assert.deepEqual(sequences[0], ['neutral', 'happy', 'sad']);
assert.deepEqual(sequences[1], ['happy', 'happy', 'sad']);

// Out-of-order input is sorted within each session.
const shuffled = buildSessionSequences([WINDOWS[2], WINDOWS[5], WINDOWS[0], WINDOWS[3], WINDOWS[1], WINDOWS[4]]);
assert.deepEqual(shuffled.find((s) => s[0] === 'neutral'), ['neutral', 'happy', 'sad']);

// ─── pooled counts: no cross-session phantom ──────────────────────────────
const counts = pooledTransitionCounts(sequences);
assert.equal(counts.get('sad→happy'), undefined, 'phantom cross-session transition!');
assert.equal(counts.get('neutral→happy'), 1);
assert.equal(counts.get('happy→sad'), 2); // once per session, pooled
assert.equal(counts.get('happy→happy'), 1);
// Total transitions = (3-1) + (3-1) = 4, not 5 (mega-sequence would give 5).
let total = 0;
for (const n of counts.values()) total += n;
assert.equal(total, 4);

// ─── normalization mirrors dashboard.js ───────────────────────────────────
const norm = buildSessionSequences([w('X', 'Very Happy', '2026-06-11T10:00:00Z'), w('X', null, '2026-06-11T10:00:10Z')]);
assert.deepEqual(norm, [['very-happy', 'insufficient']]);

// ─── single window / empty input ──────────────────────────────────────────
assert.deepEqual(buildSessionSequences([]), []);
assert.deepEqual(buildSessionSequences([w('only', 'happy', '2026-06-11T10:00:00Z')]), [['happy']]);
assert.equal(pooledTransitionCounts([['happy']]).size, 0);

console.log('app-tna-pooling.test.js — all cases passed');
