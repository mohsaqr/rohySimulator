// Type declarations for the Oyon signal-capture subpath.
// Hand-written; consult JSDoc and the source module
// (`src/core/SignalCapture.js`) for authoritative shapes.
// See docs/SIGNAL_CAPTURE.md for the integration guide.

import type { OyonSettings } from './index';
import type { SignalEvent, SignalEventLog } from './signal-events';
import type { TypingComposerAdapter, TypingEditReporter, TypingWindow } from './typing';
import type { CodeRunTracker, DocumentEditTracker } from './host-acts';

/** Modalities this orchestrator can run. */
export type SignalCaptureModality =
  | 'typing'
  | 'voice'
  | 'interaction'
  | 'discourse'
  | 'ai_assist'
  | 'document_edit'
  | 'code_run';

/** Capture identity: stamped on every event and window row. */
export interface SignalCaptureContext {
  capture_id?: string | null;
  session_id?: string | null;
  /** Stamped on every window row and event when supplied (3.6.0). */
  user_id?: string | null;
  user_label?: string | null;
  group_id?: string | null;
  /** The document, case, conversation or task the work belongs to. */
  context_id?: string | null;
}

/** `IndexedDbOyonStore`-shaped store: only `bulkAdd` is required. */
export interface SignalCaptureStore {
  bulkAdd(storeName: string, records: Array<Record<string, unknown>>): Promise<unknown>;
}

/** `HttpEmotionTransport`-shaped transport for finalized window rows. */
export interface SignalCaptureTransport {
  send(rows: Array<Record<string, unknown>>, context: SignalCaptureContext): unknown | Promise<unknown>;
}

/** A finalized modality window, stamped for the `signal_windows` store. */
export interface SignalWindowRow {
  window_id: string;
  capture_id: string | null;
  session_id: string | null;
  modality: SignalCaptureModality;
  window_kind: 'episode' | 'interval';
  feature_profile: string;
  window_start: string;
  window_end: string;
  [key: string]: unknown;
}

export interface SignalCaptureStats {
  active: boolean;
  /** Recorded-event counts per modality (this capture). */
  events: Partial<Record<SignalCaptureModality, number>>;
  /** Emitted-window counts per modality (this capture). */
  windows: Partial<Record<SignalCaptureModality, number>>;
  /** Events discarded by the log's ring buffer since start(). */
  dropped_events: number;
  persistence: { written: number; failed: number; pending: number };
  /** Errors surfaced through onError / the 'error' event. */
  errors: number;
}

/** Typing handle: drive one composer episode at a time. */
export interface SignalCaptureTypingHandle {
  /** The live capture entry: a DOM adapter or an edit reporter. */
  readonly adapter: TypingComposerAdapter | TypingEditReporter | null;
  readonly active: boolean;
  /**
   * Attach an `<input>`, a `<textarea>` or a `contenteditable` element (the
   * matching adapter is chosen from `element.isContentEditable`).
   */
  attach(
    element: unknown,
    options?: { targetKind?: string; targetId?: string | null; contextId?: string | null },
  ): TypingComposerAdapter | null;
  /** Start an episode for an editor whose host reports its own edits. */
  report(options?: {
    targetKind?: string;
    targetId?: string | null;
    contextId?: string | null;
    graphemes?: number | null;
    words?: number | null;
    caretOffset?: number | null;
    selectionLength?: number | null;
  }): TypingEditReporter | null;
  submit(): TypingWindow | null;
  abandon(): TypingWindow | null;
}

/** Voice handle: push-to-talk turn lifecycle + AI playback exclusion marks. */
export interface SignalCaptureVoiceHandle {
  readonly active: boolean;
  readonly controller: unknown;
  startTurn(options?: {
    userAction?: boolean;
    stream?: unknown | null;
    targetKind?: string | null;
    targetId?: string | null;
  }): Promise<{ ok: boolean; reason?: string }>;
  stopTurn(reason?: string): SignalWindowRow | null;
  aiPlaybackStart(): void;
  aiPlaybackEnd(): void;
}

/** Interaction handle: ambient — starts/stops with the capture. */
export interface SignalCaptureInteractionHandle {
  readonly active: boolean;
  readonly tracker: unknown;
}

/** Discourse handle: feed host-supplied message text. */
export interface SignalCaptureDiscourseHandle {
  readonly active: boolean;
  analyze(
    text: string,
    meta?: { timestamp?: number; wallTimestamp?: number },
  ): SignalEvent[] | Array<Record<string, unknown>>;
}

