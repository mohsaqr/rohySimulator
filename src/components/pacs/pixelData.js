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

    const samples = dicom.number('SamplesPerPixel', 1);
    if (samples !== 1) {
        throw new DicomError(`SamplesPerPixel=${samples}; only single-sample (grayscale) images are read`, 'unsupported_pixels');
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

    const perFrame = rows * columns;
    const bytesPerFrame = perFrame * (bitsAllocated / 8);
    const start = frameIndex * bytesPerFrame;
    if (start + bytesPerFrame > raw.length) {
        throw new DicomError(
            `PixelData holds ${raw.length} bytes, ${start + bytesPerFrame} needed for frame ${frameIndex}`,
            'truncated_pixels',
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
        stored = signed ? new Int16Array(perFrame) : new Uint16Array(perFrame);
        for (let i = 0; i < perFrame; i++) {
            stored[i] = signed ? dv.getInt16(i * 2, le) : dv.getUint16(i * 2, le);
        }
    }

    return { rows, columns, frames, signed, bitsAllocated, stored };
}

/**
 * The modality LUT: stored -> real-world values (HU for CT).
 *
 * Slope defaults to 1 and intercept to 0, the identity the standard prescribes
 * when the attributes are absent (MR and US normally omit them).
 */
export function toRealValues({ stored }, { slope = 1, intercept = 0 } = {}) {
    const out = new Float32Array(stored.length);
    // Identity is by far the common case for MR/US; skipping the arithmetic
    // keeps a 512x512x300 series from doing 78 million pointless multiplies.
    if (slope === 1 && intercept === 0) {
        out.set(stored);
        return out;
    }
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
