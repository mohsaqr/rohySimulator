/**
 * The annotation record — what a reader draws on a slide, and what it means.
 *
 * WHY this is a plain data module with no React and no canvas in it: an
 * annotation is a clinical statement ("this focus is tumour, it measures
 * 1.4 mm across"), and a clinical statement has to be checkable. Everything
 * here is a pure function over plain objects, so the measurement arithmetic
 * that a trainee's report depends on can be tested against hand-computed
 * numbers rather than eyeballed on screen.
 *
 * All geometry is in SLIDE (level-0 / 40x) pixels — see annotationGeometry.js
 * for why. Physical size comes from the slide's `nativeMpp` (microns per
 * level-0 pixel), which is scanner metadata, NOT anything derived from the
 * zoom level. A measurement must not change because the reader zoomed in.
 */

import {
    boundingBox,
    distance,
    distanceToPath,
    distanceToSegment,
    ellipseVertices,
    pathLength,
    pointInEllipse,
    pointInPolygon,
    polygonArea,
    rectFromCorners,
    rectVertices,
    requirePoints,
} from './annotationGeometry.js';

export const ANNOTATION_KINDS = {
    POINT: 'point',
    LINE: 'line',
    ARROW: 'arrow',
    RECTANGLE: 'rectangle',
    ELLIPSE: 'ellipse',
    POLYGON: 'polygon',
    FREEHAND: 'freehand',
    // An OPEN free-form path. Not a decorative variant of freehand: an open
    // path measures a CURVILINEAR length, which is what depth of invasion and
    // a distance-to-margin actually are. A straight ruler across an irregular
    // invasive front measures the chord, not the path, and under-reports.
    POLYLINE: 'polyline',
    COUNTING_FRAME: 'counting_frame',
};

/**
 * How many vertices each kind is defined by, and how they are interpreted.
 *
 * `vertices` is the count STORED, not the count drawn: a rectangle stores two
 * dragged corners and derives four, so that dragging one corner during an edit
 * moves exactly one stored value rather than three dependent ones.
 */
const KIND_SPEC = {
    [ANNOTATION_KINDS.POINT]: { vertices: 1, closed: false, areal: false },
    [ANNOTATION_KINDS.LINE]: { vertices: 2, closed: false, areal: false },
    [ANNOTATION_KINDS.ARROW]: { vertices: 2, closed: false, areal: false },
    [ANNOTATION_KINDS.RECTANGLE]: { vertices: 2, closed: true, areal: true },
    [ANNOTATION_KINDS.ELLIPSE]: { vertices: 2, closed: true, areal: true },
    [ANNOTATION_KINDS.POLYGON]: { vertices: 3, closed: true, areal: true },
    [ANNOTATION_KINDS.FREEHAND]: { vertices: 3, closed: true, areal: true },
    [ANNOTATION_KINDS.POLYLINE]: { vertices: 2, closed: false, areal: false },
    [ANNOTATION_KINDS.COUNTING_FRAME]: { vertices: 2, closed: true, areal: true },
};

/**
 * Default classification palette.
 *
 * Colours are Okabe-Ito, which is colour-blind safe — roughly 1 in 12 men has
 * a colour vision deficiency, and a viewer that distinguishes "tumour" from
 * "stroma" by red-vs-green alone is unusable for them. Colour is never the
 * only cue either: every annotation is drawn with its class NAME attached, so
 * the distinction survives a greyscale print and a monochrome screenshot.
 */
export const ANNOTATION_CLASSES = [
    { name: 'Tumour', color: '#D55E00' },
    { name: 'Stroma', color: '#0072B2' },
    { name: 'Necrosis', color: '#999999' },
    { name: 'Normal', color: '#009E73' },
    { name: 'Inflammation', color: '#CC79A7' },
    { name: 'Vessel', color: '#56B4E9' },
    { name: 'Mitosis', color: '#E69F00' },
    { name: 'Artefact', color: '#F0E442' },
];

/** Drawn colour for an annotation the reader has not classified yet. */
export const UNCLASSIFIED_COLOR = '#F1F5F9';

