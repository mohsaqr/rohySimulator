import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Uses DOMPurify with a safe default configuration.
 */
export const sanitizeHtml = (dirty) => {
  return DOMPurify.sanitize(dirty, {
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
      'href', 'src', 'alt', 'title', 'class', 'id',
      'target', 'rel', 'width', 'height',
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });
};

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
