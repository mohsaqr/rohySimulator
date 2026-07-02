import { describe, expect, it } from 'vitest';
import {
    RECT_H, SENT_R, EDGE_DASH, LOOP_DASH, NODE_COLOR_RAMP,
    buildBupaRDFG, computeAutoThreshold, pruneDFG,
    edgeMetricValue, nodeMetricValue, formatNodeMetric, formatEdgeMetric,
    nodeWidthFor, layoutDFG,
    rectBoundaryPoint, circleBoundaryPoint, cubicMidpoint, arrowPolygonPoints,
    edgeGeometry,
    hexToRgb, rgbToHex, interpolateHex, nodeFillColor,
    labLightness, textColorsFor, darkenHex, edgeOpacityFor,
} from './processMapUtils';
import { toCSV } from './exports';

// Pure logic behind the Process Map (DFG) tab — the carmdash/moodle-tna port
// (buildBupaRDFG / computeAutoThreshold / pruneDFG + hand-rolled Bézier /
// boundary / color geometry). Every fixture below is hand-computed.

// 3 tiny sequences, hand-computable end to end:
//   s1: a → b → c
//   s2: a → b
//   s3: b → c
// totalSeq = 3; transitions: a→b ×2, b→c ×2 (total 4)
// occurrences: a=2, b=3, c=2 (total 7); case presence: a=2/3, b=3/3, c=2/3
// starts: a×2, b×1; ends: c×2, b×1
// outgoing: Start=3, a=2 (a→b), b=3 (b→c ×2 + b→End ×1), c=2 (c→End ×2)
const SEQS = [['a', 'b', 'c'], ['a', 'b'], ['b', 'c']];
const LABELS = ['a', 'b', 'c'];

const findEdge = (dfg, from, to) => dfg.edges.find((e) => e.from === from && e.to === to);

describe('processMapUtils.buildBupaRDFG', () => {
    const dfg = buildBupaRDFG(SEQS, LABELS);

    it('counts sequences and transitions', () => {
        expect(dfg.totalSequences).toBe(3);
        expect(dfg.totalTransitions).toBe(4);
    });

    it('emits Start, labeled activities (in label order), then End', () => {
        expect(dfg.nodes.map((n) => n.id)).toEqual(['Start', 'a', 'b', 'c', 'End']);
        expect(dfg.nodes.map((n) => n.type)).toEqual(['start', 'activity', 'activity', 'activity', 'end']);
    });

    it('node absolute = occurrences, relative = share of all occurrences, case = deduped fraction', () => {
        const b = dfg.nodes.find((n) => n.id === 'b');
        expect(b.absoluteFreq).toBe(3);
        expect(b.relativeFreq).toBeCloseTo(3 / 7);
        expect(b.caseFreq).toBeCloseTo(1);

        const a = dfg.nodes.find((n) => n.id === 'a');
        expect(a.absoluteFreq).toBe(2);
        expect(a.relativeFreq).toBeCloseTo(2 / 7);
        expect(a.caseFreq).toBeCloseTo(2 / 3);
    });

    it('sentinel nodes carry totalSequences / 100%', () => {
        const start = dfg.nodes.find((n) => n.id === 'Start');
        expect(start).toMatchObject({ absoluteFreq: 3, relativeFreq: 1, caseFreq: 1 });
        const end = dfg.nodes.find((n) => n.id === 'End');
        expect(end).toMatchObject({ absoluteFreq: 3, relativeFreq: 1, caseFreq: 1 });
    });

    it('Start edges: outgoing total is the number of sequences', () => {
        expect(findEdge(dfg, 'Start', 'a')).toMatchObject({ absoluteCount: 2 });
        expect(findEdge(dfg, 'Start', 'a').relativeCount).toBeCloseTo(2 / 3);
        expect(findEdge(dfg, 'Start', 'b').relativeCount).toBeCloseTo(1 / 3);
        expect(findEdge(dfg, 'Start', 'b').caseCount).toBeCloseTo(1 / 3);
    });

    it('activity edges: relative is a per-source Markov probability incl. the →End edge', () => {
        // a's only outgoing is a→b (×2) → P = 1
        expect(findEdge(dfg, 'a', 'b').relativeCount).toBeCloseTo(1);
        // b's outgoing = b→c ×2 + b→End ×1 → P(b→c) = 2/3, P(b→End) = 1/3
        expect(findEdge(dfg, 'b', 'c').relativeCount).toBeCloseTo(2 / 3);
        expect(findEdge(dfg, 'b', 'End').relativeCount).toBeCloseTo(1 / 3);
        // c's outgoing is only c→End ×2 → P = 1
        expect(findEdge(dfg, 'c', 'End').relativeCount).toBeCloseTo(1);
    });

    it('case metric on edges is deduped per sequence', () => {
        // a→b occurs in s1 and s2 → 2/3; b→c in s1 and s3 → 2/3
        expect(findEdge(dfg, 'a', 'b').caseCount).toBeCloseTo(2 / 3);
        expect(findEdge(dfg, 'b', 'c').caseCount).toBeCloseTo(2 / 3);
    });

    it('per-source relative probabilities sum to 1', () => {
        for (const from of ['Start', 'a', 'b', 'c']) {
            const sum = dfg.edges
                .filter((e) => e.from === from)
                .reduce((s, e) => s + e.relativeCount, 0);
            expect(sum).toBeCloseTo(1);
        }
    });

    it('drops nulls inside sequences and empty sequences entirely', () => {
        const out = buildBupaRDFG([['a', null, 'b'], [null], []], ['a', 'b']);
        expect(out.totalSequences).toBe(1);
        expect(out.totalTransitions).toBe(1);
        expect(findEdge(out, 'a', 'b').absoluteCount).toBe(1);
    });

    it('ignores labels that never occur', () => {
        const out = buildBupaRDFG([['a']], ['a', 'ghost']);
        expect(out.nodes.map((n) => n.id)).toEqual(['Start', 'a', 'End']);
    });
});

