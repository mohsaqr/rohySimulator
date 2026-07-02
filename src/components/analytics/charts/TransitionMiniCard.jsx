import React, { useMemo, useState } from 'react';
import { ftna, centralities } from 'dynajs';
import { TnaNetworkGraph } from '../tna/laila/TnaNetworkGraph';
import { CentralityBarChart } from '../tna/laila/CentralityBarChart';
import { createColorMap } from '../tna/laila/colorFix';

/*
 * Compact TNA card for the Gaze tab. The network and centrality chart are the
 * same dynajs/LAILA primitives used by the main Analytics → Network tab:
 * ftna() builds the frequency transition model, TnaNetworkGraph reads the
 * model directly, and CentralityBarChart renders centralities(model).
 */

const MEASURES = ['InStrength', 'OutStrength', 'Betweenness', 'Closeness'];
const NETWORK_HEIGHT = 410;
const PANEL_HEIGHT = 410;

function usableSequences(sequences) {
    return (Array.isArray(sequences) ? sequences : [])
        .filter((s) => Array.isArray(s) && s.length >= 2);
}

function deriveLabels(sequences, labels) {
    if (Array.isArray(labels) && labels.length > 0) return labels;
    const set = new Set();
    sequences.forEach((s) => s.forEach((v) => set.add(v)));
    return [...set].sort();
}

/**
 * Build the dynajs model consumed by the shared LAILA graph components.
 *
 * @returns {{sequences:string[][], labels:string[], model:object|null,
 *            centralityData:object|null, colorMap:Record<string,string>}}
 */
export function buildTransitionModel(sequences, labels, colorFor) {
    const seqs = usableSequences(sequences);
    const labelList = deriveLabels(seqs, labels);
    const baseColorMap = createColorMap(labelList, 'tableau');
    const colorMap = Object.fromEntries(labelList.map((label) => [
        label,
        colorFor?.(label) || baseColorMap[label],
    ]));

    if (seqs.length === 0 || labelList.length === 0) {
        return { sequences: seqs, labels: labelList, model: null, centralityData: null, colorMap };
    }

    const model = ftna(seqs, { labels: labelList });
    return {
        sequences: seqs,
        labels: labelList,
        model,
        centralityData: centralities(model),
        colorMap,
    };
}

function formatWeight(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2).replace(/\.?0+$/, '');
}

function labelForAxis(label) {
    const compact = String(label)
        .replace(/\s*\(main\)\s*/i, '')
        .replace(/^Examination$/i, 'Exam')
        .replace(/^Discussant$/i, 'Discuss')
        .replace(/^Radiology$/i, 'Radiol');
    return compact.length > 9 ? `${compact.slice(0, 8)}…` : compact;
}

