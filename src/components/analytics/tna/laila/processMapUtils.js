// Pure helpers for the Process Map (DFG) tab — a faithful port of carmdash's
// bupaR-style PROCESS MAP (moodle-tna: network-tab.ts buildBupaRDFG /
// computeAutoThreshold / pruneDFG + svg-process-map.ts geometry), kept out of
// the JSX component so every piece of model/threshold/geometry/color logic is
// unit-testable with vitest (see processMapUtils.test.js).
//
// Model semantics (buildBupaRDFG):
//   - absolute  = raw occurrence / transition counts (Start outgoing = #sequences)
//   - relative  = per-source Markov probability, including →End edges
//   - case      = fraction of sequences containing the node/transition (deduped
//                 per sequence)
//
// Geometry is hand-rolled (NO d3): cubic Bézier edges with unit-normal offset
// control points at 25%/75%, ray-box / ray-circle boundary intersection for
// edge endpoints, de Casteljau midpoint for labels, CIELAB lightness for text
// contrast, piecewise-linear RGB interpolation for node fills.

import dagre from 'dagre';

// ── Constants (mirroring svg-process-map.ts) ──

export const RECT_H = 52;
export const SENT_R = 20;
export const EDGE_COLOR = '#1e3a5f';
export const NODE_COLOR_RAMP = ['#f5e6e8', '#6b87a8', '#1a2744'];
/** Dash pattern: a few short ticks at the path start, then solid. */
export const EDGE_DASH = '1.5 1 1.5 1 1.5 1 1.5 1 200';
export const LOOP_DASH = '1.5 1 1.5 1 1.5 1 200';

// ── Metric access & formatting ──

/** Value of the active metric on a DFG edge. */
export function edgeMetricValue(e, metric) {
    if (metric === 'absolute') return e.absoluteCount;
    if (metric === 'relative') return e.relativeCount;
    return e.caseCount;
}

/** Value of the active metric on a DFG node. */
export function nodeMetricValue(n, metric) {
    if (metric === 'absolute') return n.absoluteFreq;
    if (metric === 'relative') return n.relativeFreq;
    return n.caseFreq;
}

/** Node metric label: integer / 1-decimal % / 0-decimal %. */
export function formatNodeMetric(n, metric) {
    if (metric === 'absolute') return String(n.absoluteFreq);
    if (metric === 'relative') return (n.relativeFreq * 100).toFixed(1) + '%';
    return (n.caseFreq * 100).toFixed(0) + '%';
}

/** Edge metric label: integer / 1-decimal % / 0-decimal %. */
export function formatEdgeMetric(e, metric) {
    if (metric === 'absolute') return String(e.absoluteCount);
    if (metric === 'relative') return (e.relativeCount * 100).toFixed(1) + '%';
    return (e.caseCount * 100).toFixed(0) + '%';
}

// ── DFG model (port of network-tab.ts buildBupaRDFG) ──

/**
 * Build a bupaR-style DFG: activity DFG from sequences, plus synthetic
 * Start/End nodes with entry/exit edges (first/last activity per case).
 * Relative metric = per-source-node outgoing (Markov-chain style), where
 * Start's outgoing total is the number of sequences and each activity's
 * outgoing total includes its →End edge.
 *
 * @param {(string|null)[][]} sequences  event sequences (nulls dropped)
 * @param {string[]} labels              activity display order
 * @returns {{ nodes: object[], edges: object[], totalSequences: number, totalTransitions: number }}
 */
