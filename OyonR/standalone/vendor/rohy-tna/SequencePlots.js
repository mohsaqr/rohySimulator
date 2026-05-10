// Verbatim ports of:
//   rohySimulator/src/components/analytics/tna/DistributionPlot.jsx  (renderDistributionPlot)
//   rohySimulator/src/components/analytics/tna/IndexPlot.jsx         (renderIndexPlot)
// JSX -> vanilla SVG-DOM; geometry, constants, and tick logic byte-faithful.
import { getNodeColor } from './tnaColors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

// ──────── DistributionPlot ────────
const DP_LEFT_MARGIN = 40;
const DP_RIGHT_MARGIN = 20;
const DP_TOP_MARGIN = 20;
const DP_BOTTOM_MARGIN = 40;
const DP_LEGEND_HEIGHT = 24;

export function renderDistributionPlot(container, sequences, labels) {
  container.replaceChildren();
  if (!sequences || sequences.length === 0) return;

  const maxLen = Math.max(...sequences.map(s => s.length));
  const minTimesteps = 20;
  const timesteps = [];
  for (let t = 0; t < maxLen; t += 1) {
    const counts = Object.create(null);
    let total = 0;
    for (const seq of sequences) {
      if (t < seq.length) {
        counts[seq[t]] = (counts[seq[t]] || 0) + 1;
        total += 1;
      }
    }
    if (total === 0) break;
    if (t >= minTimesteps && total <= 1) break;
    const proportions = Object.create(null);
    for (const [label, count] of Object.entries(counts)) proportions[label] = count / total;
    timesteps.push({ step: t + 1, proportions, total });
  }
  const maxTimestep = timesteps.length;
  if (maxTimestep === 0) return;

  const svgWidth = 600;
  const plotHeight = 250;
  const svgHeight = DP_TOP_MARGIN + plotHeight + DP_BOTTOM_MARGIN + DP_LEGEND_HEIGHT;
  const plotWidth = svgWidth - DP_LEFT_MARGIN - DP_RIGHT_MARGIN;
  const barWidth = (plotWidth / maxTimestep) * 0.8;
  const barGap = (plotWidth / maxTimestep) * 0.2;
  const colorMap = Object.create(null);
  labels.forEach((l, i) => { colorMap[l] = getNodeColor(i); });
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  const svg = el('svg', { viewBox: `0 0 ${svgWidth} ${svgHeight}`, width: '100%', style: 'display:block' });

  for (const tick of yTicks) {
    const y = DP_TOP_MARGIN + plotHeight - tick * plotHeight;
    svg.appendChild(el('line', {
      x1: DP_LEFT_MARGIN, y1: y, x2: svgWidth - DP_RIGHT_MARGIN, y2: y,
      stroke: 'var(--tna-svg-grid, #e5e7eb)', 'stroke-width': 0.5,
    }));
    svg.appendChild(el('text', {
      x: DP_LEFT_MARGIN - 6, y, 'text-anchor': 'end', 'dominant-baseline': 'central',
      fill: 'var(--tna-svg-axis, #6b7280)', 'font-size': 10,
    }, [`${(tick * 100).toFixed(0)}%`]));
  }

  timesteps.forEach((ts, tIdx) => {
    const x = DP_LEFT_MARGIN + tIdx * (barWidth + barGap) + barGap / 2;
    let cumY = 0;
    const segments = labels
      .filter(l => ts.proportions[l] > 0)
      .map(l => ({ label: l, proportion: ts.proportions[l] || 0 }));
    for (const seg of segments) {
      const segHeight = seg.proportion * plotHeight;
      const segY = DP_TOP_MARGIN + plotHeight - cumY - segHeight;
      cumY += segHeight;
      const pct = (seg.proportion * 100).toFixed(1);
      const rect = el('rect', {
        x, y: segY, width: barWidth, height: Math.max(segHeight, 0.5),
        fill: colorMap[seg.label] || '#888', opacity: 0.85,
      });
      const title = el('title');
      title.textContent = `${seg.label} at step ${ts.step}: ${pct}%`;
      rect.appendChild(title);
      svg.appendChild(rect);
    }
    svg.appendChild(el('text', {
      x: x + barWidth / 2, y: DP_TOP_MARGIN + plotHeight + 14,
      'text-anchor': 'middle', fill: 'var(--tna-svg-axis, #6b7280)', 'font-size': 10,
    }, [String(ts.step)]));
  });

  svg.appendChild(el('text', {
    x: DP_LEFT_MARGIN + plotWidth / 2, y: DP_TOP_MARGIN + plotHeight + 32,
    'text-anchor': 'middle', fill: 'var(--tna-svg-label, #6b7280)', 'font-size': 11,
  }, ['Timestep']));

  labels.forEach((label, i) => {
    const legendX = DP_LEFT_MARGIN + i * 90;
    const legendY = svgHeight - DP_LEGEND_HEIGHT + 8;
    if (legendX + 80 > svgWidth) return;
    svg.appendChild(el('rect', { x: legendX, y: legendY, width: 10, height: 10, fill: colorMap[label] || '#888', rx: 2 }));
    svg.appendChild(el('text', {
      x: legendX + 14, y: legendY + 5, 'dominant-baseline': 'central',
      fill: 'var(--tna-svg-label, #6b7280)', 'font-size': 9,
    }, [label.length > 10 ? `${label.slice(0, 9)}…` : label]));
  });

  container.appendChild(svg);
}

