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
//
// NUMBERS AND UNITS (Codex review 2026-11-02). The patient's text says
// "25 mg"; the recogniser, hearing it through the speaker, writes "twenty
// five milligrams" — three words that occur nowhere in the text. Converting
// digits to words would need a grammar per case language (German
// "fünfundzwanzig", Finnish "kaksikymmentäviisi", French "quatre-vingt-dix")
// and still miss "point", "per", "of mercury". So the rule is by CLASS, not
// by value: while the patient's text contains a number, a heard number word
// is echo; while it contains a unit (an abbreviation, % or °, or a spelled
// unit), a heard unit word is echo. Number words are recognised as whole
// words built from number morphemes of the eight case languages, so the
// compounds above need no table of their own. The cost is the documented
// bias: a learner who answers with a number while the patient is reading
// out a dose needs one more word to interrupt.

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

// ---- Numbers and units (see the header) --------------------------------

const normSet = (words) => new Set(words.map(normalizeWord).filter(Boolean));

// Number morphemes of en, de, es, it, fr, fi, sv, kk: every simple number
// word, and the pieces compounds are glued from ("veinti", "vent", "dieci").
const NUMBER_MORPHEMES = normSet([
    // en
    'zero', 'oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
    'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
    'point', 'half',
    // de
    'null', 'ein', 'eins', 'eine', 'zwei', 'zwo', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
    'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn',
    'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig', 'hundert', 'tausend',
    'komma', 'halb',
    // es
    'cero', 'uno', 'una', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
    'once', 'doce', 'trece', 'catorce', 'quince', 'dieci', 'veinte', 'veinti', 'treinta', 'cuarenta',
    'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento', 'cientos', 'quinientos', 'mil',
    'coma', 'medio',
    // it
    'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici',
    'tredici', 'quattordici', 'quindici', 'sedici', 'dicias', 'diciotto', 'dician', 'venti', 'vent', 'trenta',
    'trent', 'quaranta', 'quarant', 'cinquanta', 'cinquant', 'sessanta', 'sessant', 'settanta', 'settant',
    'ottanta', 'ottant', 'novanta', 'novant', 'cento', 'mille', 'mila', 'virgola', 'mezzo',
    // fr
    'zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
    'treize', 'quatorze', 'quinze', 'seize', 'vingt', 'vingts', 'trente', 'quarante', 'cinquante', 'soixante',
    'cent', 'cents', 'mille', 'virgule', 'demi',
    // fi
    'nolla', 'yksi', 'kaksi', 'kolme', 'neljä', 'viisi', 'kuusi', 'seitsemän', 'kahdeksan', 'yhdeksän',
    'kymmenen', 'kymmentä', 'toista', 'sata', 'sataa', 'tuhat', 'tuhatta', 'pilkku', 'puoli',
    // sv
    'noll', 'en', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv',
    'tretton', 'fjorton', 'femton', 'sexton', 'sjutton', 'arton', 'nitton', 'tjugo', 'trettio', 'fyrtio',
    'femtio', 'sextio', 'sjuttio', 'åttio', 'nittio', 'hundra', 'tusen',
    // kk
    'нөл', 'бір', 'екі', 'үш', 'төрт', 'бес', 'алты', 'жеті', 'сегіз', 'тоғыз', 'он', 'жиырма', 'отыз',
    'қырық', 'елу', 'алпыс', 'жетпіс', 'сексен', 'тоқсан', 'жүз', 'мың', 'бүтін',
]);
// Glue inside a compound ("fünfundzwanzig", "vingt-et-un") or between
// spoken number words ("one hundred and ten"); never a number on its own.
const NUMBER_JOINERS = normSet(['and', 'und', 'et', 'e', 'y', 'och', 'ja']);
const MAX_MORPHEME = Math.max(...[...NUMBER_MORPHEMES, ...NUMBER_JOINERS].map((m) => m.length));

