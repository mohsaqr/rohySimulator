/**
 * Compressed pixel data: RLE here, JPEG delegated to the browser.
 *
 * Writing a JPEG decoder in JavaScript would be a mistake. Every browser ships
 * one that is faster than anything achievable here, is hardware-accelerated on
 * most machines, and has been attacked and fixed for twenty years. So a JPEG
 * frame is handed to `createImageBitmap` as a Blob and the platform does it.
 *
 * That has one consequence the rest of the package has to accommodate: the
 * browser's decoder is ASYNCHRONOUS. Native pixel data decodes synchronously
 * inside a render, compressed data cannot, so a compressed frame arrives the
 * way a fetched slice arrives — requested, awaited, then rendered.
 *
 * What is NOT handled, and why it is stated rather than attempted:
 *
 *   JPEG 2000 (…4.90/.91)  no browser decodes it. Needs a WASM build of
 *                          OpenJPEG — real work, and a large dependency.
 *   JPEG-LS  (…4.80/.81)   likewise; no platform decoder exists.
 *
 * Both are reported by name rather than failing obscurely, because "your
 * archive is unreadable" is a much worse message than "this transfer syntax
 * needs a decoder Radoyon does not bundle".
 */

import { DicomError, TRANSFER_SYNTAX } from './dicomParse.js';
import { composeRle, decodeRleSegments } from './rle.js';

/** Transfer syntaxes the browser's image decoder can take as a Blob. */
const BROWSER_JPEG = new Set([
    '1.2.840.10008.1.2.4.50',   // JPEG Baseline (Process 1), 8-bit
    '1.2.840.10008.1.2.4.51',   // JPEG Extended (Process 2 & 4), 12-bit
]);

const RLE = '1.2.840.10008.1.2.5';

const UNSUPPORTED = new Map([
    ['1.2.840.10008.1.2.4.57', 'JPEG Lossless (Process 14)'],
    ['1.2.840.10008.1.2.4.70', 'JPEG Lossless, First-Order Prediction'],
    ['1.2.840.10008.1.2.4.80', 'JPEG-LS Lossless'],
    ['1.2.840.10008.1.2.4.81', 'JPEG-LS Near-Lossless'],
    ['1.2.840.10008.1.2.4.90', 'JPEG 2000 Lossless'],
    ['1.2.840.10008.1.2.4.91', 'JPEG 2000'],
    ['1.2.840.10008.1.2.4.100', 'MPEG-2'],
    ['1.2.840.10008.1.2.4.101', 'MPEG-2 High Profile'],
    ['1.2.840.10008.1.2.4.102', 'MPEG-4 AVC/H.264'],
]);

/** Whether a compressed frame can be decoded in this build, and how. */
export function compressionSupport(transferSyntax) {
    if (transferSyntax === RLE) return { supported: true, how: 'rle', async: false };
    if (BROWSER_JPEG.has(transferSyntax)) return { supported: true, how: 'jpeg', async: true };
    const name = UNSUPPORTED.get(transferSyntax);
    return { supported: false, how: null, async: false, name: name ?? transferSyntax };
}

/**
 * Decode one compressed frame.
 *
 * Always async, even for RLE, so callers have one code path rather than two.
 *
 * @returns {Promise<{rows, columns, frames, rgba?: Uint8ClampedArray,
 *   stored?: Uint8Array, samples: number, bitsAllocated: number}>}
 */
export async function decodeCompressedFrame(dicom, frameIndex = 0) {
    if (!dicom.isEncapsulated()) {
        // Saying "1.2.840.10008.1.2.1 is not decoded by this build" about
        // uncompressed data would be doubly wrong: it IS readable, just not by
        // this path.
        throw new DicomError(
            'this object\'s pixel data is not compressed; read it with readFrame() or readRenderedFrame()',
            'not_compressed',
        );
    }

    const support = compressionSupport(dicom.transferSyntax);
    if (!support.supported) {
        throw new DicomError(
            `${support.name} is not decoded by this build; transcode the archive to an `
            + 'uncompressed transfer syntax, or to JPEG baseline, first',
            'unsupported_syntax',
        );
    }

    const data = dicom.frameFragments(frameIndex);
    if (!data) throw new DicomError('the object carries no encapsulated pixel data', 'missing_pixels');

    const rows = dicom.number('Rows');
    const columns = dicom.number('Columns');
    const samples = dicom.number('SamplesPerPixel', 1);
    const bitsAllocated = dicom.number('BitsAllocated', 8);
    const frames = Math.max(1, Math.trunc(dicom.number('NumberOfFrames', 1)));

    if (support.how === 'rle') {
        const stored = composeRle(decodeRleSegments(data, rows * columns), { rows, columns, samples, bitsAllocated });
        return { rows, columns, frames, stored, samples, bitsAllocated };
    }

    return { rows, columns, frames, samples, bitsAllocated, rgba: await decodeJpeg(data, rows, columns) };
}

/**
 * A JPEG frame, through the platform's decoder.
 *
 * `createImageBitmap` is used rather than an <img> element because it is
 * available in workers, does not touch the DOM, and reports failure as a
 * rejected promise instead of an event nobody is listening for.
 */
async function decodeJpeg(data, rows, columns) {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
        throw new DicomError(
            'JPEG frames need the browser image decoder (createImageBitmap); this environment has none',
            'no_decoder',
        );
    }
    // A copy, because the Blob must own bytes that outlive this call and `data`
    // is a view onto the whole file.
    const blob = new Blob([data.slice()], { type: 'image/jpeg' });
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch (error) {
        throw new DicomError(`the browser refused this JPEG frame: ${error.message}`, 'bad_jpeg');
    }
    try {
        if (bitmap.width !== columns || bitmap.height !== rows) {
            // Not fatal on its own, but it means the header and the pixels
            // disagree, and every measurement would be scaled by the difference.
            throw new DicomError(
                `the JPEG frame is ${bitmap.width}x${bitmap.height} but the header says ${columns}x${rows}`,
                'bad_jpeg',
            );
        }
        const canvas = new OffscreenCanvas(columns, rows);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, columns, rows).data;
    } finally {
        bitmap.close?.();
    }
}

export { TRANSFER_SYNTAX };
