// Process Map (DFG) tab — faithful React port of carmdash's bupaR-style
// PROCESS MAP (moodle-tna: network-tab.ts renderDFGCard + buildBupaRDFG /
// computeAutoThreshold / pruneDFG, and svg-process-map.ts geometry), replacing
// the older dynajs/dagre-routed version.
//
// What the port provides:
//   - Absolute | Relative | Case metric pills. Relative = per-source Markov
//     probability (incl. →End edges); Case = per-sequence-deduped fraction.
//   - Threshold slider + mirrored numeric input; when unset the threshold is
//     AUTO (cumulative-95% weight coverage). Metric change / Reset All return
//     to auto.
//   - dagre Sugiyama layout (LR), synthetic Start/End circles, activity rects
//     colored by a 3-stop frequency ramp, cubic Bézier edges with tick-dash
//     starts, boundary-intersected endpoints, midpoint count labels.
//   - Export CSV (pruned DFG edges via exports.js toCSV/downloadCSV) and
//     Export PNG (XMLSerializer → offscreen canvas → toDataURL) — restored
//     from the pre-port ProcessMap surface.
//   - Node drag (pointer events; edges re-derive from state on render),
//     background drag pans, Zoom / Pan X / Pan Y sliders drive one
//     translate/scale transform on the root <g>. Mouse-wheel zoom is blocked.
//
// All pure model/threshold/geometry/color logic lives in processMapUtils.js
// (unit-tested); this file is only the React surface. The `colorMap` prop is
// still accepted for API compatibility with TnaDashboardV2 but unused: node
// fill is the bupaR frequency ramp, not per-state tinting.

import { useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Workflow } from 'lucide-react';
import { useTranslation } from './i18nShim';
import { toCSV, downloadCSV, downloadDataUrl } from './exports';
import {
    RECT_H, SENT_R, EDGE_COLOR,
    buildBupaRDFG, computeAutoThreshold, pruneDFG,
    nodeWidthFor, layoutDFG, edgeGeometry,
    edgeMetricValue, formatNodeMetric, formatEdgeMetric,
    nodeFillColor, textColorsFor, darkenHex, edgeOpacityFor,
} from './processMapUtils';

const METRICS = [
    { value: 'absolute', label: 'Absolute' },
    { value: 'relative', label: 'Relative' },
    { value: 'case', label: 'Case' },
];

// CSV column order for the pruned-edge export.
const EDGE_CSV_COLUMNS = [
    { key: 'from', header: 'from' },
    { key: 'to', header: 'to' },
    { key: 'absoluteCount', header: 'absoluteCount' },
    { key: 'relativeCount', header: 'relativeCount' },
    { key: 'caseCount', header: 'caseCount' },
];

const PNG_SCALE = 2;

const PAN_LIMIT = 2000;
const clampPan = (v) => Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, v));

const pillClass = (active) =>
    `px-2.5 py-1 text-xs font-medium rounded border transition-colors ${active
        ? 'bg-slate-800 text-white border-slate-800'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`;

const btnClass =
    'px-2.5 py-1 text-xs font-medium rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-50';

