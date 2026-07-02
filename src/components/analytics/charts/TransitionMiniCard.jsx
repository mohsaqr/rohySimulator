import React, { useMemo, useState } from 'react';
import { ftna, centralities } from 'dynajs';
import { CARM_PALETTE } from './chartMath';

/*
 * A compact, self-contained transition-network card: a circular arc diagram
 * of the TNA model on the left and a centrality panel on the right. Built to
 * sit inside the Gaze tab as an "extra" surface with its own look —
 * gradient glass card, arced directed edges, throughput-sized nodes — so it
 * reads as distinct from the flat laila dashboard graph.
 *
 * Props:
 *   sequences  string[][]  per-session state sequences
 *   labels     string[]    (optional) the state vocabulary; derived if absent
 *   title      string
 *   subtitle   string
 *   colorFor   (label) => hex   (optional) node color; palette fallback
 *   accent     'indigo'|'violet'|'cyan'|'emerald'   card tint
 */

const MEASURES = ['InStrength', 'OutStrength', 'Betweenness', 'Closeness'];

const fmtCent = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/**
 * Turn dynajs TNA output into a plain {nodes, edges} graph.
 * @returns {{nodes:{i:number,label:string,inW:number,outW:number,throughput:number}[],
 *            edges:{from:number,to:number,weight:number,self:boolean}[], maxEdge:number}}
 */
export function buildTransitionGraph(sequences, labels) {
    const seqs = (sequences ?? []).filter((s) => Array.isArray(s) && s.length >= 2);
    let labelList = Array.isArray(labels) && labels.length ? labels : null;
    if (!labelList) {
        const set = new Set();
        seqs.forEach((s) => s.forEach((v) => set.add(v)));
        labelList = [...set].sort();
    }
    if (seqs.length === 0 || labelList.length === 0) {
        return { nodes: [], edges: [], maxEdge: 0, labels: labelList, model: null };
    }

    // Frequency TNA — raw transition COUNTS so node throughput and edge
    // weight are interpretable (relative `tna` would give probabilities).
    const model = ftna(seqs, { labels: labelList });
    const { data, cols } = model.weights;
    const n = labelList.length;

    const nodes = labelList.map((label, i) => ({ i, label, inW: 0, outW: 0, throughput: 0 }));
    const edges = [];
    let maxEdge = 0;
    for (let r = 0; r < n; r += 1) {
        for (let c = 0; c < n; c += 1) {
            const w = data[r * cols + c] ?? 0;
            if (w <= 0) continue;
            edges.push({ from: r, to: c, weight: w, self: r === c });
            nodes[r].outW += w;
            nodes[c].inW += w;
            if (w > maxEdge) maxEdge = w;
        }
    }
    nodes.forEach((nd) => { nd.throughput = nd.inW + nd.outW; });

    return { nodes, edges, maxEdge, labels: labelList, model };
}

const polar = (cx, cy, r, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];

