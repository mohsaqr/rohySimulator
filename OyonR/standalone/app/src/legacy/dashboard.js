// Verbatim port of standalone/logs-dashboard.js render functions.
// Only mechanical change: every `els.xxx` global lookup is replaced with an
// argument passed by the caller. Algorithms, colors, dimensions, copy text
// unchanged. Do not "improve" the math here — cross-references against the
// legacy dashboard depend on byte-identical numerics.

import { tna, centralities, stateFrequencies, discoverPatterns } from 'legacy-dynajs';
import { renderNetworkGraph } from 'legacy-tna/NetworkGraph.js';
import { renderDistributionPlot, renderIndexPlot } from 'legacy-tna/SequencePlots.js';
import { enrichWindowsWithDynamics } from 'oyon';
import { EMOTION_COLORS as SHARED_EMOTION_COLORS, emotionColor } from '@/lib/emotionColors';

// Palette unified onto the single in-app source (src/lib/emotionColors.ts).
// Re-exported under the original name so dashboard.d.ts and any caller that
// reads EMOTION_COLORS keep working. This is the one place the legacy-ported
// renderers and the live shell now agree on color — see plan Stage 1.
export const EMOTION_COLORS = SHARED_EMOTION_COLORS;

export const NAMED_3x3_ZONES = [
  'top_left', 'top_center', 'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

// ─── Pure helpers ────────────────────────────────────────────────────────

export function parseTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSessionId(item) {
  return String(item?.context?.session_id || item?.session_id || '').trim();
}

export function normalizedEmotion(value) {
  if (!value) return '';
  return String(value).toLowerCase().replace(/\s+/g, '-');
}

export function titleCase(value) {
  if (!value) return '-';
  return String(value).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normAffect(value) {
  if (!Number.isFinite(value)) return null;
  return (Math.max(-1, Math.min(1, value)) + 1) / 2;
}

export function percent(value) {
  if (!Number.isFinite(value)) return '-';
  return `${Math.round(clamp01(value) * 100)}%`;
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function colorFor(label) {
  // normalizedEmotion stays the canonical key form (used elsewhere for state
  // grouping); emotionColor() resolves it against the shared palette with the
  // same '#94a3b8' fallback the legacy renderers expected.
  return emotionColor(normalizedEmotion(label));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

export function shortDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shannonEntropy(probs) {
  let h = 0;
  for (const p of probs) {
    if (!Number.isFinite(p) || p <= 0) continue;
    h -= p * Math.log2(p);
  }
  return h;
}

function viridisLike(t) {
  const stops = [
    [0.0, [11, 18, 32]],
    [0.18, [40, 27, 87]],
    [0.40, [33, 145, 140]],
    [0.65, [94, 201, 98]],
    [0.85, [253, 231, 37]],
    [1.0, [255, 240, 200]],
  ];
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i += 1) {
    if (clamped <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (clamped - t0) / Math.max(1e-9, t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return 'rgb(255, 240, 200)';
}

function zoneKeyToCenter(key, gridN) {
  if (NAMED_3x3_ZONES.includes(key)) {
    const i = NAMED_3x3_ZONES.indexOf(key);
    const row = Math.floor(i / 3);
    const col = i % 3;
    return { x: ((col + 0.5) / 3) - 0.5, y: ((row + 0.5) / 3) - 0.5 };
  }
  const m = /^r(\d+)c(\d+)$/.exec(key);
  if (!m) return null;
  const row = Number(m[1]);
  const col = Number(m[2]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { x: ((col + 0.5) / gridN) - 0.5, y: ((row + 0.5) / gridN) - 0.5 };
}

function enumerateZoneKeys(gridN) {
  if (gridN === 3) return NAMED_3x3_ZONES.slice();
  const out = [];
  for (let r = 0; r < gridN; r += 1) {
    for (let c = 0; c < gridN; c += 1) out.push(`r${r}c${c}`);
  }
  return out;
}

function centroidToZoneKey(centroid, gridN) {
  const xn = Math.min(0.4999, Math.max(-0.4999, centroid.x));
  const yn = Math.min(0.4999, Math.max(-0.4999, centroid.y));
  const col = Math.floor((xn + 0.5) * gridN);
  const row = Math.floor((yn + 0.5) * gridN);
  if (gridN === 3) {
    const i = row * 3 + col;
    return NAMED_3x3_ZONES[i];
  }
  return `r${row}c${col}`;
}

function shortZoneLabel(key) {
  const named = {
    top_left: 'TL', top_center: 'TC', top_right: 'TR',
    middle_left: 'ML', middle_center: 'MC', middle_right: 'MR',
    bottom_left: 'BL', bottom_center: 'BC', bottom_right: 'BR',
  };
  if (named[key]) return named[key];
  return key;
}

function parseGazeTime(window) {
  if (window._time && Number.isFinite(window._time)) return window._time;
  const iso = window.gaze?.window_end || window.window_end;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function confidenceColor(confidence) {
  if (confidence === 'measured') return 'rgba(22, 163, 74, 0.55)';
  if (confidence === 'inferred') return 'rgba(217, 119, 6, 0.55)';
  return 'rgba(156, 163, 175, 0.55)';
}

function formatGazeCalibration(g) {
  if (!g || !Number.isFinite(g.calibration_age_ms)) return 'not calibrated';
  const conf = g.calibration_confidence || 'unknown';
  const qPart = Number.isFinite(g.calibration_quality)
    ? `q ${Number(g.calibration_quality).toFixed(2)} · ${conf}`
    : conf === 'unknown' ? 'quality unknown' : conf;
  return `${qPart} · ${(g.calibration_age_ms / 1000).toFixed(0)} s ago`;
}

function formatGazeCentroid(centroid) {
  if (!centroid || typeof centroid !== 'object') return '—';
  const x = Number(centroid.x);
  const y = Number(centroid.y);
  return Number.isFinite(x) && Number.isFinite(y)
    ? `${x.toFixed(2)}, ${y.toFixed(2)}`
    : '—';
}

// ─── Canvas helpers (verbatim) ───────────────────────────────────────────

function setupCanvas(canvas) {
  const ratio = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || canvas.width);
  const height = Math.max(220, rect.height || canvas.height);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function themeColor(name, fallback) {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function clearCanvas(ctx) {
  const width = ctx.canvas.width / (devicePixelRatio || 1);
  const height = ctx.canvas.height / (devicePixelRatio || 1);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeColor('--canvas-bg', '#f5f5f5');
  ctx.fillRect(0, 0, width, height);
}

function plotArea(ctx) {
  const width = ctx.canvas.width / (devicePixelRatio || 1);
  const height = ctx.canvas.height / (devicePixelRatio || 1);
  return { x: 42, y: 28, w: width - 66, h: height - 56 };
}

function drawAxes(ctx, plot) {
  ctx.strokeStyle = themeColor('--canvas-axis', 'rgba(0,0,0,0.14)');
  ctx.lineWidth = 1;
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y + plot.h / 2);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h / 2);
  ctx.stroke();
}

function drawLine(ctx, plot, rows, xFn, yFn, color) {
  const valid = rows
    .map((row) => ({ x: xFn(row), y: yFn(row) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  valid.forEach((p, i) => {
    const x = plot.x + p.x * plot.w;
    const y = plot.y + (1 - clamp01(p.y)) * plot.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawLegend(ctx, items, x, y) {
  ctx.font = '12px ui-sans-serif, system-ui';
  items.forEach(([label, color], i) => {
    const yy = y + i * 18;
    ctx.fillStyle = color;
    ctx.fillRect(x, yy - 9, 10, 10);
    ctx.fillStyle = themeColor('--canvas-label', '#374151');
    ctx.fillText(label, x + 16, yy);
  });
}

function drawNoData(ctx, text) {
  const width = ctx.canvas.width / (devicePixelRatio || 1);
  const height = ctx.canvas.height / (devicePixelRatio || 1);
  ctx.fillStyle = themeColor('--canvas-muted', '#6b7280');
  ctx.font = '13px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
  ctx.textAlign = 'left';
}

// ─── DOM helpers ─────────────────────────────────────────────────────────

function tdNode(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function emotionCell(label) {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '6px';
  const swatch = document.createElement('span');
  swatch.style.display = 'inline-block';
  swatch.style.width = '10px';
  swatch.style.height = '10px';
  swatch.style.borderRadius = '50%';
  swatch.style.background = colorFor(label);
  wrap.append(swatch, document.createTextNode(titleCase(label)));
  return wrap;
}

function tableEmpty(colspan, text) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = colspan;
  cell.style.padding = '14px';
  cell.style.textAlign = 'center';
  cell.style.color = 'var(--ink-3)';
  cell.textContent = text;
  row.append(cell);
  return row;
}

// ─── Window enrichment ──────────────────────────────────────────────────

/**
 * Map raw localStorage / IDB rows into the shape the legacy renderers expect:
 * adds `_time`, ensures `dynamics`, etc. Pass any array of windows in; get
 * the legacy-shaped array out.
 */
export function enrichWindows(rawWindows) {
  const enrichedSource = enrichWindowsWithDynamics(rawWindows);
  return rawWindows.map((window, index) => ({
    ...window,
    dynamics: window.dynamics || enrichedSource[index]?.dynamics || null,
    _kind: 'window',
    _id: `window-${index}-${window.window_end || ''}`,
    _time: parseTime(window.window_end || window.timestamp),
  }));
}

// ─── Sequence + TNA computation (verbatim) ──────────────────────────────

export function buildSequencesFromWindows(windows) {
  // A transition is state → state. We build one time-ordered sequence
  // across every window (sessions don't fragment the chain). dynajs
  // computes transitions on consecutive states in this sequence.
  const sorted = windows
    .slice()
    .sort((a, b) => parseTime(a.window_end || a.timestamp) - parseTime(b.window_end || b.timestamp));
  const states = sorted.map((w) => normalizedEmotion(w.dominant_emotion) || 'insufficient');
  return states.length > 0 ? [states] : [];
}

export function computeTna(windows) {
  return computeTnaFromSequences(buildSequencesFromWindows(windows));
}

// Same TNA pipeline over caller-built sequences. The sequence dashboard
// uses this with one chain per session (lib/tnaPooling.js) so aggregating
// distinct sessions never fabricates a cross-session transition; dynajs
// tna() pools transition counts across the sequences array.
export function computeTnaFromSequences(sequences) {
  if (!sequences.length) return null;
  let model;
  try {
    model = tna(sequences);
  } catch (err) {
    console.warn('[oyon] tna() failed', err);
    return null;
  }
  let centrality = null;
  try {
    centrality = centralities(model, { loops: true, normalize: true });
  } catch (err) {
    console.warn('[oyon] centralities() failed', err);
  }
  const freq = stateFrequencies(sequences);
  let patterns = { patterns: [] };
  try {
    patterns = discoverPatterns(sequences, { type: 'ngram', len: [2, 3], minFreq: 2 });
  } catch (err) {
    console.warn('[oyon] discoverPatterns() failed', err);
  }
  return { sequences, model, centrality, freq, patterns };
}

// ─── KPI groups ─────────────────────────────────────────────────────────

export function summarizeKpis(windows, logs = [], metrics = []) {
  const latestWindow = windows[windows.length - 1] || null;
  const errors = logs.filter((e) => e.level === 'error').length;
  const warnings = logs.filter((e) => e.level === 'warn').length;
  const latestQuality = latestWindow ? percent(1 - (latestWindow.missing_face_ratio || 0)) : '-';
  const latestEmotion = titleCase(latestWindow?.dominant_emotion || '-');
  const latestLatency = metrics
    .slice()
    .reverse()
    .find((m) => m.metric_name === 'oyon.sample.duration');
  return {
    events: logs.length,
    metrics: metrics.length,
    windows: windows.length,
    errors,
    warnings,
    latestQuality,
    analyzedWindows: windows.filter((w) => w.dynamics).length,
    latestState: latestEmotion,
    affectSpeed: formatNumber(latestWindow?.dynamics?.affect_speed),
    instability: formatNumber(latestWindow?.dynamics?.instability_score),
    phase: titleCase(latestWindow?.dynamics?.phase_quadrant || '-'),
    sampleLatency: latestLatency ? `${formatNumber(latestLatency.metric_value)} ms` : '-',
  };
}

// ─── Affect / emotion stream renderers ──────────────────────────────────

export function drawTimeline(canvas, windows) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  if (!windows.length) return drawNoData(ctx, 'No emotion windows');
  const plot = plotArea(ctx);
  drawAxes(ctx, plot);
  const minT = Math.min(...windows.map((w) => w._time));
  const maxT = Math.max(...windows.map((w) => w._time));
  const denom = Math.max(1, maxT - minT);
  const sorted = windows.slice().sort((a, b) => a._time - b._time);
  const valenceColor = themeColor('--plot-valence', '#16a34a');
  const arousalColor = themeColor('--plot-arousal', '#2563eb');
  drawLine(ctx, plot, sorted, (i) => (i._time - minT) / denom, (i) => normAffect(i.valence), valenceColor, 'Valence');
  drawLine(ctx, plot, sorted, (i) => (i._time - minT) / denom, (i) => normAffect(i.arousal), arousalColor, 'Arousal');
  drawLegend(ctx, [['Valence', valenceColor], ['Arousal', arousalColor]], plot.x + 10, plot.y + 10);
}

export function drawDistribution(canvas, windows) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  const counts = countBy(windows, (w) => normalizedEmotion(w.dominant_emotion) || 'insufficient');
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) return drawNoData(ctx, 'No distribution');
  const plot = plotArea(ctx);
  const max = Math.max(...entries.map(([, c]) => c), 1);
  const barGap = 8;
  const barH = Math.max(14, (plot.h - barGap * (entries.length - 1)) / entries.length);
  ctx.font = '12px ui-sans-serif, system-ui';
  entries.forEach(([label, count], i) => {
    const y = plot.y + i * (barH + barGap);
    const width = (count / max) * (plot.w - 130);
    ctx.fillStyle = colorFor(label);
    ctx.fillRect(plot.x + 120, y, width, barH);
    ctx.fillStyle = themeColor('--canvas-label', '#374151');
    ctx.fillText(titleCase(label), plot.x, y + barH - 4);
    ctx.fillStyle = themeColor('--canvas-muted', '#6b7280');
    ctx.fillText(String(count), plot.x + 126 + width, y + barH - 4);
  });
}

export function drawNetwork(container, result) {
  container.replaceChildren();
  if (!result || !result.model) {
    const empty = document.createElement('div');
    empty.style.padding = '32px';
    empty.style.color = '#6b7280';
    empty.style.fontSize = '13px';
    empty.style.textAlign = 'center';
    empty.textContent = 'No transitions';
    container.append(empty);
    return { nodes: 0, edges: 0 };
  }
  const labels = result.model.labels;
  const weights = result.model.weights;
  let edgeCount = 0;
  for (let i = 0; i < weights.rows; i += 1) {
    for (let j = 0; j < weights.cols; j += 1) {
      if (weights.get(i, j) > 0) edgeCount += 1;
    }
  }
  renderNetworkGraph(container, result.model, {
    svgWidth: 960,
    graphHeight: 500,
    nodeRadius: 25,
    showSelfLoops: true,
    showEdgeLabels: true,
    edgeColor: '#1f2937',
    arrowColor: '#0f172a',
    edgeLabelFontSize: 11,
  });
  return { nodes: labels.length, edges: edgeCount };
}

export function drawDynamics(canvas, windows) {
  const rows = windows.filter((w) => w.dynamics);
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  if (!rows.length) return drawNoData(ctx, 'No dynamics');
  const plot = plotArea(ctx);
  drawAxes(ctx, plot);
  const minT = Math.min(...rows.map((w) => w._time));
  const maxT = Math.max(...rows.map((w) => w._time));
  const denom = Math.max(1, maxT - minT);
  drawLine(ctx, plot, rows, (i) => (i._time - minT) / denom, (i) => i.dynamics.affect_speed, '#db2777', 'Speed');
  drawLine(ctx, plot, rows, (i) => (i._time - minT) / denom, (i) => i.dynamics.instability_score, '#d97706', 'Instability');
  drawLegend(ctx, [['Speed', '#db2777'], ['Instability', '#d97706']], plot.x + 10, plot.y + 10);
}

export function drawSequenceDistribution(canvas, result) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  if (!result || !result.freq) return drawNoData(ctx, 'No sequence yet');
  const entries = Object.entries(result.freq).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = entries.reduce((s, [, c]) => s + c, 0) || 1;
  if (!entries.length) return drawNoData(ctx, 'No sequence yet');
  const plot = plotArea(ctx);
  const max = Math.max(...entries.map(([, c]) => c), 1);
  const barGap = 8;
  const barH = Math.max(14, (plot.h - barGap * (entries.length - 1)) / entries.length);
  ctx.font = '12px ui-sans-serif, system-ui';
  entries.forEach(([label, count], i) => {
    const y = plot.y + i * (barH + barGap);
    const width = (count / max) * (plot.w - 150);
    ctx.fillStyle = colorFor(label);
    ctx.fillRect(plot.x + 130, y, width, barH);
    ctx.fillStyle = themeColor('--canvas-label', '#374151');
    ctx.fillText(titleCase(label), plot.x, y + barH - 4);
    ctx.fillStyle = themeColor('--canvas-muted', '#6b7280');
    const pct = ((count / total) * 100).toFixed(1);
    ctx.fillText(`${count} (${pct}%)`, plot.x + 136 + width, y + barH - 4);
  });
}

export function renderCentralityTable(tbody, result) {
  tbody.replaceChildren();
  if (!result || !result.centrality) {
    tbody.append(tableEmpty(5, 'No centralities yet.'));
    return;
  }
  const { labels, measures } = result.centrality;
  if (!labels.length) {
    tbody.append(tableEmpty(5, 'No centralities yet.'));
    return;
  }
  const ranked = labels
    .map((label, i) => ({
      label,
      InStrength: measures.InStrength?.[i] ?? 0,
      OutStrength: measures.OutStrength?.[i] ?? 0,
      Closeness: measures.Closeness?.[i] ?? 0,
      Betweenness: measures.Betweenness?.[i] ?? 0,
    }))
    .sort((a, b) => b.InStrength - a.InStrength);
  for (const row of ranked) {
    const tr = document.createElement('tr');
    const labelCell = document.createElement('td');
    labelCell.append(emotionCell(row.label));
    tr.append(
      labelCell,
      tdNode(formatNumber(row.InStrength)),
      tdNode(formatNumber(row.OutStrength)),
      tdNode(formatNumber(row.Closeness)),
      tdNode(formatNumber(row.Betweenness)),
    );
    tbody.append(tr);
  }
}

export function renderPatternsTable(tbody, result) {
  tbody.replaceChildren();
  const patterns = result?.patterns?.patterns || [];
  if (!patterns.length) {
    tbody.append(tableEmpty(4, 'No patterns with frequency >= 2 yet.'));
    return;
  }
  const top = patterns.slice(0, 12);
  for (const p of top) {
    const tr = document.createElement('tr');
    tr.append(
      tdNode(p.pattern),
      tdNode(String(p.length)),
      tdNode(String(p.count ?? p.frequency)),
      tdNode(typeof p.support === 'number' ? p.support.toFixed(2) : '-'),
    );
    tbody.append(tr);
  }
}

export function renderMatrixHeatmap(container, result) {
  container.replaceChildren();
  if (!result || !result.model) return;
  const labels = result.model.labels;
  const weights = result.model.weights;
  if (!labels.length) return;
  const table = document.createElement('table');
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '11px';
  const head = document.createElement('tr');
  const empty = document.createElement('th');
  empty.textContent = '';
  head.append(empty);
  for (const label of labels) {
    const th = document.createElement('th');
    th.textContent = titleCase(label);
    th.style.padding = '4px 6px';
    th.style.color = 'var(--ink-2)';
    head.append(th);
  }
  table.append(head);
  for (let i = 0; i < weights.rows; i += 1) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.textContent = titleCase(labels[i]);
    rowHead.style.padding = '4px 6px';
    rowHead.style.color = 'var(--ink-2)';
    rowHead.style.textAlign = 'right';
    tr.append(rowHead);
    for (let j = 0; j < weights.cols; j += 1) {
      const value = weights.get(i, j);
      const cell = document.createElement('td');
      cell.textContent = value === 0 ? '·' : value.toFixed(2);
      cell.style.padding = '4px 6px';
      cell.style.textAlign = 'center';
      const intensity = Math.min(1, value);
      cell.style.background = `rgba(96, 165, 250, ${(intensity * 0.7).toFixed(3)})`;
      cell.style.color = intensity > 0.55 ? '#ffffff' : 'var(--ink-0)';
      tr.append(cell);
    }
    table.append(tr);
  }
  container.append(table);
}

export function renderIndexPlotPanel(container, result) {
  if (!result || !result.sequences || !result.model) {
    container.replaceChildren();
    return;
  }
  renderIndexPlot(container, result.sequences, result.model.labels);
}

export function renderDistributionPlotPanel(container, result) {
  if (!result || !result.sequences || !result.model) {
    container.replaceChildren();
    return;
  }
  renderDistributionPlot(container, result.sequences, result.model.labels);
}

export function renderSequenceSummary(wrap, result) {
  if (!result || !result.sequences) {
    wrap.replaceChildren();
    return;
  }
  const sequences = result.sequences;
  const labels = result.model.labels;
  const lengths = sequences.map((s) => s.length);
  const totalSteps = lengths.reduce((s, n) => s + n, 0);
  const meanLen = lengths.length ? totalSteps / lengths.length : 0;

  const stateCounts = Object.create(null);
  for (const seq of sequences) for (const s of seq) stateCounts[s] = (stateCounts[s] || 0) + 1;
  const stateProps = labels.map((l) => (stateCounts[l] || 0) / Math.max(1, totalSteps));
  const entropy = shannonEntropy(stateProps);
  const normalisedEntropy = labels.length > 1 ? entropy / Math.log2(labels.length) : 0;

  const spellsByState = Object.create(null);
  for (const seq of sequences) {
    let prev = null;
    let runLen = 0;
    for (const s of seq) {
      if (s === prev) runLen += 1;
      else {
        if (prev !== null) (spellsByState[prev] = spellsByState[prev] || []).push(runLen);
        prev = s;
        runLen = 1;
      }
    }
    if (prev !== null) (spellsByState[prev] = spellsByState[prev] || []).push(runLen);
  }

  const spellRows = labels
    .map((label) => {
      const arr = spellsByState[label] || [];
      return {
        label,
        count: arr.length,
        mean: arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0,
        max: arr.length ? Math.max(...arr) : 0,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  wrap.replaceChildren();
  const stats = document.createElement('div');
  stats.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;';
  stats.append(
    summaryTile('Sequences', String(sequences.length)),
    summaryTile('Mean length', meanLen.toFixed(1)),
    summaryTile('Max length', String(Math.max(0, ...lengths))),
    summaryTile('Distinct states', String(labels.length)),
    summaryTile('Shannon H (bits)', entropy.toFixed(2)),
    summaryTile('H normalised', normalisedEntropy.toFixed(2)),
  );
  wrap.append(stats);

  if (spellRows.length) {
    const heading = document.createElement('div');
    heading.textContent = 'Spell statistics';
    heading.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-2);margin-bottom:6px;';
    wrap.append(heading);
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
    table.innerHTML = '<thead><tr><th>State</th><th style="width:80px;">Spells</th><th style="width:110px;">Mean length</th><th style="width:90px;">Max length</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const row of spellRows) {
      const tr = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.append(emotionCell(row.label));
      tr.append(
        labelCell,
        tdNode(String(row.count)),
        tdNode(row.mean.toFixed(2)),
        tdNode(String(row.max)),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  }
}

function summaryTile(label, value) {
  const tile = document.createElement('div');
  tile.style.cssText = 'padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface-1);';
  const labelNode = document.createElement('div');
  labelNode.textContent = label;
  labelNode.style.cssText = 'font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:0.06em;';
  const valueNode = document.createElement('div');
  valueNode.textContent = value;
  valueNode.style.cssText = 'font-size:18px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums;';
  tile.append(labelNode, valueNode);
  return tile;
}

// ─── Gaze renderers (verbatim from legacy) ──────────────────────────────

export function summarizeGazeKpis(gazeWindows) {
  if (gazeWindows.length === 0) {
    return {
      windows: 0,
      meanSigma: '—',
      meanValid: '—',
      offScreen: '—',
      calibration: '—',
      samples: 0,
    };
  }
  const sigmas = gazeWindows.map((w) => w.gaze.dispersion).filter(Number.isFinite);
  const validRatios = gazeWindows.map((w) => w.gaze.valid_frame_ratio).filter(Number.isFinite);
  const offScreenRatios = gazeWindows.map((w) => w.gaze.off_screen_ratio).filter(Number.isFinite);
  const totalSamples = gazeWindows.reduce((s, w) => s + (Number(w.gaze.n_points) || 0), 0);

  const meanSigma = sigmas.length ? sigmas.reduce((s, v) => s + v, 0) / sigmas.length : null;
  const meanValid = validRatios.length ? validRatios.reduce((s, v) => s + v, 0) / validRatios.length : null;
  const meanOff = offScreenRatios.length ? offScreenRatios.reduce((s, v) => s + v, 0) / offScreenRatios.length : null;

  // Calibration provenance across the gaze windows: each window carries a
  // `calibration_confidence` of measured (a real calibration measurement backed
  // the quality) / inferred (derived) / unknown (never calibrated). The KPI
  // face shows a HUMAN headline — never the old "0% m · 0% i · 100% u" cipher;
  // the precise split is spelled out in the hint, and only when there's actual
  // provenance to report (otherwise "Not calibrated" already says it all).
  const confCounts = countBy(gazeWindows, (w) => w.gaze.calibration_confidence || 'unknown');
  const totalConf = gazeWindows.length;
  const measured = confCounts.measured || 0;
  const inferred = confCounts.inferred || 0;
  const unknown = confCounts.unknown || 0;
  const pct = (n) => Math.round((n / totalConf) * 100);
  const calibration = gazeCalibrationHeadline(measured, inferred, unknown, totalConf);
  const calibrationDetail = measured + inferred > 0
    ? `measured ${pct(measured)}% · inferred ${pct(inferred)}% · unknown ${pct(unknown)}%`
    : null;
  return {
    windows: gazeWindows.length,
    meanSigma: meanSigma == null ? '—' : meanSigma.toFixed(3),
    meanValid: meanValid == null ? '—' : `${Math.round(meanValid * 100)}%`,
    offScreen: meanOff == null ? '—' : `${Math.round(meanOff * 100)}%`,
    calibration,
    calibrationDetail,
    samples: totalSamples,
  };
}

// Collapse the measured/inferred/unknown counts to one human label for the KPI
// face. Uniform → a plain word; mixed → lead with the share backed by a real
// measurement (the honest trust signal), else the dominant provenance.
function gazeCalibrationHeadline(measured, inferred, unknown, total) {
  if (total === 0) return '—';
  if (unknown === total) return 'Not calibrated';
  if (measured === total) return 'Measured';
  if (inferred === total) return 'Inferred';
  const pct = (n) => Math.round((n / total) * 100);
  if (measured > 0) return `${pct(measured)}% measured`;
  if (inferred > 0) return `${pct(inferred)}% inferred`;
  return 'Not calibrated';
}

export function renderGazeHeatmap(canvas, legendEl, gazeWindows, aois = []) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  paintViewportBackground(ctx, canvas);

  if (gazeWindows.length === 0) {
    if (legendEl) legendEl.innerHTML = '<span>No data — run a session.</span>';
    drawHeatmapPlaceholder(ctx, canvas);
    return { meta: '0 windows' };
  }

  const zoneTotals = new Map();
  let gridN = 3;
  let totalWindows = 0;
  for (const w of gazeWindows) {
    const zp = w.gaze.zone_proportions;
    if (!zp || typeof zp !== 'object') continue;
    totalWindows += 1;
    for (const [key, value] of Object.entries(zp)) {
      if (!Number.isFinite(value)) continue;
      zoneTotals.set(key, (zoneTotals.get(key) || 0) + Number(value));
      const m = /^r(\d+)c(\d+)$/.exec(key);
      if (m) gridN = Math.max(gridN, Math.max(Number(m[1]), Number(m[2])) + 1);
    }
  }
  if (totalWindows === 0) {
    if (legendEl) legendEl.innerHTML = '<span>No zone_proportions recorded.</span>';
    drawHeatmapPlaceholder(ctx, canvas);
    return { meta: `${gazeWindows.length} windows · no zone data` };
  }
  const zoneCenters = [];
  for (const [key, weight] of zoneTotals.entries()) {
    const center = zoneKeyToCenter(key, gridN);
    if (!center) continue;
    zoneCenters.push({ x: center.x, y: center.y, weight: weight / totalWindows });
  }
  paintDensityField(ctx, canvas, zoneCenters, gridN);
  paintAoiOverlay(ctx, canvas, aois);
  if (legendEl) paintHeatmapLegend(legendEl);
  return { meta: `${gazeWindows.length} windows · ${gridN}×${gridN} zones` };
}

function paintDensityField(ctx, canvas, points, gridN) {
  if (!points.length) return;
  const cssWidth = canvas.width / (devicePixelRatio || 1);
  const cssHeight = canvas.height / (devicePixelRatio || 1);
  const cellPx = 6;
  const sigmaPx = (cssWidth / gridN) * 0.55;
  const invTwoSigma2 = 1 / (2 * sigmaPx * sigmaPx);

  const cols = Math.ceil(cssWidth / cellPx);
  const rows = Math.ceil(cssHeight / cellPx);
  const density = new Float32Array(cols * rows);
  let max = 0;
  for (let r = 0; r < rows; r += 1) {
    const py = (r + 0.5) * cellPx;
    for (let c = 0; c < cols; c += 1) {
      const px = (c + 0.5) * cellPx;
      let v = 0;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const sx = (0.5 + p.x) * cssWidth;
        const sy = (0.5 + p.y) * cssHeight;
        const dx = px - sx;
        const dy = py - sy;
        v += p.weight * Math.exp(-(dx * dx + dy * dy) * invTwoSigma2);
      }
      const idx = r * cols + c;
      density[idx] = v;
      if (v > max) max = v;
    }
  }
  if (max <= 0) return;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      const t = density[idx] / max;
      if (t < 0.02) continue;
      ctx.fillStyle = viridisLike(t);
      ctx.fillRect(c * cellPx, r * cellPx, cellPx + 1, cellPx + 1);
    }
  }
}

function paintAoiOverlay(ctx, canvas, aois) {
  if (!aois?.length) return;
  const cssWidth = canvas.width / (devicePixelRatio || 1);
  const cssHeight = canvas.height / (devicePixelRatio || 1);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.font = '11px ui-sans-serif, system-ui';
  for (const a of aois) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    const x = (0.5 + a.x - a.width / 2) * cssWidth;
    const y = (0.5 + a.y - a.height / 2) * cssHeight;
    const w = a.width * cssWidth;
    const h = a.height * cssHeight;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.strokeRect(x, y, w, h);
    const text = a.id || '';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x + 4, y + 4, tw + 8, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + 8, y + 16);
  }
  ctx.restore();
}

function paintViewportBackground(ctx, canvas) {
  const w = canvas.width / (devicePixelRatio || 1);
  const h = canvas.height / (devicePixelRatio || 1);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawHeatmapPlaceholder(ctx, canvas) {
  const w = canvas.width / (devicePixelRatio || 1);
  const h = canvas.height / (devicePixelRatio || 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '14px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('No gaze data yet — start capture and keep your face in view', w / 2, h / 2);
  ctx.textAlign = 'start';
}

function paintHeatmapLegend(legendEl) {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  const swatches = stops
    .map((t) => `<span style="display:inline-block;width:28px;height:10px;background:${viridisLike(t)};"></span>`)
    .join('');
  legendEl.innerHTML =
    `<span>lower dwell</span>${swatches}<span>higher dwell</span>` +
    `<span style="margin-left: 12px;">white dashed boxes = AOIs</span>`;
}

export function renderGazeScanpath(container, legendEl, gazeWindows, aois = [], options = {}) {
  container.replaceChildren();
  const nodeMetric = options.nodeMetric || 'instrength';
  const edgeMetric = options.edgeMetric || 'counts';
  const showSelfLoops = options.showSelfLoops !== false;

  let gridN = 3;
  for (const w of gazeWindows) {
    const zp = w.gaze?.zone_proportions;
    if (!zp) continue;
    for (const key of Object.keys(zp)) {
      const m = /^r(\d+)c(\d+)$/.exec(key);
      if (m) gridN = Math.max(gridN, Math.max(Number(m[1]), Number(m[2])) + 1);
    }
  }

  // One time-ordered zone chain across every window. Consecutive zone
  // pair = one transition; session boundaries don't fragment it (a
  // transition is state→state, full stop).
  const sorted = gazeWindows
    .filter((w) => w.gaze?.centroid && Number.isFinite(w.gaze.centroid.x) && Number.isFinite(w.gaze.centroid.y))
    .sort((a, b) => parseGazeTime(a) - parseGazeTime(b));
  const zoneSequence = sorted.map((w) => centroidToZoneKey(w.gaze.centroid, gridN));

  const labels = enumerateZoneKeys(gridN);
  const labelToIndex = new Map(labels.map((k, i) => [k, i]));
  const n = labels.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  let totalTransitions = 0;
  for (let i = 1; i < zoneSequence.length; i += 1) {
    const a = labelToIndex.get(zoneSequence[i - 1]);
    const b = labelToIndex.get(zoneSequence[i]);
    if (a == null || b == null) continue;
    matrix[a][b] += 1;
    totalTransitions += 1;
  }

  if (totalTransitions === 0) {
    container.append(makeNetworkEmptyState(
      sorted.length > 0
        ? 'Need at least two windows to draw a transition.'
        : 'No gaze windows yet — start capture and keep your face in view.',
    ));
    return { meta: sorted.length > 0 ? '1 fixation · no transitions yet' : '0 fixations' };
  }

  const inStrength = new Array(n).fill(0);
  const outStrength = new Array(n).fill(0);
  const visits = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      inStrength[j] += matrix[i][j];
      outStrength[i] += matrix[i][j];
    }
  }
  for (const k of zoneSequence) {
    const idx = labelToIndex.get(k);
    if (idx != null) visits[idx] += 1;
  }
  const visitedIndices = labels.map((_, i) => i).filter((i) => visits[i] > 0);
  if (visitedIndices.length === 0) {
    container.append(makeNetworkEmptyState('No gaze windows yet — start capture and keep your face in view.'));
    return { meta: '0 fixations' };
  }
  drawGazeNetworkSvg(container, {
    labels, matrix, inStrength, outStrength, visits, visitedIndices, gridN, aois,
    nodeMetric, edgeMetric, showSelfLoops,
  });
  if (legendEl) paintGazeNetworkLegend(legendEl, nodeMetric, edgeMetric, showSelfLoops);
  return {
    meta: `${visitedIndices.length} zone${visitedIndices.length === 1 ? '' : 's'} · ` +
      `${totalTransitions} transition${totalTransitions === 1 ? '' : 's'} · ${gridN}×${gridN} grid`,
  };
}

function paintGazeNetworkLegend(legendEl, nodeMetric, edgeMetric, showSelfLoops) {
  const nodeDesc = {
    instrength: 'Σ incoming transitions (where attention lands)',
    outstrength: 'Σ outgoing transitions (where attention leaves from)',
    visits: 'window count per zone (raw dwell, no transitions)',
  }[nodeMetric];
  const edgeDesc = edgeMetric === 'probabilities'
    ? 'P(j | i) — row-normalized: of transitions OUT of i, what fraction went to j'
    : 'raw transition counts between consecutive windows';
  legendEl.innerHTML =
    `<strong>node size</strong>: ${nodeMetric} — ${nodeDesc}. ` +
    `<strong>edge width</strong>: ${edgeDesc}. ` +
    `self-loops: ${showSelfLoops ? 'shown' : 'hidden'}.`;
}

function drawGazeNetworkSvg(container, data) {
  const {
    labels, matrix, inStrength, outStrength, visits, gridN, aois,
    nodeMetric, edgeMetric, showSelfLoops,
  } = data;
  const sizeBy =
    nodeMetric === 'outstrength' ? outStrength :
      nodeMetric === 'visits' ? visits : inStrength;
  const W = 960;
  const H = 540;
  const padding = 40;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  // viewBox starts as the full grid; we tighten it after laying out the
  // nodes so the visited region centers in the canvas instead of bunching
  // in whichever quadrant got the attention.
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.display = 'block';
  svg.style.background = '#ffffff';

  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'gaze-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS(ns, 'path');
  arrowPath.setAttribute('d', 'M0 0 L10 5 L0 10 Z');
  arrowPath.setAttribute('fill', '#1f2937');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const gridGroup = document.createElementNS(ns, 'g');
  for (let k = 1; k < gridN; k += 1) {
    const x = padding + ((W - padding * 2) * k) / gridN;
    const vline = document.createElementNS(ns, 'line');
    vline.setAttribute('x1', String(x));
    vline.setAttribute('x2', String(x));
    vline.setAttribute('y1', String(padding));
    vline.setAttribute('y2', String(H - padding));
    vline.setAttribute('stroke', '#e5e7eb');
    vline.setAttribute('stroke-width', '1');
    gridGroup.appendChild(vline);
  }
  for (let k = 1; k < gridN; k += 1) {
    const y = padding + ((H - padding * 2) * k) / gridN;
    const hline = document.createElementNS(ns, 'line');
    hline.setAttribute('x1', String(padding));
    hline.setAttribute('x2', String(W - padding));
    hline.setAttribute('y1', String(y));
    hline.setAttribute('y2', String(y));
    hline.setAttribute('stroke', '#e5e7eb');
    hline.setAttribute('stroke-width', '1');
    gridGroup.appendChild(hline);
  }
  svg.appendChild(gridGroup);

  if (Array.isArray(aois) && aois.length) {
    const aoiGroup = document.createElementNS(ns, 'g');
    for (const a of aois) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      const rect = document.createElementNS(ns, 'rect');
      const cx = padding + (0.5 + a.x) * (W - padding * 2);
      const cy = padding + (0.5 + a.y) * (H - padding * 2);
      const w = a.width * (W - padding * 2);
      const h = a.height * (H - padding * 2);
      rect.setAttribute('x', String(cx - w / 2));
      rect.setAttribute('y', String(cy - h / 2));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('fill', 'rgba(37, 99, 235, 0.06)');
      rect.setAttribute('stroke', '#2563eb');
      rect.setAttribute('stroke-dasharray', '6 4');
      rect.setAttribute('stroke-width', '1.2');
      aoiGroup.appendChild(rect);
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', String(cx - w / 2 + 4));
      label.setAttribute('y', String(cy - h / 2 + 13));
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', '#2563eb');
      label.textContent = a.id;
      aoiGroup.appendChild(label);
    }
    svg.appendChild(aoiGroup);
  }

  const minRadius = 14;
  const maxRadius = 44;
  const maxSize = Math.max(...sizeBy, 1);
  const nodes = labels.map((label, i) => {
    const c = zoneKeyToCenter(label, gridN);
    const cx = padding + (0.5 + (c?.x ?? 0)) * (W - padding * 2);
    const cy = padding + (0.5 + (c?.y ?? 0)) * (H - padding * 2);
    const norm = sizeBy[i] / maxSize;
    const radius = visits[i] === 0
      ? 0
      : Math.max(minRadius * 0.4, minRadius + (maxRadius - minRadius) * Math.sqrt(norm));
    return {
      label, cx, cy, radius, index: i,
      inStrength: inStrength[i],
      outStrength: outStrength[i],
      visits: visits[i],
      sizeMetric: sizeBy[i],
    };
  });

  // Tighten the viewBox to the visited nodes (plus self-loop reach) so
  // the visualization centers and uses the full canvas. The relative
  // spatial layout among visited zones is preserved (we only pan/zoom,
  // not relayout), which matters for "TL is upper-left of MC" reading.
  {
    const visited = nodes.filter((n) => n.radius > 0);
    if (visited.length) {
      // Worst-case self-loop bbox extent for a node of radius r is
      // r + 2*(r+8) = 3r + 16 in the away-from-screen-center direction.
      const margin = (n) => 3 * n.radius + 16;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of visited) {
        const m = margin(n);
        if (n.cx - m < minX) minX = n.cx - m;
        if (n.cy - m < minY) minY = n.cy - m;
        if (n.cx + m > maxX) maxX = n.cx + m;
        if (n.cy + m > maxY) maxY = n.cy + m;
      }
      // Extra padding so labels and arrowheads don't kiss the edge.
      const extra = 8;
      const vx = Math.max(0, minX - extra);
      const vy = Math.max(0, minY - extra);
      const vw = Math.min(W, maxX + extra) - vx;
      const vh = Math.min(H, maxY + extra) - vy;
      // Preserve the 16:9 SVG aspect by inflating the smaller dimension.
      const targetRatio = W / H;
      const currentRatio = vw / Math.max(vh, 1);
      let fvw = vw, fvh = vh, fvx = vx, fvy = vy;
      if (currentRatio > targetRatio) {
        // Too wide: grow height symmetrically.
        const newH = vw / targetRatio;
        fvy = vy - (newH - vh) / 2;
        fvh = newH;
      } else {
        // Too tall: grow width symmetrically.
        const newW = vh * targetRatio;
        fvx = vx - (newW - vw) / 2;
        fvw = newW;
      }
      svg.setAttribute('viewBox', `${fvx} ${fvy} ${fvw} ${fvh}`);
    }
  }

  const weightFor = (i, j) => {
    if (edgeMetric === 'probabilities') {
      const rowSum = outStrength[i] || 0;
      return rowSum > 0 ? matrix[i][j] / rowSum : 0;
    }
    return matrix[i][j];
  };
  let maxWeight = 0;
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = 0; j < labels.length; j += 1) {
      const w = weightFor(i, j);
      if (w > maxWeight) maxWeight = w;
    }
  }
  if (maxWeight <= 0) maxWeight = 1;
  const edgeGroup = document.createElementNS(ns, 'g');
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = 0; j < labels.length; j += 1) {
      const w = weightFor(i, j);
      if (w <= 0) continue;
      if (i === j && !showSelfLoops) continue;
      const src = nodes[i];
      const tgt = nodes[j];
      if (src.radius === 0 || tgt.radius === 0) continue;
      const widthPx = 1 + (w / maxWeight) * 5;
      const opacity = 0.25 + (w / maxWeight) * 0.55;
      if (i === j) {
        const r = src.radius + 8;
        const path = document.createElementNS(ns, 'path');
        const sx = src.cx - r * 0.7;
        const sy = src.cy - r * 0.7;
        const ex = src.cx + r * 0.7;
        const ey = src.cy - r * 0.7;
        path.setAttribute('d', `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#1f2937');
        path.setAttribute('stroke-width', String(widthPx));
        path.setAttribute('stroke-opacity', String(opacity));
        path.setAttribute('marker-end', 'url(#gaze-arrow)');
        edgeGroup.appendChild(path);
      } else {
        const dx = tgt.cx - src.cx;
        const dy = tgt.cy - src.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const x1 = src.cx + ux * src.radius;
        const y1 = src.cy + uy * src.radius;
        const x2 = tgt.cx - ux * (tgt.radius + 6);
        const y2 = tgt.cy - uy * (tgt.radius + 6);
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', '#1f2937');
        line.setAttribute('stroke-width', String(widthPx));
        line.setAttribute('stroke-opacity', String(opacity));
        line.setAttribute('marker-end', 'url(#gaze-arrow)');
        edgeGroup.appendChild(line);
      }
    }
  }
  svg.appendChild(edgeGroup);

  const maxVisits = Math.max(...visits, 1);
  const nodeGroup = document.createElementNS(ns, 'g');
  for (const node of nodes) {
    if (node.radius === 0) continue;
    const t = node.visits / maxVisits;
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(node.cx));
    circle.setAttribute('cy', String(node.cy));
    circle.setAttribute('r', String(node.radius));
    circle.setAttribute('fill', viridisLike(0.15 + 0.75 * t));
    circle.setAttribute('stroke', '#0f172a');
    circle.setAttribute('stroke-width', '1.5');
    const title = document.createElementNS(ns, 'title');
    const activeMetricLabel =
      nodeMetric === 'outstrength' ? 'outstrength' :
        nodeMetric === 'visits' ? 'visits' : 'instrength';
    title.textContent =
      `${node.label}\n` +
      `visits: ${node.visits}\n` +
      `instrength: ${node.inStrength}\n` +
      `outstrength: ${node.outStrength}\n` +
      `(sized by ${activeMetricLabel}; r ∝ √(${activeMetricLabel}/max))`;
    circle.appendChild(title);
    nodeGroup.appendChild(circle);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', String(node.cx));
    label.setAttribute('y', String(node.cy + 4));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '11');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', t > 0.6 ? '#0b1220' : '#ffffff');
    label.textContent = shortZoneLabel(node.label);
    nodeGroup.appendChild(label);
  }
  svg.appendChild(nodeGroup);
  container.append(svg);
}

function makeNetworkEmptyState(text) {
  const div = document.createElement('div');
  div.style.padding = '32px';
  div.style.color = '#6b7280';
  div.style.fontSize = '13px';
  div.style.textAlign = 'center';
  div.textContent = text;
  return div;
}

export function renderGazeZoneRef(root, gazeWindows) {
  if (gazeWindows.length === 0) {
    root.innerHTML = '<div style="padding:24px;color:var(--ink-3);text-align:center;">No gaze windows yet.</div>';
    return { meta: '0 windows' };
  }
  const accum = {};
  let denom = 0;
  for (const w of gazeWindows) {
    const zp = w.gaze.zone_proportions;
    if (!zp || typeof zp !== 'object') continue;
    for (const [key, value] of Object.entries(zp)) {
      if (!Number.isFinite(value)) continue;
      accum[key] = (accum[key] || 0) + Number(value);
    }
    denom += 1;
  }
  if (denom === 0) {
    root.innerHTML = '<div style="padding:24px;color:var(--ink-3);text-align:center;">No zone_proportions recorded.</div>';
    return { meta: `${gazeWindows.length} windows · no zone data` };
  }
  const keysOrdered = NAMED_3x3_ZONES.every((k) => k in accum)
    ? NAMED_3x3_ZONES
    : Object.keys(accum).slice(0, 9);
  const cells = keysOrdered.map((k) => ({ key: k, value: (accum[k] || 0) / denom }));
  const max = Math.max(...cells.map((c) => c.value), 1e-9);
  root.innerHTML = '';
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  grid.style.gap = '3px';
  grid.style.aspectRatio = '1 / 1';
  grid.style.maxWidth = '260px';
  grid.style.margin = '0 auto';
  for (const cell of cells) {
    const tile = document.createElement('div');
    const t = Math.min(1, Math.sqrt(cell.value / max));
    tile.style.background = viridisLike(t);
    tile.style.borderRadius = '3px';
    tile.style.display = 'flex';
    tile.style.alignItems = 'center';
    tile.style.justifyContent = 'center';
    tile.style.flexDirection = 'column';
    tile.style.padding = '6px';
    tile.style.color = t > 0.5 ? '#0b1220' : '#ffffff';
    tile.style.fontVariantNumeric = 'tabular-nums';
    const pct = document.createElement('strong');
    pct.style.fontSize = '14px';
    pct.textContent = `${Math.round(cell.value * 100)}%`;
    const lbl = document.createElement('span');
    lbl.style.fontSize = '9px';
    lbl.style.opacity = '0.85';
    lbl.textContent = cell.key.replace(/_/g, ' ');
    tile.append(pct, lbl);
    grid.append(tile);
  }
  root.append(grid);
  return { meta: `averaged across ${gazeWindows.length}` };
}

export function renderGazeQuality(canvas, gazeWindows) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  if (gazeWindows.length === 0) return drawNoData(ctx, 'No gaze windows');
  const rows = gazeWindows
    .map((w) => ({
      _time: parseGazeTime(w),
      sigma: Number.isFinite(w.gaze.dispersion) ? w.gaze.dispersion : null,
      valid: Number.isFinite(w.gaze.valid_frame_ratio) ? w.gaze.valid_frame_ratio : null,
    }))
    .filter((r) => Number.isFinite(r._time))
    .sort((a, b) => a._time - b._time);
  if (!rows.length) return drawNoData(ctx, 'No timestamped gaze windows');

  const minT = rows[0]._time;
  const maxT = rows[rows.length - 1]._time;
  const denom = Math.max(1, maxT - minT);
  const plot = plotArea(ctx);
  drawAxes(ctx, plot);
  const sigmas = rows.map((r) => r.sigma).filter(Number.isFinite);
  const sigmaMax = sigmas.length ? Math.max(...sigmas) : 0;
  const sigmaDenom = sigmaMax > 0 ? sigmaMax : 1;
  drawLine(ctx, plot, rows, (i) => (i._time - minT) / denom, (i) => (i.sigma == null ? null : i.sigma / sigmaDenom), '#dc2626', 'σ');
  drawLine(ctx, plot, rows, (i) => (i._time - minT) / denom, (i) => i.valid, '#16a34a', 'valid');
  drawLegend(ctx, [[`σ (max ${sigmaMax.toFixed(3)})`, '#dc2626'], ['valid ratio', '#16a34a']], plot.x + 10, plot.y + 10);
}

export function renderGazeAoi(canvas, gazeWindows) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  const totals = {};
  for (const w of gazeWindows) {
    const dwell = w.gaze.aoi_dwell_ms;
    if (!dwell || typeof dwell !== 'object') continue;
    for (const [id, ms] of Object.entries(dwell)) {
      if (!Number.isFinite(ms)) continue;
      totals[id] = (totals[id] || 0) + Number(ms);
    }
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return drawNoData(ctx, 'Define AOIs in the Gaze settings tab');
  const plot = plotArea(ctx);
  const max = Math.max(...entries.map(([, t]) => t), 1);
  const barGap = 8;
  const barH = Math.max(14, (plot.h - barGap * (entries.length - 1)) / entries.length);
  ctx.font = '12px ui-sans-serif, system-ui';
  entries.forEach(([id, total], i) => {
    const y = plot.y + i * (barH + barGap);
    const width = (total / max) * (plot.w - 160);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(plot.x + 150, y, width, barH);
    ctx.fillStyle = themeColor('--canvas-label', '#374151');
    ctx.fillText(id, plot.x, y + barH - 4);
    ctx.fillStyle = themeColor('--canvas-muted', '#6b7280');
    ctx.fillText(`${(total / 1000).toFixed(1)} s`, plot.x + 156 + width, y + barH - 4);
  });
}

export function renderGazeCalibration(canvas, gazeWindows) {
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  if (gazeWindows.length === 0) return drawNoData(ctx, 'No gaze windows');
  const rows = gazeWindows
    .map((w) => ({
      _time: parseGazeTime(w),
      ageMs: Number.isFinite(w.gaze.calibration_age_ms) ? w.gaze.calibration_age_ms : null,
      quality: Number.isFinite(w.gaze.calibration_quality) ? w.gaze.calibration_quality : null,
      confidence: w.gaze.calibration_confidence || 'unknown',
    }))
    .filter((r) => Number.isFinite(r._time))
    .sort((a, b) => a._time - b._time);
  if (!rows.length) return drawNoData(ctx, 'No timestamped windows');

  const minT = rows[0]._time;
  const maxT = rows[rows.length - 1]._time;
  const denom = Math.max(1, maxT - minT);
  const ages = rows.map((r) => r.ageMs).filter(Number.isFinite);
  const ageMax = ages.length ? Math.max(...ages) : 0;
  const ageDenom = ageMax > 0 ? ageMax : 1;
  const plot = plotArea(ctx);

  const ribbonY = plot.y + plot.h - 18;
  const ribbonH = 8;
  for (let i = 0; i < rows.length; i += 1) {
    const xStart = plot.x + ((rows[i]._time - minT) / denom) * plot.w;
    const xEnd = i + 1 < rows.length
      ? plot.x + ((rows[i + 1]._time - minT) / denom) * plot.w
      : plot.x + plot.w;
    ctx.fillStyle = confidenceColor(rows[i].confidence);
    ctx.fillRect(xStart, ribbonY, Math.max(1, xEnd - xStart), ribbonH);
  }
  drawAxes(ctx, plot);
  drawLine(ctx, plot, rows, (i) => (i._time - minT) / denom, (i) => (i.ageMs == null ? null : i.ageMs / ageDenom), '#7c3aed', 'age');
  drawLine(ctx, plot, rows, (i) => (i._time - minT) / denom, (i) => i.quality, '#16a34a', 'quality');
  drawLegend(ctx, [
    [`age (max ${(ageMax / 1000).toFixed(1)} s)`, '#7c3aed'],
    ['quality', '#16a34a'],
    ['measured', '#16a34a'],
    ['inferred', '#d97706'],
    ['unknown', '#9ca3af'],
  ], plot.x + 10, plot.y + 10);
}

export function renderGazeTable(tbody, gazeWindows) {
  tbody.replaceChildren();
  if (!gazeWindows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = 'No gaze data yet. Start capture and keep your face in view.';
    cell.style.padding = '14px';
    cell.style.color = 'var(--ink-3)';
    row.append(cell);
    tbody.append(row);
    return;
  }
  const recent = gazeWindows.slice(-50).reverse();
  for (const w of recent) {
    const g = w.gaze || {};
    const tr = document.createElement('tr');
    tr.append(
      tdNode(shortDateTime(g.window_end || w.window_end)),
      tdNode(String(g.n_points ?? '—')),
      tdNode(g.dispersion == null ? '—' : Number(g.dispersion).toFixed(3)),
      tdNode(formatGazeCentroid(g.centroid)),
      tdNode(g.valid_frame_ratio == null ? '—' : `${Math.round(g.valid_frame_ratio * 100)}%`),
      tdNode(g.off_screen_ratio == null ? '—' : `${Math.round(g.off_screen_ratio * 100)}%`),
      tdNode(formatGazeCalibration(g)),
    );
    tbody.append(tr);
  }
}
