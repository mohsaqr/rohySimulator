import React, { useMemo } from 'react';
import { getNodeColor } from './tnaColors';

const BAR_HEIGHT = 28;
const BAR_GAP = 6;
const LEFT_MARGIN = 130;
const RIGHT_MARGIN = 60;
const TOP_MARGIN = 10;
const BOTTOM_MARGIN = 10;

export default function FrequencyChart({ sequences, labels }) {
  const { sorted, maxCount, colorMap } = useMemo(() => {
    if (!sequences || sequences.length === 0) return { sorted: [], maxCount: 0, colorMap: {} };

    const counts = Object.create(null);
    for (const seq of sequences) {
      for (const action of seq) {
        counts[action] = (counts[action] || 0) + 1;
      }
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = entries.length > 0 ? entries[0][1] : 0;

    const cMap = Object.create(null);
    labels.forEach((l, i) => { cMap[l] = getNodeColor(i); });

    return { sorted: entries, maxCount: max, colorMap: cMap };
  }, [sequences, labels]);

  if (sorted.length === 0) return null;

  const svgWidth = 500;
  const plotWidth = svgWidth - LEFT_MARGIN - RIGHT_MARGIN;
  const svgHeight = TOP_MARGIN + BOTTOM_MARGIN + sorted.length * (BAR_HEIGHT + BAR_GAP);

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} width="100%" style={{ display: 'block' }}>
      {sorted.map(([label, count], i) => {
        const y = TOP_MARGIN + i * (BAR_HEIGHT + BAR_GAP);
        const barWidth = maxCount > 0 ? (count / maxCount) * plotWidth : 0;
        const color = colorMap[label] || '#888';
        const formattedCount = count.toLocaleString();

        return (
          <g key={label}>
            <title>{`${label}: ${formattedCount} occurrences`}</title>
            <text
              x={LEFT_MARGIN - 8}
              y={y + BAR_HEIGHT / 2}
              textAnchor="end"
              dominantBaseline="central"
              fill="#d1d5db"
              fontSize={11}
              fontWeight={500}
            >
              {label.length > 16 ? label.slice(0, 15) + '…' : label}
            </text>
            <rect
              x={LEFT_MARGIN}
              y={y}
              width={Math.max(barWidth, 2)}
              height={BAR_HEIGHT}
              fill={color}
              rx={3}
              opacity={0.85}
            />
            <text
              x={LEFT_MARGIN + barWidth + 6}
              y={y + BAR_HEIGHT / 2}
              dominantBaseline="central"
              fill="#9ca3af"
              fontSize={10}
              fontWeight={500}
            >
              {formattedCount}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
