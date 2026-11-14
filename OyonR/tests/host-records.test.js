import assert from 'node:assert/strict';
import {
  HOST_RECORD_KINDS,
  countScopedRecords,
  listScopedPeople,
  listScopedSessions,
  listRecordLevels,
  mapLogEventsToSignalEvents,
  RECORD_LEVELS,
  recordContextId,
  recordGroupId,
  recordLevelValue,
  recordSessionId,
  recordUserId,
  scopeRecords,
  summarizeRecordsBy,
  validateHostRecords,
} from '../src/records/index.js';
import { createLogEvent } from '../src/logging/OyonLogger.js';

/*
 * Host-fed records (AGENT-NOTE-HOST-SCOPES items 2-4, acceptance 3):
 *   - every record is shape-checked on the way in; a refused record is
 *     counted and reported with its kind, index and reason — never fatal;
 *   - a scope draws exactly what it is allowed to: a session embed fed three
 *     people's records draws one session;
 *   - a host's own oyon-log-v1 events map onto a closed vocabulary.
 */

// ── fixture: three people, four sessions, every record kind ───────────────
const window_ = (session, user, end, extra = {}) => ({
  session_id: session, user_id: user, window_start: end, window_end: end,
  dominant_emotion: 'neutral', probabilities: null, confidence: 0.5, valid_frames: 5, ...extra,
});
const typing = (session, user, start, extra = {}) => ({
  modality: 'typing', window_kind: 'episode', feature_profile: 'typing-v3',
  window_start: start, window_end: start, session_id: session, user_id: user, typing: {}, ...extra,
});
const event = (session, user, index, state = 'insert') => ({
  event_id: `e-${session}-${index}`, capture_id: `c-${session}`, session_id: session, user_id: user,
  modality: 'typing', state, source: 'user', sequence_index: index, timestamp: 1000 + index,
  monotonic_ms: index, state_vocabulary: 'typing-states-v1', target: null, detail: null,
});
const log = (session, user, name, timestamp) => createLogEvent({
  level: 'info', event_name: name, source: 'host', timestamp,
  context: { session_id: session, user_id: user }, details: {},
});

const FED = {
  windows: [
    window_('s1', 'ada', '2026-03-02T10:00:10.000Z', { user_label: 'Ada L.', group_id: 'team-a', context_id: 'essay-1' }),
    window_('s1', 'ada', '2026-03-02T10:00:20.000Z'),
    window_('s2', 'ada', '2026-03-03T10:00:10.000Z'),
    window_('s3', 'ben', '2026-03-02T11:00:10.000Z'),
    window_('s4', 'cy', '2026-03-02T12:00:10.000Z'),
  ],
  signalWindows: [
    typing('s1', 'ada', '2026-03-02T10:00:00.000Z'),
    typing('s2', 'ada', '2026-03-03T10:00:00.000Z'),
    typing('s3', 'ben', '2026-03-02T11:00:00.000Z'),
    typing('s4', 'cy', '2026-03-02T12:00:00.000Z'),
  ],
  signalEvents: [event('s1', 'ada', 0, 'start'), event('s1', 'ada', 1), event('s3', 'ben', 0, 'start'), event('s4', 'cy', 0, 'start')],
  logEvents: [log('s1', 'ada', 'doc.opened', '2026-03-02T10:00:00.000Z'), log('s3', 'ben', 'doc.opened', '2026-03-02T11:00:00.000Z')],
};

// ── validateHostRecords: everything well-formed passes ────────────────────
{
  const checked = validateHostRecords(FED);
  assert.deepEqual(checked.refused, []);
  assert.deepEqual(checked.counts.accepted, { total: 15, windows: 5, signalWindows: 4, signalEvents: 4, logEvents: 2 });
  assert.deepEqual(checked.counts.refused, { total: 0, windows: 0, signalWindows: 0, signalEvents: 0, logEvents: 0 });
  for (const kind of HOST_RECORD_KINDS) {
    assert.deepEqual(checked.records[kind], FED[kind], `${kind}: accepted records are passed through unchanged`);
  }
  // A kind left out is an empty set.
  const onlyWindows = validateHostRecords({ windows: FED.windows });
  assert.deepEqual(onlyWindows.records.signalWindows, []);
  assert.deepEqual(onlyWindows.records.signalEvents, []);
  assert.equal(onlyWindows.counts.accepted.total, 5);
}

