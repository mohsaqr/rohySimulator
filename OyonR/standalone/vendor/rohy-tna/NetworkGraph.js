// Verbatim port of rohySimulator/src/components/analytics/tna/NetworkGraph.jsx
// JSX -> vanilla SVG-DOM; geometry/constants/formulas are byte-faithful.
// Source kept alongside as NetworkGraph.jsx.source for future syncs.
import { getNodeColor, EDGE_COLOR, ARROW_COLOR } from './tnaColors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function maxWeight(weights) {
  let max = 0;
  for (const row of weights) {
    for (const w of row) if (w > max) max = w;
  }
  return max;
}

function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

// Render a TNA model into a container as SVG, faithful to Rohy's NetworkGraph.
// model is the dynajs TNA shape: { labels, weights (Matrix), inits (Float64Array) }.
// Options: { svgWidth=960, graphHeight=500, nodeRadius=25, showSelfLoops=true, showEdgeLabels=false }.
export function renderNetworkGraph(container, model, options = {}) {
  container.replaceChildren();
  if (!model || !model.labels || model.labels.length === 0) return;

  const svgWidth = options.svgWidth ?? 960;
  const graphHeight = options.graphHeight ?? 500;
  const nodeRadius = options.nodeRadius ?? 25;
  const showSelfLoops = options.showSelfLoops ?? true;
  const showEdgeLabels = options.showEdgeLabels ?? false;
  const edgeColor = options.edgeColor ?? EDGE_COLOR;
  const arrowColor = options.arrowColor ?? ARROW_COLOR;
  const edgeLabelFontSize = options.edgeLabelFontSize ?? 7;

  const labels = model.labels;
  const inits = model.inits;
  const weights = model.weights && typeof model.weights.get === 'function'
    ? matrixTo2D(model.weights, labels.length)
    : model.weights;

  const n = labels.length;
  const centerX = svgWidth / 2;
  const centerY = graphHeight / 2;
  const layoutRadius = Math.min(svgWidth, graphHeight) / 2 - nodeRadius - 45;

  const nodes = labels.map((label, i) => {
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

  const mw = maxWeight(weights);
  const edges = [];
  const selfLoops = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const w = weights[i][j];
      if (w <= 0) continue;
      if (i === j) selfLoops.push({ from: i, weight: w });
      else edges.push({ from: i, to: j, weight: w });
    }
  }

  const biSet = new Set();
  for (const e of edges) {
    if (edges.some(o => o.from === e.to && o.to === e.from)) biSet.add(`${e.from}-${e.to}`);
  }
  for (const e of edges) e.bidir = biSet.has(`${e.from}-${e.to}`);

  const edgeWidth = w => MIN_EDGE_WIDTH + (w / mw) * (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH);
  const edgeOpacity = w => MIN_EDGE_OPACITY + (w / mw) * (MAX_EDGE_OPACITY - MIN_EDGE_OPACITY);

  const svg = el('svg', {
    viewBox: `0 0 ${svgWidth} ${graphHeight}`,
    width: '100%',
    style: 'display:block',
  });

  // Layer 1: Self-loops
  if (showSelfLoops) {
    for (const sl of selfLoops) {
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

      const arrowDirX = Math.sin(endAngle);
      const arrowDirY = -Math.cos(endAngle);
      const toNodeX = node.x - ex;
      const toNodeY = node.y - ey;
      const dot = arrowDirX * toNodeX + arrowDirY * toNodeY;
      const finalDirX = dot >= 0 ? arrowDirX : -arrowDirX;
      const finalDirY = dot >= 0 ? arrowDirY : -arrowDirY;

      const opacity = Math.min(edgeOpacity(sl.weight) + 0.15, 0.8);
      const width = Math.max(edgeWidth(sl.weight), 1.2);

      const g = el('g');
      const title = el('title');
      title.textContent = `${node.label} → ${node.label}: ${sl.weight.toFixed(3)}`;
      g.appendChild(title);
      g.appendChild(el('path', {
        d: `M ${sx} ${sy} A ${loopRadius} ${loopRadius} 0 1 1 ${ex} ${ey}`,
        fill: 'none',
        stroke: edgeColor,
        'stroke-width': width,
        opacity,
      }));
      g.appendChild(el('polygon', {
        points: arrowPoly(ex, ey, finalDirX, finalDirY, ARROW_SIZE * 0.8),
        fill: arrowColor,
        opacity,
      }));
      if (showEdgeLabels) {
        g.appendChild(el('text', {
          x: loopCenterX + dirX * (loopRadius + 8),
          y: loopCenterY + dirY * (loopRadius + 8),
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: 'var(--tna-svg-edge-label, #c8d0dd)',
          'font-size': edgeLabelFontSize,
        }, [sl.weight.toFixed(2).replace(/^0/, '')]));
      }
      svg.appendChild(g);
    }
  }

  // Layer 2: Edges
  for (const e of edges) {
    const src = nodes[e.from];
    const tgt = nodes[e.to];
    const curvature = e.bidir ? 22 : 0;

    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    const px = -ny;
    const py = nx;

    const midX = (src.x + tgt.x) / 2 + px * curvature;
    const midY = (src.y + tgt.y) / 2 + py * curvature;

    const startDirX = midX - src.x;
    const startDirY = midY - src.y;
    const startDist = Math.sqrt(startDirX * startDirX + startDirY * startDirY) || 1;
    const sx = src.x + (startDirX / startDist) * nodeRadius;
    const sy = src.y + (startDirY / startDist) * nodeRadius;

    const endDirX = midX - tgt.x;
    const endDirY = midY - tgt.y;
    const endDist = Math.sqrt(endDirX * endDirX + endDirY * endDirY) || 1;
    const stopDist = nodeRadius + ARROW_SIZE;
    const ex = tgt.x + (endDirX / endDist) * stopDist;
    const ey = tgt.y + (endDirY / endDist) * stopDist;

    const tipX = tgt.x + (endDirX / endDist) * nodeRadius;
    const tipY = tgt.y + (endDirY / endDist) * nodeRadius;

    const tangent = bezierTangent(1, sx, sy, midX, midY, tipX, tipY);

    const pathD = curvature === 0
      ? `M ${sx} ${sy} L ${ex} ${ey}`
      : `M ${sx} ${sy} Q ${midX} ${midY} ${ex} ${ey}`;

    const width = edgeWidth(e.weight);
    const opacity = edgeOpacity(e.weight);

    const g = el('g');
    const title = el('title');
    title.textContent = `${src.label} → ${tgt.label}: ${e.weight.toFixed(3)}`;
    g.appendChild(title);
    g.appendChild(el('path', { d: pathD, fill: 'none', stroke: edgeColor, 'stroke-width': width, opacity }));
    g.appendChild(el('polygon', {
      points: arrowPoly(tipX, tipY, tangent.x, tangent.y, ARROW_SIZE),
      fill: arrowColor,
      opacity,
    }));
    if (showEdgeLabels) {
      const labelPos = bezierPoint(0.55, sx, sy, midX, midY, ex, ey);
      g.appendChild(el('text', {
        x: labelPos.x,
        y: labelPos.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'var(--tna-svg-edge-label, #c8d0dd)',
        'font-size': edgeLabelFontSize,
      }, [e.weight.toFixed(2).replace(/^0/, '')]));
    }
    svg.appendChild(g);
  }

  // Layer 3: Nodes (with init-probability donut arc)
  for (const node of nodes) {
    const rimWidth = nodeRadius * 0.18;
    const ringRadius = nodeRadius + rimWidth * 0.7;
    const arcPath = donutArc(ringRadius, node.init);
    const labelText = node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label;
    const fontSize = node.label.length > 8 ? 9 : 11;

    const g = el('g', { transform: `translate(${node.x}, ${node.y})` });
    const title = el('title');
    title.textContent = `${node.label} (init: ${(node.init * 100).toFixed(1)}%)`;
    g.appendChild(title);
    g.appendChild(el('circle', {
      r: ringRadius,
      fill: 'none',
      stroke: 'var(--tna-svg-donut-bg, rgba(255,255,255,0.08))',
      'stroke-width': rimWidth,
    }));
    if (arcPath) {
      g.appendChild(el('path', {
        d: arcPath,
        fill: 'none',
        stroke: node.color,
        'stroke-width': rimWidth,
        'stroke-linecap': 'round',
      }));
    }
    g.appendChild(el('circle', {
      r: nodeRadius,
      fill: node.color,
      stroke: 'var(--tna-svg-node-stroke, #f7f9fc)',
      'stroke-width': 2.5,
      opacity: 0.9,
    }));
    g.appendChild(el('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill: 'var(--tna-svg-node-stroke, #f7f9fc)',
      'font-size': fontSize,
      'font-weight': 600,
    }, [labelText]));
    svg.appendChild(g);
  }

  container.appendChild(svg);
}

function matrixTo2D(matrix, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const row = [];
    for (let j = 0; j < n; j += 1) row.push(matrix.get(i, j));
    out.push(row);
  }
  return out;
}
