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
//   * href/src/xlink:href/action/poster/data/background (and an SVG
//     animation's to/from/by/values) whose value, once HTML entities are
//     decoded and whitespace stripped, is a javascript: / vbscript: URL or a
//     data: URL that is not a raster image
//   * <script>, <base>, <meta> and the SVG animation elements, as tags
//
// Tags are read with a TOKENIZER THAT FOLLOWS THE HTML SPEC's tag states
// (tag name, before/after attribute name, the three attribute-value states),
// not with a document-wide regex: a document-wide `on\w+=` also matched text
// content ("…the word "onwards=" …") and URL paths inside other attribute
// values (`href="/x/online=1"`), deleting legitimate markup. Following the
// spec exactly is the point (security audit 2026-10-26, L4-03): the previous
// tokenizer ended an UNQUOTED value at a quote, which a browser does not, so
// `<a title=x'"y=" > <img src=x onerror=…>` parsed as one tag here and as two
// in the browser — the second one with its handler intact.
//
// Why the output is safe even where this scanner and a browser disagree about
// CONTEXT (inside a comment, <style>, <textarea>, CDATA, foreign content):
//
//   * every `<` left inside an attribute value is escaped to `&lt;` (the same
//     attribute value to the DOM), and a tag or attribute NAME containing `<`
//     is not kept as markup;
//   * so in the output the only `<` characters are the first character of a
//     tag this scanner read and scrubbed, or text;
//   * a browser can only start a tag at a `<`, so every tag a browser finds is
//     one this scanner found, read from the same position by the same rules —
//     whatever state the browser was in before it.
//
// The whole pass runs to a FIXPOINT, because removing one thing can join two
// others into something new (`<scr<script>ipt>` → `<script>`); a document
// that has not settled after MAX_PASSES is reduced to text.
//
// A parser-based allowlist (jsdom + DOMPurify) remains the stronger design; it
// needs jsdom as a production dependency (it is a dev dependency only), so it
// stays a follow-up. The client renders through DOMPurify as a second layer.
//
// NOT a replacement for the client render-time sanitize on plain text/markdown.

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'poster', 'data', 'background', 'formaction',
    // SVG animation targets: `<animate attributeName="href" to="javascript:…">`
    // writes a URL into an attribute this list already guards.
    'to', 'from', 'by']);
// `values` is a `;`-separated list, and any one entry can be the URL.
const URL_LIST_ATTRS = new Set(['values']);
const ALWAYS_STRIP_ATTRS = new Set(['srcdoc', 'formaction', 'attributename']);
// Elements that are removed outright (their tags; text between them stays):
// script runs, base rewrites every relative URL on the page, meta can
// refresh/redirect, and the SVG animation elements can rewrite another
// element's attributes after this scan has passed it.
const DROPPED_ELEMENTS = new Set(['script', 'base', 'meta', 'animate', 'animatemotion', 'animatetransform',
    'animatecolor', 'set', 'discard', 'handler', 'listener']);
// `data:` is allowed only for raster images (pasted screenshots); anything
// else — text/html, image/svg+xml, application/* — is a document.
const DANGEROUS_URL_RE = /^(?:javascript:|vbscript:|data:(?!image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]))/;
// What a kept tag or attribute name may look like. Custom elements
// (`lecture-mcq`), namespaced names (`xlink:href`, `o:p`) and data-* pass.
const TAG_NAME_RE = /^[a-z][a-z0-9:._-]*$/i;
const ATTR_NAME_RE = /^[a-z_:][a-z0-9:._-]*$/i;

const MAX_PASSES = 8;

const NAMED_ENTITIES = { colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')', quot: '"', apos: "'", amp: '&' };

const codePoint = (n) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/** The value a browser would see: entities decoded, control characters and whitespace removed. */
function decodedUrl(value) {
    return value
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
    if (!ATTR_NAME_RE.test(name)) return true;
    if (lower.startsWith('on')) return true;
    if (ALWAYS_STRIP_ATTRS.has(lower)) return true;
    if (value === undefined) return false;
    if (URL_ATTRS.has(lower)) return DANGEROUS_URL_RE.test(decodedUrl(value));
    if (URL_LIST_ATTRS.has(lower)) return value.split(';').some((part) => DANGEROUS_URL_RE.test(decodedUrl(part)));
    return false;
}

// The HTML tokenizer's whitespace (after CR/LF normalisation, which the
// browser does first and which treats a CR like a LF).
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
const isAsciiAlpha = (c) => c !== undefined && /[A-Za-z]/.test(c);

/**
 * Read one tag starting at `nameStart` (the first character of its name), by
 * the spec's tag-name / attribute states.
 *
 * @returns {{name: string, end: number, attrs: Array<{name: string, value: string|undefined, start: number, end: number, valueStart: number, valueEnd: number}>}|null}
 *   null when the input ends inside the tag (a browser drops such a tag).
 */
