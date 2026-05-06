import { useMemo } from "react";
import { createColorMap } from "./colorFix";
const TnaDistributionPlot = ({ sequences, labels, colorMap: externalColorMap }) => {
  const colorMap = useMemo(() => externalColorMap ?? createColorMap(labels), [externalColorMap, labels]);
  const { timesteps, maxTimestep } = useMemo(() => {
    const maxLen = Math.min(Math.max(...sequences.map((s) => s.length), 0), 50);
    const steps = [];
    for (let t = 0; t < maxLen; t++) {
      const counts = {};
      for (const label of labels) counts[label] = 0;
      for (const seq of sequences) {
        if (t < seq.length && labels.includes(seq[t])) counts[seq[t]]++;
      }
      steps.push(counts);
    }
    return { timesteps: steps, maxTimestep: maxLen };
  }, [sequences, labels]);
  if (maxTimestep === 0) return null;
  const svgWidth = 700;
  const svgHeight = 350;
  const margin = { top: 20, right: 120, bottom: 40, left: 50 };
  const plotW = svgWidth - margin.left - margin.right;
  const plotH = svgHeight - margin.top - margin.bottom;
  const barWidth = Math.max(plotW / maxTimestep - 1, 2);
  return <div className="overflow-x-auto">
      <svg width={svgWidth} height={svgHeight} className="mx-auto">
        <g transform={`translate(${margin.left},${margin.top})`}>
          <text
    x={-plotH / 2}
    y={-35}
    transform="rotate(-90)"
    textAnchor="middle"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={11}
  >Proportion</text>
          <text
    x={plotW / 2}
    y={plotH + 32}
    textAnchor="middle"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={11}
  >Timestep</text>

          {[0, 0.25, 0.5, 0.75, 1].map((v) => <g key={v}>
              <line
    x1={0}
    x2={plotW}
    y1={plotH - v * plotH}
    y2={plotH - v * plotH}
    stroke="currentColor"
    className="text-neutral-700"
    strokeWidth={0.5}
  />
              <text
    x={-8}
    y={plotH - v * plotH + 4}
    textAnchor="end"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={10}
  >
                {(v * 100).toFixed(0)}%
              </text>
            </g>)}

          {timesteps.map((counts, t) => {
    const total = Object.values(counts).reduce((s, c) => s + c, 0);
    if (total === 0) return null;
    let yOffset = 0;
    return <g key={t}>
                {labels.map((label) => {
      const proportion = counts[label] / total;
      const barH = proportion * plotH;
      const y = plotH - yOffset - barH;
      yOffset += barH;
      if (proportion === 0) return null;
      return <rect
        key={label}
        x={t * (plotW / maxTimestep)}
        y={y}
        width={barWidth}
        height={barH}
        fill={colorMap[label]}
        opacity={0.85}
      >
                      <title>{`${label}: ${(proportion * 100).toFixed(1)}% (t=${t + 1})`}</title>
                    </rect>;
    })}
              </g>;
  })}

          {timesteps.map((_, t) => {
    const interval = Math.max(1, Math.ceil(maxTimestep / 10));
    if (t % interval !== 0 && t !== maxTimestep - 1) return null;
    return <text
      key={t}
      x={t * (plotW / maxTimestep) + barWidth / 2}
      y={plotH + 14}
      textAnchor="middle"
      className="fill-gray-500 dark:fill-gray-400"
      fontSize={9}
    >
                {t + 1}
              </text>;
  })}
        </g>

        <g transform={`translate(${svgWidth - margin.right + 10}, ${margin.top})`}>
          {labels.map((label, i) => <g key={label} transform={`translate(0, ${i * 18})`}>
              <rect width={12} height={12} fill={colorMap[label]} rx={2} />
              <text x={16} y={10} className="fill-gray-700 dark:fill-gray-300" fontSize={10}>{label}</text>
            </g>)}
        </g>
      </svg>
    </div>;
};
export {
  TnaDistributionPlot
};
