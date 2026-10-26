import DOMPurify from 'dompurify';
import { baseUrl } from '../../../config/api';

/**
 * Point this server's files at the base path the app is served under. A
 * lesson stores its images and attachments as `/uploads/…` (server-absolute),
 * which is right at '/' and a 404 on an install served at '/rohy/'. Only an
 * attribute value that STARTS with `/uploads/` or `/api/` is rewritten; a link
 * to another host is left alone. Display only — what is stored is unchanged.
 */
export const withBasePath = (html) => (typeof html === 'string'
  ? html.replace(/(\s(?:src|href)=["'])\/(uploads|api)\//g, (match, attr, kind) => `${attr}${baseUrl(`/${kind}/`)}`)
  : html);

// Host edit (security audit 2026-10-26, L5-08). `class` used to pass
// untouched, so an author could paste `<div class="fixed inset-0 z-50">` and
// let the app's own Tailwind build cover the room with a fake link; `id` let
// lesson HTML collide with (or clobber) the app's own element ids. `id` is
// gone; a class token survives only when it is one lesson content actually
// uses: the `rohy-` namespace (seeded lessons), `language-*` / `hljs*` (code
// blocks), and the two utilities Tiptap's Link mark writes.
const LESSON_CLASS_TOKENS = new Set(['underline', 'text-cyan-600']);
export const isAllowedLessonClass = (token) => LESSON_CLASS_TOKENS.has(token)
  || /^rohy-[a-z0-9-]+$/.test(token)
  || /^language-[a-z0-9+#_-]+$/i.test(token)
  || /^hljs(?:-[a-z0-9_-]+)?$/.test(token);

// A private DOMPurify instance, so the class hook below never applies to the
// rest of the app's sanitising (DOMPurify's default export is shared).
let lessonPurifier = null;
const purifier = () => {
  if (lessonPurifier) return lessonPurifier;
  if (typeof window === 'undefined') return DOMPurify;
  lessonPurifier = DOMPurify(window);
  lessonPurifier.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'class') return;
    const kept = String(data.attrValue || '').split(/\s+/).filter(Boolean).filter(isAllowedLessonClass);
    if (kept.length) data.attrValue = kept.join(' ');
    else data.keepAttr = false;
  });
  return lessonPurifier;
};

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Uses DOMPurify with a safe default configuration.
 */
export const sanitizeHtml = (dirty) => withBasePath(purifier().sanitize(dirty, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'a', 'img',
      'pre', 'code',
      'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class',
      'target', 'rel', 'width', 'height',
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  }));

/**
 * Detect whether a string is HTML content (from RichTextEditor / Tiptap).
 * Matches known block-level tags that Tiptap wraps output in.
 * Returns false for plain text that happens to start with '<' (e.g. code snippets).
 */
export const isHtmlContent = (text) => {
  if (!text) return false;
  return /^<(p|h[1-6]|ul|ol|div|blockquote|pre|table)[\s>]/i.test(text.trim());
};

/**
 * Sanitize HTML and return props for dangerouslySetInnerHTML.
 * This is a convenience wrapper for React components.
 */
export const createSanitizedMarkup = (dirty) => {
  return { __html: sanitizeHtml(dirty) };
};
