import { apiFetch, ApiError } from '../../services/apiClient';
import { resolveRemoteRef } from '../context.js';

/**
 * RPS-1 §7a.1 — the study archive, relayed by the host from the plugin's
 * configured content origin.
 *
 * The pathology editor gets its slide library this way already (v2.9.82); this
 * is the same route, `GET /api/plugins/<id>/catalog`, reading the same
 * `<origin>/catalog.json`. What differs is the SHAPE of what is inside it, and
 * that difference now travels in the manifest (`catalog.collection`) rather
 * than being hardcoded server-side: pathology ships `{assets: […]}`, Radoyon
 * ships `{entries: […]}`, and the host relays whichever its manifest declares.
 *
 * Why the host has to be the one to fetch it: an archive entry is addressed as
 * `remote:dicom/normal/ct_chest/s1/`, and only rohy knows which origin that
 * resolves to. The package deliberately does not — that is what lets the same
 * case run against a university's archive and a laptop's.
 *
 * DEGRADED IS NOT BROKEN. A deployment with no `ROHY_PLUGIN_ORIGINS` entry for
 * this plugin — which is every rohy deployment today — has no archive at all.
 * That must not empty the editor: the rohy study catalogue still lists every
 * orderable study, each one honestly marked "No imaging yet", and the author
 * can still attach a `remote:` reference by hand. So an operator state (503 no
 * origin, 404 the origin ships no catalog) comes back as a REASON beside an
 * empty archive, never as a throw. A 403/500 is different — something is wrong
 * that a human should see — and is reported as such rather than being shown as
 * a normal empty library.
 */

/** The empty archive, in the shape `readArchive()` normalises. */
const EMPTY = { version: 1, name: '', entries: [] };

/**
 * @param {{pluginId: string}} options
 * @returns {Promise<{archive: object, unavailableReason: string|null}>}
 *   `unavailableReason` is a sentence for the author, or null when the archive
 *   arrived (including when it legitimately holds nothing).
 */
export async function fetchArchive({ pluginId }) {
    try {
        const body = await apiFetch(`/plugins/${pluginId}/catalog`);
        const catalog = body?.catalog;
        const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
        return {
            archive: {
                version: Number(catalog?.version) || 1,
                name: typeof catalog?.name === 'string' ? catalog.name : '',
                entries,
            },
            unavailableReason: null,
        };
    } catch (err) {
        return { archive: EMPTY, unavailableReason: reasonFor(err) };
    }
}

/**
 * Turn a failure into a sentence an author can act on — or, when they cannot,
 * one that names who can.
 *
 * The two operator states are separated because the fixes are different and
 * belong to different people: 503 is "nobody has told rohy where the imaging
 * lives", 404 is "the imaging is there but ships no index of itself".
 */
function reasonFor(err) {
    if (!(err instanceof ApiError)) {
        return 'The imaging archive could not be reached.';
    }
    switch (err.status) {
        case 503:
            return 'No imaging origin is configured for this deployment (ROHY_PLUGIN_ORIGINS), so there is no archive of normal studies to start from. You can still attach imaging by reference.';
        case 404:
            return 'The configured imaging origin ships no archive catalogue (catalog.json). You can still attach imaging by reference.';
        case 403:
            return 'Your role may not read the imaging archive.';
        default:
            return `The imaging archive is unavailable (${err.status}).`;
    }
}

/**
 * The archive's preview images, as the `thumbnailFor` the editor takes.
 *
 * The content origin ships `thumbs/index.json` keyed by SERIES REF, which is
 * the whole point of the file: a host maps a series to its preview by LOOKUP
 * rather than by guessing a path convention, so reorganising the thumbnails on
 * disk cannot break every card that shows one.
 *
 * Fetched through the content proxy (`/thumbs` is a declared remote path)
 * rather than through the catalog relay, because it is content — the same
 * addressing the DICOM instances use, and readable by the same roles.
 *
 * Both spellings of a reference are indexed. The editor calls
 * `thumbnailFor(resolveRef(series.ref))`, i.e. with a resolved host address,
 * while the index is written in portable `remote:` form; keying only one of
 * them would silently return null for every card and look exactly like an
 * archive with no thumbnails.
 *
 * @param {{pluginId: string}} options
 * @returns {Promise<(ref: string) => string|null>} always a usable function —
 *   an archive with no thumbnails is normal, not an error.
 */
export async function fetchThumbnails({ pluginId }) {
    let index;
    try {
        index = await apiFetch(`/plugins/${pluginId}/thumbs/index.json`);
    } catch {
        // No origin, no thumbs directory, or an origin that ships none. The
        // editor renders its modality placeholder, which is what it does
        // without this prop at all — so there is nothing to report and nothing
        // an author could do about it.
        return () => null;
    }
    // `{version, thumbs: {ref: previewRef}}` as the origin ships it; a bare
    // map is accepted too, so an older or hand-built index still works.
    const map = (index && typeof index.thumbs === 'object' && index.thumbs) || index;
    if (!map || typeof map !== 'object') return () => null;

    const byRef = new Map();
    Object.entries(map).forEach(([seriesRef, previewRef]) => {
        if (typeof previewRef !== 'string') return;
        const url = resolveRemoteRef(previewRef, pluginId);
        byRef.set(seriesRef, url);
        byRef.set(stripSlash(seriesRef), url);
        byRef.set(resolveRemoteRef(stripSlash(seriesRef), pluginId), url);
    });

    return (ref) => (typeof ref === 'string'
        ? (byRef.get(ref) ?? byRef.get(stripSlash(ref)) ?? null)
        : null);
}

/** resolveRemoteRef() drops empty path segments, so a stored trailing slash and
 *  a resolved address disagree by exactly one character. Normalise both ways. */
function stripSlash(ref) {
    return typeof ref === 'string' ? ref.replace(/\/+$/, '') : ref;
}

export default fetchArchive;
