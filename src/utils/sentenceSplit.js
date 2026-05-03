// Streaming sentence detector for the LLM-token-stream → TTS pipeline.
//
// `extractCompleteSentences(buffer)` walks a growing buffer of streamed
// model output and returns every fully-terminated sentence found so far,
// keeping the trailing partial sentence in `remainder` so the caller can
// append the next delta to it.
//
// We only treat `.`, `!`, `?` followed by whitespace (or end-of-buffer
// after a real model EOS, which the caller flushes manually) as a
// boundary. The detector intentionally does NOT split on:
//   - decimal points inside numbers     "3.14"
//   - common English abbreviations       "Dr. Smith", "Mr.", "e.g."
//   - ellipses                          "..."  (treated as one terminal,
//                                       so "Hmm... yes" is one sentence
//                                       until we see the trailing space)
//
// Rationale: false-positive splits cause Kokoro to produce a clipped clip
// with a weird intonation; missed splits just delay the next chunk by
// a few tokens. We bias toward fewer splits.

const ABBREV = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
    'mt', 'rev', 'fr', 'gen', 'sen', 'rep', 'gov',
    'ave', 'blvd', 'rd',
    'eg', 'ie', 'etc', 'vs', 'cf', 'al',
    'no', 'vol', 'p', 'pp', 'inc', 'ltd', 'co',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
]);

// True when the run of letters ending at `endExclusive` (i.e. the last
// alphabetic character is at index endExclusive-1) is one of our known
// abbreviations. Walks left from endExclusive collecting [a-zA-Z].
function endsInAbbreviation(text, endExclusive) {
    let i = endExclusive;
    while (i > 0 && /[a-zA-Z]/.test(text[i - 1])) i--;
    if (i === endExclusive) return false;
    const word = text.slice(i, endExclusive).toLowerCase();
    return ABBREV.has(word);
}

// True when the period at index `dotIdx` is between two digits (decimal).
function isDecimalPoint(text, dotIdx) {
    return /\d/.test(text[dotIdx - 1] || '') && /\d/.test(text[dotIdx + 1] || '');
}

export function extractCompleteSentences(buffer) {
    const sentences = [];
    let cursor = 0;

    for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch !== '.' && ch !== '!' && ch !== '?') continue;

        // Run of consecutive terminals (`...`, `?!`, etc.) — treat as one boundary
        // anchored at the LAST terminal in the run.
        let j = i;
        while (j + 1 < buffer.length && /[.!?]/.test(buffer[j + 1])) j++;

        // Need whitespace (or buffer end) AFTER the terminal run to call it a boundary.
        // If we're at end-of-buffer, leave it as remainder — the next delta might
        // continue the abbreviation or add the space.
        const after = buffer[j + 1];
        if (after === undefined) {
            i = j;  // skip the terminal run
            continue;
        }
        if (!/\s/.test(after)) {
            i = j;
            continue;
        }

        // Reject false positives. Only meaningful for `.` (single).
        if (ch === '.' && j === i) {
            if (isDecimalPoint(buffer, i)) continue;
            if (endsInAbbreviation(buffer, i)) continue;
        }

        // Slice [cursor, j+1) as one complete sentence (including the terminal).
        const sentence = buffer.slice(cursor, j + 1).trim();
        if (sentence) sentences.push(sentence);

        // Advance cursor past the boundary whitespace as well, so leading
        // spaces don't accumulate at the start of the next sentence.
        let next = j + 1;
        while (next < buffer.length && /\s/.test(buffer[next])) next++;
        cursor = next;
        i = next - 1;  // for-loop will ++
    }

    return {
        sentences,
        remainder: buffer.slice(cursor)
    };
}
