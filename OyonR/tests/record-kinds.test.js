import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordKindsOf } from '../src/records/index.js';

/*
 * recordKindsOf — what a record set holds — and the app wiring that offers only
 * the dashboard pages a host feed can fill.
 */

// ── the pure half ─────────────────────────────────────────────────────────
{
  const none = recordKindsOf(null);
  assert.deepEqual(none, { windows: false, typing: false, voice: false, events: false, logEvents: false, modalities: [], eventModalities: [] });
  assert.deepEqual(recordKindsOf({}), none, 'an empty object is an empty set');
  assert.deepEqual(recordKindsOf({ windows: 'x', signalWindows: null, signalEvents: 3 }), none, 'a kind that is not an array is an empty set, not a throw');
}
{
  const typingOnly = recordKindsOf({
    signalWindows: [{ modality: 'typing' }, { modality: 'typing' }, null, { modality: 7 }],
    signalEvents: [{ modality: 'typing' }, { modality: 'document_edit' }, { modality: '' }, 'x'],
  });
  assert.equal(typingOnly.windows, false);
  assert.equal(typingOnly.typing, true);
  assert.equal(typingOnly.voice, false);
  assert.equal(typingOnly.events, true);
  assert.deepEqual(typingOnly.modalities, ['typing']);
  assert.deepEqual(typingOnly.eventModalities, ['document_edit', 'typing'], 'sorted, each once, malformed rows skipped');
}
{
  const camera = recordKindsOf({ windows: [{}], signalWindows: [{ modality: 'voice' }], logEvents: [{}] });
  assert.equal(camera.windows, true);
  assert.equal(camera.voice, true);
  assert.equal(camera.typing, false);
  assert.equal(camera.events, false);
  assert.equal(camera.logEvents, true);
}

// ── the app's rule, by its source ─────────────────────────────────────────
const read = (path) => readFileSync(path, 'utf8');
const tabs = read('standalone/app/src/lib/analyzeTabs.ts');
const header = read('standalone/app/src/components/shell/EmbedHeader.tsx');
const analyze = read('standalone/app/src/routes/analyze.tsx');
const bridge = read('standalone/app/src/lib/hostBridge.ts');

{
  // Every tab declares what it reads, from a closed set.
  const rows = [...tabs.matchAll(/\{ to: '(\/analyze\/[a-z-]+)', label: '[^']+', needs: '([a-z]+)' \}/g)];
  assert.equal(rows.length, 14, 'fourteen Analyze tabs (with Patterns (next) and Dynamics (old) while they are retired), each with a need');
  assert.equal(Object.fromEntries(rows.map((m) => [m[1], m[2]]))['/analyze/writing'], 'writing');
  const need = Object.fromEntries(rows.map((m) => [m[1], m[2]]));
  assert.equal(need['/analyze/typing'], 'typing');
  assert.equal(need['/analyze/voice'], 'voice');
  assert.equal(need['/analyze/sequence'], 'sequence');
  assert.equal(need['/analyze/patterns'], 'sequence');
  assert.equal(need['/analyze/patterns-next'], 'sequence');
  assert.equal(need['/analyze/dynamics-old'], 'sequence');
  assert.equal(need['/analyze/logs'], 'any', 'the one log lists every record kind, so any feed fills it');
  assert.match(tabs, /any: true,/, 'a non-empty feed always offers Logs');
  for (const to of ['/analyze/affect', '/analyze/engagement', '/analyze/gaze', '/analyze/sensing', '/analyze/heart-rate', '/analyze/comparison']) {
    assert.equal(need[to], 'windows', `${to} reads interval windows`);
  }
  assert.match(tabs, /if \(!kinds \|\| empty\) return analyzeSubTabs;/, 'no feed, or an empty feed, keeps every tab');
  assert.match(tabs, /sequence: kinds\.windows \|\| kinds\.events/, 'Dynamics and Patterns need windows or events');
}
{
  assert.match(header, /analyzeTabsFor\(fedRecords \? recordKindsOf\(fedRecords\) : null\)/, 'the embedded header offers the tabs the feed can fill');
  assert.ok(!/\.\.\.analyzeSubTabs\]/.test(header), 'the header must not list every tab unconditionally');
  assert.match(analyze, /analyzeLandingFor\(fed \? recordKindsOf\(fed\) : null\)/, '/analyze lands on a tab the feed can fill');
  assert.match(bridge, /channelForFeed\(records \? recordKindsOf\(records\) : null, channels\.channel\)/,
    'a new feed moves the Dynamics channel off one it has no records for');
}

console.log('record-kinds: all passed');
