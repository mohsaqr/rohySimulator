/**
 * Host guard for OpenSeadragon viewers built into a host React has already
 * detached.
 *
 * THE DEFECT (vendored pathoyon 0.3.0, 88c4d47 — SlideCanvas.jsx and
 * SpecimenTray.jsx). Both defer `OpenSeadragon({ element: hostRef.current })`
 * by one setTimeout so a StrictMode throwaway mount never builds a viewer, and
 * skip the build when a `disposed` flag is set. That flag is set by the
 * PASSIVE effect cleanup, while React nulls the ref in the commit's mutation
 * phase; for a non-sync update the passive cleanup of a deleted subtree runs
 * in a later task. A timer firing in between reads disposed === false and
 * hostRef.current === null, and OpenSeadragon's constructor throws "Cannot
 * read properties of null (reading 'appendChild')" from a timer — uncaught,
 * so no error boundary sees it (nightly monkey walk, rc.91, pathology room).
 *
 * The real fix is upstream: capture the element when the effect runs and use
 * that, not the ref, inside the timer. src/components/pathology/ is a stamped
 * byte-identical copy (RPS-1 §16) and cannot be edited here, so until it is
 * re-vendored this guard contains the defect at the one seam rohy owns.
 *
 * THE SEAM. The vendored code calls the default export, `OpenSeadragon(o)`,
 * whose body is `return new OpenSeadragon.Viewer(o)` — the constructor is
 * looked up when it is called. Wrapping `OpenSeadragon.Viewer` therefore
 * covers every viewer the package builds without touching it. The wrapper
 * keeps the original prototype, so `instanceof`, `Viewer.prototype.*` and
 * OSD's own `$.Viewer.apply(this, …)` (the Navigator) behave as before.
 *
 * THE OUTCOME. A viewer asked for with no host is built INERT: into a
 * detached element, with no tile source, so nothing is fetched and none of the
 * package's handlers ever fire. The caller still gets a real viewer to attach
 * handlers to and, because its unmount is already committed, destroys it in
 * the cleanup that follows. Nothing is reported: the component asking is
 * gone, and an empty viewer for a room the learner has left is the correct
 * result, not an anomaly.
 */

const GUARDED = Symbol.for('rohy.pathology.viewerHostGuard');

/**
 * The element OpenSeadragon would build into, as it resolves it.
 *
 * @param {object} options
 * @returns {Element|null}
 */
function hostOf(options) {
    if (options.element) return options.element;
    if (typeof options.id === 'string' && options.id !== '') return document.getElementById(options.id);
    return null;
}

/**
 * Wrap `OpenSeadragon.Viewer` so a viewer requested with no host element is
 * built inert instead of throwing. Idempotent: a second call is a no-op.
 *
 * An export without a `Viewer` constructor (a test double that mocks only the
 * factory) is left alone and `null` returned: this runs at module load of the
 * plugin, and refusing there would take the whole plugin registry down with
 * it. That the real bundle still has the seam is pinned against openseadragon
 * itself in viewerGuard.osd.test.js, so an upgrade that moves it fails CI.
 *
 * @param {Function} OpenSeadragon the module's default export
 * @returns {Function|null} the installed (guarded) Viewer constructor, or
 *   null when the export has no Viewer to guard
 */
export function installViewerHostGuard(OpenSeadragon) {
    if (typeof OpenSeadragon?.Viewer !== 'function') return null;
    const Original = OpenSeadragon.Viewer;
    if (Original[GUARDED]) return Original;

    // A plain function, not a class: OSD calls it both with `new` and as
    // `$.Viewer.apply(this, [options])`, and a class cannot be applied.
    function Viewer(options) {
        // Positional (legacy) arguments carry an element id; only the options
        // object the package uses can be inspected and made inert.
        const isOptionsObject = options !== null && typeof options === 'object' && !Array.isArray(options);
        const args = isOptionsObject && !hostOf(options)
            ? [{ ...options, id: undefined, element: document.createElement('div'), tileSources: undefined }]
            : Array.from(arguments);
        return Original.apply(this, args);
    }
    Viewer.prototype = Original.prototype;
    Object.assign(Viewer, Original);
    Object.defineProperty(Viewer, GUARDED, { value: true });

    OpenSeadragon.Viewer = Viewer;
    return Viewer;
}
