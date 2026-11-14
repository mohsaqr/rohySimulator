/**
 * TypingEditReporter — the typing capture entry for a host that OWNS its
 * editor's model.
 *
 * A rich-text or code editor that applies its own edits (a `contenteditable`
 * driven by a document model, a canvas editor, a collaborative editor) often
 * fires no `input` event and has no `value` / `selectionStart`, so neither
 * DOM adapter can observe it. Such a host already knows every edit exactly;
 * it reports each one here, and this entry forwards it to the same
 * `TypingAggregator.record()` call the DOM adapters end in. The result is the
 * same `typing-v3` window and the same `typing-states-v1` event sequence.
 *
 * What the host reports is counts and positions, never text:
 *
 *   reportEdit({
 *     inputType,         // the `beforeinput` vocabulary: 'insertText',
 *                        // 'deleteContentBackward', 'insertFromPaste',
 *                        // 'historyUndo', 'historyRedo',
 *                        // 'insertReplacementText', … or null
 *     graphemesBefore,   // grapheme clusters in the document before the edit
 *     graphemesAfter,    //                                   … and after it
 *     wordsBefore,       // word count before the edit (optional)
 *     wordsAfter,        //              … and after it (optional)
 *     caretOffset,       // caret AFTER the edit (optional)
 *     selectionLength,   // selection length AFTER the edit, normally 0
 *     replacedSelection, // a non-collapsed selection existed BEFORE the edit
 *     compositionState,  // 'none' | 'start' | 'update' | 'end' (IME)
 *     boundaryContext,   // where the caret sat BEFORE the edit; classify it
 *                        // with `classifyBoundaryContext` (optional)
 *     timestamp,         // monotonic ms (optional; defaults to `now()`)
 *     wallTimestamp,     // Date.now()-epoch ms (optional)
 *   })
 *
 * Count with `countGraphemes` / `countTypingWords` (or `createTextCounters`)
 * and classify with `classifyBoundaryContext` from `oyon/typing/adapter` so
 * the numbers are the ones a DOM adapter would have produced.
 *
 * A selection made without an edit goes through `reportSelection()`. Focus,
 * blur and tab visibility are not typing states (the DOM adapters do not emit
 * them either); they are reported with `reportFocus()` / `reportBlur()` /
 * `reportVisibility()` and leave as `interaction-states-v1` events through
 * `onInteractionEvent`, the same events `createInteractionTracker` emits for
 * a page it can listen to.
 */

import { BOUNDARY_CONTEXTS } from './typingText.js';

const DEFAULT_TARGET_KIND = 'document_editor';
const COMPOSITION_STATES = ['none', 'start', 'update', 'end'];

function fail(message) {
  throw new TypeError(`createTypingEditReporter: ${message}`);
}

