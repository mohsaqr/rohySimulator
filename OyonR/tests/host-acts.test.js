import assert from 'node:assert/strict';
import { createDocumentEditTracker } from '../src/capture/DocumentEditTracker.js';
import { createCodeRunTracker } from '../src/capture/CodeRunTracker.js';
import { createSignalCapture } from '../src/core/SignalCapture.js';
import { SignalEventLog } from '../src/logging/SignalEventLog.js';
import { validateHostRecords } from '../src/records/index.js';
import {
  OYON_CODE_RUN_STATES,
  OYON_CODE_RUN_STATES_VERSION,
  OYON_DOCUMENT_EDIT_STATES,
  OYON_DOCUMENT_EDIT_STATES_VERSION,
  OYON_MODALITIES,
  OYON_STATE_VOCABULARIES,
  OYON_STATE_VOCABULARY_VERSIONS,
} from '../src/version.js';
import { normalizeOyonSettings } from '../src/settings/OyonSettings.js';

/*
 * Host-reported acts (AGENT-NOTE-HOST-SCOPES item 6): document edits and
 * code runs get closed, versioned vocabularies, so they appear in the
 * sequence views like any other channel. Events carry counts, outcomes and
 * durations — never the document's text, the code or an error message.
 */

// ── the vocabularies are closed, versioned and registered ─────────────────
{
  assert.deepEqual([...OYON_DOCUMENT_EDIT_STATES], [
    'insert', 'delete', 'replace', 'move', 'format', 'undo', 'redo', 'paste',
    'block_add', 'block_remove', 'block_reorder',
  ]);
  assert.deepEqual([...OYON_CODE_RUN_STATES], ['start', 'success', 'failure', 'interrupt']);
  assert.equal(OYON_DOCUMENT_EDIT_STATES_VERSION, 'document-edit-states-v1');
  assert.equal(OYON_CODE_RUN_STATES_VERSION, 'code-run-states-v1');
  assert.ok(Object.isFrozen(OYON_DOCUMENT_EDIT_STATES) && Object.isFrozen(OYON_CODE_RUN_STATES));
  assert.equal(OYON_STATE_VOCABULARIES.document_edit, OYON_DOCUMENT_EDIT_STATES);
  assert.equal(OYON_STATE_VOCABULARIES.code_run, OYON_CODE_RUN_STATES);
  assert.equal(OYON_STATE_VOCABULARY_VERSIONS.document_edit, 'document-edit-states-v1');
  assert.equal(OYON_STATE_VOCABULARY_VERSIONS.code_run, 'code-run-states-v1');
  assert.ok(OYON_MODALITIES.includes('document_edit') && OYON_MODALITIES.includes('code_run'));
  // Existing vocabularies are untouched (adding a state there is a version bump).
  assert.equal(OYON_STATE_VOCABULARIES.interaction.length, 11);
  assert.equal(OYON_STATE_VOCABULARIES.typing.length, 17);

  // Both are off by default, like every other opt-in modality.
  const defaults = normalizeOyonSettings({});
  assert.equal(defaults.document_edit_enabled, false);
  assert.equal(defaults.code_run_enabled, false);
  assert.equal(normalizeOyonSettings({ document_edit_enabled: 1 }).document_edit_enabled, true);
}

// ── DocumentEditTracker ───────────────────────────────────────────────────
{
  let mono = 100;
  const events = [];
  const tracker = createDocumentEditTracker({
    onEvent: (event) => events.push(event),
    now: () => mono,
    wallClockNow: () => 1_700_000_000_000 + mono,
  });

  const typed = tracker.record({ state: 'insert', graphemes_added: 12, words_added: 2 });
  assert.deepEqual(typed, {
    modality: 'document_edit',
    state: 'insert',
    source: 'user',
    timestamp: 1_700_000_000_100,
    monotonic_ms: 100,
    detail: { block_kind: null, graphemes_added: 12, graphemes_removed: null, words_added: 2, words_removed: null },
  }, 'a count the host did not supply is null (not measured), never 0');

  mono = 250;
  const rewrite = tracker.record({
    state: 'replace', source: 'ai', graphemes_added: 55, graphemes_removed: 40, words_added: 9, words_removed: 7,
    context_id: 'essay-1',
  });
  assert.equal(rewrite.source, 'ai', 'who made the edit is part of the event');
  assert.equal(rewrite.context_id, 'essay-1');
  assert.equal(rewrite.detail.graphemes_removed, 40);

  const moved = tracker.record({ state: 'block_reorder', source: 'system', block_kind: 'paragraph' });
  assert.equal(moved.detail.block_kind, 'paragraph');
  assert.deepEqual(events.map((event) => event.state), ['insert', 'replace', 'block_reorder']);

  // Every state in the vocabulary is recordable.
  for (const state of OYON_DOCUMENT_EDIT_STATES) {
    assert.equal(tracker.record({ state }).state, state);
  }

  // Broken reports raise, by class.
  assert.throws(() => tracker.record({ state: 'rewrite' }), TypeError, 'a state outside the closed vocabulary');
  assert.throws(() => tracker.record({ state: 'insert', source: 'plugin' }), TypeError);
  assert.throws(() => tracker.record({ state: 'insert', graphemes_added: -1 }), TypeError);
  assert.throws(() => tracker.record({ state: 'insert', graphemes_added: '12' }), TypeError);
  // The text never crosses the boundary, under any of its plausible names.
  for (const field of ['text', 'content', 'value', 'html', 'body', 'before', 'after']) {
    assert.throws(() => tracker.record({ state: 'insert', [field]: 'the words' }), TypeError,
      `a "${field}" field must be refused`);
  }

  tracker.dispose();
  assert.equal(tracker.active, false);
  assert.equal(tracker.record({ state: 'insert' }), null, 'inert after dispose');
}