/**
 * Build a validated annotation record.
 *
 * `now` is INJECTED rather than read from Date.now() inside: a record whose
 * fields depend on the wall clock cannot be compared against a fixture, and
 * these records are exactly what the export tests assert on.
 *
 * @param {object} p
 * @param {string} p.id            caller-assigned, unique within the slide
 * @param {string} p.kind          one of ANNOTATION_KINDS
 * @param {Array<{x:number,y:number}>} p.points  slide-space vertices
 * @param {string} [p.slideId]     the slide this belongs to
 * @param {{name:string,color:string}|null} [p.classification]
 * @param {string} [p.text]        free-text note the reader typed
 * @param {number|null} [p.tally]  counting-frame running count
 * @param {number|null} [p.targetAreaMm2]  nominal frame area it was built at
 * @param {number} [p.now]         creation timestamp, ms
 * @returns {object} frozen-shape annotation record
 */
export function createAnnotation({
    id,
    kind,
    points,
    slideId = null,
    classification = null,
    text = '',
    tally = null,
    targetAreaMm2 = null,
    now = 0,
}) {
    if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError(`createAnnotation(): id must be a non-empty string, received ${JSON.stringify(id)}`);
    }
    const spec = KIND_SPEC[kind];
    if (!spec) {
        throw new RangeError(
            `createAnnotation(): kind must be one of ${Object.values(ANNOTATION_KINDS).join(', ')}, received ${JSON.stringify(kind)}`,
        );
    }
    requirePoints(points, spec.vertices, `createAnnotation(${kind})`);
    if (classification !== null
        && !(typeof classification?.name === 'string' && typeof classification?.color === 'string')) {
        throw new TypeError(
            `createAnnotation(): classification must be null or {name, color}, received ${JSON.stringify(classification)}`,
        );
    }
    // A rectangle drawn bottom-right to top-left has negative extent. Normalise
    // at construction so no downstream consumer ever sees a negative width.
    const stored = (kind === ANNOTATION_KINDS.RECTANGLE
        || kind === ANNOTATION_KINDS.ELLIPSE
        || kind === ANNOTATION_KINDS.COUNTING_FRAME)
        ? cornersOf(rectFromCorners(points[0], points[1]))
        : points.map((p) => ({ x: p.x, y: p.y }));

    return {
        id,
        kind,
        slideId,
        points: stored,
        classification,
        text,
        tally: kind === ANNOTATION_KINDS.COUNTING_FRAME ? (tally ?? 0) : null,
        targetAreaMm2: kind === ANNOTATION_KINDS.COUNTING_FRAME ? targetAreaMm2 : null,
        createdAtMs: now,
        updatedAtMs: now,
    };
}

// Two opposite corners is the storage form; four is the drawing form.
const cornersOf = (rect) => [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }];

/**
 * Whether a kind encloses area (and so reports mm²) or is purely linear.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function isAreal(kind) {
    const spec = KIND_SPEC[kind];
    if (!spec) throw new RangeError(`isAreal(): unknown kind ${JSON.stringify(kind)}`);
    return spec.areal;
}

/**
 * Bounding rect of an annotation, in slide px.
 *
 * @param {object} annotation
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function annotationBounds(annotation) {
    return boundingBox(annotation.points);
}

/**
 * The vertices actually drawn and exported, expanding the stored form.
 *
 * A rectangle stored as two corners becomes four; an ellipse stored as a
 * bounding box becomes a 64-gon, because GeoJSON has no ellipse primitive.
 *
 * @param {object} annotation
 * @returns {Array<{x:number,y:number}>}
 */
export function annotationVertices(annotation) {
    const rect = annotationBounds(annotation);
    switch (annotation.kind) {
        case ANNOTATION_KINDS.RECTANGLE:
        case ANNOTATION_KINDS.COUNTING_FRAME:
            return rectVertices(rect);
        case ANNOTATION_KINDS.ELLIPSE:
            return ellipseVertices(rect);
        default:
            return annotation.points.map((p) => ({ x: p.x, y: p.y }));
    }
}

