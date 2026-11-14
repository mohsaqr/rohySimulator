import assert from 'node:assert/strict';
import {
  aoiTransitionMatrix,
  activeSubchain,
  toProbabilityMatrix,
} from '../src/analytics/AoiTransitionMatrix.js';
import { transitionEntropy } from '../standalone/vendor/tnaj/index.js';

const w = (transitions) => ({ gaze: { aoi_transitions: transitions } });
const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

// A — Counts pool across windows; labels come from both endpoints.
{
  const m = aoiTransitionMatrix([
    w({ 'a→b': 2, 'b→a': 1 }),
    w({ 'a→b': 1, 'b→c': 3 }),
  ]);
  assert.deepEqual(m.labels, ['a', 'b', 'c']);
  assert.equal(m.nTransitions, 7);
  assert.equal(m.windows, 2);
  assert.deepEqual(m.counts, [
    [0, 3, 0],   // a→b pooled 2 + 1
    [1, 0, 3],   // b→a, b→c
    [0, 0, 0],   // c was only ever a destination
  ]);
  assert.deepEqual(m.rowTotals, [3, 4, 0]);
}

// B — A configured-but-never-visited AOI must stay in the state space.
//     Dropping it shrinks n, which inflates every entropy normalized by
//     log(n) — the state set is a property of the layout, not of the gaze.
{
  const withLabels = aoiTransitionMatrix([w({ 'a→b': 4 })], { labels: ['a', 'b', 'unseen'] });
  assert.deepEqual(withLabels.labels, ['a', 'b', 'unseen']);
  assert.equal(withLabels.counts.length, 3);
  assert.deepEqual(withLabels.counts[2], [0, 0, 0]);

  const without = aoiTransitionMatrix([w({ 'a→b': 4 })]);
  assert.equal(without.labels.length, 2, 'unlabelled call cannot know the AOI existed');
}

// C — Adequacy is reported, not silently assumed. This is the whole reason
//     the per-window scalar was removed.
{
  const thin = aoiTransitionMatrix([w({ 'a→b': 3 })]);
  assert.equal(thin.adequate, false, '3 transitions cannot support an entropy estimate');
  assert.equal(thin.minTransitions, 5 * 2);

  const fat = aoiTransitionMatrix([w({ 'a→b': 40, 'b→a': 40 })]);
  assert.equal(fat.adequate, true);

  const forced = aoiTransitionMatrix([w({ 'a→b': 3 })], { minTransitions: 1 });
  assert.equal(forced.adequate, true, 'callers may set their own floor');
}

// D — Row normalization. An absorbing state keeps an ALL-ZERO row; filling it
//     with 1/n would invent branching that never occurred.
{
  const m = aoiTransitionMatrix([w({ 'a→b': 3, 'a→c': 1 })]);
  const P = toProbabilityMatrix(m);
  const a = m.labels.indexOf('a');
  const b = m.labels.indexOf('b');
  const c = m.labels.indexOf('c');
  close(P[a][b], 0.75);
  close(P[a][c], 0.25);
  assert.deepEqual(P[b], [0, 0, 0], 'b was entered and never left — absorbing, not uniform');
}

// D2 — tnaj REJECTS zero-sum rows, so they must be pruned before it sees the
//      matrix. Found by running this for real, not by reasoning about it: a
//      chain with an absorbing state has no unique stationary distribution, so
//      throwing is correct behaviour on tnaj's part.
{
  const m = aoiTransitionMatrix([w({ 'a→b': 5, 'b→a': 5 })], {
    labels: ['a', 'b', 'never_looked_at'],
  });
  assert.throws(
    () => transitionEntropy(toProbabilityMatrix(m), { base: 2 }),
    /zero-sum row|not ergodic/i,
    'the padded matrix must be rejected, not silently mis-analysed',
  );

  const chain = activeSubchain(m);
  assert.deepEqual(chain.labels, ['a', 'b']);
  assert.deepEqual(chain.dropped, ['never_looked_at']);
  assert.equal(chain.nTransitions, 10);
  assert.doesNotThrow(() => transitionEntropy(toProbabilityMatrix(chain), { base: 2 }));
}

// D3 — Pruning must ITERATE. Removing `sink` strands `feeder`, whose only
//      outgoing transition pointed at it; one pass would leave a zero row.
{
  const m = aoiTransitionMatrix([w({ 'a→b': 4, 'b→a': 4, 'feeder→sink': 2 })]);
  const chain = activeSubchain(m);
  assert.deepEqual(chain.labels, ['a', 'b']);
  assert.deepEqual(chain.dropped.sort(), ['feeder', 'sink']);
  for (const total of chain.rowTotals) assert.ok(total > 0, 'no zero row may survive');
}

