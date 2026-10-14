// A learner's work inside a plugin room, kept on the server (0069).
//
// Plugin rooms persist the learner's OWN work — a pathology report, the
// annotations on a slide, a PACS measurement — through the host's `ctx.store`
// (src/plugins/context.js). That store used to be localStorage only, so a
// submitted report existed on one device, a second tab of the same session
// silently overwrote the first, and the educator reviewing the session never
// saw it. These routes are the server half of that store:
//
//   GET  /sessions/:sessionId/plugin-state/:pluginId/:name   owner or staff
//   PUT  /sessions/:sessionId/plugin-state/:pluginId/:name   owner only
//   GET  /sessions/:sessionId/plugin-state                   educator: every document
//
// The document is opaque JSON owned by the plugin; the host stores it as a
// unit and never merges inside it. Concurrency is optimistic: a write names the
// revision it was based on (`expectedRevision`, 0 for "there was none") and is
// refused with 409 + the current server copy when anyone wrote since. The
// client re-reads and tells the learner — a second tab can no longer erase the
// first tab's work without anyone noticing.
//
// Writes after the session ended are ALLOWED, deliberately: nothing in rohy
// freezes a learner's room work at end (the plugin locks a submitted report
// itself), and refusing the write-behind of an edit made seconds before End
// would lose it. What the server enforces is ownership: only the session's own
// learner writes; staff read.
//
// Auditing: the store writes on every debounced edit, so an audit row per save
// would bury the chain in keystrokes. A row is written when the document is
// first created and whenever its count of submitted reports grows — the two
// moments that are educationally meaningful (work began; a report was handed
// in). `reports[].status === 'submitted'` is the plugin-side report shape the
// pathology, PACS and ECG rooms share; a plugin without reports is audited
// once, at creation.

import express from 'express';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, requireEducator } from '../middleware/auth.js';
import { tenantId, auditSuccess, verifySessionOwnership } from './_helpers.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { logger } from '../logger.js';
import { parseDocument, submittedReportCount } from '../services/pluginSessionDocuments.js';

const router = express.Router();
const log = logger('routes-plugin-session-state');

/**
 * The cap on one stored document, serialised. Under express's 256 KB JSON body
 * limit (server.js) with room for the `{document, expectedRevision}` wrapper,
 * so an oversized document gets this route's coded 413 rather than the body
 * parser's uncoded one.
 */
export const PLUGIN_STATE_MAX_BYTES = 192 * 1024;

/** A store key: short, safe, never a path. */
export const PLUGIN_STATE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const PERSISTING_PLUGINS = new Set(
    PLUGIN_MANIFESTS.filter((m) => (m.capabilities ?? []).includes('persist')).map((m) => m.id)
);

function badRequest(res, code, error) {
    return res.status(400).json({ error, code });
}

/** Shared parameter checks; answers the request itself when they fail. */
function checkParams(req, res) {
    const { pluginId, name } = req.params;
    if (!PERSISTING_PLUGINS.has(pluginId)) {
        res.status(404).json({ error: `No plugin "${pluginId}" keeps session state here.`, code: 'plugin_state_unknown_plugin' });
        return false;
    }
    if (!PLUGIN_STATE_NAME.test(name)) {
        badRequest(res, 'plugin_state_bad_name', 'A state name is a letter followed by up to 31 letters, digits, "_" or "-".');
        return false;
    }
    return true;
}

async function readRow(tenant, sessionId, pluginId, name) {
    return dbAdapter.get(
        `SELECT document, revision, updated_at FROM plugin_session_documents
          WHERE tenant_id = ? AND session_id = ? AND plugin_id = ? AND name = ?`,
        [tenant, sessionId, pluginId, name]
    );
}

router.get('/sessions/:sessionId/plugin-state/:pluginId/:name', authenticateToken, async (req, res) => {
    try {
        if (!checkParams(req, res)) return;
        if (!await verifySessionOwnership(req.params.sessionId, req.user, res, { requireSession: true })) return;
        const row = await readRow(tenantId(req), req.params.sessionId, req.params.pluginId, req.params.name);
        if (!row) return res.json({ document: null, revision: 0, updatedAt: null });
        return res.json({ document: parseDocument(row.document), revision: row.revision, updatedAt: row.updated_at });
    } catch (err) {
        (req.log || log).error('plugin state read failed', { error: err.message });
        return res.status(500).json({ error: 'Could not read the saved room state.', code: 'plugin_state_read_failed' });
    }
});