/**
 * Physical measurements of an annotation.
 *
 * Every field is null where the kind cannot support it, rather than 0 — a
 * ruler has no area, and reporting "0 µm²" invites someone to average it.
 *
 * The `perMm2` field is what WHO's 5th-edition tumour classification actually
 * asks for: mitotic counts reported per mm², not per 10 high-power fields,
 * because a "high-power field" varies several-fold between microscopes and
 * between digital viewports at nominally the same magnification.
 *
 * @param {object} annotation
 * @param {{nativeMpp:number}} slide  microns per level-0 pixel
 * @returns {{lengthUm:number|null, perimeterUm:number|null, areaUm2:number|null,
 *            areaMm2:number|null, widthUm:number|null, heightUm:number|null,
 *            perMm2:number|null}}
 */
export function measureAnnotation(annotation, slide) {
    const blank = {
        lengthUm: null, perimeterUm: null, areaUm2: null, areaMm2: null,
        widthUm: null, heightUm: null, perMm2: null,
    };

    // A slide DECLARED unmeasurable has no micron scale, so every physical
    // figure is null — the same shape a point annotation has always returned,
    // which is why every caller already renders it as absent rather than as
    // zero. An annotation can still be drawn and still means something: you
    // can circle the neutrophils on a published micrograph, you just cannot
    // say how many microns across they are.
    //
    // Distinct from the throw below, which is for a slide that should have a
    // scale and does not. That stays an error: silence there would turn a
    // scanner slide with unparsed optics into a slide that quietly measures
    // nothing.
    if (slide?.measurable === false) return blank;

    const mpp = slide?.nativeMpp;
    if (!(typeof mpp === 'number' && Number.isFinite(mpp) && mpp > 0)) {
        throw new TypeError(
            `measureAnnotation(): slide.nativeMpp must be a finite positive number, received ${mpp}`,
        );
    }

    if (annotation.kind === ANNOTATION_KINDS.POINT) return blank;

    if (annotation.kind === ANNOTATION_KINDS.LINE || annotation.kind === ANNOTATION_KINDS.ARROW) {
        return { ...blank, lengthUm: distance(annotation.points[0], annotation.points[1]) * mpp };
    }

    // The length ALONG the path, not end to end. `closed: false` is the whole
    // point — closing it would silently add a chord back to the start and
    // inflate every measurement by the straight-line distance.
    if (annotation.kind === ANNOTATION_KINDS.POLYLINE) {
        return { ...blank, lengthUm: pathLength(annotation.points, false) * mpp };
    }

    const rect = annotationBounds(annotation);
    const vertices = annotationVertices(annotation);
    // The ellipse's true area is pi*a*b. Using the 64-gon's shoelace area
    // instead would under-report by 0.161% — an inscribed regular n-gon has
    // (n / 2pi) * sin(2pi / n) of the area of its circle, which is 0.998394 at
    // n = 64. Small, but it is a number a trainee may put in a report, and
    // there is no reason to approximate a closed form. The polygon expansion
    // is for DRAWING and EXPORT, where GeoJSON leaves no choice; it is never
    // the source of a measurement.
    const areaPx2 = annotation.kind === ANNOTATION_KINDS.ELLIPSE
        ? Math.PI * (rect.w / 2) * (rect.h / 2)
        : polygonArea(vertices);
    const areaUm2 = areaPx2 * mpp * mpp;
    const areaMm2 = areaUm2 / 1e6;

    return {
        lengthUm: null,
        perimeterUm: pathLength(vertices, true) * mpp,
        areaUm2,
        areaMm2,
        widthUm: rect.w * mpp,
        heightUm: rect.h * mpp,
        // Guard the division: a frame dragged to zero extent would otherwise
        // report Infinity mitoses per mm², which is worse than reporting none.
        perMm2: annotation.tally !== null && areaMm2 > 0 ? annotation.tally / areaMm2 : null,
    };
}

