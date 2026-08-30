/**
 * Spatial enhancement, applied to the WINDOWED 8-bit image.
 *
 * Deliberately after the VOI LUT rather than before it. Sharpening real-world
 * values would change what a Hounsfield number means — a probe would report a
 * density the scanner never measured — whereas sharpening the display image is
 * what a workstation's "edge" control actually does, and leaves `values`
 * untouched for measurement and probing.
 *
 * That distinction is the whole safety argument for where this sits: the
 * displayed picture may be enhanced, the data behind it may not be.
 */

/**
 * Unsharp mask: out = grey + amount * (grey - blur(grey)).
 *
 * The blur is a separable 3-tap binomial (1 2 1), run once per unit of radius,
 * which is a close enough Gaussian at these radii and costs two passes over the
 * image instead of one per kernel cell. Edges are clamped rather than wrapped,
 * so the border of a collimated film does not bleed into the other side.
 *
 * @param {Uint8ClampedArray} grey windowed image, one byte per pixel
 * @param {{rows:number, columns:number, amount?:number, radius?:number}} options
 *   `amount` 0 disables and returns the input unchanged (the common case, so it
 *   costs nothing when the control is off).
 * @returns {Uint8ClampedArray} a new buffer, or `grey` itself when amount is 0
 */
export function sharpen(grey, { rows, columns, amount = 0, radius = 1 } = {}) {
    if (!(amount > 0) || !(rows > 0) || !(columns > 0)) return grey;
    if (grey.length !== rows * columns) return grey;

    const passes = Math.max(1, Math.min(4, Math.round(radius)));
    const blurred = blur(grey, rows, columns, passes);

    const out = new Uint8ClampedArray(grey.length);
    for (let i = 0; i < grey.length; i++) {
        out[i] = grey[i] + amount * (grey[i] - blurred[i]);
    }
    return out;
}

/**
 * `passes` applications of a separable (1 2 1)/4 kernel, edges clamped.
 *
 * Three buffers, allocated once and ping-ponged: on a 9-megapixel radiograph
 * each is 36 MB, so allocating per pass is the difference between a control
 * that tracks the slider and one that stutters.
 */
function blur(grey, rows, columns, passes) {
    let src = Float32Array.from(grey);
    let dst = new Float32Array(grey.length);
    const tmp = new Float32Array(grey.length);

    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < rows; y++) {          // horizontal: src -> tmp
            const row = y * columns;
            for (let x = 0; x < columns; x++) {
                const l = src[row + (x > 0 ? x - 1 : 0)];
                const r = src[row + (x < columns - 1 ? x + 1 : columns - 1)];
                tmp[row + x] = (l + 2 * src[row + x] + r) / 4;
            }
        }
        for (let y = 0; y < rows; y++) {          // vertical: tmp -> dst
            const row = y * columns;
            const up = (y > 0 ? y - 1 : 0) * columns;
            const down = (y < rows - 1 ? y + 1 : rows - 1) * columns;
            for (let x = 0; x < columns; x++) {
                dst[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[down + x]) / 4;
            }
        }
        [src, dst] = [dst, src];                  // the result becomes the next input
    }
    return src;
}
