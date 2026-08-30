/**
 * DICOM RLE decompression (transfer syntax 1.2.840.10008.1.2.5).
 *
 * RLE is worth implementing here — unlike JPEG, which the browser already
 * decodes far better than any JavaScript could — because it is simple, lossless
 * and has no platform decoder at all. Ultrasound and secondary capture use it.
 *
 * The format is PS3.5 Annex G: a 64-byte header of 16 big-endian offsets, then
 * up to 15 independently PackBits-compressed segments. The segment layout is
 * the part that catches people out: segments are per BYTE, not per sample. An
 * 8-bit RGB image has three segments (R, G, B); a 16-bit grayscale image has
 * two (high byte, low byte); a 16-bit RGB image has six. So the decoder cannot
 * know what the segments mean without being told the pixel layout.
 */

import { DicomError } from './dicomParse.js';

const HEADER_SEGMENTS = 15;

/**
 * Decompress one RLE frame into its constituent byte segments.
 *
 * @param {Uint8Array} data the frame's encapsulated bytes
 * @param {number} pixels rows * columns — how long each segment must be
 * @returns {Uint8Array[]} one buffer per segment, in header order
 */
export function decodeRleSegments(data, pixels) {
    if (!(data?.length >= 64)) {
        throw new DicomError('RLE frame is shorter than its 64-byte header', 'bad_rle');
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // The header is little-endian despite the rest of the format's conventions
    // (PS3.5 G.5): the count and offsets are unsigned long, little endian.
    const count = view.getUint32(0, true);
    if (!(count >= 1 && count <= HEADER_SEGMENTS)) {
        throw new DicomError(`RLE header declares ${count} segments; 1 to 15 are legal`, 'bad_rle');
    }

    const segments = [];
    for (let i = 0; i < count; i++) {
        const start = view.getUint32(4 + i * 4, true);
        const nextOffset = i + 1 < count ? view.getUint32(4 + (i + 1) * 4, true) : data.length;
        if (!(start >= 64 && start <= data.length) || nextOffset < start) {
            throw new DicomError(`RLE segment ${i} has an offset outside the frame`, 'bad_rle');
        }
        segments.push(unpackBits(data.subarray(start, nextOffset), pixels));
    }
    return segments;
}

/**
 * PackBits, as PS3.5 G.3 defines it.
 *
 * A control byte n: 0..127 means the next n+1 bytes are literal; 129..255 means
 * repeat the next byte 257-n times; 128 is a no-op and terminates nothing.
 * Decoding stops at `expected` bytes rather than at the end of input, because a
 * segment is allowed to be padded to an even length.
 */
function unpackBits(input, expected) {
    const out = new Uint8Array(expected);
    let read = 0;
    let written = 0;

    while (read < input.length && written < expected) {
        const control = input[read++];
        if (control === 128) continue;              // no-op
        if (control < 128) {
            const literal = control + 1;
            for (let i = 0; i < literal && written < expected; i++) {
                if (read >= input.length) break;
                out[written++] = input[read++];
            }
        } else {
            if (read >= input.length) break;
            const value = input[read++];
            for (let i = 0, n = 257 - control; i < n && written < expected; i++) out[written++] = value;
        }
    }
    // Short output is reported, not padded silently: a truncated segment means
    // the rest of the image would be a run of zeros that looks like anatomy.
    if (written < expected) {
        throw new DicomError(`RLE segment produced ${written} of ${expected} bytes`, 'bad_rle');
    }
    return out;
}

/**
 * Reassemble RLE segments into a pixel buffer.
 *
 * @param {Uint8Array[]} segments as returned by decodeRleSegments
 * @param {{rows, columns, samples, bitsAllocated}} layout
 * @returns {Uint8Array} interleaved samples, high byte first within each sample
 */
export function composeRle(segments, { rows, columns, samples = 1, bitsAllocated = 8 }) {
    const pixels = rows * columns;
    const bytesPerSample = bitsAllocated / 8;
    const expected = samples * bytesPerSample;
    if (segments.length !== expected) {
        throw new DicomError(
            `RLE holds ${segments.length} segments; ${samples} sample(s) at ${bitsAllocated} bits needs ${expected}`,
            'bad_rle',
        );
    }

    const out = new Uint8Array(pixels * expected);
    for (let p = 0; p < pixels; p++) {
        for (let s = 0; s < samples; s++) {
            for (let b = 0; b < bytesPerSample; b++) {
                // Segments run most-significant byte first (PS3.5 G.2), while
                // the composed buffer is little-endian to match every other
                // native pixel path in this package.
                const segment = segments[s * bytesPerSample + b];
                out[(p * samples + s) * bytesPerSample + (bytesPerSample - 1 - b)] = segment[p];
            }
        }
    }
    return out;
}
