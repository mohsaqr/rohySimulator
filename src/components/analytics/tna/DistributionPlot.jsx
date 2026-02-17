import React, { useMemo } from 'react';
import { getNodeColor } from './tnaColors';

const LEFT_MARGIN = 40;
const RIGHT_MARGIN = 20;
const TOP_MARGIN = 20;
const BOTTOM_MARGIN = 40;
const LEGEND_HEIGHT = 24;

export default function DistributionPlot({ sequences, labels }) {
  const { timesteps, maxTimestep } = useMemo(() => {
    if (!sequences || sequences.length === 0) return { timesteps: [], maxTimestep: 0 };

    const maxLen = Math.max(...sequences.map(s => s.length));
    const totalSeqs = sequences.length;
    const coverageThreshold = 0.05;
    const steps = [];

    for (let t = 0; t < maxLen; t++) {
      const counts = Object.create(null);
      let total = 0;
      for (const seq of sequences) {
        if (t < seq.length) {
          counts[seq[t]] = (counts[seq[t]] || 0) + 1;
          total++;
        }
      }
      // Cut off timesteps with < 5% coverage
      if (total / totalSeqs < coverageThreshold) break;

      const proportions = Object.create(null);
      for (const [label, count] of Object.entries(counts)) {
        proportions[label] = count / total;
      }
      steps.push({ step: t + 1, proportions, total });
    }

    return { timesteps: steps, maxTimestep: steps.length };
  }, [sequences]);

  if (timesteps.length === 0) return null;

  const svgWidth = 600;
  const plotHeight = 250;
  const svgHeight = TOP_MARGIN + plotHeight + BOTTOM_MARGIN + LEGEND_HEIGHT;
  const plotWidth = svgWidth - LEFT_MARGIN - RIGHT_MARGIN;
  const barWidth = (plotWidth / maxTimestep) * 0.8;
  const barGap = (plotWidth / maxTimestep) * 0.2;

  const colorMap = Object.create(null);
  labels.forEach((l, i) => { colorMap[l] = getNodeColor(i); });

  // Y-axis gridlines
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} width="100%" style={{ display: 'block' }}>
      {/* Y-axis gridlines and labels */}
      {yTicks.map(tick => {
        const y = TOP_MARGIN + plotHeight - tick * plotHeight;
        return (
          <g key={tick}>
            <line
              x1={LEFT_MARGIN}
              y1={y}
              x2={svgWidth - RIGHT_MARGIN}
              y2={y}
              stroke="#374151"
              strokeWidth={0.5}
            />
            <text
              x={LEFT_MARGIN - 6}
              y={y}
              textAnchor="end"
              dominantBaseline="central"
              fill="#6b7280"
              fontSize={10}
            >
              {(tick * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}

      {/* Stacked bars */}
      {timesteps.map((ts, tIdx) => {
        const x = LEFT_MARGIN + tIdx * (barWidth + barGap) + barGap / 2;
        let cumY = 0;
        // Sort labels consistently for stacking
        const segments = labels
          .filter(l => ts.proportions[l] > 0)
          .map(l => ({ label: l, proportion: ts.proportions[l] || 0 }));

        return (
          <g key={ts.step}>
            {segments.map(seg => {
              const segHeight = seg.proportion * plotHeight;
              const segY = TOP_MARGIN + plotHeight - cumY - segHeight;
              cumY += segHeight;
              const pct = (seg.proportion * 100).toFixed(1);
              return (
                <rect
                  key={seg.label}
                  x={x}
                  y={segY}
                  width={barWidth}
                  height={Math.max(segHeight, 0.5)}
                  fill={colorMap[seg.label] || '#888'}
                  opacity={0.85}
                >
                  <title>{`${seg.label} at step ${ts.step}: ${pct}%`}</title>
                </rect>
              );
            })}
            {/* X-axis label */}
            <text
              x={x + barWidth / 2}
              y={TOP_MARGIN + plotHeight + 14}
              textAnchor="middle"
              fill="#6b7280"
              fontSize={10}
            >
              {ts.step}
            </text>
          </g>
        );
      })}

      {/* X-axis label */}
      <text
        x={LEFT_MARGIN + plotWidth / 2}
        y={TOP_MARGIN + plotHeight + 32}
        textAnchor="middle"
        fill="#9ca3af"
        fontSize={11}
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
            <text x={legendX + 14} y={legendY + 5} dominantBaseline="central" fill="#9ca3af" fontSize={9}>
              {label.length > 10 ? label.slice(0, 9) + '…' : label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