// ── validateHostRecords: a bad record is refused, counted and explained ───
{
  const checked = validateHostRecords({
    windows: [FED.windows[0], { session_id: 's1' }, null, { window_end: 'not a date' }, { window_end_ms: 1700000000000 }],
    signalWindows: [FED.signalWindows[0], { modality: 'telepathy', window_start: '2026-03-02T10:00:00.000Z' }, { modality: 'typing' }],
    signalEvents: [
      FED.signalEvents[0],
      { ...event('s1', 'ada', 2), state: 'teleport' },
      { ...event('s1', 'ada', 3), modality: 'emotion' },
      { ...event('s1', 'ada', 4), sequence_index: undefined },
      { ...event('s1', 'ada', 5), source: 'ghost' },
    ],
    logEvents: [FED.logEvents[0], { event_name: 'x', timestamp: 1 }, { schema_version: 'oyon-log-v1', timestamp: 1 }],
  });
  assert.deepEqual(checked.counts.accepted, { total: 5, windows: 2, signalWindows: 1, signalEvents: 1, logEvents: 1 });
  assert.deepEqual(checked.counts.refused, { total: 11, windows: 3, signalWindows: 2, signalEvents: 4, logEvents: 2 });
  assert.equal(checked.refused.length, 11, 'one row per refused record');
  assert.deepEqual(
    checked.refused.map((row) => [row.kind, row.index]),
    [
      ['windows', 1], ['windows', 2], ['windows', 3],
      ['signalWindows', 1], ['signalWindows', 2],
      ['signalEvents', 1], ['signalEvents', 2], ['signalEvents', 3], ['signalEvents', 4],
      ['logEvents', 1], ['logEvents', 2],
    ],
    'each refusal names its kind and its index in the array the host supplied',
  );
  assert.ok(checked.refused.every((row) => typeof row.reason === 'string' && row.reason.length > 0));
  assert.match(checked.refused[5].reason, /teleport/, 'the reason names the offending value');
  // The good records around the bad ones survive.
  assert.equal(checked.records.windows[1].window_end_ms, 1700000000000, 'a numeric end time is a valid window');

  // Invariant: accepted + refused = supplied, per kind.
  assert.equal(checked.counts.accepted.windows + checked.counts.refused.windows, 5);
  assert.equal(checked.counts.accepted.signalEvents + checked.counts.refused.signalEvents, 5);

  // Only a call that cannot be interpreted at all throws.
  assert.throws(() => validateHostRecords(null), TypeError);
  assert.throws(() => validateHostRecords([FED.windows]), TypeError);
  assert.throws(() => validateHostRecords({ windows: 'all of them' }), TypeError);
}

// ── scope boundary: a session embed fed three people draws one session ────
{
  for (const kind of HOST_RECORD_KINDS) {
    const drawn = scopeRecords(FED[kind], { scope: 'session', sessionId: 's1', userId: 'ada' });
    assert.ok(drawn.length > 0, `${kind}: the session has records`);
    assert.ok(drawn.every((record) => recordSessionId(record) === 's1'),
      `${kind}: a session scope must draw only its own session`);
  }
  assert.equal(scopeRecords(FED.windows, { scope: 'session', sessionId: 's1' }).length, 2);

  // No session id: nothing, never a fallback to another session.
  assert.deepEqual(scopeRecords(FED.windows, { scope: 'session' }), []);
  assert.deepEqual(scopeRecords(FED.windows, { scope: 'session', sessionId: '' }), []);
  // An unrecognized scope is the narrowest one.
  assert.deepEqual(scopeRecords(FED.windows, { scope: 'everything' }), []);
  // The narrowing lists cannot widen a session scope.
  assert.equal(
    scopeRecords(FED.windows, { scope: 'session', sessionId: 's1', sessionIds: ['s1', 's3'], userIds: ['ben'] }).length,
    0,
    'narrowing only ever removes records',
  );
}

