import assert from 'node:assert/strict';
import {
  WRITING_ORIGINS, writingActs, writingOrigin, summarizeWriting, summarizeWritingBy, writingTimeline, writingByDayAndPerson,
} from '../src/index.js';

/*
 * WritingAnalytics — pooled from document_edit events. Every expected figure below is computed by hand
 * from the fixture; none is read back from the code under test.
 */

const T0 = Date.UTC(2026, 10, 10, 9, 0, 0);   // 2026-11-10 09:00 UTC
const DAY = 24 * 3600 * 1000;
const edit = (t, state, source, detail, who = {}) => ({
  modality: 'document_edit', state, source, timestamp: t, sequence_index: 0, session_id: who.session ?? 's1',
  user_id: who.id ?? 'ada', ...(who.label ? { user_label: who.label } : {}), context_id: who.doc ?? 'essay',
  detail: detail === null ? null : { graphemes_added: null, graphemes_removed: null, words_added: null, words_removed: null, ...detail },
});

const events = [
  edit(T0, 'insert', 'user', { graphemes_added: 100, graphemes_removed: 0, words_added: 20, words_removed: 0 }, { label: 'Ada' }),
  edit(T0 + 60000, 'paste', 'user', { graphemes_added: 50, graphemes_removed: 0, words_added: 10, words_removed: 0 }),
  edit(T0 + 120000, 'delete', 'user', { graphemes_added: 0, graphemes_removed: 30, words_added: 0, words_removed: 6 }),
  edit(T0 + 180000, 'insert', 'ai', { graphemes_added: 50, graphemes_removed: 0, words_added: 10, words_removed: 0 }),
  edit(T0 + 240000, 'block_reorder', 'user', {}),
  edit(T0 + 300000, 'format', 'user', {}),
  // Another person, next day, another session.
  edit(T0 + DAY, 'insert', 'user', { graphemes_added: 200, graphemes_removed: 0, words_added: 40, words_removed: 0 }, { id: 'bo', label: 'Bo', session: 's2' }),
  edit(T0 + DAY + 1000, 'replace', 'user', { graphemes_added: 10, graphemes_removed: 20, words_added: 2, words_removed: 4 }, { id: 'bo', session: 's2' }),
  // Not document edits, and one with no time: left out.
  { modality: 'typing', state: 'insert', source: 'user', timestamp: T0, detail: { graphemes_added: 999 } },
  { modality: 'document_edit', state: 'insert', source: 'user', timestamp: 'never', detail: { graphemes_added: 999 } },
];

// ── origin ────────────────────────────────────────────────────────────────
assert.deepEqual(WRITING_ORIGINS, ['typed', 'pasted', 'ai', 'system']);
assert.equal(writingOrigin({ source: 'user', state: 'insert' }), 'typed');
assert.equal(writingOrigin({ source: 'user', state: 'paste' }), 'pasted');
assert.equal(writingOrigin({ source: 'ai', state: 'paste' }), 'ai', 'an AI paste is the AI\'s');
assert.equal(writingOrigin({ source: 'system', state: 'insert' }), 'system');

// ── acts ──────────────────────────────────────────────────────────────────
{
  const acts = writingActs(events);
  assert.equal(acts.length, 8, 'document edits with a time, nothing else');
  assert.ok(acts.every((act, i) => i === 0 || acts[i - 1].t <= act.t), 'in time order');
  assert.equal(acts[4].graphemesAdded, null, 'a count left out is null, not 0');
  assert.deepEqual(writingActs(null), []);
  assert.deepEqual(writingActs([null, 3, 'x', {}]), []);
}

