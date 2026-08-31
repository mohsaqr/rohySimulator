/**
 * Stored pixel values -> real-world values.
 *
 * This is the difference between a radiology viewer and an image viewer. A CT
 * does not store brightness; it stores an integer that becomes a **Hounsfield
 * unit** only after `stored * RescaleSlope + RescaleIntercept`. Water is 0 HU,
 * air about -1000, cortical bone +1000. A viewer that renders the stored
 * integers directly will look approximately right and be quantitatively wrong —
 * every measured density, every window preset and every "is this fat or fluid"
 * judgement a learner makes would be off by the intercept.
 *
 * So the pipeline is always: bytes -> stored -> modality LUT -> real values,
 * and windowing (windowLevel.js) happens on the real values, never the bytes.
 */

import { DicomError } from './dicomParse.js';

/**
 * Bytes -> stored integers for one frame, honouring BitsAllocated,
 * PixelRepresentation (signed/unsigned) and the transfer syntax's byte order.
 *
 * @returns {{ rows:number, columns:number, frames:number, signed:boolean,
 *   bitsAllocated:number, stored: Int16Array|Uint16Array|Uint8Array }}
 * @throws {DicomError} codes: encapsulated, unsupported_pixels, missing_pixels,
 *   truncated_pixels, bad_frame.
 */
export function readFrame(dicom, frameIndex = 0) {
    const { raw, rows, columns, frames, samples, signed, bitsAllocated, start, bytesPerFrame } = pixelLayout(dicom, frameIndex);
    if (samples !== 1) {
        // Reading colour as if it were grayscale would produce a plausible
        // picture made of interleaved channels, which is worse than an error.
        throw new DicomError(
            `this image has ${samples} samples per pixel; read it with readRenderedFrame()`,
            'unsupported_pixels',
        );
    }

    let stored;
    if (bitsAllocated === 8) {
        const slice = raw.subarray(start, start + bytesPerFrame);
        stored = signed ? Int16Array.from(slice, (v) => (v > 127 ? v - 256 : v)) : Uint8Array.from(slice);
    } else {
        // A DataView reads with explicit endianness, which a typed-array view
        // cannot; Explicit VR Big Endian would otherwise byte-swap every value.
        const dv = new DataView(raw.buffer, raw.byteOffset + start, bytesPerFrame);
        const le = dicom.littleEndian;
        const perFrame = rows * columns;
        stored = signed ? new Int16Array(perFrame) : new Uint16Array(perFrame);
        for (let i = 0; i < perFrame; i++) {
            stored[i] = signed ? dv.getInt16(i * 2, le) : dv.getUint16(i * 2, le);
        }
    }

    return { rows, columns, frames, signed, bitsAllocated, stored };
}

/**
 * Read a frame at reduced resolution, by SAMPLING the stored pixels rather than
 * decoding them all.
 *
 * A 128-pixel preview does not need nine million pixels. The rail used to get
 * one by decoding the whole image (2989x2988 -> 35 MB of Float32), filling a
 * full-size ImageData pixel by pixel in JavaScript, and then asking the canvas
 * to resample nine megapixels down to a 128-pixel tile — about five seconds per
 * study on a radiograph, for a thumbnail. Striding the read does the same job
 * in roughly (maxSize)^2 operations: some five hundred times less work.
 *
 * The sampling is nearest-neighbour, which is honest about what it is. A
 * preview exists to be RECOGNISED, not measured, and no caller should window,
 * probe or measure against this frame — `min`/`max` come from the samples, so
 * an auto-window taken from it is an approximation of the real one.
 *
 * @returns {{rows, columns, frames, values, units, min, max, step}} the same
 *   shape readRealFrame returns, so windowing code needs no special case.
 */
