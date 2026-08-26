/**
 * Gross specimen geometry.
 *
 * A gross photograph is an ordinary image, not a scanned pyramid, so it has no
 * scanner metadata to derive microns-per-pixel from. Instead each plate
 * declares `scaleMm` — the real-world width the photograph spans. That single
 * number is what lets a scale bar stay true at any zoom, which is strictly
 * better than baking a fixed ruler into the image: a baked ruler is only
 * correct at one zoom level.
 *
 * Everything here funnels into the SAME scaleBar() ladder the microscopy side
 * uses, so a trainee reads one visual language across both modules.
 */

import { scaleBar } from './slideGeometry.js';

/**
 * Microns per screen pixel for a gross plate.
 *
 * @param {number} scaleMm             real-world width the plate spans, in mm
 * @param {number} plateWidthOnScreenPx the plate's full width as currently
 *                                      drawn, in screen px (zoom-dependent)
 * @returns {number} microns per screen pixel
 */
export function plateMicronsPerPixel(scaleMm, plateWidthOnScreenPx) {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!ok(scaleMm) || !ok(plateWidthOnScreenPx)) {
        throw new TypeError(
            'plateMicronsPerPixel(): scaleMm and plateWidthOnScreenPx must both be '
            + `finite positive numbers, received ${scaleMm}, ${plateWidthOnScreenPx}`,
        );
    }
    // mm per screen px, then to microns so it shares the microscopy ladder.
    return (scaleMm / plateWidthOnScreenPx) * 1000;
}

/**
 * Scale bar for a gross plate, in the same 1-2-5 ladder as the slide HUD.
 *
 * @returns {{um:number, px:number, label:string}}
 */
export function plateScaleBar(scaleMm, plateWidthOnScreenPx, maxWidthPx) {
    return scaleBar(plateMicronsPerPixel(scaleMm, plateWidthOnScreenPx), maxWidthPx);
}
