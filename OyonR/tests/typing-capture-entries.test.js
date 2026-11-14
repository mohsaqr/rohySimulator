import assert from 'node:assert/strict';
import { TypingAggregator } from '../src/aggregation/TypingAggregator.js';
import { createTypingComposerAdapter } from '../src/capture/TypingComposerAdapter.js';
import { createTypingContentEditableAdapter } from '../src/capture/TypingContentEditableAdapter.js';
import { createTypingEditReporter } from '../src/capture/TypingEditReporter.js';
import { classifyBoundaryContext, createTextCounters } from '../src/capture/typingText.js';
import { createSignalCapture } from '../src/core/SignalCapture.js';

/*
 * Equivalence of the three typing capture entries (AGENT-NOTE-HOST-SCOPES
 * acceptance 1).
 *
 * ONE scripted editing session — typing, a pause at each boundary kind,
 * backspacing, a paste over a selection, undo and redo, a selection made
 * without an edit, an accepted correction and an IME composition — is driven
 * through:
 *
 *   1. the text-field adapter      (a fake <textarea>: value + selectionStart/End)
 *   2. the contenteditable adapter (a fake DOM subtree + document selection)
 *   3. the reported-edit entry     (the host computes counts and reports them)
 *
 * each feeding its own real TypingAggregator on identical clocks. The three
 * must yield the same typing-v3 window and the same event sequence, field for
 * field. The DOM is faked by hand, as in tests/typing-adapter.test.js.
 */

const WALL_EPOCH = 1_700_000_000_000;
const TARGET = { targetKind: 'document_editor', targetId: 'doc-1' };

function makeFakeTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type, props = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, ...props });
    },
    listenerCount() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
  };
}

function makeTimerQueue() {
  const queue = [];
  let next = 1;
  return {
    setTimer(fn) {
      const handle = next++;
      queue.push({ handle, fn });
      return handle;
    },
    clearTimer(handle) {
      const index = queue.findIndex((entry) => entry.handle === handle);
      if (index >= 0) queue.splice(index, 1);
    },
    flushAll() {
      while (queue.length > 0) queue.shift().fn();
    },
  };
}

/** One clock per driver; every driver advances it identically. */
function makeClock() {
  let t = 1000;
  return {
    now: () => t,
    wall: () => WALL_EPOCH + t,
    advance(ms) { t += ms; },
  };
}

function makeAggregator(clock, events) {
  return new TypingAggregator({ now: clock.wall, onEvent: (event) => events.push(event) });
}

// ── driver 1 + 2: DOM adapters ────────────────────────────────────────────

/**
 * A DOM driver keeps a fake editor in step with the model `{ text, start,
 * end }` and fires the DOM events a browser would. `sync` is the only thing
 * that differs between a text field and a contenteditable.
 */
function makeDomDriver({ createAdapter, makeEditor }) {
  const clock = makeClock();
  const events = [];
  const timers = makeTimerQueue();
  const doc = { ...makeFakeTarget(), activeElement: null, selection: null, getSelection() { return this.selection; } };
  const editor = makeEditor(doc);
  doc.activeElement = editor.element;
  let model = { text: '', start: 0, end: 0 };
  editor.sync(model);

  const adapter = createAdapter({
    element: editor.element,
    aggregator: makeAggregator(clock, events),
    ...TARGET,
    documentRef: doc,
    now: clock.now,
    wallClockNow: clock.wall,
    setTimerFn: timers.setTimer,
    clearTimerFn: timers.clearTimer,
  });

  /** What a browser does after any change: a document selectionchange. */
  function echoSelection() {
    doc.fire('selectionchange');
    timers.flushAll();
  }

  return {
    events,
    element: editor.element,
    doc,
    start() { adapter.start(); },
    advance(ms) { clock.advance(ms); },
    compositionStart() { editor.element.fire('compositionstart'); },
    edit(inputType, op, composition = 'none') {
      if (composition === 'end') editor.element.fire('compositionend');
      editor.element.fire('beforeinput', { inputType });
      model = op(model);
      editor.sync(model);
      if (composition === 'update') editor.element.fire('compositionupdate');
      editor.element.fire('input');
      echoSelection();
    },
    select(start, end) {
      model = { ...model, start, end };
      editor.sync(model);
      echoSelection();
    },
    submit() { return adapter.submit(); },
  };
}

