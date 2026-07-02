// Shared chart math for the analytics chart primitives.
//
// Faithful ports of the algorithms used by the carmdash dashboard
// (moodle-tna/src/sidepanel/carm/*): d3.curveMonotoneX, the custom
// stacked-area layering from line-chart.ts, d3.stratify + d3.cluster for
// hierarchical edge bundling, d3.curveBundle (beta-straightened basis
// spline), the Lehmer PRNG jitter and Day×Hour bucketing from
// activity-tab.ts — all hand-rolled, no d3 dependency.

/** carmdash CARM_PALETTE (moodle-tna theme.ts). */
export const CARM_PALETTE = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2',
    '#59a14f', '#af7aa1', '#ff9da7', '#9c755f',
];

/** carmdash getColor: palette colour by index, cycled. */
export function getColor(index) {
    return CARM_PALETTE[((index % CARM_PALETTE.length) + CARM_PALETTE.length) % CARM_PALETTE.length];
}

const fmt = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
};

// ── Monotone cubic interpolation (d3.curveMonotoneX / Fritsch–Carlson) ──────

const sign = (x) => (x < 0 ? -1 : 1);

// d3-shape monotone.js slope3: three-point weighted-harmonic-mean slope,
// clamped so the interpolant never overshoots (Fritsch–Carlson).
function slope3(x0, y0, x1, y1, x2, y2) {
    const h0 = x1 - x0;
    const h1 = x2 - x1;
    const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
    const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    const m = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
    return Number.isFinite(m) ? m : 0;
}

// d3-shape monotone.js slope2: one-sided endpoint slope.
function slope2(x0, y0, x1, y1, t) {
    const h = x1 - x0;
    return h ? (3 * (y1 - y0) / h - t) / 2 : t;
}

/**
 * SVG path through `points` using Fritsch–Carlson monotone cubic
 * interpolation — the exact algorithm of d3.curveMonotoneX.
 * @param {{x:number,y:number}[]} points pixel-space points, sorted by x
 * @returns {string} SVG path ("M … C …"), '' when points is empty
 */
export function monotonePath(points) {
    const n = points.length;
    if (n === 0) return '';
    const p0 = points[0];
    if (n === 1) return `M${fmt(p0.x)},${fmt(p0.y)}`;
    if (n === 2) {
        const p1 = points[1];
        return `M${fmt(p0.x)},${fmt(p0.y)}L${fmt(p1.x)},${fmt(p1.y)}`;
    }

    // Interior tangents (d3 computes these lazily; precompute equivalently).
    const tangents = points.map((p, i) => {
        if (i === 0 || i === n - 1) return 0; // filled below
        const a = points[i - 1];
        const b = points[i + 1];
        return slope3(a.x, a.y, p.x, p.y, b.x, b.y);
    });
    tangents[0] = slope2(p0.x, p0.y, points[1].x, points[1].y, tangents[1]);
    const last = points[n - 1];
    const prev = points[n - 2];
    tangents[n - 1] = slope2(prev.x, prev.y, last.x, last.y, tangents[n - 2]);

    const segments = points.slice(1).map((b, i) => {
        const a = points[i];
        const dx = (b.x - a.x) / 3;
        return `C${fmt(a.x + dx)},${fmt(a.y + dx * tangents[i])},${fmt(b.x - dx)},${fmt(b.y - dx * tangents[i + 1])},${fmt(b.x)},${fmt(b.y)}`;
    });
    return `M${fmt(p0.x)},${fmt(p0.y)}${segments.join('')}`;
}

// ── Stacking (carmdash line-chart.ts:126-138) ───────────────────────────────

/**
 * carmdash stacked-area layering: for each x, iterate the series LAST→FIRST
 * accumulating a baseline (missing x contributes 0). The last series sits on
 * the x-axis; the first series is the top layer.
 * @param {{label:string,x:number[],y:number[]}[]} series
 * @param {number[]} xs sorted union of x values
 * @returns {{x:number,y0:number,y1:number}[][]} one layer per series, same order
 */