function readTag(html, nameStart) {
    const n = html.length;
    let j = nameStart;
    while (j < n && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>') j += 1;
    const name = html.slice(nameStart, j);
    const attrs = [];
    for (;;) {
        while (j < n && isSpace(html[j])) j += 1;
        if (j >= n) return null;
        if (html[j] === '>') return { name, end: j + 1, attrs };
        if (html[j] === '/') {
            j += 1;
            if (html[j] === '>') return { name, end: j + 1, attrs };
            continue; // anything else: back to "before attribute name"
        }
        // Attribute name: an `=` here is the first character of the name.
        const start = j;
        if (html[j] === '=') j += 1;
        while (j < n && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j += 1;
        const attrName = html.slice(start, j);
        let k = j;
        while (k < n && isSpace(html[k])) k += 1;
        if (html[k] !== '=') {
            attrs.push({ name: attrName, value: undefined, start, end: j, valueStart: j, valueEnd: j });
            j = k;
            continue;
        }
        k += 1;
        while (k < n && isSpace(html[k])) k += 1;
        if (k >= n) return null;
        const quote = html[k];
        if (quote === '"' || quote === "'") {
            const close = html.indexOf(quote, k + 1);
            if (close === -1) return null;
            attrs.push({ name: attrName, value: html.slice(k + 1, close), start, end: close + 1, valueStart: k + 1, valueEnd: close });
            j = close + 1;
        } else if (quote === '>') {
            attrs.push({ name: attrName, value: '', start, end: k, valueStart: k, valueEnd: k });
            j = k;
        } else {
            // Unquoted: ends at whitespace or `>` ONLY. Quotes, `<`, `=` and
            // backticks are part of the value (parse errors, but kept).
            let e = k;
            while (e < n && !isSpace(html[e]) && html[e] !== '>') e += 1;
            attrs.push({ name: attrName, value: html.slice(k, e), start, end: e, valueStart: k, valueEnd: e });
            j = e;
        }
    }
}

/** A start tag rebuilt from its own source text: dangerous attributes cut out, `<` in values escaped, the rest byte-for-byte. */
function renderStartTag(html, tagStart, tag) {
    let out = '';
    let last = tagStart;
    for (const attr of tag.attrs) {
        if (dropAttribute(attr.name, attr.value)) {
            out += html.slice(last, attr.start);
            last = attr.end;
        } else if (attr.value !== undefined && attr.value.includes('<')) {
            out += html.slice(last, attr.valueStart) + attr.value.replaceAll('<', '&lt;');
            last = attr.valueEnd;
        }
    }
    return out + html.slice(last, tag.end);
}

/** One scrub pass. */
function scrubPass(input) {
    // eslint-disable-next-line no-control-regex
    const html = input.replace(/\u0000/g, '').replace(SCRIPT_RE, '');
    let out = '';
    let i = 0;
    while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt === -1) {
            out += html.slice(i);
            break;
        }
        out += html.slice(i, lt);
        const isEnd = html[lt + 1] === '/';
        const nameStart = isEnd ? lt + 2 : lt + 1;
        if (!isAsciiAlpha(html[nameStart])) {
            // Not a tag to a browser either (text, a comment, a declaration):
            // kept as it is, and scanning resumes at the very next character.
            out += '<';
            i = lt + 1;
            continue;
        }
        const tag = readTag(html, nameStart);
        if (!tag) {
            // The input ends inside a tag. A browser drops it; here it becomes text.
            out += html.slice(lt).replaceAll('<', '&lt;');
            break;
        }
        const lower = tag.name.toLowerCase();
        if (!TAG_NAME_RE.test(tag.name)) {
            // `<a<img …>`: one tag to the browser, named `a<img`. Not kept as markup.
            out += html.slice(lt, tag.end).replaceAll('<', '&lt;');
        } else if (DROPPED_ELEMENTS.has(lower)) {
            // removed
        } else if (isEnd) {
            // An end tag's attributes mean nothing; it is written without them.
            out += tag.attrs.length ? `</${tag.name}>` : html.slice(lt, tag.end);
        } else {
            out += renderStartTag(html, lt, tag);
        }
        i = tag.end;
    }
    return out;
}

export function sanitizeLessonHtml(html) {
    if (typeof html !== 'string' || html === '') return html;
    let current = html;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const next = scrubPass(current);
        if (next === current) return current;
        current = next;
    }
    // Still changing: something is constructed to re-form after every pass.
    // Fail closed — no markup at all.
    return current.replaceAll('<', '&lt;');
}

// Plain-text strip for fields that are AUTHORED as text and RENDERED as text
// (survey titles/descriptions, question text, options, free-text answers):
// drop every tag outright rather than trying to whitelist markup.
const TAG_RE = /<[^>]*>/g;

export function stripHtmlToText(value) {
    if (typeof value !== 'string' || value === '') return value;
    return value.replace(SCRIPT_RE, '').replace(TAG_RE, '');
}
