// Regression checks for the Codex review fixes in standalone/app that live in
// React/TS files (not importable by node): read the source and pin the
// contract, plus the plain-JS helpers they use. Plain node, throws on failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extent } from '../standalone/app/src/lib/extent.js';

const read = (p) => readFileSync(new URL(`../standalone/app/src/${p}`, import.meta.url), 'utf8');

// ─── #28 extrema of long series without spreading into Math.min/max ───────
{
  const n = 300_000;
  const big = Array.from({ length: n }, (_, i) => Math.sin(i / 1000) * 10 + (i === 123_456 ? 50 : 0));
  assert.throws(() => Math.max(...big), RangeError, 'the old expression fails at this length');
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of big) { if (v < lo) lo = v; if (v > hi) hi = v; }
  assert.deepEqual(extent(big), { min: lo, max: hi });
  assert.equal(hi, big[123_456], 'the planted spike is the maximum');
  assert.deepEqual(extent([3, null, NaN, Infinity, 'x', -2]), { min: -2, max: 3 }, 'non-finite skipped');
  assert.equal(extent([]), null);
  assert.equal(extent([null, NaN]), null);
  assert.deepEqual(extent([2, 5], { include: [0] }), { min: 0, max: 5 });
  assert.deepEqual(extent([-1], { include: [Number.NaN] }), { min: -1, max: -1 });
  for (const f of ['components/group/MemberRibbons.tsx', 'components/group/SynchronyStrip.tsx', 'components/charts/VoicePitchContour.tsx', 'components/sensing/SensingCharts.tsx']) {
    const src = read(f);
    assert.match(src, /extent\(/, `${f} uses extent`);
    assert.doesNotMatch(src, /Math\.(min|max)\(\.\.\.(vals|f0s|v)\b/, `${f} spreads no series`);
  }
}

// ─── #24 InfoTip: panel in the embed's shadow root, shadow-safe outside click ─
{
  const src = read('components/ui/InfoTip.tsx');
  assert.match(src, /composedPath\(\)/, 'outside click read through composedPath');
  assert.match(src, /root instanceof ShadowRoot/);
  assert.match(src, /querySelector\('\.oyon-app-host'\)/, 'portal into the styled host inside the shadow root');
  assert.match(src, /pos\.container,\n\s*\) : null/, 'portal target is the overlay container, not always <body>');
  assert.match(read('element.tsx'), /host\.className = 'oyon-app-host'/, 'the element creates the host the panel joins');
  assert.match(read('styles/element.css'), /contain: layout/, 'host is the fixed containing block the offsets are taken from');
}

// ─── #26 legacy Patterns: the grain recomputes, failures are shown ─────────
{
  const src = read('components/patterns/PatternsPanel.tsx');
  assert.match(src, /\[windows, events, channel, writingLevel\]/, 'writingLevel in the sequences memo deps');
  assert.doesNotMatch(src, /catch \{ \/\* ignore \*\/ \}/, 'no swallowed pattern failures');
  assert.match(src, /Could not compute: \{shortError\}/);
  assert.match(src, /Could not compute: \{longError\}/);
  assert.match(src, /No tree: \{treeError/);
  assert.match(src, /hypaCounts\.skipped/);
  assert.match(src, /contextTree\(gapFreeRuns\(sequences\)/, 'the old tree is cut at gaps too (ladyna gapFreeRuns)');
  const views = read('lib/patternViews.js');
  assert.match(views, /gapFreeRuns \} from 'ladyna\/sequences'|gapFreeRuns, *\} from 'ladyna\/sequences'|describeSequences, gapFreeRuns \} from 'ladyna\/sequences'/, 'gap cut comes from ladyna');
  assert.doesNotMatch(views, /function gapFreeSegments/, 'no hand-rolled gap splitter in Oyon');
}

// ─── #16 Logs: no whole-archive re-read on a timer when nothing is live ────
{
  const store = read('lib/runtimeLogStore.ts');
  assert.match(store, /logReader \?\?= new IndexedDbLogTransport/, 'one log reader (one connection) reused');
  assert.match(store, /metricReader \?\?= new IndexedDbMetricTransport/);
  assert.doesNotMatch(store, /readOrEmpty\(\(\) => new IndexedDb/, 'no fresh transport per read');
  const hook = read('lib/logRecords.ts');
  assert.match(hook, /refetchInterval: runtimeLogPoll\(readsLocal, liveSessionId\)/);
  assert.match(hook, /return readsLocal && liveSessionId != null \? RUNTIME_LOG_LIVE_POLL_MS : false;/, 'polls only while a capture is live');
}

// ─── #8 every local record kind is narrowed like the windows ──────────────
{
  const src = read('lib/signalSource.ts');
  assert.match(src, /narrowLocal\(local\.data, \{ embedded, currentSessionId, filterScope, sessionIds, userIds, keyFilters \}\)/);
  assert.match(read('lib/overviewRecords.ts'), /useStoredEvents\(\{ all: true \}\)/, 'the Overview lists the whole store and narrows itself');
}

// ─── #14 a partly estimable matrix: the warning shows on the page ─────────
assert.match(read('components/group/NetworkFigure.tsx'), /view\.warning \? <p role="note"/);

console.log('app-review-contracts tests passed');