router.put('/sessions/:sessionId/plugin-state/:pluginId/:name', authenticateToken, async (req, res) => {
    try {
        if (!checkParams(req, res)) return;
        const { sessionId, pluginId, name } = req.params;
        const { document, expectedRevision } = req.body ?? {};
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
            return badRequest(res, 'plugin_state_bad_revision', 'expectedRevision must be a non-negative integer (0 when nothing was saved yet).');
        }
        if (document === null || typeof document !== 'object' || Array.isArray(document)) {
            return badRequest(res, 'plugin_state_bad_document', 'document must be a JSON object.');
        }
        const serialised = JSON.stringify(document);
        if (Buffer.byteLength(serialised, 'utf8') > PLUGIN_STATE_MAX_BYTES) {
            return res.status(413).json({
                error: `The room state is over the ${PLUGIN_STATE_MAX_BYTES / 1024} KB a session may store.`,
                code: 'plugin_state_too_large',
            });
        }

        if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;
        const tenant = tenantId(req);
        const session = await dbAdapter.get(
            'SELECT id, user_id FROM sessions WHERE id = ? AND tenant_id = ?',
            [sessionId, tenant]
        );
        if (!session) return res.status(404).json({ error: 'Session not found', code: 'plugin_state_no_session' });
        // Staff may READ a learner's room work; writing it would put words in
        // the learner's report. Only the session's own learner writes.
        if (session.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Only the learner whose session this is can save its room work.', code: 'plugin_state_read_only' });
        }

        // Compare-and-swap on a connection of its own (dbAdapter.isolatedTransaction):
        // the read of the current revision and the write that depends on it
        // must not interleave with another tab's write.
        const outcome = await dbAdapter.isolatedTransaction(async (tx) => {
            const current = await tx.get(
                `SELECT id, document, revision, updated_at FROM plugin_session_documents
                  WHERE tenant_id = ? AND session_id = ? AND plugin_id = ? AND name = ?`,
                [tenant, sessionId, pluginId, name]
            );
            const currentRevision = current?.revision ?? 0;
            if (currentRevision !== expectedRevision) {
                return { conflict: true, current };
            }
            const now = new Date().toISOString();
            if (!current) {
                await tx.run(
                    `INSERT INTO plugin_session_documents
                        (tenant_id, session_id, user_id, plugin_id, name, document, revision, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                    [tenant, sessionId, session.user_id, pluginId, name, serialised, now, now]
                );
                return { revision: 1, updatedAt: now, created: true, previousSubmitted: 0 };
            }
            const result = await tx.run(
                `UPDATE plugin_session_documents SET document = ?, revision = revision + 1, updated_at = ?
                  WHERE id = ? AND revision = ?`,
                [serialised, now, current.id, expectedRevision]
            );
            if (result.changes !== 1) return { conflict: true, current };
            return {
                revision: expectedRevision + 1,
                updatedAt: now,
                created: false,
                previousSubmitted: submittedReportCount(parseDocument(current.document)),
            };
        });

        if (outcome.conflict) {
            (req.log || log).info('plugin state conflict', { session_id: sessionId, plugin_id: pluginId, name, expected: expectedRevision, current: outcome.current?.revision ?? 0 });
            return res.status(409).json({
                error: 'This room was saved from another tab or device since you loaded it.',
                code: 'plugin_state_conflict',
                document: outcome.current ? parseDocument(outcome.current.document) : null,
                revision: outcome.current?.revision ?? 0,
                updatedAt: outcome.current?.updated_at ?? null,
            });
        }

        const submitted = submittedReportCount(document);
        if (outcome.created || submitted > outcome.previousSubmitted) {
            auditSuccess(req, {
                action: submitted > outcome.previousSubmitted ? 'plugin_report_submitted' : 'plugin_state_created',
                resourceType: 'session',
                resourceId: String(sessionId),
                metadata: { pluginId, name, revision: outcome.revision, submittedReports: submitted },
            });
        }
        return res.json({ revision: outcome.revision, updatedAt: outcome.updatedAt });
    } catch (err) {
        (req.log || log).error('plugin state write failed', { error: err.message });
        return res.status(500).json({ error: 'Could not save the room state.', code: 'plugin_state_write_failed' });
    }
});

// The educator's view: every plugin document of one session, for review.
// Tenant-scoped; a session in another tenant is "not found".
router.get('/sessions/:sessionId/plugin-state', authenticateToken, requireEducator, async (req, res) => {
    try {
        const tenant = tenantId(req);
        const session = await dbAdapter.get(
            'SELECT id FROM sessions WHERE id = ? AND tenant_id = ?',
            [req.params.sessionId, tenant]
        );
        if (!session) return res.status(404).json({ error: 'Session not found', code: 'plugin_state_no_session' });
        const rows = await dbAdapter.all(
            `SELECT plugin_id, name, document, revision, user_id, updated_at FROM plugin_session_documents
              WHERE tenant_id = ? AND session_id = ? ORDER BY plugin_id, name`,
            [tenant, req.params.sessionId]
        );
        return res.json({
            documents: rows.map((row) => ({
                pluginId: row.plugin_id,
                name: row.name,
                document: parseDocument(row.document),
                revision: row.revision,
                userId: row.user_id,
                updatedAt: row.updated_at,
            })),
        });
    } catch (err) {
        (req.log || log).error('plugin state list failed', { error: err.message });
        return res.status(500).json({ error: 'Could not read the session\'s room work.', code: 'plugin_state_read_failed' });
    }
});

export default router;
