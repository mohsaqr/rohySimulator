/**
 * Viewport state: zoom, pan, the current slice, the current window.
 *
 * Deliberately pure and free of React and the DOM. Every interaction a
 * radiologist performs — scroll the stack, drag the window, zoom to a lesion,
 * pan to a corner — is a function from state and a gesture to new state, and
 * keeping them here means they can be tested with `node --test` instead of
 * driven through a browser. The React component below is then thin enough to
 * be obviously correct.
 */

/** The initial state for a series of `sliceCount` images. */
export function initialViewport({ sliceCount = 1, window: initialWindow = { center: 40, width: 400 }, invert = false } = {}) {
    return {
        slice: Math.floor(Math.max(0, sliceCount - 1) / 2), // studies open mid-stack, as PACS do
        sliceCount,
        zoom: 1,
        panX: 0,
        panY: 0,
        rotation: 0,   // quarter-turns clockwise, 0..3
        flipH: false,
        flipV: false,
        window: { center: initialWindow.center, width: initialWindow.width },
        // Presentation adjustments, all of which act on the DISPLAYED image and
        // none of which touch the values a probe or a measurement reads.
        voiFunction: 'LINEAR',  // or 'SIGMOID' — PS3.3 C.11.2.1.3
        gamma: 1,               // >1 lifts midtones, <1 deepens them
        sharpen: 0,             // unsharp-mask amount, 0 = off
        smooth: true,           // interpolate when displayed below 1:1
        // The window the series OPENED with, kept so there is always a way
        // back. Without it "reset" restores the geometry but leaves whatever
        // window was last dragged or picked, and a reader who tried a preset
        // has no route to the presentation the study was stored with.
        baseWindow: { center: initialWindow.center, width: initialWindow.width },
        invert,
        // The set of slices the learner has actually displayed. This is the
        // evidence behind "did they review the whole series", and it must be a
        // count of DISTINCT slices — scrolling up and down over the same ten
        // images is not reading a 300-slice CT.
        seen: new Set([Math.floor(Math.max(0, sliceCount - 1) / 2)]),
    };
}

/** Move through the stack. Clamped, never wrapping: a stack has a top and a bottom. */
export function scrollTo(state, slice) {
    const next = Math.min(state.sliceCount - 1, Math.max(0, Math.trunc(slice)));
    const seen = new Set(state.seen);
    seen.add(next);
    return { ...state, slice: next, seen };
}

/** Relative scroll — the wheel, the arrow keys, a drag on the scrollbar. */
export function scrollBy(state, delta) {
    return scrollTo(state, state.slice + delta);
}

/**
 * The proportion of the series the learner has displayed, 0..1.
 * The number a rubric means when it says "reviewed the series".
 */
export function coverage(state) {
    if (!(state.sliceCount > 0)) return 0;
    return state.seen.size / state.sliceCount;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 20;

/**
 * Zoom about a fixed point, so the anatomy under the cursor stays under the
 * cursor. Zooming about the centre instead makes a lesion the learner is
 * inspecting slide out of view on every step, which is the most common way a
 * viewer feels wrong to use.
 *
 * It needs the geometry and the canvas size, and that is not incidental. The
 * transform centres the image with `(width - columns * scale) / 2`, a term that
 * itself depends on the scale — so pan cannot be corrected by scaling it
 * against the old zoom. Solving for the pan that pins the anchor requires the
 * same numbers `viewTransform` uses, which is why they are passed in rather
 * than assumed away.
 */
export function zoomAbout(state, factor, anchor = { x: 0, y: 0 }, geometry, canvasSize) {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom * factor));
    if (!geometry || !canvasSize) return { ...state, zoom };

    // The image point currently under the anchor — what must not move.
    const imagePoint = toImagePoint(anchor, viewTransform(state, geometry, canvasSize));

    // Where that point would land at the new zoom with no pan; the pan is then
    // exactly the correction that puts it back under the anchor. Solving through
    // the shared mapping functions (rather than repeating their algebra here) is
    // what keeps this correct under rotation and flip as well as plain zoom.
    const rezoomed = { ...state, zoom, panX: 0, panY: 0 };
    const lands = toCanvasPoint(imagePoint, viewTransform(rezoomed, geometry, canvasSize));

    return { ...state, zoom, panX: anchor.x - lands.x, panY: anchor.y - lands.y };
}