// D4 — A scanpath that never returns anywhere prunes to nothing, and says so
//      rather than producing a confident number over one state.
{
  const chain = activeSubchain(aoiTransitionMatrix([w({ 'a→b': 1 })]));
  assert.equal(chain.labels.length, 0);
  assert.equal(chain.nTransitions, 0);
  assert.deepEqual(chain.dropped.sort(), ['a', 'b']);
}

// E — End to end against tnaj: a deterministic cycle a→b→c→a has zero
//     entropy rate (the next state is certain) but maximal stationary
//     entropy (all three visited equally). That gap IS the redundancy, and
//     it is the number the removed per-window field was groping for.
{
  const m = aoiTransitionMatrix([w({ 'a→b': 10, 'b→c': 10, 'c→a': 10 })]);
  const te = transitionEntropy(toProbabilityMatrix(m), { base: 2 });

  close(te.entropyRate, 0, 1e-9);
  close(te.stationaryEntropy, Math.log2(3), 1e-6);
  close(te.redundancy, Math.log2(3), 1e-6);
  close(te.redundancyNorm, 1, 1e-6);
}

// F — The opposite pole: a memoryless chain, where every row equals the
//     stationary distribution, has redundancy zero.
{
  const m = aoiTransitionMatrix([w({
    'a→a': 10, 'a→b': 10, 'b→a': 10, 'b→b': 10,
  })]);
  const te = transitionEntropy(toProbabilityMatrix(m), { base: 2 });

  close(te.entropyRate, 1, 1e-6);
  close(te.stationaryEntropy, 1, 1e-6);
  close(te.redundancy, 0, 1e-6);
}

// G — Malformed input is skipped, never coerced. `Number(null)` is 0 and
//     Number.isFinite(0) is true, so a blind coercion would invent counts.
{
  const m = aoiTransitionMatrix([
    w({ 'a→b': 5, 'a→b→c': 2, 'noarrow': 9, '→b': 1, 'a→': 1 }),
    w({ 'a→b': null, 'b→a': -3, 'b→c': undefined }),
    { gaze: { aoi_transitions: null } },
    null,
    'nonsense',
  ]);
  assert.equal(m.nTransitions, 7, 'only a→b (5) and the a→b→c pair (2) are well-formed');
  // 'a→b→c' splits at the FIRST arrow, giving a → "b→c" — a real id by our
  // rules. Documenting the behaviour rather than pretending it cannot happen.
  assert.ok(m.labels.includes('b→c'));
  assert.ok(!m.labels.includes('noarrow'));
}

// G2 — Both arrow spellings are accepted. GazeAggregator emits U+2192, but
//      the demo fixture carried ASCII '->' for a long time and nothing ever
//      split the key, so stored data can contain either. Dropping one spelling
//      would silently zero out a whole dataset.
{
  const unicode = aoiTransitionMatrix([w({ 'a→b': 3 })]);
  const ascii = aoiTransitionMatrix([w({ 'a->b': 3 })]);
  assert.deepEqual(ascii.labels, unicode.labels);
  assert.deepEqual(ascii.counts, unicode.counts);
  assert.equal(ascii.nTransitions, 3);

  // Mixed spellings in one dataset must pool into the SAME cell, not two.
  const mixed = aoiTransitionMatrix([w({ 'a→b': 2 }), w({ 'a->b': 5 })]);
  assert.deepEqual(mixed.labels, ['a', 'b']);
  assert.equal(mixed.nTransitions, 7);
  assert.equal(mixed.counts[0][1], 7);
}

// H — Bare gaze blocks and wrapped records give the same answer.
{
  const bare = aoiTransitionMatrix([{ aoi_transitions: { 'a→b': 2 } }]);
  const wrapped = aoiTransitionMatrix([w({ 'a→b': 2 })]);
  assert.deepEqual(bare.counts, wrapped.counts);
}

// I — Empty input degrades to an empty matrix, not a throw.
{
  const m = aoiTransitionMatrix([]);
  assert.deepEqual(m.labels, []);
  assert.equal(m.nTransitions, 0);
  assert.equal(m.adequate, false);
  assert.deepEqual(toProbabilityMatrix(m), []);
}

console.log('aoi-transition-matrix: all assertions passed');