function makeTextField(doc) {
  const element = { ...makeFakeTarget(), value: '', selectionStart: 0, selectionEnd: 0, ownerDocument: doc };
  return {
    element,
    sync(model) {
      element.value = model.text;
      element.selectionStart = model.start;
      element.selectionEnd = model.end;
    },
  };
}

/**
 * A contenteditable holding the same writing: one <div> per line with a text
 * node inside (an empty line is `<div><br></div>`, as browsers render it), and
 * the document selection pointing into those nodes.
 */
function makeContentEditable(doc) {
  const element = {
    ...makeFakeTarget(),
    nodeType: 1,
    nodeName: 'DIV',
    childNodes: [],
    isContentEditable: true,
    ownerDocument: doc,
  };
  function position(lines, blocks, offset) {
    let base = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (offset <= base + lines[i].length) {
        return lines[i].length === 0
          ? { node: blocks[i], offset: 0 }
          : { node: blocks[i].childNodes[0], offset: offset - base };
      }
      base += lines[i].length + 1;
    }
    throw new Error(`offset ${offset} is past the end of the text`);
  }
  return {
    element,
    sync(model) {
      if (model.text === '') {
        element.childNodes = [];
        doc.selection = { anchorNode: element, anchorOffset: 0, focusNode: element, focusOffset: 0 };
        return;
      }
      const lines = model.text.split('\n');
      const blocks = lines.map((line) => ({
        nodeType: 1,
        nodeName: 'DIV',
        childNodes: line.length === 0
          ? [{ nodeType: 1, nodeName: 'BR', childNodes: [] }]
          : [{ nodeType: 3, nodeName: '#text', data: line, childNodes: [] }],
      }));
      element.childNodes = blocks;
      const anchor = position(lines, blocks, model.start);
      const focus = position(lines, blocks, model.end);
      doc.selection = {
        anchorNode: anchor.node,
        anchorOffset: anchor.offset,
        focusNode: focus.node,
        focusOffset: focus.offset,
      };
    },
  };
}

// ── driver 3: the host reports its own edits ──────────────────────────────

function makeReporterDriver({ mutate = (edit) => edit } = {}) {
  const clock = makeClock();
  const events = [];
  const interactionEvents = [];
  const counters = createTextCounters();
  let model = { text: '', start: 0, end: 0 };
  let counts = counters.count(model.text);

  const reporter = createTypingEditReporter({
    aggregator: makeAggregator(clock, events),
    ...TARGET,
    now: clock.now,
    wallClockNow: clock.wall,
    onInteractionEvent: (event) => interactionEvents.push(event),
  });

  /** A host reports the settled selection after every change; repeats are dropped. */
  function echoSelection() {
    reporter.reportSelection({
      caretOffset: model.start,
      selectionLength: Math.abs(model.end - model.start),
      boundaryContext: classifyBoundaryContext(model.text, model.start),
    });
  }

  return {
    events,
    interactionEvents,
    reporter,
    start() { reporter.start({ graphemes: 0, words: 0, caretOffset: 0, selectionLength: 0 }); },
    advance(ms) { clock.advance(ms); },
    compositionStart() { /* a host has no separate event for this; nothing to report */ },
    edit(inputType, op, composition = 'none') {
      const before = model;
      const countsBefore = counts;
      model = op(model);
      counts = counters.count(model.text);
      reporter.reportEdit(mutate({
        inputType,
        graphemesBefore: countsBefore.graphemes,
        graphemesAfter: counts.graphemes,
        wordsBefore: countsBefore.words,
        wordsAfter: counts.words,
        caretOffset: model.start,
        selectionLength: Math.abs(model.end - model.start),
        replacedSelection: before.start !== before.end,
        compositionState: composition,
        boundaryContext: classifyBoundaryContext(before.text, before.start),
      }));
      echoSelection();
    },
    select(start, end) {
      model = { ...model, start, end };
      echoSelection();
    },
    submit() { return reporter.submit(); },
  };
}

// ── the script ────────────────────────────────────────────────────────────

/** Replace the current selection with `inserted`; the caret lands after it. */
const insert = (inserted) => (m) => {
  const lo = Math.min(m.start, m.end);
  const hi = Math.max(m.start, m.end);
  const caret = lo + inserted.length;
  return { text: m.text.slice(0, lo) + inserted + m.text.slice(hi), start: caret, end: caret };
};
/** Delete one character before the caret. */
const backspace = (m) => ({ text: m.text.slice(0, m.start - 1) + m.text.slice(m.end), start: m.start - 1, end: m.start - 1 });
/** Set the whole state (undo / redo restore a prior one). */
const restore = (state) => () => ({ ...state });