export function panBy(state, dx, dy) {
    return { ...state, panX: state.panX + dx, panY: state.panY + dy };
}

/** Back to the default presentation — the 'reset' every PACS binds. */
export function resetView(state) {
    return {
        ...state,
        zoom: 1,
        panX: 0,
        panY: 0,
        rotation: 0,
        flipH: false,
        flipV: false,
        invert: false,
        window: state.baseWindow ? { ...state.baseWindow } : state.window,
        voiFunction: 'LINEAR',
        gamma: 1,
        sharpen: 0,
        smooth: true,
    };
}

/**
 * Set one presentation adjustment, clamped to a range that stays useful.
 *
 * Clamping here rather than in the control means a keyboard shortcut, a slider
 * and a restored session all get the same guarantees — and that a gamma of 0,
 * which would divide by zero, cannot be reached from any of them.
 */
export function setAdjustment(state, key, value) {
    if (key === 'gamma') return { ...state, gamma: clamp(value, 0.2, 5) };
    if (key === 'sharpen') return { ...state, sharpen: clamp(value, 0, 3) };
    if (key === 'voiFunction') return { ...state, voiFunction: value === 'SIGMOID' ? 'SIGMOID' : 'LINEAR' };
    if (key === 'smooth') return { ...state, smooth: value !== false };
    return state;
}

