import { useState, useMemo, useCallback } from "react";
import { createColorMap } from "./colorFix";
const ActivityTimelineChart = ({ days, verbs, series, palette = "default" }) => {
  const [mode, setMode] = useState("stacked");
  const [hoveredVerb, setHoveredVerb] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const colorMap = useMemo(() => createColorMap(verbs, palette), [verbs, palette]);
  const sortedVerbs = useMemo(() => {
    return [...verbs].sort((a, b) => {
      const sumA = series[a]?.reduce((s, v) => s + v, 0) ?? 0;
      const sumB = series[b]?.reduce((s, v) => s + v, 0) ?? 0;
      return sumB - sumA;
    });
  }, [verbs, series]);
  const svgWidth = 900;
  const svgHeight = 360;
  const margin = { top: 20, right: 20, bottom: 60, left: 50 };
  const plotW = svgWidth - margin.left - margin.right;
  const plotH = svgHeight - margin.top - margin.bottom;
  const { maxY, stackedData } = useMemo(() => {
    if (mode === "stacked") {
      const totals = days.map((_, i) => sortedVerbs.reduce((sum, v) => sum + (series[v]?.[i] ?? 0), 0));
      const maxVal = Math.max(...totals, 1);
      const stacked = {};
      for (const verb of sortedVerbs) {
        stacked[verb] = [];
      }
      for (let i = 0; i < days.length; i++) {
        let cumulative = 0;
        for (const verb of [...sortedVerbs].reverse()) {
          const val = series[verb]?.[i] ?? 0;
          stacked[verb].push({ y0: cumulative, y1: cumulative + val });
          cumulative += val;
        }
      }
      return { maxY: maxVal, stackedData: stacked };
    } else {
      let maxVal = 1;
      for (const verb of sortedVerbs) {
        const vals = series[verb] ?? [];
        for (const v of vals) {
          if (v > maxVal) maxVal = v;
        }
      }
      return { maxY: maxVal, stackedData: {} };
    }
  }, [days, sortedVerbs, series, mode]);
  const xScale = useCallback((i) => days.length <= 1 ? plotW / 2 : i / (days.length - 1) * plotW, [days.length, plotW]);
  const yScale = useCallback((v) => plotH - v / maxY * plotH, [maxY, plotH]);
  const barWidth = days.length > 1 ? Math.max(1, plotW / days.length * 0.7) : plotW * 0.1;
  const yTicks = useMemo(() => {
    const count = 5;
    const step = Math.ceil(maxY / count);
    const ticks = [];
    for (let v = 0; v <= maxY; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < maxY) ticks.push(maxY);
    return ticks;
  }, [maxY]);
  const xLabelInterval = useMemo(() => {
    if (days.length <= 15) return 1;
    if (days.length <= 30) return 2;
    if (days.length <= 60) return 5;
    if (days.length <= 120) return 7;
    return Math.ceil(days.length / 15);
  }, [days.length]);
  const formatDay = (d) => {
    if (!d) return "";
    const parts = d.split("-");
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d;
  };
  const linePaths = useMemo(() => {
    if (mode !== "lines") return {};
    const paths = {};
    for (const verb of sortedVerbs) {
      const vals = series[verb] ?? [];
      const points = vals.map((v, i) => `${xScale(i)},${yScale(v)}`);
      paths[verb] = `M${points.join("L")}`;
    }
    return paths;
  }, [mode, sortedVerbs, series, xScale, yScale]);
  if (days.length === 0) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
        No activity data available.
      </div>;
  }
  return <div>
      {
    /* Controls */
  }
      <div className="flex items-center justify-between mb-3">
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
          <button
    onClick={() => setMode("stacked")}
    className={`px-3 py-1.5 font-medium transition-colors ${mode === "stacked" ? "bg-primary-600 text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
  >
            Stacked Bars
          </button>
          <button
    onClick={() => setMode("lines")}
    className={`px-3 py-1.5 font-medium transition-colors ${mode === "lines" ? "bg-primary-600 text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
  >
            Lines
          </button>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          {days.length} day{days.length !== 1 ? "s" : ""} &middot; {sortedVerbs.length} verb{sortedVerbs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {
    /* Chart */
  }
      <div className="overflow-x-auto">
        <svg
    width={svgWidth}
    height={svgHeight}
    className="mx-auto"
    onMouseLeave={() => setTooltip(null)}
  >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {
    /* Grid lines */
  }
            {yTicks.map((v) => <line
    key={v}
    x1={0}
    x2={plotW}
    y1={yScale(v)}
    y2={yScale(v)}
    className="stroke-gray-200 dark:stroke-gray-700"
    strokeDasharray={v === 0 ? void 0 : "3,3"}
  />)}

            {
    /* Y axis labels */
  }
            {yTicks.map((v) => <text
    key={v}
    x={-8}
    y={yScale(v) + 4}
    textAnchor="end"
    className="fill-gray-500 dark:fill-gray-400"
    fontSize={10}
  >
                {v}
              </text>)}

            {
    /* Stacked bars */
  }
            {mode === "stacked" && days.map((day, i) => <g key={day}>
                {sortedVerbs.map((verb) => {
    const d = stackedData[verb]?.[i];
    if (!d || d.y1 - d.y0 === 0) return null;
    const barX = xScale(i) - barWidth / 2;
    const barY = yScale(d.y1);
    const barH = yScale(d.y0) - yScale(d.y1);
    return <rect
      key={verb}
      x={barX}
      y={barY}
      width={barWidth}
      height={Math.max(0, barH)}
      fill={colorMap[verb]}
      opacity={hoveredVerb && hoveredVerb !== verb ? 0.25 : 0.85}
      rx={1}
      className="transition-opacity duration-150 cursor-pointer"
      onMouseEnter={(e) => {
        setHoveredVerb(verb);
        setTooltip({ x: e.clientX, y: e.clientY, day, verb, count: d.y1 - d.y0 });
      }}
      onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
      onMouseLeave={() => {
        setHoveredVerb(null);
        setTooltip(null);
      }}
    />;
  })}
              </g>)}

            {
    /* Lines */
  }
            {mode === "lines" && sortedVerbs.map((verb) => <g key={verb}>
                <path
    d={linePaths[verb]}
    fill="none"
    stroke={colorMap[verb]}
    strokeWidth={hoveredVerb === verb ? 3 : hoveredVerb ? 1 : 2}
    opacity={hoveredVerb && hoveredVerb !== verb ? 0.2 : 1}
    className="transition-all duration-150"
  />
                {
    /* Dots */
  }
                {(series[verb] ?? []).map((v, i) => <circle
    key={i}
    cx={xScale(i)}
    cy={yScale(v)}
    r={hoveredVerb === verb ? 4 : 2.5}
    fill={colorMap[verb]}
    opacity={hoveredVerb && hoveredVerb !== verb ? 0.2 : 1}
    className="transition-all duration-150 cursor-pointer"
    onMouseEnter={(e) => {
      setHoveredVerb(verb);
      setTooltip({ x: e.clientX, y: e.clientY, day: days[i], verb, count: v });
    }}
    onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
    onMouseLeave={() => {
      setHoveredVerb(null);
      setTooltip(null);
    }}
  />)}
              </g>)}

            {
    /* X axis labels */
  }
            {days.map((day, i) => {
    if (i % xLabelInterval !== 0) return null;
    return <text
      key={day}
      x={xScale(i)}
      y={plotH + 18}
      textAnchor="middle"
      className="fill-gray-500 dark:fill-gray-400"
      fontSize={10}
      transform={days.length > 20 ? `rotate(-45, ${xScale(i)}, ${plotH + 18})` : void 0}
    >
                  {formatDay(day)}
                </text>;
  })}
          </g>
        </svg>
      </div>

      {
    /* Tooltip */
  }
      {tooltip && <div
    className="fixed z-50 px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
    style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
  >
          <div className="font-semibold">{tooltip.day}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
    className="w-2.5 h-2.5 rounded-sm inline-block"
    style={{ backgroundColor: colorMap[tooltip.verb] }}
  />
            {tooltip.verb}: <span className="font-semibold">{tooltip.count}</span>
          </div>
        </div>}

      {
    /* Legend */
  }
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 justify-center">
        {sortedVerbs.map((verb) => {
    const total = (series[verb] ?? []).reduce((s, v) => s + v, 0);
    return <button
      key={verb}
      className="flex items-center gap-1.5 text-xs transition-opacity duration-150 cursor-pointer"
      style={{ opacity: hoveredVerb && hoveredVerb !== verb ? 0.3 : 1 }}
      onMouseEnter={() => setHoveredVerb(verb)}
      onMouseLeave={() => setHoveredVerb(null)}
    >
              <span
      className="w-3 h-3 rounded-sm inline-block flex-shrink-0"
      style={{ backgroundColor: colorMap[verb] }}
    />
              <span className="text-gray-700 dark:text-gray-300">{verb}</span>
              <span className="text-gray-400 dark:text-gray-500">({total})</span>
            </button>;
  })}
      </div>
    </div>;
};
export {
  ActivityTimelineChart
};
