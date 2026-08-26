/**
 * Slide geometry — pure conversions between screen, archive and slide space.
 *
 * WHY this is a separate module: the honest-magnification problem. A viewer
 * that reports "612%" when it is interpolating a 2,400 px preview is lying to
 * a trainee about what they are looking at, and a trainee who believes they
 * are at 40x will report mitotic counts that cannot be supported by the
 * pixels on screen. Every magnification number in the UI comes from here, and
 * every number here is derived from declared scanner metadata rather than
 * from the zoom slider.
 *
 * Three coordinate spaces:
 *   screen   px on the display
 *   archive  px in the tiled pyramid actually being served (10x here)
 *   slide    px in the level-0 scan (40x) — the space ROIs and answer keys
 *            are authored in, so they survive a re-export at a different
 *            archive level.
 */

/**
 * Validate and normalise a slide's optical description.
 *
 * @param {object} slide
 * @param {number} slide.nativeObjective  objective of the level-0 scan, e.g. 40
 * @param {number} slide.nativeMpp        microns per level-0 pixel, e.g. 0.25
 * @param {number} slide.downsample       archive level factor vs level 0, e.g. 4
 * @returns {{nativeObjective:number, nativeMpp:number, downsample:number,
 *            archiveObjective:number, archiveMpp:number}}
 */
export function opticalProfile(slide) {
    const { nativeObjective, nativeMpp, downsample } = slide ?? {};
    const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!positive(nativeObjective) || !positive(nativeMpp) || !positive(downsample)) {
        throw new TypeError(
            'opticalProfile(slide): nativeObjective, nativeMpp and downsample must all be '
            + `finite positive numbers, received ${JSON.stringify({ nativeObjective, nativeMpp, downsample })}`,
        );
    }
    return {
        nativeObjective,
        nativeMpp,
        downsample,
        archiveObjective: nativeObjective / downsample,
        archiveMpp: nativeMpp * downsample,
    };
}

/**
 * Does this slide carry everything an optical calculation needs?
 *
 * `opticalProfile()` THROWS on an incomplete slide, deliberately: a viewer that
 * invents a magnification is the exact failure this module exists to prevent.
 * But there are legitimate moments when a slide is half-described — most
 * obviously the case editor, where an author is looking at the tissue while
 * typing the very fields that are missing. Callers ask this first and show
 * "uncalibrated" rather than a number.
 *
 * @param {object} slide
 * @returns {boolean}
 */
export function hasOpticalProfile(slide) {
    return ['nativeObjective', 'nativeMpp', 'downsample'].every((k) => {
        const v = slide?.[k];
        return typeof v === 'number' && Number.isFinite(v) && v > 0;
    });
}

/**
 * Objective-equivalent magnification actually on screen.
 *
 * `screenPxPerArchivePx` is OpenSeadragon's image-pixel ratio. Above 1.0 the
 * viewer is interpolating: the returned objective is still the honest optical
 * equivalent, but `interpolating` is true so the UI can say so.
 *
 * @returns {{objective:number, mppOnScreen:number, interpolating:boolean}}
 */
export function displayedMagnification(slide, screenPxPerArchivePx) {
    const profile = opticalProfile(slide);
    if (!(typeof screenPxPerArchivePx === 'number' && Number.isFinite(screenPxPerArchivePx) && screenPxPerArchivePx > 0)) {
        throw new TypeError(
            `displayedMagnification(): screenPxPerArchivePx must be a finite positive number, received ${screenPxPerArchivePx}`,
        );
    }
    return {
        objective: profile.archiveObjective * screenPxPerArchivePx,
        mppOnScreen: profile.archiveMpp / screenPxPerArchivePx,
        interpolating: screenPxPerArchivePx > 1,
    };
}

// 1-2-5 ladder in microns, up to 5 mm. A scale bar must land on a round
// number a human reads at a glance, not on whatever 137.4 µm the zoom happens
// to produce.
const SCALE_STEPS_UM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/**
 * Largest round scale bar that fits in `maxWidthPx` on screen.
 *
 * @param {number} mppOnScreen  microns per screen pixel (from displayedMagnification)
 * @param {number} maxWidthPx   the widest the bar may be drawn
 * @returns {{um:number, px:number, label:string}}
 */
export function scaleBar(mppOnScreen, maxWidthPx) {
    if (!(mppOnScreen > 0) || !(maxWidthPx > 0)) {
        throw new TypeError(
            `scaleBar(): mppOnScreen and maxWidthPx must be positive, received ${mppOnScreen}, ${maxWidthPx}`,
        );
    }
    const fits = SCALE_STEPS_UM.filter((um) => um / mppOnScreen <= maxWidthPx);
    // Every step overflows → fall back to the smallest so the bar still
    // renders (truthfully labelled) rather than vanishing.
    const um = fits.length > 0 ? fits[fits.length - 1] : SCALE_STEPS_UM[0];
    return {
        um,
        px: um / mppOnScreen,
        label: um >= 1000 ? `${um / 1000} mm` : `${um} µm`,
    };
}

