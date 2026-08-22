import assert from 'node:assert/strict';
import { DiscourseAggregator } from '../src/aggregation/DiscourseAggregator.js';
import { SignalEventLog } from '../src/logging/SignalEventLog.js';
import { validateEmotionEvent } from '../src/validation/validateEmotionPayload.js';
import { tna, stateCounts } from '../standalone/vendor/ladyna/dist/index.js';

// ---------- A. Single analyze() + finalize(): window shape and metrics ----------
{
  const agg = new DiscourseAggregator({ now: () => 2000 });
  assert.equal(agg.active, false);

  const events = agg.analyze('Can you explain the second theme? The reaction slows down.', {
    timestamp: 500,
    wallTimestamp: 1000,
  });
  assert.equal(agg.active, true);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.state), ['request', 'statement']);
  assert.ok(events.every((e) => e.modality === 'discourse'));
  assert.ok(events.every((e) => e.source === 'user'));

  const win = agg.finalize({ timestamp: 900 });
  assert.ok(win);
  assert.equal(agg.active, false);
  assert.equal(win.modality, 'discourse');
  assert.equal(win.window_kind, 'episode');
  assert.equal(win.feature_profile, 'text-v1');
  assert.equal(win.window_start, new Date(1000).toISOString(), 'window_start from wallTimestamp of the opening analyze() call');
  assert.equal(win.window_end, new Date(2000).toISOString(), 'window_end from options.now()');

  assert.equal(win.text.sentence_count, 2);
  assert.equal(win.text.request_count, 1);
  assert.equal(win.text.statement_count, 1);
  assert.equal(win.text.speech_act_lang, 'en');
  assert.equal(win.text.deep_question_ratio, null);

  assert.equal(win.quality.lang, 'en');
  assert.equal(win.quality.hedges, 'default');
  assert.equal(win.quality.directives, 'default');
  assert.equal(win.quality.precedence_version, 'discourse-states-v1');
}

// ---------- B. finalize() with no analyze() call returns null ----------
{
  const agg = new DiscourseAggregator();
  assert.equal(agg.finalize({ timestamp: 100 }), null);
}

// ---------- C. analyze() with empty/whitespace-only text is a no-op and does not open the episode ----------
{
  const agg = new DiscourseAggregator();
  assert.deepEqual(agg.analyze(''), []);
  assert.deepEqual(agg.analyze('   \n\t '), []);
  assert.deepEqual(agg.analyze(null), []);
  assert.equal(agg.active, false);
  assert.equal(agg.finalize({ timestamp: 0 }), null);
}

// ---------- D. multiple analyze() calls accumulate into ONE episode window ----------
{
  const agg = new DiscourseAggregator({ now: () => 5000 });
  agg.analyze('Explain this.', { timestamp: 0, wallTimestamp: 0 });
  agg.analyze('Why does it fail? Maybe it overheated.', { timestamp: 1000, wallTimestamp: 1000 });
  const win = agg.finalize({ timestamp: 2000 });

  assert.equal(win.text.sentence_count, 3, 'one sentence from the first call, two from the second');
  assert.equal(win.text.directive_count, 1);
  assert.equal(win.text.question_count, 1);
  assert.equal(win.text.thinking_count, 1);
  assert.equal(win.window_start, new Date(0).toISOString(), 'window_start pinned to the FIRST analyze() call, not the second');
}

// ---------- E. one event per sentence, in order, with a running index across the whole episode ----------
{
  const agg = new DiscourseAggregator();
  const first = agg.analyze('Explain this.', { timestamp: 0 });
  const second = agg.analyze('Why does it fail? Maybe it overheated.', { timestamp: 100 });

  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  assert.equal(first[0].detail.index, 0);
  assert.equal(second[0].detail.index, 1, 'index keeps counting across analyze() calls, not reset per call');
  assert.equal(second[1].detail.index, 2);

  assert.deepEqual(first[0].detail, { index: 0, words: 2, matched: 'directive:explain' });
  assert.deepEqual(second[0].detail, { index: 1, words: 4, matched: 'question:wh:why' });
  assert.deepEqual(second[1].detail, { index: 2, words: 3, matched: 'hedge:maybe' });

  agg.finalize({ timestamp: 200 });
}

// ---------- F. events and the finalized window never contain the sentence text ----------
{
  const distinctiveText = 'Zzyzxplanation of the qwertographical anomaly, can you clarify this?';
  const agg = new DiscourseAggregator();
  const events = agg.analyze(distinctiveText, { timestamp: 0, wallTimestamp: 0 });
  const win = agg.finalize({ timestamp: 10 });

  for (const event of events) {
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes('Zzyzx'), 'per-sentence event must never carry the sentence text');
    assert.ok(!serialized.includes('qwertographical'), 'per-sentence event must never carry the sentence text');
  }
  const winSerialized = JSON.stringify(win);
  assert.ok(!winSerialized.includes('Zzyzx'), 'window must never carry the composed text');
  assert.ok(!winSerialized.includes('qwertographical'), 'window must never carry the composed text');
}

