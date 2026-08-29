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
        window: { center: initialWindow.center, width: initialWindow.width },
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

    // Solve `imagePoint * scale + base(scale) + pan = anchor` for pan.
    const { scale } = viewTransform({ ...state, zoom }, geometry, canvasSize);
    const baseX = (canvasSize.width - geometry.columns * scale) / 2;
    const baseY = (canvasSize.height - geometry.rows * scale) / 2;

    return {
        ...state,
        zoom,
        panX: anchor.x - imagePoint.x * scale - baseX,
        panY: anchor.y - imagePoint.y * scale - baseY,
    };
}

export function panBy(state, dx, dy) {
    return { ...state, panX: state.panX + dx, panY: state.panY + dy };
}

/** Back to the default presentation — the 'reset' every PACS binds. */
export function resetView(state) {
    return { ...state, zoom: 1, panX: 0, panY: 0 };
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
    return { ...fresh, zoom: state.zoom, panX: state.panX, panY: state.panY };
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
        return { scale: 1, offsetX: 0, offsetY: 0 };
    }
    const fit = Math.min(width / columns, height / rows);
    const scale = fit * state.zoom;
    return {
        scale,
        offsetX: (width - columns * scale) / 2 + state.panX,
        offsetY: (height - rows * scale) / 2 + state.panY,
    };
}

/** Canvas point -> image pixel. The inverse of `viewTransform`, exactly. */
export function toImagePoint({ x, y }, transform) {
    return { x: (x - transform.offsetX) / transform.scale, y: (y - transform.offsetY) / transform.scale };
}

/** Image pixel -> canvas point. */
export function toCanvasPoint({ x, y }, transform) {
    return { x: x * transform.scale + transform.offsetX, y: y * transform.scale + transform.offsetY };
}