/**
 * Convert an archive-space viewport rect to slide (level-0) coordinates.
 * ROIs and answer keys live in slide space so they survive a re-export.
 *
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function archiveRectToSlide(rect, slide) {
    const { downsample } = opticalProfile(slide);
    const { x, y, w, h } = rect ?? {};
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new TypeError(`archiveRectToSlide(rect): x/y/w/h must all be finite numbers, received ${JSON.stringify(rect)}`);
    }
    return { x: x * downsample, y: y * downsample, w: w * downsample, h: h * downsample };
}

/**
 * Build a viewport sample from OpenSeadragon state.
 *
 * Deliberately derived from FIRST PRINCIPLES rather than from OSD's
 * viewportToImageZoom() family: OSD's normalised viewport coordinate system
 * is documented as "image width == 1.0" with y scaled by the same factor, and
 * that contract is far more stable across OSD versions than its zoom-
 * conversion helpers. Everything here needs only `viewport.getBounds()`,
 * the item's content size, and the container width.
 *
 * ROTATION. `bounds` from getBounds() is the AXIS-ALIGNED BOUNDING BOX of the
 * visible region, so rotating the slide 90 degrees swaps its width and height
 * and the magnification derived from it changes by the container's aspect
 * ratio — a 10x view read as "14x, interpolated" the moment the reader turned
 * the slide upright. Rotating a slide does not change how many screen pixels a
 * scanned pixel occupies, so that reading was simply false, and false
 * magnification is the one thing this module exists to prevent.
 *
 * Pass `boundsNoRotate` (viewport.getBoundsNoRotate(true)) and the scale is
 * taken from it, which is rotation-invariant, while the reported extent still
 * comes from `bounds` and so still describes the tissue actually on screen.
 * Omitting it keeps the old single-bounds behaviour for unrotated callers.
 *
 * @param {object} p
 * @param {{x:number,y:number,width:number,height:number}} p.bounds  viewer.viewport.getBounds(true)
 * @param {{width:number}} [p.boundsNoRotate]  viewport.getBoundsNoRotate(true)
 * @param {number} p.imageWidthPx     archive width, world.getItemAt(0).getContentSize().x
 * @param {number} p.containerWidthPx viewer.container.clientWidth
 * @param {object} p.slide            optical profile input
 * @param {number} p.t                ms since read start
 * @returns {{t:number,x:number,y:number,w:number,h:number,objective:number,mppOnScreen:number,interpolating:boolean}}
 *          x/y/w/h are in SLIDE (level-0) coordinates.
 */
export function viewportSample({ bounds, boundsNoRotate, imageWidthPx, containerWidthPx, slide, t }) {
    const nums = { imageWidthPx, containerWidthPx, t };
    const bad = Object.entries(nums).find(([, v]) => !(typeof v === 'number' && Number.isFinite(v)));
    if (bad) throw new TypeError(`viewportSample(): ${bad[0]} must be a finite number, received ${bad[1]}`);
    if (imageWidthPx <= 0 || containerWidthPx <= 0) {
        throw new RangeError(`viewportSample(): imageWidthPx and containerWidthPx must be positive, received ${imageWidthPx}, ${containerWidthPx}`);
    }
    if (!bounds || !['x', 'y', 'width', 'height'].every((k) => typeof bounds[k] === 'number' && Number.isFinite(bounds[k]))) {
        throw new TypeError(`viewportSample(): bounds needs finite x/y/width/height, received ${JSON.stringify(bounds)}`);
    }
    if (bounds.width <= 0) {
        throw new RangeError(`viewportSample(): bounds.width must be positive, received ${bounds.width}`);
    }

    const scaleWidth = boundsNoRotate?.width ?? bounds.width;
    if (!(typeof scaleWidth === 'number' && Number.isFinite(scaleWidth) && scaleWidth > 0)) {
        throw new RangeError(`viewportSample(): boundsNoRotate.width must be positive, received ${scaleWidth}`);
    }
    // In OSD's normalised space the image spans 1.0 horizontally, so every
    // coordinate scales by imageWidthPx to reach archive pixels. The SCALE uses
    // the unrotated width so it survives rotation; the RECT below uses the
    // rotated bounds so it still describes what is on screen.
    const archiveVisibleWidth = scaleWidth * imageWidthPx;
    const screenPxPerArchivePx = containerWidthPx / archiveVisibleWidth;
    const { objective, mppOnScreen, interpolating } = displayedMagnification(slide, screenPxPerArchivePx);
    const archiveRect = {
        x: bounds.x * imageWidthPx,
        y: bounds.y * imageWidthPx,
        w: bounds.width * imageWidthPx,
        h: bounds.height * imageWidthPx,
    };
    return { t, ...archiveRectToSlide(archiveRect, slide), objective, mppOnScreen, interpolating };
}