// ── person and group scopes ───────────────────────────────────────────────
{
  const ada = scopeRecords(FED.windows, { scope: 'person', userId: 'ada', sessionId: 's1' });
  assert.deepEqual(ada.map(recordSessionId), ['s1', 's1', 's2'], "every session of the person, nobody else's");
  assert.deepEqual(scopeRecords(FED.windows, { scope: 'person' }), [], 'no user id: nothing');
  assert.deepEqual(
    scopeRecords(FED.windows, { scope: 'person', userId: 'ada', sessionIds: ['s2'] }).map(recordSessionId),
    ['s2'],
    'the session list narrows within the person',
  );
  assert.deepEqual(
    scopeRecords(FED.windows, { scope: 'person', userId: 'ada', userIds: ['ben'] }),
    [],
    'a person scope cannot be redirected at someone else',
  );

  const group = scopeRecords(FED.windows, { scope: 'group' });
  assert.equal(group.length, 5, 'a group scope draws everything the host fed');
  assert.notEqual(group, FED.windows, 'a new array; the input is untouched');
  assert.deepEqual(
    scopeRecords(FED.signalWindows, { scope: 'group', userIds: ['ben', 'cy'] }).map(recordUserId),
    ['ben', 'cy'],
    'the person filter narrows within the group',
  );

  // Log events carry identity in `context`.
  assert.equal(recordSessionId(FED.logEvents[0]), 's1');
  assert.equal(recordUserId(FED.logEvents[1]), 'ben');
  assert.equal(scopeRecords(FED.logEvents, { scope: 'person', userId: 'ben' }).length, 1);

  // Older records with no identity group under the documented buckets.
  assert.equal(recordSessionId({}), '__default__');
  assert.equal(recordUserId({}), '__unknown__');
  assert.equal(recordGroupId(FED.windows[0]), 'team-a');
  assert.equal(recordContextId(FED.windows[0]), 'essay-1');
  assert.equal(recordGroupId(FED.windows[1]), null);

  // Invariants over every scope: a subset of the input, and idempotent.
  for (const options of [
    { scope: 'session', sessionId: 's1' },
    { scope: 'person', userId: 'ada' },
    { scope: 'group', userIds: ['ada', 'cy'] },
  ]) {
    for (const kind of HOST_RECORD_KINDS) {
      const once = scopeRecords(FED[kind], options);
      assert.ok(once.every((record) => FED[kind].includes(record)), 'scoping never invents a record');
      assert.deepEqual(scopeRecords(once, options), once, 'scoping twice changes nothing');
    }
  }
}

// ── what the scope header states ──────────────────────────────────────────
{
  const sets = HOST_RECORD_KINDS.map((kind) => FED[kind]);
  assert.deepEqual(countScopedRecords(sets), { sessions: 4, people: 3, records: 15 });
  const adaSets = HOST_RECORD_KINDS.map((kind) => scopeRecords(FED[kind], { scope: 'person', userId: 'ada' }));
  assert.deepEqual(countScopedRecords(adaSets), { sessions: 2, people: 1, records: 8 });   // 3 + 2 + 2 + 1
  assert.deepEqual(countScopedRecords([]), { sessions: 0, people: 0, records: 0 });

  const sessions = listScopedSessions(sets);
  assert.deepEqual(sessions.map((row) => row.id), ['s2', 's4', 's3', 's1'], 'newest first');
  assert.deepEqual(sessions.find((row) => row.id === 's1'),
    { id: 's1', records: 6, people: 1, lastMs: Date.parse('2026-03-02T10:00:20.000Z') });   // 2 + 1 + 2 + 1

  // A host with no camera feeds no interval windows at all; its sessions and
  // people are still listed from the episode windows and events.
  const noCamera = [[], FED.signalWindows, FED.signalEvents, []];
  assert.equal(listScopedSessions(noCamera).length, 4);
  assert.deepEqual(listScopedPeople(noCamera).map((row) => row.id), ['ada', 'ben', 'cy']);

  const people = listScopedPeople(sets);
  assert.deepEqual(people, [
    { id: 'ada', label: 'Ada L.', records: 8, sessions: 2 },
    { id: 'ben', label: 'ben', records: 4, sessions: 1 },
    { id: 'cy', label: 'cy', records: 3, sessions: 1 },
  ]);
}

