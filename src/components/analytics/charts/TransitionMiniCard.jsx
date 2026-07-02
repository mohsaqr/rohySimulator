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
                <div className="mx-auto mb-2 flex max-w-5xl flex-wrap items-center justify-end gap-2">
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Centrality — dynajs model, node size follows the selected measure
                    </span>
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
                <div className="mx-auto grid max-w-5xl items-stretch gap-8 lg:grid-cols-2">
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

                    <div className="h-[410px] min-w-0">
                        <CentralityBarChart
                            centralityData={analysis.centralityData}
                            colorMap={analysis.colorMap}
                            selectedMeasure={measure}
                            chartHeight={NETWORK_HEIGHT}
                        />
                    </div>
                </div>
                </>
            )}
        </section>
    );
}