/** AI-assist handle: the host-reported suggestion cycle. */
export interface SignalCaptureAiAssistHandle {
  readonly active: boolean;
  readonly tracker: unknown;
  requested(descriptor?: Record<string, unknown>): unknown;
  shown(descriptor?: Record<string, unknown>): unknown;
  accepted(descriptor?: Record<string, unknown>): unknown;
  rejected(descriptor?: Record<string, unknown>): unknown;
  dismissed(descriptor?: Record<string, unknown>): unknown;
  aiTurnStart(descriptor?: Record<string, unknown>): unknown;
  aiTurnEnd(descriptor?: Record<string, unknown>): unknown;
}

export interface SignalCaptureOptions {
  settings?: Partial<OyonSettings>;
  /** Batched event persistence (`signal_events`) + window rows (`signal_windows`). */
  store?: SignalCaptureStore | null;
  transport?: SignalCaptureTransport | null;
  context?: SignalCaptureContext;
  onWindow?: ((row: SignalWindowRow) => void) | null;
  onEvent?: ((event: SignalEvent) => void) | null;
  onError?: ((error: unknown, info: { scope: string }) => void) | null;
  /** Wall clock (Date.now epoch). */
  now?: () => number;
  /** Monotonic clock (performance.now epoch) — all durations/intervals. */
  monotonicNow?: () => number;
  idFactory?: (prefix?: string) => string;
  documentRef?: unknown;
  windowRef?: unknown;
  /** Ring-buffer bound for the shared event log. */
  maxEvents?: number;
  /** Injectable shared event log instance. */
  log?: SignalEventLog;
  persistenceFactory?: (options: Record<string, unknown>) => {
    write(event: unknown): void;
    flush(): Promise<number>;
    dispose(): Promise<void>;
    readonly pendingCount: number;
    readonly writtenCount: number;
    readonly failedCount: number;
  };
  persistenceOptions?: Record<string, unknown>;
  // Aggregator INSTANCES (adopted and re-wired into the shared log).
  typingAggregator?: unknown;
  voiceAggregator?: unknown;
  interactionAggregator?: unknown;
  discourseAggregator?: unknown;
  aiAssistAggregator?: unknown;
  // Capture-side collaborator FACTORIES (called with the wired option bag).
  typingAdapterFactory?: (options: Record<string, unknown>) => TypingComposerAdapter;
  voiceControllerFactory?: (options: Record<string, unknown>) => unknown;
  interactionTrackerFactory?: (options: Record<string, unknown>) => unknown;
  aiAssistTrackerFactory?: (options: Record<string, unknown>) => unknown;
  typingEditReporterFactory?: (options: Record<string, unknown>) => TypingEditReporter;
  documentEditTrackerFactory?: (options: Record<string, unknown>) => DocumentEditTracker;
  codeRunTrackerFactory?: (options: Record<string, unknown>) => CodeRunTracker;
  /** Extra per-modality options forwarded into the collaborators. */
  typing?: Record<string, unknown>;
  voice?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  discourse?: Record<string, unknown>;
  aiAssist?: Record<string, unknown>;
}

/** Event channels: 'event', 'window', 'status', 'error'. */
export type SignalCaptureEventType = 'event' | 'window' | 'status' | 'error';

export interface SignalCapture {
  start(context?: SignalCaptureContext): SignalCapture;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  on(type: SignalCaptureEventType, handler: (payload: unknown) => void): () => void;
  off(type: SignalCaptureEventType, handler: (payload: unknown) => void): void;
  readonly typing: SignalCaptureTypingHandle | null;
  readonly voice: SignalCaptureVoiceHandle | null;
  readonly interaction: SignalCaptureInteractionHandle | null;
  readonly discourse: SignalCaptureDiscourseHandle | null;
  readonly aiAssist: SignalCaptureAiAssistHandle | null;
  /** Host-reported document edits; null unless `document_edit_enabled`. */
  readonly documentEdit: DocumentEditTracker | null;
  /** Host-reported code runs; null unless `code_run_enabled`. */
  readonly codeRun: CodeRunTracker | null;
  readonly log: SignalEventLog | null;
  readonly settings: OyonSettings;
  readonly context: SignalCaptureContext;
  readonly active: boolean;
  readonly stats: SignalCaptureStats;
}

/**
 * Orchestrator for the non-camera modalities (typing, voice, interaction,
 * discourse, ai_assist): one shared `SignalEventLog` (cross-modality
 * monotonic `sequence_index`), batched `signal_events` persistence,
 * `signal_windows` rows + optional transport for finalized windows, and
 * deterministic teardown. Sibling of `EmotionRuntime`, not part of it.
 */
export declare function createSignalCapture(options?: SignalCaptureOptions): SignalCapture;
