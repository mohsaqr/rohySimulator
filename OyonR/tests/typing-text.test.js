import assert from 'node:assert/strict';
import {
  BOUNDARY_CONTEXTS,
  BOUNDARY_CONTEXT_WINDOW,
  classifyBoundaryContext,
  countGraphemes,
  countTypingWords,
  createTextCounters,
} from '../src/capture/typingText.js';
import { readEditableText } from '../src/capture/TypingContentEditableAdapter.js';

/*
 * typingText is the one definition of "how many graphemes", "how many words"
 * and "where was the caret" that all three typing capture entries share. These
 * tests pin the definitions against hand-worked cases, and the property that
 * lets a host classify from a slice of its document instead of all of it.
 */

// ---- classifyBoundaryContext: hand-worked cases ----
{
  const cases = [
    // [value, caretOffset, expected, why]
    ['', 0, 'word_boundary', 'empty document'],
    ['hello', null, 'word_boundary', 'no caret position'],
    ['hello', 0, 'word_boundary', 'start of field'],
    ['hello', 5, 'word_boundary', 'end of field'],
    ['hello', 2, 'mid_word', 'word characters on both sides'],
    ['hello world', 6, 'word_boundary', 'after a space, before a word'],
    ['Done. Next', 6, 'sentence_boundary', 'after ". " — trailing space tolerated'],
    ['Done.', 5, 'sentence_boundary', 'directly after the full stop'],
    ['Really? ', 8, 'sentence_boundary', 'question mark'],
    ['そうだ。', 4, 'sentence_boundary', 'full-width full stop'],
    ['line one\n', 9, 'paragraph_boundary', 'directly after a newline'],
    ['line one\n  ', 11, 'paragraph_boundary', 'indented new paragraph'],
    ['a_b', 2, 'mid_word', 'underscore is a word character'],
    ['a, b', 2, 'word_boundary', 'after a comma'],
  ];
  for (const [value, caret, expected, why] of cases) {
    assert.equal(classifyBoundaryContext(value, caret), expected, why);
  }
  for (const [value, caret] of cases) {
    assert.ok(BOUNDARY_CONTEXTS.includes(classifyBoundaryContext(value, caret)),
      'every result is a member of the closed BOUNDARY_CONTEXTS set');
  }
  assert.deepEqual([...BOUNDARY_CONTEXTS],
    ['mid_word', 'word_boundary', 'sentence_boundary', 'paragraph_boundary']);
}

// ---- Invariant: a slice around the caret classifies like the whole text ----
// A host that owns its editor's model must not have to hand over the whole
// document: BOUNDARY_CONTEXT_WINDOW characters on each side are enough.
{
  const text = 'First line here.\n  Second: mid-word and end!  Third?\n\nLast';
  for (let caret = 0; caret <= text.length; caret += 1) {
    const from = Math.max(0, caret - BOUNDARY_CONTEXT_WINDOW);
    const to = Math.min(text.length, caret + BOUNDARY_CONTEXT_WINDOW);
    assert.equal(
      classifyBoundaryContext(text.slice(from, to), caret - from),
      classifyBoundaryContext(text, caret),
      `caret ${caret}: the bounded slice must classify like the full text`,
    );
  }
}