export function buildBupaRDFG(sequences, labels) {
    const clean = sequences
        .map((seq) => seq.filter((s) => s !== null && s !== undefined))
        .filter((s) => s.length > 0);
    const totalSeq = clean.length;

    // Activity frequencies (absolute + deduped case presence)
    const absFreq = new Map();
    const casePresence = new Map();
    for (const seq of clean) {
        const seen = new Set();
        for (const s of seq) {
            absFreq.set(s, (absFreq.get(s) ?? 0) + 1);
            seen.add(s);
        }
        for (const s of seen) casePresence.set(s, (casePresence.get(s) ?? 0) + 1);
    }

    // Transition counts (activity→activity)
    const transMap = new Map();
    const caseTrans = new Map();
    let totalTrans = 0;
    for (const seq of clean) {
        const seenT = new Set();
        for (let i = 0; i < seq.length - 1; i++) {
            const key = `${seq[i]}\0${seq[i + 1]}`;
            transMap.set(key, (transMap.get(key) ?? 0) + 1);
            totalTrans++;
            seenT.add(key);
        }
        for (const k of seenT) caseTrans.set(k, (caseTrans.get(k) ?? 0) + 1);
    }

    // Start/End edges (first/last activity per case)
    const startCounts = new Map();
    const endCounts = new Map();
    for (const seq of clean) {
        startCounts.set(seq[0], (startCounts.get(seq[0]) ?? 0) + 1);
        const last = seq[seq.length - 1];
        endCounts.set(last, (endCounts.get(last) ?? 0) + 1);
    }

    // Outgoing totals per node (Markov normalization; includes →End edges)
    const outgoing = new Map();
    outgoing.set('Start', totalSeq);
    for (const [key, count] of transMap) {
        const from = key.slice(0, key.indexOf('\0'));
        outgoing.set(from, (outgoing.get(from) ?? 0) + count);
    }
    for (const [act, count] of endCounts) {
        outgoing.set(act, (outgoing.get(act) ?? 0) + count);
    }

    // Nodes
    const nodes = [
        { id: 'Start', type: 'start', absoluteFreq: totalSeq, relativeFreq: 1, caseFreq: 1 },
    ];
    const totalOcc = [...absFreq.values()].reduce((a, b) => a + b, 0);
    for (const id of labels) {
        if (!absFreq.has(id)) continue;
        nodes.push({
            id, type: 'activity',
            absoluteFreq: absFreq.get(id),
            relativeFreq: totalOcc > 0 ? absFreq.get(id) / totalOcc : 0,
            caseFreq: totalSeq > 0 ? (casePresence.get(id) ?? 0) / totalSeq : 0,
        });
    }
    nodes.push({ id: 'End', type: 'end', absoluteFreq: totalSeq, relativeFreq: 1, caseFreq: 1 });

    // Edges
    const edges = [];
    for (const [act, count] of startCounts) {
        const out = outgoing.get('Start') ?? totalSeq;
        edges.push({
            from: 'Start', to: act,
            absoluteCount: count,
            relativeCount: out > 0 ? count / out : 0,
            caseCount: totalSeq > 0 ? count / totalSeq : 0,
        });
    }
    for (const [key, count] of transMap) {
        const sep = key.indexOf('\0');
        const from = key.slice(0, sep), to = key.slice(sep + 1);
        const out = outgoing.get(from) ?? 1;
        edges.push({
            from, to,
            absoluteCount: count,
            relativeCount: out > 0 ? count / out : 0,
            caseCount: totalSeq > 0 ? (caseTrans.get(key) ?? 0) / totalSeq : 0,
        });
    }
    for (const [act, count] of endCounts) {
        const out = outgoing.get(act) ?? 1;
        edges.push({
            from: act, to: 'End',
            absoluteCount: count,
            relativeCount: out > 0 ? count / out : 0,
            caseCount: totalSeq > 0 ? count / totalSeq : 0,
        });
    }

    return { nodes, edges, totalSequences: totalSeq, totalTransitions: totalTrans };
}

// ── Threshold (ports of computeAutoThreshold / pruneDFG) ──

/**
 * Auto-threshold via cumulative weight coverage: sort edge values descending
 * by the active metric, accumulate, return the value at which `coverage`
 * fraction of the total weight is captured. Edges below it are the noise tail.
 */
export function computeAutoThreshold(edges, metric, coverage = 0.95) {
    const vals = edges.map((e) => edgeMetricValue(e, metric)).sort((a, b) => b - a);
    const total = vals.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    let acc = 0;
    for (const v of vals) {
        acc += v;
        if (acc >= coverage * total) return v;
    }
    return 0;
}

/**
 * Filter DFG edges by the active metric against a threshold. Also drops edges
 * whose % label would round to 0 in relative/case modes, always keeps the
 * Start/End nodes, and drops activity nodes left with no surviving edge.
 */