// ── the pooled summary, by hand ───────────────────────────────────────────
{
  const s = summarizeWriting(events);
  assert.equal(s.acts, 8);
  assert.equal(s.graphemesAdded, 100 + 50 + 0 + 50 + 200 + 10);          // 410
  assert.equal(s.graphemesRemoved, 30 + 20);                             // 50
  assert.equal(s.netGraphemes, 360);
  assert.equal(s.wordsAdded, 20 + 10 + 0 + 10 + 40 + 2);                 // 82
  assert.equal(s.wordsRemoved, 6 + 4);
  assert.equal(s.netWords, 72);
  assert.equal(s.removedRatio, 50 / 410);
  assert.equal(s.origins.typed.graphemes, 100 + 0 + 200 + 10);           // 310
  assert.equal(s.origins.pasted.graphemes, 50);
  assert.equal(s.origins.ai.graphemes, 50);
  assert.equal(s.origins.system.graphemes, null, 'no system edit: not measured, not 0');
  assert.equal(s.origins.system.share, 0, 'its share of measured added text is 0');
  assert.equal(s.origins.typed.share, 310 / 410);
  assert.equal(s.origins.pasted.share, 50 / 410);
  assert.equal(s.origins.ai.share, 50 / 410);
  const shares = WRITING_ORIGINS.reduce((sum, o) => sum + s.origins[o].share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-12, 'shares of added text sum to 1');
  assert.deepEqual(s.structural, { added: 0, removed: 0, moved: 1 });
  assert.equal(s.states.insert, 3);
  assert.equal(s.states.format, 1);
  assert.equal(s.people, 2);
  assert.equal(s.sessions, 2);
  assert.equal(s.contexts, 1);
  assert.equal(s.firstMs, T0);
  assert.equal(s.lastMs, T0 + DAY + 1000);
}

// ── nothing measured is null, never 0 ─────────────────────────────────────
{
  const s = summarizeWriting([edit(T0, 'format', 'user', {}), edit(T0 + 1, 'insert', 'user', null)]);
  assert.equal(s.acts, 2);
  assert.equal(s.graphemesAdded, null);
  assert.equal(s.netGraphemes, null);
  assert.equal(s.netWords, null);
  assert.equal(s.removedRatio, null);
  assert.equal(s.origins.typed.share, null);
  const none = summarizeWriting([]);
  assert.equal(none.acts, 0);
  assert.equal(none.firstMs, null);
}

// ── per person ────────────────────────────────────────────────────────────
{
  const rows = summarizeWritingBy(events, { by: 'person' });
  assert.deepEqual(rows.map((r) => r.key), ['bo', 'ada'], 'most added text first');
  assert.deepEqual(rows.map((r) => r.label), ['Bo', 'Ada'], 'the label any of the person\'s events carried');
  assert.equal(rows[0].graphemesAdded, 210);
  assert.equal(rows[1].graphemesAdded, 200);
  assert.equal(rows[0].share, 210 / 410);
  assert.equal(rows[1].share, 200 / 410);
  assert.equal(rows[1].origins.ai.graphemes, 50);
  assert.equal(rows[0].origins.ai.graphemes, null);
}

// ── per day (UTC, so the test does not depend on the machine's zone) ──────
{
  const rows = summarizeWritingBy(events, { by: 'day', utc: true });
  assert.deepEqual(rows.map((r) => r.key), ['2026-11-10', '2026-11-11']);
  assert.equal(rows[0].wordsAdded, 40);
  assert.equal(rows[0].wordsRemoved, 6);
  assert.equal(rows[1].wordsAdded, 42);
}
{
  const rows = summarizeWritingBy(events, { by: 'session' });
  assert.equal(rows.length, 2);
  const docs = summarizeWritingBy(events, { by: 'context' });
  assert.deepEqual(docs.map((r) => [r.key, r.share]), [['essay', 1]]);
}

// ── the timeline ──────────────────────────────────────────────────────────
{
  const { points, unmeasured } = writingTimeline(events);
  assert.deepEqual(points.map((p) => p.net), [100, 150, 120, 170, 370, 360]);
  assert.deepEqual(points.map((p) => p.netWords), [20, 30, 24, 34, 74, 72]);
  assert.deepEqual(points.map((p) => p.origin), ['typed', 'pasted', 'typed', 'ai', 'typed', 'typed']);
  assert.equal(unmeasured, 0, 'a format or a block move carries no count by nature and is not "unmeasured"');
  assert.equal(writingTimeline([edit(T0, 'insert', 'user', {})]).unmeasured, 1);
  assert.equal(points[points.length - 1].net, summarizeWriting(events).netGraphemes, 'the curve ends at the pooled net');
}