// ── CodeRunTracker ────────────────────────────────────────────────────────
{
  let mono = 0;
  const events = [];
  const tracker = createCodeRunTracker({
    onEvent: (event) => events.push(event),
    now: () => mono,
    wallClockNow: () => 1_700_000_000_000 + mono,
  });

  mono = 1000;
  tracker.started({ run_id: 'r1', language: 'python' });
  mono = 1750;
  const ok = tracker.succeeded({ run_id: 'r1', language: 'python' });
  assert.deepEqual(ok.detail, { run_id: 'r1', language: 'python', duration_ms: 750, error_kind: null },
    'duration is measured here, on the monotonic clock: 1750 − 1000');

  mono = 2000;
  tracker.started({ run_id: 'r2' });
  mono = 2400;
  const failed = tracker.failed({ run_id: 'r2', error_kind: 'syntax' });
  assert.equal(failed.state, 'failure');
  assert.equal(failed.detail.duration_ms, 400);
  assert.equal(failed.detail.error_kind, 'syntax', 'the kind of error only');

  mono = 3000;
  tracker.started({ run_id: 'r3' });
  mono = 9000;
  const stopped = tracker.interrupted({ run_id: 'r3' });
  assert.equal(stopped.state, 'interrupt');
  assert.equal(stopped.detail.duration_ms, 6000);

  // An ending with no matching start is reported with an unknown duration.
  assert.equal(tracker.succeeded({ run_id: 'never-started' }).detail.duration_ms, null);
  // A run's start is consumed by its ending: a second ending has no duration.
  assert.equal(tracker.succeeded({ run_id: 'r1' }).detail.duration_ms, null);
  // error_kind belongs to a failure only.
  assert.equal(tracker.succeeded({ run_id: 'x', error_kind: 'syntax' }).detail.error_kind, null);

  assert.deepEqual(events.map((event) => event.state),
    ['start', 'success', 'start', 'failure', 'start', 'interrupt', 'success', 'success', 'success']);
  assert.ok(events.every((event) => OYON_CODE_RUN_STATES.includes(event.state)));

  for (const field of ['code', 'source_code', 'output', 'stdout', 'stderr', 'message', 'stack', 'text']) {
    assert.throws(() => tracker.failed({ run_id: 'r9', [field]: 'boom' }), TypeError,
      `a "${field}" field must be refused`);
  }
  assert.throws(() => tracker.started({ source: 'cron' }), TypeError);

  // The pending-start map is bounded.
  const bounded = createCodeRunTracker({ maxPendingRuns: 2, now: () => mono });
  bounded.started({ run_id: 'a' });
  bounded.started({ run_id: 'b' });
  bounded.started({ run_id: 'c' });
  assert.equal(bounded.succeeded({ run_id: 'a' }).detail.duration_ms, null, 'the oldest start was evicted');
  assert.equal(bounded.succeeded({ run_id: 'c' }).detail.duration_ms, 0);

  tracker.dispose();
  assert.equal(tracker.started({ run_id: 'late' }), null, 'inert after dispose');
}