function runScript(driver) {
  const typeText = (textToType, gapMs = 120) => {
    for (const ch of textToType) {
      driver.advance(gapMs);
      driver.edit(ch === '\n' ? 'insertParagraph' : 'insertText', insert(ch));
    }
  };

  driver.start();
  typeText('Hello ');
  driver.advance(2500);          // pause at a WORD boundary
  typeText('world. ');
  driver.advance(3000);          // pause at a SENTENCE boundary
  typeText('Next\n');
  driver.advance(2600);          // pause at a PARAGRAPH boundary
  typeText('Para');

  driver.advance(150);
  driver.edit('deleteContentBackward', backspace);
  driver.advance(150);
  driver.edit('deleteContentBackward', backspace);   // "Hello world. Next\nPa"

  driver.advance(400);
  driver.select(2, 2);           // caret moved into "He|llo" — no edit
  driver.advance(2200);          // pause MID-WORD
  typeText('X');                 // "HeXllo world. Next\nPa"

  driver.advance(500);
  driver.select(0, 6);           // select "HeXllo" without editing
  const beforePaste = { text: 'HeXllo world. Next\nPa', start: 0, end: 6 };
  driver.advance(300);
  driver.edit('insertFromPaste', insert('Greetings'));   // paste over the selection
  const afterPaste = { text: 'Greetings world. Next\nPa', start: 9, end: 9 };

  driver.advance(700);
  driver.edit('historyUndo', restore(beforePaste));
  driver.advance(600);
  driver.edit('historyRedo', restore(afterPaste));

  driver.advance(300);
  driver.select(10, 15);         // select "world"
  driver.advance(250);
  driver.edit('insertReplacementText', insert('World'));   // accepted correction

  // IME composition at the end of the document: two candidate updates, then commit.
  const end = 'Greetings World. Next\nPa'.length;
  driver.advance(300);
  driver.select(end, end);
  driver.advance(200);
  driver.compositionStart();
  driver.edit('insertCompositionText', insert('k'), 'update');
  driver.advance(180);
  driver.edit('insertCompositionText', (m) => ({ text: `${m.text.slice(0, -1)}か`, start: m.start, end: m.end }), 'update');
  driver.advance(220);
  driver.edit('insertCompositionText', (m) => m, 'end');

  driver.advance(900);
  return driver.submit();
}

// ── 1. The three entries agree, field for field ───────────────────────────
const textField = makeDomDriver({ createAdapter: createTypingComposerAdapter, makeEditor: makeTextField });
const contentEditable = makeDomDriver({ createAdapter: createTypingContentEditableAdapter, makeEditor: makeContentEditable });
const reported = makeReporterDriver();

const textFieldWindow = runScript(textField);
const contentEditableWindow = runScript(contentEditable);
const reportedWindow = runScript(reported);

assert.ok(textFieldWindow, 'the text-field adapter produced a window');
assert.deepEqual(contentEditableWindow, textFieldWindow,
  'the contenteditable adapter must yield the same typing-v3 window as the text-field adapter');
assert.deepEqual(reportedWindow, textFieldWindow,
  'the reported-edit entry must yield the same typing-v3 window as the text-field adapter');
assert.deepEqual(contentEditable.events, textField.events,
  'the contenteditable adapter must emit the same event sequence');
assert.deepEqual(reported.events, textField.events,
  'the reported-edit entry must emit the same event sequence');