function requireCount(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    fail(`${name} must be a non-negative number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function optionalCount(value, name) {
  if (value === null || value === undefined) return null;
  return requireCount(value, name);
}

export function createTypingEditReporter(options = {}) {
  const {
    aggregator,
    targetKind = DEFAULT_TARGET_KIND,
    targetId = null,
    onWindow = null,
    // Sink for focus / blur / visibility reports, as interaction-states-v1
    // events. `null` (default) means those reports are accepted and dropped.
    onInteractionEvent = null,
    now = defaultNow,
    wallClockNow = defaultWallClockNow,
  } = options;

  if (!aggregator) fail('aggregator is required');

  let active = false;
  let graphemes = 0;
  let words = null;
  // Last caret/selection handed to the aggregator, by an edit or a selection
  // report. A selection report that repeats it is dropped — every edit
  // already reported the caret it left behind, and repeating it would log a
  // spurious `move` after each keystroke. Same rule as the DOM adapters.
  let lastReportedCaretOffset = null;
  let lastReportedSelectionLength = null;

  /**
   * Begin an episode. `graphemes` / `words` are the document's counts when
   * the episode opens (text that pre-existed it); `caretOffset` /
   * `selectionLength` are the selection at that moment. All optional.
   */
  function start(initial = {}) {
    if (active) return; // idempotent, like the DOM adapters.
    graphemes = optionalCount(initial.graphemes, 'start().graphemes') ?? 0;
    words = optionalCount(initial.words, 'start().words');
    lastReportedCaretOffset = initial.caretOffset ?? null;
    lastReportedSelectionLength = initial.selectionLength ?? 0;
    active = true;
    aggregator.start({ timestamp: initial.timestamp ?? now(), targetKind, targetId });
  }

  /** Report one edit the host's editor applied. No-op when not active. */
  function reportEdit(edit = {}) {
    if (!active) return;
    const previousGraphemes = requireCount(edit.graphemesBefore, 'reportEdit().graphemesBefore');
    const currentGraphemes = requireCount(edit.graphemesAfter, 'reportEdit().graphemesAfter');
    const previousWords = optionalCount(edit.wordsBefore, 'reportEdit().wordsBefore');
    const currentWords = optionalCount(edit.wordsAfter, 'reportEdit().wordsAfter');
    const compositionState = edit.compositionState ?? 'none';
    if (!COMPOSITION_STATES.includes(compositionState)) {
      fail(`reportEdit().compositionState must be one of ${COMPOSITION_STATES.join(', ')}, got ${JSON.stringify(compositionState)}`);
    }
    const boundaryContext = edit.boundaryContext ?? null;
    if (boundaryContext !== null && !BOUNDARY_CONTEXTS.includes(boundaryContext)) {
      fail(`reportEdit().boundaryContext must be one of ${BOUNDARY_CONTEXTS.join(', ')}, got ${JSON.stringify(boundaryContext)}`);
    }
    const caretOffset = edit.caretOffset ?? null;
    const selectionLength = edit.selectionLength ?? 0;

    aggregator.record({
      timestamp: edit.timestamp ?? now(),
      wallTimestamp: edit.wallTimestamp ?? wallClockNow(),
      inputType: edit.inputType ?? null,
      previousGraphemes,
      currentGraphemes,
      previousWords,
      currentWords,
      replacedSelection: edit.replacedSelection === true,
      compositionState,
      caretOffset,
      selectionLength,
      boundaryContext,
    });
    graphemes = currentGraphemes;
    if (currentWords !== null) words = currentWords;
    lastReportedCaretOffset = caretOffset;
    lastReportedSelectionLength = selectionLength;
  }

  /**
   * Report a selection or caret move made WITHOUT an edit (re-reading a
   * passage by selecting it is a real writing-process behaviour). Dropped
   * when it repeats the last reported caret and selection length.
   */
  function reportSelection(selection = {}) {
    if (!active) return;
    const caretOffset = selection.caretOffset ?? null;
    const selectionLength = selection.selectionLength ?? 0;
    if (caretOffset === lastReportedCaretOffset && selectionLength === lastReportedSelectionLength) return;
    const boundaryContext = selection.boundaryContext ?? null;
    if (boundaryContext !== null && !BOUNDARY_CONTEXTS.includes(boundaryContext)) {
      fail(`reportSelection().boundaryContext must be one of ${BOUNDARY_CONTEXTS.join(', ')}, got ${JSON.stringify(boundaryContext)}`);
    }
    aggregator.record({
      timestamp: selection.timestamp ?? now(),
      wallTimestamp: selection.wallTimestamp ?? wallClockNow(),
      inputType: null,
      previousGraphemes: graphemes,
      currentGraphemes: graphemes,
      previousWords: words,
      currentWords: words,
      replacedSelection: false,
      compositionState: 'none',
      caretOffset,
      selectionLength,
      boundaryContext,
    });
    lastReportedCaretOffset = caretOffset;
    lastReportedSelectionLength = selectionLength;
  }

  function reportInteraction(state, timestamp) {
    if (!active || typeof onInteractionEvent !== 'function') return;
    onInteractionEvent({
      modality: 'interaction',
      state,
      source: 'user',
      timestamp: timestamp ?? wallClockNow(),
      detail: null,
    });
  }

  /** The editor gained focus. */
  function reportFocus({ timestamp } = {}) {
    reportInteraction('focus_gain', timestamp);
  }

  /** The editor lost focus. */
  function reportBlur({ timestamp } = {}) {
    reportInteraction('focus_loss', timestamp);
  }

  /**
   * The page became hidden or visible. Like the DOM adapters, this never
   * finalizes the episode: a real interaction can span a tab switch, and the
   * aggregator's pause buckets already represent the gap.
   */
  function reportVisibility({ hidden, timestamp } = {}) {
    reportInteraction(hidden === true ? 'tab_hidden' : 'tab_visible', timestamp);
  }

  function finalize(reason) {
    if (!active) return null;
    const windowObject = aggregator.finalize({ timestamp: now(), reason });
    // Inactive BEFORE the host's onWindow runs, so a callback that throws or
    // reports again leaves no half-open episode behind.
    active = false;
    if (windowObject != null && typeof onWindow === 'function') onWindow(windowObject);
    return windowObject;
  }

  return {
    start,
    reportEdit,
    reportSelection,
    reportFocus,
    reportBlur,
    reportVisibility,
    submit() { return finalize('submitted'); },
    abandon() { return finalize('abandoned'); },
    /** Safe to call twice and after submit()/abandon(); does not finalize. */
    dispose() { active = false; },
    get active() { return active; },
  };
}

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultWallClockNow() {
  return Date.now();
}
