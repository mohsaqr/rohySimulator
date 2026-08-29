import { apiFetch, apiGet, apiPost, ApiError } from '../services/apiClient';
import { resolveRemoteRefs } from './context.js';

/**
 * RPS-1 §7a.1 — the slide library a plugin's EDITOR offers, served by the host.
 *
 * The pathology editor asks an injected `assetService.list()` for its catalog
 * (the standalone app builds one from slides/library.json). On a host the same
 * library travels with the content bundle as `<origin>/catalog.json`, every URL
 * a `remote:` reference; rohy relays it to authors through
 * GET /api/plugins/<id>/catalog and this service hands it to the editor with
 * every reference RESOLVED — the editor's picker cards and thumbnails load
 * `<img src>` directly and know nothing about `remote:`. The adapter's
 * onChange un-resolves on the way back out, so the CASE never stores a
 * host address.
 *
 * `available` stays FALSE even though this service now writes (RPS-1 1.4). It
 * is not a general "can this service do things" flag — in the editor it gates
 * the SCAN/PROCESS panel specifically, and a host has no source to scan and no
 * processing queue of the asset service's kind. Setting it true would render a
 * "Scan source" button that can only ever answer "Scanning requires a
 * configured asset service." The import panel is gated on the presence of
 * `importUrl` instead, which is the capability it actually needs.
 *
 * Every write method below is likewise OPTIONAL from the editor's point of
 * view: the standalone app injects a service without them and simply shows no
 * import panel, no Remove and no calibration form.
 *
 * @param {{ pluginId: string }} options
 */
export function createHostAssetService({ pluginId }) {
    const path = (suffix) => `/plugins/${pluginId}${suffix}`;

    /**
     * The managed library, or an empty list when this plugin ships no server
     * module (404) or the deployment provisioned no library directory (503).
     *
     * Those two are OPERATOR states, not failures an author can act on, so they
     * read as "there is no managed half here". Anything else is re-thrown: a
     * 403 or a 500 means something is wrong that the author should see, and
     * swallowing it would show an empty library and call it normal.
     */
    async function managedPending() {
        try {
            const body = await apiGet(path('/assets'));
            return Array.isArray(body?.assets) ? body.assets : [];
        } catch (err) {
            if (err instanceof ApiError && (err.status === 404 || err.status === 503)) return [];
            throw err;
        }
    }

    return {
        available: false,
        unavailableReason: null,
        async list() {
            try {
                const body = await apiFetch(path('/catalog'));
                const assets = Array.isArray(body?.catalog?.assets) ? body.catalog.assets : [];
                // The catalog carries the bundle plus the READY managed slides.
                // The picker also has to show the ones that are still importing,
                // have failed, or need calibration — an author who pasted a link
                // must be able to see what became of it. Those come from the
                // plugin's own /assets, and only the not-ready ones, so a ready
                // slide is not listed twice.
                const pending = (await managedPending()).filter((a) => a.status !== 'ready');
                return {
                    assets: resolveRemoteRefs([...pending, ...assets], pluginId),
                    serviceAvailable: false,
                };
            } catch (err) {
                // The two "no catalog" cases are operator states, not errors
                // the author can act on — say so instead of throwing, so the
                // picker shows the reason beside its manual-entry form.
                if (err instanceof ApiError && (err.status === 503 || err.status === 404)) {
                    return {
                        assets: [],
                        serviceAvailable: false,
                        unavailableReason: err.status === 503
                            ? 'No content origin is configured for this plugin (ROHY_PLUGIN_ORIGINS).'
                            : 'The content origin ships no slide catalog (catalog.json).',
                    };
                }
                throw err;
            }
        },

        /**
         * Import a slide from a link. Returns as soon as the job is QUEUED —
         * tiling is minutes of work and an editor that awaited it would look
         * hung, so the job id is the handle and `pollJob` is the follow-up.
         *
         * @param {{url: string, label?: string}} spec
         * @returns {Promise<{jobId: string, assetId: string, state: string}>}
         */
        async importUrl({ url, label }) {
            return apiPost(path('/imports'), { url, label });
        },

        /**
         * Follow a job to a terminal state.
         *
         * Returns `{promise, cancel}` because that is the shape the editor
         * already uses for its own jobs — the picker calls
         * `assetService.pollJob(id).promise`, and a different shape here would
         * make the host a special case in a component that should not have one.
         *
         * Polling, not a socket: an import is minutes long and low-frequency,
         * rohy has no socket infrastructure, and a 2s poll on one job is
         * cheaper than the connection that would replace it.
         *
         * @param {string} jobId
         * @param {{intervalMs?: number, onProgress?: function}} [options]
         */
        pollJob(jobId, { intervalMs = 2000, onProgress = null } = {}) {
            let stopped = false;
            const promise = (async () => {
                for (;;) {
                    if (stopped) return { state: 'cancelled' };
                    const status = await apiGet(path(`/jobs/${encodeURIComponent(jobId)}`));
                    if (onProgress) onProgress(status);
                    if (['done', 'failed', 'cancelled'].includes(status?.state)) {
                        // A failed import is an ERROR to the caller, not a
                        // resolved promise carrying a sad object: the editor's
                        // catch is what puts the reason in front of the author.
                        if (status.state === 'failed') {
                            throw new Error(status.error || 'The import failed.');
                        }
                        return status;
                    }
                    await new Promise((resolve) => setTimeout(resolve, intervalMs));
                }
            })();
            return { promise, cancel: () => { stopped = true; } };
        },

        /** Ask the server to stop an import at its next phase boundary. */
        async cancelJob(jobId) {
            return apiPost(path(`/jobs/${encodeURIComponent(jobId)}/cancel`), {});
        },

        /** Remove an imported slide and everything derived from it. */
        async remove(assetId) {
            return apiFetch(path(`/assets/${encodeURIComponent(assetId)}`), { method: 'DELETE' });
        },

        /** Supply the optics a file did not carry, moving it to 'ready'. */
        async calibrate(assetId, { nativeObjective, nativeMpp }) {
            return apiFetch(path(`/assets/${encodeURIComponent(assetId)}/calibration`), {
                method: 'PUT',
                body: JSON.stringify({ nativeObjective, nativeMpp }),
            });
        },
    };
}

export default createHostAssetService;