export function pruneDFG(dfg, threshold, metric) {
    const kept = dfg.edges.filter((e) => {
        if (edgeMetricValue(e, metric) < threshold) return false;
        if (metric === 'relative' && Math.round(e.relativeCount * 100) === 0) return false;
        if (metric === 'case' && Math.round(e.caseCount * 100) === 0) return false;
        return true;
    });
    const active = new Set(['Start', 'End']);
    for (const e of kept) { active.add(e.from); active.add(e.to); }
    return {
        ...dfg,
        edges: kept,
        nodes: dfg.nodes.filter((n) => active.has(n.id)),
    };
}

// ── Node sizing ──

/**
 * Approximate node width from the label (no DOM text measurement):
 * ~7px per character + 44px padding, min 110; sentinels are SENT_R*2.
 */
export function nodeWidthFor(node) {
    if (node.type !== 'activity') return SENT_R * 2;
    return Math.max(node.id.length * 7 + 44, 110);
}

// ── Dagre layout (port of svg-process-map.ts dagreLayout, LR only) ──

/**
 * Sugiyama layout of the pruned DFG. Self-loops are excluded from layout,
 * outlier nodes are pulled toward the centroid (2× the doubled median
 * nearest-neighbor gap cap), and the End node is forced into its own
 * rightmost column.
 *
 * @returns {{ positions: Record<string,{x:number,y:number}>, width: number, height: number }}
 */
export function layoutDFG(dfg, widths) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: 'LR',
        nodesep: 40,
        edgesep: 20,
        ranksep: 120,
        marginx: 50,
        marginy: 40,
        acyclicer: 'greedy',
        ranker: 'network-simplex',
    });
    g.setDefaultEdgeLabel(() => ({}));

    const known = new Set(dfg.nodes.map((n) => n.id));
    for (const n of dfg.nodes) {
        g.setNode(n.id, {
            width: widths[n.id] ?? 100,
            height: n.type === 'activity' ? RECT_H : SENT_R * 2,
        });
    }
    for (const e of dfg.edges) {
        if (e.from === e.to) continue;                       // self-loops: not laid out
        if (!known.has(e.from) || !known.has(e.to)) continue; // defensive: skip dangling
        g.setEdge(e.from, e.to, { weight: e.absoluteCount });
    }

    dagre.layout(g);

    const positions = {};
    for (const n of dfg.nodes) {
        const node = g.node(n.id);
        positions[n.id] = { x: node.x, y: node.y };
    }

    // Cap distances: pull far outliers toward the centroid so a stray node
    // cannot blow up the canvas (max 2× the 2.5×-median nearest-neighbor gap).
    const allPos = Object.values(positions);
    if (allPos.length > 2) {
        const nnDists = allPos.map((p1) => {
            let minD = Infinity;
            for (const p2 of allPos) {
                if (p1 === p2) continue;
                const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (d < minD) minD = d;
            }
            return minD;
        });
        nnDists.sort((a, b) => a - b);
        const medianGap = nnDists[Math.floor(nnDists.length / 2)];
        const maxGap = medianGap * 2.5;
        const cx = allPos.reduce((s, p) => s + p.x, 0) / allPos.length;
        const cy = allPos.reduce((s, p) => s + p.y, 0) / allPos.length;
        for (const pos of allPos) {
            const dx = pos.x - cx, dy = pos.y - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > maxGap * 2) {
                const scale = (maxGap * 2) / dist;
                pos.x = cx + dx * scale;
                pos.y = cy + dy * scale;
            }
        }
    }

    // Force End into its own rightmost column
    const endNode = dfg.nodes.find((n) => n.type === 'end');
    if (endNode) {
        let maxCoord = 0;
        for (const n of dfg.nodes) {
            if (n.type === 'end') continue;
            maxCoord = Math.max(maxCoord, positions[n.id].x);
        }
        positions[endNode.id].x = maxCoord + 140;
    }

    // Bounds
    let maxX = 0, maxY = 0;
    for (const [id, pos] of Object.entries(positions)) {
        const w = widths[id] ?? 100;
        maxX = Math.max(maxX, pos.x + w / 2);
        maxY = Math.max(maxY, pos.y + RECT_H / 2);
    }

    return { positions, width: maxX + 50, height: maxY + 40 };
}