/** Set the window directly — what a numeric W/L field needs. */
export function setWindow(state, { center, width }) {
    const next = {
        center: Number.isFinite(center) ? center : state.window.center,
        width: Number.isFinite(width) ? Math.max(1, width) : state.window.width,
    };
    return { ...state, window: next };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Rotate the presentation a quarter-turn clockwise (or anticlockwise with -1). */
export function rotateQuarter(state, turns = 1) {
    return { ...state, rotation: (((state.rotation ?? 0) + turns) % 4 + 4) % 4 };
}

export function flipHorizontal(state) {
    return { ...state, flipH: !state.flipH };
}

export function flipVertical(state) {
    return { ...state, flipV: !state.flipV };
}

export function toggleInvert(state) {
    return { ...state, invert: !state.invert };
}

/**
 * One cine tick. Unlike `scrollBy` it WRAPS: a cine loop that stops dead at the
 * last slice is a playback that ran once, and readers expect the loop.
 */
export function cineStep(state, delta = 1) {
    if (!(state.sliceCount > 0)) return state;
    const next = (state.slice + delta + state.sliceCount) % state.sliceCount;
    return scrollTo(state, next);
}

/** Windowing by drag: horizontal is width, vertical is level. */
export function windowBy(state, dx, dy, sensitivity = 1) {
    return {
        ...state,
        window: {
            center: state.window.center + dy * sensitivity,
            width: Math.max(1, state.window.width + dx * sensitivity),
        },
    };
}

export function applyPreset(state, preset) {
    if (!preset) return state;
    return { ...state, window: { center: preset.center, width: preset.width } };
}

/** Changing series keeps the window (a reader compares) but re-centres the stack. */
export function changeSeries(state, sliceCount) {
    const fresh = initialViewport({ sliceCount, window: state.window, invert: state.invert });
    // The new series has not declared its own window yet, so the one carried
    // over is the best "as acquired" available until it does.
    return { ...fresh, zoom: state.zoom, panX: state.panX, panY: state.panY };
}

/**
 * Adopt a window as BOTH the current presentation and the one to return to.
 * Used when a series' declared window finally arrives — the slice that carries
 * it may land after the viewport was created.
 */
export function adoptWindow(state, window) {
    if (!(window?.width > 0) || !Number.isFinite(window?.center)) return state;
    const next = { center: window.center, width: window.width };
    return { ...state, window: next, baseWindow: { ...next } };
}

/**
 * The transform that maps image pixels to canvas pixels: fit the image, then
 * apply zoom and pan. Returned as data so both the renderer and the hit-testing
 * for measurements use the same numbers — a measurement drawn with one
 * transform and computed with another lands in the wrong place, and on a
 * medical image that is a wrong answer rather than a cosmetic bug.
 */
export function viewTransform(state, { rows, columns }, { width, height }) {
    if (!(rows > 0 && columns > 0 && width > 0 && height > 0)) {
        return { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, flipH: false, flipV: false, rows: 0, columns: 0 };
    }
    const rotation = state.rotation ?? 0;
    // A quarter-turn swaps the image's footprint on screen, so the fit must use
    // the rotated dimensions — a 512-wide portrait rotated 90 degrees fits by
    // its height, not its width.
    const sideways = rotation % 2 === 1;
    const displayColumns = sideways ? rows : columns;
    const displayRows = sideways ? columns : rows;
    const fit = Math.min(width / displayColumns, height / displayRows);
    const scale = fit * state.zoom;
    return {
        scale,
        offsetX: (width - displayColumns * scale) / 2 + state.panX,
        offsetY: (height - displayRows * scale) / 2 + state.panY,
        rotation,
        flipH: state.flipH ?? false,
        flipV: state.flipV ?? false,
        rows,
        columns,
    };
}

/** Flip then rotate, in continuous image coordinates -> display coordinates. */
function toDisplay({ x, y }, { rotation = 0, flipH = false, flipV = false, rows, columns }) {
    const fx = flipH ? columns - x : x;
    const fy = flipV ? rows - y : y;
    if (rotation === 1) return { x: rows - fy, y: fx };
    if (rotation === 2) return { x: columns - fx, y: rows - fy };
    if (rotation === 3) return { x: fy, y: columns - fx };
    return { x: fx, y: fy };
}

/** The exact inverse of `toDisplay`. */
function fromDisplay({ x, y }, { rotation = 0, flipH = false, flipV = false, rows, columns }) {
    let fx = x;
    let fy = y;
    if (rotation === 1) { fx = y; fy = rows - x; }
    else if (rotation === 2) { fx = columns - x; fy = rows - y; }
    else if (rotation === 3) { fx = columns - y; fy = x; }
    return { x: flipH ? columns - fx : fx, y: flipV ? rows - fy : fy };
}

/** Canvas point -> image pixel. The inverse of `toCanvasPoint`, exactly. */
export function toImagePoint({ x, y }, transform) {
    const display = { x: (x - transform.offsetX) / transform.scale, y: (y - transform.offsetY) / transform.scale };
    if (!transform.rotation && !transform.flipH && !transform.flipV) return display;
    return fromDisplay(display, transform);
}

/** Image pixel -> canvas point. */
export function toCanvasPoint(point, transform) {
    const display = (!transform.rotation && !transform.flipH && !transform.flipV)
        ? point
        : toDisplay(point, transform);
    return { x: display.x * transform.scale + transform.offsetX, y: display.y * transform.scale + transform.offsetY };
}

/**
 * The orientation letters as they should be DISPLAYED, given the current
 * rotation and flips. A viewer that rotates the image but leaves the markers
 * where they were is actively lying about which side is which — worse than
 * showing no markers at all — so the letters go through the same flip-then-
 * rotate permutation the pixels do.
 */
export function displayedOrientation(labels, state = {}) {
    if (!labels) return null;
    let { left, right, up, down } = labels;
    if (state.flipH) [left, right] = [right, left];
    if (state.flipV) [up, down] = [down, up];
    const turns = ((state.rotation ?? 0) % 4 + 4) % 4;
    for (let i = 0; i < turns; i++) {
        // one quarter-turn clockwise: what pointed up now points right
        [right, down, left, up] = [up, right, down, left];
    }
    return { left, right, up, down };
}