function TransitionHeatmap({ model, height = PANEL_HEIGHT }) {
    const { labels, weights } = model;
    const matrix = useMemo(() => {
        let max = 0;
        const cells = [];
        labels.forEach((from, i) => {
            labels.forEach((to, j) => {
                const value = weights.get(i, j);
                if (value > max) max = value;
                cells.push({ from, to, i, j, value });
            });
        });
        return { cells, max: Math.max(max, 1e-6) };
    }, [labels, weights]);

    const margin = { top: 116, right: 16, bottom: 18, left: 92 };
    const svgW = 420;
    const plot = Math.max(120, Math.min(svgW - margin.left - margin.right, height - margin.top - margin.bottom));
    const cell = labels.length > 0 ? plot / labels.length : plot;
    const fontSize = labels.length > 7 ? 9 : 10;

    return (
        <div role="img" aria-label="Transition heatmap" className="h-[410px] min-w-0 overflow-x-auto">
            <svg width={svgW} height={height} className="mx-auto">
                <text x={svgW / 2} y={18} textAnchor="middle" className="fill-gray-700" fontSize={11} fontWeight={700}>
                    Transition Heatmap
                </text>
                <text x={svgW / 2} y={35} textAnchor="middle" className="fill-gray-500" fontSize={9}>
                    rows start, columns end
                </text>
                <g transform={`translate(${margin.left},${margin.top})`}>
                    {labels.map((label, j) => {
                        const x = j * cell + cell / 2;
                        return (
                            <text
                                key={`col-${label}`}
                                x={x}
                                y={-12}
                                textAnchor="start"
                                className="fill-gray-600"
                                fontSize={fontSize}
                                transform={`rotate(-38 ${x} -12)`}
                            >
                                {labelForAxis(label)}
                            </text>
                        );
                    })}
                    {labels.map((label, i) => (
                        <text
                            key={`row-${label}`}
                            x={-8}
                            y={i * cell + cell / 2 + 3}
                            textAnchor="end"
                            className="fill-gray-700"
                            fontSize={fontSize}
                        >
                            {labelForAxis(label)}
                        </text>
                    ))}
                    {matrix.cells.map(({ from, to, i, j, value }) => {
                        const intensity = value > 0 ? 0.16 + (value / matrix.max) * 0.78 : 0;
                        const fill = value > 0 ? `rgba(43, 76, 126, ${intensity})` : '#f4f6f8';
                        const textColor = intensity > 0.52 ? '#ffffff' : '#334155';
                        return (
                            <g key={`${from}-${to}`}>
                                <rect
                                    x={j * cell}
                                    y={i * cell}
                                    width={Math.max(1, cell - 1)}
                                    height={Math.max(1, cell - 1)}
                                    rx={2}
                                    fill={fill}
                                >
                                    <title>{`${from} → ${to}: ${formatWeight(value) || '0'}`}</title>
                                </rect>
                                {value > 0 && cell >= 27 && (
                                    <text
                                        x={j * cell + cell / 2}
                                        y={i * cell + cell / 2 + 3}
                                        textAnchor="middle"
                                        fontSize={9}
                                        fontWeight={700}
                                        fill={textColor}
                                        pointerEvents="none"
                                    >
                                        {formatWeight(value)}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </g>
                <g transform={`translate(${margin.left},${height - 14})`}>
                    <rect x={0} y={0} width={36} height={6} rx={3} fill="#f4f6f8" />
                    <rect x={44} y={0} width={36} height={6} rx={3} fill="rgba(43, 76, 126, 0.35)" />
                    <rect x={88} y={0} width={36} height={6} rx={3} fill="rgba(43, 76, 126, 0.94)" />
                    <text x={132} y={6} className="fill-gray-500" fontSize={9}>transition count</text>
                </g>
            </svg>
        </div>
    );
}

export default function TransitionMiniCard({
    sequences, labels, title, subtitle, colorFor,
}) {
    const analysis = useMemo(
        () => buildTransitionModel(sequences, labels, colorFor),
        [sequences, labels, colorFor],
    );
    const [measure, setMeasure] = useState('InStrength');

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{title}</h3>
            {subtitle && <p className="mb-3 text-xs text-gray-500">{subtitle}</p>}

            {!analysis.model ? (
                <p className="py-6 text-center text-xs text-gray-500">
                    Not enough movement to build a network — need at least one session with 2+ distinct states.
                </p>
            ) : (
                <>
                <div className="mx-auto grid max-w-7xl items-stretch gap-6 xl:grid-cols-[410px_420px_minmax(390px,1fr)]">
                    <div className="min-w-0">
                        <div className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide text-gray-600">
                            TNA Network
                        </div>
                        <div role="img" aria-label="Transition network" className="h-[410px]">
                        <TnaNetworkGraph
                            model={analysis.model}
                            showSelfLoops={false}
                            showEdgeLabels
                            nodeRadius={22}
                            height={NETWORK_HEIGHT}
                            colorMap={analysis.colorMap}
                            centralityData={analysis.centralityData}
                            nodeSizeMetric={measure}
                            modelType="frequency"
                            maxEdgeWidth={4}
                        />
                        </div>
                    </div>

                    <TransitionHeatmap
                        model={analysis.model}
                        height={PANEL_HEIGHT}
                    />

                    <div className="h-[410px] min-w-0">
                        <div className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide text-gray-600">
                            Centrality
                        </div>
                        <div className="mb-2 flex flex-wrap justify-center gap-1.5">
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
                                    title={`Size network nodes and rank bars by ${m}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                        <CentralityBarChart
                            centralityData={analysis.centralityData}
                            colorMap={analysis.colorMap}
                            selectedMeasure={measure}
                            chartHeight={PANEL_HEIGHT}
                        />
                    </div>
                </div>
                </>
            )}
        </section>
    );
}
