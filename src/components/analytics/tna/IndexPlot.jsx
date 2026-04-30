import React, { useMemo } from 'react';
import { getNodeColor } from './tnaColors';

const LEFT_MARGIN = 50;
const RIGHT_MARGIN = 20;
const TOP_MARGIN = 8;
const BOTTOM_MARGIN = 30;
const LEGEND_HEIGHT = 24;
const MIN_PLOT_HEIGHT = 250;

/**
 * Sequence Index Plot — one row per sequence, colored by action at each timestep.
 * Rows expand to fill the available plot height.
 */
export default function IndexPlot({ sequences, labels }) {
  const { sorted, maxLen, colorMap } = useMemo(() => {
    if (!sequences || sequences.length === 0) return { sorted: [], maxLen: 0, colorMap: {} };

    const cMap = Object.create(null);
    labels.forEach((l, i) => { cMap[l] = getNodeColor(i); });

    const seqs = sequences.map((s, i) => ({ seq: s, idx: i }));
    seqs.sort((a, b) => b.seq.length - a.seq.length);

    const ml = seqs.length > 0 ? seqs[0].seq.length : 0;
    return { sorted: seqs, maxLen: ml, colorMap: cMap };
  }, [sequences, labels]);

  if (sorted.length === 0 || maxLen === 0) return null;

  const svgWidth = 600;
  const plotWidth = svgWidth - LEFT_MARGIN - RIGHT_MARGIN;
  const cellWidth = plotWidth / maxLen;

  // Dynamic row sizing: fill the plot area
  const n = sorted.length;
  const rowTotal = MIN_PLOT_HEIGHT / n;
  const rowGap = Math.min(rowTotal * 0.1, 2);
  const rowHeight = rowTotal - rowGap;
  const plotHeight = n * rowTotal;
  const svgHeight = TOP_MARGIN + plotHeight + BOTTOM_MARGIN + LEGEND_HEIGHT;

  // X-axis ticks
  const tickInterval = maxLen <= 20 ? 1 : maxLen <= 50 ? 5 : 10;
  const xTicks = [];
  for (let t = 1; t <= maxLen; t++) {
    if (t === 1 || t % tickInterval === 0 || t === maxLen) {
      xTicks.push(t);
    }
  }

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} width="100%" style={{ display: 'block' }}>
      {/* Y-axis label */}
      <text
        x={4}
        y={TOP_MARGIN + plotHeight / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--tna-svg-axis)"
        fontSize={9}
        transform={`rotate(-90, 4, ${TOP_MARGIN + plotHeight / 2})`}
      >
        Sequences ({n})
      </text>

      {/* Sequence rows */}
      {sorted.map((item, rowIdx) => {
        const y = TOP_MARGIN + rowIdx * rowTotal;
        return (
          <g key={rowIdx}>
            {item.seq.map((action, t) => (
              <rect
                key={t}
                x={LEFT_MARGIN + t * cellWidth}
                y={y}
                width={Math.max(cellWidth - 0.3, 0.5)}
                height={rowHeight}
                fill={colorMap[action] || '#555'}
              >
                <title>{`Seq ${item.idx + 1}, step ${t + 1}: ${action}`}</title>
              </rect>
            ))}
          </g>
        );
      })}

      {/* X-axis ticks */}
      {xTicks.map(t => {
        const x = LEFT_MARGIN + (t - 0.5) * cellWidth;
        return (
          <text
            key={t}
            x={x}
            y={TOP_MARGIN + plotHeight + 14}
            textAnchor="middle"
            fill="var(--tna-svg-axis)"
            fontSize={9}
          >
            {t}
          </text>
        );
      })}

      {/* X-axis label */}
      <text
        x={LEFT_MARGIN + plotWidth / 2}
        y={TOP_MARGIN + plotHeight + 26}
        textAnchor="middle"
        fill="var(--tna-svg-label)"
        fontSize={10}
      >
        Timestep
      </text>

      {/* Legend */}
      {labels.map((label, i) => {
        const legendX = LEFT_MARGIN + i * 90;
        const legendY = svgHeight - LEGEND_HEIGHT + 8;
        if (legendX + 80 > svgWidth) return null;
        return (
          <g key={label}>
            <rect x={legendX} y={legendY} width={10} height={10} fill={colorMap[label] || '#888'} rx={2} />
            <text x={legendX + 14} y={legendY + 5} dominantBaseline="central" fill="var(--tna-svg-label)" fontSize={9}>
              {label.length > 10 ? label.slice(0, 9) + '…' : label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