export function readPreviewFrame(dicom, { maxSize = 128, frameIndex = 0 } = {}) {
    const { raw, rows, columns, frames, samples, signed, bitsAllocated, start } = pixelLayout(dicom, frameIndex);
    const step = Math.max(1, Math.ceil(Math.max(rows, columns) / Math.max(1, maxSize)));
    const outRows = Math.max(1, Math.ceil(rows / step));
    const outColumns = Math.max(1, Math.ceil(columns / step));

    const { slope, intercept, units } = rescaleOf(dicom);
    const identity = slope === 1 && intercept === 0;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const le = dicom.littleEndian;
    const wide = bitsAllocated === 16;

    // A COLOUR frame is already rendered: there is no modality LUT to apply and
    // nothing to measure, so what a preview needs from it is only that it be
    // recognisable. The three channels are collapsed to luma. Sampling one
    // channel and calling it grey would tint every ultrasound in the rail —
    // and reading the interleaved bytes as if they were grayscale, which is
    // what this function did before it knew about `samples`, produced a
    // barber's pole rather than a picture.
    const colour = samples === 3;
    const planar = colour && dicom.number('PlanarConfiguration', 0) === 1;
    const ybr = colour && dicom.string('PhotometricInterpretation', 'RGB').startsWith('YBR');
    const plane = rows * columns;

    const values = new Float32Array(outRows * outColumns);
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < outRows; y++) {
        const srcRow = Math.min(rows - 1, y * step) * columns;
        for (let x = 0; x < outColumns; x++) {
            const pixel = srcRow + Math.min(columns - 1, x * step);
            let stored;
            if (colour) {
                // YBR already carries luma in the first channel, so there is
                // nothing to compute; RGB is collapsed with ITU-R BT.601, the
                // same weighting the YBR encoding itself used.
                const a = dv.getUint8(start + (planar ? pixel : pixel * 3));
                if (ybr) stored = a;
                else {
                    const g = dv.getUint8(start + (planar ? plane + pixel : pixel * 3 + 1));
                    const b = dv.getUint8(start + (planar ? 2 * plane + pixel : pixel * 3 + 2));
                    stored = 0.299 * a + 0.587 * g + 0.114 * b;
                }
            } else if (!wide) {
                const byte = dv.getUint8(start + pixel);
                stored = signed && byte > 127 ? byte - 256 : byte;
            } else {
                stored = signed ? dv.getInt16(start + pixel * 2, le) : dv.getUint16(start + pixel * 2, le);
            }
            const value = identity || colour ? stored : stored * slope + intercept;
            values[y * outColumns + x] = value;
            if (value < min) min = value;
            if (value > max) max = value;
        }
    }

    return { rows: outRows, columns: outColumns, frames, values, units, min, max, step };
}

/** Validate and locate one frame's pixels. Shared by the full and preview reads. */
function pixelLayout(dicom, frameIndex) {
    if (dicom.isEncapsulated()) {
        throw new DicomError(
            `pixel data is compressed (${dicom.transferSyntax}); transcode it with scripts/ingest.mjs`,
            'encapsulated',
        );
    }
    const raw = dicom.bytes('PixelData');
    if (!raw) throw new DicomError('the object carries no PixelData', 'missing_pixels');

    const rows = dicom.number('Rows');
    const columns = dicom.number('Columns');
    if (!Number.isFinite(rows) || !Number.isFinite(columns) || rows <= 0 || columns <= 0) {
        throw new DicomError('Rows/Columns are missing or not positive', 'unsupported_pixels');
    }

    // 1 sample is a MEASURED image: stored values carry a modality LUT, so they
    // window, probe and measure. 3 samples is an ALREADY-RENDERED one —
    // ultrasound, angiography, secondary capture — where the device has done
    // the windowing and what is stored is a picture. Both are read; they are
    // just not the same kind of thing, and readRenderedFrame keeps them apart.
    const samples = dicom.number('SamplesPerPixel', 1);
    if (samples !== 1 && samples !== 3) {
        throw new DicomError(`SamplesPerPixel=${samples}; only 1 (grayscale) and 3 (colour) are read`, 'unsupported_pixels');
    }

    const bitsAllocated = dicom.number('BitsAllocated', 16);
    if (bitsAllocated !== 8 && bitsAllocated !== 16) {
        throw new DicomError(`BitsAllocated=${bitsAllocated}; only 8 and 16 are read`, 'unsupported_pixels');
    }

    const signed = dicom.number('PixelRepresentation', 0) === 1;
    const frames = Math.max(1, Math.trunc(dicom.number('NumberOfFrames', 1)));
    if (frameIndex < 0 || frameIndex >= frames) {
        throw new DicomError(`frame ${frameIndex} is out of range (${frames} frame(s))`, 'bad_frame');
    }

    const perFrame = rows * columns * samples;
    const bytesPerFrame = perFrame * (bitsAllocated / 8);
    const start = frameIndex * bytesPerFrame;
    if (start + bytesPerFrame > raw.length) {
        throw new DicomError(
            `PixelData holds ${raw.length} bytes, ${start + bytesPerFrame} needed for frame ${frameIndex}`,
            'truncated_pixels',
        );
    }

    return { raw, rows, columns, frames, samples, signed, bitsAllocated, start, bytesPerFrame };
}

/**
 * Read an ALREADY-RENDERED frame as RGBA — ultrasound, angiography, secondary
 * capture — where the device has done the windowing and what is stored is a
 * picture rather than a measurement.
 *
 * The distinction is not cosmetic, and the viewer must honour it:
 *
 *   - there is no modality LUT, so there are no Hounsfield units and nothing to
 *     probe. A number read off an echo is a brightness, not a density.
 *   - there is no window to adjust. Re-windowing a rendered image adjusts the
 *     manufacturer's rendering, not the data behind it.
 *   - distances are only measurable where the object says so. An echo carries
 *     its calibration in SequenceOfUltrasoundRegions rather than PixelSpacing,
 *     and without either, pixels are the only honest unit.
 *
 * Handles both planar configurations and the YBR encodings ultrasound actually
 * uses, because a YBR frame drawn as if it were RGB comes out green.
 *
 * @returns {{rows, columns, frames, rgba: Uint8ClampedArray, rendered: true}}
 */
