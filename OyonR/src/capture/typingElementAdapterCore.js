/**
 * typingElementAdapterCore — the one event-to-aggregator translation that the
 * text-field adapter (`createTypingComposerAdapter`) and the
 * `contenteditable` adapter (`createTypingContentEditableAdapter`) both run.
 *
 * The two adapters differ only in HOW the editor's text and selection are
 * read; everything else (which DOM events are heard, when the pre-edit
 * selection and boundary context are captured, the selection throttle, the
 * teardown order) must be identical or the same editing session yields
 * different `typing-v3` windows depending on the element type. That reading
 * is the `surface`:
 *
 *   surface.read() -> { value, selectionStart, selectionEnd }
 *       `value` is the editor's text; the offsets are UTF-16 code-unit offsets
 *       into it, or `null` when the element has no selection (or the document
 *       selection lies outside it).
 *   surface.ownsSelection(snapshot) -> boolean
 *       Whether a document `selectionchange` belongs to this element.
 *
 * Scope discipline: listeners attach to exactly the element given, plus
 * `visibilitychange` and (throttled) `selectionchange` on the provided
 * document, the latter filtered through `surface.ownsSelection`. No
 * page-wide listener is ever installed — a host may run several editors at
 * once and each gets its own adapter instance.
 *
 * Text is read transiently: one read per event, nothing retained, nothing
 * logged, and the text itself is never handed to `aggregator.record()`.
 */

import { classifyBoundaryContext, createTextCounters } from './typingText.js';

// Long enough to coalesce every intermediate `selectionchange` firing during
// a drag-select into one settled report; short enough that a deliberate
// "select this sentence to re-read it" gesture is still captured within a
// human-perceptible instant. Not derived from any spec value — a documented,
// tunable default (see docs/TYPING.md).
const DEFAULT_SELECTION_CHANGE_THROTTLE_MS = 200;

