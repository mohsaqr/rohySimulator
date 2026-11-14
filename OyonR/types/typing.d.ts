// Type declarations for the Oyon typing/composer subpath.
// Hand-written; consult JSDoc and the source modules
// (`src/aggregation/TypingAggregator.js`, `src/capture/TypingComposerAdapter.js`)
// for authoritative shapes. See docs/TYPING.md and audio_text.md §4.

/**
 * IME composition phase for one `record()` call.
 *   - `'none'`   — plain (non-IME) input.
 *   - `'start'`  — `compositionstart` fired; no visible text change yet.
 *   - `'update'` — an intermediate IME candidate update (candidate text, not
 *                  committed — does not move edit/grapheme/interval accounting).
 *   - `'end'`    — `compositionend` fired; this event commits the whole
 *                  composed text (the commit point for the composition).
 */
export type TypingCompositionState = 'none' | 'start' | 'update' | 'end';

/**
 * `typing-v3`. Classification of where the caret sat, immediately before an
 * edit, derived from ONLY the characters adjacent to the caret (never the
 * full document, never retained) — see `TypingComposerAdapter`'s
 * `classifyBoundaryContext` and docs/TYPING.md's "Pause location" section.
 *   - `'mid_word'`             — word characters on both sides of the caret.
 *   - `'word_boundary'`        — a space/word edge, not after sentence-ending
 *                                punctuation (the catch-all default).
 *   - `'sentence_boundary'`    — caret follows sentence-terminating
 *                                punctuation (`.`, `!`, `?`, `。`, `！`, `？`),
 *                                optionally with trailing whitespace.
 *   - `'paragraph_boundary'`   — caret follows a newline.
 */
export type TypingBoundaryContext = 'mid_word' | 'word_boundary' | 'sentence_boundary' | 'paragraph_boundary';

/**
 * One committed input event fed into `TypingAggregator.record()`. Produced
 * by `TypingComposerAdapter` from paired `beforeinput`/`input` (and
 * `composition*`/`selectionchange`) DOM events; never carries the composer's
 * actual text.
 */
export interface TypingRecordEvent {
  /** Monotonic ms (matches the `timestamp` passed to `start()`/`finalize()`). */
  timestamp: number;
  /**
   * `typing-v3`. Absolute wall-clock ms (`Date.now()`-epoch), for joining a
   * window/event against host records keyed on absolute time. Deliberately
   * separate from `timestamp` above, which is on the monotonic clock used
   * for interval/pause accounting.
   */
  wallTimestamp?: number;
  /** `InputEvent.inputType`, e.g. `'insertText'`, `'insertFromPaste'`, `'deleteContentBackward'`, `'historyUndo'`, `'historyRedo'`. */
  inputType?: string | null;
  /** Grapheme-cluster count of the field's value immediately before this event. */
  previousGraphemes: number;
  /** Grapheme-cluster count of the field's value immediately after this event. */
  currentGraphemes: number;
  /**
   * `typing-v3`. Word count of the field's value immediately before this
   * event, via `TypingComposerAdapter.wordMode` (`Intl.Segmenter`
   * `isWordLike` segments when available, else a whitespace/punctuation
   * split). See docs/TYPING.md.
   */
  previousWords?: number;
  /** `typing-v3`. Word count of the field's value immediately after this event. */
  currentWords?: number;
  /** True when a non-collapsed selection existed at `beforeinput` time (selection was replaced). */
  replacedSelection?: boolean;
  compositionState?: TypingCompositionState;
  /**
   * `typing-v2`. Caret position (grapheme offset) at the time of this event.
   * `null`/omitted degrades gracefully: edit states still fire correctly,
   * just with `detail.offset: null` on the emitted event and no
   * `revision_locations` entry (there is nothing positional to record
   * without an offset). See docs/TYPING.md.
   */
  caretOffset?: number | null;
  /**
   * `typing-v2`. Selection extent in graphemes; `0` when collapsed. Used
   * both to populate `detail.length` on edit events and, for a `record()`
   * call with no text change at all, to distinguish `move` from
   * `select`/`deselect`.
   */
  selectionLength?: number | null;
  /**
   * `typing-v3`. Where the caret sat, immediately before this edit — see
   * `TypingBoundaryContext`. `null` when no `caretOffset` was available to
   * classify from.
   */
  boundaryContext?: TypingBoundaryContext | null;
}