// ---- Counters: hand-computed values, each mode ----
{
  const real = createTextCounters();
  if (real.graphemeMode === 'intl-segmenter') {
    // 'e' + combining acute is ONE grapheme; a family emoji (ZWJ sequence) is one.
    assert.equal(real.countGraphemes('é'), 1);
    assert.equal(real.countGraphemes('👨‍👩‍👧'), 1);
    assert.equal(real.countGraphemes('abc'), 3);
    assert.equal(real.countWords("don't stop"), 2);
    assert.deepEqual(real.count('two words'), { graphemes: 9, words: 2 });
  }
  assert.equal(real.countGraphemes(''), 0);
  assert.equal(real.countWords(''), 0);
  assert.deepEqual(real.count(''), { graphemes: 0, words: 0 });

  // Forced whitespace fallback for words (grapheme segmenter still real).
  const fallbackWords = createTextCounters({ wordSegmenter: false });
  assert.equal(fallbackWords.wordMode, 'whitespace-fallback');
  assert.equal(fallbackWords.countWords("don't stop now"), 3);
  assert.equal(fallbackWords.countWords('  spaced   out  '), 2);

  // Injected segmenters are reported as such and are actually used.
  const perChar = { segment: (value) => [...value].map((ch) => ({ segment: ch, isWordLike: ch !== ' ' })) };
  const injected = createTextCounters({ segmenter: perChar, wordSegmenter: perChar });
  assert.equal(injected.graphemeMode, 'injected');
  assert.equal(injected.wordMode, 'injected');
  assert.deepEqual(injected.count('ab c'), { graphemes: 4, words: 3 });

  // count() must agree with the two single counters in every mode.
  for (const counters of [real, fallbackWords, injected]) {
    for (const value of ['', 'a', 'hello world', "it's 2 words?", 'línea\nnueva']) {
      assert.deepEqual(
        counters.count(value),
        { graphemes: counters.countGraphemes(value), words: counters.countWords(value) },
        `count() and the single counters disagree on ${JSON.stringify(value)}`,
      );
    }
  }

  // The module-level conveniences use the auto-detected counters.
  assert.equal(countGraphemes('abc'), real.countGraphemes('abc'));
  assert.equal(countTypingWords('one two'), real.countWords('one two'));
}

// ---- readEditableText: the contenteditable linearisation ----
// Fake DOM nodes by hand (same idiom as tests/typing-adapter.test.js).
function text(data) {
  return { nodeType: 3, nodeName: '#text', data, childNodes: [] };
}
function el(tag, ...children) {
  return { nodeType: 1, nodeName: tag, childNodes: children };
}
{
  const cases = [
    [el('DIV'), '', 'empty editor'],
    [el('DIV', text('plain')), 'plain', 'bare text'],
    [el('DIV', el('DIV', text('a')), el('DIV', text('b'))), 'a\nb', 'two block lines'],
    [el('DIV', el('P', text('a')), el('P', el('BR')), el('P', text('b'))), 'a\n\nb', 'an empty paragraph between two'],
    [el('DIV', el('DIV', text('a')), el('DIV', el('BR'))), 'a\n', 'trailing empty line (placeholder <br>)'],
    [el('DIV', el('DIV', el('BR')), el('DIV', text('b'))), '\nb', 'leading empty line'],
    [el('DIV', el('DIV', text('a'), el('BR'), text('b'))), 'a\nb', 'a real <br> inside a block'],
    [el('DIV', text('x'), el('DIV', text('y'))), 'x\ny', 'inline text then a block'],
    [el('DIV', el('DIV', text('y')), text('x')), 'y\nx', 'a block then inline text'],
    [el('DIV', el('DIV', el('P', text('nested')))), 'nested', 'nested blocks open one line, not two'],
    [el('DIV', el('P', text('a '), el('B', text('bold')), text(' c'))), 'a bold c', 'inline elements add nothing'],
    [el('DIV', el('UL', el('LI', text('one')), el('LI', text('two')))), 'one\ntwo', 'list items'],
  ];
  for (const [root, expected, why] of cases) {
    assert.equal(readEditableText(root).text, expected, why);
  }
}
{
  // Positions map onto offsets in the linearised text.
  const a = text('Hello');
  const b = text('world');
  const emptyLine = el('DIV', el('BR'));
  const root = el('DIV', el('DIV', a), emptyLine, el('DIV', b));
  const outside = text('elsewhere');
  const { text: value, offsets } = readEditableText(root, [
    { node: a, offset: 0 },
    { node: a, offset: 5 },
    { node: emptyLine, offset: 0 },
    { node: b, offset: 2 },
    { node: root, offset: 3 },
    { node: outside, offset: 1 },
  ]);
  assert.equal(value, 'Hello\n\nworld');
  assert.deepEqual(offsets, [0, 5, 6, 9, 12, null],
    'text-node, empty-line, end-of-root and out-of-tree positions');
  // Each resolved offset really is that position in the text.
  assert.equal(value.slice(0, offsets[1]), 'Hello');
  assert.equal(value.slice(offsets[3]), 'rld');
  assert.equal(classifyBoundaryContext(value, offsets[2]), 'paragraph_boundary',
    'a caret on a fresh empty line is at a paragraph boundary, as in a textarea');
}

console.log('typing-text OK');
