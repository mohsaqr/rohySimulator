// Echo rejection by TEXT for hands-free barge-in.
//
// While the patient speaks, the one recogniser keeps running in a "watch"
// role. Through the speakers it hears the patient's own voice as well as the
// learner, so its transcript is a mix of echo (the reply being spoken) and,
// maybe, the learner talking over it. This module tells the two apart by
// comparing the transcript with the text the patient is speaking. It is pure:
// no audio, no timers, no browser APIs.
//
// WHY TEXT AND NOT AUDIO (2026-11-01, owner's live tests on macOS Chrome):
// the earlier prototype opened a second capture (getUserMedia with echo
// cancellation + an energy VAD) for barge-in. Any such capture left the Web
// Speech recogniser deaf afterwards — opened beside the recogniser it heard
// nothing; opened only while the patient spoke, the auto-reopened recogniser
// heard nothing (no-speech 13 s later); with barge-in off, turns worked. So
// there is exactly ONE capture, the recogniser, and echo is rejected here.
// Do not reintroduce a second microphone for barge-in.
//
// THE RULE. A watch result is an interruption when, among its last
// BARGE_IN_WINDOW_WORDS words, at least BARGE_IN_MIN_NOVEL_WORDS are NOVEL —
// they do not occur in the patient's text (exactly, or nearly: see
// `matchesVocab`). Why this rule:
//   * Two words, not one. A single misrecognised echo word ("pane" for
//     "pain") is the commonest garble; a learner who interrupts says more
//     than one word. Exact stop/wait commands are the narrow exception below.
//   * A trailing window, not the whole transcript. Chrome's final text is
//     cumulative for the life of a recogniser, so over a long reply isolated
//     garbled words pile up; counted over the whole text, two stray errors a
//     minute apart would cut the patient off. The learner's words are always
//     the newest, at the tail.
//   * No "one long novel word held across two results" rule. A garbled word
//     that Chrome finalises stays at the tail of the cumulative transcript
//     while the patient pauses between sentences — exactly when garble is
//     finalised — so "held across two results" fires on echo.
// The bias is deliberate: a missed interruption costs the learner a second
// sentence or a tap; a false one cuts the patient off and sends their own
// words back to them.

/** Novel words needed in the trailing window to count as an interruption. */
export const BARGE_IN_MIN_NOVEL_WORDS = 2;
/** How many of the newest words the interruption rule looks at. */
export const BARGE_IN_WINDOW_WORDS = 4;

/**
 * Lowercase, diacritic-insensitive, punctuation-free form of one word.
 * "Está," → "esta", "Schmerzen." → "schmerzen", "Straße" → "strasse",
 * "don't" → "dont". Returns '' for a token with no letters or digits.
 */
