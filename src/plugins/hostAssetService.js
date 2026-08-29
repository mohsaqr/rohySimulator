import { apiFetch, ApiError } from '../services/apiClient';
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
 * Read-only by design: `available: false` tells the editor not to offer
 * scan/process (those belong to the asset service, not to a host), and
 * `addManualDzi` is absent so the editor falls back to its own manual entry.
 *
 * @param {{ pluginId: string }} options
 */
export function createHostAssetService({ pluginId }) {
    return {
        available: false,
        unavailableReason: null,
        async list() {
            try {
                const body = await apiFetch(`/plugins/${pluginId}/catalog`);
                const assets = Array.isArray(body?.catalog?.assets) ? body.catalog.assets : [];
                return { assets: resolveRemoteRefs(assets, pluginId), serviceAvailable: false };
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
    };
}

export default createHostAssetService;
