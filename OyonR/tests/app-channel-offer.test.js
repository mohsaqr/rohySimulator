// Tests for standalone/app/src/lib/channelOffer.js — which channels the
// Analyze channel picker offers. Plain node, throws on failure.

import assert from 'node:assert/strict';
import { recordKindsOf } from '../src/index.js';
import { offeredChannels } from '../standalone/app/src/lib/channelOffer.js';

const OPTIONS = ['emotion', 'typing', 'voice', 'discourse', 'interaction', 'ai_assist', 'writing', 'document_edit', 'code_run', 'all']
  .map((value) => ({ value, label: value }));
const values = (offered) => offered.map((o) => o.value);
const enabled = (offered) => offered.filter((o) => !o.disabled).map((o) => o.value);
const kinds = (windows, modalities) => recordKindsOf({
  windows: Array.from({ length: windows }, (_, i) => ({ session_id: 's', window_index: i })),
  signalEvents: modalities.map((modality) => ({ modality })),
});

// Every channel is always listed, in picker order; the ones without records are disabled and say so.
{
  const out = offeredChannels(OPTIONS, kinds(3, []), 'emotion');
  assert.deepEqual(values(out), values(OPTIONS));
  assert.deepEqual(enabled(out), ['emotion']);
  const typing = out.find((o) => o.value === 'typing');
  assert.equal(typing.disabled, true);
  assert.equal(typing.label, 'typing · no data');
  assert.equal(out[0], OPTIONS[0], 'an enabled option is the caller\'s own object');
}
// The channel in use is never disabled.
assert.deepEqual(enabled(offeredChannels(OPTIONS, kinds(3, []), 'discourse')), ['emotion', 'discourse']);

// Events: each channel with its own events; "All channels" needs two; "Writing acts" needs document edits.
assert.deepEqual(enabled(offeredChannels(OPTIONS, kinds(0, ['typing', 'typing']), 'typing')), ['typing']);
assert.deepEqual(
  enabled(offeredChannels(OPTIONS, kinds(2, ['typing', 'document_edit']), 'emotion')),
  ['emotion', 'typing', 'writing', 'document_edit', 'all'],
);

// Nothing stored: every channel enabled, so Affect and its demo-data button stay reachable.
assert.deepEqual(enabled(offeredChannels(OPTIONS, kinds(0, []), 'discourse')), values(OPTIONS));
assert.equal(offeredChannels(OPTIONS, kinds(0, []), 'discourse'), OPTIONS);

assert.deepEqual(enabled(offeredChannels(OPTIONS, kinds(1, ['code_run', 'ai_assist']), 'emotion')), ['emotion', 'ai_assist', 'code_run', 'all']);

console.log('app-channel-offer: ok');

// ─── app-wide state colours (standalone/app/src/lib/stateColours.js) ───────
{
  const { stateColourMap, resetStateColours, OKABE_ITO, EMOTION_COLOURS, LEVEL_COLOURS } = await import('../standalone/app/src/lib/stateColours.js');
  const { OYON_TYPING_STATES } = await import('../src/version.js');
  // An emotion keeps its colour whichever other states are present.
  const a = stateColourMap(['neutral', 'happy']);
  const b = stateColourMap(['sad', 'neutral', 'fear', 'happy', null, '']);
  assert.equal(a.neutral, b.neutral);
  assert.equal(a.happy, EMOTION_COLOURS.happy);
  assert.equal(new Set(Object.values(EMOTION_COLOURS)).size, Object.keys(EMOTION_COLOURS).length, 'every emotion its own colour');
  assert.deepEqual(Object.keys(b), ['fear', 'happy', 'neutral', 'sad'], 'missing states get no colour');
  // Levels take the Okabe–Ito ramp.
  assert.deepEqual(stateColourMap(['high', 'low', 'mid']), { high: LEVEL_COLOURS.high, low: LEVEL_COLOURS.low, mid: LEVEL_COLOURS.mid });
  // Codex #23: other states are Okabe–Ito too, and a state's colour never
  // depends on which other states are present (filtering does not recolour).
  resetStateColours();
  const OKABE_ALL = new Set([...OKABE_ITO, '#999999', '#DDDDDD']);
  const aoi = stateColourMap(['slide', 'code', 'chat']);
  assert.deepEqual(Object.keys(aoi), ['chat', 'code', 'slide']);
  assert.equal(new Set(Object.values(aoi)).size, 3, 'distinct within a small set');
  const fewer = stateColourMap(['slide', 'code']);
  assert.equal(fewer.code, aoi.code, 'removing a state keeps the others\' colours');
  assert.equal(fewer.slide, aoi.slide);
  const typing = stateColourMap([...OYON_TYPING_STATES]);
  const typingLater = stateColourMap(['pause', 'delete']);
  assert.equal(typingLater.delete, typing.delete, 'a known state is fixed by its vocabulary');
  assert.equal(typingLater.pause, typing.pause);
  assert.equal(stateColourMap(['insert']).insert, OKABE_ITO[1], 'insert is typing state 2');
  for (const map of [aoi, typing, stateColourMap(['write', 'revise', 'ai', 'm1:low', 'all_high', 'mixed'])]) {
    for (const hex of Object.values(map)) assert.ok(OKABE_ALL.has(hex), `${hex} is Okabe–Ito`);
  }
  for (const hex of [...Object.values(EMOTION_COLOURS), ...Object.values(LEVEL_COLOURS)]) assert.ok(OKABE_ALL.has(hex), `${hex} is Okabe–Ito`);
  console.log('state colours: ok');
}