/**
 * Per-event state label, drawn from `OYON_TYPING_STATES`
 * (`typing-states-v1`, `src/version.js`). Mirrored here rather than imported
 * because `types/version.d.ts` does not (yet) declare `OYON_TYPING_STATES` —
 * if the vocabulary changes, update `src/version.js` first and mirror the
 * change here; this file must never define states of its own.
 */
export type TypingStateLabel =
  | 'start'
  | 'insert'
  | 'delete'
  | 'replace'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'compose'
  | 'composing'
  | 'commit'
  | 'move'
  | 'select'
  | 'deselect'
  | 'pause'
  | 'submit'
  | 'abandon';

/**
 * `detail` shape for an edit- or selection-shaped typing event: WHERE (and
 * how much) changed, never WHAT was written. `offset`/`length` are `null`
 * when no `caretOffset`/`selectionLength` was available at record() time.
 */
export interface TypingEventEditDetail {
  offset: number | null;
  length: number | null;
  op: string;
}

/** `detail` shape for a synthesized `pause` event. */
export interface TypingPauseEventDetail {
  duration_ms: number;
}

/**
 * One entry of the per-event stream `TypingAggregator` hands to
 * `options.onEvent`. `timestamp` is an approximate wall-clock ms derived
 * from the episode's `start()` wall-clock anchor plus elapsed monotonic time
 * (this class never calls `now()` per event); `monotonic_ms` is the same
 * clock `record()`/`start()`/`finalize()` timestamps are on.
 */
export interface TypingEvent {
  modality: 'typing';
  state: TypingStateLabel;
  source: 'user';
  timestamp: number;
  monotonic_ms: number;
  detail: TypingEventEditDetail | TypingPauseEventDetail | null;
}

/**
 * Pause-histogram bucket counts, keyed by upper bound. For the default
 * `pauseBuckets` of `[500, 1000, 2000, 5000]` the keys are exactly
 * `lt_500_ms`, `500_to_1000_ms`, `1000_to_2000_ms`, `2000_to_5000_ms`,
 * `gte_5000_ms` — one bucket per inter-edit interval observed (see
 * `quality.thresholds.pause_buckets` in the same window for the bounds that
 * produced these keys). Keys are dynamic when a host configures different
 * `pauseBuckets`.
 */
export type TypingPauseHistogram = Record<string, number>;

/**
 * The `typing` block of a `typing-v1` episode window — one composition
 * episode (host `start()` call through `submit()`/`abandon()`). Every metric
 * here is an operational definition derived from committed grapheme deltas
 * and event timing; none of it is the composer's actual text.
 */
export interface TypingMetrics {
  /** Wall-clock span of the whole episode: finalize timestamp - start timestamp, in ms. */
  elapsed_ms: number;
  /**
   * Sum of inter-edit intervals below `burstThresholdMs`, in ms — a
   * lower-bound estimate of continuous "hands on keys" time. Does not add a
   * nominal per-keystroke dwell allowance, so it under-counts true active
   * time somewhat.
   */
  active_input_ms: number;
  /** Ms from episode start to the first committed edit; `null` if the episode had no edits. */
  first_input_latency_ms: number | null;
  /**
   * Final DOCUMENT length (grapheme clusters) at episode end — the
   * composer's whole text, including anything that pre-existed this
   * episode. The episode's own net production is `committed_graphemes -
   * baseline_graphemes` (typing-v3; see docs/TYPING.md).
   */
  committed_graphemes: number;
  /** Total grapheme clusters inserted across the episode (sum of positive deltas). */
  inserted_graphemes: number;
  /** Total grapheme clusters deleted across the episode (sum of negative deltas, as a positive count). */
  deleted_graphemes: number;
  /**
   * Grapheme clusters removed via a selection replacement, counted only when
   * the replacement made the field net shorter (`max(0, previousGraphemes -
   * currentGraphemes)`). A same-length or net-longer replacement reports 0
   * here — that case isn't recoverable from the net delta alone.
   */
  replacement_graphemes: number;
  /** Grapheme clusters inserted via events whose `inputType` matched `/paste/i`. */
  pasted_graphemes: number;
  /** Count of committed edit events (IME `'update'` events are excluded). */
  edit_event_count: number;
  /** Count of `compositionState === 'update' | 'end'` events observed (IME activity signal). */
  composition_count: number;
  /** `deleted_graphemes / inserted_graphemes`; `null` (unmeasurable, never 0) when nothing was inserted. */
  revision_ratio: number | null;
  /**
   * Episode net production (`max(0, committed_graphemes -
   * baseline_graphemes)`) per active minute; `null` (unmeasurable, never 0)
   * when no active time was observed.
   */
  production_rate_per_active_min: number | null;
  /**
   * Raw inter-edit interval series, in ms, one entry per edit after the
   * first. Capped at `options.maxIntervals` entries (transport bound); every
   * other metric (histogram, active time, bursts) keeps counting past the
   * cap — see `quality.intervals_truncated`.
   */
  inter_event_intervals_ms: number[];
  /** Pause-length histogram over every inter-edit interval (not just the retained series). */
  pause_histogram: TypingPauseHistogram;
  /** Number of typing bursts: starts at 1 on the first edit, +1 each time a pause ≥ `burstThresholdMs` occurs. 0 for an episode with no edits. */
  burst_count: number;
  /** True when the episode ended via `finalize({ reason: 'submitted' })`. */
  submitted: boolean;
  /** True when the episode ended via `finalize({ reason: 'abandoned' })`. */
  abandoned: boolean;
  /**
   * `typing-v2`. One entry per edit event for which a `caretOffset` was
   * known, in event order — POSITIONAL replay (where/when every edit
   * happened), not verbatim replay (Oyon never carries the edited text; see
   * docs/TYPING.md). Capped at `options.maxIntervals`, the same bound as
   * `inter_event_intervals_ms`; see `quality.revision_locations_truncated`.
   */
  revision_locations: TypingRevisionLocation[];
}

