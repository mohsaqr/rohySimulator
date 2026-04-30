import React, { useMemo } from 'react';
import { getNodeColor } from './tnaColors';
import { centralities } from './tnaUtils';

const BAR_HEIGHT = 22;
const BAR_GAP = 4;
const LEFT_MARGIN = 110;
const RIGHT_MARGIN = 50;
const TOP_MARGIN = 8;
const BOTTOM_MARGIN = 8;

export default function CentralityChart({ model, labels }) {
  const { sorted, maxVal, colorMap } = useMemo(() => {
    if (!model) return { sorted: [], maxVal: 0, colorMap: {} };

    const metrics = centralities(model);
    const max = metrics.length > 0 ? Math.max(...metrics.map(m => m.inStrength)) : 0;

    const cMap = Object.create(null);
    labels.forEach((l, i) => { cMap[l] = getNodeColor(i); });

    return { sorted: metrics, maxVal: max, colorMap: cMap };
  }, [model, labels]);

  if (sorted.length === 0) return null;

  const svgWidth = 400;
  const plotWidth = svgWidth - LEFT_MARGIN - RIGHT_MARGIN;
  const svgHeight = TOP_MARGIN + BOTTOM_MARGIN + sorted.length * (BAR_HEIGHT + BAR_GAP);

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} width="100%" style={{ display: 'block' }}>
      {sorted.map((m, i) => {
        const y = TOP_MARGIN + i * (BAR_HEIGHT + BAR_GAP);
        const barWidth = maxVal > 0 ? (m.inStrength / maxVal) * plotWidth : 0;
        const color = colorMap[m.label] || '#888';

        return (
          <g key={m.label}>
            <title>{`${m.label}: InStrength ${m.inStrength.toFixed(3)}`}</title>
            <text
              x={LEFT_MARGIN - 6}
              y={y + BAR_HEIGHT / 2}
              textAnchor="end"
              dominantBaseline="central"
              fill="var(--tna-svg-bar-label)"
              fontSize={10}
              fontWeight={500}
            >
              {m.label.length > 14 ? m.label.slice(0, 13) + '…' : m.label}
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
              x={LEFT_MARGIN + barWidth + 5}
              y={y + BAR_HEIGHT / 2}
              dominantBaseline="central"
              fill="var(--tna-svg-bar-value)"
              fontSize={9}
              fontWeight={500}
            >
              {m.inStrength.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
