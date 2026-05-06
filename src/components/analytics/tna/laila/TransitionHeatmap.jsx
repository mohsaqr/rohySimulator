import { useMemo, useState } from "react";
function interpolateColor(value, max) {
  const t = max > 0 ? value / max : 0;
  const r = Math.round(255 - t * (255 - 33));
  const g = Math.round(255 - t * (255 - 102));
  const b = Math.round(255 + t * (204 - 255));
  return `rgb(${r},${g},${b})`;
}
const TransitionHeatmap = ({ model }) => {
  const { labels, weights } = model;
  const [hoveredCell, setHoveredCell] = useState(null);
  const { matrix, maxVal } = useMemo(() => {
    const n = labels.length;
    const mat = [];
    let mx = 0;
    for (let i = 0; i < n; i++) {
      mat[i] = [];
      for (let j = 0; j < n; j++) {
        const v = weights.get(i, j);
        mat[i][j] = v;
        if (v > mx) mx = v;
      }
    }
    return { matrix: mat, maxVal: mx };
  }, [labels, weights]);
  const cellSize = Math.min(50, Math.max(28, 400 / labels.length));
  const labelWidth = 90;
  const maxLabelChars = labels.reduce((mx, l) => Math.max(mx, Math.min(l.length, 10)), 0);
  const topLabelHeight = Math.max(90, maxLabelChars * 8);
  const svgW = labelWidth + labels.length * cellSize + 20;
  const svgH = topLabelHeight + labels.length * cellSize + 20;
  return <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} className="mx-auto">
        {
    /* Cells first (so labels render on top) */
  }
        {labels.map((_, i) => <g key={`row-${i}`}>
            {labels.map((__, j) => {
    const val = matrix[i][j];
    const isHovered = hoveredCell?.i === i && hoveredCell?.j === j;
    const textColor = val / (maxVal || 1) > 0.5 ? "#ffffff" : "#333333";
    return <g
      key={`cell-${i}-${j}`}
      onMouseEnter={() => setHoveredCell({ i, j })}
      onMouseLeave={() => setHoveredCell(null)}
    >
                  <rect
      x={labelWidth + j * cellSize}
      y={topLabelHeight + i * cellSize}
      width={cellSize - 1}
      height={cellSize - 1}
      fill={val > 0 ? interpolateColor(val, maxVal) : "rgba(200,200,200,0.15)"}
      stroke={isHovered ? "#333" : "none"}
      strokeWidth={isHovered ? 2 : 0}
      rx={2}
      style={{ cursor: "pointer" }}
    >
                    <title>{`${labels[i]} \u2192 ${labels[j]}: ${val.toFixed(4)}`}</title>
                  </rect>
                  {cellSize >= 30 && val > 0 && <text
      x={labelWidth + j * cellSize + (cellSize - 1) / 2}
      y={topLabelHeight + i * cellSize + (cellSize - 1) / 2 + 4}
      textAnchor="middle"
      fontSize={Math.min(10, cellSize * 0.28)}
      fill={textColor}
      pointerEvents="none"
    >
                      {val < 0.01 ? "" : val < 1 ? val.toFixed(2) : val.toFixed(0)}
                    </text>}
                </g>;
  })}
          </g>)}

        {
    /* Row labels (rendered after cells so they appear on top) */
  }
        {labels.map((rowLabel, i) => <text
    key={`rowlbl-${i}`}
    x={labelWidth - 6}
    y={topLabelHeight + i * cellSize + cellSize / 2 + 4}
    textAnchor="end"
    className="fill-gray-700 dark:fill-gray-300"
    fontSize={Math.min(11, cellSize * 0.4)}
  >
            {rowLabel.length > 10 ? rowLabel.slice(0, 9) + "\u2026" : rowLabel}
          </text>)}

        {
    /* Column labels (rendered last so they appear on top) */
  }
        {labels.map((label, j) => <text
    key={`col-${j}`}
    x={labelWidth + j * cellSize + cellSize / 2}
    y={topLabelHeight - 6}
    textAnchor="end"
    transform={`rotate(-45, ${labelWidth + j * cellSize + cellSize / 2}, ${topLabelHeight - 6})`}
    className="fill-gray-700 dark:fill-gray-300"
    fontSize={Math.min(11, cellSize * 0.4)}
  >
            {label.length > 10 ? label.slice(0, 9) + "\u2026" : label}
          </text>)}
      </svg>
    </div>;
};
export {
  TransitionHeatmap
};