/** One `typing.revision_locations` entry — where an edit happened, not what it wrote. */
export interface TypingRevisionLocation {
  /** Grapheme offset the edit occurred at. */
  offset: number;
  /** Magnitude of the edit — the caller's `selectionLength` if given, else `abs(currentGraphemes - previousGraphemes)`. */
  length: number;
  /** Short operation label, e.g. `'insert'`, `'delete'`, `'replace'`, `'paste'`, `'undo'`, `'redo'`, `'commit'`. */
  op: string;
  /** Monotonic ms the edit was recorded at (same clock as `record()`'s `timestamp`). */
  t: number;
}

export interface TypingQualityThresholds {
  /** The `pauseBuckets` upper bounds (ms) in effect for this episode. */
  pause_buckets: number[];
  /** The `burstThresholdMs` (ms) in effect for this episode. */
  burst_threshold_ms: number;
}

export interface TypingQuality {
  thresholds: TypingQualityThresholds;
  /** True when `inter_event_intervals_ms` was capped at `maxIntervals` (other metrics remain complete). */
  intervals_truncated: boolean;
  /**
   * `typing-v2`. True when `revision_locations` was capped at `maxIntervals`.
   * A SIBLING flag, not a reuse of `intervals_truncated` — the two arrays
   * are bounded by the same numeric cap but count different things
   * (revision_locations per edit; inter_event_intervals_ms per interval, one
   * fewer than the edit count), so they can truncate independently.
   */
  revision_locations_truncated: boolean;
}

/** Identifies which host-registered composer produced the episode. */
export interface TypingTarget {
  kind: string | null;
  id: string | null;
}

/**
 * Aggregated typing metrics for one composition episode, returned by
 * `TypingAggregator.finalize()`. Mirrors the JSONC shape documented in
 * docs/TYPING.md. `target` is present only when `start()` was called with a
 * non-null `targetKind` or `targetId`.
 */
export interface TypingWindow {
  modality: 'typing';
  window_kind: 'episode';
  feature_profile: 'typing-v2';
  window_start: string;
  window_end: string;
  typing: TypingMetrics;
  quality: TypingQuality;
  target?: TypingTarget;
}

export interface TypingAggregatorOptions {
  /**
   * Upper bounds (ms) for the pause histogram, strictly ascending. Default
   * `[500, 1000, 2000, 5000]`, producing the five buckets documented on
   * `TypingPauseHistogram`.
   */
  pauseBuckets?: number[];
  /** A pause at/above this (ms) ends the current burst and starts a new one. Default 2000. */
  burstThresholdMs?: number;
  /** Cap on the retained `inter_event_intervals_ms` series length; also bounds `revision_locations`. Default 5000. */
  maxIntervals?: number;
  /** Wall clock, used only to stamp `window_start`/`window_end`. Default `() => Date.now()`. */
  now?: () => number;
  /**
   * `typing-v2`. Per-event sink: called once per `start()`/`record()`/
   * `finalize()` call with a `TypingEvent`. `null`/omitted (default) means
   * no events are emitted; the window's `typing`/`quality` fields are
   * unaffected either way. This class does not own a per-event log — wiring
   * emitted events into one (e.g. a signal-event store) is the caller's job.
   */
  onEvent?: ((event: TypingEvent) => void) | null;
}