/** Whether a normalised word is a number: digits, or number morphemes glued together. */
export function isNumberWord(norm) {
    if (!norm) return false;
    if (/^\p{N}+$/u.test(norm)) return true;
    // reach[i]: norm[0, i) splits into morphemes; 2 = at least one is a number.
    const reach = new Array(norm.length + 1).fill(0);
    reach[0] = 1;
    for (let i = 0; i < norm.length; i += 1) {
        if (!reach[i]) continue;
        for (let j = i + 1; j <= Math.min(norm.length, i + MAX_MORPHEME); j += 1) {
            const part = norm.slice(i, j);
            if (NUMBER_MORPHEMES.has(part)) reach[j] = 2;
            else if (NUMBER_JOINERS.has(part)) reach[j] = Math.max(reach[j], reach[i]);
        }
    }
    return reach[norm.length] === 2;
}

// Units the cases speak: abbreviations, symbols spelled out, and the words
// a recogniser writes for them, in the eight case languages.
const UNIT_WORDS = normSet([
    'mg', 'mcg', 'ug', 'g', 'gr', 'gram', 'grams', 'gramm', 'gramos', 'grammi', 'grammes', 'grammaa',
    'ml', 'l', 'dl', 'cl', 'liter', 'liters', 'litre', 'litres', 'litro', 'litros', 'litri', 'litraa',
    'kg', 'kilo', 'kilos', 'kiloa', 'chilo', 'chili', 'mm', 'mmhg', 'hg', 'cm', 'bpm', 'min', 'iu', 'ie', 'ui',
    'mmol', 'mol', 'degree', 'degrees', 'grad', 'grade', 'grado', 'grados', 'gradi', 'degré', 'degrés',
    'aste', 'astetta', 'asteen', 'percent', 'prozent', 'procent', 'prosent', 'prosenttia', 'por', 'ciento',
    'cento', 'pour', 'cent', 'per', 'pro', 'par', 'of', 'minute', 'minutes', 'minuten', 'minuto', 'minuti',
    'minutos', 'minuutissa', 'minut', 'minuter', 'beats', 'schläge', 'latidos', 'battiti', 'battements',
    'lyöntiä', 'slag', 'mercury', 'quecksilber', 'mercurio', 'mercure', 'elohopeaa', 'kvicksilver',
    'мг', 'мл', 'кг', 'мм', 'градус', 'градуса', 'градусов', 'процент', 'пайыз', 'минут', 'минутына', 'сынап',
]);
const UNIT_STEMS = [
    'milligram', 'miligram', 'millilit', 'mililit', 'kilogram', 'microgram', 'mikrogram', 'millimet',
    'milimet', 'millimol', 'milimol', 'миллиграм', 'миллилит', 'килограм', 'миллимет',
].map(normalizeWord);

/** Whether a normalised word is a unit (or a unit word glued to its number, "25mg"). */
export function isUnitWord(norm) {
    const word = String(norm ?? '').replace(/^\p{N}+/u, '');
    if (!word) return false;
    return UNIT_WORDS.has(word) || UNIT_STEMS.some((stem) => word.startsWith(stem));
}

/** What classes of spoken-out words the patient's text licenses as echo. */
export function numericEchoClasses(patientText) {
    const raw = String(patientText ?? '');
    const words = tokenize(raw).map((t) => t.norm).filter(Boolean);
    return {
        number: /\p{N}/u.test(raw) || words.some(isNumberWord),
        unit: /[%°‰]/u.test(raw) || words.some(isUnitWord),
    };
}

