// Process map (directly-follows graph) tab. Uses dynajs's
// buildDFGFromSequences for model construction and dagre for hierarchical
// layout, mirroring the approach Carmdash documents in its CLAUDE.md.
//
// Edge pruning is **cumulative-weight 95%** (the standard Process Mining
// auto-threshold): sort edges by the active metric descending, accumulate
// weight, keep edges until cumulative reaches 95% of total. This prunes
// the noise tail without dropping structurally important edges. Per-metric
// (absolute / relative / case-count), not always absoluteCount.
//
// Layout: dagre with rank direction TB (top-to-bottom). Node ranks come
// from dagre's longest-path ranker, giving a clean process flow rather
// than the spring-style arrangements in the Network tab.

import React, { useMemo, useState } from 'react';
import { GitBranch, Workflow, Filter } from 'lucide-react';
import dagre from 'dagre';
import { buildDFGFromSequences } from 'dynajs';
import { Loading } from './Loading';
import { useTranslation } from './i18nShim';

const METRICS = [
    { value: 'absoluteCount', label: 'Absolute count' },
    { value: 'relativeCount', label: 'Relative count' },
    { value: 'caseCount',     label: 'Case frequency' },
];

const NODE_W = 120;
const NODE_H = 36;
const START_NODE = '__start__';
const END_NODE = '__end__';

/**
 * Apply cumulative-weight pruning. Returns the subset of edges whose
 * cumulative metric value covers >= coverage of total.
 */
function pruneEdgesCumulative(edges, metric, coverage) {
    if (!edges.length) return [];
    const sorted = [...edges].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
    const total = sorted.reduce((sum, e) => sum + (e[metric] || 0), 0);
    if (total <= 0) return sorted;
    const cap = total * coverage;
    let acc = 0;
    const kept = [];
    for (const e of sorted) {
        kept.push(e);
        acc += e[metric] || 0;
        if (acc >= cap) break;
    }
    return kept;
}

/**
 * Run dagre on the kept edges to compute node positions.
 */
function computeLayout(nodes, edges, metric) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 30, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeIds = new Set();
    for (const n of nodes) {
        const id = n.type === 'start' ? START_NODE : n.type === 'end' ? END_NODE : n.id;
        if (nodeIds.has(id)) continue;
        nodeIds.add(id);
        g.setNode(id, { width: NODE_W, height: NODE_H, label: n.id });
    }
    for (const e of edges) {
        const w = (e[metric] || 0);
        g.setEdge(e.from, e.to, { weight: Math.max(1, w) });
    }
    dagre.layout(g);

    const positionedNodes = nodes.map((n) => {
        const id = n.type === 'start' ? START_NODE : n.type === 'end' ? END_NODE : n.id;
        const layoutNode = g.node(id);
        return { ...n, x: layoutNode?.x ?? 0, y: layoutNode?.y ?? 0 };
    });
    const graphInfo = g.graph();
    return {
        nodes: positionedNodes,
        width: graphInfo.width || 800,
        height: graphInfo.height || 600,
    };
}

