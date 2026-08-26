/**
 * Magnification control — turning "10x" into a viewport, and back.
 *
 * WHY this is not just a zoom slider: a pathologist does not think in zoom
 * percentages, they think in objectives. "Screen at 4x, confirm at 40x" is the
 * actual instruction, and the usability literature on WSI navigation asks for
 * hotkeys bound to specific magnifications rather than a continuous control.
 * So the viewer needs an exact, invertible mapping between an objective power
 * and OpenSeadragon's viewport zoom.
 *
 * THE CEILING IS REAL AND MUST BE VISIBLE. A pyramid exported at 10x cannot
 * show 40x. It can interpolate to something that looks like 40x, and that is
 * how a trainee ends up reporting mitotic figures they cannot actually
 * resolve. `objectiveCeiling()` states the honest limit for a given archive so
 * the UI can DISABLE the unreachable presets instead of silently clamping to
 * the top and letting the reader believe they got there.
 */

import { opticalProfile } from './slideGeometry.js';

/**
 * The objective powers a light microscope actually carries, plus 1x.
 *
 * 1x is not a real objective — it is the whole-slide overview a scanner gives
 * you for free and a glass microscope does not. It earns its place because
 * "step back and look at the whole thing" is the first move of a systematic
 * screen, and it is the one magnification a trainee at a real scope cannot get.
 */
export const OBJECTIVE_PRESETS = [1, 2, 4, 10, 20, 40];

/**
 * Counting-frame areas offered, in mm².
 *
 * The WHO 5th-edition tumour classification requires mitotic counts to be
 * reported per mm² rather than per 10 high-power fields, because a "high-power
 * field" varies several-fold between microscopes and between digital viewports
 * at the same nominal magnification. 2 mm² is the common minimum; a
 * whole-slide-image study of invasive breast cancer found interobserver
 * agreement highest at 3 mm².
 */
export const COUNTING_FRAME_AREAS_MM2 = [1, 2, 3];

/**
 * OpenSeadragon viewport zoom that puts the slide at a given objective power.
 *
 * Derived from the same first principles as viewportSample(): OSD's normalised
 * viewport spans 1.0 across the image width, so `bounds.width = 1 / zoom`, and
 *
 *     screenPxPerArchivePx = containerWidthPx / (bounds.width * imageWidthPx)
 *                          = containerWidthPx * zoom / imageWidthPx
 *
 * Setting that equal to the ratio the requested objective demands and solving
 * for zoom gives the expression below. Two stable API calls, no dependence on
 * OSD's zoom-conversion helpers.
 *
 * @param {object} p
 * @param {object} p.slide            nativeObjective / nativeMpp / downsample
 * @param {number} p.objective        requested power, e.g. 10
 * @param {number} p.imageWidthPx     archive width in px
 * @param {number} p.containerWidthPx viewer element width in px
 * @returns {number} viewport zoom to hand to viewport.zoomTo()
 */
export function zoomForObjective({ slide, objective, imageWidthPx, containerWidthPx }) {
    const { archiveObjective } = opticalProfile(slide);
    const nums = { objective, imageWidthPx, containerWidthPx };
    const bad = Object.entries(nums).find(([, v]) => !(typeof v === 'number' && Number.isFinite(v) && v > 0));
    if (bad) {
        throw new RangeError(`zoomForObjective(): ${bad[0]} must be a finite positive number, received ${bad[1]}`);
    }
    const screenPxPerArchivePx = objective / archiveObjective;
    return (screenPxPerArchivePx * imageWidthPx) / containerWidthPx;
}

/**
 * Inverse of zoomForObjective — the objective a given viewport zoom shows.
 *
 * @param {object} p  same shape, with `zoom` instead of `objective`
 * @returns {number} objective power
 */
export function objectiveForZoom({ slide, zoom, imageWidthPx, containerWidthPx }) {
    const { archiveObjective } = opticalProfile(slide);
    const nums = { zoom, imageWidthPx, containerWidthPx };
    const bad = Object.entries(nums).find(([, v]) => !(typeof v === 'number' && Number.isFinite(v) && v > 0));
    if (bad) {
        throw new RangeError(`objectiveForZoom(): ${bad[0]} must be a finite positive number, received ${bad[1]}`);
    }
    return archiveObjective * ((zoom * containerWidthPx) / imageWidthPx);
}

