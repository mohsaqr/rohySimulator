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

// Video providers a lecture-video embed may load (host edit, security audit
// 2026-10-26, L5-05). The video iframe needs `allow-same-origin` in its
// sandbox — the YouTube player and the IFrame API watch tracking do not run
// without it — and that is only safe for a CROSS-origin frame. Any other URL
// (this server's own /uploads/x.html above all) would get same-origin script
// access to the lesson page, so it is refused instead.
export const VIDEO_EMBED_HOSTS = Object.freeze([
  'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com',
  'player.vimeo.com',
]);

/** An https video-provider embed URL from VIDEO_EMBED_HOSTS, else ''. */
export const safeVideoEmbedSrc = (raw) => {
  const u = safeHref(raw);
  if (!u) return '';
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return '';
    return VIDEO_EMBED_HOSTS.includes(url.hostname.toLowerCase()) ? u : '';
  } catch {
    return '';
  }
};

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
