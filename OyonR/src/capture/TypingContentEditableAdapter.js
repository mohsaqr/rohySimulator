/**
 * TypingContentEditableAdapter — typing capture for ONE `contenteditable`
 * element, for a host that does not own an editor model of its own.
 *
 * Same options, same handle, same DOM events and the same `typing-v3`
 * output as `createTypingComposerAdapter`: both run
 * `typingElementAdapterCore.js`. The only difference is how text and
 * selection are read. A text field has `value`, `selectionStart` and
 * `selectionEnd`; a `contenteditable` has a DOM subtree and the document
 * selection, so this adapter linearises the subtree into the plain text a
 * `<textarea>` holding the same writing would contain, and maps the
 * selection's (node, offset) endpoints onto UTF-16 offsets in that text.
 *
 * Linearisation (`readEditableText`): text nodes contribute their data; each
 * block element (a paragraph, a list item, a heading, a `<div>` line, …)
 * occupies its own line; a `<br>` breaks the line, except a `<br>` that is
 * the last child of its block, which browsers insert only to give an empty
 * line a height. Lines are joined with `\n`. That is what makes "the caret
 * is at the start of a new paragraph" classify as `paragraph_boundary` here
 * exactly as it does in a `<textarea>` after Enter.
 *
 * This adapter needs the editor to fire `beforeinput` and `input`. An editor
 * that applies its own edits to a model and fires neither is the case
 * `createTypingEditReporter` exists for.
 *
 * Text is read transiently and never retained or emitted.
 */

import { createTypingElementAdapter } from './typingElementAdapterCore.js';

const DEFAULT_TARGET_KIND = 'document_editor';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const DEFAULT_BLOCK_TAGS = Object.freeze([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TR', 'UL',
]);

function tagOf(node) {
  return typeof node.nodeName === 'string' ? node.nodeName.toUpperCase() : '';
}

function childrenOf(node) {
  return node.childNodes ? Array.from(node.childNodes) : [];
}

/**
 * Linearise `root`'s subtree to plain text and resolve DOM positions to
 * UTF-16 offsets in that text, in one walk.
 *
 * `positions` is a list of `{ node, offset }` DOM positions (the shape of a
 * selection endpoint). Returns `{ text, offsets }`, where `offsets[i]` is the
 * text offset of `positions[i]`, or `null` when that position is not inside
 * `root`.
 */
export function readEditableText(root, positions = [], { blockTags = DEFAULT_BLOCK_TAGS } = {}) {
  const blocks = new Set(blockTags);
  const offsets = positions.map(() => null);
  const lines = [''];
  let length = 0;
  // `hasContent`: the current line holds text. `closed`: a block that owned
  // the current line has ended, so whatever comes next starts a new line.
  let hasContent = false;
  let closed = false;

  function newLine() {
    lines.push('');
    length += 1;
    hasContent = false;
    closed = false;
  }

  function appendText(data) {
    if (closed) newLine();
    lines[lines.length - 1] += data;
    length += data.length;
    hasContent = true;
  }

  function resolve(node, test, value) {
    positions.forEach((position, index) => {
      if (offsets[index] === null && position && position.node === node && test(position.offset)) {
        offsets[index] = value(position.offset);
      }
    });
  }

  function isPlaceholderBreak(node, parent) {
    if (!parent) return false;
    const siblings = childrenOf(parent);
    if (siblings[siblings.length - 1] !== node) return false;
    return parent === root || blocks.has(tagOf(parent));
  }

  function walk(node, parent) {
    if (node.nodeType === TEXT_NODE) {
      const data = typeof node.data === 'string' ? node.data : (node.nodeValue || '');
      if (data.length === 0) {
        resolve(node, () => true, () => length);
        return;
      }
      if (closed) newLine();
      const base = length;
      resolve(node, () => true, (offset) => base + Math.max(0, Math.min(offset, data.length)));
      appendText(data);
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;

    const tag = tagOf(node);
    if (tag === 'BR') {
      // A position "in" a <br> sits on the line the break ends.
      resolve(node, () => true, () => length);
      if (isPlaceholderBreak(node, parent)) return;
      if (closed) newLine();
      newLine();
      return;
    }

    const isBlock = node !== root && blocks.has(tag);
    if (isBlock && (hasContent || closed)) newLine();

    const children = childrenOf(node);
    children.forEach((child, index) => {
      // A position (element, i) sits before child i. After a block that has
      // just ended, that is the start of the next line.
      resolve(node, (offset) => offset === index, () => length + (closed ? 1 : 0));
      walk(child, node);
    });
    resolve(node, (offset) => offset >= children.length, () => length);

    if (isBlock) closed = true;
  }

  walk(root, null);
  return { text: lines.join('\n'), offsets };
}

function selectionOf(documentRef) {
  if (!documentRef) return null;
  if (typeof documentRef.getSelection === 'function') return documentRef.getSelection();
  const view = documentRef.defaultView;
  return view && typeof view.getSelection === 'function' ? view.getSelection() : null;
}

/**
 * How a `contenteditable`'s text and selection are read. The selection
 * belongs to the element when both of its endpoints resolve inside it.
 */
function createContentEditableSurface({ element, documentRef, options }) {
  const walkOptions = Array.isArray(options.blockTags) ? { blockTags: options.blockTags } : {};

  function read() {
    const selection = selectionOf(documentRef);
    const positions = selection && selection.anchorNode && selection.focusNode
      ? [
        { node: selection.anchorNode, offset: selection.anchorOffset },
        { node: selection.focusNode, offset: selection.focusOffset },
      ]
      : [];
    const { text, offsets } = readEditableText(element, positions, walkOptions);
    const [anchor = null, focus = null] = offsets;
    if (anchor === null || focus === null) {
      return { value: text, selectionStart: null, selectionEnd: null };
    }
    return {
      value: text,
      selectionStart: Math.min(anchor, focus),
      selectionEnd: Math.max(anchor, focus),
    };
  }

  return {
    read,
    ownsSelection() {
      return read().selectionStart !== null;
    },
  };
}

/**
 * Attach typing capture to ONE `contenteditable` element. Takes the same
 * options object as `createTypingComposerAdapter` (plus an optional
 * `blockTags` list overriding which element names start their own line) and
 * returns the same handle: `start()`, `submit()`, `abandon()`, `dispose()`,
 * `active`, `graphemeMode`, `wordMode`.
 */
export function createTypingContentEditableAdapter(options = {}) {
  return createTypingElementAdapter(options, {
    name: 'createTypingContentEditableAdapter',
    defaultTargetKind: DEFAULT_TARGET_KIND,
    createSurface: createContentEditableSurface,
  });
}