// ── Edge geometry (port of svg-process-map.ts rectExit/nodeExit/edge loop) ──

/**
 * Intersection of the ray (cx,cy)→(tx,ty) with the axis-aligned box of
 * half-extents (hw,hh) centered at (cx,cy).
 */
export function rectBoundaryPoint(cx, cy, hw, hh, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx + hw, y: cy };
    const sx = Math.abs(dx) < 1e-9 ? 1e9 : hw / Math.abs(dx);
    const sy = Math.abs(dy) < 1e-9 ? 1e9 : hh / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
}

/** Point on a circle of radius r centered at (cx,cy) toward (tx,ty). */
export function circleBoundaryPoint(cx, cy, r, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: cx + (dx / len) * r, y: cy + (dy / len) * r };
}

/** Cubic Bézier point at t=0.5 (de Casteljau weights .125/.375/.375/.125). */
export function cubicMidpoint(p0, c1, c2, p3) {
    return {
        x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x,
        y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y,
    };
}

/**
 * Arrowhead polygon `points` string with the tip at (x,y), pointing along
 * (fromX,fromY)→(x,y). Length 9, half-width 4.5.
 */
export function arrowPolygonPoints(x, y, fromX, fromY) {
    const tdx = x - fromX, tdy = y - fromY;
    const al = Math.hypot(tdx, tdy) || 1;
    const aux = tdx / al, auy = tdy / al;
    const arrowLen = 9, arrowHW = 4.5;
    const bx = x - aux * arrowLen, by = y - auy * arrowLen;
    return `${x},${y} ${bx - auy * arrowHW},${by + aux * arrowHW} ${bx + auy * arrowHW},${by - aux * arrowHW}`;
}

/** Edge start/end point on a node boundary (rect + 3px pad, circle + 3px pad). */
export function nodeExitPoint(id, ctx, tx, ty) {
    const p = ctx.positions[id];
    const w = ctx.widths[id] ?? 100;
    if (ctx.types[id] !== 'activity') return circleBoundaryPoint(p.x, p.y, SENT_R + 3, tx, ty);
    return rectBoundaryPoint(p.x, p.y, w / 2 + 3, RECT_H / 2 + 3, tx, ty);
}

/**
 * Full render geometry for one DFG edge.
 *
 * @param {object} edge  { from, to, ... }
 * @param {object} ctx   { positions: Record<id,{x,y}>, types: Record<id,type>,
 *                         widths: Record<id,number>, centroidY: number,
 *                         edgeSet: Set<'from→to'> }
 * @returns {null | { selfLoop: boolean, pathD: string, dashArray: string,
 *                    arrowPoints: string, labelX: number, labelY: number }}
 */