// ── day × person ──────────────────────────────────────────────────────────
{
  const grid = writingByDayAndPerson(events, { utc: true });
  assert.equal(grid.unit, 'words');
  assert.deepEqual(grid.days, ['2026-11-10', '2026-11-11']);
  assert.deepEqual(grid.people, [{ key: 'ada', label: 'Ada' }, { key: 'bo', label: 'Bo' }]);
  const cell = (day, person) => grid.cells.find((c) => c.day === day && c.person === person);
  assert.deepEqual(cell('2026-11-10', 'ada'), { day: '2026-11-10', person: 'ada', added: 40, removed: 6 });
  assert.deepEqual(cell('2026-11-11', 'bo'), { day: '2026-11-11', person: 'bo', added: 42, removed: 4 });
  assert.equal(cell('2026-11-11', 'ada'), undefined);
  assert.equal(grid.maxAdded, 42);
  assert.equal(grid.maxRemoved, 6);
  const byGraphemes = writingByDayAndPerson(events, { utc: true, unit: 'graphemes' });
  assert.equal(byGraphemes.maxAdded, 210);
  assert.equal(writingByDayAndPerson([edit(T0, 'insert', 'user', { graphemes_added: 5 })], { utc: true }).unit, 'graphemes',
    'no edit measured words: the unit falls to graphemes');
}

// ── invariants over random sets ───────────────────────────────────────────
{
  let seed = 20261113;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let round = 0; round < 200; round += 1) {
    const n = Math.floor(rnd() * 30);
    const set = Array.from({ length: n }, () => edit(T0 + Math.floor(rnd() * 5 * DAY),
      ['insert', 'delete', 'replace', 'paste', 'format', 'block_add'][Math.floor(rnd() * 6)], ['user', 'ai', 'system'][Math.floor(rnd() * 3)],
      rnd() < 0.2 ? {} : { graphemes_added: Math.floor(rnd() * 100), graphemes_removed: Math.floor(rnd() * 100) },
      { id: ['a', 'b', 'c'][Math.floor(rnd() * 3)], session: `s${Math.floor(rnd() * 4)}` }));
    const total = summarizeWriting(set);
    const people = summarizeWritingBy(set, { by: 'person' });
    const days = summarizeWritingBy(set, { by: 'day', utc: true });
    const sum = (rows, key) => rows.reduce((s, r) => (r[key] === null ? s : (s ?? 0) + r[key]), null);
    assert.equal(sum(people, 'graphemesAdded'), total.graphemesAdded, `seed round ${round}: people add up to the total`);
    assert.equal(sum(days, 'graphemesRemoved'), total.graphemesRemoved, `round ${round}: days add up to the total`);
    assert.equal(people.reduce((s, r) => s + r.acts, 0), total.acts);
    const shuffled = set.slice().sort(() => rnd() - 0.5);
    assert.deepEqual(summarizeWriting(shuffled).origins, total.origins, `round ${round}: input order does not matter`);
    const { points } = writingTimeline(set);
    if (points.length) assert.equal(points[points.length - 1].net, total.netGraphemes, `round ${round}: curve ends at the net`);
  }
}

console.log('writing-analytics: all passed');