// ──────── IndexPlot ────────
const IP_LEFT_MARGIN = 50;
const IP_RIGHT_MARGIN = 20;
const IP_TOP_MARGIN = 8;
const IP_BOTTOM_MARGIN = 30;
const IP_LEGEND_HEIGHT = 24;
const IP_MIN_PLOT_HEIGHT = 250;

export function renderIndexPlot(container, sequences, labels) {
  container.replaceChildren();
  if (!sequences || sequences.length === 0) return;

  const colorMap = Object.create(null);
  labels.forEach((l, i) => { colorMap[l] = getNodeColor(i); });
  const seqs = sequences.map((s, i) => ({ seq: s, idx: i }));
  seqs.sort((a, b) => b.seq.length - a.seq.length);
  const maxLen = seqs.length > 0 ? seqs[0].seq.length : 0;
  if (maxLen === 0) return;

  const svgWidth = 600;
  const plotWidth = svgWidth - IP_LEFT_MARGIN - IP_RIGHT_MARGIN;
  const cellWidth = plotWidth / maxLen;

  const n = seqs.length;
  const rowTotal = IP_MIN_PLOT_HEIGHT / n;
  const rowGap = Math.min(rowTotal * 0.1, 2);
  const rowHeight = rowTotal - rowGap;
  const plotHeight = n * rowTotal;
  const svgHeight = IP_TOP_MARGIN + plotHeight + IP_BOTTOM_MARGIN + IP_LEGEND_HEIGHT;

  const tickInterval = maxLen <= 20 ? 1 : maxLen <= 50 ? 5 : 10;
  const xTicks = [];
  for (let t = 1; t <= maxLen; t += 1) {
    if (t === 1 || t % tickInterval === 0 || t === maxLen) xTicks.push(t);
  }

  const svg = el('svg', { viewBox: `0 0 ${svgWidth} ${svgHeight}`, width: '100%', style: 'display:block' });

  svg.appendChild(el('text', {
    x: 4, y: IP_TOP_MARGIN + plotHeight / 2,
    'text-anchor': 'middle', 'dominant-baseline': 'central',
    fill: 'var(--tna-svg-axis, #6b7280)', 'font-size': 9,
    transform: `rotate(-90, 4, ${IP_TOP_MARGIN + plotHeight / 2})`,
  }, [`Sequences (${n})`]));

  seqs.forEach((item, rowIdx) => {
    const y = IP_TOP_MARGIN + rowIdx * rowTotal;
    item.seq.forEach((action, t) => {
      const rect = el('rect', {
        x: IP_LEFT_MARGIN + t * cellWidth, y,
        width: Math.max(cellWidth - 0.3, 0.5), height: rowHeight,
        fill: colorMap[action] || '#555',
      });
      const title = el('title');
      title.textContent = `Seq ${item.idx + 1}, step ${t + 1}: ${action}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
  });

  for (const t of xTicks) {
    const x = IP_LEFT_MARGIN + (t - 0.5) * cellWidth;
    svg.appendChild(el('text', {
      x, y: IP_TOP_MARGIN + plotHeight + 14, 'text-anchor': 'middle',
      fill: 'var(--tna-svg-axis, #6b7280)', 'font-size': 9,
    }, [String(t)]));
  }

  svg.appendChild(el('text', {
    x: IP_LEFT_MARGIN + plotWidth / 2, y: IP_TOP_MARGIN + plotHeight + 26,
    'text-anchor': 'middle', fill: 'var(--tna-svg-label, #6b7280)', 'font-size': 10,
  }, ['Timestep']));

  labels.forEach((label, i) => {
    const legendX = IP_LEFT_MARGIN + i * 90;
    const legendY = svgHeight - IP_LEGEND_HEIGHT + 8;
    if (legendX + 80 > svgWidth) return;
    svg.appendChild(el('rect', { x: legendX, y: legendY, width: 10, height: 10, fill: colorMap[label] || '#888', rx: 2 }));
    svg.appendChild(el('text', {
      x: legendX + 14, y: legendY + 5, 'dominant-baseline': 'central',
      fill: 'var(--tna-svg-label, #6b7280)', 'font-size': 9,
    }, [label.length > 10 ? `${label.slice(0, 9)}…` : label]));
  });

  container.appendChild(svg);
}
