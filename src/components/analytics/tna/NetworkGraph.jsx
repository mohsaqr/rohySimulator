import React, { useMemo, useState } from 'react';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { getNodeColor, EDGE_COLOR, ARROW_COLOR } from './tnaColors';
import { maxWeight as computeMaxWeight } from './tnaUtils';

const ARROW_SIZE = 10;
const MIN_EDGE_WIDTH = 0.6;
const MAX_EDGE_WIDTH = 2.8;
const MIN_EDGE_OPACITY = 0.2;
const MAX_EDGE_OPACITY = 0.55;

function donutArc(radius, fraction) {
  if (fraction <= 0) return '';
  if (fraction >= 0.9999) {
    return `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius}`;
  }
  const angle = fraction * 2 * Math.PI;
  const endX = radius * Math.sin(angle);
  const endY = -radius * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;
  return `M 0 ${-radius} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}

function arrowPoly(tipX, tipY, dirX, dirY, size) {
  const halfW = size / 2;
  const baseX = tipX - dirX * size;
  const baseY = tipY - dirY * size;
  return `${tipX},${tipY} ${baseX - dirY * halfW},${baseY + dirX * halfW} ${baseX + dirY * halfW},${baseY - dirX * halfW}`;
}

function bezierPoint(t, sx, sy, cx, cy, ex, ey) {
  const mt = 1 - t;
  return {
    x: mt * mt * sx + 2 * mt * t * cx + t * t * ex,
    y: mt * mt * sy + 2 * mt * t * cy + t * t * ey,
  };
}

function bezierTangent(t, sx, sy, cx, cy, ex, ey) {
  const mt = 1 - t;
  const dx = 2 * mt * (cx - sx) + 2 * t * (ex - cx);
  const dy = 2 * mt * (cy - sy) + 2 * t * (ey - cy);
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

export default function NetworkGraph({ model, onPruneChange, pruneThreshold }) {
  const [showSelfLoops, setShowSelfLoops] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [nodeRadius, setNodeRadius] = useState(25);
  const [graphHeight, setGraphHeight] = useState(500);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const svgWidth = 960;

  const { nodes, edges, selfLoops, mw } = useMemo(() => {
    if (!model) return { nodes: [], edges: [], selfLoops: [], mw: 0 };

    const { labels, weights, inits } = model;
    const n = labels.length;
    const centerX = svgWidth / 2;
    const centerY = graphHeight / 2;
    const layoutRadius = Math.min(svgWidth, graphHeight) / 2 - nodeRadius - 45;

    // Compute node positions
    const nodeList = labels.map((label, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      return {
        index: i,
        label,
        x: centerX + layoutRadius * Math.cos(angle),
        y: centerY + layoutRadius * Math.sin(angle),
        init: inits[i],
        color: getNodeColor(i),
      };
    });

    // Build edge list
    const mw = computeMaxWeight(weights);
    const edgeList = [];
    const selfLoopList = [];

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = weights[i][j];
        if (w <= 0) continue;
        if (i === j) {
          selfLoopList.push({ from: i, weight: w });
        } else {
          edgeList.push({ from: i, to: j, weight: w });
        }
      }
    }

    // Mark bidirectional pairs
    const biSet = new Set();
    for (const e of edgeList) {
      if (edgeList.some(o => o.from === e.to && o.to === e.from)) {
        biSet.add(`${e.from}-${e.to}`);
      }
    }
    for (const e of edgeList) {
      e.bidir = biSet.has(`${e.from}-${e.to}`);
    }

    return { nodes: nodeList, edges: edgeList, selfLoops: selfLoopList, mw };
  }, [model, svgWidth, graphHeight, nodeRadius]);

  if (!model || nodes.length === 0) return null;

  const edgeWidth = (w) => MIN_EDGE_WIDTH + (w / mw) * (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH);
  const edgeOpacity = (w) => MIN_EDGE_OPACITY + (w / mw) * (MAX_EDGE_OPACITY - MIN_EDGE_OPACITY);

  const centerX = svgWidth / 2;
  const centerY = graphHeight / 2;

  return (
    <div>
      {/* Settings toggle */}
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Graph Settings
          {settingsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Collapsible settings panel */}
      {settingsOpen && (
        <div className="bg-neutral-800 rounded-lg p-3 mb-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs text-neutral-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showSelfLoops}
              onChange={(e) => setShowSelfLoops(e.target.checked)}
              className="rounded"
            />
            Self-loops
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showEdgeLabels}
              onChange={(e) => setShowEdgeLabels(e.target.checked)}
              className="rounded"
            />
            Edge labels
          </label>
          <label className="flex flex-col gap-1">
            <span>Node radius: {nodeRadius}</span>
            <input
              type="range"
              min={15}
              max={50}
              value={nodeRadius}
              onChange={(e) => setNodeRadius(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Height: {graphHeight}</span>
            <input
              type="range"
              min={300}
              max={800}
              value={graphHeight}
              onChange={(e) => setGraphHeight(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Prune: {pruneThreshold.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={pruneThreshold}
              onChange={(e) => onPruneChange(Number(e.target.value))}
              className="w-full"
            />
          </label>
        </div>
      )}

      {/* SVG Graph */}
      <svg viewBox={`0 0 ${svgWidth} ${graphHeight}`} width="100%" style={{ display: 'block' }}>
        {/* Layer 1: Self-loops */}
        {showSelfLoops && selfLoops.map(sl => {
          const node = nodes[sl.from];
          const dx = node.x - centerX;
          const dy = node.y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const dirX = dx / dist;
          const dirY = dy / dist;

          const loopRadius = nodeRadius * 0.55;
          const loopCenterX = node.x + dirX * (nodeRadius + loopRadius);
          const loopCenterY = node.y + dirY * (nodeRadius + loopRadius);

          const gapAngle = 0.4;
          const startAngle = Math.atan2(-dirY, -dirX) + gapAngle;
          const endAngle = Math.atan2(-dirY, -dirX) - gapAngle + 2 * Math.PI;

          const sx = loopCenterX + loopRadius * Math.cos(startAngle);
          const sy = loopCenterY + loopRadius * Math.sin(startAngle);
          const ex = loopCenterX + loopRadius * Math.cos(endAngle);
          const ey = loopCenterY + loopRadius * Math.sin(endAngle);

          // Arrow direction at end point (tangent to circle at endpoint, pointing toward node)
          const tangentX = -Math.sin(endAngle);
          const tangentY = Math.cos(endAngle);
          // The arrow should point towards the node
          const toNodeX = node.x - ex;
          const toNodeY = node.y - ey;
          const toNodeDist = Math.sqrt(toNodeX * toNodeX + toNodeY * toNodeY) || 1;

          const opacity = Math.min(edgeOpacity(sl.weight) + 0.15, 0.8);
          const width = Math.max(edgeWidth(sl.weight), 1.2);

          return (
            <g key={`self-${sl.from}`}>
              <title>{`${node.label} → ${node.label}: ${sl.weight.toFixed(3)}`}</title>
              <path
                d={`M ${sx} ${sy} A ${loopRadius} ${loopRadius} 0 1 1 ${ex} ${ey}`}
                fill="none"
                stroke={EDGE_COLOR}
                strokeWidth={width}
                opacity={opacity}
              />
              <polygon
                points={arrowPoly(ex, ey, toNodeX / toNodeDist, toNodeY / toNodeDist, ARROW_SIZE * 0.8)}
                fill={ARROW_COLOR}
                opacity={opacity}
              />
              {showEdgeLabels && (
                <text
                  x={loopCenterX + dirX * (loopRadius + 8)}
                  y={loopCenterY + dirY * (loopRadius + 8)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#555566"
                  fontSize={7}
                >
                  {sl.weight.toFixed(2).replace(/^0/, '')}
                </text>
              )}
            </g>
          );
        })}

        {/* Layer 2: Edges */}
        {edges.map(e => {
          const src = nodes[e.from];
          const tgt = nodes[e.to];
          const curvature = e.bidir ? 22 : 0;

          const dx = tgt.x - src.x;
          const dy = tgt.y - src.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;

          // Perpendicular for curvature
          const px = -ny;
          const py = nx;

          const midX = (src.x + tgt.x) / 2 + px * curvature;
          const midY = (src.y + tgt.y) / 2 + py * curvature;

          // Offset start from node edge
          const startDirX = midX - src.x;
          const startDirY = midY - src.y;
          const startDist = Math.sqrt(startDirX * startDirX + startDirY * startDirY) || 1;
          const sx = src.x + (startDirX / startDist) * nodeRadius;
          const sy = src.y + (startDirY / startDist) * nodeRadius;

          // End at nodeRadius + arrowSize from target center
          const endDirX = midX - tgt.x;
          const endDirY = midY - tgt.y;
          const endDist = Math.sqrt(endDirX * endDirX + endDirY * endDirY) || 1;
          const stopDist = nodeRadius + ARROW_SIZE;
          const ex = tgt.x + (endDirX / endDist) * stopDist;
          const ey = tgt.y + (endDirY / endDist) * stopDist;

          // Arrow tip at node edge
          const tipX = tgt.x + (endDirX / endDist) * nodeRadius;
          const tipY = tgt.y + (endDirY / endDist) * nodeRadius;

          // Arrow direction from bezier tangent at t=1
          const tangent = bezierTangent(1, sx, sy, midX, midY, tipX, tipY);

          const pathD = curvature === 0
            ? `M ${sx} ${sy} L ${ex} ${ey}`
            : `M ${sx} ${sy} Q ${midX} ${midY} ${ex} ${ey}`;

          const width = edgeWidth(e.weight);
          const opacity = edgeOpacity(e.weight);

          // Label at t=0.55
          let labelPos = null;
          if (showEdgeLabels) {
            labelPos = bezierPoint(0.55, sx, sy, midX, midY, ex, ey);
          }

          return (
            <g key={`edge-${e.from}-${e.to}`}>
              <title>{`${src.label} → ${tgt.label}: ${e.weight.toFixed(3)}`}</title>
              <path
                d={pathD}
                fill="none"
                stroke={EDGE_COLOR}
                strokeWidth={width}
                opacity={opacity}
              />
              <polygon
                points={arrowPoly(tipX, tipY, tangent.x, tangent.y, ARROW_SIZE)}
                fill={ARROW_COLOR}
                opacity={opacity}
              />
              {showEdgeLabels && labelPos && (
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#555566"
                  fontSize={7}
                >
                  {e.weight.toFixed(2).replace(/^0/, '')}
                </text>
              )}
            </g>
          );
        })}

        {/* Layer 3: Nodes */}
        {nodes.map(node => {
          const rimWidth = nodeRadius * 0.18;
          const ringRadius = nodeRadius + rimWidth * 0.7;
          const arcPath = donutArc(ringRadius, node.init);
          const labelText = node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label;
          const fontSize = node.label.length > 8 ? 9 : 11;

          return (
            <g key={`node-${node.index}`} transform={`translate(${node.x}, ${node.y})`}>
              <title>{`${node.label} (init: ${(node.init * 100).toFixed(1)}%)`}</title>
              {/* Donut ring background */}
              <circle
                r={ringRadius}
                fill="none"
                stroke="#e0e0e0"
                strokeWidth={rimWidth}
                opacity={0.3}
              />
              {/* Donut ring arc (init probability) */}
              {arcPath && (
                <path
                  d={arcPath}
                  fill="none"
                  stroke={node.color}
                  strokeWidth={rimWidth}
                  strokeLinecap="round"
                />
              )}
              {/* Filled circle */}
              <circle
                r={nodeRadius}
                fill={node.color}
                stroke="white"
                strokeWidth={2.5}
                opacity={0.9}
              />
              {/* Label */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={fontSize}
                fontWeight={600}
              >
                {labelText}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