// ── writing acts for the sequence views ───────────────────────────────────
{
  const { WRITING_ACTS, writingActOf, writingActSequences } = await import('../src/index.js');
  assert.deepEqual(WRITING_ACTS, ['write', 'revise', 'paste', 'organise', 'ai', 'decide', 'pause']);
  assert.deepEqual(writingActOf({ state: 'insert', source: 'user' }), { act: 'write', detail: null });
  assert.deepEqual(writingActOf({ state: 'redo', source: 'user' }), { act: 'revise', detail: 'undo' });
  assert.deepEqual(writingActOf({ state: 'block_reorder', source: 'user' }), { act: 'organise', detail: 'structure' });
  assert.deepEqual(writingActOf({ state: 'replace', source: 'ai' }), { act: 'ai', detail: 'replace' });
  assert.deepEqual(writingActOf({ state: 'replace', source: 'user', detail: { ai_decision: 'rejected' } }), { act: 'decide', detail: 'rejected' });
  assert.deepEqual(writingActOf({ state: 'insert', source: 'ai', detail: { ai_decision: 'kept' } }), { act: 'decide', detail: 'kept' }, 'a decision outranks its carrier');
  // ada, s1: insert, paste(+1min), delete(+2), ai insert(+3), block move(+4), format(+5). bo, s2: insert, replace.
  const main = writingActSequences(events, { pauseMs: null });
  assert.deepEqual(main.sort((a, b) => b.length - a.length), [['write', 'paste', 'revise', 'ai', 'organise', 'organise'], ['write', 'revise']]);
  const detail = writingActSequences(events, { level: 'detail', pauseMs: null }).sort((a, b) => b.length - a.length);
  assert.deepEqual(detail[0], ['write', 'paste', 'revise:delete', 'ai:insert', 'organise:structure', 'organise:format']);
  // Edits are a minute apart: a 60 s threshold puts a pause between each; the default (2 min) none.
  assert.equal(writingActSequences(events, { pauseMs: 60000 }).sort((a, b) => b.length - a.length)[0].filter((s) => s === 'pause').length, 5);
  assert.ok(!writingActSequences(events).flat().includes('pause'));
  assert.ok(writingActSequences(events).flat().every((s) => WRITING_ACTS.includes(s)), 'main level stays inside the seven');
  console.log('writing acts: all passed');
}

{
  const { summarizeWritingActs, WRITING_ACTS } = await import('../src/index.js');
  const s = summarizeWritingActs(events, { pauseMs: null });
  assert.deepEqual(s.acts.map((r) => r.act), WRITING_ACTS, 'always the seven, in order');
  assert.equal(s.total, 8);
  const by = Object.fromEntries(s.acts.map((r) => [r.act, r]));
  assert.deepEqual([by.write.count, by.revise.count, by.paste.count, by.organise.count, by.ai.count, by.decide.count, by.pause.count], [2, 2, 1, 2, 1, 0, 0]);
  assert.equal(by.write.share, 2 / 8);
  assert.deepEqual(by.revise.details, [{ detail: 'delete', count: 1 }, { detail: 'replace', count: 1 }]);
  assert.deepEqual(by.organise.details.map((d) => d.detail).sort(), ['format', 'structure']);
  assert.ok(Math.abs(s.acts.reduce((sum, r) => sum + r.share, 0) - 1) < 1e-12);
  assert.equal(summarizeWritingActs([]).acts[0].share, null);
  console.log('writing act summary: all passed');
}