// ── 2. …and the session exercised what it claims to ───────────────────────
{
  const { typing } = textFieldWindow;
  assert.equal(textFieldWindow.feature_profile, 'typing-v3');
  assert.deepEqual(textFieldWindow.target, { kind: 'document_editor', id: 'doc-1' });
  assert.equal(typing.submitted, true);

  // A pause before an edit at each of the four boundary kinds.
  for (const location of ['mid_word', 'word_boundary', 'sentence_boundary', 'paragraph_boundary']) {
    assert.ok(typing.pause_location_counts[location] >= 1,
      `the script must record a pause at a ${location}, got ${JSON.stringify(typing.pause_location_counts)}`);
  }

  const states = textField.events.map((event) => event.state);
  for (const state of ['start', 'insert', 'delete', 'paste', 'undo', 'redo', 'correct', 'move', 'select', 'composing', 'pause', 'submit']) {
    assert.ok(states.includes(state), `the event sequence must include "${state}"; got ${[...new Set(states)].join(', ')}`);
  }
  // Pasting "Greetings" (9) over the selected "HeXllo" (6) nets +3: the
  // aggregator sees grapheme deltas, never the pasted text.
  assert.equal(typing.pasted_graphemes, 3, 'net graphemes added by the paste');
  assert.equal(typing.correction_count, 1, 'one accepted correction');
  assert.ok(typing.composition_count >= 3, 'two candidate updates and the commit');
  // Final document: "Greetings World. Next\nPaか"
  assert.equal(typing.committed_graphemes, 'Greetings World. Next\nPaか'.length);
  assert.ok(Number.isFinite(typing.words_per_min), 'word counts were supplied, so words/min is measured');

  // No event and no window field carries the text.
  const serialized = JSON.stringify([textFieldWindow, textField.events]);
  for (const fragment of ['Greetings', 'world', 'Hello']) {
    assert.ok(!serialized.includes(fragment), `the text "${fragment}" must never cross the capture boundary`);
  }
}

// ── 3. The comparison can fail: a wrong report changes the result ─────────
{
  // Same session, but the host reports every boundary as word_boundary.
  const sloppy = makeReporterDriver({ mutate: (edit) => ({ ...edit, boundaryContext: 'word_boundary' }) });
  const sloppyWindow = runScript(sloppy);
  assert.notDeepEqual(sloppyWindow, textFieldWindow,
    'a reporter that misclassifies boundaries must NOT match — otherwise the equivalence above proves nothing');
  assert.equal(sloppyWindow.typing.pause_location_counts.sentence_boundary, 0);
}

// ── 4. Teardown and scope discipline of the contenteditable adapter ───────
{
  assert.equal(contentEditable.element.listenerCount(), 0, 'submit() removed every element listener');
  assert.equal(contentEditable.doc.listenerCount(), 0, 'submit() removed every document listener');

  // A selection that lies outside the element is not this adapter's to report.
  const clock = makeClock();
  const calls = [];
  const timers = makeTimerQueue();
  const doc = { ...makeFakeTarget(), activeElement: null, selection: null, getSelection() { return this.selection; } };
  const editor = makeContentEditable(doc);
  editor.sync({ text: 'abc', start: 1, end: 1 });
  const adapter = createTypingContentEditableAdapter({
    element: editor.element,
    aggregator: { start() {}, record(args) { calls.push(args); }, finalize() { return null; } },
    documentRef: doc,
    now: clock.now,
    wallClockNow: clock.wall,
    setTimerFn: timers.setTimer,
    clearTimerFn: timers.clearTimer,
  });
  adapter.start();
  const elsewhere = { nodeType: 3, nodeName: '#text', data: 'other field', childNodes: [] };
  doc.selection = { anchorNode: elsewhere, anchorOffset: 2, focusNode: elsewhere, focusOffset: 5 };
  doc.fire('selectionchange');
  timers.flushAll();
  assert.equal(calls.length, 0, 'a selection in another part of the page never reaches this adapter');
  adapter.dispose();
}

// ── 5. Reporter contract: focus/visibility, and errors by class ───────────
{
  const driver = makeReporterDriver();
  driver.start();
  driver.reporter.reportFocus({ timestamp: 5 });
  driver.reporter.reportVisibility({ hidden: true, timestamp: 6 });
  driver.reporter.reportVisibility({ hidden: false, timestamp: 7 });
  driver.reporter.reportBlur({ timestamp: 8 });
  assert.deepEqual(
    driver.interactionEvents.map((event) => [event.modality, event.state, event.timestamp]),
    [['interaction', 'focus_gain', 5], ['interaction', 'tab_hidden', 6], ['interaction', 'tab_visible', 7], ['interaction', 'focus_loss', 8]],
    'focus, blur and visibility leave as interaction-states-v1 events',
  );
  assert.deepEqual(driver.events.map((event) => event.state), ['start'],
    'they are not typing states — the DOM adapters emit none for them either');

  assert.throws(() => driver.reporter.reportEdit({ graphemesAfter: 3 }), TypeError,
    'a missing graphemesBefore is a broken report, not a zero');
  assert.throws(() => driver.reporter.reportEdit({ graphemesBefore: 0, graphemesAfter: -1 }), TypeError);
  assert.throws(() => driver.reporter.reportEdit({ graphemesBefore: 0, graphemesAfter: 1, boundaryContext: 'clause' }), TypeError);
  assert.throws(() => driver.reporter.reportEdit({ graphemesBefore: 0, graphemesAfter: 1, compositionState: 'maybe' }), TypeError);
  assert.throws(() => createTypingEditReporter({}), TypeError, 'an aggregator is required');

  // After submit the reporter is inert: no throw, no record.
  driver.submit();
  assert.equal(driver.reporter.active, false);
  driver.reporter.reportEdit({ graphemesBefore: 0, graphemesAfter: 1 });
  assert.equal(driver.reporter.submit(), null);
}

