// Where the App-level Oyon capture pill sits.
//
// The pill is mounted once, at App level, and kept in the same fragment slot
// across every screen so the camera never restarts (see App.jsx). That means
// one element has to coexist with the chrome of every surface underneath it,
// at z-80, and it is the only host overlay that stacks above a plugin room.
//
// QA-0023 (external pilot, v3.0.0-beta9): "the pan control in the 3D patient
// bedside room overlaps with the oyon pill so three over four commands of the
// pan tool (up, left, right) are not reachable; the pan tool is anchored and
// does not relocate when changing the size of the view."
//
// The immersive room is a pinned package that draws its own chrome full-bleed,
// including a camera-nudge wheel centred in a 90px top bar. The host does not
// get to rearrange a package's chrome, so the host overlay is the piece that
// moves. Extracted from App.jsx as a pure function so the placement can be
// tested without mounting the whole application shell.

/** Top bar height of the immersive room package, plus a gap. */
const BELOW_IMMERSIVE_TOPBAR = '98px';

/**
 * @param {object} options
 * @param {boolean} options.overOverlayRoom a plugin room with
 *   `presentation: 'overlay'` is drawn full-bleed beneath the pill
 * @param {boolean} options.dockedOverMonitor the chat screen, where the pill
 *   docks over the centre of the monitor column and PatientMonitor's header
 *   grid reserves a matching slot via `--oyon-pill-w`
 * @returns {{ centred: boolean, style: {top: string, left: string} }}
 *   `centred` asks the caller for the -translate-x-1/2 that turns `left` into
 *   a centre line; without it `left` is the pill's own left edge.
 */
export function oyonPillPlacement({ overOverlayRoom = false, dockedOverMonitor = false } = {}) {
    // Below the package's top bar and hard against the left edge: clear of the
    // nudge wheel it used to cover, clear of the package's own top-centre
    // notices, and above the vertical band its side wheel occupies.
    if (overOverlayRoom) {
        return { centred: false, style: { top: BELOW_IMMERSIVE_TOPBAR, left: '16px' } };
    }
    // The chat column seam is max(35vw, 350px); the pill centres on what is
    // left of the viewport.
    if (dockedOverMonitor) {
        return {
            centred: true,
            style: { top: '0.5rem', left: 'calc(max(35vw, 350px) + (100vw - max(35vw, 350px)) / 2)' },
        };
    }
    return { centred: true, style: { top: '0.5rem', left: '50vw' } };
}
