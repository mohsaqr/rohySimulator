/**
 * Pathoyon's server module (RPS-1 §11b).
 *
 * Mounted by the host at `/api/plugins/pathology/`. It declares its own routes
 * and its own job handlers, and it imports NOTHING from a host — every
 * capability arrives as `ctx`. That is what lets the same file be vendored into
 * rohy byte-identically, the way `src/` already is.
 *
 * The routes are deliberately the plugin's rather than the host's. An earlier
 * sketch put `POST /api/plugins/:id/imports` in rohy's own router, which works
 * and quietly re-centralises the thing RPS-1 exists to decentralise: the host
 * would then know what an "import" is, what a slide is, and which states a
 * slide can be in. The host knows about jobs and assets; only this file knows
 * that a job is a slide being tiled.
 */
import { importSlide, ImportRefused } from './importSlide.js';
import { stableAssetId } from './identity.js';

/** Assets a learner may never see. `importing` and `failed` are half-written or
 *  broken; `needs_calibration` is real but unmeasurable, so it stays out of the
 *  library until an author supplies the optics. */
const LISTABLE_STATES = ['ready', 'needs_calibration', 'importing', 'failed'];

export default {
    jobs: {
        /**
         * Import one slide from a link. Registered by the host as
         * `pathology:import_slide`.
         */
        async import_slide(job, api, ctx) {
            try {
                const record = await importSlide(job, api, ctx);
                await ctx.db.run(
                    `UPDATE plugin_assets
                        SET state = ?, source_sha256 = ?, source_bytes = ?,
                            native_objective = ?, native_mpp_x = ?, native_mpp_y = ?,
                            tiled_objective = ?, width = ?, height = ?, disk_bytes = ?,
                            error = NULL, updated_at = ?
                      WHERE id = ? AND plugin_id = 'pathology'`,
                    [record.state, record.sourceSha256, record.sourceBytes,
                        record.nativeObjective, record.nativeMppX, record.nativeMppY,
                        record.tiledObjective, record.width, record.height, record.diskBytes,
                        ctx.now(), record.assetId]
                );
                return record;
            } catch (err) {
                // The asset carries the reason, not just the job: a job row is
                // swept by retention and the card in the library has to keep
                // saying why it is broken long after that.
                await ctx.db.run(
                    `UPDATE plugin_assets SET state = 'failed', error = ?, updated_at = ?
                      WHERE id = ? AND plugin_id = 'pathology'`,
                    [String(err?.message ?? err).slice(0, 1000), ctx.now(), job.asset_id]
                );
                throw err;
            }
        },
    },

    /**
     * @param {import('express').Router} router mounted at /api/plugins/pathology
     * @param {object} ctx the RPS-1 server context
     */
    routes(router, ctx) {
        const { guards, helpers } = ctx;

        /** Import a slide from a link. */
        router.post('/imports', guards.authenticated, guards.educator, async (req, res) => {
            const tenant = helpers.tenantId(req);
            const settings = await ctx.settings(tenant);
            if (settings['imports.enabled'] !== true) {
                return res.status(403).json({
                    error: 'Slide imports are disabled for this tenant.',
                    code: 'plugin_imports_disabled',
                });
            }
            if (!ctx.libraryDir) {
                return res.status(503).json({
                    error: 'This deployment has no slide library directory configured.',
                    code: 'plugin_import_no_library',
                });
            }
            const url = String(req.body?.url ?? '').trim();
            const label = String(req.body?.label ?? '').trim().slice(0, 200);
            if (!url) {
                return res.status(400).json({ error: 'A source URL is required.', code: 'plugin_import_no_url' });
            }
            // The origin is checked HERE as well as at download time, so an
            // author gets an immediate, specific refusal rather than a job that
            // queues, runs and fails a minute later for a reason only the log
            // knows.
            const allowed = settings['imports.allowedOrigins'] ?? [];
            let origin;
            try {
                origin = new URL(url).origin;
            } catch {
                return res.status(400).json({ error: 'That is not a valid URL.', code: 'plugin_import_bad_url' });
            }
            if (!allowed.includes(origin)) {
                return res.status(403).json({
                    error: allowed.length === 0
                        ? 'No import origins are allowed here yet. An administrator adds them in Settings → Plugins.'
                        : `'${origin}' is not an allowed import origin.`,
                    code: 'plugin_import_forbidden_origin',
                });
            }

            const assetId = stableAssetId('import', url);
            // Deterministic id ⇒ re-importing the same URL updates the same row
            // rather than accumulating duplicates of a multi-gigabyte slide.
            await ctx.db.run(
                `INSERT INTO plugin_assets (id, tenant_id, plugin_id, label, state, source_url, created_by, created_at, updated_at)
                 VALUES (?, ?, 'pathology', ?, 'importing', ?, ?, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET
                     state = 'importing', label = excluded.label, error = NULL,
                     updated_at = excluded.updated_at`,
                [assetId, tenant, label || url.split('/').pop(), url, req.user?.id ?? null, ctx.now(), ctx.now()]
            );
            const jobId = await ctx.enqueue({
                tenantId: tenant, kind: 'import_slide', payload: { url, label },
                assetId, userId: req.user?.id ?? null,
            });
            helpers.auditSuccess(req, {
                action: 'plugin_asset_import',
                resourceType: 'plugin_asset',
                resourceId: assetId,
                metadata: { origin, jobId },
            });
            return res.status(202).json({ jobId, assetId, state: 'importing' });
        });

        /** Where an import has got to. Polled by the editor every 2s. */
        router.get('/jobs/:jobId', guards.authenticated, guards.educator, async (req, res) => {
            const row = await ctx.db.get(
                `SELECT id, state, phase, progress, error, asset_id, created_at, finished_at
                   FROM plugin_jobs
                  WHERE id = ? AND tenant_id = ? AND plugin_id = 'pathology'`,
                [req.params.jobId, helpers.tenantId(req)]
            );
            if (!row) return res.status(404).json({ error: 'No such import job.', code: 'plugin_job_unknown' });
            return res.json(row);
        });

        router.post('/jobs/:jobId/cancel', guards.authenticated, guards.educator, async (req, res) => {
            const ok = await ctx.cancel(req.params.jobId, helpers.tenantId(req));
            if (!ok) {
                return res.status(404).json({ error: 'No such running import job.', code: 'plugin_job_unknown' });
            }
            helpers.auditSuccess(req, {
                action: 'plugin_asset_import_cancel', resourceType: 'plugin_job', resourceId: req.params.jobId,
            });
            return res.json({ jobId: req.params.jobId, cancelling: true });
        });

        /** The managed half of the library. The bundled half comes from the
         *  content origin's catalog.json; the host merges them (§7a.1). */
        router.get('/assets', guards.authenticated, guards.educator, async (req, res) => {
            const rows = await ctx.db.all(
                `SELECT id, label, state, source_url, native_objective, native_mpp_x, native_mpp_y,
                        tiled_objective, width, height, disk_bytes, error, created_at
                   FROM plugin_assets
                  WHERE plugin_id = 'pathology' AND tenant_id = ? AND state IN (${LISTABLE_STATES.map(() => '?').join(',')})
                  ORDER BY created_at DESC`,
                [helpers.tenantId(req), ...LISTABLE_STATES]
            );
            return res.json({
                version: 1,
                assets: rows.map((row) => ({
                    id: row.id,
                    label: row.label,
                    status: row.state,
                    managed: true,
                    error: row.error ?? undefined,
                    // `remote:` for the same reason a bundled slide is: the case
                    // stores a reference, never a host address.
                    preview: { url: `remote:library/${row.id}/preview.jpg` },
                    currentRevisionId: 'managed',
                    revisions: [{
                        id: 'managed',
                        status: row.state,
                        derivatives: { dzi: { url: `remote:library/${row.id}/slide.dzi` } },
                        optics: {
                            nativeObjective: row.native_objective,
                            nativeMpp: row.native_mpp_x,
                            tiledObjective: row.tiled_objective,
                        },
                        widthPx: row.width,
                        heightPx: row.height,
                    }],
                })),
            });
        });

        /**
         * Remove an imported slide and everything derived from it.
         *
         * Only a MANAGED asset: a bundled slide belongs to the content bundle
         * and is removed by redeploying it, not by an author clicking a button.
         * The row goes first and the bytes second — a row with no directory is
         * a slide that vanished, which is recoverable by re-importing; a
         * directory with no row is invisible disk nobody can find or reclaim.
         */
        router.delete('/assets/:assetId', guards.authenticated, guards.educator, async (req, res) => {
            const tenant = helpers.tenantId(req);
            const assetId = String(req.params.assetId);
            const row = await ctx.db.get(
                `SELECT id FROM plugin_assets WHERE id = ? AND tenant_id = ? AND plugin_id = 'pathology'`,
                [assetId, tenant]
            );
            if (!row) return res.status(404).json({ error: 'No such imported slide.', code: 'plugin_asset_unknown' });
            await ctx.db.run(
                `DELETE FROM plugin_assets WHERE id = ? AND tenant_id = ? AND plugin_id = 'pathology'`,
                [assetId, tenant]
            );
            try {
                await ctx.removeAssetDirectory(assetId);
            } catch (err) {
                // The row is already gone, so the slide is gone from every
                // surface an author sees. Failing the request now would say
                // "removal failed" about something that succeeded.
                ctx.log.warn('asset row removed but its directory could not be', { assetId, error: err.message });
            }
            helpers.auditSuccess(req, {
                action: 'plugin_asset_remove', resourceType: 'plugin_asset', resourceId: assetId,
            });
            return res.json({ assetId, removed: true });
        });

        /** Supply the optics a file did not carry, moving it to 'ready'. */
        router.put('/assets/:assetId/calibration', guards.authenticated, guards.educator, async (req, res) => {
            const objective = Number(req.body?.nativeObjective);
            const mpp = Number(req.body?.nativeMpp);
            // Refused rather than coerced. This is the number every measurement
            // a reader makes is scaled by; a silently-defaulted 40x/0.25 is the
            // exact failure `needs_calibration` exists to prevent.
            if (!Number.isFinite(objective) || objective <= 0 || !Number.isFinite(mpp) || mpp <= 0) {
                return res.status(400).json({
                    error: 'Both nativeObjective and nativeMpp must be positive numbers.',
                    code: 'plugin_calibration_invalid',
                });
            }
            const result = await ctx.db.run(
                `UPDATE plugin_assets
                    SET native_objective = ?, native_mpp_x = ?, native_mpp_y = ?,
                        state = 'ready', updated_at = ?
                  WHERE id = ? AND tenant_id = ? AND plugin_id = 'pathology'
                    AND state = 'needs_calibration'`,
                [objective, mpp, mpp, ctx.now(), req.params.assetId, helpers.tenantId(req)]
            );
            if ((result?.changes ?? 0) === 0) {
                return res.status(404).json({ error: 'No such uncalibrated slide.', code: 'plugin_asset_unknown' });
            }
            helpers.auditSuccess(req, {
                action: 'plugin_asset_calibrate', resourceType: 'plugin_asset', resourceId: req.params.assetId,
                metadata: { objective, mpp },
            });
            return res.json({ assetId: req.params.assetId, state: 'ready' });
        });
    },
};

export { ImportRefused };
