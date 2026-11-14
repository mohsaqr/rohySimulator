/**
 * typingText — the text reading every typing capture entry shares.
 *
 * The text-field adapter, the `contenteditable` adapter and a host that
 * reports its own edits (`createTypingEditReporter`) must count graphemes and
 * words and classify the caret's boundary context IDENTICALLY, or the same
 * editing session yields different `typing-v3` windows depending on which
 * entry recorded it. These functions are that single definition.
 *
 * Nothing here retains text: each function reads the string it is handed,
 * returns numbers or one enum label, and keeps no reference.
 */

// How many characters immediately adjacent to the caret `classifyBoundaryContext`
// is allowed to read on each side. Bounded deliberately: this keeps the read
// O(1) regardless of document length (never scan back to find "the nearest
// sentence end", only ever look at a small fixed window) and keeps the
// "never retain surrounding text" guarantee trivially true — the window is
// sliced, classified, and discarded within a single synchronous call. The
// tradeoff: a run of adjacent whitespace longer than this window (e.g. many
// blank lines) hides an earlier newline or sentence-ending punctuation from
// the classifier, which then reports `word_boundary` instead of
// `paragraph_boundary`/`sentence_boundary`. Documented, not a bug — see
// docs/TYPING.md.
export const BOUNDARY_CONTEXT_WINDOW = 8;

/** The closed set of labels `classifyBoundaryContext` returns. */
export const BOUNDARY_CONTEXTS = Object.freeze([
  'mid_word',
  'word_boundary',
  'sentence_boundary',
  'paragraph_boundary',
]);

// Sentence-terminating punctuation, ASCII and the full-width CJK equivalents.
const SENTENCE_END_CHARS = new Set(['.', '!', '?', '。', '！', '？']);

// Unicode-aware "word character": a letter, number, or underscore. Used only
// to decide whether the immediate caret-adjacent characters are "inside a
// word" for `mid_word` classification — not a segmentation boundary.
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

/**
 * Classify where the caret sits, using ONLY the small bounded window of
 * characters immediately adjacent to it (`BOUNDARY_CONTEXT_WINDOW` on each
 * side) — never the whole document, and nothing beyond the returned label is
 * retained.
 *
 *   - `paragraph_boundary` — the nearest non-space/tab character before the
 *     caret is a newline (trailing spaces/tabs after the newline, e.g. an
 *     indented new paragraph, are tolerated).
 *   - `sentence_boundary`  — the nearest non-space/tab character before the
 *     caret is sentence-terminating punctuation (`.`, `!`, `?`, or their
 *     full-width equivalents `。`, `！`, `？`); trailing spaces/tabs after it
 *     are tolerated the same way.
 *   - `mid_word`           — the character immediately before AND the
 *     character immediately after the caret are both word characters.
 *   - `word_boundary`      — everything else (start/end of field, caret next
 *     to whitespace or non-sentence punctuation with no word character on
 *     both sides, etc.) — the default, catch-all case.
 *
 * `caretOffset` is a UTF-16 code-unit offset into `value` (what
 * `selectionStart` reports). It may be `null` (no selection concept); that
 * degrades to `word_boundary`.
 *
 * A host that owns its editor's model may pass only the text around the
 * caret instead of the whole document: any slice that includes
 * `BOUNDARY_CONTEXT_WINDOW` characters on each side of the caret (with
 * `caretOffset` relative to the slice) classifies identically.
 */
export function classifyBoundaryContext(value, caretOffset) {
  if (!value || caretOffset == null) return 'word_boundary';

  const before = value.slice(Math.max(0, caretOffset - BOUNDARY_CONTEXT_WINDOW), caretOffset);
  const after = value.slice(caretOffset, caretOffset + BOUNDARY_CONTEXT_WINDOW);

  const beforeStripped = before.replace(/[ \t]+$/, '');
  const lastSignificant = beforeStripped.charAt(beforeStripped.length - 1);
  if (lastSignificant === '\n') return 'paragraph_boundary';
  if (SENTENCE_END_CHARS.has(lastSignificant)) return 'sentence_boundary';

  const charBefore = before.charAt(before.length - 1);
  const charAfter = after.charAt(0);
  if (WORD_CHAR_RE.test(charBefore) && WORD_CHAR_RE.test(charAfter)) return 'mid_word';

  return 'word_boundary';
}

function createDefaultSegmenter() {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return null;
}

/**
 * Word `Intl.Segmenter`, when the host supports the `'word'` granularity.
 * Counting only `isWordLike` segments (not every segment — `Intl.Segmenter`
 * with `granularity: 'word'` also yields whitespace/punctuation segments) is
 * what makes this correct for languages without inter-word spaces (Japanese,
 * Chinese, Thai, ...), which a whitespace split cannot handle at all.
 */
