/**
 * Whole-slide thumbnails, taken from the pyramid that is already there.
 *
 * A Deep Zoom pyramid stores every level down to 1x1 px. Below the point where
 * the image stops needing more than one tile, each level IS a complete picture
 * of the slide, stored as the single tile `0_0.<format>`. Taking the LARGEST
 * such level gives the biggest whole-slide overview that costs exactly one
 * request — typically a few tens of kilobytes.
 *
 * That matters because it needs no server-side thumbnailer, no second asset to
 * pin, and no catalog: it works for a slide an author pasted in as a bare DZI
 * URL exactly as well as for one the asset service produced.
 *
 * Deep Zoom numbers levels from 0 (a single 1x1 tile) up to
 * `ceil(log2(max(width, height)))` (full resolution), and level L is the image
 * scaled by `2^(maxLevel - L)`.
 */

const DZI_SUFFIX = /\.dzi(?=$|[?#])/i;

function positiveInteger(value, label, who) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
        throw new RangeError(`${who}: ${label} must be a positive integer, received ${JSON.stringify(value)}.`);
    }
    return value;
}

/**
 * Read the handful of numbers a DZI descriptor carries.
 *
 * Parsed with a regular expression rather than DOMParser on purpose: the format
 * is four attributes fixed by the Deep Zoom spec, and keeping this module free
 * of the DOM is what lets it be tested without a browser.
 *
 * @param {string} xml the `.dzi` document as text
 * @returns {{width:number, height:number, tileSize:number, overlap:number, format:string}}
 */
export function parseDziDescriptor(xml) {
    if (typeof xml !== 'string' || xml.trim() === '') {
        throw new TypeError('parseDziDescriptor(): expected the .dzi document as a non-empty string.');
    }
    const attribute = (name) => xml.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? null;
    const numeric = (name) => {
        const raw = attribute(name);
        if (raw === null) throw new RangeError(`parseDziDescriptor(): the descriptor has no ${name} attribute.`);
        return positiveInteger(Number(raw), name, 'parseDziDescriptor()');
    };
    const overlapText = attribute('Overlap');
    const overlap = overlapText === null ? 0 : Number(overlapText);
    if (!Number.isFinite(overlap) || overlap < 0) {
        throw new RangeError(`parseDziDescriptor(): Overlap must be zero or positive, received ${JSON.stringify(overlapText)}.`);
    }
    const format = (attribute('Format') ?? 'jpg').toLowerCase();
    if (!/^[a-z0-9]+$/.test(format)) {
        throw new RangeError(`parseDziDescriptor(): Format must be a plain tile extension, received ${JSON.stringify(format)}.`);
    }
    return { width: numeric('Width'), height: numeric('Height'), tileSize: numeric('TileSize'), overlap, format };
}

/**
 * The largest pyramid level that still fits in a single tile.
 *
 * @returns {{level:number, width:number, height:number}} level and its pixel size
 */
export function dziThumbnailLevel({ width, height, tileSize }) {
    positiveInteger(width, 'width', 'dziThumbnailLevel()');
    positiveInteger(height, 'height', 'dziThumbnailLevel()');
    positiveInteger(tileSize, 'tileSize', 'dziThumbnailLevel()');
    const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
    // Walk down from full resolution; the first level that fits in one tile is
    // by definition the largest one that does.
    const found = Array.from({ length: maxLevel + 1 }, (_, index) => maxLevel - index)
        .map((level) => {
            const scale = 2 ** (maxLevel - level);
            return { level, width: Math.ceil(width / scale), height: Math.ceil(height / scale) };
        })
        .find((entry) => entry.width <= tileSize && entry.height <= tileSize);
    // Level 0 is a single 1x1 tile, so a fit always exists.
    if (!found) throw new RangeError('dziThumbnailLevel(): no single-tile level exists, which a Deep Zoom pyramid guarantees.');
    return found;
}

/**
 * The URL of that single tile, derived from the descriptor's own URL.
 *
 * @param {string} dziUrl     the `.dzi` URL, optionally with a query or hash
 * @param {object} descriptor the parsed descriptor
 * @returns {string} a tile URL such as `/slides/my_s360_files/9/0_0.jpg`
 */
export function dziThumbnailUrl(dziUrl, descriptor) {
    if (typeof dziUrl !== 'string' || !DZI_SUFFIX.test(dziUrl)) {
        throw new TypeError(`dziThumbnailUrl(): expected a .dzi URL, received ${JSON.stringify(dziUrl)}.`);
    }
    const { level } = dziThumbnailLevel(descriptor);
    return dziUrl.replace(DZI_SUFFIX, `_files/${level}/0_0.${descriptor.format}`);
}

/** The tiled rendition a case asset pins, or null when it has none. */
export function assetDziUrl(asset) {
    const uri = asset?.renditions?.find((rendition) => rendition.kind === 'dzi')?.uri;
    return typeof uri === 'string' && uri !== '' ? uri : null;
}
