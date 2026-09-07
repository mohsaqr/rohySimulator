/**
 * Translation plumbing, and deliberately nothing else.
 *
 * The package carries no i18n dependency. Every component takes one prop:
 *
 *   t(key, fallback)          -> string
 *   t(key, fallback, values)  -> string, with `{named}` placeholders filled
 *
 * which is i18next's own `t(key, defaultValue, options)` shape, so a host binds
 * its translator straight in with no adapter, and the identity default below
 * renders the English written at the call site when no host is present.
 *
 * The third argument exists because a sentence is the unit of translation. A
 * count assembled in JSX from a number, a lone "of" looked up as its own key,
 * and a noun is not translatable: in Finnish and Kazakh that relation is a case
 * ending on the noun rather than a separate word, and word order, agreement and
 * case marking all differ besides. Splitting a sentence to work around a
 * two-argument translator is the anti-pattern this whole contract exists to
 * remove, so the signature carries the values instead.
 *
 * This is NOT an ICU renderer and must never grow into one. It substitutes
 * `{name}` and stops. A partial ICU implementation is a liability: it silently
 * mangles a host's correctly formatted answer, and a host's own message format
 * is the thing that actually knows plural categories. The one genuine plural in
 * this package crosses to the host as data — `case_document_summary()` returns
 * `{ count, label_key }` — precisely so nothing here has to guess at one.
 */

/** A `{name}` placeholder. Anything else between braces is left alone. */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Depth-check a message's braces.
 *
 * An unbalanced brace means the message is malformed — a truncated
 * translation, a stray `}` from an editor, a half-written placeholder. Eating
 * it silently is how a broken string ships looking merely odd, so it throws.
 * The guard keeps a negative depth negative so `a}b{` fails too, even though
 * its braces balance by count.
 *
 * @param {string} text message to check
 * @returns {void}
 * @throws {SyntaxError} when the braces do not nest
 */
function assert_balanced_braces(text) {
  const depth = [...text].reduce((current, character) => {
    if (current < 0) return current;
    if (character === '{') return current + 1;
    if (character === '}') return current - 1;
    return current;
  }, 0);
  if (depth !== 0) {
    throw new SyntaxError(`interpolate(): unbalanced brace in message ${JSON.stringify(text)}`);
  }
}

/**
 * Fill `{name}` placeholders in a message.
 *
 * A name with no value is left standing rather than blanked: a message that
 * reads "4 of {total}" says what went wrong, while "4 of " looks like data.
 * Anything between braces that is not a bare name — an ICU construction such as
 * `{count, plural, ...}` — is passed through untouched, because this function
 * is not the thing that renders it.
 *
 * @param {string} message message, possibly containing `{name}` placeholders
 * @param {object|null} [values] values by placeholder name
 * @returns {string} the filled message
 * @throws {SyntaxError} when the message's braces do not nest
 */
export function interpolate(message, values = null) {
  const text = String(message ?? '');
  assert_balanced_braces(text);
  if (values === null || typeof values !== 'object') return text;
  return text.replace(PLACEHOLDER, (placeholder, name) => (
    Object.hasOwn(values, name) && values[name] !== null && values[name] !== undefined
      ? String(values[name])
      : placeholder
  ));
}

/**
 * The translator a component uses when the host supplies none.
 *
 * It is what makes one source serve two hosts: standalone passes no `t`, so
 * every call returns the English written beside its key at the call site.
 *
 * @param {string} key static translation key
 * @param {string} [fallback] English written at the call site
 * @param {object|null} [values] values for `{name}` placeholders
 * @returns {string} the English message
 */
export const identity_t = (key, fallback, values = null) => interpolate(fallback ?? key, values);

/**
 * Ask the host for a message that carries values, and format it ourselves only
 * if the host handed the source back untouched.
 *
 * A host `t` that honours the third argument returns something different from
 * the fallback we passed in — either its own translation, or our English with
 * the values already substituted. A two-argument host `t` ignores `values` and
 * returns the fallback byte-for-byte, and that identity is the ONLY signal
 * acted on here. Sniffing the result for a `{` instead would re-format a host's
 * correctly rendered answer and eat braces it deliberately kept.
 *
 * @param {(key: string, fallback?: string, values?: object) => string} t host translator
 * @param {string} key static translation key
 * @param {string} fallback English written at the call site
 * @param {object} values values for `{name}` placeholders
 * @returns {string} the rendered message
 */
export function format_message(t, key, fallback, values) {
  const translate = typeof t === 'function' ? t : identity_t;
  const rendered = translate(key, fallback, values);
  return rendered === fallback ? interpolate(fallback, values) : String(rendered);
}
