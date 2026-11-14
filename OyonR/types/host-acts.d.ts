// Type declarations for the host-reported act trackers: document edits
// (`oyon/document-edit/tracker`) and code runs (`oyon/code-run/tracker`).
// Hand-written; see src/capture/DocumentEditTracker.js and
// src/capture/CodeRunTracker.js for authoritative behaviour.

import type { SignalEventSource } from './signal-events';

export type DocumentEditState =
  | 'insert'
  | 'delete'
  | 'replace'
  | 'move'
  | 'format'
  | 'undo'
  | 'redo'
  | 'paste'
  | 'block_add'
  | 'block_remove'
  | 'block_reorder';

export type CodeRunState = 'start' | 'success' | 'failure' | 'interrupt';

export interface HostActTrackerOptions {
  onEvent?: ((event: HostActEvent) => void) | null;
  /** Monotonic clock. */
  now?: () => number;
  /** `Date.now()`-epoch clock. */
  wallClockNow?: () => number;
}

/** An event as a tracker emits it, before the log stamps ids and order. */
export interface HostActEvent {
  modality: 'document_edit' | 'code_run';
  state: string;
  source: SignalEventSource;
  timestamp: number;
  monotonic_ms: number;
  detail: Record<string, unknown>;
  context_id?: string;
}

/** One document edit. Counts only; a field named `text`/`content`/… throws. */
export interface DocumentEditDescriptor {
  state: DocumentEditState;
  /** Default `'user'`. */
  source?: SignalEventSource;
  graphemes_added?: number | null;
  graphemes_removed?: number | null;
  words_added?: number | null;
  words_removed?: number | null;
  /** `'paragraph'`, `'heading'`, `'list_item'`, … */
  block_kind?: string | null;
  /** This edit carried out a person's ruling on an AI's words. Read as the `decide` writing act. */
  ai_decision?: 'kept' | 'rejected' | null;
  /** The document, when one capture holds several. */
  context_id?: string | null;
}

export interface DocumentEditTracker {
  /** Throws `TypeError` on an unknown state/source, a negative count, or a text field. */
  record(descriptor: DocumentEditDescriptor): HostActEvent | null;
  dispose(): void;
  readonly active: boolean;
}

export function createDocumentEditTracker(options?: HostActTrackerOptions): DocumentEditTracker;

/** One code run boundary. `error_kind` is a short category, never the message. */
export interface CodeRunDescriptor {
  run_id?: string | number | null;
  language?: string | null;
  source?: SignalEventSource;
  error_kind?: string | null;
  context_id?: string | null;
}

export interface CodeRunTracker {
  started(descriptor?: CodeRunDescriptor): HostActEvent | null;
  /** `duration_ms` is measured against the matching `started()`; null without one. */
  succeeded(descriptor?: CodeRunDescriptor): HostActEvent | null;
  failed(descriptor?: CodeRunDescriptor): HostActEvent | null;
  interrupted(descriptor?: CodeRunDescriptor): HostActEvent | null;
  dispose(): void;
  readonly active: boolean;
}

export function createCodeRunTracker(
  options?: HostActTrackerOptions & { maxPendingRuns?: number },
): CodeRunTracker;
