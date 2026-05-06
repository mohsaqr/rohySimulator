import { useState, useMemo } from "react";
import { createColorMap } from "./colorFix";
const EDGE_COLOR = "#2B4C7E";
const ARROW_COLOR = "#2B4C7E";
const EDGE_LABEL_COLOR = "#2B4C7E";
const ARROW_LEN = 7;
const ARROW_HALF_W = 3.5;
const EDGE_WIDTH_MIN = 0.3;
const EDGE_WIDTH_MAX = 4;
const EDGE_OPACITY_MIN = 0.7;
const EDGE_OPACITY_MAX = 1;
const EDGE_CURVATURE = 22;
function fmtWeight(w) {
  if (Number.isInteger(w)) return String(w);
  return w.toFixed(2).replace(/^0\./, ".");
}
function arrowPoly(tipX, tipY, dx, dy) {
  const baseX = tipX - dx * ARROW_LEN;
  const baseY = tipY - dy * ARROW_LEN;
  const lx = baseX - dy * ARROW_HALF_W;
  const ly = baseY + dx * ARROW_HALF_W;
  const rx = baseX + dy * ARROW_HALF_W;
  const ry = baseY - dx * ARROW_HALF_W;
  return `${tipX},${tipY} ${lx},${ly} ${rx},${ry}`;
}
function computeEdgePath(sx, sy, tx, ty, curvature, nodeRadius) {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const mx = (sx + tx) / 2 + px * curvature;
  const my = (sy + ty) / 2 + py * curvature;
  const sdx = mx - sx;
  const sdy = my - sy;
  const slen = Math.sqrt(sdx * sdx + sdy * sdy);
  const startX = sx + sdx / slen * nodeRadius;
  const startY = sy + sdy / slen * nodeRadius;
  const edx = tx - mx;
  const edy = ty - my;
  const elen = Math.sqrt(edx * edx + edy * edy);
  const eux = edx / elen;
  const euy = edy / elen;
  const tipX = tx - eux * nodeRadius;
  const tipY = ty - euy * nodeRadius;
  const endX = tx - eux * (nodeRadius + 8);
  const endY = ty - euy * (nodeRadius + 8);
  const t = 0.55;
  const labelX = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * mx + t * t * endX;
  const labelY = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * my + t * t * endY;
  return { path: `M${startX},${startY} Q${mx},${my} ${endX},${endY}`, tipX, tipY, tipDx: eux, tipDy: euy, labelX, labelY };
}
function computeSelfLoop(nodeX, nodeY, centroidX, centroidY, nodeRadius) {
  const loopR = nodeRadius * 0.55;
  let dirX = nodeX - centroidX;
  let dirY = nodeY - centroidY;
  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
  dirX /= dirLen;
  dirY /= dirLen;
  const loopCX = nodeX + dirX * (nodeRadius + loopR);
  const loopCY = nodeY + dirY * (nodeRadius + loopR);
  const toNodeAngle = Math.atan2(nodeY - loopCY, nodeX - loopCX);
  const gapHalf = 0.4;
  const startAngle = toNodeAngle + gapHalf;
  const endAngle = toNodeAngle - gapHalf + 2 * Math.PI;
  const sx = loopCX + loopR * Math.cos(startAngle);
  const sy = loopCY + loopR * Math.sin(startAngle);
  const ex = loopCX + loopR * Math.cos(endAngle);
  const ey = loopCY + loopR * Math.sin(endAngle);
  const adx = nodeX - ex;
  const ady = nodeY - ey;
  const al = Math.sqrt(adx * adx + ady * ady) || 1;
  const labelX = loopCX + dirX * (loopR + 6);
  const labelY = loopCY + dirY * (loopR + 6);
  return {
    path: `M${sx},${sy} A${loopR},${loopR} 0 1,0 ${ex},${ey}`,
    arrowTipX: ex,
    arrowTipY: ey,
    arrowDx: adx / al,
    arrowDy: ady / al,
    labelX,
    labelY
  };
}
const TnaNetworkGraph = ({
  model,
  showSelfLoops = false,
  showEdgeLabels = true,
  nodeRadius: baseNodeRadius = 25,
  height = 500,
  colorMap: externalColorMap,
  centralityData,
  nodeSizeMetric = "fixed",
  modelType,
  externalPositions,
  maxEdgeWidth = EDGE_WIDTH_MAX
}) => {
  const { labels, weights, inits } = model;
  const isUndirected = modelType === "co-occurrence";
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const svgH = height;
  const svgW = svgH;
  const cx = svgW / 2;
  const cy = svgH / 2;
  const colors = useMemo(() => {
    if (externalColorMap) return labels.map((l) => externalColorMap[l] ?? "#888");
    const map = createColorMap(labels);
    return labels.map((l) => map[l]);
  }, [labels, externalColorMap]);
  const nodeScales = useMemo(() => {
    if (nodeSizeMetric === "fixed" || !centralityData) {
      return labels.map(() => 1);
    }
    const values = centralityData.measures[nodeSizeMetric];
    if (!values) return labels.map(() => 1);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    const range = max - min || 1;
    return labels.map((_, i) => 0.6 + (values[i] - min) / range * 0.8);
  }, [centralityData, nodeSizeMetric, labels]);
  const maxNodeScale = Math.max(...nodeScales);
  const padding = baseNodeRadius * maxNodeScale + 10;
  const layoutRadius = Math.min(cx, cy) - padding;
  const nodePositions = useMemo(() => {
    if (externalPositions && externalPositions.length === labels.length) return externalPositions;
    return labels.map((_, i) => {
      const angle = 2 * Math.PI * i / labels.length - Math.PI / 2;
      return { x: cx + layoutRadius * Math.cos(angle), y: cy + layoutRadius * Math.sin(angle) };
    });
  }, [labels, cx, cy, layoutRadius, externalPositions]);
  const { edges, bidir } = useMemo(() => {
    const result = [];
    if (isUndirected) {
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const wij = weights.get(i, j);
          const wji = weights.get(j, i);
          const w = (wij + wji) / 2;
          if (w > 0) result.push({ from: i, to: j, weight: w });
        }
      }
      return { edges: result, bidir: /* @__PURE__ */ new Set() };
    }
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        if (i === j) continue;
        const w = weights.get(i, j);
        if (w > 0) result.push({ from: i, to: j, weight: w });
      }
    }
    const bidirSet = /* @__PURE__ */ new Set();
    for (const e of result) {
      if (result.find((r) => r.from === e.to && r.to === e.from)) {
        bidirSet.add(`${e.from}-${e.to}`);
      }
    }
    return { edges: result, bidir: bidirSet };
  }, [labels, weights, isUndirected]);
  const selfLoops = useMemo(() => {
    if (!showSelfLoops) return [];
    const loops = [];
    for (let i = 0; i < labels.length; i++) {
      const w = weights.get(i, i);
      if (w > 0) loops.push({ idx: i, weight: w });
    }
    return loops;
  }, [labels, weights, showSelfLoops]);
  const globalMaxW = useMemo(() => {
    const allW = [...edges.map((e) => e.weight), ...selfLoops.map((s) => s.weight)];
    return Math.max(...allW, 1e-6);
  }, [edges, selfLoops]);
  const { normalizeWeight } = useMemo(() => {
    const allW = [...edges.map((e) => e.weight), ...selfLoops.map((s) => s.weight)];
    const mn = allW.length > 0 ? Math.min(...allW) : 0;
    const range = globalMaxW - mn || 1;
    const normalize = modelType === "attention" ? (w) => (w - mn) / range : (w) => w;
    return { normalizeWeight: normalize };
  }, [edges, selfLoops, globalMaxW, modelType]);
  const widthScale = (w) => EDGE_WIDTH_MIN + w / globalMaxW * (maxEdgeWidth - EDGE_WIDTH_MIN);
  const opacityScale = (w) => EDGE_OPACITY_MIN + w / globalMaxW * (EDGE_OPACITY_MAX - EDGE_OPACITY_MIN);
  return <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="mx-auto max-w-full">
        {selfLoops.map(({ idx, weight }) => {
    const nodeRadius = baseNodeRadius * nodeScales[idx];
    const pos = nodePositions[idx];
    const loop = computeSelfLoop(pos.x, pos.y, cx, cy, nodeRadius);
    const op = opacityScale(weight);
    const sw = widthScale(weight);
    const key = `self-${idx}`;
    const isHovered = hoveredEdge === key;
    return <g key={key}>
              <path
      d={loop.path}
      fill="none"
      stroke={isHovered ? "#e15759" : EDGE_COLOR}
      strokeWidth={sw}
      strokeOpacity={isHovered ? 0.85 : op}
      strokeLinecap="round"
      style={{ cursor: "pointer" }}
      onMouseEnter={() => setHoveredEdge(key)}
      onMouseLeave={() => setHoveredEdge(null)}
    >
                <title>{`${labels[idx]} \u2192 ${labels[idx]}: ${weight.toFixed(4)}`}</title>
              </path>
              {!isUndirected && <polygon
      points={arrowPoly(loop.arrowTipX, loop.arrowTipY, loop.arrowDx, loop.arrowDy)}
      fill={ARROW_COLOR}
      opacity={Math.min(op + 0.15, 1)}
    />}
              {showEdgeLabels && <text
      x={loop.labelX}
      y={loop.labelY}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={9}
      fill={EDGE_LABEL_COLOR}
      pointerEvents="none"
      style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round" }}
    >
                  {fmtWeight(normalizeWeight(weight))}
                </text>}
            </g>;
  })}

        {edges.map(({ from, to, weight }) => {
    const p1 = nodePositions[from];
    const p2 = nodePositions[to];
    const isBidir = bidir.has(`${from}-${to}`);
    const curvature = isUndirected ? 0 : isBidir ? EDGE_CURVATURE : 0;
    const nodeRadius = baseNodeRadius * nodeScales[to];
    const result = computeEdgePath(p1.x, p1.y, p2.x, p2.y, curvature, nodeRadius);
    if (!result) return null;
    const op = opacityScale(weight);
    const key = `${from}-${to}`;
    const isHovered = hoveredEdge === key;
    const arrow = isUndirected ? "\u2014" : "\u2192";
    const displayW = normalizeWeight(weight);
    return <g key={key}>
              <path
      d={result.path}
      fill="none"
      stroke={isHovered ? "#e15759" : EDGE_COLOR}
      strokeWidth={widthScale(weight)}
      strokeOpacity={isHovered ? 0.85 : op}
      strokeLinecap="round"
      style={{ cursor: "pointer" }}
      onMouseEnter={() => setHoveredEdge(key)}
      onMouseLeave={() => setHoveredEdge(null)}
    >
                <title>{`${labels[from]} ${arrow} ${labels[to]}: ${displayW.toFixed(4)}`}</title>
              </path>
              {!isUndirected && <polygon
      points={arrowPoly(result.tipX, result.tipY, result.tipDx, result.tipDy)}
      fill={ARROW_COLOR}
      opacity={Math.min(op + 0.15, 1)}
    />}
              {showEdgeLabels && <text
      x={result.labelX}
      y={result.labelY}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={9}
      fill={EDGE_LABEL_COLOR}
      pointerEvents="none"
      style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round" }}
    >
                  {fmtWeight(displayW)}
                </text>}
            </g>;
  })}

        {labels.map((label, i) => {
    const pos = nodePositions[i];
    const nodeRadius = baseNodeRadius * nodeScales[i];
    const color = colors[i];
    const isHovered = hoveredNode === i;
    return <g
      key={label}
      transform={`translate(${pos.x},${pos.y})`}
      style={{ cursor: "pointer" }}
      onMouseEnter={() => setHoveredNode(i)}
      onMouseLeave={() => setHoveredNode(null)}
    >
              <circle
      r={nodeRadius}
      fill={color}
      stroke={isHovered ? "#333333" : "#999999"}
      strokeWidth={isHovered ? 3 : 2}
    >
                <title>{`${label} (init: ${((inits[i] ?? 0) * 100).toFixed(1)}%)`}</title>
              </circle>
              <text
      y={1}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="#ffffff"
      fontSize={label.length > 10 ? 8 : label.length > 7 ? 9 : 11}
      fontWeight={600}
      pointerEvents="none"
      style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.3)", strokeWidth: 2, strokeLinejoin: "round" }}
    >
                {label.length > 12 ? label.slice(0, 11) + "\u2026" : label}
              </text>
            </g>;
  })}
      </svg>
    </div>;
};
export {
  TnaNetworkGraph
};