export interface TypingStartArgs {
  /** Monotonic ms marking the start of the episode. */
  timestamp: number;
  targetKind?: string | null;
  targetId?: string | null;
}

export interface TypingFinalizeArgs {
  /** Monotonic ms marking the end of the episode. */
  timestamp: number;
  reason: 'submitted' | 'abandoned';
}

/**
 * Aggregates one composition episode into a `typing-v1` window. Pure: no
 * DOM, no timers, no globals — all timing is passed in as arguments (see
 * `TypingComposerAdapter` for the DOM-facing side).
 */
export class TypingAggregator {
  constructor(options?: TypingAggregatorOptions);
  options: Required<TypingAggregatorOptions>;
  /** True while a composition episode is in progress (between `start()` and `finalize()`). */
  readonly active: boolean;
  /** Begin a new composition episode. Discards any prior unfinished episode. */
  start(args: TypingStartArgs): void;
  /** Consume one input event. No-op (and never throws) when not active. */
  record(event: TypingRecordEvent): void;
  /**
   * End the episode and return its window. Returns `null` when there was no
   * active episode (including a second call after an episode already
   * finalized). Throws if `reason` is neither `'submitted'` nor `'abandoned'`.
   */
  finalize(args: TypingFinalizeArgs): TypingWindow | null;
}

/**
 * DOM-element-shaped host for `createTypingComposerAdapter` — an
 * `<input>`/`<textarea>` (or any EventTarget with this shape).
 */
export interface TypingComposerElement extends EventTarget {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  ownerDocument?: Document | null;
}

/**
 * Aggregator-shaped collaborator `createTypingComposerAdapter` drives.
 * `TypingAggregator` satisfies this; tests may inject a fake.
 */
export interface TypingAggregatorLike {
  start(args: TypingStartArgs): void;
  record(event: TypingRecordEvent): void;
  finalize(args: TypingFinalizeArgs): TypingWindow | null;
}

/** Grapheme-cluster segmenter shape (matches `Intl.Segmenter` with `granularity: 'grapheme'`). */
export interface TypingGraphemeSegmenter {
  segment(value: string): Iterable<unknown>;
}

/**
 * Word segmenter shape (matches `Intl.Segmenter` with `granularity: 'word'`):
 * each segment carries `isWordLike` so whitespace/punctuation segments can be
 * excluded from the count — see `TypingComposerAdapter`'s `wordMode`.
 */