export function normalizeWord(word) {
    return String(word ?? '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Whitespace tokens of `text`, each with its raw and normalised form. */
export function tokenize(text) {
    return String(text ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => ({ raw, norm: normalizeWord(raw) }));
}

/**
 * The patient's vocabulary: every normalised word, plus each adjacent pair
 * written together, so "follow up" spoken and "followup" heard still match.
 */
export function buildVocab(patientText) {
    const words = tokenize(patientText).map((t) => t.norm).filter(Boolean);
    const vocab = new Set(words);
    words.slice(1).forEach((w, i) => vocab.add(words[i] + w));
    return vocab;
}

// Edit distance, giving up (returning max + 1) once it must exceed `max`.
function editDistanceWithin(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}

// Typos a word may carry and still be the same word: none up to 3 letters
// ("is"/"in" differ in meaning), 1 up to 6, 2 beyond.
function tolerance(word) {
    if (word.length <= 3) return 0;
    if (word.length <= 6) return 1;
    return 2;
}

/**
 * Whether a normalised word is (nearly) one of the patient's words: exact,
 * within `tolerance` edits ("mourning" ~ "morning", "brust" ~ "brustt"), or a
 * cut-off start of a longer patient word ("yes" of "yesterday") — Chrome
 * splits and truncates echo it hears through a speaker.
 */
export function matchesVocab(word, vocab) {
    if (!word) return true;
    if (vocab.has(word)) return true;
    const tol = tolerance(word);
    for (const v of vocab) {
        if (tol > 0 && editDistanceWithin(word, v, tol) <= tol) return true;
        if (word.length >= 3 && v.length > word.length && v.startsWith(word)) return true;
    }
    return false;
}

// Does token `i` echo the patient? A token also echoes when, joined to a
// neighbour, it makes a patient word ("yes" + "terday" → "yesterday").
// `memo` caches matchesVocab per string for one call: the cumulative final
// text of a long reply repeats the same words many times.
function isEchoAt(tokens, i, vocab, memo) {
    const match = (w) => {
        if (!memo.has(w)) memo.set(w, matchesVocab(w, vocab));
        return memo.get(w);
    };
    const own = tokens[i].norm;
    if (match(own)) return true;
    const joined = [tokens[i - 1]?.norm && tokens[i - 1].norm + own, tokens[i + 1]?.norm && own + tokens[i + 1].norm];
    // A short join only counts exactly: two short words can be one edit
    // away from almost anything.
    return joined.some((w) => w && (vocab.has(w) || (w.length >= 7 && match(w))));
}

// A novel word counts towards an interruption only when it is a real word:
// one letter ("a", "I") and bare numbers are too easily produced by echo.
const counts = (norm) => norm.length >= 2 && !/^\p{N}+$/u.test(norm);

// en, de, es, it, fr, fi, sv, kk. Exact words only, and never when they
// occur in the patient's reply: fuzzy matches would turn garble into commands.
const INTERRUPT_COMMANDS = new Set([
    'stop', 'wait', 'stopp', 'warte', 'halt', 'para', 'espera',
    'ferma', 'aspetta', 'arrete', 'attends', 'seis', 'odota',
    'stanna', 'vanta', 'тоқта', 'күт',
].map(normalizeWord));

// Strip a continuous echo phrase, not arbitrary words from the patient's
// vocabulary. "chest pain, where exactly?" after an already-heard "chest
// pain" begins a new phrase and must retain the learner's opening words.
function echoPrefixLength(tokens, patientText, confirmed) {
    const patient = tokenize(patientText);
    const same = (a, b) => a && b && matchesVocab(a.norm, new Set([b.norm]));
    const base = Math.min(confirmed, tokens.length);
    let positions = [];
    if (base) {
        // Anchor on the longest available suffix of the confirmed final.
        for (let n = Math.min(3, base); n > 0 && !positions.length; n -= 1) {
            positions = patient.map((_, i) => i).filter((i) => i + n <= patient.length
                && tokens.slice(base - n, base).every((t, j) => same(t, patient[i + j])))
                .map((i) => i + n);
        }
    } else {
        positions = patient.map((_, i) => i);
    }
    let cut = base;
    while (cut < tokens.length) {
        const matched = positions.filter((i) => same(tokens[cut], patient[i]));
        if (!matched.length) break;
        positions = matched.map((i) => i + 1);
        cut += 1;
    }
    // Without confirmed echo, a short shared phrase is ambiguous. Preserve
    // it once an interruption is established rather than delete own words.
    return !base && cut < 3 ? 0 : cut;
}

/**
 * Is this watch result the learner talking over the patient?
 *
 * @param {object} p
 * @param {string} p.final       the recogniser's cumulative final text
 * @param {string} p.interim     its current interim text
 * @param {string} p.patientText what the patient is speaking (this reply)
 * @param {string} p.echoFinal   preceding final already judged to be echo
 * @returns {{ interrupt: boolean, novel: string[], cutFinal: number, cutTokens: number }}
 *   `novel` — the counted novel words in the window (normalised);
 *   `cutFinal` — how many leading whitespace tokens of `final` are echo for
 *   sure (they precede the learner's first word). Final text only grows, so
 *   this count stays valid for every later result of the same recogniser.
 *   `cutTokens` freezes the boundary across final AND interim at detection.
 */
export function detectInterruption({ final = '', interim = '', patientText = '', echoFinal = '' } = {}) {
    const finalTokens = tokenize(final);
    const tokens = [...finalTokens, ...tokenize(interim)];
    const vocab = buildVocab(patientText);
    const memo = new Map();
    const confirmed = tokenize(echoFinal).length;
    const wordIdx = tokens.map((t, i) => (t.norm ? i : -1)).filter((i) => i >= 0);
    const windowIdx = wordIdx.slice(-BARGE_IN_WINDOW_WORDS);
    // Only the window is judged: the rest of a long cumulative transcript
    // cannot change the answer.
    const echo = new Map(windowIdx.map((i) => [i, isEchoAt(tokens, i, vocab, memo)]));
    const novelIdx = windowIdx.filter((i) => !echo.get(i) && counts(tokens[i].norm));
    const command = windowIdx.find((i) => INTERRUPT_COMMANDS.has(tokens[i].norm) && !vocab.has(tokens[i].norm));
    const interrupt = novelIdx.length >= BARGE_IN_MIN_NOVEL_WORDS || command !== undefined;
    // The trailing window decides WHETHER to interrupt, never WHERE the
    // learner started: a single interim can contain a whole long sentence.
    const cut = interrupt ? Math.min(echoPrefixLength(tokens, patientText, confirmed), command ?? tokens.length) : 0;
    return {
        interrupt,
        novel: novelIdx.map((i) => tokens[i].norm),
        cutFinal: Math.min(cut, finalTokens.length),
        cutTokens: cut,
    };
}

/**
 * What the learner said, from a recogniser that was watching when they
 * interrupted: its text minus the echo before their first word. Drops the
 * first `cutTokens` tokens when supplied by detectInterruption. Legacy
 * callers without that boundary drop `cutFinal` final tokens, then
 * any leading run of tokens that still echo the patient (interim echo that
 * has since been finalised). Keeps everything from the first own word on,
 * with the recogniser's own casing and punctuation.
 */
export function learnerTurnText({ final = '', interim = '', patientText = '', cutFinal = 0, cutTokens } = {}) {
    // Freeze the detected boundary. Re-filtering later results by vocabulary
    // used to trim the learner again whenever they used the patient's words.
    if (cutTokens !== undefined) return [...tokenize(final), ...tokenize(interim)].slice(cutTokens).map((t) => t.raw).join(' ');
    const rest = [...tokenize(final).slice(Math.max(0, cutFinal)), ...tokenize(interim)];
    const vocab = buildVocab(patientText);
    const memo = new Map();
    const start = rest.findIndex((_, i) => !isEchoAt(rest, i, vocab, memo));
    if (start < 0) return '';
    return rest.slice(start).map((t) => t.raw).join(' ');
}
