/**
 * GeoJSON interchange, in QuPath's dialect.
 *
 * WHY GeoJSON and not W3C Web Annotation: in digital pathology the de facto
 * interchange format is QuPath's GeoJSON. Its coordinates are pixels of the
 * FULL-RESOLUTION image with the origin at the top-left — which is precisely
 * the slide (level-0) space this package already stores annotations in, so the
 * export is a re-encoding, not a re-projection. That alignment is not luck: it
 * is why slide space was chosen over the served archive level in the first
 * place. Web Annotation, by contrast, describes selectors against a specific
 * served image, so every export would have to bake in whichever pyramid level
 * happened to be deployed that week.
 *
 * WHAT SURVIVES A ROUND TRIP THROUGH QUPATH, AND WHAT DOES NOT:
 * GeoJSON has no ellipse and no arrow. QuPath degrades its own ellipses to
 * polygons for the same reason. Rather than silently lose that, each feature
 * also carries a namespaced `rohyPathology` property block holding the true
 * kind, the tally and the frame's nominal area. QuPath ignores unknown
 * properties, so the file opens there normally; re-importing it HERE restores
 * the exact shape. A file that has been through QuPath and back loses the
 * extras and degrades to polygons — which is honest, and visible, rather than
 * a silent change of meaning.
 */

import {
    ANNOTATION_KINDS,
    annotationVertices,
    createAnnotation,
} from './annotationModel.js';

/** Namespaced property key, so nothing here can collide with QuPath's own. */
const EXTRA = 'rohyPathology';

/** Kinds stored as a closed GeoJSON Polygon. */
const AREAL_KINDS = new Set([
    ANNOTATION_KINDS.RECTANGLE,
    ANNOTATION_KINDS.ELLIPSE,
    ANNOTATION_KINDS.POLYGON,
    ANNOTATION_KINDS.FREEHAND,
    ANNOTATION_KINDS.COUNTING_FRAME,
]);

/**
 * Pack "#RRGGBB" into the signed 32-bit ARGB integer QuPath expects.
 *
 * QuPath stores classification colours as Java `Color.getRGB()` values, which
 * are ARGB packed into a SIGNED int — so an opaque colour always comes out
 * negative. Java's Color.RED.getRGB() is -65536, and this function reproduces
 * that; the test asserts it, because a colour written as an unsigned
 * 4,294,901,760 is read by QuPath as an entirely different value.
 *
 * @param {string} hex  "#RRGGBB"
 * @returns {number} signed 32-bit ARGB
 */
export function hexToColorRGB(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!m) {
        throw new TypeError(`hexToColorRGB(): expected a "#RRGGBB" string, received ${JSON.stringify(hex)}`);
    }
    const rgb = parseInt(m[1], 16);
    // JS bitwise operators coerce to int32, so ORing in the alpha byte yields
    // the signed value directly — no manual wraparound arithmetic.
    return (0xff << 24) | rgb;
}

/**
 * Unpack a QuPath signed ARGB integer back to "#RRGGBB".
 *
 * @param {number} value
 * @returns {string}
 */
export function colorRGBToHex(value) {
    if (!Number.isInteger(value)) {
        throw new TypeError(`colorRGBToHex(): expected an integer, received ${JSON.stringify(value)}`);
    }
    // >>> 0 lifts the signed int back into the unsigned range before masking.
    const rgb = (value >>> 0) & 0xffffff;
    return `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`;
}

/**
 * One annotation as a GeoJSON Feature.
 *
 * @param {object} annotation
 * @returns {object} Feature
 */
export function annotationToFeature(annotation) {
    const vertices = annotationVertices(annotation);
    const coords = vertices.map((p) => [p.x, p.y]);

    let geometry;
    if (annotation.kind === ANNOTATION_KINDS.POINT) {
        geometry = { type: 'Point', coordinates: coords[0] };
    } else if (AREAL_KINDS.has(annotation.kind)) {
        // A GeoJSON Polygon's linear ring MUST repeat its first position as
        // its last. Omitting it produces a file that many parsers accept and
        // QuPath rejects, which is the worst kind of nearly-valid.
        geometry = { type: 'Polygon', coordinates: [[...coords, coords[0]]] };
    } else {
        geometry = { type: 'LineString', coordinates: coords };
    }

    return {
        type: 'Feature',
        id: annotation.id,
        geometry,
        properties: {
            // QuPath 0.4+ reads objectType; 0.2/0.3 read the "PathAnnotationObject"
            // id convention. Writing both costs one string and opens in either.
            objectType: 'annotation',
            name: annotation.text || null,
            classification: annotation.classification
                ? {
                    name: annotation.classification.name,
                    colorRGB: hexToColorRGB(annotation.classification.color),
                }
                : null,
            isLocked: false,
            measurements: [],
            [EXTRA]: {
                kind: annotation.kind,
                slideId: annotation.slideId,
                // Only the two corners are stored for a rect/ellipse/frame, so
                // the exact shape can be rebuilt without re-fitting a 64-gon.
                storedPoints: annotation.points.map((p) => [p.x, p.y]),
                tally: annotation.tally,
                targetAreaMm2: annotation.targetAreaMm2,
                createdAtMs: annotation.createdAtMs,
                updatedAtMs: annotation.updatedAtMs,
            },
        },
    };
}