// ── ai_assist events as writing acts ──────────────────────────────────────
{
  const { writingActOf, writingActEvents, writingActSequences, summarizeWritingActs, summarizeWriting, WRITING_ACTS } = await import('../src/index.js');
  assert.deepEqual(writingActOf({ modality: 'ai_assist', state: 'suggestion_request', source: 'user' }), { act: 'ai', detail: 'ask' });
  assert.deepEqual(writingActOf({ modality: 'ai_assist', state: 'suggestion_accept', source: 'user' }), { act: 'decide', detail: 'kept' });
  assert.deepEqual(writingActOf({ modality: 'ai_assist', state: 'suggestion_reject', source: 'user' }), { act: 'decide', detail: 'rejected' });
  for (const state of ['suggestion_shown', 'suggestion_dismiss', 'ai_turn_start', 'toString']) {
    assert.equal(writingActOf({ modality: 'ai_assist', state, source: 'ai' }), null, `${state} is not a writing act`);
  }

  const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
  const MIN = 60000;
  const ev = (modality, state, minute, extra = {}) => ({
    modality, state, source: 'user', timestamp: T0 + minute * MIN, user_id: 'cy', session_id: 'w1', sequence_index: 0, ...extra,
  });
  // cy, w1 by hand: write(0) · ask(1) · [shown(1.5) ignored] · ai insert(2) · kept(3) · — 3 min — · pause · ask(6) · rejected(7)
  const mixed = [
    ev('ai_assist', 'suggestion_reject', 7),
    ev('document_edit', 'insert', 0, { detail: { graphemes_added: 10 } }),
    ev('ai_assist', 'suggestion_request', 1),
    ev('ai_assist', 'suggestion_shown', 1.5, { source: 'ai' }),
    ev('document_edit', 'insert', 2, { source: 'ai', detail: { graphemes_added: 40 } }),
    ev('ai_assist', 'suggestion_accept', 3),
    ev('ai_assist', 'suggestion_request', 6),
    // dee never edits a document: an AI used elsewhere is not writing.
    ev('ai_assist', 'suggestion_request', 1, { user_id: 'dee', session_id: 'c1' }),
    ev('ai_assist', 'suggestion_accept', 2, { user_id: 'dee', session_id: 'c1' }),
  ];
  assert.deepEqual(writingActSequences(mixed), [['write', 'ai', 'ai', 'decide', 'pause', 'ai', 'decide']]);
  assert.deepEqual(writingActSequences(mixed, { level: 'detail' }),
    [['write', 'ai:ask', 'ai:insert', 'decide:kept', 'pause', 'ai:ask', 'decide:rejected']]);
  assert.ok(writingActSequences(mixed).flat().every((s) => WRITING_ACTS.includes(s)), 'main level stays inside the seven');
  // The pause is measured over the merged stream: the request at 1 min fills the silence between the edits
  // at 0 and 2 min. With the AI acts left out those edits are 2 min apart, which is a pause (>= 2 min).
  assert.deepEqual(writingActSequences(mixed, { level: 'detail', aiAssist: false }), [['write', 'pause', 'ai:insert']]);

  const read = writingActEvents(mixed);
  assert.equal(read.length, 6, 'two edits and four AI acts; shown and the non-editor left out');
  assert.deepEqual(read.map((e) => e.timestamp), [0, 1, 2, 3, 6, 7].map((m) => T0 + m * MIN), 'time order');
  assert.ok(read.every((e) => e.user_id === 'cy'));
  assert.equal(writingActEvents(mixed, { aiAssist: false }).length, 2);
  assert.deepEqual(writingActEvents(null), []);

  const s = summarizeWritingActs(mixed);
  const by = Object.fromEntries(s.acts.map((r) => [r.act, r]));
  assert.equal(s.total, 7);
  assert.deepEqual([by.write.count, by.ai.count, by.decide.count, by.pause.count], [1, 3, 2, 1]);
  assert.deepEqual(by.ai.details, [{ detail: 'ask', count: 2 }, { detail: 'insert', count: 1 }]);
  assert.deepEqual(by.decide.details.map((d) => d.detail).sort(), ['kept', 'rejected']);
  assert.equal(summarizeWritingActs(mixed, { aiAssist: false }).total, 3);

  // The text figures count text, and these events carry none: unchanged by their presence.
  assert.deepEqual(summarizeWriting(mixed), summarizeWriting(mixed.filter((e) => e.modality === 'document_edit')));

  // Invariant: the acts read never depend on input order.
  const sorted = JSON.stringify(writingActSequences(mixed, { level: 'detail' }));
  for (let shift = 1; shift < mixed.length; shift += 1) {
    const rotated = [...mixed.slice(shift), ...mixed.slice(0, shift)];
    assert.equal(JSON.stringify(writingActSequences(rotated, { level: 'detail' })), sorted);
  }
  console.log('ai_assist writing acts: all passed');
}
