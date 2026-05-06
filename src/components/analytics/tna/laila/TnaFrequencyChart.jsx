import { useMemo } from "react";
import { createColorMap } from "./colorFix";
const TnaFrequencyChart = ({ sequences, labels, colorMap: externalColorMap }) => {
  const colorMap = useMemo(() => externalColorMap ?? createColorMap(labels), [externalColorMap, labels]);
  const sortedVerbs = useMemo(() => {
    const counts = {};
    for (const label of labels) counts[label] = 0;
    for (const seq of sequences) {
      for (const verb of seq) {
        if (labels.includes(verb)) counts[verb]++;
      }
    }
    return labels.map((label) => ({ label, count: counts[label] })).sort((a, b) => b.count - a.count);
  }, [sequences, labels]);
  const maxCount = Math.max(...sortedVerbs.map((v) => v.count), 1);
  const svgWidth = 600;
  const barHeight = 28;
  const gap = 4;
  const margin = { top: 10, right: 60, bottom: 10, left: 100 };
  const plotW = svgWidth - margin.left - margin.right;
  const svgHeight = margin.top + margin.bottom + sortedVerbs.length * (barHeight + gap);
  return <div className="overflow-x-auto">
      <svg width={svgWidth} height={svgHeight} className="mx-auto">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {sortedVerbs.map((item, i) => {
    const y = i * (barHeight + gap);
    const barW = item.count / maxCount * plotW;
    return <g key={item.label}>
                <text
      x={-8}
      y={y + barHeight / 2 + 4}
      textAnchor="end"
      className="fill-gray-700 dark:fill-gray-300"
      fontSize={12}
    >
                  {item.label}
                </text>
                <rect
      x={0}
      y={y}
      width={barW}
      height={barHeight}
      fill={colorMap[item.label]}
      rx={4}
      opacity={0.85}
    >
                  <title>{`${item.label}: ${item.count}`}</title>
                </rect>
                <text
      x={barW + 6}
      y={y + barHeight / 2 + 4}
      textAnchor="start"
      className="fill-gray-600 dark:fill-gray-400"
      fontSize={11}
      fontWeight={500}
    >
                  {item.count}
                </text>
              </g>;
  })}
        </g>
      </svg>
    </div>;
};
export {
  TnaFrequencyChart
};