/**
 * A whole slide's annotations as a GeoJSON FeatureCollection.
 *
 * @param {Array<object>} annotations
 * @param {object} [meta]  slide identification carried alongside, so a file
 *                         found on disk says which scan it belongs to
 * @returns {object} FeatureCollection
 */
export function toGeoJSON(annotations, meta = {}) {
    if (!Array.isArray(annotations)) {
        throw new TypeError(`toGeoJSON(): expected an array of annotations, received ${typeof annotations}`);
    }
    return {
        type: 'FeatureCollection',
        features: annotations.map(annotationToFeature),
        // Non-standard but harmless: GeoJSON parsers ignore unknown members,
        // and without this a file is anonymous the moment it leaves the app.
        [EXTRA]: {
            coordinateSpace: 'slide-level0-pixels',
            slideId: meta.slideId ?? null,
            slideLabel: meta.slideLabel ?? null,
            nativeMpp: meta.nativeMpp ?? null,
            nativeObjective: meta.nativeObjective ?? null,
        },
    };
}

/**
 * Rebuild annotations from a FeatureCollection.
 *
 * Ids come from the file where present. Any feature this cannot understand
 * raises rather than being skipped: a silent skip means a reader re-opens
 * their work and finds three of their eleven annotations quietly absent.
 *
 * @param {object} collection  a parsed FeatureCollection
 * @param {object} [p]
 * @param {string} [p.slideId]     assigned when the file does not name one
 * @param {string} [p.idPrefix='imported']  used for features with no id
 * @returns {Array<object>} annotation records
 */
export function fromGeoJSON(collection, { slideId = null, idPrefix = 'imported' } = {}) {
    if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
        throw new TypeError(
            'fromGeoJSON(): expected a GeoJSON FeatureCollection with a features array, received '
            + JSON.stringify(collection?.type ?? typeof collection),
        );
    }

    return collection.features.map((feature, i) => {
        const extra = feature?.properties?.[EXTRA] ?? {};
        const geometry = feature?.geometry;
        if (!geometry || typeof geometry.type !== 'string') {
            throw new TypeError(`fromGeoJSON(): feature ${i} has no geometry`);
        }

        // Prefer the round-trip block: it holds the true kind, and the two
        // stored corners of a rect/ellipse rather than their expansion.
        const kind = extra.kind ?? inferKind(geometry.type, i);
        const points = Array.isArray(extra.storedPoints)
            ? extra.storedPoints.map(([x, y]) => ({ x, y }))
            : ringToPoints(geometry, i);

        const classification = feature.properties?.classification
            ? {
                name: feature.properties.classification.name,
                color: colorRGBToHex(feature.properties.classification.colorRGB),
            }
            : null;

        return createAnnotation({
            id: typeof feature.id === 'string' && feature.id.length > 0 ? feature.id : `${idPrefix}-${i + 1}`,
            kind,
            points,
            slideId: extra.slideId ?? slideId,
            classification,
            text: feature.properties?.name ?? '',
            tally: extra.tally ?? null,
            targetAreaMm2: extra.targetAreaMm2 ?? null,
            now: extra.createdAtMs ?? 0,
        });
    });
}

// A file written by QuPath (or anything else) has no kind block, so fall back
// to the geometry type. Ellipses and arrows cannot be recovered — they were
// already flattened when they were written — and pretending otherwise would be
// a lie about what is in the file.
function inferKind(geometryType, index) {
    switch (geometryType) {
        case 'Point': return ANNOTATION_KINDS.POINT;
        case 'LineString': return ANNOTATION_KINDS.LINE;
        case 'Polygon': return ANNOTATION_KINDS.POLYGON;
        default:
            throw new RangeError(
                `fromGeoJSON(): feature ${index} has geometry type ${JSON.stringify(geometryType)}, `
                + 'which has no annotation equivalent (expected Point, LineString or Polygon)',
            );
    }
}

function ringToPoints(geometry, index) {
    if (geometry.type === 'Point') return [{ x: geometry.coordinates[0], y: geometry.coordinates[1] }];
    if (geometry.type === 'LineString') return geometry.coordinates.map(([x, y]) => ({ x, y }));
    if (geometry.type === 'Polygon') {
        const ring = geometry.coordinates?.[0];
        if (!Array.isArray(ring) || ring.length < 4) {
            throw new TypeError(`fromGeoJSON(): feature ${index} has a polygon ring with fewer than 4 positions`);
        }
        // Drop the repeated closing position; the model closes shapes itself.
        const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
        return (closed ? ring.slice(0, -1) : ring).map(([x, y]) => ({ x, y }));
    }
    throw new RangeError(`fromGeoJSON(): feature ${index} has unsupported geometry ${geometry.type}`);
}
