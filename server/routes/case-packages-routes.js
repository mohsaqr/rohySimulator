// Case packages (services/casePackage.js): export a whole case — document and
// media — as one `.rohycase` file, and import one as a new case.
//
// OFF by default. Until an admin turns `case_packages_enabled` on, every route
// here but the setting itself answers 403 `case_packages_disabled`, so an
// install that never opts in behaves exactly as before.
//
// Admin only, like the case Export/Import buttons: a package carries the
// answer key, and an import writes into the public uploads directory and the
// slide library.
//
// Packages can run to gigabytes, so nothing here holds one in a request:
//   - export is a job; the finished file is streamed by a separate GET;
//   - import arrives in CHUNK_BYTES pieces (each an ordinary short request —
//     under the route timeout and under a proxy's per-request body cap, such
//     as Cloudflare's), then runs as a job.

import express from 'express';
import fs from 'fs';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { auditSuccess } from './_helpers.js';
import {
    CHUNK_BYTES,
    PACKAGE_EXTENSION,
    PackageError,
    appendChunk,
    cancelUpload,
    casePackagesEnabled,
    completeUpload,
    createUpload,
    getJob,
    maxPackageBytes,
    startExport,
} from '../services/casePackage.js';

const router = express.Router();

/** What a job needs of the request once the request is gone. */
const actorOf = (req) => ({
    user: req.user,
    ip: req.ip || req.connection?.remoteAddress,
    headers: { 'user-agent': req.headers['user-agent'] },
    log: req.log,
});

function sendError(req, res, err) {
    if (err instanceof PackageError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
    }
    req.log.error('case package request failed', { error: err.message });
    return res.status(500).json({ error: 'The case package request failed' });
}

async function requireEnabled(req, res, next) {
    try {
        if (await casePackagesEnabled()) return next();
        return res.status(403).json({ error: 'Case packages are turned off on this server', code: 'case_packages_disabled' });
    } catch (err) {
        return sendError(req, res, err);
    }
}

const settingsView = async () => ({
    enabled: await casePackagesEnabled(),
    max_bytes: maxPackageBytes(),
    chunk_bytes: CHUNK_BYTES,
});

router.get('/platform-settings/case-packages', authenticateToken, requireAdmin, async (req, res) => {
    try {
        res.json(await settingsView());
    } catch (err) {
        sendError(req, res, err);
    }
});

router.put('/platform-settings/case-packages', authenticateToken, requireAdmin, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be true or false', code: 'invalid_setting' });
    }
    try {
        const before = await casePackagesEnabled();
        await dbAdapter.run(
            `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
             VALUES ('case_packages_enabled', ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(setting_key) DO UPDATE SET
                 setting_value = excluded.setting_value,
                 updated_by = excluded.updated_by,
                 updated_at = CURRENT_TIMESTAMP`,
            [req.body.enabled ? 'true' : 'false', req.user.id]
        );
        auditSuccess(req, {
            action: 'update_case_packages_setting',
            resourceType: 'platform_setting',
            resourceId: 'case_packages_enabled',
            resourceName: 'case_packages_enabled',
            oldValue: { enabled: before },
            newValue: { enabled: req.body.enabled },
        });
        res.json(await settingsView());
    } catch (err) {
        sendError(req, res, err);
    }
});

router.post('/cases/:id/package', authenticateToken, requireAdmin, requireEnabled, async (req, res) => {
    try {
        const exists = await dbAdapter.get(
            'SELECT id FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [req.params.id, req.user.tenant_id || 1]
        );
        if (!exists) return res.status(404).json({ error: 'Case not found' });
        res.status(202).json(await startExport({ caseId: exists.id, actor: actorOf(req) }));
    } catch (err) {
        sendError(req, res, err);
    }
});

router.get('/case-packages/jobs/:id', authenticateToken, requireAdmin, (req, res) => {
    const job = getJob(req.params.id, actorOf(req));
    if (!job) return res.status(404).json({ error: 'No such job', code: 'job_not_found' });
    res.json(job.view);
});

router.get('/case-packages/jobs/:id/download', authenticateToken, requireAdmin, requireEnabled, async (req, res) => {
    const job = getJob(req.params.id, actorOf(req));
    if (!job || job.view.kind !== 'export') return res.status(404).json({ error: 'No such job', code: 'job_not_found' });
    if (!job.file) return res.status(409).json({ error: 'The package is not ready', code: 'job_not_ready' });
    let stat;
    try { stat = await fs.promises.stat(job.file); } catch {
        return res.status(410).json({ error: 'The package has expired; export it again', code: 'job_expired' });
    }
    const slug = String(job.result?.case_code || job.result?.name || 'case').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
    res.setHeader('Content-Type', 'application/x-tar');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="case-${slug}${PACKAGE_EXTENSION}"`);
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(job.file);
    stream.once('error', (err) => {
        req.log.warn('case package download failed', { error: err.message });
        if (!res.headersSent) res.status(500).json({ error: 'The package could not be read' });
        else res.destroy(err);
    });
    stream.pipe(res);
});

router.post('/case-packages/uploads', authenticateToken, requireAdmin, requireEnabled, async (req, res) => {
    try {
        res.status(201).json(await createUpload({ bytes: req.body?.bytes, actor: actorOf(req) }));
    } catch (err) {
        sendError(req, res, err);
    }
});

// One chunk, as raw bytes. Parsed here, not globally: no other route takes a binary body.
const rawChunk = express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES });

router.put('/case-packages/uploads/:id/chunks/:index', authenticateToken, requireAdmin, requireEnabled, rawChunk, async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isSafeInteger(index) || index < 0 || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Send the chunk as application/octet-stream', code: 'invalid_upload' });
    }
    try {
        res.json(await appendChunk({ id: req.params.id, index, data: req.body, actor: actorOf(req) }));
    } catch (err) {
        sendError(req, res, err);
    }
});

router.post('/case-packages/uploads/:id/complete', authenticateToken, requireAdmin, requireEnabled, async (req, res) => {
    try {
        res.status(202).json(await completeUpload({ id: req.params.id, actor: actorOf(req) }));
    } catch (err) {
        sendError(req, res, err);
    }
});

router.delete('/case-packages/uploads/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await cancelUpload({ id: req.params.id, actor: actorOf(req) });
        res.status(204).end();
    } catch (err) {
        sendError(req, res, err);
    }
});

export default router;
