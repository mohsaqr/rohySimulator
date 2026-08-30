import { resolveRemoteRef } from '../context.js';

/**
 * RPS-1 §7a — how rohy turns a `remote:` series reference into DICOM bytes.
 *
 * This is host code, deliberately outside the vendored package. Radoyon takes
 * `loadSeries` as a PROP precisely so it never learns how any particular host
 * addresses content: rohy relays through an operator-configured origin, the
 * standalone app reads from disk, a test hands over bytes it built in memory.
 * All three satisfy the same one-line contract:
 *
 *     loadSeries(ref, { signal }) -> Promise<Uint8Array[]>
 *
 * A series is a DIRECTORY, and the proxy serves files. So a series carries an
 * `index.json` naming its instances. That indirection buys two things: the
 * viewer knows the instance count before it fetches anything (so it can show
 * progress rather than a frozen pane), and an archive can be reorganised on
 * disk without every case that references it breaking.
 */

const MAX_INSTANCES = 2000;

/** How many instances to fetch at once. */
const CONCURRENCY = 6;

export function createHostSeriesLoader({ pluginId, fetchImpl = fetch }) {
    return async function loadSeries(ref, { signal } = {}) {
        // Resolve FIRST, then append the separator. resolveRemoteRef() splits
        // on '/' and drops empty segments, so it strips a trailing slash — a
        // base built the other way round yields '…/peindex.json' rather than
        // '…/pe/index.json', and every instance 404s.
        const base = `${resolveRemoteRef(stripTrailingSlash(ref), pluginId)}/`;

        const indexResponse = await fetchImpl(`${base}index.json`, { signal, credentials: 'same-origin' });
        if (!indexResponse.ok) {
            // Said plainly, because the learner-facing consequence of a study
            // that will not load is that they are assessed on a finding they
            // were never shown. The room surfaces this rather than rendering
            // an empty viewport.
            throw new Error(
                indexResponse.status === 503
                    ? 'No imaging origin is configured for this deployment (ROHY_PLUGIN_ORIGINS).'
                    : `The imaging archive returned ${indexResponse.status} for ${ref}`,
            );
        }

        const index = await indexResponse.json();
        // TWO INDEX SHAPES, and the loader must read both.
        //
        // v1 lists bare filenames. v2 lists objects — `{name, instanceNumber,
        // position, orientation}` — because the lazy path builds an ordered,
        // measurable stack from the index alone and needs the geometry. The
        // package's own `fromIndex()` already accepts either; this loader did
        // not, so every study served by a v2 archive failed with "contains an
        // invalid instance name: [object Object]" and the reader was shown a
        // study that could not be opened. Measured against the real content
        // origin, not inferred.
        const names = (Array.isArray(index?.instances) ? index.instances : [])
            .map((entry) => (entry && typeof entry === 'object' ? entry.name : entry));
        if (names.length === 0) throw new Error(`The series index for ${ref} lists no instances.`);
        if (names.length > MAX_INSTANCES) {
            throw new Error(`The series at ${ref} lists ${names.length} instances, beyond the ${MAX_INSTANCES} this viewer will load.`);
        }
        // A name is a filename, never a path: the proxy already refuses
        // traversal, but an index that tries it is a broken archive and should
        // be reported as one rather than silently producing 403s per instance.
        const bad = names.find((n) => typeof n !== 'string' || n.includes('/') || n.includes('\\') || n.startsWith('.'));
        if (bad !== undefined) throw new Error(`The series index for ${ref} contains an invalid instance name: ${String(bad)}`);

        return fetchAll(names.map((name) => `${base}${encodeURIComponent(name)}`), { signal, fetchImpl });
    };
}

/**
 * The LAZY half of the same contract: the index alone, then one instance at a
 * time.
 *
 * `useStudy` takes `loadSeriesIndex(ref)` + `loadInstance(ref, name)` and, when
 * both are present, builds the ordered stack from metadata and fetches pixels
 * as the reader reaches them. That is what the case editor's StudyInspector
 * needs — an author glancing at three candidate studies must not pull 263 MB
 * per glance, which is exactly what the bulk loader would do.
 *
 * Built from the same base as `loadSeries` so a series reference is resolved to
 * an address in exactly one place; two spellings of that resolution is how the
 * '…/peindex.json' bug happened the first time.
 *
 * @param {{pluginId: string, fetchImpl?: function}} options
 * @returns {{loadSeriesIndex: function, loadInstance: function}}
 */
export function createHostLazyLoaders({ pluginId, fetchImpl = fetch }) {
    const baseOf = (ref) => `${resolveRemoteRef(stripTrailingSlash(ref), pluginId)}/`;

    return {
        async loadSeriesIndex(ref, { signal } = {}) {
            const response = await fetchImpl(`${baseOf(ref)}index.json`, { signal, credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(
                    response.status === 503
                        ? 'No imaging origin is configured for this deployment (ROHY_PLUGIN_ORIGINS).'
                        : `The imaging archive returned ${response.status} for ${ref}`,
                );
            }
            return response.json();
        },

        async loadInstance(ref, name, { signal } = {}) {
            // The same guard the bulk path applies to every name in an index:
            // a name is a filename, never a path. The proxy would refuse a
            // traversal anyway, but a broken archive should be reported as one
            // rather than as a wall of 403s.
            if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
                throw new Error(`Invalid instance name for ${ref}: ${String(name)}`);
            }
            const response = await fetchImpl(`${baseOf(ref)}${encodeURIComponent(name)}`, { signal, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`Instance ${name} returned ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
        },
    };
}

function stripTrailingSlash(ref) {
    return typeof ref === 'string' ? ref.replace(/\/+$/, '') : ref;
}

/**
 * Fetch every instance, bounded.
 *
 * Firing 300 parallel requests is what makes a browser queue them anyway while
 * exhausting the connection pool the rest of rohy needs; a small pool is both
 * faster in practice and leaves the app responsive. Order is preserved by
 * index, not by completion, so slice ordering is never at the mercy of the
 * network — though the package re-sorts spatially regardless.
 */
async function fetchAll(urls, { signal, fetchImpl }) {
    const out = new Array(urls.length);
    let next = 0;

    const worker = async () => {
        while (next < urls.length) {
            const index = next++;
            const response = await fetchImpl(urls[index], { signal, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`Instance ${index + 1} of ${urls.length} returned ${response.status}`);
            out[index] = new Uint8Array(await response.arrayBuffer());
        }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
    return out;
}

export default createHostSeriesLoader;