// ---------- G. custom hedges/directives propagate through the aggregator and are reflected in quality ----------
{
  const agg = new DiscourseAggregator({ hedges: ['i suspect'], directives: ['draft'] });
  const events = agg.analyze('I suspect this is off. Draft a summary.', { timestamp: 0, wallTimestamp: 0 });
  assert.deepEqual(events.map((e) => e.state), ['thinking', 'directive']);
  const win = agg.finalize({ timestamp: 1 });
  assert.equal(win.quality.hedges, 'custom');
  assert.equal(win.quality.directives, 'custom');
}

// ---------- H. non-English lang propagates through the aggregator ----------
{
  const agg = new DiscourseAggregator({ lang: 'fi' });
  const events = agg.analyze('Onko tämä oikein? Tämä on oikein.', { timestamp: 0, wallTimestamp: 0 });
  assert.deepEqual(events.map((e) => e.state), ['question', 'statement']);
  const win = agg.finalize({ timestamp: 1 });
  assert.equal(win.text.speech_act_lang, 'fi');
  assert.equal(win.quality.lang, 'fi');
}

// ---------- I. SignalEventLog integration: correct sequence_index, in order ----------
{
  const log = new SignalEventLog({ now: () => 0, monotonicNow: () => 0 });
  log.start({ capture_id: 'cap-discourse', session_id: 'sess-discourse' });

  const agg = new DiscourseAggregator({ onEvent: (event) => log.record(event), now: () => 4000 });
  agg.analyze('Can you explain the second theme? Why does the reaction slow down? The reaction slows down.', {
    timestamp: 0,
    wallTimestamp: 0,
  });
  const win = agg.finalize({ timestamp: 3000 });

  assert.equal(log.size, 3);
  assert.equal(log.droppedEvents, 0);
  const stored = log.all();
  assert.deepEqual(stored.map((e) => e.sequence_index), [0, 1, 2]);
  assert.deepEqual(stored.map((e) => e.state), ['request', 'question', 'statement']);
  assert.ok(stored.every((e) => e.modality === 'discourse'));
  assert.ok(stored.every((e) => e.state_vocabulary === 'discourse-states-v1'));

  // ---------- J. toSequences({ modality: 'discourse' }) round trip into ladyna tna() ----------
  const sequences = log.toSequences({ modality: 'discourse' });
  assert.equal(sequences.length, 1);
  assert.deepEqual(sequences[0], ['request', 'question', 'statement']);

  const model = tna(sequences);
  assert.deepEqual([...model.labels].sort(), ['question', 'request', 'statement']);
  const freq = stateCounts(sequences);
  assert.equal(freq.request, 1);
  assert.equal(freq.question, 1);
  assert.equal(freq.statement, 1);

  // ---------- K. the finalized window passes validateEmotionEvent with zero errors ----------
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- L. a mixed-modality log filters correctly by modality: 'discourse' ----------
{
  const log = new SignalEventLog({ now: () => 0, monotonicNow: () => 0 });
  log.start({ capture_id: 'cap-mixed', session_id: 'sess-mixed' });
  log.record({ modality: 'typing', state: 'insert', source: 'user' });
  const agg = new DiscourseAggregator({ onEvent: (event) => log.record(event) });
  agg.analyze('Explain this.', { timestamp: 0 });
  log.record({ modality: 'typing', state: 'delete', source: 'user' });
  agg.finalize({ timestamp: 1 });

  const discourseOnly = log.toSequences({ modality: 'discourse' });
  assert.deepEqual(discourseOnly, [['directive']]);
  const typingOnly = log.toSequences({ modality: 'typing' });
  assert.deepEqual(typingOnly, [['insert', 'delete']]);
}

// ---------- M. REGRESSION (finding 12): fixed classifier precedence flows through the
//              aggregator — interior hedge/request markers no longer override
//              sentence-initial questions/directives ----------
{
  const agg = new DiscourseAggregator({ now: () => 0 });
  const events = agg.analyze('Explain why it might fail. Why can you not do this?', { timestamp: 0, wallTimestamp: 0 });
  assert.deepEqual(events.map((e) => e.state), ['directive', 'question'],
    'used to classify as thinking (interior "might") and request (interior "can you")');
  assert.equal(events[0].detail.matched, 'directive:explain');
  assert.equal(events[1].detail.matched, 'question:wh:why');
  const win = agg.finalize({ timestamp: 100 });
  assert.equal(win.text.directive_count, 1);
  assert.equal(win.text.question_count, 1);
  assert.equal(win.text.deep_question_count, 1, '"Why ..." is a causal-explanatory (deep) question');
  assert.equal(win.text.thinking_count, 0);
  assert.equal(win.text.request_count, 0);
}

console.log('discourse-aggregator.test.js passed');