const truncate = (s, n = 13) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ArcNetwork({ nodes, edges, maxEdge, colorOf, nodeValue, measure }) {
    // Wide canvas + generous side margins so left/right labels never clip
    // (the previous square viewBox cut "Patient" → "Patie").
    const W = 460;
    const H = 380;
    const cx = W / 2;
    const cy = H / 2;
    const ringR = Math.min(W, H) * 0.30;
    const n = nodes.length;
    const angleAt = (i) => -Math.PI / 2 + (i / n) * 2 * Math.PI; // top, clockwise
    const pos = nodes.map((_, i) => polar(cx, cy, ringR, angleAt(i)));
    // Node size follows the SELECTED centrality measure so the network and
    // the bar chart always tell the same story (no size/bar discrepancy).
    // When a measure is all-zero (e.g. Betweenness on a tiny graph) fall
    // back to throughput so nodes stay visible.
    const vals = nodes.map((nd) => nodeValue(nd.i));
    const maxVal = Math.max(...vals, 0);
    const sizeBasis = maxVal > 0 ? vals : nodes.map((nd) => nd.throughput);
    const maxBasis = Math.max(1, ...sizeBasis);
    const nodeR = (nd) => 7 + 11 * Math.sqrt(sizeBasis[nd.i] / maxBasis);
    const edgeW = (w) => 1.2 + 3.3 * (w / (maxEdge || 1));
    const edgeOpacity = (w) => 0.28 + 0.5 * (w / (maxEdge || 1));

    // Small filled arrowhead, colored to match its edge, drawn manually so it
    // scales with the edge instead of a giant shared gray marker.
    const arrowHead = (ex, ey, ang, color, size) => {
        const a = ang;
        const p1 = [ex, ey];
        const p2 = [ex - size * Math.cos(a - 0.42), ey - size * Math.sin(a - 0.42)];
        const p3 = [ex - size * Math.cos(a + 0.42), ey - size * Math.sin(a + 0.42)];
        return `${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;
    };

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`} width="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{ maxWidth: '100%' }}
            role="img" aria-label="Transition network"
        >
            {edges.map((e, k) => {
                const color = colorOf(nodes[e.from].label);
                if (e.self) {
                    const [nx, ny] = pos[e.from];
                    const out = 1.5 * nodeR(nodes[e.from]);
                    const ang = Math.atan2(ny - cy, nx - cx);
                    const [lx, ly] = polar(nx, ny, out, ang);
                    return (
                        <circle
                            key={`self-${k}`} cx={lx} cy={ly} r={out * 0.5}
                            fill="none" stroke={color} strokeWidth={edgeW(e.weight)}
                            opacity={edgeOpacity(e.weight)}
                        />
                    );
                }
                const [x1, y1] = pos[e.from];
                const [x2, y2] = pos[e.to];
                const dx = x2 - x1;
                const dy = y2 - y1;
                const len = Math.hypot(dx, dy) || 1;
                const bow = 0.13 * len; // gentle, so opposite directions still separate
                const cxp = (x1 + x2) / 2 - (dy / len) * bow;
                const cyp = (y1 + y2) / 2 + (dx / len) * bow;
                // stop at the target rim so the arrowhead sits cleanly on it
                const tR = nodeR(nodes[e.to]) + 3;
                const tang = Math.atan2(y2 - cyp, x2 - cxp);
                const ex = x2 - tR * Math.cos(tang);
                const ey = y2 - tR * Math.sin(tang);
                const head = 5 + edgeW(e.weight);
                return (
                    <g key={`e-${k}`} opacity={edgeOpacity(e.weight)}>
                        <path
                            d={`M${x1},${y1} Q${cxp},${cyp} ${ex},${ey}`}
                            fill="none" stroke={color} strokeWidth={edgeW(e.weight)} strokeLinecap="round"
                        >
                            <title>{`${nodes[e.from].label} → ${nodes[e.to].label}: ${e.weight}`}</title>
                        </path>
                        <polygon points={arrowHead(ex, ey, tang, color, head)} fill={color} />
                    </g>
                );
            })}
            {nodes.map((nd, i) => {
                const [x, y] = pos[i];
                const r = nodeR(nd);
                const color = colorOf(nd.label);
                const [lx, ly] = polar(cx, cy, ringR + r + 10, angleAt(i));
                const anchor = lx < cx - 6 ? 'end' : lx > cx + 6 ? 'start' : 'middle';
                return (
                    <g key={`n-${i}`}>
                        <circle cx={x} cy={y} r={r} fill={color} opacity={0.92} stroke="#fff" strokeWidth={2}>
                            <title>{`${nd.label} · ${measure} ${fmtCent(nodeValue(nd.i))} · in ${nd.inW} · out ${nd.outW}`}</title>
                        </circle>
                        <text
                            x={lx} y={ly} fontSize={11} fontWeight={600}
                            textAnchor={anchor} dominantBaseline="middle" fill="#334155"
                        >
                            {truncate(nd.label)}
                            <title>{nd.label}</title>
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function CentralityPanel({ cent, measure, setMeasure, colorOf }) {
    const rows = useMemo(() => {
        const m = cent.measures?.[measure] ?? {};
        return cent.labels
            .map((label, i) => ({ label, value: m[i] ?? 0 }))
            .sort((a, b) => b.value - a.value);
    }, [cent, measure]);
    const max = Math.max(1e-9, ...rows.map((r) => r.value));

    return (
        <div className="flex flex-col">
            <div className="mb-2 flex flex-wrap gap-1">
                {MEASURES.map((m) => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => setMeasure(m)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                            measure === m
                                ? 'bg-slate-800 text-white'
                                : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        {m}
                    </button>
                ))}
            </div>
            <div className="flex flex-col gap-2.5">
                {rows.map((r) => (
                    <div key={r.label} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 truncate text-right text-xs text-slate-600" title={r.label}>{r.label}</span>
                        <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-100">
                            <div
                                className="h-full rounded"
                                style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: colorOf(r.label), opacity: 0.85 }}
                            />
                        </div>
                        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-700">{fmtCent(r.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function TransitionMiniCard({
    sequences, labels, title, subtitle, colorFor,
}) {
    const graph = useMemo(() => buildTransitionGraph(sequences, labels), [sequences, labels]);
    const [measure, setMeasure] = useState('InStrength');
    // Centralities computed once; drive BOTH the bars and the node sizes so
    // the two views never disagree.
    const cent = useMemo(() => (graph.model ? centralities(graph.model) : null), [graph.model]);
    const nodeValue = useMemo(() => {
        const m = cent?.measures?.[measure] ?? {};
        return (i) => m[i] ?? 0;
    }, [cent, measure]);
    const colorOf = useMemo(() => {
        const order = graph.labels ?? [];
        return (label) => {
            if (colorFor) {
                const c = colorFor(label);
                if (c) return c;
            }
            const idx = order.indexOf(label);
            return CARM_PALETTE[(idx < 0 ? 0 : idx) % CARM_PALETTE.length];
        };
    }, [graph.labels, colorFor]);

    // Same shell as every other card in the Gaze view (rounded-lg border
    // bg-white p-4, uppercase heading), and the same two-column grid the
    // sibling "Screen zones / Gaze centroids" row uses — so it aligns and
    // balances identically instead of standing out.
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{title}</h3>
            {subtitle && <p className="mb-3 text-xs text-gray-500">{subtitle}</p>}
            {graph.nodes.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-500">
                    Not enough movement to build a network — need at least one session with 2+ distinct states.
                </p>
            ) : (
                // Content is contained (max-w-5xl) so on a full-width row the
                // bars don't sprawl to ~1400px and the network fills its half
                // instead of floating tiny. Two even halves, vertically
                // centered, like the sibling zone/centroid cards.
                <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-2">
                    <ArcNetwork
                        nodes={graph.nodes} edges={graph.edges} maxEdge={graph.maxEdge}
                        colorOf={colorOf} nodeValue={nodeValue} measure={measure}
                    />
                    <div>
                        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Centrality — node size follows the selected measure
                        </div>
                        <CentralityPanel cent={cent} measure={measure} setMeasure={setMeasure} colorOf={colorOf} />
                    </div>
                </div>
            )}
        </section>
    );
}
