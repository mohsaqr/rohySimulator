/**
 * Deterministic identity and safe filenames for imported assets.
 *
 * Ported from `asset_service/pathoyon_assets/security.py`.
 */
import { createHash } from 'node:crypto';

/**
 * A stable, opaque id for an external object.
 *
 * Deterministic on purpose: the same source URL yields the same id, so a
 * re-import lands in the SAME directory rather than accumulating a new copy of
 * a multi-gigabyte slide every time someone retries. It is also what makes an
 * import job idempotent over its own asset directory, which the host requires
 * because an interrupted job is requeued from the start.
 *
 * The NUL separator matters: without it ('a' + 'bc') and ('ab' + 'c') hash the
 * same, and two different sources would collide onto one directory.
 *
 * @param {string} connectorId  e.g. 'import'
 * @param {string} externalId   e.g. the source URL
 * @returns {string} `asset-<24 hex>`
 */
export function stableAssetId(connectorId, externalId) {
    const digest = createHash('sha256').update(`${connectorId}\0${externalId}`, 'utf8').digest('hex');
    return `asset-${digest.slice(0, 24)}`;
}

/**
 * A filename safe to hand to libvips and to a filesystem.
 *
 * libvips parses `name[option=value]` as a load option string, so a slide
 * actually called `scan[1].svs` would be read as `scan` with a bogus option.
 * The Python service refused such names; here the name is ours to choose, so it
 * is sanitised instead of refused — an author should not have to rename a file
 * on a server they do not control.
 *
 * @param {string} raw          a URL pathname or filename
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeFileName(raw, fallback = 'slide') {
    let base = String(raw ?? '');
    try {
        base = decodeURIComponent(base);
    } catch {
        // A malformed escape is not worth failing an import over; the sanitiser
        // below removes anything dangerous either way.
    }
    base = base.split('/').pop().split('\\').pop().trim();
    // Everything outside this set becomes '_': brackets (libvips options),
    // quotes and spaces (argv is safe, but logs and paths are read by humans),
    // and every path separator and control character.
    const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120);
    return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * The extension a filename claims, lowercase and without the dot.
 *
 * Used only to check a name against the accepted-formats ALLOW set. What the
 * file actually is comes from libvips reading it — Cytomine's rule, and the
 * reason `acceptedFormats` is described as an allow set rather than a detector.
 *
 * @param {string} name
 * @returns {string} '' when there is no extension
 */
export function extensionOf(name) {
    const at = String(name ?? '').lastIndexOf('.');
    return at > 0 ? String(name).slice(at + 1).toLowerCase() : '';
}
