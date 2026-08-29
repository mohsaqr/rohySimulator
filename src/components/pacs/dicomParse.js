/**
 * A DICOM Part 10 reader.
 *
 * Scope, stated honestly because a viewer that quietly mis-reads a study is
 * worse than one that refuses it:
 *
 *   PARSED   Implicit VR Little Endian, Explicit VR Little Endian, Explicit VR
 *            Big Endian, and Deflated Explicit VR LE metadata. Sequences of any
 *            nesting, defined or undefined length. Multi-frame images.
 *   PIXELS   Native (uncompressed) pixel data, 8/16 bit, signed or unsigned.
 *   REFUSED  Encapsulated pixel data (JPEG, JPEG-LS, JPEG 2000, RLE). The
 *            metadata still parses and the fragments are located, but decoding
 *            them needs a codec — an openjpeg/charls WASM build — that has no
 *            business in a package this size. `scripts/ingest.mjs` transcodes
 *            such studies to native on the way into the archive, which is the
 *            right place for it: variety belongs at ingest, not in every
 *            learner's browser.
 *
 * Nothing here touches the DOM, so the whole file runs under `node --test`.
 */

import { DICTIONARY, LONG_FORM_VRS, STRING_VRS, impliedVr, nameOf, tagOf } from './dicomDict.js';

export const TRANSFER_SYNTAX = Object.freeze({
    IMPLICIT_VR_LE: '1.2.840.10008.1.2',
    EXPLICIT_VR_LE: '1.2.840.10008.1.2.1',
    DEFLATED_EXPLICIT_VR_LE: '1.2.840.10008.1.2.1.99',
    EXPLICIT_VR_BE: '1.2.840.10008.1.2.2',
});

/** Transfer syntaxes whose pixel data is native (directly readable) . */
const NATIVE_SYNTAXES = new Set([
    TRANSFER_SYNTAX.IMPLICIT_VR_LE,
    TRANSFER_SYNTAX.EXPLICIT_VR_LE,
    TRANSFER_SYNTAX.DEFLATED_EXPLICIT_VR_LE,
    TRANSFER_SYNTAX.EXPLICIT_VR_BE,
]);

const UNDEFINED_LENGTH = 0xffffffff;
const TAG_ITEM = 'fffee000';
const TAG_ITEM_DELIM = 'fffee00d';
const TAG_SEQ_DELIM = 'fffee0dd';
const TAG_PIXEL_DATA = '7fe00010';

/**
 * A classed error so callers and tests can branch on the cause rather than on
 * message text, which changes. `code` is the contract.
 */
export class DicomError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'DicomError';
        this.code = code;
    }
}

const textDecoder = new TextDecoder('latin1');

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new DicomError('input must be a Uint8Array or ArrayBuffer', 'bad_input');
}

const hex4 = (n) => n.toString(16).padStart(4, '0');

/**
 * Read one element header at `pos`.
 * Returns { tag, vr, valueOffset, length, next } where `next` is where the
 * element's value ends — or null when the length is undefined and the caller
 * must scan for a delimiter.
 */
function readHeader(view, pos, explicit, le, end) {
    if (pos + 8 > end) throw new DicomError(`truncated element header at byte ${pos}`, 'truncated');
    const group = view.getUint16(pos, le);
    const element = view.getUint16(pos + 2, le);
    const tag = hex4(group) + hex4(element);

    // Item and delimiter tags never carry a VR, in either encoding.
    if (tag === TAG_ITEM || tag === TAG_ITEM_DELIM || tag === TAG_SEQ_DELIM) {
        const length = view.getUint32(pos + 4, le);
        return { tag, vr: 'NONE', valueOffset: pos + 8, length };
    }

    if (!explicit) {
        const length = view.getUint32(pos + 4, le);
        return { tag, vr: impliedVr(tag), valueOffset: pos + 8, length };
    }

    const vr = String.fromCharCode(view.getUint8(pos + 4), view.getUint8(pos + 5));
    if (LONG_FORM_VRS.has(vr)) {
        if (pos + 12 > end) throw new DicomError(`truncated long-form header at byte ${pos}`, 'truncated');
        return { tag, vr, valueOffset: pos + 12, length: view.getUint32(pos + 8, le) };
    }
    return { tag, vr, valueOffset: pos + 8, length: view.getUint16(pos + 6, le) };
}