// ── oyon-log-v1 → signal events on a closed vocabulary ────────────────────
// The event names are those of an illustrative document-editor host.
{
  const context = { session_id: 'sess-9', user_id: 'dee', group_id: 'team-b', context_id: 'report-3' };
  const logged = (name, timestamp, details = {}, ctx = context) =>
    createLogEvent({ level: 'info', event_name: name, source: 'host', timestamp, context: ctx, details });
  const logEvents = [
    logged('run.started', '2026-03-02T09:00:05.000Z', { run: 'r1' }),
    logged('doc.text_inserted', '2026-03-02T09:00:01.000Z', { chars: 12, words: 2 }),
    logged('doc.ai_rewrite', '2026-03-02T09:00:03.000Z', { chars_in: 40, chars_out: 55 }),
    logged('ui.theme_changed', '2026-03-02T09:00:04.000Z'),
    logged('run.failed', '2026-03-02T09:00:09.000Z', { run: 'r1', ms: 4000, kind: 'syntax' }),
    logged('doc.text_inserted', '2026-03-02T09:30:00.000Z', { chars: 3, words: 1 }, { session_id: 'sess-10', user_id: 'eli' }),
  ];
  const mapping = {
    'doc.text_inserted': {
      modality: 'document_edit', state: 'insert',
      detail: (d) => ({ graphemes_added: d.chars ?? null, words_added: d.words ?? null }),
    },
    'doc.ai_rewrite': {
      modality: 'document_edit', state: 'replace', source: 'ai',
      detail: (d) => ({ graphemes_removed: d.chars_in ?? null, graphemes_added: d.chars_out ?? null }),
    },
    'run.started': { modality: 'code_run', state: 'start' },
    'run.failed': {
      modality: 'code_run', state: 'failure',
      detail: (d) => ({ duration_ms: d.ms ?? null, error_kind: d.kind ?? null }),
    },
  };

  const { events, unmapped } = mapLogEventsToSignalEvents(logEvents, mapping);
  assert.deepEqual(unmapped, [{ index: 3, event_name: 'ui.theme_changed', reason: 'no mapping for this event name' }]);

  const first = events.filter((e) => e.session_id === 'sess-9');
  assert.deepEqual(first.map((e) => [e.sequence_index, e.modality, e.state, e.source]), [
    [0, 'document_edit', 'insert', 'user'],
    [1, 'document_edit', 'replace', 'ai'],
    [2, 'code_run', 'start', 'user'],
    [3, 'code_run', 'failure', 'user'],
  ], 'ordered by time within the session, whatever the log order');
  assert.deepEqual(first[0].detail, { graphemes_added: 12, words_added: 2 });
  assert.deepEqual(first[3].detail, { duration_ms: 4000, error_kind: 'syntax' });
  assert.equal(first[2].detail, null, 'no detail builder, no detail');
  assert.ok(first.every((e) => e.user_id === 'dee' && e.group_id === 'team-b' && e.context_id === 'report-3'));
  assert.ok(first.every((e) => e.capture_id === 'log:sess-9'), 'one chain per session');
  assert.equal(first[0].state_vocabulary, 'document-edit-states-v1');
  assert.equal(first[2].state_vocabulary, 'code-run-states-v1');

  const second = events.filter((e) => e.session_id === 'sess-10');
  assert.deepEqual(second.map((e) => e.sequence_index), [0], 'each session numbers its own events from 0');
  assert.ok(!('group_id' in second[0]), 'identity the log did not carry is not invented');

  // The mapped events are valid feed records.
  const checked = validateHostRecords({ signalEvents: events });
  assert.equal(checked.counts.refused.total, 0);
  assert.equal(checked.counts.accepted.signalEvents, 5);
  assert.equal(new Set(events.map((e) => e.event_id)).size, events.length, 'event ids are unique');

  // A wrong mapping is a programming error, raised before any event is made.
  assert.throws(() => mapLogEventsToSignalEvents(logEvents, { 'run.started': { modality: 'code_run', state: 'launched' } }), TypeError);
  assert.throws(() => mapLogEventsToSignalEvents(logEvents, { 'run.started': { modality: 'rocket', state: 'start' } }), TypeError);
  assert.throws(() => mapLogEventsToSignalEvents(logEvents, { 'run.started': { modality: 'code_run', state: 'start', source: 'robot' } }), TypeError);
  assert.throws(() => mapLogEventsToSignalEvents(logEvents, null), TypeError);

  // Records that are not log events are reported, not thrown on.
  const odd = mapLogEventsToSignalEvents([null, { event_name: 'run.started' }], mapping);
  assert.deepEqual(odd.events, []);
  assert.deepEqual(odd.unmapped.map((row) => row.reason), ['not a log event', 'timestamp is missing or not a time']);
}