export function createTypingElementAdapter(options, { name, defaultTargetKind, createSurface }) {
  const {
    element,
    aggregator,
    targetKind = defaultTargetKind,
    targetId = null,
    onWindow = null,
    now = defaultNow,
    documentRef = element?.ownerDocument,
    segmenter = null,
    // `wordSegmenter` mirrors `segmenter` but for word (not grapheme)
    // counting. Pass an `Intl.Segmenter`-shaped object (real or fake) to
    // force `'injected'` mode; pass `false` explicitly to force the
    // whitespace-fallback path even in an environment where a real
    // `Intl.Segmenter` exists. Omit for normal auto-detection.
    wordSegmenter,
    selectionChangeThrottleMs = DEFAULT_SELECTION_CHANGE_THROTTLE_MS,
    // Test/host injection points for the trailing-edge throttle timer — same
    // idiom as `GazeCalibrationDriver`'s `setTimer`/`clearTimer`.
    setTimerFn = defaultSetTimer,
    clearTimerFn = defaultClearTimer,
    // Wall clock used for `wallTimestamp` — deliberately separate from `now`
    // above, which is a monotonic clock (`performance.now()`-shaped) used for
    // the aggregator's interval/pause accounting. `wallTimestamp` exists to
    // join a window against absolute-time host records, so it must stay on
    // `Date.now()`'s epoch. Injectable for deterministic tests.
    wallClockNow = defaultWallClockNow,
  } = options;

  if (!element) throw new Error(`${name}: element is required`);
  if (!aggregator) throw new Error(`${name}: aggregator is required`);

  const counters = createTextCounters({ segmenter, wordSegmenter });
  const surface = createSurface({ element, documentRef, options });

  let active = false;
  let listeners = []; // [target, type, listener]
  let previousGraphemes = 0;
  let previousWords = 0;
  let compositionState = 'none';
  let pendingInputType = null;
  let pendingReplacedSelection = false;
  // Boundary classification, captured at `beforeinput` — see `onBeforeInput`
  // for why it must be read there and not in `onInput`. Only the resulting
  // enum label is retained, never the characters that produced it.
  let pendingBoundaryContext = null;
  // Last caret/selection state actually handed to `aggregator.record()`, by
  // either the input path or the selectionchange path — lets the throttled
  // selectionchange handler skip firing when nothing has changed since the
  // most recent edit already reported the post-edit caret position (every
  // edit moves the caret, which would otherwise double-report as a spurious
  // `move` right after each keystroke).
  let lastReportedCaretOffset = null;
  let lastReportedSelectionLength = null;
  let selectionChangeTimerHandle = null;

  /** `null` when the element has no text selection. */
  function caretOffsetOf(snapshot) {
    return snapshot.selectionStart ?? null;
  }

  /** `0` (collapsed) when either endpoint is unavailable. */
  function selectionLengthOf(snapshot) {
    const start = snapshot.selectionStart;
    const end = snapshot.selectionEnd;
    if (start == null || end == null) return 0;
    return Math.abs(end - start);
  }

  function addListener(target, type, listener) {
    target.addEventListener(type, listener);
    listeners.push([target, type, listener]);
  }

  function removeAllListeners() {
    for (const [target, type, listener] of listeners) {
      target.removeEventListener(type, listener);
    }
    listeners = [];
  }

  function cancelPendingSelectionFlush() {
    if (selectionChangeTimerHandle !== null) {
      clearTimerFn(selectionChangeTimerHandle);
      selectionChangeTimerHandle = null;
    }
  }

  function onBeforeInput(event) {
    if (!active) return;
    // `beforeinput` fires before the DOM mutates, so it is the only reliable
    // moment to observe the pre-edit selection — by the time `input` fires,
    // the selection has already collapsed to the new caret position. Store
    // nothing else from the event; never read `event.data` (that would be
    // reading editor content, which is out of scope for this adapter).
    const snapshot = surface.read();
    pendingInputType = event?.inputType ?? null;
    pendingReplacedSelection = snapshot.selectionStart !== snapshot.selectionEnd;
    // Boundary classification is ALSO a beforeinput-only reading: by `input`
    // time the caret has already moved to reflect the edit, so classifying
    // there would describe where the caret ended up, not where the edit
    // actually started. Only a small bounded window around the caret is
    // read, and only the enum label survives this call.
    pendingBoundaryContext = classifyBoundaryContext(snapshot.value, snapshot.selectionStart);
  }

  function onInput() {
    if (!active) return;
    // `input` is the source of truth for content; `beforeinput` only supplies
    // hints (inputType, whether a selection was replaced, boundary context).
    const snapshot = surface.read();
    const { graphemes: currentGraphemes, words: currentWords } = counters.count(snapshot.value);
    const caretOffset = caretOffsetOf(snapshot);
    const selectionLength = selectionLengthOf(snapshot);
    aggregator.record({
      timestamp: now(),
      wallTimestamp: wallClockNow(),
      inputType: pendingInputType,
      previousGraphemes,
      currentGraphemes,
      previousWords,
      currentWords,
      replacedSelection: pendingReplacedSelection,
      compositionState,
      caretOffset,
      selectionLength,
      boundaryContext: pendingBoundaryContext,
    });
    previousGraphemes = currentGraphemes;
    previousWords = currentWords;
    lastReportedCaretOffset = caretOffset;
    lastReportedSelectionLength = selectionLength;
    pendingInputType = null;
    pendingReplacedSelection = false;
    pendingBoundaryContext = null;
    // 'end' is a one-shot tag for the input event that finalizes a
    // composition; once consumed, subsequent input events are plain typing.
    if (compositionState === 'end') compositionState = 'none';
  }

  function onCompositionStart() {
    if (!active) return;
    compositionState = 'start';
  }

  function onCompositionUpdate() {
    if (!active) return;
    compositionState = 'update';
  }

  function onCompositionEnd() {
    if (!active) return;
    compositionState = 'end';
  }

  function onVisibilityChange() {
    // Intentionally a no-op. Going hidden must NOT finalize the window: the
    // aggregator's own pause buckets already represent an idle gap from the
    // sample timestamps, and a real interaction can legitimately span a
    // tab-switch (e.g. checking another window mid-sentence). Finalization
    // is the host's explicit call via submit()/abandon().
  }

  /** Trailing-edge flush: report the SETTLED selection, not every intermediate one. */
  function flushSelectionChange() {
    selectionChangeTimerHandle = null;
    if (!active) return;
    const snapshot = surface.read();
    const caretOffset = caretOffsetOf(snapshot);
    const selectionLength = selectionLengthOf(snapshot);
    // Nothing changed since the last thing we reported (typically because an
    // `input` event already reported this exact caret position) — skip; see
    // the note on `lastReportedCaretOffset` above.
    if (caretOffset === lastReportedCaretOffset && selectionLength === lastReportedSelectionLength) return;
    aggregator.record({
      timestamp: now(),
      wallTimestamp: wallClockNow(),
      inputType: null,
      previousGraphemes,
      currentGraphemes: previousGraphemes,
      previousWords,
      currentWords: previousWords,
      replacedSelection: false,
      compositionState: 'none',
      caretOffset,
      selectionLength,
      // No `beforeinput` moment applies here — the value hasn't changed and
      // the caret has already settled by the time the throttle fires, so
      // classifying live (rather than from a stashed pre-edit reading) is
      // correct, unlike the edit path in `onBeforeInput`/`onInput`.
      boundaryContext: classifyBoundaryContext(snapshot.value, caretOffset),
    });
    lastReportedCaretOffset = caretOffset;
    lastReportedSelectionLength = selectionLength;
  }

  function onSelectionChange() {
    if (!active) return;
    // `selectionchange` fires on the DOCUMENT for any selection change on the
    // page; filter to only the selection we're authorized to observe.
    if (!surface.ownsSelection()) return;
    if (selectionChangeTimerHandle !== null) return; // already scheduled — trailing edge reads live state at fire time.
    selectionChangeTimerHandle = setTimerFn(flushSelectionChange, selectionChangeThrottleMs);
  }

  function start() {
    if (active) return; // idempotent — do not double-attach.
    active = true;
    addListener(element, 'beforeinput', onBeforeInput);
    addListener(element, 'input', onInput);
    addListener(element, 'compositionstart', onCompositionStart);
    addListener(element, 'compositionupdate', onCompositionUpdate);
    addListener(element, 'compositionend', onCompositionEnd);
    if (documentRef) {
      addListener(documentRef, 'visibilitychange', onVisibilityChange);
      addListener(documentRef, 'selectionchange', onSelectionChange);
    }

    const snapshot = surface.read();
    const initialCounts = counters.count(snapshot.value);
    previousGraphemes = initialCounts.graphemes;
    previousWords = initialCounts.words;
    pendingInputType = null;
    pendingReplacedSelection = false;
    pendingBoundaryContext = null;
    compositionState = 'none';
    lastReportedCaretOffset = caretOffsetOf(snapshot);
    lastReportedSelectionLength = selectionLengthOf(snapshot);

    aggregator.start({ timestamp: now(), targetKind, targetId });
  }

  function finalize(reason) {
    if (!active) return null;
    const windowObject = aggregator.finalize({ timestamp: now(), reason });
    // Flip inactive AND detach BEFORE invoking the host's onWindow: a
    // callback that throws must never leave listeners attached — the
    // add/remove symmetry guarantee holds even when the host misbehaves —
    // and any event fired synchronously as a side effect of onWindow is
    // ignored either way (listeners are already gone, and `active` is
    // false as the backstop). The throw still propagates to the
    // submit()/abandon() caller; teardown is simply complete first.
    active = false;
    cancelPendingSelectionFlush();
    removeAllListeners();
    if (windowObject != null && typeof onWindow === 'function') onWindow(windowObject);
    return windowObject;
  }

  function submit() {
    return finalize('submitted');
  }

  function abandon() {
    return finalize('abandoned');
  }

  function dispose() {
    // Safe to call twice, and safe after submit()/abandon() — does NOT
    // finalize; just drops listeners and references.
    active = false;
    cancelPendingSelectionFlush();
    removeAllListeners();
  }

  return {
    start,
    submit,
    abandon,
    dispose,
    get active() { return active; },
    get graphemeMode() { return counters.graphemeMode; },
    get wordMode() { return counters.wordMode; },
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

function defaultSetTimer(fn, ms) {
  return setTimeout(fn, ms);
}

function defaultClearTimer(handle) {
  clearTimeout(handle);
}
