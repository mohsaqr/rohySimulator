// URL allow-lists for everything the lessons module turns into a link, an
// iframe or a file address. One place, so a `javascript:`/`data:` URL stored
// in a lesson (hand-crafted content, a compromised author account) renders as
// text everywhere rather than as something a learner can click.

/** Only http/https — never javascript:, data:, etc. A bare `www.` host is given https. */
export const safeHref = (raw) => {
  const u = (raw || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return `https://${u}`;
  return '';
};

/** Only http/https iframes are allowed — never javascript:, data:, etc. */
export const safeEmbedSrc = safeHref;

/**
 * A lesson FILE address: this server's own `/uploads/…` or `/api/…`, or an
 * http(s) URL. Anything else — a relative path, a `javascript:` or `data:`
 * URL, a protocol-relative `//host` — is ''. Callers render '' as plain text.
 */
export const safeFileHref = (raw) => {
  const u = (raw || '').trim();
  if (/^\/(uploads|api)\//.test(u)) return u;
  return safeHref(u);
};
