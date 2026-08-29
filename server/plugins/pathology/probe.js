/**
 * What a slide file actually is — optics, dimensions and pyramid levels.
 *
 * Ported from the Python asset service (`asset_service/pathoyon_assets/probe.py`
 * and `processor.py`), which stays as the behavioural reference. The rules are
 * carried over verbatim; the language changed so a host that already runs Node
 * does not also have to run a Python service to accept a slide.
 *
 * NOTHING HERE GUESSES. That is the single design rule. OpenSlide exposes
 * `openslide.objective-power` and `openslide.mpp-x/y` only for vendors that
 * wrote them, and a slide whose optics are absent is NOT a slide with default
 * optics: every measurement a reader makes would be wrong by an unknown factor.
 * 40x / 0.25 µm-px is the most plausible guess and therefore the most dangerous
 * one, so an unknown stays unknown and the author is asked.
 */

/** `openslide.level[N].width|height|downsample` */
const LEVEL_RE = /^openslide\.level\[(\d+)\]\.(width|height|downsample)$/;

/** Header keys worth keeping. An allowlist, not a filter: `vipsheader -a` on a
 *  slide prints hundreds of vendor properties, some of them patient-adjacent
 *  (`aperio.Title`, label images, barcodes). Only these are read. */
const SCALAR_KEYS = new Set([
    'width', 'height', 'openslide.vendor', 'openslide.level-count',
    'openslide.mpp-x', 'openslide.mpp-y', 'openslide.objective-power',
    'vips-loader',
]);

/** A finite positive number, or null. Rejects booleans, NaN, Infinity, '', '0'. */
function positiveNumber(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Parse `vipsheader -a` output into the shape the rest of the import uses.
 *
 * @param {string} output
 * @returns {{slideWidthPx: number, slideHeightPx: number, vendor: string|null,
 *            loader: string|null, nativeObjective: number|null,
 *            nativeMppX: number|null, nativeMppY: number|null,
 *            levels: Array<{index: number, width: number, height: number, downsample: number}>}}
 * @throws {Error} when the output carries no usable dimensions
 */
export function parseVipsHeader(output) {
    const values = new Map();
    const levels = new Map();

    String(output).split('\n').forEach((line) => {
        const at = line.indexOf(': ');
        if (at < 0) return;
        const key = line.slice(0, at);
        const value = line.slice(at + 2);
        const level = LEVEL_RE.exec(key);
        if (level) {
            const index = Number(level[1]);
            const entry = levels.get(index) ?? {};
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
                throw new Error(`OpenSlide property ${key} is not numeric: '${value}'`);
            }
            entry[level[2]] = parsed;
            levels.set(index, entry);
        } else if (SCALAR_KEYS.has(key)) {
            values.set(key, value);
        }
    });

    const slideWidthPx = positiveNumber(values.get('width'));
    const slideHeightPx = positiveNumber(values.get('height'));
    if (slideWidthPx === null || slideHeightPx === null) {
        throw new Error('vipsheader did not report finite slide dimensions');
    }

    // Only levels with all three fields. A partially-reported level would make
    // chooseLevel divide by undefined and silently produce NaN.
    const ordered = [...levels.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, l]) => Number.isFinite(l.width) && Number.isFinite(l.height) && Number.isFinite(l.downsample))
        .map(([index, l]) => ({ index, width: l.width, height: l.height, downsample: l.downsample }));

    return {
        slideWidthPx,
        slideHeightPx,
        vendor: values.get('openslide.vendor') ?? null,
        loader: values.get('vips-loader') ?? null,
        nativeObjective: positiveNumber(values.get('openslide.objective-power')),
        nativeMppX: positiveNumber(values.get('openslide.mpp-x')),
        nativeMppY: positiveNumber(values.get('openslide.mpp-y')),
        levels: ordered,
    };
}

/**
 * Can this slide drive scale and level-0 coordinates?
 *
 * All five must be present and positive. A reader that can measure needs both
 * the magnification and the micrometres per pixel; either alone is not enough.
 *
 * @param {object} metadata from parseVipsHeader
 * @returns {boolean}
 */
export function hasCalibration(metadata) {
    return ['slideWidthPx', 'slideHeightPx', 'nativeObjective', 'nativeMppX', 'nativeMppY']
        .every((field) => {
            const value = metadata?.[field];
            return typeof value === 'number' && Number.isFinite(value) && value > 0;
        });
}

/**
 * The strongest pyramid level whose effective objective does not exceed the
 * target. Never upsamples — a 10x target on a 20x-native slide takes level 0
 * rather than inventing magnification the scanner never captured.
 *
 * @param {object} metadata           from parseVipsHeader
 * @param {number|null} targetObjective  null keeps the native level
 * @returns {{index: number, width: number, height: number, downsample: number}}
 * @throws {Error} when a target is asked for and the scanner recorded no objective
 */
export function chooseLevel(metadata, targetObjective) {
    const levels = metadata?.levels ?? [];
    if (levels.length === 0) {
        return {
            index: 0,
            downsample: 1,
            width: metadata.slideWidthPx,
            height: metadata.slideHeightPx,
        };
    }
    if (targetObjective === null || targetObjective === undefined) return levels[0];
    if (typeof targetObjective !== 'number' || !Number.isFinite(targetObjective) || targetObjective <= 0) {
        throw new Error('targetObjective must be a finite positive number');
    }
    const native = metadata?.nativeObjective;
    if (typeof native !== 'number' || !(native > 0)) {
        throw new Error('a target objective requires scanner objective metadata');
    }
    // 1e-9 slack: a 40x slide with downsample exactly 4 is 10.000000000000002x
    // in binary floating point, and an exact `<=` would skip the level that is
    // precisely the one asked for.
    const candidates = levels.filter((l) => native / l.downsample <= targetObjective * (1 + 1e-9));
    if (candidates.length === 0) return levels[levels.length - 1];
    return candidates.reduce((best, l) => (native / l.downsample > native / best.downsample ? l : best));
}

/**
 * Refuse a slide that would be tiled by decoding a full-resolution plane.
 *
 * The measurement behind this: tiling reads a pyramid level the scanner already
 * wrote, which is why a 2.1 GB NDPI tiles in seconds at ~370 MB RSS. A file with
 * NO pyramid gives libvips nothing to read but level 0, and peak memory rises
 * with the full frame rather than with the tile buffers. On a 3 GB server that
 * is an OOM kill, and an OOM-killed tiler leaves a partial pyramid that looks
 * exactly like a finished one.
 *
 * So a single-level image above the pixel budget is declined UP FRONT with a
 * reason, rather than attempted and discovered by the kernel.
 *
 * @param {object} metadata
 * @param {number} [maxSingleLevelPixels] default 2 gigapixels
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function tilingIsAffordable(metadata, maxSingleLevelPixels = 2e9) {
    const levels = metadata?.levels ?? [];
    if (levels.length > 1) return { ok: true };
    const pixels = metadata.slideWidthPx * metadata.slideHeightPx;
    if (pixels <= maxSingleLevelPixels) return { ok: true };
    return {
        ok: false,
        reason: `this file has no pyramid, so tiling would decode all ${Math.round(pixels / 1e6)} megapixels at once`,
    };
}
