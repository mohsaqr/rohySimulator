/**
 * DocumentEditTracker — a host-facing emitter for edits to a document the
 * host owns (`modality: 'document_edit'`, vocabulary
 * `document-edit-states-v1`).
 *
 * This is the document's history, not the writer's keystroke process: one
 * call per edit the host's editor applied, whoever made it. An AI rewrite, a
 * collaborator's change merged in, a format applied from a toolbar and a
 * block dragged to a new position are all document edits, and none of them
 * is typing. Keystroke timing inside an editor is `typing-states-v1`
 * (`createTypingEditReporter`); a host with a document editor usually
 * reports both.
 *
 * Not a DOM listener: only the host knows what its editor did. Each call
 * emits one event from the closed `OYON_DOCUMENT_EDIT_STATES` vocabulary
 * through `onEvent`; wiring events into a log is the caller's job
 * (`createSignalCapture` does it).
 *
 * The event carries who made the edit (`source`: `'user'`, `'ai'` or
 * `'system'`) and how much text it added and removed, as grapheme and word
 * counts. It never carries the text: the host already stores the document,
 * and a second copy inside a signal event would only be a copy to keep
 * consistent.
 */

import { OYON_DOCUMENT_EDIT_STATES, OYON_EVENT_SOURCES } from '../version.js';

const MODALITY = 'document_edit';

/** Redundancy rule (not a privacy gate): the host owns the text. */
const FORBIDDEN_DESCRIPTOR_FIELDS = ['text', 'content', 'value', 'html', 'body', 'before', 'after'];

/** Structural states take the block's kind; every state may name a block. */
const COUNT_FIELDS = ['graphemes_added', 'graphemes_removed', 'words_added', 'words_removed'];

function fail(message) {
  throw new TypeError(`createDocumentEditTracker: ${message}`);
}

function countOrNull(value, name) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    fail(`${name} must be a non-negative number or null, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function createDocumentEditTracker(options = {}) {
  const resolvedOptions = {
    onEvent: null,
    now: defaultMonotonicNow,
    wallClockNow: defaultWallClockNow,
    ...options,
  };
  let disposed = false;

  /**
   * Report one document edit.
   *
   *   record({
   *     state,              // one of OYON_DOCUMENT_EDIT_STATES
   *     source,             // 'user' (default) | 'ai' | 'system'
   *     graphemes_added, graphemes_removed,   // counts, optional
   *     words_added, words_removed,           // counts, optional
   *     block_kind,         // 'paragraph', 'heading', 'list_item', … optional
   *     ai_decision,        // 'kept' | 'rejected': this edit carried out a person's ruling on an AI's words; optional
   *     context_id,         // the document, when one capture holds several
   *   })
   *
   * A count left out is `null` (not measured), never `0`. Returns the event,
   * or `null` after `dispose()`.
   */
  function record(descriptor = {}) {
    if (disposed) return null;
    if (!descriptor || typeof descriptor !== 'object') fail('record() takes a descriptor object');
    for (const field of FORBIDDEN_DESCRIPTOR_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(descriptor, field)) {
        fail(`record() must not carry "${field}" — the host stores the document's text; `
          + 'Oyon carries counts only (a redundancy rule, not a privacy rule).');
      }
    }
    const { state, source = 'user', block_kind = null, context_id = null } = descriptor;
    if (!OYON_DOCUMENT_EDIT_STATES.includes(state)) {
      fail(`unknown state ${JSON.stringify(state)} (expected one of: ${OYON_DOCUMENT_EDIT_STATES.join(', ')})`);
    }
    if (!OYON_EVENT_SOURCES.includes(source)) {
      fail(`unknown source ${JSON.stringify(source)} (expected one of: ${OYON_EVENT_SOURCES.join(', ')})`);
    }
    const detail = { block_kind: typeof block_kind === 'string' ? block_kind : null };
    // Present only when supplied, so an edit that carried no decision keeps the shape it always had.
    if (descriptor.ai_decision !== undefined && descriptor.ai_decision !== null) {
      if (descriptor.ai_decision !== 'kept' && descriptor.ai_decision !== 'rejected') {
        fail(`unknown ai_decision ${JSON.stringify(descriptor.ai_decision)} (expected 'kept' or 'rejected')`);
      }
      detail.ai_decision = descriptor.ai_decision;
    }
    for (const field of COUNT_FIELDS) {
      detail[field] = countOrNull(descriptor[field], `record().${field}`);
    }
    const event = {
      modality: MODALITY,
      state,
      source,
      timestamp: resolvedOptions.wallClockNow(),
      monotonic_ms: resolvedOptions.now(),
      detail,
      ...(typeof context_id === 'string' && context_id.length > 0 ? { context_id } : {}),
    };
    if (typeof resolvedOptions.onEvent === 'function') resolvedOptions.onEvent(event);
    return event;
  }

  return {
    record,
    /** Idempotent; later `record()` calls return `null`. */
    dispose() { disposed = true; },
    get active() { return !disposed; },
  };
}

function defaultMonotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultWallClockNow() {
  return Date.now();
}