// ── 6. SignalCapture: the right entry per editor, identity on every record ─
{
  let id = 0;
  const rows = [];
  const capture = createSignalCapture({
    settings: { typing_enabled: true },
    context: { session_id: 'sess-1', user_id: 'student-42', user_label: 'Student 42', group_id: 'team-a' },
    idFactory: (prefix) => `${prefix}-${++id}`,
    onWindow: (row) => rows.push(row),
  });
  capture.start({ capture_id: 'cap-1' });

  // A contenteditable element gets the contenteditable adapter…
  const doc = { ...makeFakeTarget(), activeElement: null, selection: null, getSelection() { return this.selection; } };
  const editor = makeContentEditable(doc);
  editor.sync({ text: '', start: 0, end: 0 });
  capture.typing.attach(editor.element, { targetId: 'essay', contextId: 'doc-7' });
  editor.element.fire('beforeinput', { inputType: 'insertText' });
  editor.sync({ text: 'Hi', start: 2, end: 2 });
  editor.element.fire('input');
  const fromElement = capture.typing.submit();
  assert.equal(fromElement.typing.committed_graphemes, 2, 'the contenteditable text was read');
  assert.deepEqual(fromElement.target, { kind: 'document_editor', id: 'essay' });

  // …and a host that owns its model reports through the same handle.
  const reporter = capture.typing.report({ targetId: 'notebook', contextId: 'doc-8', graphemes: 10, words: 2 });
  reporter.reportEdit({ inputType: 'insertText', graphemesBefore: 10, graphemesAfter: 11, wordsBefore: 2, wordsAfter: 2 });
  reporter.reportFocus();
  capture.typing.submit();

  assert.equal(rows.length, 2);
  for (const [row, contextId] of [[rows[0], 'doc-7'], [rows[1], 'doc-8']]) {
    assert.equal(row.session_id, 'sess-1');
    assert.equal(row.user_id, 'student-42');
    assert.equal(row.user_label, 'Student 42');
    assert.equal(row.group_id, 'team-a');
    assert.equal(row.context_id, contextId, 'each editor stamps the document it holds');
  }
  assert.equal(rows[1].typing.baseline_graphemes, 10, 'text that pre-existed the episode is its baseline, not its production');

  const logged = capture.log.all();
  assert.ok(logged.every((event) => event.user_id === 'student-42' && event.group_id === 'team-a'),
    'every event carries the person and group');
  assert.deepEqual([...new Set(logged.map((event) => event.context_id))], ['doc-7', 'doc-8']);
  assert.ok(logged.some((event) => event.modality === 'interaction' && event.state === 'focus_gain'),
    'a reported focus lands on the shared timeline as an interaction event');
  assert.deepEqual(logged.map((event) => event.sequence_index), logged.map((_, index) => index),
    'one monotonic sequence across both editors');
  await capture.stop();

  // A host that supplies no identity gets records exactly as before.
  const plain = createSignalCapture({ settings: { typing_enabled: true }, context: { session_id: 's' } });
  plain.start();
  const plainReporter = plain.typing.report();
  plainReporter.reportEdit({ graphemesBefore: 0, graphemesAfter: 1 });
  const plainEvent = plain.log.all()[0];
  for (const key of ['user_id', 'user_label', 'group_id', 'group_label', 'class_id', 'class_label', 'context_id']) {
    assert.ok(!(key in plainEvent), `an unset ${key} is not stamped at all`);
  }
  await plain.stop();
}

console.log('typing-capture-entries OK');