/**
 * Parse elements in [start, end) into a Map keyed by tag.
 *
 * Undefined lengths are the trap this function exists to get right. The same
 * sentinel 0xFFFFFFFF means three different terminations:
 *   - on an SQ            -> items until (FFFE,E0DD)
 *   - on an item          -> elements until (FFFE,E00D)
 *   - on PixelData        -> fragments until (FFFE,E0DD), NOT a nested dataset
 * Treating the third like the first is the classic way to read an encapsulated
 * study as garbage instead of refusing it.
 */
function readElements(view, start, end, explicit, le, stopAtPixelData) {
    const elements = new Map();
    let pos = start;

    while (pos + 8 <= end) {
        const head = readHeader(view, pos, explicit, le, end);
        const { tag, vr, valueOffset } = head;
        let { length } = head;

        if (tag === TAG_ITEM_DELIM || tag === TAG_SEQ_DELIM) {
            return { elements, next: valueOffset };
        }

        if (tag === TAG_PIXEL_DATA && length === UNDEFINED_LENGTH) {
            const { fragments, next } = readFragments(view, valueOffset, end, le);
            elements.set(tag, { tag, vr, offset: valueOffset, length: 0, fragments, encapsulated: true });
            pos = next;
            continue;
        }

        if (vr === 'SQ' || (length === UNDEFINED_LENGTH && vr !== 'NONE')) {
            const { items, next } = readSequence(view, valueOffset, length, end, explicit, le);
            elements.set(tag, { tag, vr: 'SQ', offset: valueOffset, length: next - valueOffset, items });
            pos = next;
            continue;
        }

        if (length === UNDEFINED_LENGTH) {
            throw new DicomError(`undefined length on non-sequence ${nameOf(tag)}`, 'bad_length');
        }
        if (valueOffset + length > end) {
            throw new DicomError(`${nameOf(tag)} claims ${length} bytes but only ${end - valueOffset} remain`, 'truncated');
        }

        elements.set(tag, { tag, vr, offset: valueOffset, length });
        pos = valueOffset + length;

        if (stopAtPixelData && tag === TAG_PIXEL_DATA) break;
    }
    return { elements, next: pos };
}

function readSequence(view, start, seqLength, end, explicit, le) {
    const items = [];
    const limit = seqLength === UNDEFINED_LENGTH ? end : Math.min(start + seqLength, end);
    let pos = start;

    while (pos + 8 <= limit) {
        const group = view.getUint16(pos, le);
        const element = view.getUint16(pos + 2, le);
        const tag = hex4(group) + hex4(element);
        const length = view.getUint32(pos + 4, le);
        pos += 8;

        if (tag === TAG_SEQ_DELIM) return { items, next: pos };
        if (tag !== TAG_ITEM) throw new DicomError(`expected an item, found ${nameOf(tag)}`, 'bad_sequence');

        if (length === UNDEFINED_LENGTH) {
            const read = readElements(view, pos, limit, explicit, le, false);
            items.push(read.elements);
            pos = read.next;
        } else {
            const itemEnd = Math.min(pos + length, limit);
            items.push(readElements(view, pos, itemEnd, explicit, le, false).elements);
            pos = itemEnd;
        }
    }
    return { items, next: pos };
}

/** Encapsulated pixel data: a basic offset table item, then one item per fragment. */
function readFragments(view, start, end, le) {
    const fragments = [];
    let pos = start;
    let first = true;

    while (pos + 8 <= end) {
        const tag = hex4(view.getUint16(pos, le)) + hex4(view.getUint16(pos + 2, le));
        const length = view.getUint32(pos + 4, le);
        pos += 8;
        if (tag === TAG_SEQ_DELIM) return { fragments, next: pos };
        if (tag !== TAG_ITEM) throw new DicomError(`expected a pixel-data fragment, found ${nameOf(tag)}`, 'bad_sequence');
        // The first item is the basic offset table; it is not image data.
        if (!first || length > 0) {
            if (first) pos += length;
            else fragments.push({ offset: pos, length });
        }
        if (!first) pos += length;
        first = false;
    }
    return { fragments, next: pos };
}