/**
 * Highest objective this archive can show without interpolating past `ratio`.
 *
 * A 40x scan exported at downsample 4 is a 10x archive; with the viewer's
 * 1.1 interpolation allowance the honest ceiling is 11x, and every preset
 * above it is unreachable. Returning the number rather than a boolean lets the
 * UI say WHY a button is disabled.
 *
 * @param {object} slide
 * @param {number} [maxZoomPixelRatio=1.1]  SlideCanvas's interpolation allowance
 * @returns {number} objective power
 */
export function objectiveCeiling(slide, maxZoomPixelRatio = 1.1) {
    const { archiveObjective } = opticalProfile(slide);
    if (!(typeof maxZoomPixelRatio === 'number' && Number.isFinite(maxZoomPixelRatio) && maxZoomPixelRatio > 0)) {
        throw new RangeError(
            `objectiveCeiling(): maxZoomPixelRatio must be a finite positive number, received ${maxZoomPixelRatio}`,
        );
    }
    return archiveObjective * maxZoomPixelRatio;
}

/**
 * Which presets this archive can actually reach.
 *
 * @param {object} slide
 * @param {number} [maxZoomPixelRatio=1.1]
 * @returns {Array<{objective:number, reachable:boolean}>}
 */
export function presetAvailability(slide, maxZoomPixelRatio = 1.1) {
    const ceiling = objectiveCeiling(slide, maxZoomPixelRatio);
    return OBJECTIVE_PRESETS.map((objective) => ({
        objective,
        // A hair of tolerance so a 10x archive does not refuse its own 10x
        // preset to a floating-point rounding error in archiveObjective.
        reachable: objective <= ceiling * (1 + 1e-9),
    }));
}

/**
 * The next preset up or down from where the viewer currently is.
 *
 * Steps to the nearest preset STRICTLY in the requested direction, so
 * repeatedly pressing "-" from 12.7x walks 10 → 4 → 2 → 1 rather than sticking
 * on the value nearest the current zoom.
 *
 * @param {number} current      objective now on screen
 * @param {1|-1} direction      +1 up, -1 down
 * @param {Array<number>} [presets=OBJECTIVE_PRESETS]
 * @returns {number|null} null when already at the end of the ladder
 */
export function steppedObjective(current, direction, presets = OBJECTIVE_PRESETS) {
    if (!(typeof current === 'number' && Number.isFinite(current) && current > 0)) {
        throw new RangeError(`steppedObjective(): current must be a finite positive number, received ${current}`);
    }
    if (direction !== 1 && direction !== -1) {
        throw new RangeError(`steppedObjective(): direction must be 1 or -1, received ${direction}`);
    }
    // 1e-6 relative slack: landing on 10x then pressing "up" must not find 10x
    // itself sitting 0.0000001 above the current reading and stall there.
    const slack = current * 1e-6;
    const candidates = direction === 1
        ? presets.filter((p) => p > current + slack)
        : presets.filter((p) => p < current - slack);
    if (candidates.length === 0) return null;
    return direction === 1 ? Math.min(...candidates) : Math.max(...candidates);
}

/**
 * Area of the current field of view, in mm².
 *
 * This is the number that makes a mitotic count reportable: "14 mitoses in
 * 2.03 mm²" is a finding, "14 mitoses in 10 HPF" is an ambiguity.
 *
 * @param {object} p
 * @param {number} p.widthPx   viewport width in SLIDE px
 * @param {number} p.heightPx  viewport height in SLIDE px
 * @param {number} p.nativeMpp microns per level-0 pixel
 * @returns {number} mm²
 */
export function fieldOfViewAreaMm2({ widthPx, heightPx, nativeMpp }) {
    const nums = { widthPx, heightPx, nativeMpp };
    const bad = Object.entries(nums).find(([, v]) => !(typeof v === 'number' && Number.isFinite(v) && v > 0));
    if (bad) {
        throw new RangeError(`fieldOfViewAreaMm2(): ${bad[0]} must be a finite positive number, received ${bad[1]}`);
    }
    return (widthPx * nativeMpp * heightPx * nativeMpp) / 1e6;
}

/**
 * Format an objective for the HUD, without pretending to precision.
 *
 * Below 10x a tenth is meaningful (0.3x vs 0.4x is a different view of the
 * slide); above it, it is noise.
 *
 * @param {number} objective
 * @returns {string}
 */
export function formatObjective(objective) {
    if (!(typeof objective === 'number' && Number.isFinite(objective) && objective > 0)) return '—';
    return objective < 10 ? `${objective.toFixed(1)}x` : `${Math.round(objective)}x`;
}
