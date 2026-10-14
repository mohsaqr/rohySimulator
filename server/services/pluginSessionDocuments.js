// Reading a plugin's stored session documents (plugin_session_documents, 0069)
// without understanding the plugin.
//
// The host treats each document as opaque JSON, with ONE shared convention it
// relies on: a plugin that collects reports keeps them as `reports[]`, each with
// `status` ('draft' | 'submitted'), `title`, `body` and `submittedAtMs` — the
// shape pathoyon's report.js writes. The write route audits a submission by it
// (plugin-session-state-routes.js) and the educator's per-session export lists
// submitted reports by it (analytics-routes.js). A plugin without reports simply
// contributes none.

import dbAdapter from '../dbAdapter.js';

/** A stored document's JSON, or null when the text is not JSON. */
export function parseDocument(text) {
    try { return JSON.parse(text); } catch { return null; }
}

/** How many reports in a plugin document are submitted. */
export function submittedReportCount(document) {
    const reports = document && typeof document === 'object' ? document.reports : null;
    return Array.isArray(reports) ? reports.filter((r) => r && r.status === 'submitted').length : 0;
}

/**
 * Submitted reports across one session's plugin documents, flattened — one row
 * per report.
 *
 * @param {number} tenant
 * @param {number|string} sessionId
 * @returns {Promise<Array<{plugin_id:string,title:string,body:string,submitted_at:string|null}>>}
 */
export async function submittedPluginReports(tenant, sessionId) {
    const rows = await dbAdapter.all(
        `SELECT plugin_id, document FROM plugin_session_documents
          WHERE tenant_id = ? AND session_id = ? ORDER BY plugin_id, name`,
        [tenant, sessionId]
    );
    return rows.flatMap((row) => {
        const doc = parseDocument(row.document);
        const reports = Array.isArray(doc?.reports) ? doc.reports : [];
        return reports
            .filter((r) => r && r.status === 'submitted')
            .map((r) => ({
                plugin_id: row.plugin_id,
                title: typeof r.title === 'string' ? r.title : '',
                body: typeof r.body === 'string' ? r.body : '',
                submitted_at: Number.isFinite(r.submittedAtMs) ? new Date(r.submittedAtMs).toISOString() : null,
            }));
    });
}