/** Decode one element's value according to its VR. */
function decode(bytes, view, el, le) {
    const { vr, offset, length } = el;
    if (length === 0) return STRING_VRS.has(vr) ? [] : [];

    if (STRING_VRS.has(vr)) {
        const raw = textDecoder.decode(bytes.subarray(offset, offset + length));
        // Values are `\`-separated; trailing NUL/space is padding to an even length.
        return raw.split('\\').map((s) => s.replace(/[\0 ]+$/, '').replace(/^ +/, ''));
    }
    switch (vr) {
        case 'US': return Array.from({ length: length >> 1 }, (_, i) => view.getUint16(offset + i * 2, le));
        case 'SS': return Array.from({ length: length >> 1 }, (_, i) => view.getInt16(offset + i * 2, le));
        case 'UL': return Array.from({ length: length >> 2 }, (_, i) => view.getUint32(offset + i * 4, le));
        case 'SL': return Array.from({ length: length >> 2 }, (_, i) => view.getInt32(offset + i * 4, le));
        case 'FL': return Array.from({ length: length >> 2 }, (_, i) => view.getFloat32(offset + i * 4, le));
        case 'FD': return Array.from({ length: length >> 3 }, (_, i) => view.getFloat64(offset + i * 8, le));
        case 'AT': return Array.from({ length: length >> 2 }, (_, i) => hex4(view.getUint16(offset + i * 4, le)) + hex4(view.getUint16(offset + i * 4 + 2, le)));
        default: return null; // OB/OW/UN/OD/OF — binary, reached via bytes()
    }
}

/**
 * Read a DICOM Part 10 object.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{ stopBeforePixelData?: boolean }} [options] skip the pixel data when
 *   only metadata is wanted — indexing an archive of thousands of instances
 *   should not read gigabytes of pixels.
 * @returns {DicomObject}
 * @throws {DicomError} codes: bad_input, not_dicom, unsupported_syntax,
 *   truncated, bad_length, bad_sequence.
 */
export function parseDicom(input, options = {}) {
    const bytes = toBytes(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = (at) => bytes.length >= at + 4 && String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]) === 'DICM';

    let meta = new Map();
    let transferSyntax = TRANSFER_SYNTAX.IMPLICIT_VR_LE;
    let pos;

    if (magic(128)) {
        // The meta group is explicit VR little endian by definition, whatever
        // the dataset that follows is encoded as.
        const groupLen = readElements(view, 132, Math.min(bytes.length, 132 + 12), true, true, false).elements.get('00020000');
        if (!groupLen) throw new DicomError('file meta group length (0002,0000) is missing', 'not_dicom');
        const metaEnd = groupLen.offset + groupLen.length + view.getUint32(groupLen.offset, true);
        meta = readElements(view, 132, Math.min(metaEnd, bytes.length), true, true, false).elements;
        const tsEl = meta.get('00020010');
        if (tsEl) transferSyntax = decode(bytes, view, tsEl, true)[0];
        pos = Math.min(metaEnd, bytes.length);
    } else if (magic(0)) {
        throw new DicomError('DICM magic found at byte 0 without a 128-byte preamble', 'not_dicom');
    } else {
        // A bare dataset with no meta group. Sniff the encoding rather than
        // guess: at byte 0 an explicit-VR file has two uppercase letters where
        // an implicit-VR file has the low half of a 32-bit length.
        pos = 0;
        const looksExplicit = bytes.length > 6
            && bytes[4] >= 0x41 && bytes[4] <= 0x5a && bytes[5] >= 0x41 && bytes[5] <= 0x5a;
        transferSyntax = looksExplicit ? TRANSFER_SYNTAX.EXPLICIT_VR_LE : TRANSFER_SYNTAX.IMPLICIT_VR_LE;
    }

    if (transferSyntax === TRANSFER_SYNTAX.DEFLATED_EXPLICIT_VR_LE) {
        throw new DicomError('deflated transfer syntax must be inflated before parsing', 'unsupported_syntax');
    }

    const explicit = transferSyntax !== TRANSFER_SYNTAX.IMPLICIT_VR_LE;
    const le = transferSyntax !== TRANSFER_SYNTAX.EXPLICIT_VR_BE;
    const { elements } = readElements(view, pos, bytes.length, explicit, le, options.stopBeforePixelData === true);

    return makeObject({ bytes, view, meta, elements, transferSyntax, littleEndian: le });
}