// ── the overview: one row per session / person across EVERY record kind ───
{
  const at = (iso) => Date.parse(iso);
  const records = {
    windows: [
      // s1 (ada): 3 camera windows — 2 neutral, 1 happy; focus 0.5 and 0.7 on two of them.
      window_('s1', 'ada', '2026-03-02T10:00:10.000Z', { window_start: '2026-03-02T10:00:00.000Z', user_label: 'Ada L.', engagement: { focus_score: 0.5 }, valence: 0.2 }),
      window_('s1', 'ada', '2026-03-02T10:00:20.000Z', { window_start: '2026-03-02T10:00:10.000Z', engagement: { focus_score: 0.7 }, valence: 0.4 }),
      window_('s1', 'ada', '2026-03-02T10:00:30.000Z', { window_start: '2026-03-02T10:00:20.000Z', dominant_emotion: 'happy' }),
      // s3 (ben): 1 camera window with gaze.
      window_('s3', 'ben', '2026-03-02T11:00:10.000Z', { window_start: '2026-03-02T11:00:00.000Z', dominant_emotion: 'sad', gaze: { n_points: 4 } }),
    ],
    signalWindows: [
      // s1: two typing episodes — 120 graphemes over 60 s active, then 60 over 30 s.
      typing('s1', 'ada', '2026-03-02T10:01:00.000Z', {
        window_end: '2026-03-02T10:02:00.000Z',
        typing: { elapsed_ms: 60000, active_input_ms: 60000, committed_graphemes: 120, inserted_graphemes: 130, deleted_graphemes: 10 },
      }),
      typing('s1', 'ada', '2026-03-02T10:03:00.000Z', {
        window_end: '2026-03-02T10:04:00.000Z',
        typing: { elapsed_ms: 60000, active_input_ms: 30000, committed_graphemes: 60, inserted_graphemes: 70, deleted_graphemes: 10 },
      }),
      // s2 (ada): typing only — no camera at all.
      typing('s2', 'ada', '2026-03-03T09:00:00.000Z', {
        window_end: '2026-03-03T09:05:00.000Z',
        typing: { elapsed_ms: 300000, active_input_ms: 120000, committed_graphemes: 400, inserted_graphemes: 400, deleted_graphemes: 0 },
      }),
      { modality: 'voice', window_kind: 'episode', window_start: '2026-03-02T11:00:20.000Z', window_end: '2026-03-02T11:00:50.000Z', session_id: 's3', user_id: 'ben', voice: {} },
    ],
    signalEvents: [
      { ...event('s1', 'ada', 0, 'start'), timestamp: at('2026-03-02T10:01:00.000Z') },
      { ...event('s1', 'ada', 1), timestamp: at('2026-03-02T10:01:30.000Z') },
      { ...event('s3', 'ben', 0), modality: 'code_run', state: 'start', timestamp: at('2026-03-02T11:01:00.000Z') },
    ],
    logEvents: [log('s3', 'ben', 'doc.opened', '2026-03-02T10:59:00.000Z')],
  };

  const sessions = summarizeRecordsBy(records, { by: 'session' });
  assert.deepEqual(sessions.map((row) => row.key), ['s2', 's3', 's1'], 'newest first');

  const s1 = sessions.find((row) => row.key === 's1');
  assert.deepEqual(
    { windows: s1.windows, typingEpisodes: s1.typingEpisodes, voiceTurns: s1.voiceTurns, events: s1.events, logEvents: s1.logEvents, records: s1.records },
    { windows: 3, typingEpisodes: 2, voiceTurns: 0, events: 2, logEvents: 0, records: 7 },
  );
  assert.equal(s1.firstMs, at('2026-03-02T10:00:00.000Z'), 'earliest start of any record');
  assert.equal(s1.lastMs, at('2026-03-02T10:04:00.000Z'), 'latest end of any record');
  assert.equal(s1.spanMs, 240000);                                   // 10:00:00 → 10:04:00
  assert.equal(s1.dominantEmotion, 'neutral');
  assert.ok(Math.abs(s1.dominantShare - 2 / 3) < 1e-12, '2 of 3 labelled windows');
  assert.ok(Math.abs(s1.meanFocus - 0.6) < 1e-12, 'mean of 0.5 and 0.7; the window without focus is not a zero');
  assert.ok(Math.abs(s1.meanValence - 0.3) < 1e-12);
  assert.equal(s1.typingActiveMs, 90000);                            // 60 s + 30 s
  assert.ok(Math.abs(s1.charsPerMinActive - 180 / 1.5) < 1e-9, '180 graphemes over 1.5 active minutes'); // 120
  assert.ok(Math.abs(s1.revisionRatio - 20 / 200) < 1e-12);          // 0.1
  assert.deepEqual(s1.modalities, ['emotion', 'engagement', 'typing']);
  assert.deepEqual([s1.userId, s1.userLabel, s1.people], ['ada', 'Ada L.', 1]);

  // A session with no camera is listed, with "not measured" for affect.
  const s2 = sessions.find((row) => row.key === 's2');
  assert.equal(s2.windows, 0);
  assert.equal(s2.typingEpisodes, 1);
  for (const field of ['dominantEmotion', 'dominantShare', 'meanFocus', 'meanValence']) {
    assert.equal(s2[field], null, `${field}: no camera windows, so not measured — never 0`);
  }
  assert.ok(Math.abs(s2.charsPerMinActive - 200) < 1e-9, '400 graphemes over 2 active minutes');
  assert.deepEqual(s2.modalities, ['typing']);

  // A session with no typing shows "not measured" for the typing figures.
  const s3 = sessions.find((row) => row.key === 's3');
  assert.deepEqual([s3.windows, s3.voiceTurns, s3.events, s3.logEvents, s3.records], [1, 1, 1, 1, 4]);
  for (const field of ['typingActiveMs', 'charsPerMinActive', 'revisionRatio']) {
    assert.equal(s3[field], null, `${field}: no typing episodes, so not measured`);
  }
  assert.deepEqual(s3.modalities, ['code_run', 'emotion', 'gaze', 'voice']);
  assert.equal(s3.firstMs, at('2026-03-02T10:59:00.000Z'), 'a log event counts toward the span');

  const people = summarizeRecordsBy(records, { by: 'person' });
  assert.deepEqual(people.map((row) => [row.key, row.label, row.sessions, row.records]), [
    ['ada', 'Ada L.', 2, 8],
    ['ben', 'ben', 1, 4],
  ], 'first-seen order; a person pools all of their sessions');
  const ada = people[0];
  assert.equal(ada.typingActiveMs, 210000);                          // 60 + 30 + 120 s
  assert.ok(Math.abs(ada.charsPerMinActive - 580 / 3.5) < 1e-9, 'pooled from sums: 580 graphemes over 3.5 active minutes');

  // Invariants: every record lands in exactly one row; order of input is irrelevant.
  const total = HOST_RECORD_KINDS.reduce((sum, kind) => sum + records[kind].length, 0);
  assert.equal(sessions.reduce((sum, row) => sum + row.records, 0), total);
  assert.equal(people.reduce((sum, row) => sum + row.records, 0), total);
  const reversed = Object.fromEntries(HOST_RECORD_KINDS.map((kind) => [kind, [...records[kind]].reverse()]));
  const byKey = (rows) => Object.fromEntries(rows.map((row) => [row.key, row]));
  const forward = byKey(sessions);
  const backward = byKey(summarizeRecordsBy(reversed, { by: 'session' }));
  for (const key of ['s1', 's2', 's3']) {
    for (const field of ['records', 'windows', 'firstMs', 'lastMs', 'typingActiveMs', 'dominantEmotion']) {
      assert.equal(backward[key][field], forward[key][field], `${key}.${field} must not depend on input order`);
    }
  }

  assert.deepEqual(summarizeRecordsBy({}, { by: 'session' }), []);
  assert.throws(() => summarizeRecordsBy(records, { by: 'cohort' }), TypeError);
}

