// Which plugin content a user's browser has loaded, as the server saw it.
//
// Plugin content reaches a browser only through rohy's authenticated proxy
// (GET /api/plugins/:pluginId/*, routes/plugins-routes.js), so the proxy knows
// who loaded what without asking the browser. It records the first time it
// serves a user a slide descriptor (`.dzi`): the viewer fetches a slide's
// descriptor when, and only when, the learner opens that slide. Tiles are not
// recorded — there are thousands per slide and they add nothing to "opened".
//
// The course gate (services/courseGate.js) counts these rows for its "every
// slide opened" condition. It used to count OPENED_SLIDE learning events,
// which the learner's own browser posts and so can post for slides it never
// opened.

import dbAdapter from '../dbAdapter.js';

const REMOTE_SCHEME = 'remote:';

/** Is this content path one whose first read is recorded? */
export const isRecordedContentPath = (path) => typeof path === 'string' && /\.dzi$/i.test(path);

/**
 * A content path in the one form both sides compare: segments joined by `/`,
 * no leading slash, not URL-encoded.
 *
 * @param {string[]|string} segments the proxy's path segments, or a path
 * @returns {string}
 */
export function contentPath(segments) {
    const parts = Array.isArray(segments) ? segments : String(segments).split('/');
    return parts.filter(Boolean).join('/');
}

/**
 * The content path a `remote:` reference names, or null for anything else (an
 * absolute address or an embedded image never passes through the proxy).
 *
 * @param {unknown} uri
 * @returns {string|null}
 */
export function remoteContentPath(uri) {
    if (typeof uri !== 'string' || !uri.startsWith(REMOTE_SCHEME)) return null;
    const path = contentPath(uri.slice(REMOTE_SCHEME.length));
    return path || null;
}

/**
 * Record one read. Only the first read of a path is kept.
 *
 * @param {{tenantId: number, userId: number, pluginId: string, path: string}} read
 */
export async function recordContentRead({ tenantId, userId, pluginId, path }) {
    await dbAdapter.run(
        `INSERT INTO plugin_content_reads (tenant_id, user_id, plugin_id, path)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, user_id, plugin_id, path) DO NOTHING`,
        [tenantId, userId, pluginId, path]
    );
}

/**
 * Every content path of one plugin the user's browser has loaded.
 *
 * @param {{tenantId: number, userId: number, pluginId: string}} who
 * @returns {Promise<Set<string>>}
 */
export async function contentReadPaths({ tenantId, userId, pluginId }) {
    const rows = await dbAdapter.all(
        'SELECT path FROM plugin_content_reads WHERE tenant_id = ? AND user_id = ? AND plugin_id = ?',
        [tenantId, userId, pluginId]
    );
    return new Set(rows.map((row) => row.path));
}