export interface TypingWordSegmenter {
  segment(value: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

/**
 * `documentRef` shape — a `Document` satisfies this. `activeElement` is what
 * the `selectionchange` listener uses to filter out selection changes that
 * belong to some other field on the page (see `createTypingComposerAdapter`).
 */
export interface TypingComposerDocumentRef extends EventTarget {
  activeElement?: EventTarget | null;
}

export interface TypingComposerAdapterOptions {
  /** The host's composer element. Required. */
  element: TypingComposerElement;
  /** Aggregator collaborator (typically a `TypingAggregator`). Required. */
  aggregator: TypingAggregatorLike;
  /** Passed through to `aggregator.start()`. Default `'chat_composer'`. */
  targetKind?: string;
  /** Passed through to `aggregator.start()`. Default `null`. */
  targetId?: string | null;
  /** Called with the finalized window when `submit()`/`abandon()` produces one. */
  onWindow?: ((window: TypingWindow) => void) | null;
  /** Test-injectable clock. Default `performance.now()`, falling back to `Date.now()`. */
  now?: () => number;
  /** Document to attach `visibilitychange`/`selectionchange` to. Default `element.ownerDocument`. */
  documentRef?: TypingComposerDocumentRef | null;
  /** Test/older-runtime injection point for grapheme segmentation. Default: real `Intl.Segmenter` if available, else code-point counting. */
  segmenter?: TypingGraphemeSegmenter | null;
  /**
   * `typing-v3`. Test/older-runtime injection point for WORD segmentation
   * (mirrors `segmenter`, but `granularity: 'word'`). Pass a real or fake
   * `Intl.Segmenter`-shaped object to force `'injected'` `wordMode`; pass
   * `false` explicitly to force the whitespace/punctuation-split fallback
   * (used by tests to exercise that path even where a real `Intl.Segmenter`
   * exists). Omit for normal auto-detection: real `Intl.Segmenter` with
   * `granularity: 'word'` if available, else the whitespace fallback.
   */
  wordSegmenter?: TypingWordSegmenter | false | null;
  /**
   * `typing-v2`. Trailing-edge throttle (ms) for the `selectionchange`
   * listener — coalesces every intermediate firing during a drag-select
   * into one settled report. Default `200`.
   */
  selectionChangeThrottleMs?: number;
  /** Test/host injection point for the `selectionchange` throttle timer. Default: the global `setTimeout`. */
  setTimerFn?: (fn: () => void, ms: number) => unknown;
  /** Test/host injection point for cancelling the `selectionchange` throttle timer. Default: the global `clearTimeout`. */
  clearTimerFn?: (handle: unknown) => void;
  /**
   * `typing-v3`. Test/host injection point for the absolute wall clock used
   * to stamp `wallTimestamp` on every `record()` call — deliberately
   * separate from `now` above (which is monotonic). Default: the real
   * `Date.now`.
   */
  wallClockNow?: () => number;
}

/**
 * Which grapheme-counting path is actually in effect, reported via
 * `adapter.graphemeMode` so the quality block can disclose it.
 */
export type TypingGraphemeMode = 'injected' | 'intl-segmenter' | 'code-point-fallback';

/**
 * `typing-v3`. Which word-counting path is actually in effect, reported via
 * `adapter.wordMode` — mirrors `TypingGraphemeMode`. `'intl-segmenter'` is
 * the only mode that correctly counts words in scripts without inter-word
 * spaces (Japanese, Chinese, Thai, ...); `'whitespace-fallback'` splits on
 * whitespace/punctuation and does not.
 */
export type TypingWordMode = 'injected' | 'intl-segmenter' | 'whitespace-fallback';

export interface TypingComposerAdapter {
  /** Attach listeners and begin a new episode. Idempotent while already active. */
  start(): void;
  /** Finalize the episode with `reason: 'submitted'`, detach listeners, and return the window. */
  submit(): TypingWindow | null;
  /** Finalize the episode with `reason: 'abandoned'`, detach listeners, and return the window. */
  abandon(): TypingWindow | null;
  /** Detach listeners without finalizing. Safe to call twice, and safe after `submit()`/`abandon()`. */
  dispose(): void;
  readonly active: boolean;
  readonly graphemeMode: TypingGraphemeMode;
  /** `typing-v3`. Which word-counting path is actually in effect (see `TypingWordMode`). */
  readonly wordMode: TypingWordMode;
}

/**
 * Translate DOM input events on one host-designated `<input>`/`<textarea>`
 * into `TypingAggregator` calls. Attaches listeners to exactly the given
 * element (plus `visibilitychange` and throttled `selectionchange` on
 * `documentRef`, the latter filtered to `documentRef.activeElement ===
 * element`) — never to `window` or the bare global `document`, so a host may
 * run several composers at once.
 */
export function createTypingComposerAdapter(
  options: TypingComposerAdapterOptions,
): TypingComposerAdapter;

// ── Capture from any editor (host contract 3.2) ─────────────────────────────

/** A `contenteditable` element: anything with child nodes that fires `input`. */
export interface TypingContentEditableElement {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  readonly childNodes?: ArrayLike<unknown>;
  readonly ownerDocument?: unknown;
  readonly isContentEditable?: boolean;
}

/**
 * Options for `createTypingContentEditableAdapter`: the same object
 * `createTypingComposerAdapter` takes, with a `contenteditable` element and an
 * optional list of element names that start their own line.
 */
export interface TypingContentEditableAdapterOptions
  extends Omit<TypingComposerAdapterOptions, 'element'> {
  element: TypingContentEditableElement;
  /** Upper-case element names that occupy their own line. Default: the HTML block elements. */
  blockTags?: string[];
}

/**
 * Typing capture for ONE `contenteditable` element. Same handle and the same
 * `typing-v3` output as `createTypingComposerAdapter`; the element's subtree
 * is linearised to the plain text a `<textarea>` would hold and the document
 * selection is mapped onto offsets in it. Default `targetKind`:
 * `'document_editor'`.
 */
export function createTypingContentEditableAdapter(
  options: TypingContentEditableAdapterOptions,
): TypingComposerAdapter;

/** A DOM position, as a selection endpoint gives it. */
export interface EditablePosition {
  node: unknown;
  offset: number;
}

/**
 * Linearise a `contenteditable` subtree to plain text and resolve DOM
 * positions to UTF-16 offsets in that text. `offsets[i]` is `null` when
 * `positions[i]` is not inside `root`.
 */
export function readEditableText(
  root: unknown,
  positions?: EditablePosition[],
  options?: { blockTags?: readonly string[] },
): { text: string; offsets: Array<number | null> };

/** The labels `classifyBoundaryContext` returns. */
export const BOUNDARY_CONTEXTS: readonly TypingBoundaryContext[];
/** Characters read on each side of the caret by `classifyBoundaryContext`. */
export const BOUNDARY_CONTEXT_WINDOW: number;

/**
 * Classify where the caret sits from the few characters next to it.
 * `caretOffset` is a UTF-16 offset into `value`; `null` gives
 * `'word_boundary'`. A slice holding `BOUNDARY_CONTEXT_WINDOW` characters on
 * each side of the caret classifies the same as the whole document.
 */
export function classifyBoundaryContext(
  value: string | null | undefined,
  caretOffset: number | null | undefined,
): TypingBoundaryContext;

/** Grapheme and word counters, as every typing capture entry uses them. */
export interface TypingTextCounters {
  count(value: string): { graphemes: number; words: number };
  countGraphemes(value: string): number;
  countWords(value: string): number;
  readonly graphemeMode: TypingGraphemeMode;
  readonly wordMode: TypingWordMode;
}

export function createTextCounters(options?: {
  segmenter?: TypingGraphemeSegmenter | null;
  wordSegmenter?: TypingWordSegmenter | false | null;
}): TypingTextCounters;

/** Grapheme clusters in `value` (auto-detected segmenter). */
export function countGraphemes(value: string): number;
/** Word-like segments in `value` (auto-detected segmenter). */
export function countTypingWords(value: string): number;

/** One edit a host reports for an editor it owns. Counts and positions, never text. */
export interface TypingReportedEdit {
  /** `beforeinput` vocabulary (`'insertText'`, `'historyUndo'`, `'insertFromPaste'`, …) or null. */
  inputType?: string | null;
  /** Grapheme clusters in the document before the edit. Required. */
  graphemesBefore: number;
  /** Grapheme clusters in the document after the edit. Required. */
  graphemesAfter: number;
  wordsBefore?: number | null;
  wordsAfter?: number | null;
  /** Caret AFTER the edit. */
  caretOffset?: number | null;
  /** Selection length AFTER the edit (normally 0). */
  selectionLength?: number | null;
  /** A non-collapsed selection existed BEFORE the edit. */
  replacedSelection?: boolean;
  compositionState?: TypingCompositionState;
  /** Where the caret sat BEFORE the edit. */
  boundaryContext?: TypingBoundaryContext | null;
  /** Monotonic ms. Default: the reporter's `now()`. */
  timestamp?: number;
  /** `Date.now()`-epoch ms. Default: the reporter's `wallClockNow()`. */
  wallTimestamp?: number;
}

/** A selection or caret move made without an edit. */
export interface TypingReportedSelection {
  caretOffset?: number | null;
  selectionLength?: number | null;
  boundaryContext?: TypingBoundaryContext | null;
  timestamp?: number;
  wallTimestamp?: number;
}

export interface TypingEditReporterOptions {
  aggregator: TypingAggregatorLike;
  /** Default `'document_editor'`. */
  targetKind?: string;
  targetId?: string | null;
  onWindow?: ((window: TypingWindow) => void) | null;
  /** Receives focus / blur / visibility reports as `interaction-states-v1` events. */
  onInteractionEvent?: ((event: {
    modality: 'interaction';
    state: 'focus_gain' | 'focus_loss' | 'tab_hidden' | 'tab_visible';
    source: 'user';
    timestamp: number;
    detail: null;
  }) => void) | null;
  now?: () => number;
  wallClockNow?: () => number;
}

export interface TypingEditReporter {
  /** Begin an episode; `graphemes` / `words` are the document's counts as it opens. */
  start(initial?: {
    graphemes?: number | null;
    words?: number | null;
    caretOffset?: number | null;
    selectionLength?: number | null;
    timestamp?: number;
  }): void;
  /** Throws `TypeError` on a missing or negative count or an unknown enum value. */
  reportEdit(edit: TypingReportedEdit): void;
  reportSelection(selection?: TypingReportedSelection): void;
  reportFocus(options?: { timestamp?: number }): void;
  reportBlur(options?: { timestamp?: number }): void;
  reportVisibility(options: { hidden: boolean; timestamp?: number }): void;
  submit(): TypingWindow | null;
  abandon(): TypingWindow | null;
  dispose(): void;
  readonly active: boolean;
}

/**
 * The typing capture entry for a host that owns its editor's model and
 * reports each edit itself. Ends in the same `TypingAggregator.record()` call
 * as the DOM adapters, so it yields the same `typing-v3` window and
 * `typing-states-v1` events.
 */
export function createTypingEditReporter(options: TypingEditReporterOptions): TypingEditReporter;

// ── Pooled typing analytics (person and group views) ────────────────────────

/** A typing episode window as stored: the `typing` block plus identity. */
export interface TypingEpisodeRecord {
  window_start: string;
  /** The window's `typing` block (`typing-v2` or `typing-v3`). */
  typing: object;
  quality?: object | null;
  session_id?: string | null;
  user_id?: string | null;
  user_label?: string | null;
}

/**
 * Typing episodes pooled into one summary. `null` means the episodes did not
 * carry that measurement — render "—", never 0. Rates divide pooled totals.
 */
export interface TypingAggregateSummary {
  episodes: number;
  submitted: number;
  abandoned: number;
  totalElapsedMs: number;
  totalActiveMs: number;
  /** Sum of document lengths at episode end. */
  committedGraphemes: number;
  /** Σ (inserted − deleted): what the episodes themselves added, net. */
  netGraphemes: number;
  producedGraphemes: number | null;
  productRatio: number | null;
  charsPerMin: number | null;
  charsPerMinActive: number | null;
  wordsPerMin: number | null;
  wordsPerMinActive: number | null;
  pauseHistogram: Record<string, number>;
  pauseLocationCounts: Record<string, number> | null;
  pBurstCount: number | null;
  rBurstCount: number | null;
  pBurstMeanGraphemes: number | null;
  rBurstMeanGraphemes: number | null;
  revisionRatio: number | null;
  revisionDistanceMean: number | null;
  leadingEdgeRevisionRatio: number | null;
  correctionCount: number | null;
}

export function aggregateTypingEpisodes(episodes: TypingEpisodeRecord[]): TypingAggregateSummary;
export function episodeCharsPerMin(typing: object): number | null;
export function pauseBucketLabel(key: string): string;
export const PAUSE_LOCATION_ORDER: readonly TypingBoundaryContext[];

/** One row of `summarizeTypingBy`: a person, a session or a day. */
export interface TypingSummaryRow {
  /** `user_id`, `session_id` or `YYYY-MM-DD`. */
  key: string;
  /** The person's `user_label` when a record carries one, else the key. */
  label: string;
  summary: TypingAggregateSummary;
  /** The row's net committed graphemes over all rows'; null when none committed. */
  textShare: number | null;
}

/**
 * One pooled row per person, session or day. `by: 'day'` buckets on local
 * time; pass `utc: true` for UTC days. Throws `TypeError` on an unknown `by`.
 */
export function summarizeTypingBy(
  episodes: TypingEpisodeRecord[],
  options?: { by?: 'person' | 'session' | 'day'; utc?: boolean },
): TypingSummaryRow[];

export type TypingSummaryMeasureKind = 'count' | 'duration_ms' | 'rate' | 'ratio' | 'graphemes';

export const TYPING_SUMMARY_MEASURES: ReadonlyArray<{
  key: keyof TypingAggregateSummary;
  label: string;
  kind: TypingSummaryMeasureKind;
}>;

/** One measure of two summaries side by side; `difference` is `b − a`. */
export interface TypingSummaryComparisonRow {
  key: keyof TypingAggregateSummary;
  label: string;
  kind: TypingSummaryMeasureKind;
  a: number | null;
  b: number | null;
  difference: number | null;
}

export function compareTypingSummaries(
  a: TypingAggregateSummary | null,
  b: TypingAggregateSummary | null,
): TypingSummaryComparisonRow[];