export function stackSeries(series, xs) {
    const layers = series.map(() => []);
    xs.forEach((x) => {
        let baseline = 0;
        series
            .map((_, si) => si)
            .reverse()
            .forEach((si) => {
                const s = series[si];
                const idx = s.x.indexOf(x);
                const val = idx >= 0 ? (s.y[idx] ?? 0) : 0;
                layers[si].push({ x, y0: baseline, y1: baseline + val });
                baseline += val;
            });
    });
    return layers;
}

// ── Linear scale with nice ticks (d3.scaleLinear().ticks) ───────────────────

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

// d3-array tickIncrement.
function tickIncrement(start, stop, count) {
    const step = (stop - start) / Math.max(0, count);
    const power = Math.floor(Math.log(step) / Math.LN10);
    const error = step / 10 ** power;
    return power >= 0
        ? (error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1) * 10 ** power
        : -(10 ** -power) / (error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1);
}

/**
 * Linear scale mapping `domain` to `range`. The returned function also
 * exposes `.ticks(n)` producing "nice" round tick values within the domain
 * (d3-array ticks algorithm) plus `.domain` / `.range`.
 * @param {[number,number]} domain
 * @param {[number,number]} range
 */
export function linearScale(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0;
    const scale = (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
    scale.domain = [d0, d1];
    scale.range = [r0, r1];
    scale.ticks = (count = 10) => {
        const lo = Math.min(d0, d1);
        const hi = Math.max(d0, d1);
        if (lo === hi) return [lo];
        const inc = tickIncrement(lo, hi, count);
        if (inc === 0 || !Number.isFinite(inc)) return [];
        if (inc > 0) {
            const i0 = Math.ceil(lo / inc);
            const i1 = Math.floor(hi / inc);
            return Array.from({ length: i1 - i0 + 1 }, (_, i) => (i0 + i) * inc);
        }
        const i0 = Math.ceil(lo * -inc);
        const i1 = Math.floor(hi * -inc);
        return Array.from({ length: i1 - i0 + 1 }, (_, i) => (i0 + i) / -inc);
    };
    return scale;
}

// ── Cluster layout (d3.stratify + d3.cluster equivalent) ────────────────────

/**
 * Radial cluster layout for a flat hierarchy (root has parent === '').
 * Leaves are evenly spaced on [0,360) in hierarchy-traversal order (children
 * order = input order); internal nodes sit at the mean of their children's
 * angles with radius proportional to depth (root 0 … leaves = maxRadius).
 * Equivalent of carmdash's d3.stratify + d3.cluster().size([360, radius]).
 * @param {{id:string,parent:string,label?:string,group?:string}[]} nodes
 * @param {number} [maxRadius=1] radius assigned to leaf nodes
 * @returns {{leaves:object[], byId:Map<string,object>}}
 */
export function clusterLayout(nodes, maxRadius = 1) {
    const byId = new Map(nodes.map((n) => [n.id, {
        id: n.id,
        parent: n.parent,
        label: n.label ?? n.id,
        group: n.group,
        children: [],
        depth: 0,
        angleDeg: 0,
        radius: 0,
        isLeaf: false,
    }]));
    const root = nodes.map((n) => byId.get(n.id)).find((n) => n.parent === '');
    if (!root) return { leaves: [], byId };
    nodes.forEach((n) => {
        if (n.parent === '' || !byId.has(n.parent)) return;
        byId.get(n.parent).children.push(byId.get(n.id));
    });

    // Depth-first traversal in input-children order; collect leaves.
    const leaves = [];
    (function walk(node, depth) {
        node.depth = depth;
        if (node.children.length === 0) {
            node.isLeaf = true;
            leaves.push(node);
            return;
        }
        node.children.forEach((c) => walk(c, depth + 1));
    })(root, 0);

    const step = leaves.length > 0 ? 360 / leaves.length : 0;
    leaves.forEach((leaf, i) => {
        leaf.angleDeg = i * step;
        leaf.radius = maxRadius;
    });

    // Internal nodes: angle = mean of children (d3.cluster meanX), radius
    // proportional to depth with root pinned at 0.
    const maxDepth = leaves.reduce((m, l) => Math.max(m, l.depth), 1);
    (function up(node) {
        if (node.isLeaf) return;
        node.children.forEach(up);
        node.angleDeg = node.children.reduce((s, c) => s + c.angleDeg, 0) / node.children.length;
        node.radius = (node.depth / maxDepth) * maxRadius;
    })(root);

    return {
        leaves: leaves.map((l) => ({ id: l.id, angleDeg: l.angleDeg, radius: l.radius })),
        byId,
    };
}

// ── LCA path (carmdash edge-bundling.ts:204-230) ───────────────────────────

function ancestorsOf(byId, id) {
    const out = [];
    let cur = byId.get(id);
    while (cur) {
        out.push(cur.id);
        cur = cur.parent === '' ? null : byId.get(cur.parent);
    }
    return out; // [id, parent(id), …, root]
}

/**
 * Path of node ids from `aId` up to the lowest common ancestor then down to
 * `bId` (both endpoints inclusive, LCA appearing once).
 * @param {Map<string,object>} byId clusterLayout byId map
 */
export function lcaPath(byId, aId, bId) {
    const ancestorsA = ancestorsOf(byId, aId);
    const ancestorsB = ancestorsOf(byId, bId);
    const setA = new Set(ancestorsA);
    const lca = ancestorsB.find((id) => setA.has(id));
    if (!lca) return [aId, bId];
    const pathUp = ancestorsA.slice(0, ancestorsA.indexOf(lca) + 1);
    const pathDown = ancestorsB.slice(0, ancestorsB.indexOf(lca)).reverse();
    return [...pathUp, ...pathDown];
}

// ── Bundled edge path (d3.lineRadial + d3.curveBundle.beta) ────────────────

/**
 * SVG path for a bundled edge: polar→cartesian via (sin(a)·r, −cos(a)·r),
 * beta straightening of the control polygon (d3.curveBundle), rendered as a
 * uniform cubic B-spline (d3.curveBasis segment coefficients).
 * @param {{angleDeg:number,radius:number}[]} pathNodes
 * @param {number} beta bundling strength 0–1 (1 = follow hierarchy fully)
 * @returns {string} SVG path string
 */
export function bundlePath(pathNodes, beta) {
    const pts = pathNodes.map((p) => {
        const a = (p.angleDeg * Math.PI) / 180;
        return { x: Math.sin(a) * p.radius, y: -Math.cos(a) * p.radius };
    });
    const n = pts.length;
    if (n === 0) return '';
    if (n === 1) return `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;

    // Beta straightening: p_i → β·p_i + (1−β)·(p0 + i/(n−1)·(p_{n−1} − p0)).
    const first = pts[0];
    const dEnd = { x: pts[n - 1].x - first.x, y: pts[n - 1].y - first.y };
    const ctrl = pts.map((p, i) => {
        const t = i / (n - 1);
        return {
            x: beta * p.x + (1 - beta) * (first.x + t * dEnd.x),
            y: beta * p.y + (1 - beta) * (first.y + t * dEnd.y),
        };
    });

    // Uniform cubic B-spline rendered exactly like d3.curveBasis:
    //   M p0; L (5p0+p1)/6; then per point k≥2 a cubic Bézier with the
    //   standard B-spline→Bézier conversion; close with the last point
    //   repeated and a final lineTo.
    if (n === 2) return `M${fmt(ctrl[0].x)},${fmt(ctrl[0].y)}L${fmt(ctrl[1].x)},${fmt(ctrl[1].y)}`;

    const bez = (a, b, c) =>
        `C${fmt((2 * a.x + b.x) / 3)},${fmt((2 * a.y + b.y) / 3)},${fmt((a.x + 2 * b.x) / 3)},${fmt((a.y + 2 * b.y) / 3)},${fmt((a.x + 4 * b.x + c.x) / 6)},${fmt((a.y + 4 * b.y + c.y) / 6)}`;

    const p0 = ctrl[0];
    const p1 = ctrl[1];
    const head = `M${fmt(p0.x)},${fmt(p0.y)}L${fmt((5 * p0.x + p1.x) / 6)},${fmt((5 * p0.y + p1.y) / 6)}`;
    const body = ctrl.slice(2).map((c, k) => bez(ctrl[k], ctrl[k + 1], c)).join('');
    const a = ctrl[n - 2];
    const b = ctrl[n - 1];
    const tail = `${bez(a, b, b)}L${fmt(b.x)},${fmt(b.y)}`;
    return head + body + tail;
}

// ── Lehmer jitter (carmdash activity-tab.ts:743-753) ───────────────────────

/**
 * Lehmer / Park–Miller PRNG matching carmdash's jitter sequence:
 * seed = (seed·16807) mod 2147483647; value = seed / 2147483647.
 * @param {number} seed
 * @returns {() => number} next value in [0,1)
 */
export function lehmerJitter(seed) {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}

// ── Relative luminance ──────────────────────────────────────────────────────

/**
 * WCAG relative luminance (0 = black … 1 = white) of a hex colour, for
 * choosing white vs dark text over a fill.
 * @param {string} hex '#rgb' or '#rrggbb'
 */
export function hexLuminance(hex) {
    let h = hex.replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const chan = (i) => {
        const c = parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

// ── Day×Hour bucketing (carmdash activity-tab.ts:504-569) ──────────────────

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Bucket events into a Day×Hour matrix, carmdash-style: per cell, one entry
 * per student carrying total count and per-state counts. Only
 * timeMode 'day_hour' is implemented (x = hour 0-23, y = weekday 0-6);
 * the signature stays extensible for 'week_day' / 'month_day'.
 * @param {{ts:number,student:string,state:string}[]} events ts in ms
 * @param {{timeMode?:string}} [options]
 * @returns {{grid:object[][][],maxTotalCell:number,maxStudent:number,xLabels:string[],yLabels:string[]}}
 */
export function bucketDayHour(events, { timeMode = 'day_hour' } = {}) {
    if (timeMode !== 'day_hour') {
        throw new Error(`bucketDayHour: timeMode '${timeMode}' not implemented (only 'day_hour')`);
    }
    const xLen = 24;
    const yLen = 7;
    const xLabels = Array.from({ length: xLen }, (_, i) => String(i));
    const yLabels = [...WEEKDAY_LABELS];

    const grid = Array.from({ length: yLen }, () => Array.from({ length: xLen }, () => []));
    const cellMap = new Map(); // 'y|x' → Map(student → {count, states})

    events.forEach((ev) => {
        if (!ev || !(ev.ts > 0) || !ev.student || !ev.state) return;
        const d = new Date(ev.ts);
        const x = d.getHours();
        const y = d.getDay();
        const key = `${y}|${x}`;
        let sMap = cellMap.get(key);
        if (!sMap) { sMap = new Map(); cellMap.set(key, sMap); }
        let sData = sMap.get(ev.student);
        if (!sData) { sData = { count: 0, states: {} }; sMap.set(ev.student, sData); }
        sData.states[ev.state] = (sData.states[ev.state] ?? 0) + 1;
        sData.count += 1;
    });

    cellMap.forEach((sMap, key) => {
        const [y, x] = key.split('|').map(Number);
        sMap.forEach((data, student) => {
            grid[y][x].push({ student, count: data.count, states: data.states });
        });
    });

    const maxTotalCell = Math.max(
        ...grid.flatMap((row) => row.map((cell) => cell.reduce((s, e) => s + e.count, 0))), 1);
    const maxStudent = Math.max(
        ...grid.flatMap((row) => row.map((cell) => (cell.length ? Math.max(...cell.map((e) => e.count)) : 0))), 1);

    return { grid, maxTotalCell, maxStudent, xLabels, yLabels };
}

/** Dominant (most frequent) state in a {state: count} record. */
export function dominantState(states) {
    return Object.entries(states).reduce(
        (best, [st, c]) => (c > best[1] ? [st, c] : best), ['', 0])[0];
}