// ── aggregation levels: class › group › person › session ──────────────────
{
  const rec = (cls, group, user, session, extra = {}) => typing(session, user, '2026-03-02T10:00:00.000Z', {
    ...(cls ? { class_id: cls, class_label: `Class ${cls}` } : {}),
    ...(group ? { group_id: group, group_label: `Group ${group}` } : {}),
    typing: { elapsed_ms: 60000, active_input_ms: 60000, committed_graphemes: 60, inserted_graphemes: 60, deleted_graphemes: 0 },
    ...extra,
  });
  const set = [
    rec('c1', 'g1', 'ada', 's1'),
    rec('c1', 'g1', 'ben', 's2'),
    rec('c1', 'g2', 'cy', 's3'),
    rec('c1', 'g2', 'cy', 's4'),
  ];

  assert.deepEqual(RECORD_LEVELS.map((level) => [level.id, level.key]), [
    ['class', 'class_id'], ['group', 'group_id'], ['person', 'user_id'], ['session', 'session_id'],
  ], 'widest first');

  // Only the levels the records carry are offered, with their unit counts.
  assert.deepEqual(listRecordLevels([set]).map((level) => [level.id, level.units]),
    [['class', 1], ['group', 2], ['person', 3], ['session', 4]]);
  assert.deepEqual(listRecordLevels([FED.windows]).map((level) => level.id), ['group', 'person', 'session'],
    'no record carries class_id, so there is no class level');
  assert.deepEqual(listRecordLevels([FED.signalWindows]).map((level) => level.id), ['person', 'session'],
    'person and session are always levels');
  assert.deepEqual(listRecordLevels([[]]), []);

  // One row per unit at any level, pooled from sums.
  const groups = summarizeRecordsBy({ signalWindows: set }, { by: 'group' });
  assert.deepEqual(groups.map((row) => [row.key, row.label, row.people, row.sessions, row.typingEpisodes]), [
    ['g1', 'Group g1', 2, 2, 2],
    ['g2', 'Group g2', 1, 2, 2],
  ]);
  assert.equal(groups[0].typingActiveMs, 120000);                    // two 60 s episodes
  assert.ok(Math.abs(groups[0].charsPerMinActive - 60) < 1e-9, '120 graphemes over 2 active minutes');
  const classes = summarizeRecordsBy({ signalWindows: set }, { by: 'class' });
  assert.deepEqual(classes.map((row) => [row.key, row.label, row.people, row.sessions]), [['c1', 'Class c1', 3, 4]]);

  // Records with no value at a level pool into one bucket row, not dropped.
  const mixed = summarizeRecordsBy({ signalWindows: [...set, rec(null, null, 'dee', 's5')] }, { by: 'group' });
  assert.deepEqual(mixed.map((row) => row.key), ['g1', 'g2', '__none__']);
  assert.equal(recordLevelValue(set[0], 'group_id'), 'g1');
  assert.equal(recordLevelValue({}, 'group_id'), '__none__');
  assert.equal(recordLevelValue({}, 'user_id'), '__unknown__');

  // A host's own level.
  const cohortLevels = [{ id: 'cohort', key: 'cohort_id', labelKey: null, label: 'Cohort', plural: 'Cohorts' }, ...RECORD_LEVELS];
  const cohorts = summarizeRecordsBy(
    { signalWindows: [{ ...set[0], cohort_id: 'k1' }, { ...set[1], cohort_id: 'k2' }] },
    { by: 'cohort', levels: cohortLevels },
  );
  assert.deepEqual(cohorts.map((row) => row.key), ['k1', 'k2']);

  // Narrowing at a level only ever removes records; class and group scopes draw all that was fed.
  assert.equal(scopeRecords(set, { scope: 'class' }).length, 4);
  assert.equal(scopeRecords(set, { scope: 'group' }).length, 4);
  assert.deepEqual(scopeRecords(set, { scope: 'class', filters: { group_id: ['g2'] } }).map(recordUserId), ['cy', 'cy']);
  assert.deepEqual(
    scopeRecords(set, { scope: 'class', filters: { group_id: ['g1'] }, userIds: ['ben'] }).map(recordSessionId),
    ['s2'],
    'narrowing at two levels intersects',
  );
  assert.deepEqual(scopeRecords(set, { scope: 'class', filters: { group_id: ['nope'] } }), []);
  assert.equal(scopeRecords(set, { scope: 'class', filters: { group_id: [] } }).length, 4, 'an empty list is no narrowing');
  assert.deepEqual(scopeRecords(set, { scope: 'session', sessionId: 's1', filters: { group_id: ['g2'] } }), [],
    'a filter cannot widen a session scope');
  assert.deepEqual(scopeRecords(set, { scope: 'cohort' }), [], 'an unknown level name stays the narrowest scope');
  assert.equal(scopeRecords(set, { scope: 'cohort', levels: cohortLevels }).length, 4, '…unless the host declares it');
}

console.log('host-records OK');
