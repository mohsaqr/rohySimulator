// Server-side scrub for teacher-authored lesson HTML.
//
// Defense-in-depth: lesson section HTML is authored in a TipTap editor and, on
// the student side, LessonRoomView renders custom-node HTML WITHOUT the client
// dompurify pass (nodes are trusted by the editor schema). Authoring is
// educator-only, but we still strip the highest-risk vectors on WRITE so a
// compromised or hand-crafted payload can't become stored XSS. This is a
// conservative regex scrub — it preserves TipTap markup (custom
// <lecture-*> elements, data-* attrs, embed <iframe>s) while removing:
//   * <script>…</script> blocks
//   * inline event handlers (on*="…")
//   * javascript: / vbscript: / data:text/html URLs in href/src
// A full jsdom + DOMPurify pass is the proper hardening; tracked as a follow-up.
//
// NOT a replacement for the client render-time sanitize on plain text/markdown.

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_OPEN_RE = /<\/?script\b[^>]*>/gi;
const ON_ATTR_RE = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL_ATTR_RE =
    /\s(href|src|xlink:href)\s*=\s*("|')\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi;

export function sanitizeLessonHtml(html) {
    if (typeof html !== 'string' || html === '') return html;
    return html
        .replace(SCRIPT_RE, '')
        .replace(SCRIPT_OPEN_RE, '')
        .replace(ON_ATTR_RE, '')
        .replace(DANGEROUS_URL_ATTR_RE, '');
}

// Plain-text strip for fields that are AUTHORED as text and RENDERED as text
// (survey titles/descriptions, question text, options, free-text answers):
// drop every tag outright rather than trying to whitelist markup.
const TAG_RE = /<[^>]*>/g;

export function stripHtmlToText(value) {
    if (typeof value !== 'string' || value === '') return value;
    return value.replace(SCRIPT_RE, '').replace(TAG_RE, '');
}
