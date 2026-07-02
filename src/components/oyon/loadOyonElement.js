// Single source of truth for loading Oyon's <oyon-app> custom element.
//
// The element is a ~5 MB prebuilt ES module served out of the vendored OyonR
// tree (server.js mounts OyonR/ at /oyon; the Vite dev server proxies /oyon
// to the backend). Every consumer loads it through here so:
//   1. the cache-bust version lives in ONE place (bump it whenever
//      scripts/update-oyonr.sh re-syncs a new element build),
//   2. the <script> is injected at most ONCE per document,
//   3. callers get a promise that RESOLVES when the custom element is
//      actually defined and REJECTS on load error or timeout — a dead
//      element is a visible failure, never a silently-empty pill.

export const OYON_ELEMENT_SRC = '/oyon/standalone/app/dist-element/oyon-app.element.js?v=2';

const SCRIPT_MARKER = 'data-oyon-element';
const LOAD_TIMEOUT_MS = 30000; // generous for a 5 MB module on a slow link

// One shared promise per document — all callers await the same load.
let loadPromise = null;

/**
 * Inject the <oyon-app> module script once and resolve when the custom
 * element is defined. Idempotent: every caller awaits the same load. A
 * failed load clears the cached promise so the next call can retry.
 * @returns {Promise<void>}
 */
export function loadOyonElement() {
    if (typeof document === 'undefined') return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        const whenDefined = () =>
            customElements.whenDefined('oyon-app').then(resolve).catch(reject);

        const existing = document.querySelector(`script[${SCRIPT_MARKER}]`);
        if (existing) {
            whenDefined();
        } else {
            const s = document.createElement('script');
            s.type = 'module';
            s.src = OYON_ELEMENT_SRC;
            s.setAttribute(SCRIPT_MARKER, '1');
            s.addEventListener('error', () =>
                reject(new Error(`Failed to load Oyon element from ${OYON_ELEMENT_SRC}`)));
            s.addEventListener('load', whenDefined);
            document.head.appendChild(s);
        }

        // Backstop: a module script can be served (no error event) yet never
        // define the element (version skew, internal throw). Don't wait forever.
        setTimeout(
            () => reject(new Error('Oyon element did not define within timeout')),
            LOAD_TIMEOUT_MS,
        );
    });

    // Let a failed load be retried on the next call rather than caching the reject.
    loadPromise.catch(() => { loadPromise = null; });
    return loadPromise;
}
