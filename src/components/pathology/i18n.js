/**
 * Translation is INJECTED, never imported.
 *
 * Every component in this package takes a `t` prop whose default is the
 * identity translator below, and prop-drills it to its children. There is no
 * context, no provider and no react-i18next: the package must render in its
 * own standalone app — where no host translator exists at all — and a hook
 * that reads someone else's React context cannot do that. `tests/portability
 * .test.js` enforces the absence of the dependency; this file is what makes
 * the absence survivable.
 *
 * The contract a host implements is exactly i18next's:
 *
 *     t(key, fallbackEnglish)            → string
 *     t(key, fallbackEnglishIcu, values) → string, ICU-formatted
 *
 * Keys are PLAIN (`slide_label`, not `pathoyon_slide_label`). A host binds
 * them to whatever namespace it likes — Rohy binds them to `pathology`.
 */

/**
 * The translator a component uses when its host passed none: return the
 * English the call site already carries.
 *
 * @param {string} key       the message key
 * @param {string} [fallback] the English source text
 * @returns {string} `fallback` when given, otherwise the key itself
 */
export const identityT = (key, fallback) => fallback ?? key;

/**
 * Render a pluralised message.
 *
 * The message is authored ONCE, in ICU MessageFormat, so the plural rule is
 * the LANGUAGE's rather than English's. Picking between a `_one` and an
 * `_other` key with `count === 1` is wrong in Finnish and Swedish (which have
 * their own agreement rules after a numeral) and wrong in Kazakh (one form),
 * so this package never does it.
 *
 * A host whose `t` understands ICU — i18next with the ICU plugin, which is
 * what Rohy runs — formats the message itself and this helper returns its
 * answer untouched. A host with no translator (the standalone app) gets the
 * English source, which this formats itself: `formatIcu` implements exactly
 * the `plural` argument, with English rules, and nothing else.
 *
 * @param {Function} t        the injected translator
 * @param {string} key        the message key
 * @param {string} icu        the English source, in ICU MessageFormat
 * @param {object} values     named arguments referenced by the message
 * @returns {string} the rendered message
 */
export function plural(t, key, icu, values) {
    if (typeof t !== 'function') return formatIcu(icu, values);
    const rendered = t(key, icu, values);
    // Self-format ONLY when the translator demonstrably did nothing — it
    // handed back the source unchanged. Sniffing the RESULT for a '{' instead
    // (the first version of this) re-parses text a real ICU host already
    // formatted, and an output holding a literal brace is then silently
    // mangled rather than rejected: formatIcu('Use the {} operator') returns
    // 'Use the  operator'. Corrupting a host's correct answer is worse than
    // not helping it.
    return rendered === icu ? formatIcu(icu, values) : rendered;
}

const ENGLISH_PLURAL = (n) => (n === 1 ? 'one' : 'other');

/**
 * A minimal ICU MessageFormat renderer: `{name}`, and `{name, plural, ...}`
 * with `=N`, `one`, `other` branches and `#` for the number.
 *
 * Deliberately not a general implementation. It exists so the package's own
 * English is correct with no translator bound; every other language is the
 * host's ICU engine's job.
 *
 * @param {string} message  ICU source
 * @param {object} [values] named arguments
 * @returns {string} the rendered message
 */
export function formatIcu(message, values = {}) {
    if (typeof message !== 'string') {
        throw new TypeError(`formatIcu(): message must be a string, received ${typeof message}`);
    }
    let out = '';
    let i = 0;
    while (i < message.length) {
        if (message[i] !== '{') { out += message[i]; i += 1; continue; }
        const close = matchingBrace(message, i);
        const body = message.slice(i + 1, close);
        const comma = body.indexOf(',');
        if (comma === -1) {
            out += String(values[body.trim()] ?? '');
        } else {
            const name = body.slice(0, comma).trim();
            const kind = body.slice(comma + 1).trim();
            if (!kind.startsWith('plural')) {
                throw new RangeError(`formatIcu(): only the plural argument is supported, received "${kind.split(',')[0]}"`);
            }
            const count = Number(values[name]);
            out += formatIcu(
                pluralBranch(kind.slice(kind.indexOf(',') + 1), count).replace(/#/g, String(count)),
                values,
            );
        }
        i = close + 1;
    }
    return out;
}

/** The index of the `}` closing the `{` at `open`, brace-nesting aware. */
function matchingBrace(message, open) {
    let depth = 0;
    let i = open;
    while (i < message.length) {
        if (message[i] === '{') depth += 1;
        else if (message[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
        i += 1;
    }
    throw new RangeError(`formatIcu(): unbalanced braces in ${JSON.stringify(message)}`);
}

/** The branch body a count selects: an exact `=N` first, then the category. */
function pluralBranch(branches, count) {
    const found = new Map();
    let i = 0;
    while (i < branches.length) {
        if (branches[i] !== '{') { i += 1; continue; }
        const close = matchingBrace(branches, i);
        const selector = branches.slice(0, i).trim().split(/\s+/).pop();
        found.set(selector, branches.slice(i + 1, close));
        branches = branches.slice(close + 1);
        i = 0;
    }
    return found.get(`=${count}`) ?? found.get(ENGLISH_PLURAL(count)) ?? found.get('other') ?? '';
}
