import { useState, useMemo } from "react";
import { useTranslation } from "./i18nShim";
const MEASURE_COLORS = {
  Degree: "rgba(90, 180, 172, 0.8)",
  InDegree: "rgba(74, 144, 217, 0.8)",
  OutDegree: "rgba(230, 171, 2, 0.8)",
  InStrength: "rgba(74, 144, 217, 0.8)",
  OutStrength: "rgba(237, 140, 59, 0.8)",
  Betweenness: "rgba(169, 133, 202, 0.8)",
  Closeness: "rgba(225, 87, 89, 0.8)"
};
const MEASURE_I18N = {
  Degree: "sna.m_degree",
  InDegree: "sna.m_in_degree",
  OutDegree: "sna.m_out_degree",
  InStrength: "sna.m_in_strength",
  OutStrength: "sna.m_out_strength",
  Betweenness: "sna.m_betweenness",
  Closeness: "sna.m_closeness"
};
const CentralityBarChart = ({ centralityData, colorMap, selectedMeasure }) => {
  const { t } = useTranslation(["courses", "admin"]);
  const { labels, measures } = centralityData;
  const measureKeys = Object.keys(measures).filter((k) => measures[k]?.length > 0);
  const [internalMeasure, setInternalMeasure] = useState(measureKeys[0] ?? "InStrength");
  const activeMeasure = selectedMeasure ?? internalMeasure;
  const showTabs = !selectedMeasure;
  const values = measures[activeMeasure] ?? [];
  const sortedIndices = useMemo(() => {
    const indices = labels.map((_, i) => i);
    indices.sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0));
    return indices;
  }, [labels, values]);
  const maxVal = useMemo(() => Math.max(...values, 1e-6), [values]);
  const barHeight = 26;
  const gap = 5;
  const margin = { top: 10, right: 55, bottom: 10, left: 100 };
  const svgWidth = 600;
  const plotW = svgWidth - margin.left - margin.right;
  const svgHeight = margin.top + margin.bottom + labels.length * (barHeight + gap);
  return <div>
      {
    /* Measure tabs (hidden when controlled externally) */
  }
      {showTabs && <div className="flex rounded-lg border border-neutral-600 overflow-hidden text-xs mb-3 w-fit">
          {measureKeys.map((key) => <button
    key={key}
    onClick={() => setInternalMeasure(key)}
    className={`px-3 py-1 transition-colors ${activeMeasure === key ? "bg-primary-600 text-white" : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"}`}
  >
              {MEASURE_I18N[key] ? t(`courses:${MEASURE_I18N[key]}`) : key}
            </button>)}
        </div>}

      <div className="overflow-x-auto">
        <svg width={svgWidth} height={svgHeight} className="mx-auto">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {sortedIndices.map((li, rank) => {
    const label = labels[li];
    const val = values[li] ?? 0;
    const barW = val / maxVal * plotW;
    const y = rank * (barHeight + gap);
    return <g key={label}>
                  {
      /* Color dot */
    }
                  <circle
      cx={-margin.left + 12}
      cy={y + barHeight / 2}
      r={4}
      fill={colorMap[label] ?? "#888"}
    />
                  {
      /* Label */
    }
                  <text
      x={-8}
      y={y + barHeight / 2 + 4}
      textAnchor="end"
      className="fill-gray-700 dark:fill-gray-300"
      fontSize={11}
    >
                    {label.length > 12 ? label.slice(0, 11) + "\u2026" : label}
                  </text>
                  {
      /* Bar */
    }
                  <rect
      x={0}
      y={y}
      width={Math.max(barW, 1)}
      height={barHeight}
      fill={MEASURE_COLORS[activeMeasure] ?? "#888"}
      rx={3}
    >
                    <title>{`${label}: ${val.toFixed(4)}`}</title>
                  </rect>
                  {
      /* Value label */
    }
                  <text
      x={Math.max(barW, 1) + 4}
      y={y + barHeight / 2 + 4}
      className="fill-gray-500 dark:fill-gray-400"
      fontSize={10}
      textAnchor="start"
    >
                    {val.toFixed(3)}
                  </text>
                </g>;
  })}
          </g>
        </svg>
      </div>
    </div>;
};
export {
  CentralityBarChart
};