function createDefaultWordSegmenter() {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  return null;
}

/**
 * Whitespace/punctuation word-count fallback for hosts without
 * `Intl.Segmenter`. Counts maximal runs of letters/numbers (Unicode-aware),
 * allowing an internal apostrophe so contractions ("don't") count as one
 * word. This is a genuine degradation, not a like-for-like substitute: it
 * has no notion of a "word" in scripts that don't separate words with
 * whitespace, so it under- or over-counts CJK/Thai text — see
 * `wordMode`/docs/TYPING.md.
 */
function countWordsFallback(value) {
  if (!value) return 0;
  const matches = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

/**
 * Single-pass fallback used when NEITHER a grapheme nor a word
 * `Intl.Segmenter` is available: code-point counting and whitespace-based
 * word splitting are both simple linear scans, so they can share one pass
 * over `value` rather than the two independent segmenter passes the
 * primary path takes.
 */
function countGraphemesAndWordsFallback(value) {
  const codePoints = [...value];
  let words = 0;
  let inWord = false;
  for (const ch of codePoints) {
    const isWordChar = WORD_CHAR_RE.test(ch);
    if (isWordChar && !inWord) words += 1;
    inWord = isWordChar;
  }
  return { graphemes: codePoints.length, words };
}

/**
 * Build the grapheme and word counters one capture entry uses.
 *
 * `segmenter` is an injection point for tests and older runtimes: an
 * `Intl.Segmenter`-shaped object forces `'injected'` mode. When absent, a real
 * grapheme `Intl.Segmenter` is used if the runtime has one, else code-point
 * counting.
 *
 * `wordSegmenter` mirrors it for words. Pass `false` to force the
 * whitespace fallback even where a real `Intl.Segmenter` exists (how tests
 * exercise `'whitespace-fallback'` deterministically); omit it for
 * auto-detection.
 *
 * Returns `{ count(value), countGraphemes(value), countWords(value),
 * graphemeMode, wordMode }`; `count` returns `{ graphemes, words }`.
 *
 * KNOWN HOT SPOT: both passes re-scan the whole value — O(n) per call. A
 * caller that runs this on every keystroke of a long document pays O(n^2)
 * over the session; a host that owns its model should count only the changed
 * slice and report the totals.
 */
export function createTextCounters({ segmenter = null, wordSegmenter } = {}) {
  const resolvedSegmenter = segmenter || createDefaultSegmenter();
  const graphemeMode = segmenter
    ? 'injected'
    : (resolvedSegmenter ? 'intl-segmenter' : 'code-point-fallback');

  const resolvedWordSegmenter = wordSegmenter === false
    ? null
    : (wordSegmenter || createDefaultWordSegmenter());
  const wordMode = wordSegmenter
    ? 'injected'
    : (resolvedWordSegmenter ? 'intl-segmenter' : 'whitespace-fallback');

  function countGraphemeClusters(value) {
    let count = 0;
    for (const _cluster of resolvedSegmenter.segment(value)) count += 1;
    return count;
  }

  function countWordLikeSegments(value) {
    let count = 0;
    for (const segment of resolvedWordSegmenter.segment(value)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }

  function countGraphemes(value) {
    if (!value) return 0;
    return resolvedSegmenter ? countGraphemeClusters(value) : [...value].length;
  }

  function countWords(value) {
    if (!value) return 0;
    if (resolvedWordSegmenter) return countWordLikeSegments(value);
    // With no grapheme segmenter either, keep the one-pass fallback's word
    // rule so `count()` and `countWords()` can never disagree.
    return resolvedSegmenter ? countWordsFallback(value) : countGraphemesAndWordsFallback(value).words;
  }

  /**
   * Both counts for one value. Grapheme and word segmentation are different
   * algorithms, so this is two passes when both segmenters are real, and one
   * shared pass only on the double-fallback path.
   */
  function count(value) {
    if (!value) return { graphemes: 0, words: 0 };
    if (!resolvedSegmenter && !resolvedWordSegmenter) return countGraphemesAndWordsFallback(value);
    return { graphemes: countGraphemes(value), words: countWords(value) };
  }

  return { count, countGraphemes, countWords, graphemeMode, wordMode };
}

let defaultCounters = null;
function sharedCounters() {
  if (!defaultCounters) defaultCounters = createTextCounters();
  return defaultCounters;
}

/** Grapheme clusters in `value`, counted as every typing capture entry counts them. */
export function countGraphemes(value) {
  return sharedCounters().countGraphemes(value);
}

/** Word-like segments in `value`, counted as every typing capture entry counts them. */
export function countTypingWords(value) {
  return sharedCounters().countWords(value);
}