describe('processMapUtils.computeAutoThreshold', () => {
    const edges = (vals) => vals.map((v, i) => ({ from: `n${i}`, to: `m${i}`, absoluteCount: v, relativeCount: 0, caseCount: 0 }));

    it('returns the value where cumulative coverage is reached (95% default)', () => {
        // sorted desc 8,1,1 · total 10 · 95% = 9.5 → 8 (no), 9 (no), 10 (yes) → 1
        expect(computeAutoThreshold(edges([1, 8, 1]), 'absolute')).toBe(1);
    });

    it('a dominant edge alone can satisfy a lower coverage', () => {
        // 8 ≥ 0.8 × 10 → threshold is the dominant edge's own value
        expect(computeAutoThreshold(edges([1, 8, 1]), 'absolute', 0.8)).toBe(8);
    });

    it('uses the ACTIVE metric, not always absoluteCount', () => {
        const es = [
            { from: 'a', to: 'b', absoluteCount: 10, relativeCount: 0.1, caseCount: 0 },
            { from: 'b', to: 'c', absoluteCount: 1, relativeCount: 0.9, caseCount: 0 },
        ];
        expect(computeAutoThreshold(es, 'relative', 0.5)).toBeCloseTo(0.9);
    });

    it('zero total weight → 0; empty edge list → 0', () => {
        expect(computeAutoThreshold(edges([0, 0]), 'absolute')).toBe(0);
        expect(computeAutoThreshold([], 'absolute')).toBe(0);
    });
});

describe('processMapUtils.pruneDFG', () => {
    const dfg = buildBupaRDFG(SEQS, LABELS);

    it('threshold 0 keeps everything', () => {
        const out = pruneDFG(dfg, 0, 'absolute');
        expect(out.edges).toHaveLength(dfg.edges.length);
        expect(out.nodes).toHaveLength(dfg.nodes.length);
    });

    it('filters edges below the threshold on the active metric', () => {
        // abs counts: Start→a 2, Start→b 1, a→b 2, b→c 2, b→End 1, c→End 2
        const out = pruneDFG(dfg, 2, 'absolute');
        expect(out.edges).toHaveLength(4);
        expect(out.edges.every((e) => e.absoluteCount >= 2)).toBe(true);
    });

    it('drops edges whose % label would round to 0 even above the threshold', () => {
        const tiny = {
            nodes: [
                { id: 'Start', type: 'start' }, { id: 'x', type: 'activity' },
                { id: 'y', type: 'activity' }, { id: 'End', type: 'end' },
            ],
            edges: [
                { from: 'x', to: 'y', absoluteCount: 1, relativeCount: 0.004, caseCount: 0.004 },
                { from: 'x', to: 'End', absoluteCount: 9, relativeCount: 0.996, caseCount: 1 },
            ],
            totalSequences: 1, totalTransitions: 1,
        };
        const rel = pruneDFG(tiny, 0, 'relative');
        expect(rel.edges).toHaveLength(1);
        expect(rel.edges[0].to).toBe('End');
        const cas = pruneDFG(tiny, 0, 'case');
        expect(cas.edges).toHaveLength(1);
        // absolute mode never applies the %-rounding drop
        expect(pruneDFG(tiny, 0, 'absolute').edges).toHaveLength(2);
    });

    it('always keeps Start/End and drops isolated activity nodes', () => {
        const out = pruneDFG(dfg, 99, 'absolute');
        expect(out.edges).toHaveLength(0);
        expect(out.nodes.map((n) => n.id).sort()).toEqual(['End', 'Start']);
    });
});