export function ProcessMap({ sequences, labels }) {
    const { t } = useTranslation();
    const [metric, setMetric] = useState('absolute');
    // null = auto threshold (cumulative-95% coverage for the active metric)
    const [threshold, setThreshold] = useState(null);
    // Dragged node positions override the dagre layout; edges re-derive on render.
    const [overrides, setOverrides] = useState({});
    const [zoom, setZoom] = useState(100);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const svgRef = useRef(null);
    const dragRef = useRef(null);

    const rawDfg = useMemo(() => {
        if (!sequences?.length) return null;
        return buildBupaRDFG(sequences, labels ?? []);
    }, [sequences, labels]);

    const autoThreshold = useMemo(() => {
        if (!rawDfg) return 0;
        return computeAutoThreshold(rawDfg.edges, metric, 0.95);
    }, [rawDfg, metric]);
    const effThreshold = threshold ?? autoThreshold;

    const dfg = useMemo(() => {
        if (!rawDfg) return null;
        return pruneDFG(rawDfg, effThreshold, metric);
    }, [rawDfg, effThreshold, metric]);

    const widths = useMemo(() => {
        const map = {};
        for (const n of dfg?.nodes ?? []) map[n.id] = nodeWidthFor(n);
        return map;
    }, [dfg]);

    const layout = useMemo(() => {
        if (!dfg?.nodes.length) return null;
        return layoutDFG(dfg, widths);
    }, [dfg, widths]);

    // Merge dragged positions over the dagre layout.
    const positions = useMemo(() => {
        if (!layout) return {};
        const merged = {};
        for (const [id, p] of Object.entries(layout.positions)) {
            merged[id] = overrides[id] ?? p;
        }
        return merged;
    }, [layout, overrides]);

    if (!sequences?.length || !rawDfg || rawDfg.edges.length === 0) {
        return <div className="py-16 text-center text-gray-400 text-sm">{t('no_data')}</div>;
    }

    // ── Threshold slider config (from the RAW edge set, like the source card) ──
    const isAbs = metric === 'absolute';
    const step = isAbs ? 1 : 0.005;
    const maxEdgeVal = rawDfg.edges.reduce((m, e) => Math.max(m, edgeMetricValue(e, metric)), 0);
    const sliderMax = Math.ceil(maxEdgeVal * 0.5);

    // ── Render context (recomputed every render so drags re-route edges) ──
    const types = {};
    for (const n of dfg.nodes) types[n.id] = n.type;
    const edgeSet = new Set(dfg.edges.map((e) => `${e.from}→${e.to}`));
    const posList = Object.values(positions);
    const centroidY = posList.reduce((s, p) => s + p.y, 0) / (posList.length || 1);
    const ctx = { positions, types, widths, centroidY, edgeSet };

    // Color / opacity domains over the PRUNED dfg (like the source renderer).
    const actNodes = dfg.nodes.filter((n) => n.type === 'activity');
    const minFreq = actNodes.reduce((m, n) => Math.min(m, n.absoluteFreq), Infinity);
    const maxFreq = actNodes.reduce((m, n) => Math.max(m, n.absoluteFreq), -Infinity);
    const minEC = dfg.edges.reduce((m, e) => Math.min(m, e.absoluteCount), Infinity);
    const maxEC = dfg.edges.reduce((m, e) => Math.max(m, e.absoluteCount), -Infinity);

    // Canvas bounds (expanded by dragged positions).
    let viewW = Math.max((layout?.width ?? 0) + 80, 400);
    let viewH = Math.max((layout?.height ?? 0) + 80, 300);
    for (const [id, pos] of Object.entries(positions)) {
        viewW = Math.max(viewW, pos.x + (widths[id] ?? 100) / 2 + 50);
        viewH = Math.max(viewH, pos.y + RECT_H / 2 + 40);
    }

    // ── Interactions ──

    /** Screen-px → graph-units factor: viewBox fit × slider zoom. */
    function dragScale() {
        const svg = svgRef.current;
        let fit = 1;
        if (svg) {
            const rect = svg.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                fit = Math.min(rect.width / viewW, rect.height / viewH);
            }
        }
        return fit * (zoom / 100) || 1;
    }

    function capturePointer(e) {
        try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* jsdom / stale pointer */ }
    }

    function startNodeDrag(e, id) {
        e.stopPropagation();
        e.preventDefault();
        capturePointer(e);
        const p = positions[id];
        dragRef.current = { kind: 'node', id, clientX: e.clientX, clientY: e.clientY, x: p.x, y: p.y };
    }

    function startPan(e) {
        capturePointer(e);
        dragRef.current = { kind: 'pan', clientX: e.clientX, clientY: e.clientY, x: panX, y: panY };
    }

    function onPointerMove(e) {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.clientX;
        const dy = e.clientY - d.clientY;
        if (d.kind === 'node') {
            const k = dragScale();
            setOverrides((prev) => ({ ...prev, [d.id]: { x: d.x + dx / k, y: d.y + dy / k } }));
        } else {
            setPanX(clampPan(d.x + dx));
            setPanY(clampPan(d.y + dy));
        }
    }

    function endDrag() {
        dragRef.current = null;
    }

    function pickMetric(value) {
        setMetric(value);
        setThreshold(null);   // back to auto for the new metric
        setOverrides({});     // metric change re-layouts (source resets positions)
    }

    function resetAll() {
        setMetric('absolute');
        setThreshold(null);
        setOverrides({});
    }

    function resetView() {
        setZoom(100);
        setPanX(0);
        setPanY(0);
    }

    /** Download the PRUNED edge set (what the map shows) as CSV. */
    function exportCsv() {
        downloadCSV('process-map-edges.csv', toCSV(dfg.edges, EDGE_CSV_COLUMNS));
    }

    /** Serialize the live SVG → offscreen canvas → PNG download. */
    function exportPng() {
        const svg = svgRef.current;
        if (!svg) return;
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(viewW));
        clone.setAttribute('height', String(viewH));
        const xml = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = viewW * PNG_SCALE;
            canvas.height = viewH * PNG_SCALE;
            const ctx2d = canvas.getContext && canvas.getContext('2d');
            if (!ctx2d) return; // jsdom / canvas unavailable
            ctx2d.fillStyle = '#f9fafb'; // match the map background
            ctx2d.fillRect(0, 0, canvas.width, canvas.height);
            ctx2d.scale(PNG_SCALE, PNG_SCALE);
            ctx2d.drawImage(img, 0, 0);
            try {
                downloadDataUrl('process-map.png', canvas.toDataURL('image/png'));
            } catch (err) {
                console.warn('Process map PNG export failed:', err);
            }
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    }

    const activities = actNodes.length;

    return (
        <div className="space-y-2">
            {/* Controls row: metric pills · resets · threshold */}
            <div className="flex flex-wrap items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                <div className="flex items-center gap-1">
                    {METRICS.map((m) => (
                        <button
                            key={m.value}
                            type="button"
                            className={pillClass(metric === m.value)}
                            aria-pressed={metric === m.value}
                            onClick={() => pickMetric(m.value)}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                <button type="button" className={btnClass} onClick={() => setOverrides({})}>
                    Reset Layout
                </button>
                <button type="button" className={`${btnClass} text-orange-700`} onClick={resetAll}>
                    Reset All
                </button>
                <button type="button" className={`${btnClass} inline-flex items-center gap-1`} onClick={exportCsv}>
                    <Download className="w-3 h-3" />
                    Export CSV
                </button>
                <button type="button" className={`${btnClass} inline-flex items-center gap-1`} onClick={exportPng}>
                    <ImageIcon className="w-3 h-3" />
                    Export PNG
                </button>
                <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span>Threshold:</span>
                    <input
                        type="range"
                        aria-label="Threshold"
                        min={0}
                        max={sliderMax}
                        step={step}
                        value={Math.min(effThreshold, sliderMax)}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                        className="w-32"
                    />
                    <input
                        type="number"
                        aria-label="Threshold value"
                        min={0}
                        max={Math.ceil(maxEdgeVal)}
                        step={step}
                        value={isAbs ? Math.round(effThreshold) : effThreshold.toFixed(3)}
                        onChange={(e) => setThreshold(Number(e.target.value) || 0)}
                        className="w-16 px-1 py-0.5 text-xs text-right border border-gray-300 rounded"
                    />
                </div>
            </div>

            {/* Status line */}
            <div className="px-1 text-xs text-gray-500">
                <Workflow className="w-3 h-3 inline mr-1" />
                {activities} activities · {dfg.edges.length} edges · {dfg.totalSequences} sessions · {dfg.totalTransitions} transitions
            </div>

            {/* Zoom / pan sliders */}
            <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-gray-600">
                <label className="flex items-center gap-1.5">
                    Zoom:
                    <input
                        type="range" aria-label="Zoom" min={30} max={500} step={5}
                        value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24"
                    />
                </label>
                <label className="flex items-center gap-1.5">
                    Pan X:
                    <input
                        type="range" aria-label="Pan X" min={-PAN_LIMIT} max={PAN_LIMIT} step={10}
                        value={panX} onChange={(e) => setPanX(Number(e.target.value))} className="w-24"
                    />
                </label>
                <label className="flex items-center gap-1.5">
                    Pan Y:
                    <input
                        type="range" aria-label="Pan Y" min={-PAN_LIMIT} max={PAN_LIMIT} step={10}
                        value={panY} onChange={(e) => setPanY(Number(e.target.value))} className="w-24"
                    />
                </label>
                <button type="button" className={btnClass} onClick={resetView}>
                    Reset View
                </button>
            </div>

            {/* Map */}
            <div
                className="relative overflow-hidden bg-gray-50 border border-gray-200 rounded-lg select-none"
                style={{ height: 520, touchAction: 'none' }}
            >
                <svg
                    ref={svgRef}
                    data-testid="process-map-canvas"
                    viewBox={`0 0 ${viewW} ${viewH}`}
                    width="100%"
                    height="100%"
                    style={{ cursor: 'grab', display: 'block' }}
                    onPointerDown={startPan}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerLeave={endDrag}
                >
                    <defs>
                        <filter id="pm-shadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="rgba(0,0,0,0.10)" />
                        </filter>
                    </defs>
                    <g transform={`translate(${panX},${panY}) scale(${zoom / 100})`}>
                        {/* Edges (re-derived from positions on every render) */}
                        <g>
                            {dfg.edges.map((e) => {
                                const geo = edgeGeometry(e, ctx);
                                if (!geo) return null;
                                const op = edgeOpacityFor(e.absoluteCount, minEC, maxEC);
                                return (
                                    <g key={`${e.from}→${e.to}`}>
                                        <path
                                            d={geo.pathD}
                                            fill="none"
                                            stroke={EDGE_COLOR}
                                            strokeWidth={2}
                                            strokeOpacity={op}
                                            pathLength={100}
                                            strokeDasharray={geo.dashArray}
                                        />
                                        <polygon points={geo.arrowPoints} fill={EDGE_COLOR} opacity={Math.min(op + 0.15, 1)} />
                                        <text
                                            x={geo.labelX}
                                            y={geo.labelY}
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                            fontSize={10}
                                            fontWeight={500}
                                            fill="#344054"
                                            style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3.5, strokeLinejoin: 'round' }}
                                        >
                                            {formatEdgeMetric(e, metric)}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                        {/* Nodes (draggable) */}
                        <g>
                            {dfg.nodes.map((n) => {
                                const pos = positions[n.id];
                                if (!pos) return null;
                                if (n.type !== 'activity') {
                                    const stroke = n.type === 'start' ? '#6b8e23' : '#8b3a3a';
                                    const label = n.type === 'start' ? 'Start' : 'End';
                                    return (
                                        <g
                                            key={n.id}
                                            transform={`translate(${pos.x},${pos.y})`}
                                            style={{ cursor: 'grab' }}
                                            onPointerDown={(e) => startNodeDrag(e, n.id)}
                                        >
                                            <circle r={SENT_R} fill="#fff" stroke={stroke} strokeWidth={2.5} filter="url(#pm-shadow)" />
                                            <text
                                                dy="0.35em" textAnchor="middle"
                                                fontSize={11} fontWeight={600} fill={stroke}
                                                pointerEvents="none"
                                            >
                                                {label}
                                            </text>
                                        </g>
                                    );
                                }
                                const w = widths[n.id] ?? 100;
                                const fill = nodeFillColor(n.absoluteFreq, minFreq, maxFreq);
                                const txt = textColorsFor(fill);
                                return (
                                    <g
                                        key={n.id}
                                        transform={`translate(${pos.x},${pos.y})`}
                                        style={{ cursor: 'grab' }}
                                        onPointerDown={(e) => startNodeDrag(e, n.id)}
                                    >
                                        <rect
                                            x={-w / 2} y={-RECT_H / 2} width={w} height={RECT_H}
                                            rx={6} ry={6}
                                            fill={fill} stroke={darkenHex(fill)} strokeWidth={1.2}
                                            filter="url(#pm-shadow)"
                                        />
                                        <text
                                            y={-7} textAnchor="middle"
                                            fontSize={12.5} fontWeight={700} fill={txt.label}
                                            pointerEvents="none"
                                        >
                                            {n.id}
                                        </text>
                                        <text
                                            y={12} textAnchor="middle"
                                            fontSize={11.5} fontWeight={500} fill={txt.metric}
                                            pointerEvents="none"
                                        >
                                            {formatNodeMetric(n, metric)}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    </g>
                </svg>
            </div>
        </div>
    );
}

export default ProcessMap;