/**
 * Does a slide-space point land on this annotation?
 *
 * `tolerance` is in SLIDE px and must be supplied by the caller from the
 * current magnification — a fixed tolerance would be a 40 px grab radius at
 * 1x (unusably coarse) and a sub-pixel one at 40x (unhittable).
 *
 * @param {object} annotation
 * @param {{x:number,y:number}} p
 * @param {number} tolerance  slide px
 * @returns {boolean}
 */
export function hitTest(annotation, p, tolerance) {
    if (!(typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0)) {
        throw new RangeError(`hitTest(): tolerance must be a finite non-negative number, received ${tolerance}`);
    }
    requirePoints([p], 1, 'hitTest(annotation, p, tolerance)');
    const rect = annotationBounds(annotation);

    switch (annotation.kind) {
        case ANNOTATION_KINDS.POINT:
            return distance(p, annotation.points[0]) <= tolerance;
        case ANNOTATION_KINDS.LINE:
        case ANNOTATION_KINDS.ARROW:
            return distanceToSegment(p, annotation.points[0], annotation.points[1]) <= tolerance;
        case ANNOTATION_KINDS.POLYLINE:
            // Open: no point-in-polygon test, or the notional interior of a
            // C-shaped trace would be clickable when nothing is drawn there.
            return distanceToPath(p, annotation.points, false) <= tolerance;
        case ANNOTATION_KINDS.ELLIPSE:
            // Inside, or within grabbing distance of the outline — so a large
            // hollow ellipse can be picked up by its edge as well as its body.
            return pointInEllipse(p, rect)
                || distanceToPath(p, ellipseVertices(rect), true) <= tolerance;
        default: {
            const vertices = annotationVertices(annotation);
            return pointInPolygon(p, vertices) || distanceToPath(p, vertices, true) <= tolerance;
        }
    }
}

/**
 * Square counting frame of a nominal area, centred on a point.
 *
 * Returned in the two-corner storage form, so it can be handed straight to
 * createAnnotation. A 2 mm² frame on a 0.25 µm/px scan is 5,657 slide px
 * across; the reader may then drag it, and measureAnnotation() will report the
 * area it ACTUALLY has rather than the area it was born with.
 *
 * @param {{x:number,y:number}} centre  slide px
 * @param {object} p
 * @param {number} p.areaMm2   nominal frame area, e.g. 2
 * @param {number} p.nativeMpp microns per level-0 pixel
 * @returns {Array<{x:number,y:number}>} two opposite corners
 */
export function countingFrameCorners(centre, { areaMm2, nativeMpp }) {
    requirePoints([centre], 1, 'countingFrameCorners(centre, opts)');
    if (!(typeof areaMm2 === 'number' && Number.isFinite(areaMm2) && areaMm2 > 0)) {
        throw new RangeError(`countingFrameCorners(): areaMm2 must be a finite positive number, received ${areaMm2}`);
    }
    if (!(typeof nativeMpp === 'number' && Number.isFinite(nativeMpp) && nativeMpp > 0)) {
        throw new RangeError(`countingFrameCorners(): nativeMpp must be a finite positive number, received ${nativeMpp}`);
    }
    // area mm^2 -> um^2 -> side in um -> side in level-0 px
    const sidePx = Math.sqrt(areaMm2 * 1e6) / nativeMpp;
    const half = sidePx / 2;
    return [{ x: centre.x - half, y: centre.y - half }, { x: centre.x + half, y: centre.y + half }];
}

/**
 * Format a length for display, switching to mm past 1,000 µm.
 *
 * @param {number|null} um
 * @returns {string} e.g. "420 µm", "1.41 mm", or "—"
 */
export function formatLength(um) {
    if (um === null || !Number.isFinite(um)) return '—';
    return um >= 1000 ? `${(um / 1000).toFixed(2)} mm` : `${Math.round(um)} µm`;
}

/**
 * Format an area for display, switching to mm² past 1 mm² (1e6 µm²).
 *
 * @param {number|null} um2
 * @returns {string} e.g. "8,400 µm²", "2.00 mm²", or "—"
 */
export function formatArea(um2) {
    if (um2 === null || !Number.isFinite(um2)) return '—';
    return um2 >= 1e6
        ? `${(um2 / 1e6).toFixed(2)} mm²`
        : `${Math.round(um2).toLocaleString('en-US')} µm²`;
}

