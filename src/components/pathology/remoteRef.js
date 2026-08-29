/**
 * References to content a case points at rather than carries.
 *
 * A case has two ways to hold a picture, and the choice is not cosmetic:
 *
 *   EMBEDDED  `data:image/jpeg;base64,…` — the bytes travel inside the case.
 *             Self-contained, works offline, survives being emailed. Also
 *             enormous: one 438x320 photograph puts a case document at 34 KB
 *             and two put it at 83 KB, which is past what a host will store.
 *   REFERENCED `remote:gross/case42/a.jpg` — the case names the picture and a
 *             host resolves the name. The document stays about 1 KB no matter
 *             how many photographs it has.
 *
 * WHY A SCHEME AND NOT A URL. A case that said `https://slides.example.edu/…`
 * would pin one deployment's infrastructure into content meant to move between
 * them, and would put the choice of host in reach of whoever can edit a case.
 * A `remote:` reference names a PATH; the host decides which origin serves it.
 * That is the same split the slide pyramids already use.
 *
 * NOTHING HERE KNOWS HOW A HOST RESOLVES ONE. `resolveRef` is a function the
 * host supplies; the default is identity, so a plain path or a data: URL is
 * unchanged and a package with no host still works. Putting a `/api/...` prefix
 * in this file would make `src/` depend on one particular host, which is the
 * thing `tests/portability.test.js` exists to prevent.
 */

/** The scheme a case uses for content it points at rather than carries. */
export const REMOTE_SCHEME = 'remote:';

/** Is this a reference the host has to resolve before anything can load it? */
export function isRemoteRef(uri) {
    return typeof uri === 'string' && uri.startsWith(REMOTE_SCHEME);
}

/**
 * The path inside a reference, with no leading slash.
 *
 * `remote:gross/a.jpg` and `remote:/gross/a.jpg` are the same reference; the
 * spelling difference is the sort of thing a host would otherwise turn into
 * `//gross/a.jpg` and a 404 nobody can explain.
 *
 * @param {string} uri
 * @returns {string} '' when this is not a reference
 */
export function remoteRefPath(uri) {
    if (!isRemoteRef(uri)) return '';
    return uri.slice(REMOTE_SCHEME.length).replace(/^\/+/, '');
}

/**
 * Build a reference from something an author typed.
 *
 * Accepts what people actually write — `gross/a.jpg`, `/gross/a.jpg`, or an
 * already-complete `remote:gross/a.jpg` — and returns one spelling.
 *
 * @param {string} path
 * @returns {string}
 * @throws {TypeError} on an empty path, or one that escapes its prefix
 */
export function toRemoteRef(path) {
    if (typeof path !== 'string' || path.trim() === '') {
        throw new TypeError('toRemoteRef(): a reference needs a path, such as "gross/case42/a.jpg".');
    }
    const bare = (isRemoteRef(path) ? remoteRefPath(path) : path.trim()).replace(/^\/+/, '');
    if (bare === '') {
        throw new TypeError('toRemoteRef(): a reference needs a path, such as "gross/case42/a.jpg".');
    }
    // Traversal is refused HERE rather than at the host, because a reference
    // that escapes its prefix is a case the author cannot fix later without
    // understanding a 403 from someone else's proxy.
    if (bare.split('/').some((segment) => segment === '..' || segment === '.')) {
        throw new TypeError(`toRemoteRef(): "${path}" must not contain "." or ".." segments.`);
    }
    return `${REMOTE_SCHEME}${bare}`;
}

/**
 * Turn whatever a case holds into something a browser can load.
 *
 * The default resolver is identity, which is correct for a plain path, an
 * http(s) URL and a `data:` URL alike. A host that mounts referenced content
 * supplies its own and this is never used.
 *
 * @param {string} uri
 * @param {(uri: string) => string} [resolveRef]
 * @returns {string} '' when there is nothing loadable, so callers can test it
 */
export function loadableSource(uri, resolveRef) {
    if (typeof uri !== 'string' || uri === '') return '';
    if (typeof resolveRef === 'function') {
        const resolved = resolveRef(uri);
        return typeof resolved === 'string' ? resolved : '';
    }
    // No resolver and a reference we cannot resolve ourselves: say so by
    // returning nothing, rather than handing an <img> a `remote:` src it will
    // fail on with a console error the author cannot act on.
    return isRemoteRef(uri) ? '' : uri;
}