describe('processMapUtils metric access & formatting', () => {
    const e = { absoluteCount: 7, relativeCount: 0.256, caseCount: 0.667 };
    const n = { absoluteFreq: 7, relativeFreq: 0.256, caseFreq: 0.667 };

    it('edgeMetricValue / nodeMetricValue pick the active metric', () => {
        expect(edgeMetricValue(e, 'absolute')).toBe(7);
        expect(edgeMetricValue(e, 'relative')).toBeCloseTo(0.256);
        expect(edgeMetricValue(e, 'case')).toBeCloseTo(0.667);
        expect(nodeMetricValue(n, 'absolute')).toBe(7);
        expect(nodeMetricValue(n, 'relative')).toBeCloseTo(0.256);
        expect(nodeMetricValue(n, 'case')).toBeCloseTo(0.667);
    });

    it('formats integer / 1-decimal % / 0-decimal %', () => {
        expect(formatEdgeMetric(e, 'absolute')).toBe('7');
        expect(formatEdgeMetric(e, 'relative')).toBe('25.6%');
        expect(formatEdgeMetric(e, 'case')).toBe('67%');
        expect(formatNodeMetric(n, 'absolute')).toBe('7');
        expect(formatNodeMetric(n, 'relative')).toBe('25.6%');
        expect(formatNodeMetric(n, 'case')).toBe('67%');
    });
});

describe('processMapUtils.nodeWidthFor', () => {
    it('≈7px per character + 44, floored at 110', () => {
        expect(nodeWidthFor({ id: 'ab', type: 'activity' })).toBe(110);
        expect(nodeWidthFor({ id: 'x'.repeat(20), type: 'activity' })).toBe(20 * 7 + 44);
    });

    it('sentinels are the circle diameter', () => {
        expect(nodeWidthFor({ id: 'Start', type: 'start' })).toBe(SENT_R * 2);
        expect(nodeWidthFor({ id: 'End', type: 'end' })).toBe(SENT_R * 2);
    });
});

describe('processMapUtils.layoutDFG', () => {
    const dfg = buildBupaRDFG(SEQS, LABELS);
    const widths = Object.fromEntries(dfg.nodes.map((n) => [n.id, nodeWidthFor(n)]));
    const layout = layoutDFG(dfg, widths);

    it('assigns finite coordinates to every node', () => {
        for (const n of dfg.nodes) {
            expect(Number.isFinite(layout.positions[n.id].x)).toBe(true);
            expect(Number.isFinite(layout.positions[n.id].y)).toBe(true);
        }
    });

    it('flows left-to-right: Start < a < b and End is the rightmost column', () => {
        const x = (id) => layout.positions[id].x;
        expect(x('Start')).toBeLessThan(x('a'));
        expect(x('a')).toBeLessThan(x('b'));
        for (const id of ['Start', 'a', 'b', 'c']) {
            expect(x('End')).toBeGreaterThan(x(id));
        }
    });

    it('reports positive overall dimensions', () => {
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
    });

    it('survives self-loops (excluded from layout) and dangling edges', () => {
        const withLoop = {
            ...dfg,
            edges: [...dfg.edges,
                { from: 'a', to: 'a', absoluteCount: 1, relativeCount: 0.1, caseCount: 0.1 },
                { from: 'a', to: 'ghost', absoluteCount: 1, relativeCount: 0.1, caseCount: 0.1 },
            ],
        };
        const l = layoutDFG(withLoop, widths);
        expect(Number.isFinite(l.positions.a.x)).toBe(true);
    });
});

describe('processMapUtils boundary intersections', () => {
    it('rect: ray toward the right hits the right face', () => {
        expect(rectBoundaryPoint(0, 0, 10, 5, 20, 0)).toEqual({ x: 10, y: 0 });
    });

    it('rect: ray toward the bottom hits the bottom face', () => {
        expect(rectBoundaryPoint(0, 0, 10, 5, 0, 20)).toEqual({ x: 0, y: 5 });
    });

    it('rect: diagonal ray hits the limiting face (hand-computed corner case)', () => {
        // dx=20, dy=20 → sx=0.5, sy=0.25 → s=0.25 → (5,5): bottom face wins
        expect(rectBoundaryPoint(0, 0, 10, 5, 20, 20)).toEqual({ x: 5, y: 5 });
    });

    it('rect: degenerate target at the center falls back to the right face', () => {
        expect(rectBoundaryPoint(3, 4, 10, 5, 3, 4)).toEqual({ x: 13, y: 4 });
    });

    it('circle: 3-4-5 triangle lands exactly on radius 5', () => {
        expect(circleBoundaryPoint(0, 0, 5, 30, 40)).toEqual({ x: 3, y: 4 });
    });
});