/**
 * The colour an annotation is drawn in.
 *
 * @param {object} annotation
 * @returns {string} CSS colour
 */
export function annotationColor(annotation) {
    return annotation?.classification?.color ?? UNCLASSIFIED_COLOR;
}

/**
 * Short human label: the reader's own text, else the class, else the kind.
 *
 * @param {object} annotation
 * @returns {string}
 */
export function annotationLabel(annotation) {
    if (annotation.text) return annotation.text;
    if (annotation.classification) return annotation.classification.name;
    return annotation.kind.replace(/_/g, ' ');
}

/**
 * Point markers falling inside an areal annotation.
 *
 * The cross-check on a counting frame: `tally` is what the reader clicked on
 * the counter, this is where they actually put marks. When the two disagree
 * the reader has miscounted, and a teaching viewer should be able to say so
 * rather than accepting whichever number is more flattering.
 *
 * @param {object} frame        an areal annotation
 * @param {Array<object>} annotations  the whole slide's annotations
 * @returns {Array<object>} the point annotations enclosed by `frame`
 */
export function pointsWithin(frame, annotations) {
    if (!isAreal(frame?.kind)) {
        throw new RangeError(
            `pointsWithin(): frame must be an areal annotation, received kind ${JSON.stringify(frame?.kind)}`,
        );
    }
    if (!Array.isArray(annotations)) {
        throw new TypeError(`pointsWithin(): expected an array of annotations, received ${typeof annotations}`);
    }
    // Tolerance 0: a marker must be genuinely inside the frame to be counted.
    // A grab-radius here would count mitoses just outside the frame and
    // inflate the per-mm² figure, which is the exact error the frame exists
    // to prevent.
    return annotations.filter((a) => a.kind === ANNOTATION_KINDS.POINT && hitTest(frame, a.points[0], 0));
}

/**
 * Which annotation a click selects.
 *
 * NOT the topmost. In pathology large regions routinely CONTAIN small ones — a
 * tumour outline holds mitosis markers, a 2 mm² counting frame can span the
 * whole viewport at 10x — so a z-order rule ("last drawn wins") makes every
 * small annotation unselectable the moment a big one is placed over it. That
 * was not a hypothetical: a counting frame silently swallowed every click
 * meant for the rectangle beneath it.
 *
 * So: of everything under the pointer, the SMALLEST by bounding-box area wins,
 * and z-order is only the tie-break. Markers and rulers have zero bounding-box
 * area in one or both dimensions, so they beat any region enclosing them
 * without needing a special case.
 *
 * @param {Array<object>} annotations  in draw order, oldest first
 * @param {{x:number,y:number}} point  slide coordinates
 * @param {number} tolerance           grab radius in slide px
 * @returns {object|null} the annotation to select, or null for empty space
 */
export function pickAt(annotations, point, tolerance) {
    if (!Array.isArray(annotations)) {
        throw new TypeError(`pickAt(): expected an array of annotations, received ${typeof annotations}`);
    }
    const hits = annotations
        .map((annotation, index) => ({ annotation, index }))
        .filter(({ annotation }) => hitTest(annotation, point, tolerance));
    if (hits.length === 0) return null;

    return hits.reduce((best, candidate) => {
        const a = pickArea(candidate.annotation);
        const b = pickArea(best.annotation);
        // Strictly smaller wins; equal areas fall through to the later index,
        // which is the one drawn on top.
        if (a < b) return candidate;
        if (a > b) return best;
        return candidate.index > best.index ? candidate : best;
    }).annotation;
}

// A THIN annotation ranks as zero, never by its bounding box. A ruler drawn
// across a slide has an enormous bbox but covers almost nothing, so ranking it
// by that box would make the hardest things to click also the things that lose
// every contest — the exact opposite of what picking is for.
const pickArea = (annotation) => {
    if (!isAreal(annotation.kind)) return 0;
    const { w, h } = annotationBounds(annotation);
    return w * h;
};
