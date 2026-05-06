import { useState, useMemo } from "react";
import { useTheme } from "./useTheme";
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CELL_SIZE = 24;
const GAP = 2;
const ROW_LABEL_W = 40;
const COL_LABEL_H = 28;
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function interpolateColor(t, baseRgb, isDark) {
  if (isDark) {
    const bg = [55, 65, 81];
    const r = Math.round(bg[0] + t * (baseRgb[0] - bg[0]));
    const g = Math.round(bg[1] + t * (baseRgb[1] - bg[1]));
    const b = Math.round(bg[2] + t * (baseRgb[2] - bg[2]));
    return `rgb(${r},${g},${b})`;
  } else {
    const r = Math.round(255 + t * (baseRgb[0] - 255));
    const g = Math.round(255 + t * (baseRgb[1] - 255));
    const b = Math.round(255 + t * (baseRgb[2] - 255));
    return `rgb(${r},${g},${b})`;
  }
}
const ActivityHeatmap = ({ data, baseColor = "#5ab4ac" }) => {
  const { isDark } = useTheme();
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const { grid, maxCount, baseRgb } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    let mx = 0;
    for (const { dow, hour, count } of data) {
      if (hour >= 0 && hour < 24 && dow >= 0 && dow < 7) {
        g[dow][hour] = count;
        if (count > mx) mx = count;
      }
    }
    return { grid: g, maxCount: mx, baseRgb: hexToRgb(baseColor) };
  }, [data, baseColor]);
  const svgW = ROW_LABEL_W + 24 * (CELL_SIZE + GAP);
  const svgH = COL_LABEL_H + 7 * (CELL_SIZE + GAP) + 4;
  if (data.length === 0) {
    return <div className="text-center py-8 text-neutral-400 text-sm">
        No heatmap data available.
      </div>;
  }
  return <div>
      <div className="overflow-x-auto">
        <svg
    width={svgW}
    height={svgH}
    className="mx-auto"
    onMouseLeave={() => {
      setHovered(null);
      setTooltip(null);
    }}
  >
          {
    /* Hour column headers (thinned every 2h) */
  }
          {Array.from({ length: 24 }, (_, h) => {
    if (h % 2 !== 0) return null;
    return <text
      key={h}
      x={ROW_LABEL_W + h * (CELL_SIZE + GAP) + CELL_SIZE / 2}
      y={COL_LABEL_H - 8}
      textAnchor="middle"
      className="fill-gray-500 dark:fill-gray-400"
      fontSize={9}
    >
                {String(h).padStart(2, "0")}
              </text>;
  })}

          {
    /* Day row labels */
  }
          {DAYS_SHORT.map((day, di) => <text
    key={day}
    x={ROW_LABEL_W - 6}
    y={COL_LABEL_H + di * (CELL_SIZE + GAP) + CELL_SIZE / 2 + 4}
    textAnchor="end"
    className="fill-gray-600 dark:fill-gray-400"
    fontSize={10}
  >
              {day}
            </text>)}

          {
    /* Cells: row=dow, col=hour */
  }
          {grid.map(
    (row, dow) => row.map((count, hour) => {
      const isHov = hovered?.dow === dow && hovered?.hour === hour;
      const t = maxCount > 0 ? count / maxCount : 0;
      const fill = count === 0 ? isDark ? "rgba(55,65,81,0.3)" : "rgba(229,231,235,0.5)" : interpolateColor(t, baseRgb, isDark);
      return <rect
        key={`${dow}-${hour}`}
        x={ROW_LABEL_W + hour * (CELL_SIZE + GAP)}
        y={COL_LABEL_H + dow * (CELL_SIZE + GAP)}
        width={CELL_SIZE}
        height={CELL_SIZE}
        rx={3}
        fill={fill}
        stroke={isHov ? isDark ? "#e5e7eb" : "#374151" : "none"}
        strokeWidth={isHov ? 2 : 0}
        className="cursor-pointer transition-colors duration-100"
        onMouseEnter={(e) => {
          setHovered({ dow, hour });
          setTooltip({
            x: e.clientX,
            y: e.clientY,
            day: DAYS_FULL[dow],
            hour: `${String(hour).padStart(2, "0")}:00\u2013${String(hour).padStart(2, "0")}:59`,
            count
          });
        }}
        onMouseMove={(e) => setTooltip((tt) => tt ? { ...tt, x: e.clientX, y: e.clientY } : null)}
        onMouseLeave={() => {
          setHovered(null);
          setTooltip(null);
        }}
      />;
    })
  )}
        </svg>
      </div>

      {
    /* Color scale legend */
  }
      <div className="flex items-center justify-center gap-2 mt-2 text-xs text-neutral-400">
        <span>0</span>
        <div className="flex gap-0.5">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => <div
    key={t}
    className="w-5 h-3 rounded-sm"
    style={{ backgroundColor: interpolateColor(t, baseRgb, isDark) }}
  />)}
        </div>
        <span>{maxCount}</span>
      </div>

      {
    /* Tooltip */
  }
      {tooltip && <div
    className="fixed z-50 px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
    style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
  >
          <div className="font-semibold">{tooltip.day} {tooltip.hour}</div>
          <div>{tooltip.count.toLocaleString()} activities</div>
        </div>}
    </div>;
};
export {
  ActivityHeatmap
};
