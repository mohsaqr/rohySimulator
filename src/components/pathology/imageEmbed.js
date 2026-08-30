/**
 * Putting a photograph from someone's computer into a case.
 *
 * Adding a gross photograph should mean choosing the file, not publishing it
 * somewhere first and pasting a URL. There is no upload service here, so the
 * picture travels inside the case itself as a `data:` URL — which the schema
 * already allows (`source.kind: 'embedded'`), and which `.pathcase` packaging
 * already handles, because a data URL is text.
 *
 * That only works if the file is a sensible size, so every picture is redrawn
 * through a canvas at a bounded longest edge before it is encoded. A 12 MP
 * phone photograph of a specimen board carries no more teaching information at
 * 4032px than at 1600px, and the difference is 6 MB versus 300 KB — the
 * difference between a case that fits in browser storage and one that does not.
 */

/** Beyond this a case stops fitting comfortably in localStorage. */
export const MAX_EMBEDDED_BYTES = 4 * 1024 * 1024;
/** Refuse unusually large compressed inputs before asking an image codec to decode them. */
export const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;
/** A second guard for pathological dimensions reported by the decoded bitmap. */
export const MAX_SOURCE_IMAGE_PIXELS = 100 * 1024 * 1024;

/** Longest edge kept by default. Gross photography is a whole-object view. */
export const DEFAULT_MAX_EDGE = 1600;

const positive = (value, label, who) => {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${who}: ${label} must be a positive number, received ${JSON.stringify(value)}.`);
    }
    return value;
};

/**
 * The size a picture is redrawn at, preserving aspect ratio.
 *
 * An image already within the bound is left exactly as it is rather than
 * resampled, because re-encoding a small picture only loses detail.
 *
 * @returns {{width:number, height:number, scaled:boolean}}
 */
export function fittedSize({ width, height, maxEdge = DEFAULT_MAX_EDGE }) {
    positive(width, 'width', 'fittedSize()');
    positive(height, 'height', 'fittedSize()');
    positive(maxEdge, 'maxEdge', 'fittedSize()');
    const longest = Math.max(width, height);
    if (longest <= maxEdge) return { width, height, scaled: false };
    const scale = maxEdge / longest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        scaled: true,
    };
}

/** A rough decoded size for a data URL, for reporting and for the size guard. */
export function dataUrlBytes(uri) {
    if (typeof uri !== 'string') throw new TypeError('dataUrlBytes(): uri must be a string.');
    const payload = uri.slice(uri.indexOf(',') + 1);
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/**
 * Read one picked image file and return the `data:` URL a case can carry.
 *
 * Browser-only: it needs `createImageBitmap` and a canvas. Kept in its own
 * module so the pure sizing rule above stays testable without a DOM — and so
 * this file can say `document` and mean the global one.
 *
 * @param {File} file
 * @returns {Promise<{uri:string, width:number, height:number, scaled:boolean, bytes:number}>}
 */
export async function embedImageFile(file, {
    maxEdge = DEFAULT_MAX_EDGE, quality = 0.85, maxBytes = MAX_EMBEDDED_BYTES,
    maxSourceBytes = MAX_SOURCE_IMAGE_BYTES, maxSourcePixels = MAX_SOURCE_IMAGE_PIXELS,
} = {}) {
    if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
        throw new TypeError(`“${file?.name ?? 'that file'}” is not an image. Choose a JPEG, PNG, HEIC or WebP photograph.`);
    }
    positive(maxSourceBytes, 'maxSourceBytes', 'embedImageFile()');
    positive(maxSourcePixels, 'maxSourcePixels', 'embedImageFile()');
    if (Number.isFinite(file.size) && file.size > maxSourceBytes) {
        throw new RangeError(
            `“${file.name}” is ${Math.round(file.size / 1024 / 1024)} MB, above the ${Math.round(maxSourceBytes / 1024 / 1024)} MB source-image limit.`,
        );
    }
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width * bitmap.height > maxSourcePixels) {
            throw new RangeError(
                `“${file.name}” expands to ${bitmap.width} × ${bitmap.height} pixels, above the safe decode limit.`,
            );
        }
        const target = fittedSize({ width: bitmap.width, height: bitmap.height, maxEdge });
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser did not provide a 2D canvas context.');
        context.drawImage(bitmap, 0, 0, target.width, target.height);
        const uri = canvas.toDataURL('image/jpeg', quality);
        const bytes = dataUrlBytes(uri);
        if (bytes > maxBytes) {
            throw new RangeError(
                `“${file.name}” is still ${Math.round(bytes / 1024)} KB after resizing, over the ${Math.round(maxBytes / 1024)} KB a case can carry. Crop it or save it at a lower quality first.`,
            );
        }
        return { uri, ...target, bytes };
    } finally {
        bitmap.close?.();
    }
}
