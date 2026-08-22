// Type declarations for the Oyon signal-events subpath.
// Hand-written; consult JSDoc and the source module
// (`src/logging/SignalEventLog.js`) for authoritative shapes.
// See audio_text.md §3.6 (the event contract) and src/version.js
// (OYON_STATE_VOCABULARIES et al.) for the vocabulary this log validates
// against.

/** Who produced an event: `user` | `ai` | `system`. */
export type SignalEventSource = 'user' | 'ai' | 'system';

/** Modalities with a registered discrete state vocabulary. */
export type SignalEventModality = 'typing' | 'discourse' | 'interaction' | 'ai_assist';

/** Identifies what a `target`-scoped event refers to (mirrors `TypingTarget`). */
export interface SignalEventTarget {
  kind?: string | null;
  id?: string | null;
  [key: string]: unknown;
}

/** Capture/session identity a `SignalEventLog` is currently logging under. */
export interface SignalEventContext {
  capture_id: string | null;
  session_id: string | null;
}

/** Arguments to `SignalEventLog.record()`. */
export interface SignalEventInput {
  modality: SignalEventModality;
  /** Must be a member of the closed vocabulary for `modality` (see `src/version.js`). */
  state: string;
  /** Default `'user'`. */
  source?: SignalEventSource;
  target?: SignalEventTarget | null;
  /** Modality-specific, free-form within a size bound. */
  detail?: Record<string, unknown> | null;
  /** Wall-clock ms; defaults to the log's `now()`. */
  timestamp?: number;
  /** `performance.now()`-based ms; defaults to the log's `monotonicNow()`. */
  monotonic_ms?: number;
}

/**
 * One stored, validated event — the shape documented in audio_text.md §3.6.
 * `sequence_index` is the ordering key sequence tooling must use;
 * `timestamp` is wall clock for joining against host records only.
 */
export interface SignalEvent {
  event_id: string;
  capture_id: string | null;
  session_id: string | null;
  modality: SignalEventModality;
  state: string;
  source: SignalEventSource;
  sequence_index: number;
  timestamp: number;
  monotonic_ms: number;
  /** e.g. `'typing-states-v1'` — looked up per modality, not per event. */
  state_vocabulary: string;
  target: SignalEventTarget | null;
  detail: Record<string, unknown> | null;
}

/** One flat row as returned by `toLongFormat()`. */
export interface SignalEventLongRow {
  session_id: string | null;
  /** The stored field selected by `actorKey` (default `session_id`). */
  actor: unknown;
  sequence_index: number;
  timestamp: number;
  monotonic_ms: number;
  state: string;
  modality: SignalEventModality;
  source: SignalEventSource;
}

export interface SignalEventLongFormatOptions {
  /** Which stored field becomes `actor`. Default `'session_id'`. */
  actorKey?: keyof SignalEvent;
}

export interface SignalEventSequenceOptions {
  /** Which stored field groups events into separate chains. Default `'session_id'`. */
  groupBy?: keyof SignalEvent;
  /** Restrict to one modality's events before grouping. Default `null` (all modalities). */
  modality?: SignalEventModality | null;
}

export interface SignalEventLogOptions {
  /** Ring-buffer capacity; oldest events are dropped once exceeded. Default 50000. */
  maxEvents?: number;
  /** Wall clock, used to stamp `timestamp` when not supplied to `record()`. */
  now?: () => number;
  /** Monotonic clock, used to stamp `monotonic_ms` when not supplied to `record()`. */
  monotonicNow?: () => number;
  /** Id generator for `event_id`. Defaults to `oyonRecordId('evt')`. */
  idFactory?: () => string;
  /** Called with every stored event — the hook a transport or IndexedDB writer attaches to. */
  onEvent?: ((event: SignalEvent) => void) | null;
}

/**
 * The complete, ordered, per-event log behind every modality's discrete
 * state stream. `toSequences()` feeds ladyna `tna()` directly with no
 * reshape step; `toLongFormat()` is the TraMineR-style long format.
 */
export class SignalEventLog {
  constructor(options?: SignalEventLogOptions);
  /** Begin (or restart) logging for one capture; resets `sequence_index` to 0. */
  start(context: { capture_id?: string | null; session_id?: string | null }): void;
  /** Validate and store one event. Throws before `start()`, on unknown modality/state/source. */
  record(event: SignalEventInput): SignalEvent;
  /** Return events buffered so far and clear the buffer. */
  drain(): SignalEvent[];
  /** Return events buffered so far without clearing the buffer. */
  all(): SignalEvent[];
  /** Clear the buffer without touching sequence numbering or the drop count. */
  clear(): void;
  readonly size: number;
  /** Count of events discarded by the ring buffer since the last `start()`. */
  readonly droppedEvents: number;
  toLongFormat(options?: SignalEventLongFormatOptions): SignalEventLongRow[];
  /** One ordered state chain per group, ordered by `sequence_index` (never `timestamp`). */
  toSequences(options?: SignalEventSequenceOptions): string[][];
}