describe('processMapUtils Bézier midpoint & arrowhead', () => {
    it('cubicMidpoint applies the .125/.375/.375/.125 de Casteljau weights', () => {
        const mid = cubicMidpoint({ x: 0, y: 0 }, { x: 4, y: 8 }, { x: 8, y: 8 }, { x: 12, y: 0 });
        expect(mid.x).toBeCloseTo(0.125 * 0 + 0.375 * 4 + 0.375 * 8 + 0.125 * 12); // = 6
        expect(mid.x).toBeCloseTo(6);
        expect(mid.y).toBeCloseTo(6);
    });

    it('arrowPolygonPoints puts the tip at the endpoint with a 9×9 base', () => {
        // Pointing along +x: base at x-9, half-width 4.5 in y
        expect(arrowPolygonPoints(10, 0, 0, 0)).toBe('10,0 1,4.5 1,-4.5');
    });
});

describe('processMapUtils.edgeGeometry', () => {
    const mkCtx = (positions, { types = {}, widths = {}, centroidY = 0, edges = [] } = {}) => ({
        positions,
        types: Object.fromEntries(Object.keys(positions).map((id) => [id, types[id] ?? 'activity'])),
        widths: Object.fromEntries(Object.keys(positions).map((id) => [id, widths[id] ?? 110])),
        centroidY,
        edgeSet: new Set(edges),
    });

    it('normal forward edge: cubic path from boundary to boundary with tick dashes', () => {
        const ctx = mkCtx({ A: { x: 0, y: 0 }, B: { x: 300, y: 0 } }, { edges: ['A→B'] });
        const geo = edgeGeometry({ from: 'A', to: 'B' }, ctx);
        expect(geo.selfLoop).toBe(false);
        expect(geo.pathD).toMatch(/^M[\d.-]+,[\d.-]+ C/);
        expect(geo.dashArray).toBe(EDGE_DASH);
        // Exits A rightward (x > half-width) and enters B from the left
        const startX = Number(geo.pathD.slice(1).split(',')[0]);
        expect(startX).toBeGreaterThan(0);
        expect(startX).toBeLessThan(300);
    });

    it('self-loop: arc over the node top, ±0.4·width span, label above', () => {
        const ctx = mkCtx({ A: { x: 100, y: 100 } }, { widths: { A: 100 }, edges: ['A→A'] });
        const geo = edgeGeometry({ from: 'A', to: 'A' }, ctx);
        expect(geo.selfLoop).toBe(true);
        const topY = 100 - RECT_H / 2; // 74
        expect(geo.pathD).toBe(`M${100 - 40},${topY} C${60},${topY - 48} ${140},${topY - 48} ${140},${topY}`);
        expect(geo.dashArray).toBe(LOOP_DASH);
        expect(geo.labelX).toBe(100);
        expect(geo.labelY).toBeCloseTo(topY - 24 * 1.4);
    });

    it('back-edge bows vertically away from the centroid', () => {
        // B is left of A → back-edge. Edge midY (0) is above centroidY (100) → bows UP.
        const ctx = mkCtx({ A: { x: 300, y: 0 }, B: { x: 0, y: 0 } }, { centroidY: 100, edges: ['A→B'] });
        const geo = edgeGeometry({ from: 'A', to: 'B' }, ctx);
        // curv = max(50, 300·0.35) = 105, offset (0, -105): control y = -105
        expect(geo.pathD).toContain('C225,-105 75,-105');
    });

    it('bidirectional pair labels sit on opposite sides of the path', () => {
        // Vertical pair (same rank) so neither direction is an LR back-edge.
        const ctx = mkCtx(
            { A: { x: 0, y: 0 }, B: { x: 0, y: 200 } },
            { edges: ['A→B', 'B→A'] },
        );
        const ab = edgeGeometry({ from: 'A', to: 'B' }, ctx);
        const ba = edgeGeometry({ from: 'B', to: 'A' }, ctx);
        // label offset = px·(10·sign)·sign = px·10; px is -1 (A→B) vs +1 (B→A)
        expect(Math.sign(ab.labelX - ba.labelX)).toBe(-1);
    });

    it('returns null when a node has no position', () => {
        const ctx = mkCtx({ A: { x: 0, y: 0 } });
        expect(edgeGeometry({ from: 'A', to: 'missing' }, ctx)).toBeNull();
    });
});