// ── SignalEventLog accepts the new modalities and stamps identity ─────────
{
  let id = 0;
  const log = new SignalEventLog({ now: () => 5, monotonicNow: () => 6, idFactory: () => `evt-${++id}` });
  log.start({ capture_id: 'c1', session_id: 's1', user_id: 'ada', group_id: 'team-a', context_id: 'essay-1' });
  const stored = log.record({ modality: 'document_edit', state: 'paste', source: 'user', detail: { graphemes_added: 30 } });
  assert.deepEqual(stored, {
    event_id: 'evt-1',
    capture_id: 'c1',
    session_id: 's1',
    user_id: 'ada',
    group_id: 'team-a',
    context_id: 'essay-1',
    modality: 'document_edit',
    state: 'paste',
    source: 'user',
    sequence_index: 0,
    timestamp: 5,
    monotonic_ms: 6,
    state_vocabulary: 'document-edit-states-v1',
    target: null,
    detail: { graphemes_added: 30 },
  });
  // An event may name its own document.
  assert.equal(log.record({ modality: 'code_run', state: 'start', context_id: 'notebook-2' }).context_id, 'notebook-2');
  assert.throws(() => log.record({ modality: 'code_run', state: 'launch' }), /unknown state/);

  // A log started without identity stamps none (records look as they did).
  const plain = new SignalEventLog({ idFactory: () => 'e' });
  plain.start({ capture_id: 'c', session_id: 's' });
  const event = plain.record({ modality: 'typing', state: 'insert' });
  assert.deepEqual(Object.keys(event), [
    'event_id', 'capture_id', 'session_id', 'modality', 'state', 'source', 'sequence_index',
    'timestamp', 'monotonic_ms', 'state_vocabulary', 'target', 'detail',
  ], 'the stored event shape is unchanged when no identity is supplied');
}

// ── SignalCapture: gated construction, one shared timeline ────────────────
{
  const off = createSignalCapture({ settings: {} });
  off.start({ capture_id: 'c', session_id: 's' });
  assert.equal(off.documentEdit, null, 'disabled: no tracker is constructed');
  assert.equal(off.codeRun, null);
  await off.stop();

  let id = 0;
  const seen = [];
  const capture = createSignalCapture({
    settings: { document_edit_enabled: true, code_run_enabled: true, ai_assist_enabled: true },
    context: { session_id: 's1', user_id: 'ada', group_id: 'team-a' },
    idFactory: (prefix) => `${prefix}-${++id}`,
    onEvent: (event) => seen.push(event),
  });
  capture.start({ capture_id: 'c1' });
  capture.documentEdit.record({ state: 'insert', graphemes_added: 5 });
  capture.aiAssist.requested({ suggestion_id: 'q1' });
  capture.documentEdit.record({ state: 'replace', source: 'ai', graphemes_added: 80, graphemes_removed: 20 });
  capture.codeRun.started({ run_id: 'r1' });
  capture.codeRun.failed({ run_id: 'r1', error_kind: 'runtime' });

  assert.deepEqual(seen.map((event) => [event.sequence_index, event.modality, event.state]), [
    [0, 'document_edit', 'insert'],
    [1, 'ai_assist', 'suggestion_request'],
    [2, 'document_edit', 'replace'],
    [3, 'code_run', 'start'],
    [4, 'code_run', 'failure'],
  ], 'document edits and code runs interleave with the other channels on one sequence');
  assert.ok(seen.every((event) => event.user_id === 'ada' && event.group_id === 'team-a' && event.session_id === 's1'));
  assert.deepEqual(capture.stats.events, { document_edit: 2, ai_assist: 1, code_run: 2 });

  // The chains the Dynamics view builds from these events.
  assert.deepEqual(capture.log.toSequences({ modality: 'document_edit' }), [['insert', 'replace']]);
  assert.deepEqual(capture.log.toSequences({ modality: 'code_run' }), [['start', 'failure']]);

  // What capture emits is what a host can feed back.
  const checked = validateHostRecords({ signalEvents: seen });
  assert.equal(checked.counts.refused.total, 0);

  await capture.stop();
  assert.equal(capture.documentEdit, null, 'handles are gone after stop');
}

console.log('host-acts OK');

// ── ai_decision: a person's ruling on an AI's words, carried by the edit that enacted it ──
{
  const { createDocumentEditTracker } = await import('../src/index.js');
  const tracker = createDocumentEditTracker({});
  assert.equal(tracker.record({ state: 'replace', ai_decision: 'rejected' }).detail.ai_decision, 'rejected');
  assert.ok(!('ai_decision' in tracker.record({ state: 'insert' }).detail), 'absent unless supplied');
  assert.throws(() => tracker.record({ state: 'insert', ai_decision: 'maybe' }), /ai_decision/);
}