export function ProcessMap({ sequences, labels }) {
    const { t } = useTranslation();
    const [metric, setMetric] = useState('absoluteCount');
    const [coverage, setCoverage] = useState(0.95);
    const [showStartEnd, setShowStartEnd] = useState(true);

    const dfg = useMemo(() => {
        if (!sequences?.length) return null;
        try {
            return buildDFGFromSequences(sequences, labels, START_NODE, END_NODE);
        } catch {
            return null;
        }
    }, [sequences, labels]);

    const pruned = useMemo(() => {
        if (!dfg) return null;
        const edges = pruneEdgesCumulative(dfg.edges, metric, coverage);

        // Trim nodes to those touched by the surviving edges (and the
        // synthetic start/end if the user asked for them).
        const touched = new Set();
        for (const e of edges) { touched.add(e.from); touched.add(e.to); }
        const nodes = dfg.nodes.filter((n) => {
            if (n.type === 'start' || n.type === 'end') return showStartEnd && touched.has(n.id);
            return touched.has(n.id);
        });
        return { nodes, edges };
    }, [dfg, metric, coverage, showStartEnd]);

    const layout = useMemo(() => {
        if (!pruned || !pruned.nodes.length) return null;
        return computeLayout(pruned.nodes, pruned.edges, metric);
    }, [pruned, metric]);

    if (!sequences?.length) {
        return <div className="py-16 text-center text-neutral-500 text-sm">{t('no_data')}</div>;
    }
    if (!dfg) {
        return <Loading text={t('computing_process_map') || 'Computing process map…'} />;
    }

    const totalEdgeWeight = dfg.edges.reduce((s, e) => s + (e[metric] || 0), 0);
    const keptEdgeWeight = pruned.edges.reduce((s, e) => s + (e[metric] || 0), 0);
    const keptPct = totalEdgeWeight > 0 ? (keptEdgeWeight / totalEdgeWeight * 100).toFixed(1) : '0.0';
    const maxEdgeMetric = pruned.edges.reduce((m, e) => Math.max(m, e[metric] || 0), 1);

    return (
        <div className="space-y-3">
            {/* Controls */}
            <div className="flex flex-wrap items-end gap-3 p-3 bg-neutral-900/50 border border-neutral-800 rounded-lg">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400 flex items-center gap-1"><GitBranch className="w-3 h-3"/> Metric</label>
                    <select
                        value={metric}
                        onChange={(e) => setMetric(e.target.value)}
                        className="px-2 py-1 text-sm bg-neutral-800 border border-neutral-700 rounded"
                    >
                        {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400 flex items-center gap-1">
                        <Filter className="w-3 h-3"/> Coverage: {(coverage * 100).toFixed(0)}%
                    </label>
                    <input
                        type="range"
                        min={0.5} max={1} step={0.01}
                        value={coverage}
                        onChange={(e) => setCoverage(parseFloat(e.target.value))}
                        className="w-32"
                    />
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input type="checkbox" checked={showStartEnd} onChange={(e) => setShowStartEnd(e.target.checked)} />
                    Show start/end
                </label>
                <div className="ml-auto flex items-center gap-3 text-xs text-neutral-400">
                    <span><Workflow className="w-3 h-3 inline mr-1" /> {pruned.nodes.length} activities · {pruned.edges.length} edges</span>
                    <span>{keptPct}% of weight kept</span>
                </div>
            </div>

            {/* Map */}
            <div className="relative overflow-auto bg-neutral-900/30 border border-neutral-800 rounded-lg" style={{ minHeight: 400 }}>
                {layout ? (
                    <svg width={layout.width} height={layout.height} className="block">
                        <defs>
                            <marker id="dfg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#67e8f9" />
                            </marker>
                        </defs>
                        {/* edges */}
                        {pruned.edges.map((e, i) => {
                            const fromNode = layout.nodes.find((n) => (n.type === 'start' ? START_NODE : n.type === 'end' ? END_NODE : n.id) === e.from);
                            const toNode = layout.nodes.find((n) => (n.type === 'start' ? START_NODE : n.type === 'end' ? END_NODE : n.id) === e.to);
                            if (!fromNode || !toNode) return null;
                            const w = e[metric] || 0;
                            const stroke = 0.5 + (w / maxEdgeMetric) * 4;
                            const opacity = 0.4 + (w / maxEdgeMetric) * 0.6;
                            const midX = (fromNode.x + toNode.x) / 2;
                            const midY = (fromNode.y + toNode.y) / 2;
                            return (
                                <g key={i}>
                                    <line
                                        x1={fromNode.x} y1={fromNode.y + NODE_H / 2}
                                        x2={toNode.x} y2={toNode.y - NODE_H / 2}
                                        stroke="#67e8f9" strokeWidth={stroke}
                                        opacity={opacity}
                                        markerEnd="url(#dfg-arrow)"
                                    />
                                    <text
                                        x={midX} y={midY}
                                        textAnchor="middle"
                                        fill="#94a3b8"
                                        fontSize="10"
                                        dy="-2"
                                        style={{ paintOrder: 'stroke', stroke: '#0f172a', strokeWidth: 3 }}
                                    >
                                        {metric === 'relativeCount' ? `${(w * 100).toFixed(1)}%` : Math.round(w)}
                                    </text>
                                </g>
                            );
                        })}
                        {/* nodes */}
                        {layout.nodes.map((n) => {
                            const isStart = n.type === 'start';
                            const isEnd = n.type === 'end';
                            const fill = isStart ? '#10b981' : isEnd ? '#ef4444' : '#1e293b';
                            const stroke = isStart ? '#34d399' : isEnd ? '#f87171' : '#475569';
                            return (
                                <g key={n.id} transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}>
                                    <rect width={NODE_W} height={NODE_H} rx={6} fill={fill} stroke={stroke} strokeWidth={1.5} />
                                    <text
                                        x={NODE_W / 2} y={NODE_H / 2 + 4}
                                        textAnchor="middle" fill="#f1f5f9"
                                        fontSize="11" fontWeight={600}
                                    >
                                        {isStart ? '▶ start' : isEnd ? 'end ■' : (n.id.length > 16 ? n.id.slice(0, 14) + '…' : n.id)}
                                    </text>
                                    {!isStart && !isEnd && (
                                        <text x={NODE_W / 2} y={NODE_H + 12} textAnchor="middle" fill="#94a3b8" fontSize="9">
                                            n={n.absoluteFreq}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                ) : (
                    <div className="text-center text-neutral-500 py-16 text-sm">
                        No edges survive at this coverage threshold. Try raising it.
                    </div>
                )}
            </div>
        </div>
    );
}

export default ProcessMap;
