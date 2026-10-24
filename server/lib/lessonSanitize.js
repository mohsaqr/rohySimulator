// Server-side scrub for teacher-authored lesson HTML.
//
// Defense-in-depth: lesson section HTML is authored in a TipTap editor and, on
// the student side, LessonRoomView renders custom-node HTML WITHOUT the client
// dompurify pass (nodes are trusted by the editor schema). Authoring is
// educator-only, but we still strip the highest-risk vectors on WRITE so a
// compromised or hand-crafted payload can't become stored XSS. This is a
// conservative scrub — it preserves TipTap markup (custom <lecture-*>
// elements, data-* attrs, embed <iframe>s) while removing:
//   * <script>…</script> blocks
//   * inline event handlers (on*=…), however the attribute is introduced:
//     after whitespace, straight after a quote closing the previous attribute
//     (`src="x"onerror=`) or after a slash (`src="x"/onerror=`) — the HTML
//     tokenizer treats all three as an attribute boundary
//   * srcdoc and formaction outright (an iframe's inline document, a button's
//     form target — neither has a legitimate use in a lesson)
//   * href/src/xlink:href/action/poster/data/background whose value, once
//     HTML entities are decoded and whitespace stripped, is a javascript: /
//     vbscript: / data:text/html URL
//
// Attributes are read per tag with a small quote-aware tokenizer, not with a
// document-wide regex: a document-wide `on\w+=` also matched text content
// ("…the word "onwards=" …") and URL paths inside other attribute values
// (`href="/x/online=1"`), deleting legitimate markup.
//
// A full jsdom + DOMPurify pass is the proper hardening; it needs jsdom as a
// production dependency, so it stays a follow-up.
//
// NOT a replacement for the client render-time sanitize on plain text/markdown.

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_OPEN_RE = /<\/?script\b[^>]*>/gi;

// An opening tag: name, then anything up to the first `>` that is not inside
// a quoted attribute value. A quote with no partner is an ordinary character
// (an unquoted value may contain one: `<img src=x' onerror=…>` is a real
// onerror to a browser), so it falls through to the last alternative.
const OPEN_TAG_RE = /<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
// One attribute inside a tag's attribute text. The name class excludes
// whitespace, quotes, `/`, `=` and `>`, so whatever separated it from the
// previous attribute (space, slash, a closing quote) is skipped over.
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'poster', 'data', 'background']);
const ALWAYS_STRIP_ATTRS = new Set(['srcdoc', 'formaction']);
const DANGEROUS_URL_RE = /^(?:javascript:|vbscript:|data:text\/html)/;

const NAMED_ENTITIES = { colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')', quot: '"', apos: "'", amp: '&' };

const codePoint = (n) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/** The value a browser would see: entities decoded, control characters and whitespace removed. */
function decodedUrl(rawValue) {
    const unquoted = /^["']/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
    return unquoted
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => codePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);?/g, (_, dec) => codePoint(Number(dec)))
        .replace(/&([a-z]+);?/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
        // Browsers strip ASCII whitespace and control characters from a URL
        // before reading the scheme: `java\tscript:` runs.
        // eslint-disable-next-line no-control-regex
        .replace(/[\s\u0000-\u001f\u007f]/g, '')
        .toLowerCase();
}

function dropAttribute(name, value) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) return true;
    if (ALWAYS_STRIP_ATTRS.has(lower)) return true;
    if (URL_ATTRS.has(lower) && value !== undefined) return DANGEROUS_URL_RE.test(decodedUrl(value));
    return false;
}

/** The tag's attribute text with every dangerous attribute cut out, the rest byte-for-byte. */
function scrubAttributes(attrText) {
    let out = '';
    let last = 0;
    for (const match of attrText.matchAll(ATTR_RE)) {
        if (!dropAttribute(match[1], match[2])) continue;
        out += attrText.slice(last, match.index);
        last = match.index + match[0].length;
    }
    return out + attrText.slice(last);
}

export function sanitizeLessonHtml(html) {
    if (typeof html !== 'string' || html === '') return html;
    return html
        .replace(SCRIPT_RE, '')
        .replace(SCRIPT_OPEN_RE, '')
        .replace(OPEN_TAG_RE, (tag, name, attrText) => `<${name}${scrubAttributes(attrText)}>`);
}

// Plain-text strip for fields that are AUTHORED as text and RENDERED as text
// (survey titles/descriptions, question text, options, free-text answers):
// drop every tag outright rather than trying to whitelist markup.
const TAG_RE = /<[^>]*>/g;

export function stripHtmlToText(value) {
    if (typeof value !== 'string' || value === '') return value;
    return value.replace(SCRIPT_RE, '').replace(TAG_RE, '');
}
