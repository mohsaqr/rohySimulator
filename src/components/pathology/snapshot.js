/**
 * Capturing the current field as an image.
 *
 * WHY A SNAPSHOT NEEDS ITS OWN MODULE: a screenshot of a slide without a scale
 * bar is not evidence of anything. Magnification is meaningless once the image
 * leaves the viewer — a PNG has no zoom level — so the only way a captured
 * field stays interpretable is if the physical scale is drawn INTO the pixels.
 * That is standard practice for any published photomicrograph, and it is the
 * one thing a naive `canvas.toDataURL()` would omit.
 *
 * The other subtlety is the display filter. Brightness and contrast are applied
 * as a CSS filter on the OSD host element, which changes what is on screen but
 * NOT the pixels in the backing canvas. Compositing with the same filter set on
 * the 2D context is what makes the saved image match what the reader was
 * actually looking at.
 */

import { scaleBar, viewportSample } from './slideGeometry.js';
import { formatObjective } from './magnification.js';

/**
 * Composite the slide, the annotations and a burnt-in scale bar into a PNG.
 *
 * @param {object} p
 * @param {object} p.viewer            the live OpenSeadragon viewer
 * @param {HTMLCanvasElement|null} p.annotationCanvas  the overlay, or null
 * @param {object} p.slide             optical profile + label
 * @param {string} [p.filter='none']   the CSS filter currently on the host
 * @returns {{dataUrl:string, filename:string, objective:number}}
 * @throws {Error} when the viewer has not opened a tile source yet
 */
export function captureField({ viewer, annotationCanvas, slide, filter = 'none' }) {
    const source = viewer?.drawer?.canvas;
    const item = viewer?.world?.getItemAt?.(0);
    if (!source || !item) {
        throw new Error('captureField(): the viewer has no open tile source to capture');
    }

    const sample = viewportSample({
        bounds: viewer.viewport.getBounds(true),
        boundsNoRotate: viewer.viewport.getBoundsNoRotate(true),
        imageWidthPx: item.getContentSize().x,
        containerWidthPx: viewer.container.clientWidth,
        slide,
        t: 0,
    });

    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');

    // OSD 6's WebGL drawer composites into a 2D output canvas, so this reads
    // back correctly without preserveDrawingBuffer.
    ctx.filter = filter;
    ctx.drawImage(source, 0, 0);
    ctx.filter = 'none';

    // The annotation overlay is drawn UNFILTERED: dimming the tissue must not
    // dim the marks made on it.
    if (annotationCanvas && annotationCanvas.width > 0) {
        ctx.drawImage(annotationCanvas, 0, 0, out.width, out.height);
    }

    // The backing store is device-pixel sized; the scale bar was computed in
    // CSS pixels, so it has to be scaled by the same ratio or the bar would be
    // drawn at half its true length on a Retina display.
    const dpr = out.width / viewer.container.clientWidth;
    drawScaleBar(ctx, {
        mppOnScreen: sample.mppOnScreen,
        objective: sample.objective,
        interpolating: sample.interpolating,
        dpr,
        height: out.height,
    });

    const stamp = `${Math.round(sample.x + sample.w / 2)}x${Math.round(sample.y + sample.h / 2)}`;
    return {
        dataUrl: out.toDataURL('image/png'),
        filename: `${slide.id ?? 'slide'}_${formatObjective(sample.objective)}_${stamp}.png`,
        objective: sample.objective,
    };
}

function drawScaleBar(ctx, { mppOnScreen, objective, interpolating, dpr, height }) {
    const bar = scaleBar(mppOnScreen, 220);
    const barPx = bar.px * dpr;
    const pad = 16 * dpr;
    const y = height - pad;
    const label = `${bar.label}  ·  ${formatObjective(objective)}${interpolating ? ' (interpolated)' : ''}`;

    ctx.save();
    ctx.font = `600 ${13 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const plateWidth = Math.max(barPx, textWidth) + 20 * dpr;

    // A dark plate behind the bar: a white bar over a pale section and a black
    // bar over a dark one are equally invisible, and this has to be readable on
    // whatever tissue happens to be underneath.
    ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
    ctx.fillRect(pad - 10 * dpr, y - 34 * dpr, plateWidth, 44 * dpr);

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(pad, y - 6 * dpr, barPx, 4 * dpr);
    // End caps, so the bar's extent is unambiguous.
    ctx.fillRect(pad, y - 12 * dpr, 3 * dpr, 16 * dpr);
    ctx.fillRect(pad + barPx - 3 * dpr, y - 12 * dpr, 3 * dpr, 16 * dpr);

    ctx.fillText(label, pad, y - 16 * dpr);
    ctx.restore();
}

/**
 * Hand a data URL or a text blob to the browser as a download.
 *
 * Kept here rather than inline in a component so the anchor is always created,
 * clicked and REVOKED — an object URL that is never revoked keeps its whole
 * blob alive for the life of the document, and a slide snapshot is several
 * megabytes.
 *
 * @param {string} filename
 * @param {string} content   a data: URL, or text when `mimeType` is given
 * @param {string} [mimeType] set for text content, e.g. 'application/geo+json'
 */
export function download(filename, content, mimeType) {
    const href = mimeType
        ? URL.createObjectURL(new Blob([content], { type: mimeType }))
        : content;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (mimeType) URL.revokeObjectURL(href);
}
