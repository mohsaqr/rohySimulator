import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * /analyze surface contracts introduced with the Typing dashboard:
 *
 *   1. Tab order + frozen route ids. analyzeTabs.ts promises route ids never
 *      change even when labels/order do ('/analyze/sequence' stays the
 *      dynamics tab). The reading order Dynamics -> Patterns -> Typing is a
 *      deliberate product decision — freeze both so a drive-by "tidy up"
 *      has to be deliberate.
 *   2. Shared channel state. Dynamics and Patterns must read the SAME
 *      channel selection (lib/channelStore.ts), not per-screen useState —
 *      that regression would be silent: both screens keep working, they
 *      just stop agreeing.
 *   3. The typing route actually exists everywhere it must: route
 *      definition, router registration, and the tab row.
 *   4. Null discipline on the typing dashboard: several typing metrics are
 *      deliberately null ("not measured"); the aggregation module must keep
 *      its documented null contract rather than defaulting to 0.
 */

const tabs = readFileSync('standalone/app/src/lib/analyzeTabs.ts', 'utf8');
const routes = readFileSync('standalone/app/src/routes/analyze.tsx', 'utf8');
const router = readFileSync('standalone/app/src/router.ts', 'utf8');
const sequence = readFileSync('standalone/app/src/routes/analyze/sequence.tsx', 'utf8');
const patterns = readFileSync('standalone/app/src/components/patterns/PatternsPanel.tsx', 'utf8');
const channelStore = readFileSync('standalone/app/src/lib/channelStore.ts', 'utf8');
const typingView = readFileSync('standalone/app/src/routes/analyze/typing.tsx', 'utf8');
// The pooled summary moved into the library (src/analytics/
// TypingEpisodeAnalytics.js) so hosts can compute the same figures; its
// nullable contract is declared in types/typing.d.ts and the app module
// re-exports it.
const typingAnalytics = readFileSync('types/typing.d.ts', 'utf8');
const typingAnalyticsReexport = readFileSync('standalone/app/src/lib/typingAnalytics.ts', 'utf8');

// ---- 1. Tab order + frozen route ids ----
const tabEntries = [...tabs.matchAll(/\{\s*to:\s*'([^']+)',\s*label:\s*'([^']+)'(?:,\s*needs:\s*'[a-z]+')?\s*\}/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const tabIds = tabEntries.map((t) => t.to);

const sequenceTab = tabEntries.find((t) => t.to === '/analyze/sequence');
assert.ok(sequenceTab, 'the dynamics tab must keep its frozen /analyze/sequence route id');
assert.equal(sequenceTab.label, 'Dynamics', 'the /analyze/sequence tab is labelled "Dynamics"');

const seqIdx = tabIds.indexOf('/analyze/sequence');
assert.equal(
  tabIds[seqIdx + 1],
  '/analyze/patterns',
  'Patterns must sit immediately after Dynamics',
);
// The camera tabs follow the analysis tabs; typing, writing and voice come after them (owner's order, 2026-11-14).
const camera = ['/analyze/engagement', '/analyze/gaze', '/analyze/sensing', '/analyze/heart-rate'].map((t) => tabIds.indexOf(t));
const text = ['/analyze/typing', '/analyze/writing', '/analyze/voice'].map((t) => tabIds.indexOf(t));
assert.ok([...camera, ...text].every((i) => i > seqIdx + 1), 'camera and text tabs come after Dynamics and Patterns');
assert.ok(Math.max(...camera) < Math.min(...text), 'Attention, Gaze, Position and Heart come before Typing, Writing and Voice');
assert.deepEqual(text, [...text].sort((x, y) => x - y), 'Typing, Writing, Voice in that order');

const typingTab = tabEntries.find((t) => t.to === '/analyze/typing');
assert.equal(typingTab.label, 'Typing', 'the typing tab is labelled "Typing"');

// ---- 2. Shared channel state ----
assert.match(channelStore, /useChannelStore\s*=\s*create<ChannelState>/,
  'channelStore.ts must export the zustand store');
assert.match(channelStore, /channel:\s*'emotion'/,
  'the shared channel default must stay emotion (current behaviour unchanged)');
for (const [name, src] of [['sequence.tsx', sequence], ['PatternsPanel.tsx', patterns]]) {
  assert.match(src, /useChannelStore/, `${name} must read the shared channel store`);
  assert.doesNotMatch(src, /useState<AnalyticsChannel>/,
    `${name} must not keep a private channel selection alongside the shared store`);
}

// ---- 3. Typing route registered everywhere ----
assert.match(routes, /analyzeTypingRoute\s*=\s*createRoute/,
  'routes/analyze.tsx must define the typing route');
assert.match(routes, /path:\s*'\/typing'/, 'the typing route path is /typing');
assert.match(router, /analyzeTypingRoute/, 'router.ts must register the typing route');
assert.match(typingView, /TypingStatsPanel/,
  'the typing view must reuse the shared per-episode TypingStatsPanel');

// ---- 4. Null discipline ----
// The pooled words/product/pause-location figures must be able to say
// "not measured": the summary type declares them nullable, and the view
// renders Metric (which draws null as an em dash) rather than coercing.
for (const field of [
  'productRatio: number | null',
  'wordsPerMin: number | null',
  'pauseLocationCounts: Record<string, number> | null',
  'revisionDistanceMean: number | null',
  'leadingEdgeRevisionRatio: number | null',
  'correctionCount: number | null',
]) {
  assert.ok(
    typingAnalytics.includes(field),
    `the TypingAggregateSummary type must keep "${field}" nullable — null means "not measured", never 0`,
  );
}
assert.match(typingAnalyticsReexport, /aggregateTypingEpisodes[\s\S]*from 'oyon'/,
  'the app must use the library\'s pooled typing summary, not a private copy');

console.log('app-analyze-typing contracts OK');