export function readRenderedFrame(dicom, frameIndex = 0) {
    const { raw, rows, columns, frames, samples, bitsAllocated, start } = pixelLayout(dicom, frameIndex);
    if (samples !== 3) {
        throw new DicomError(`this image has ${samples} sample(s) per pixel; it is not a rendered colour image`, 'unsupported_pixels');
    }
    if (bitsAllocated !== 8) {
        throw new DicomError(`BitsAllocated=${bitsAllocated} for colour; only 8 is read`, 'unsupported_pixels');
    }

    const photometric = dicom.string('PhotometricInterpretation', 'RGB');
    const planar = dicom.number('PlanarConfiguration', 0) === 1;
    const pixels = rows * columns;
    const rgba = new Uint8ClampedArray(pixels * 4);

    // Planar (RRR…GGG…BBB) vs interleaved (RGBRGB…). Both are legal and both
    // occur; reading one as the other is a classic way to produce a colourful
    // image of nothing.
    const planeSize = planar ? pixels : 1;
    const stride = planar ? 1 : 3;

    const ybr = photometric.startsWith('YBR');
    for (let i = 0, j = 0; i < pixels; i++, j += 4) {
        const a = raw[start + (planar ? i : i * stride)];
        const b = raw[start + (planar ? planeSize + i : i * stride + 1)];
        const c = raw[start + (planar ? 2 * planeSize + i : i * stride + 2)];
        if (ybr) {
            // ITU-T T.871 full-range YCbCr, which is what YBR_FULL and the
            // decompressed form of YBR_FULL_422 both carry.
            const y = a;
            const cb = b - 128;
            const cr = c - 128;
            rgba[j] = y + 1.402 * cr;
            rgba[j + 1] = y - 0.344136 * cb - 0.714136 * cr;
            rgba[j + 2] = y + 1.772 * cb;
        } else {
            rgba[j] = a;
            rgba[j + 1] = b;
            rgba[j + 2] = c;
        }
        rgba[j + 3] = 255;
    }

    return { rows, columns, frames, rgba, rendered: true, photometric };
}

/**
 * Whether an object is an already-rendered picture rather than a measured
 * image. Callers use this to decide which reader to use, and the UI uses it to
 * hide window/level and HU readouts that would be meaningless.
 */
export function isRendered(dicom) {
    return dicom.number('SamplesPerPixel', 1) === 3;
}

/**
 * The modality LUT: stored -> real-world values (HU for CT).
 *
 * Slope defaults to 1 and intercept to 0, the identity the standard prescribes
 * when the attributes are absent (MR and US normally omit them).
 */
export function toRealValues({ stored }, { slope = 1, intercept = 0 } = {}) {
    // Identity is the common case for CR, DX, MR and US, and there the stored
    // array ALREADY holds the real-world values — copying it into a Float32Array
    // widens 2 bytes per pixel to 4 and buys nothing. On a 9-megapixel
    // radiograph that copy is 36 MB allocated and thrown away on every decode,
    // and the peak heap is what the multi-second GC pauses were made of.
    // Consumers only read `values` numerically, so the narrower array serves.
    if (slope === 1 && intercept === 0) return stored;

    const out = new Float32Array(stored.length);
    for (let i = 0; i < stored.length; i++) out[i] = stored[i] * slope + intercept;
    return out;
}

/** The modality-LUT parameters declared by an object, with standard defaults. */
export function rescaleOf(dicom) {
    return {
        slope: dicom.number('RescaleSlope', 1),
        intercept: dicom.number('RescaleIntercept', 0),
        units: dicom.string('RescaleType', dicom.string('Modality') === 'CT' ? 'HU' : 'US'),
    };
}

/**
 * Read a frame and apply the modality LUT in one call — the verb a viewer
 * actually wants, so no caller has to remember that the two steps are ordered.
 *
 * @returns {{ rows:number, columns:number, frames:number, values:Float32Array,
 *   units:string, min:number, max:number }}
 */
export function readRealFrame(dicom, frameIndex = 0) {
    const frame = readFrame(dicom, frameIndex);
    const rescale = rescaleOf(dicom);
    const values = toRealValues(frame, rescale);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
        if (values[i] < min) min = values[i];
        if (values[i] > max) max = values[i];
    }

    return {
        rows: frame.rows,
        columns: frame.columns,
        frames: frame.frames,
        values,
        units: rescale.units,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 0,
    };
}

/**
 * MONOCHROME1 stores *inverted* grayscale — the minimum value is white. It is
 * rare but real (some CR/mammography), and rendering it unhandled produces a
 * photographic negative of the study, which is the single most alarming way for
 * a viewer to be wrong.
 */
export function isInverted(dicom) {
    return dicom.string('PhotometricInterpretation', 'MONOCHROME2') === 'MONOCHROME1';
}
