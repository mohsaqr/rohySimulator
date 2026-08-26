/**
 * Annotation geometry — pure planar maths on SLIDE (level-0) coordinates.
 *
 * WHY a separate module from slideGeometry.js: slideGeometry answers "where is
 * the viewport and how magnified is it". This answers "what shape did the
 * reader draw, how big is it, and did they just click on it". They share the
 * coordinate contract and nothing else, and keeping them apart means the whole
 * editor can be tested with `node --test` against plain numbers — no canvas,
 * no OpenSeadragon, no DOM.
 *
 * THE COORDINATE INVARIANT, restated because everything here depends on it:
 * every {x, y} in this file is a pixel in the LEVEL-0 (40x) scan, the same
 * space answer-key ROIs are authored in. It is deliberately NOT the archive
 * level actually being served, so re-exporting the pyramid at 5x instead of
 * 10x leaves every annotation exactly where the reader put it.
 *
 * Distances are therefore converted to microns with the slide's `nativeMpp`
 * (microns per level-0 pixel), never with a screen measurement.
 */

const isFinitePoint = (p) => !!p
    && typeof p.x === 'number' && Number.isFinite(p.x)
    && typeof p.y === 'number' && Number.isFinite(p.y);

/**
 * Validate a point list, raising rather than propagating NaN into an area.
 *
 * A single NaN vertex silently turns a shoelace area into NaN, which then
 * renders as "NaN µm²" three components away from the cause. Fail here.
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {number} minLength  fewest vertices this shape kind can be built from
 * @param {string} who        caller name, for the message
 * @returns {Array<{x:number,y:number}>} the same array, proven finite
 */
export function requirePoints(points, minLength, who) {
    if (!Array.isArray(points) || points.length < minLength) {
        throw new TypeError(
            `${who}: expected an array of at least ${minLength} point(s), received `
            + `${Array.isArray(points) ? `${points.length} point(s)` : typeof points}`,
        );
    }
    const badIndex = points.findIndex((p) => !isFinitePoint(p));
    if (badIndex !== -1) {
        throw new TypeError(
            `${who}: point ${badIndex} must have finite numeric x and y, received `
            + `${JSON.stringify(points[badIndex])}`,
        );
    }
    return points;
}

/**
 * Axis-aligned bounding box of a point list.
 *
 * @param {Array<{x:number,y:number}>} points
 * @returns {{x:number, y:number, w:number, h:number}} slide-space rect
 */
export function boundingBox(points) {
    requirePoints(points, 1, 'boundingBox(points)');
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Signed polygon area by the shoelace formula, in slide px².
 *
 * The SIGN is returned rather than discarded because it carries the winding
 * direction, and GeoJSON's right-hand rule cares about winding. Callers that
 * only want a magnitude take Math.abs.
 *
 * @param {Array<{x:number,y:number}>} points  implicitly closed
 * @returns {number} positive for counter-clockwise in a y-down raster
 */
export function signedArea(points) {
    requirePoints(points, 3, 'signedArea(points)');
    // Vectorised over index pairs rather than an index loop: each term is
    // x_i * y_{i+1} - x_{i+1} * y_i with the last vertex wrapping to the first.
    const terms = points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        return p.x * q.y - q.x * p.y;
    });
    return terms.reduce((sum, term) => sum + term, 0) / 2;
}

/**
 * Unsigned polygon area in slide px².
 *
 * @param {Array<{x:number,y:number}>} points
 * @returns {number}
 */
export function polygonArea(points) {
    return Math.abs(signedArea(points));
}

/**
 * Perimeter of a point list in slide px.
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {boolean} [closed=true]  include the closing edge back to points[0]
 * @returns {number}
 */
export function pathLength(points, closed = true) {
    requirePoints(points, 2, 'pathLength(points)');
    const edges = points.slice(0, closed ? points.length : points.length - 1);
    return edges
        .map((p, i) => distance(p, points[(i + 1) % points.length]))
        .reduce((sum, d) => sum + d, 0);
}

/**
 * Euclidean distance between two points, in slide px.
 *
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
export function distance(a, b) {
    requirePoints([a, b], 2, 'distance(a, b)');
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Shortest distance from a point to a line SEGMENT (not an infinite line).
 *
 * Used for hit-testing rulers and polygon edges. The segment restriction
 * matters: an infinite-line distance would let a click a slide-width away from
 * a 20 px ruler "hit" it because it happened to be collinear.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} a  segment start
 * @param {{x:number,y:number}} b  segment end
 * @returns {number} slide px
 */
