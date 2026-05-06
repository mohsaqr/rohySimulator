import { useState, useMemo } from "react";
import { createColorMap } from "./colorFix";
const OUTER_R = 90;
const INNER_R = 55;
const SVG_SIZE = 240;
const CENTER = SVG_SIZE / 2;
const OTHER_THRESHOLD = 0.03;
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const sweep = endAngle - startAngle;
  const largeArc = sweep > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z"
  ].join(" ");
}
const ActivityDonutChart = ({ data, title, palette = "default" }) => {
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const { slices, total, colorMap } = useMemo(() => {
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const tot = entries.reduce((s2, [, v]) => s2 + v, 0);
    if (tot === 0) return { slices: [], total: 0, colorMap: {} };
    const main = [];
    let otherCount = 0;
    for (const [label, count] of entries) {
      if (count / tot < OTHER_THRESHOLD) {
        otherCount += count;
      } else {
        main.push([label, count]);
      }
    }
    if (otherCount > 0) main.push(["Other", otherCount]);
    const labels = main.map(([l]) => l);
    const cm = createColorMap(labels, palette);
    let angle = 0;
    const s = main.map(([label, count]) => {
      const sweep = count / tot * 360;
      const startAngle = angle;
      angle += sweep;
      return { label, count, pct: count / tot * 100, startAngle, endAngle: angle };
    });
    return { slices: s, total: tot, colorMap: cm };
  }, [data, palette]);
  if (slices.length === 0) {
    return <div className="bg-neutral-800/50 rounded-xl p-4 border border-neutral-700">
        <h3 className="text-base font-semibold text-neutral-100 mb-2">{title}</h3>
        <div className="text-center py-8 text-neutral-400 text-sm">No data</div>
      </div>;
  }
  return <div className="bg-neutral-800/50 rounded-xl p-4 border border-neutral-700">
      <h3 className="text-base font-semibold text-neutral-100 mb-2">{title}</h3>
      <div className="flex flex-col items-center">
        <svg
    width={SVG_SIZE}
    height={SVG_SIZE}
    viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
    className="overflow-visible"
    onMouseLeave={() => {
      setHoveredSlice(null);
      setTooltip(null);
    }}
  >
          {slices.map((slice) => {
    const isHovered = hoveredSlice === slice.label;
    const midAngle = (slice.startAngle + slice.endAngle) / 2;
    const expandDist = isHovered ? 5 : 0;
    const midRad = (midAngle - 90) * Math.PI / 180;
    const tx = expandDist * Math.cos(midRad);
    const ty = expandDist * Math.sin(midRad);
    return <path
      key={slice.label}
      d={arcPath(CENTER, CENTER, OUTER_R, INNER_R, slice.startAngle, slice.endAngle - 0.5)}
      fill={colorMap[slice.label]}
      opacity={hoveredSlice && !isHovered ? 0.4 : 1}
      transform={`translate(${tx},${ty})`}
      className="transition-all duration-150 cursor-pointer"
      stroke="white"
      strokeWidth={1.5}
      onMouseEnter={(e) => {
        setHoveredSlice(slice.label);
        setTooltip({ x: e.clientX, y: e.clientY, label: slice.label, count: slice.count, pct: slice.pct });
      }}
      onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
      onMouseLeave={() => {
        setHoveredSlice(null);
        setTooltip(null);
      }}
    />;
  })}
          {
    /* Center total */
  }
          <text
    x={CENTER}
    y={CENTER - 6}
    textAnchor="middle"
    className="fill-gray-900 dark:fill-gray-100 font-bold"
    fontSize={20}
  >
            {total.toLocaleString()}
          </text>
          <text
    x={CENTER}
    y={CENTER + 12}
    textAnchor="middle"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={11}
  >
            total
          </text>
        </svg>

        {
    /* Legend */
  }
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 justify-center">
          {slices.map((slice) => <button
    key={slice.label}
    className="flex items-center gap-1.5 text-xs transition-opacity duration-150 cursor-pointer"
    style={{ opacity: hoveredSlice && hoveredSlice !== slice.label ? 0.3 : 1 }}
    onMouseEnter={() => setHoveredSlice(slice.label)}
    onMouseLeave={() => setHoveredSlice(null)}
  >
              <span
    className="w-3 h-3 rounded-sm inline-block flex-shrink-0"
    style={{ backgroundColor: colorMap[slice.label] }}
  />
              <span className="text-neutral-200">{slice.label}</span>
              <span className="text-neutral-500">({slice.count})</span>
            </button>)}
        </div>
      </div>

      {
    /* Tooltip */
  }
      {tooltip && <div
    className="fixed z-50 px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
    style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
  >
          <div className="font-semibold">{tooltip.label}</div>
          <div>{tooltip.count.toLocaleString()} ({tooltip.pct.toFixed(1)}%)</div>
        </div>}
    </div>;
};
export {
  ActivityDonutChart
};