/**
 * The parsed object. Methods rather than a bare map on purpose: a caller should
 * ask `study.number('Rows')` and get a number, not reach into an element record
 * and re-implement VR decoding at every call site.
 */
function makeObject({ bytes, view, meta, elements, transferSyntax, littleEndian }) {
    const resolve = (nameOrTag) => (DICTIONARY[nameOrTag] ? nameOrTag : tagOf(nameOrTag)) ?? nameOrTag;
    const find = (nameOrTag) => {
        const tag = resolve(nameOrTag);
        return elements.get(tag) ?? meta.get(tag);
    };

    return {
        transferSyntax,
        littleEndian,
        elements,
        meta,

        // The original file bytes. Named `buffer`, not `bytes`, because
        // `bytes(tag)` below is a method on this same object and a property of
        // the same name is silently shadowed by it — the property would simply
        // never be reachable, and any caller reading it would get a function.
        buffer: bytes,

        /** True when the attribute is present at the top level (or in the meta group). */
        has: (nameOrTag) => find(nameOrTag) !== undefined,

        /** The value representation actually used for this attribute, or undefined. */
        vr: (nameOrTag) => find(nameOrTag)?.vr,

        /** Every value of a multi-valued attribute, as strings. */
        strings(nameOrTag) {
            const el = find(nameOrTag);
            if (!el) return [];
            const v = decode(bytes, view, el, littleEndian);
            return v === null ? [] : v.map(String);
        },

        /** The first value as a string, or `fallback`. */
        string(nameOrTag, fallback = undefined) {
            const v = this.strings(nameOrTag);
            return v.length > 0 ? v[0] : fallback;
        },

        /** Every value as finite numbers; non-numeric values are dropped. */
        numbers(nameOrTag) {
            const el = find(nameOrTag);
            if (!el) return [];
            const v = decode(bytes, view, el, littleEndian);
            if (v === null) return [];
            return v.map((x) => (typeof x === 'number' ? x : Number.parseFloat(x))).filter(Number.isFinite);
        },

        /** The first value as a number, or `fallback` when absent or unparseable. */
        number(nameOrTag, fallback = undefined) {
            const v = this.numbers(nameOrTag);
            return v.length > 0 ? v[0] : fallback;
        },

        /** The raw bytes of an attribute — for pixel data and other binary VRs. */
        bytes(nameOrTag) {
            const el = find(nameOrTag);
            if (!el || el.encapsulated) return undefined;
            return bytes.subarray(el.offset, el.offset + el.length);
        },

        /** Items of a sequence attribute, each a further readable object. */
        sequence(nameOrTag) {
            const el = find(nameOrTag);
            if (!el || el.vr !== 'SQ') return [];
            return el.items.map((itemElements) => makeObject({
                bytes, view, meta: new Map(), elements: itemElements, transferSyntax, littleEndian,
            }));
        },

        /** True when pixel data is compressed and therefore not directly readable. */
        isEncapsulated: () => find(TAG_PIXEL_DATA)?.encapsulated === true,

        /** True when this transfer syntax stores pixels natively. */
        isNativePixelData: () => NATIVE_SYNTAXES.has(transferSyntax) && find(TAG_PIXEL_DATA)?.encapsulated !== true,

        /** Dictionary names of every top-level attribute — for diagnostics. */
        attributeNames: () => Array.from(elements.keys()).map(nameOf),
    };
}
