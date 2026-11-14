/**
 * TypingComposerAdapter — translates DOM input events on ONE host-designated
 * `<input>`/`<textarea>` into `TypingAggregator` calls.
 *
 * This is the capture-side boundary for the typing/composer signal, mirroring
 * `CameraController`'s shape: an injected-collaborators options object, an
 * explicit `stop()`-equivalent (`dispose()`), and no globals reached for
 * directly — `documentRef` comes through options so tests can inject a fake.
 *
 * Scope discipline: this adapter attaches listeners to exactly the element it
 * is given, plus `visibilitychange` and (throttled) `selectionchange` on the
 * provided document — the latter filtered to `documentRef.activeElement ===
 * element`, so a selection made in some other field on the page never reaches
 * this adapter's aggregator. It must never install a page-wide listener
 * (e.g. on `window` or the bare global `document`) — a host may run several
 * composers at once and each gets its own adapter instance.
 *
 * `selectionchange` (typing-v2) exists to capture selection made WITHOUT any
 * edit — re-reading a passage by selecting it is a real writing-process
 * behaviour that otherwise produces no signal at all. It is throttled
 * (trailing edge) because it fires continuously while the user drags a
 * selection; see `selectionChangeThrottleMs`.
 *
 * Enrichment (word counts, boundary context, wall timestamp): like grapheme
 * counting, word counting reads `element.value` transiently — one pass per
 * event, nothing retained, nothing logged, the text itself never handed to
 * `aggregator.record()`. `boundaryContext` reads only the handful of
 * characters immediately adjacent to the caret (never the surrounding
 * document) to classify where an edit landed; see `classifyBoundaryContext`
 * below and docs/TYPING.md's "Pause location" section for why this matters
 * more than pause duration alone.
 */

import { createTypingElementAdapter } from './typingElementAdapterCore.js';

export {
  classifyBoundaryContext,
  createTextCounters,
  countGraphemes,
  countTypingWords,
  BOUNDARY_CONTEXTS,
  BOUNDARY_CONTEXT_WINDOW,
} from './typingText.js';
export { createTypingContentEditableAdapter } from './TypingContentEditableAdapter.js';
export { createTypingEditReporter } from './TypingEditReporter.js';

const DEFAULT_TARGET_KIND = 'chat_composer';

/**
 * How a text field's text and selection are read: `element.value`,
 * `selectionStart` and `selectionEnd`. A selection change belongs to the
 * field while it is the document's active element.
 */
function createTextFieldSurface({ element, documentRef }) {
  return {
    read() {
      return {
        value: element.value,
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd,
      };
    },
    ownsSelection() {
      return documentRef.activeElement === element;
    },
  };
}

/**
 * Attach typing capture to ONE `<input>` or `<textarea>`.
 *
 * The event translation itself lives in `typingElementAdapterCore.js`, shared
 * with `createTypingContentEditableAdapter` so both element types produce the
 * same `typing-v3` window for the same editing session. A host whose editor
 * applies its own edits and fires no `input` event uses
 * `createTypingEditReporter` instead.
 */
export function createTypingComposerAdapter(options = {}) {
  return createTypingElementAdapter(options, {
    name: 'createTypingComposerAdapter',
    defaultTargetKind: DEFAULT_TARGET_KIND,
    createSurface: createTextFieldSurface,
  });
}