// Is token `i` a spoken number or unit the patient's text licenses?
function isNumericEcho(tokens, i, classes) {
    if (!classes) return false;
    const own = tokens[i].norm;
    if (classes.unit && isUnitWord(own)) return true;
    if (!classes.number) return false;
    if (isNumberWord(own)) return true;
    // "one hundred AND ten": a joiner between number words.
    return NUMBER_JOINERS.has(own) && [tokens[i - 1], tokens[i + 1]].some((t) => t && isNumberWord(t.norm));
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
// `classes` (numericEchoClasses) adds spoken-out numbers and units; the
// command check passes none, so "seis" (fi: stop) stays a command while a
// Spanish patient reads out a dose.
function isEchoAt(tokens, i, vocab, memo, classes = null) {
    const match = (w) => {
        if (!memo.has(w)) memo.set(w, matchesVocab(w, vocab));
        return memo.get(w);
    };
    const own = tokens[i].norm;
    if (match(own)) return true;
    if (isNumericEcho(tokens, i, classes)) return true;
    const joined = [tokens[i - 1]?.norm && tokens[i - 1].norm + own, tokens[i + 1]?.norm && own + tokens[i + 1].norm];
    // A short join only counts exactly: two short words can be one edit
    // away from almost anything.
    return joined.some((w) => w && (vocab.has(w) || (w.length >= 7 && match(w))));
}

// A novel word counts towards an interruption only when it is a real word:
// one letter ("a", "I") and bare numbers are too easily produced by echo.
const counts = (norm) => norm.length >= 2 && !/^\p{N}+$/u.test(norm);

// en, de, es, it, fr, fi, sv, kk — familiar, polite and plural forms. A
// heard word must BE one of these exactly (fuzzy matching would turn garble
// into commands), and must NOT echo the patient's reply: not one of its
// words, nor a near miss or cut-off start of one ("wait" of "waiting", fi
// "odota" of "odotan" — Chrome truncates echo, see matchesVocab).
// Left out on purpose: es "pare" (it: "it seems", "mi pare che…").
const INTERRUPT_COMMANDS = new Set([
    'stop', 'wait',
    'stopp', 'warte', 'warten', 'stoppen', 'halt',
    'para', 'espera', 'espere', 'esperen', 'esperad', 'paren', 'parad',
    'ferma', 'fermati', 'fermi', 'fermate', 'fermatevi', 'aspetta', 'aspetti', 'aspettate',
    'arrête', 'arrêtez', 'attends', 'attendez',
    'seis', 'odota', 'odottakaa', 'lopeta', 'lopettakaa',
    'stanna', 'stoppa', 'vänta',
    'тоқта', 'тоқтаңыз', 'тоқтаңдар', 'күт', 'күтіңіз', 'күтіңдер',
].map(normalizeWord));

// Strip a continuous echo phrase, not arbitrary words from the patient's
// vocabulary. "chest pain, where exactly?" after an already-heard "chest
// pain" begins a new phrase and must retain the learner's opening words.
function echoPrefixLength(tokens, patientText, confirmed) {
    const patient = tokenize(patientText);
    const classes = numericEchoClasses(patientText);
    const num = (t) => classes.number && Boolean(t) && isNumberWord(t.norm);
    const unit = (t) => classes.unit && Boolean(t) && isUnitWord(t.norm);
    // A spoken number or unit stands for the patient's written one
    // ("twenty five milligrams" for "25 mg").
    const same = (a, b) => a && b && (matchesVocab(a.norm, new Set([b.norm])) || (num(a) && num(b)) || (unit(a) && unit(b)));
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
        // A number spoken in several words ("twenty five") stays on the
        // patient's one written number until the next word moves on.
        const next = positions.flatMap((i) => {
            if (same(tokens[cut], patient[i])) return [i + 1];
            return num(tokens[cut]) && num(patient[i - 1]) ? [i] : [];
        });
        if (!next.length) break;
        positions = [...new Set(next)];
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
    const classes = numericEchoClasses(patientText);
    const memo = new Map();
    const confirmed = tokenize(echoFinal).length;
    const wordIdx = tokens.map((t, i) => (t.norm ? i : -1)).filter((i) => i >= 0);
    const windowIdx = wordIdx.slice(-BARGE_IN_WINDOW_WORDS);
    // Only the window is judged: the rest of a long cumulative transcript
    // cannot change the answer.
    const echo = new Map(windowIdx.map((i) => [i, isEchoAt(tokens, i, vocab, memo, classes)]));
    const novelIdx = windowIdx.filter((i) => !echo.get(i) && counts(tokens[i].norm));
    // A command word is accepted only when it does not echo the patient —
    // judged BEFORE accepting it, so a truncated patient word is never a stop.
    const command = windowIdx.find((i) => INTERRUPT_COMMANDS.has(tokens[i].norm) && !isEchoAt(tokens, i, vocab, memo));
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
    const classes = numericEchoClasses(patientText);
    const memo = new Map();
    const start = rest.findIndex((_, i) => !isEchoAt(rest, i, vocab, memo, classes));
    if (start < 0) return '';
    return rest.slice(start).map((t) => t.raw).join(' ');
}