export function distanceToSegment(p, a, b) {
    requirePoints([p, a, b], 3, 'distanceToSegment(p, a, b)');
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    // A degenerate segment is a point; hypot handles it without dividing by 0.
    if (lengthSq === 0) return distance(p, a);
    // Projection parameter, clamped to [0, 1] so it stays on the segment.
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * Shortest distance from a point to a polyline or polygon boundary.
 *
 * @param {{x:number,y:number}} p
 * @param {Array<{x:number,y:number}>} points
 * @param {boolean} [closed=true]
 * @returns {number} slide px
 */
export function distanceToPath(p, points, closed = true) {
    requirePoints(points, 2, 'distanceToPath(p, points)');
    const edges = points.slice(0, closed ? points.length : points.length - 1);
    return Math.min(...edges.map((a, i) => distanceToSegment(p, a, points[(i + 1) % points.length])));
}

/**
 * Ray-casting point-in-polygon test.
 *
 * Counts crossings of a ray cast in +x. The `(yi > p.y) !== (yj > p.y)` guard
 * is the standard half-open edge rule: it counts a vertex exactly once, so a
 * click landing precisely on a vertex y-coordinate does not toggle twice and
 * report "outside" for an interior point.
 *
 * @param {{x:number,y:number}} p
 * @param {Array<{x:number,y:number}>} points
 * @returns {boolean}
 */
export function pointInPolygon(p, points) {
    requirePoints(points, 3, 'pointInPolygon(p, points)');
    requirePoints([p], 1, 'pointInPolygon(p, points)');
    return points.reduce((inside, vi, i) => {
        const vj = points[(i + points.length - 1) % points.length];
        const crosses = (vi.y > p.y) !== (vj.y > p.y)
            && p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x;
        return crosses ? !inside : inside;
    }, false);
}

/**
 * Point-in-ellipse test for an axis-aligned ellipse inscribed in `rect`.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {boolean}
 */
export function pointInEllipse(p, rect) {
    requirePoints([p], 1, 'pointInEllipse(p, rect)');
    const { x, y, w, h } = rect ?? {};
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new TypeError(`pointInEllipse(): rect needs finite x/y/w/h, received ${JSON.stringify(rect)}`);
    }
    // A zero-width or zero-height ellipse encloses nothing; without this the
    // division below returns Infinity and the comparison is merely accidentally
    // correct, which is not the same as being right.
    if (w <= 0 || h <= 0) return false;
    const nx = (p.x - (x + w / 2)) / (w / 2);
    const ny = (p.y - (y + h / 2)) / (h / 2);
    return nx * nx + ny * ny <= 1;
}

/**
 * Vertices of an axis-aligned ellipse, for GeoJSON export and canvas fallback.
 *
 * GeoJSON has no ellipse primitive — QuPath's own exporter degrades ellipses to
 * polygons for exactly this reason — so the interchange format gets a polygon
 * approximation while the editor keeps the true parametric shape.
 *
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {number} [segments=64]
 * @returns {Array<{x:number,y:number}>}
 */
export function ellipseVertices(rect, segments = 64) {
    const { x, y, w, h } = rect ?? {};
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new TypeError(`ellipseVertices(): rect needs finite x/y/w/h, received ${JSON.stringify(rect)}`);
    }
    if (!(Number.isInteger(segments) && segments >= 8)) {
        throw new RangeError(`ellipseVertices(): segments must be an integer >= 8, received ${segments}`);
    }
    const cx = x + w / 2;
    const cy = y + h / 2;
    return Array.from({ length: segments }, (_, i) => {
        const theta = (2 * Math.PI * i) / segments;
        return { x: cx + (w / 2) * Math.cos(theta), y: cy + (h / 2) * Math.sin(theta) };
    });
}

/**
 * Corner points of a rect, clockwise from top-left.
 *
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {Array<{x:number,y:number}>} four vertices
 */
export function rectVertices(rect) {
    const { x, y, w, h } = rect ?? {};
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new TypeError(`rectVertices(): rect needs finite x/y/w/h, received ${JSON.stringify(rect)}`);
    }
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/**
 * Normalise two dragged corners into a positive-extent rect.
 *
 * A drag up-and-left produces a negative width. Every consumer downstream —
 * area, hit-test, canvas fillRect — would then be subtly wrong in a way that
 * looks right on screen, so normalise once, here.
 *
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function rectFromCorners(a, b) {
    requirePoints([a, b], 2, 'rectFromCorners(a, b)');
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
    };
}

/**
 * Ramer-Douglas-Peucker simplification.
 *
 * WHY freehand strokes must be simplified before they are stored: a pointer
 * drag at 60 fps across a 100,000 px slide emits a vertex every few
 * milliseconds, so an unsimplified outline of one tumour focus can carry
 * several thousand points. That is slow to hit-test, unreadable as GeoJSON,
 * and carries no information the tissue boundary did not already have.
 *
 * `epsilon` is in SLIDE px, so the caller sets it from the magnification the
 * stroke was drawn at — a line drawn at 40x deserves a finer tolerance than
 * one scribbled at 1x.
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {number} epsilon  max perpendicular deviation, slide px
 * @returns {Array<{x:number,y:number}>} always keeps the first and last point
 */
export function simplifyPath(points, epsilon) {
    requirePoints(points, 2, 'simplifyPath(points, epsilon)');
    if (!(typeof epsilon === 'number' && Number.isFinite(epsilon) && epsilon > 0)) {
        throw new RangeError(`simplifyPath(): epsilon must be a finite positive number, received ${epsilon}`);
    }
    if (points.length <= 2) return [...points];

    const first = points[0];
    const last = points[points.length - 1];
    // Furthest interior vertex from the chord joining the endpoints.
    const deviations = points.slice(1, -1).map((p) => distanceToSegment(p, first, last));
    const worst = Math.max(...deviations);

    // Everything is within tolerance of the chord — the chord IS the stroke.
    if (worst <= epsilon) return [first, last];

    const splitAt = deviations.indexOf(worst) + 1;
    const left = simplifyPath(points.slice(0, splitAt + 1), epsilon);
    const right = simplifyPath(points.slice(splitAt), epsilon);
    // Drop the duplicated hinge vertex where the two halves meet.
    return [...left.slice(0, -1), ...right];
}