describe('processMapUtils colors', () => {
    it('hex round-trip and 3-digit expansion', () => {
        expect(hexToRgb('#f5e6e8')).toEqual({ r: 245, g: 230, b: 232 });
        expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
        expect(rgbToHex(245, 230, 232)).toBe('#f5e6e8');
        expect(rgbToHex(-5, 300, 12.4)).toBe('#00ff0c'); // clamps + rounds
    });

    it('interpolateHex endpoints and midpoint', () => {
        expect(interpolateHex('#000000', '#ffffff', 0)).toBe('#000000');
        expect(interpolateHex('#000000', '#ffffff', 1)).toBe('#ffffff');
        expect(interpolateHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    });

    it('nodeFillColor hits the 3 ramp stops at lo / mid / hi', () => {
        // domain [min(0,0)=0, 0.5, max(1,1)=1]
        expect(nodeFillColor(0, 0, 1)).toBe(NODE_COLOR_RAMP[0]);
        expect(nodeFillColor(0.5, 0, 1)).toBe(NODE_COLOR_RAMP[1]);
        expect(nodeFillColor(1, 0, 1)).toBe(NODE_COLOR_RAMP[2]);
        // out-of-domain clamps
        expect(nodeFillColor(-3, 0, 1)).toBe(NODE_COLOR_RAMP[0]);
        expect(nodeFillColor(99, 0, 1)).toBe(NODE_COLOR_RAMP[2]);
    });

    it('nodeFillColor widens the domain to at least [0, 1]', () => {
        // minFreq=2, maxFreq=4 → domain [0, 2, 4]; freq 2 is the exact midpoint
        expect(nodeFillColor(2, 2, 4)).toBe(NODE_COLOR_RAMP[1]);
    });

    it('labLightness: white = 100, black = 0, ramp is ordered light → dark', () => {
        expect(labLightness('#ffffff')).toBeCloseTo(100, 0);
        expect(labLightness('#000000')).toBeCloseTo(0, 0);
        const [light, mid, dark] = NODE_COLOR_RAMP.map(labLightness);
        expect(light).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(dark);
    });

    it('textColorsFor: white text on the dark ramp end, navy on the light end', () => {
        expect(textColorsFor(NODE_COLOR_RAMP[2]).label).toBe('#fff');
        expect(textColorsFor(NODE_COLOR_RAMP[0]).label).toBe('#1a2744');
    });

    it('darkenHex scales channels toward black', () => {
        expect(darkenHex('#ff0000', 0.5)).toBe('#800000');
        expect(darkenHex('#ffffff', 0.7)).toBe('#b3b3b3');
    });
});

describe('processMapUtils.edgeOpacityFor', () => {
    it('is linear on [0.25, 0.65] over absoluteCount and clamps', () => {
        expect(edgeOpacityFor(1, 1, 5)).toBeCloseTo(0.25);
        expect(edgeOpacityFor(3, 1, 5)).toBeCloseTo(0.45);
        expect(edgeOpacityFor(5, 1, 5)).toBeCloseTo(0.65);
        expect(edgeOpacityFor(50, 1, 5)).toBeCloseTo(0.65);
        expect(edgeOpacityFor(-1, 1, 5)).toBeCloseTo(0.25);
    });

    it('degenerate domain (all edges equal) → midpoint opacity', () => {
        expect(edgeOpacityFor(4, 4, 4)).toBeCloseTo(0.45);
    });
});

describe('exports.toCSV', () => {
    const columns = [
        { key: 'from', header: 'From' },
        { key: 'n', header: 'Count' },
    ];

    it('emits header row even with no data rows', () => {
        expect(toCSV([], columns)).toBe('From,Count');
    });

    it('serializes rows with CRLF line endings', () => {
        const csv = toCSV([{ from: 'a', n: 3 }, { from: 'b', n: 1 }], columns);
        expect(csv).toBe('From,Count\r\na,3\r\nb,1');
    });

    it('quotes fields containing commas and escapes embedded quotes', () => {
        const csv = toCSV([{ from: 'a,b', n: 'say "hi"' }], columns);
        expect(csv).toBe('From,Count\r\n"a,b","say ""hi"""');
    });

    it('renders null/undefined as empty cells', () => {
        const csv = toCSV([{ from: null }], columns);
        expect(csv).toBe('From,Count\r\n,');
    });
});
