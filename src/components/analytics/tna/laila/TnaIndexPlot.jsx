import { useMemo } from "react";
import { createColorMap } from "./colorFix";
const TnaIndexPlot = ({ sequences, labels, colorMap: externalColorMap }) => {
  const colorMap = useMemo(() => externalColorMap ?? createColorMap(labels), [externalColorMap, labels]);
  const maxLen = useMemo(() => {
    return Math.min(Math.max(...sequences.map((s) => s.length), 0), 50);
  }, [sequences]);
  if (maxLen === 0) return null;
  const svgWidth = 700;
  const margin = { top: 40, right: 130, bottom: 40, left: 50 };
  const plotW = svgWidth - margin.left - margin.right;
  const plotH = 350 - margin.top - margin.bottom;
  const cellW = plotW / maxLen;
  const cellH = Math.min(plotH / sequences.length, 8);
  const actualH = cellH * sequences.length;
  const legendH = labels.length * 18;
  const contentH = Math.max(actualH + margin.top + margin.bottom, legendH + margin.top + 10);
  return <div className="overflow-x-auto">
      <svg width={svgWidth} height={contentH} className="mx-auto">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {
    /* Y-axis label */
  }
          <text
    x={-actualH / 2}
    y={-35}
    transform="rotate(-90)"
    textAnchor="middle"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={11}
  >Sequence</text>

          {
    /* X-axis label */
  }
          <text
    x={plotW / 2}
    y={actualH + 32}
    textAnchor="middle"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={11}
  >Timestep</text>

          {
    /* Sequences as rows of colored cells */
  }
          {sequences.map((seq, si) => <g key={si}>
              {seq.slice(0, maxLen).map((state, ti) => {
    if (!state || !labels.includes(state)) return null;
    return <rect
      key={ti}
      x={ti * cellW}
      y={si * cellH}
      width={Math.max(cellW - 0.5, 1)}
      height={Math.max(cellH - 0.3, 1)}
      fill={colorMap[state] ?? "#ccc"}
      opacity={0.85}
    >
                    <title>{`Seq ${si + 1}, t=${ti + 1}: ${state}`}</title>
                  </rect>;
  })}
            </g>)}

          {
    /* X-axis tick labels */
  }
          {Array.from({ length: maxLen }, (_, t) => {
    const interval = Math.max(1, Math.ceil(maxLen / 10));
    if (t % interval !== 0 && t !== maxLen - 1) return null;
    return <text
      key={t}
      x={t * cellW + cellW / 2}
      y={actualH + 14}
      textAnchor="middle"
      className="fill-gray-500 dark:fill-gray-400"
      fontSize={9}
    >
                {t + 1}
              </text>;
  })}
        </g>

        {
    /* Legend */
  }
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
  TnaIndexPlot
};