export function edgeGeometry(edge, ctx) {
    const sp = ctx.positions[edge.from];
    const tp = ctx.positions[edge.to];
    if (!sp || !tp) return null;

    // Self-loop: an arc over the node top (span ±0.4·width, height 24)
    if (edge.from === edge.to) {
        const nw = ctx.widths[edge.from] ?? 100;
        const halfSpan = nw * 0.4;
        const loopH = 24;
        const topY = sp.y - RECT_H / 2;
        const lx = sp.x - halfSpan;
        const rx = sp.x + halfSpan;
        return {
            selfLoop: true,
            pathD: `M${lx},${topY} C${lx},${topY - loopH * 2} ${rx},${topY - loopH * 2} ${rx},${topY}`,
            dashArray: LOOP_DASH,
            arrowPoints: `${rx},${topY} ${rx - 5},${topY - 6} ${rx + 5},${topY - 4}`,
            labelX: sp.x,
            labelY: topY - loopH * 1.4,
        };
    }

    const dx = tp.x - sp.x, dy = tp.y - sp.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;                 // unit normal
    const isBidir = ctx.edgeSet.has(`${edge.to}→${edge.from}`);
    const isBack = tp.x < sp.x - 10;                     // LR back-edge
    const bidirSign = isBidir ? (edge.from < edge.to ? 1 : -1) : 1;

    let curv;
    if (isBack) curv = Math.max(50, len * 0.35);
    else if (isBidir) curv = Math.max(22, len * 0.12);
    else curv = Math.max(8, len * 0.06);

    let offX, offY;
    if (isBack) {
        // Back-edges bow away from the layout centroid vertically
        const midY = (sp.y + tp.y) / 2;
        const sign = midY < ctx.centroidY ? -1 : 1;
        offX = 0; offY = curv * sign;
    } else {
        offX = px * curv * bidirSign; offY = py * curv * bidirSign;
    }

    const c1 = { x: sp.x + dx * 0.25 + offX, y: sp.y + dy * 0.25 + offY };
    const c2 = { x: sp.x + dx * 0.75 + offX, y: sp.y + dy * 0.75 + offY };
    const sExit = nodeExitPoint(edge.from, ctx, c1.x, c1.y);
    const tEntry = nodeExitPoint(edge.to, ctx, c2.x, c2.y);

    const mid = cubicMidpoint(sExit, c1, c2, tEntry);
    const loff = isBidir ? 10 * bidirSign : 8;

    return {
        selfLoop: false,
        pathD: `M${sExit.x},${sExit.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${tEntry.x},${tEntry.y}`,
        dashArray: EDGE_DASH,
        arrowPoints: arrowPolygonPoints(tEntry.x, tEntry.y, c2.x, c2.y),
        labelX: mid.x + px * loff * bidirSign,
        labelY: mid.y + py * loff * bidirSign,
    };
}

// ── Colors (hand-rolled, no d3) ──

/** '#rrggbb' → { r, g, b } (0–255). Accepts 3- or 6-digit hex. */
export function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

/** { r, g, b } → '#rrggbb'. Channels are clamped and rounded. */
export function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear RGB-space interpolation between two hex colors at t ∈ [0,1]. */
export function interpolateHex(h1, h2, t) {
    const a = hexToRgb(h1), b = hexToRgb(h2);
    return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

/**
 * bupaR-style node fill: piecewise-linear interpolation across
 * NODE_COLOR_RAMP over the domain [min(minFreq,0), midpoint, max(maxFreq,1)]
 * (light rose → steel blue → dark navy).
 */
export function nodeFillColor(freq, minFreq, maxFreq) {
    const lo = Math.min(minFreq, 0);
    const hi = Math.max(maxFreq, 1);
    const mid = (lo + hi) / 2;
    if (freq <= lo) return NODE_COLOR_RAMP[0];
    if (freq >= hi) return NODE_COLOR_RAMP[2];
    if (freq <= mid) {
        const t = mid > lo ? (freq - lo) / (mid - lo) : 0;
        return interpolateHex(NODE_COLOR_RAMP[0], NODE_COLOR_RAMP[1], t);
    }
    const t = hi > mid ? (freq - mid) / (hi - mid) : 0;
    return interpolateHex(NODE_COLOR_RAMP[1], NODE_COLOR_RAMP[2], t);
}

/** CIELAB L* (0 = black, 100 = white) of a hex color, hand-rolled. */
export function labLightness(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lin = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
    return 116 * fy - 16;
}

/** Label/metric text colors for an activity fill: white on dark, navy on light. */
export function textColorsFor(fillHex) {
    const dark = labLightness(fillHex) < 45;
    return dark
        ? { label: '#fff', metric: 'rgba(255,255,255,0.8)' }
        : { label: '#1a2744', metric: '#4a5568' };
}

/** Darker border color: scale each RGB channel by `factor` (default ~0.7). */
export function darkenHex(hex, factor = 0.7) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r * factor, g * factor, b * factor);
}

/** Edge stroke opacity: linear [0.25, 0.65] over absoluteCount, clamped. */
export function edgeOpacityFor(count, minCount, maxCount) {
    if (!(maxCount - minCount > 0)) return 0.45; // degenerate domain → midpoint
    const t = Math.max(0, Math.min(1, (count - minCount) / (maxCount - minCount)));
    return 0.25 + t * 0.4;
}
