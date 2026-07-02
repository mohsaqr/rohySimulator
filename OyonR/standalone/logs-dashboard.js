import { enrichWindowsWithDynamics } from '../src/analytics/DynamicalFeatures.js';
import { tna, centralities, stateFrequencies, discoverPatterns } from './vendor/dynajs/index.js';
import { renderNetworkGraph } from './vendor/rohy-tna/NetworkGraph.js';
import { renderDistributionPlot, renderIndexPlot } from './vendor/rohy-tna/SequencePlots.js';

const STORAGE = {
  logs: 'standalone-oyon-logs',
  metrics: 'standalone-oyon-metrics',
  windows: 'standalone-fer-events',
  settings: 'standalone-fer-settings',
  dashboard: 'standalone-oyon-dashboard-settings',
};

const TABLE_PAGE_SIZE = 50;

const DEFAULT_UI_SETTINGS = {
  showEvents: false,
  showMetrics: false,
  showWindows: false,
  showDemo: false,
  // Gaze transition network toggles. Defaults match the panel's analytic
  // intent: instrength tells you where attention LANDS; raw counts preserve
  // the actual transition magnitudes; self-loops in are informative because
  // a "loop" means the gaze stayed in the same zone across two windows.
  gazeNodeMetric: 'instrength',     // 'instrength' | 'outstrength' | 'visits'
  gazeEdgeMetric: 'counts',          // 'counts' | 'probabilities'
  gazeShowSelfLoops: true,
};

let uiSettings = loadUiSettings();

function loadUiSettings() {
  try {
    const raw = localStorage.getItem(STORAGE.dashboard);
    return { ...DEFAULT_UI_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

function saveUiSettings() {
  localStorage.setItem(STORAGE.dashboard, JSON.stringify(uiSettings));
}

const els = {
  tabs: document.querySelectorAll('.tab'),
  views: document.querySelectorAll('.view'),
  refresh: document.querySelector('#refresh'),
  toggleEvents: document.querySelector('#toggleEvents'),
  toggleMetrics: document.querySelector('#toggleMetrics'),
  toggleWindows: document.querySelector('#toggleWindows'),
  toggleDemo: document.querySelector('#toggleDemo'),
  demoControls: document.querySelector('#demoControls'),
  demoHidden: document.querySelector('#demoHidden'),
  loadDemo: document.querySelector('#loadDemo'),
  exportWindows: document.querySelector('#exportWindows'),
  exportEvents: document.querySelector('#exportEvents'),
  exportMetrics: document.querySelector('#exportMetrics'),
  exportTna: document.querySelector('#exportTna'),
  clearWindows: document.querySelector('#clearWindows'),
  clearEvents: document.querySelector('#clearEvents'),
  clearMetrics: document.querySelector('#clearMetrics'),
  clearAll: document.querySelector('#clearAll'),
  panelEvents: document.querySelector('#panel-events'),
  panelMetrics: document.querySelector('#panel-metrics'),
  panelWindows: document.querySelector('#panel-windows'),
  search: document.querySelector('#search'),
  level: document.querySelector('#level'),
  emotion: document.querySelector('#emotion'),
  session: document.querySelector('#session'),
  range: document.querySelector('#range'),
  live: document.querySelector('#live'),
  kpis: document.querySelector('#kpis'),
  dynajKpis: document.querySelector('#dynajKpis'),
  timelineMeta: document.querySelector('#timelineMeta'),
  distributionMeta: document.querySelector('#distributionMeta'),
  networkMeta: document.querySelector('#networkMeta'),
  dynamicsMeta: document.querySelector('#dynamicsMeta'),
  eventsMeta: document.querySelector('#eventsMeta'),
  metricsMeta: document.querySelector('#metricsMeta'),
  windowsMeta: document.querySelector('#windowsMeta'),
  timelineChart: document.querySelector('#timelineChart'),
  distributionChart: document.querySelector('#distributionChart'),
  networkChart: document.querySelector('#networkChart'),
  dynamicsChart: document.querySelector('#dynamicsChart'),
  eventsTable: document.querySelector('#eventsTable'),
  metricsTable: document.querySelector('#metricsTable'),
  windowsTable: document.querySelector('#windowsTable'),
  seqDistributionMeta: document.querySelector('#seqDistributionMeta'),
  seqDistributionChart: document.querySelector('#seqDistributionChart'),
  centralityMeta: document.querySelector('#centralityMeta'),
  centralityTable: document.querySelector('#centralityTable'),
  patternsMeta: document.querySelector('#patternsMeta'),
  patternsTable: document.querySelector('#patternsTable'),
  matrixMeta: document.querySelector('#matrixMeta'),
  matrixContainer: document.querySelector('#matrixContainer'),
  indexPlotMeta: document.querySelector('#indexPlotMeta'),
  indexPlotContainer: document.querySelector('#indexPlotContainer'),
  distPlotMeta: document.querySelector('#distPlotMeta'),
  distPlotContainer: document.querySelector('#distPlotContainer'),
  seqSummaryMeta: document.querySelector('#seqSummaryMeta'),
  seqSummary: document.querySelector('#seqSummary'),
  detailsTitle: document.querySelector('#detailsTitle'),
  detailsJson: document.querySelector('#detailsJson'),
  copyDetails: document.querySelector('#copyDetails'),
  // Gaze view
  gazeKpis: document.querySelector('#gazeKpis'),
  gazeHeatChart: document.querySelector('#gazeHeatChart'),
  gazeHeatMeta: document.querySelector('#gazeHeatMeta'),
  gazeHeatLegend: document.querySelector('#gazeHeatLegend'),
  gazeNetworkChart: document.querySelector('#gazeNetworkChart'),
  gazeNetworkLegend: document.querySelector('#gazeNetworkLegend'),
  gazeScanpathMeta: document.querySelector('#gazeScanpathMeta'),
  gazeNodeMetric: document.querySelector('#gazeNodeMetric'),
  gazeEdgeMetric: document.querySelector('#gazeEdgeMetric'),
  gazeShowSelfLoops: document.querySelector('#gazeShowSelfLoops'),
  gazeZoneRef: document.querySelector('#gazeZoneRef'),
  gazeZoneRefMeta: document.querySelector('#gazeZoneRefMeta'),
  gazeQualityChart: document.querySelector('#gazeQualityChart'),
  gazeQualityMeta: document.querySelector('#gazeQualityMeta'),
  gazeAoiChart: document.querySelector('#gazeAoiChart'),
  gazeAoiMeta: document.querySelector('#gazeAoiMeta'),
  gazeCalibChart: document.querySelector('#gazeCalibChart'),
  gazeCalibMeta: document.querySelector('#gazeCalibMeta'),
  gazeTable: document.querySelector('#gazeTable'),
  gazeTableMeta: document.querySelector('#gazeTableMeta'),
  exportGazeCsv: document.querySelector('#exportGazeCsv'),
  exportGazeJson: document.querySelector('#exportGazeJson'),
};

const EMOTION_COLORS = {
  neutral: '#64748b',
  happy: '#16a34a',
  happiness: '#16a34a',
  joy: '#16a34a',
  surprise: '#d97706',
  sad: '#2563eb',
  sadness: '#2563eb',
  anger: '#dc2626',
  angry: '#dc2626',
  fear: '#7c3aed',
  disgust: '#65a30d',
  contempt: '#db2777',
  insufficient: '#9ca3af',
};

const NAMED_3x3_ZONES = [
  'top_left',    'top_center',    'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

let activeView = 'analytics';
let selectedRecord = null;
let cache = readData();
let liveTimer = null;

bindUi();
applyUiSettings();
render();
startLiveTimer();
window.addEventListener('resize', () => renderCharts(currentFiltered()));

function bindUi() {
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  }
  els.refresh.addEventListener('click', () => {
    cache = readData();
    render();
  });
  els.copyDetails.addEventListener('click', copySelectedRecord);
  for (const input of [els.search, els.level, els.emotion, els.session, els.range]) {
    input.addEventListener('input', render);
    input.addEventListener('change', render);
  }
  els.live.addEventListener('change', startLiveTimer);

  els.toggleEvents.addEventListener('change', () => updateUiSetting('showEvents', els.toggleEvents.checked));
  els.toggleMetrics.addEventListener('change', () => updateUiSetting('showMetrics', els.toggleMetrics.checked));
  els.toggleWindows.addEventListener('change', () => updateUiSetting('showWindows', els.toggleWindows.checked));
  els.toggleDemo.addEventListener('change', () => updateUiSetting('showDemo', els.toggleDemo.checked));

  els.loadDemo.addEventListener('click', loadDemoData);
  els.exportWindows.addEventListener('click', () => exportStream('windows'));
  els.exportEvents.addEventListener('click', () => exportStream('events'));
  els.exportMetrics.addEventListener('click', () => exportStream('metrics'));
  els.exportTna.addEventListener('click', () => exportStream('tna'));
  els.clearWindows.addEventListener('click', () => clearStream('windows'));
  els.clearEvents.addEventListener('click', () => clearStream('events'));
  els.clearMetrics.addEventListener('click', () => clearStream('metrics'));
  els.clearAll.addEventListener('click', () => clearStream('all'));

  // Gaze transition network toggles. Each writes through updateUiSetting so
  // it persists, then triggers re-render. We re-run the full chart pipeline
  // (cheap; ~ms for typical session sizes) rather than wiring a partial
  // update path — the consistency win is worth the recompute.
  if (els.gazeNodeMetric) {
    els.gazeNodeMetric.addEventListener('change', () => updateUiSetting('gazeNodeMetric', els.gazeNodeMetric.value));
  }
  if (els.gazeEdgeMetric) {
    els.gazeEdgeMetric.addEventListener('change', () => updateUiSetting('gazeEdgeMetric', els.gazeEdgeMetric.value));
  }
  if (els.gazeShowSelfLoops) {
    els.gazeShowSelfLoops.addEventListener('change', () => updateUiSetting('gazeShowSelfLoops', els.gazeShowSelfLoops.checked));
  }
}

function applyUiSettings() {
  els.toggleEvents.checked = uiSettings.showEvents;
  els.toggleMetrics.checked = uiSettings.showMetrics;
  els.toggleWindows.checked = uiSettings.showWindows;
  els.toggleDemo.checked = uiSettings.showDemo;
  els.panelEvents.hidden = !uiSettings.showEvents;
  els.panelMetrics.hidden = !uiSettings.showMetrics;
  els.panelWindows.hidden = !uiSettings.showWindows;
  els.demoControls.hidden = !uiSettings.showDemo;
  els.demoHidden.hidden = uiSettings.showDemo;
  if (els.gazeNodeMetric) els.gazeNodeMetric.value = uiSettings.gazeNodeMetric;
  if (els.gazeEdgeMetric) els.gazeEdgeMetric.value = uiSettings.gazeEdgeMetric;
  if (els.gazeShowSelfLoops) els.gazeShowSelfLoops.checked = uiSettings.gazeShowSelfLoops;
}

function updateUiSetting(key, value) {
  uiSettings[key] = value;
  saveUiSettings();
  applyUiSettings();
  render();
}

function setView(view) {
  activeView = view;
  for (const tab of els.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  }
  for (const pane of els.views) {
    pane.classList.toggle('hidden', pane.id !== `view-${view}`);
  }
  render();
}

function readData() {
  const logs = readJsonArray(STORAGE.logs).map((event, index) => ({
    ...event,
    _kind: 'event',
    _id: `event-${index}-${event.timestamp || ''}`,
    _time: parseTime(event.timestamp),
  }));
  const metrics = readJsonArray(STORAGE.metrics).map((metric, index) => ({
    ...metric,
    _kind: 'metric',
    _id: `metric-${index}-${metric.timestamp || ''}`,
    _time: parseTime(metric.timestamp),
  }));
  const rawWindows = readJsonArray(STORAGE.windows);
  const enrichedWindows = enrichWindowsWithDynamics(rawWindows);
  const enriched = rawWindows.map((window, index) => ({
    ...window,
    dynamics: window.dynamics || enrichedWindows[index]?.dynamics || null,
    _kind: 'window',
    _id: `window-${index}-${window.window_end || ''}`,
    _time: parseTime(window.window_end || window.timestamp),
  }));
  return {
    logs,
    metrics,
    windows: enriched,
    settings: readJson(STORAGE.settings, {}),
  };
}

function readJsonArray(key) {
  const value = readJson(key, []);
  return Array.isArray(value) ? value : [];
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function render() {
  populateFilters(cache);
  const filtered = currentFiltered();
  renderKpis(filtered);
  renderTables(filtered);
  renderCharts(filtered);
}

function currentFiltered() {
  const query = els.search.value.trim().toLowerCase();
  const level = els.level.value;
  const emotion = els.emotion.value;
  const session = els.session.value;
  const minTime = rangeMinTime(els.range.value);

  const logs = cache.logs.filter(item => {
    if (minTime && item._time < minTime) return false;
    if (level !== 'all' && item.level !== level) return false;
    if (session !== 'all' && getSessionId(item) !== session) return false;
    if (query && !matchesQuery(item, query)) return false;
    return true;
  });

  const metrics = cache.metrics.filter(item => {
    if (minTime && item._time < minTime) return false;
    if (session !== 'all' && getSessionId(item) !== session) return false;
    if (query && !matchesQuery(item, query)) return false;
    return true;
  });

  const windows = cache.windows.filter(item => {
    if (minTime && item._time < minTime) return false;
    if (session !== 'all' && getSessionId(item) !== session) return false;
    if (emotion !== 'all' && normalizedEmotion(item.dominant_emotion) !== emotion) return false;
    if (query && !matchesQuery(item, query)) return false;
    return true;
  });

  return { logs, metrics, windows, settings: cache.settings };
}

function populateFilters(data) {
  const emotionValue = els.emotion.value;
  const sessionValue = els.session.value;
  const emotions = Array.from(new Set(data.windows.map(w => normalizedEmotion(w.dominant_emotion)).filter(Boolean))).sort();
  const sessions = Array.from(new Set([
    ...data.logs.map(getSessionId),
    ...data.metrics.map(getSessionId),
    ...data.windows.map(getSessionId),
  ].filter(Boolean))).sort();

  replaceOptions(els.emotion, [['all', 'All emotions'], ...emotions.map(item => [item, titleCase(item)])], emotionValue);
  replaceOptions(els.session, [['all', 'All sessions'], ...sessions.map(item => [item, item])], sessionValue);
}

function replaceOptions(select, options, current) {
  const next = document.createDocumentFragment();
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    next.appendChild(option);
  }
  select.replaceChildren(next);
  select.value = options.some(([value]) => value === current) ? current : 'all';
}

function renderKpis({ logs, metrics, windows }) {
  const latestWindow = windows[windows.length - 1] || null;
  const errors = logs.filter(e => e.level === 'error').length;
  const warnings = logs.filter(e => e.level === 'warn').length;
  const latestQuality = latestWindow ? percent(1 - (latestWindow.missing_face_ratio || 0)) : '-';
  const latestEmotion = titleCase(latestWindow?.dominant_emotion || '-');
  const latestLatency = latestMetric(metrics, 'oyon.sample.duration');

  els.kpis.replaceChildren(
    kpi('Events', logs.length),
    kpi('Metrics', metrics.length),
    kpi('Emotion windows', windows.length),
    kpi('Errors', errors),
    kpi('Warnings', warnings),
    kpi('Latest quality', latestQuality),
  );

  els.dynajKpis.replaceChildren(
    kpi('Analyzed windows', windows.filter(w => w.dynamics).length),
    kpi('Latest state', latestEmotion),
    kpi('Affect speed', formatNumber(latestWindow?.dynamics?.affect_speed)),
    kpi('Instability', formatNumber(latestWindow?.dynamics?.instability_score)),
    kpi('Phase', phaseLabel(latestWindow?.dynamics?.phase_quadrant) || '-'),
    kpi('Sample latency', latestLatency ? `${formatNumber(latestLatency.metric_value)} ms` : '-'),
  );
}

function kpi(label, value) {
  const node = document.createElement('div');
  node.className = 'kpi';
  const labelNode = document.createElement('span');
  labelNode.textContent = label;
  const valueNode = document.createElement('strong');
  valueNode.textContent = String(value);
  node.append(labelNode, valueNode);
  return node;
}


function renderTables({ logs, metrics, windows }) {
  if (uiSettings.showEvents) {
    els.eventsMeta.textContent = `${logs.length} filtered`;
    renderEventTable(logs);
  }
  if (uiSettings.showMetrics) {
    els.metricsMeta.textContent = `${metrics.length} filtered`;
    renderMetricTable(metrics);
  }
  if (uiSettings.showWindows) {
    els.windowsMeta.textContent = `${windows.length} filtered`;
    renderWindowTable(windows);
  }
}

function renderEventTable(logs) {
  els.eventsTable.replaceChildren();
  if (!logs.length) {
    els.eventsTable.append(tableEmpty(5, 'No matching structured events.'));
    return;
  }
  const recent = logs.slice(-TABLE_PAGE_SIZE).reverse();
  for (const item of recent) {
    const row = tr(item, [
      shortDateTime(item.timestamp),
      pill(item.level || 'info', item.level || 'info'),
      stackText(item.event_name || 'event', summarizeDetails(item.details)),
      contextLine(item),
      item.source || '-',
    ]);
    els.eventsTable.append(row);
  }
  if (logs.length > TABLE_PAGE_SIZE) {
    els.eventsMeta.textContent = `${logs.length} filtered · showing latest ${TABLE_PAGE_SIZE}`;
  }
}

function renderMetricTable(metrics) {
  els.metricsTable.replaceChildren();
  if (!metrics.length) {
    els.metricsTable.append(tableEmpty(5, 'No matching measurements.'));
    return;
  }
  const recent = metrics.slice(-TABLE_PAGE_SIZE).reverse();
  for (const item of recent) {
    const row = tr(item, [
      shortDateTime(item.timestamp),
      stackText(item.metric_name || 'metric', tagsLine(item.tags)),
      formatNumber(item.metric_value),
      contextLine(item),
      item.metric_unit || '-',
    ]);
    els.metricsTable.append(row);
  }
  if (metrics.length > TABLE_PAGE_SIZE) {
    els.metricsMeta.textContent = `${metrics.length} filtered · showing latest ${TABLE_PAGE_SIZE}`;
  }
}

function renderWindowTable(windows) {
  els.windowsTable.replaceChildren();
  if (!windows.length) {
    els.windowsTable.append(tableEmpty(6, 'No matching emotion windows.'));
    return;
  }
  const recent = windows.slice(-TABLE_PAGE_SIZE).reverse();
  for (const item of recent) {
    const label = item.dominant_emotion || 'insufficient';
    const row = tr(item, [
      shortDateTime(item.window_end),
      emotionCell(label),
      percent(item.confidence || 0),
      `${percent(1 - (item.missing_face_ratio || 0))} valid`,
      `v ${formatNumber(item.valence)} | a ${formatNumber(item.arousal)}`,
      stackText(item.model_profile || item.model_name || '-', `valid ${item.valid_frames || 0} / expected ${item.expected_samples || '-'}`),
    ]);
    els.windowsTable.append(row);
  }
  if (windows.length > TABLE_PAGE_SIZE) {
    els.windowsMeta.textContent = `${windows.length} filtered · showing latest ${TABLE_PAGE_SIZE}`;
  }
}


function tr(record, cells) {
  const row = document.createElement('tr');
  row.dataset.id = record._id;
  row.dataset.selected = String(selectedRecord?._id === record._id);
  for (const value of cells) {
    const cell = document.createElement('td');
    if (value instanceof Node) cell.append(value);
    else cell.textContent = value == null ? '-' : String(value);
    row.append(cell);
  }
  row.addEventListener('click', () => selectRecord(record));
  return row;
}

function selectRecord(record) {
  selectedRecord = record;
  els.detailsTitle.textContent = titleForRecord(record);
  els.detailsJson.textContent = JSON.stringify(stripPrivate(record), null, 2);
  document.querySelectorAll('tr[data-id]').forEach(row => {
    row.dataset.selected = String(row.dataset.id === record._id);
  });
}

function titleForRecord(record) {
  if (record._kind === 'event') return record.event_name || 'Event';
  if (record._kind === 'metric') return record.metric_name || 'Metric';
  if (record._kind === 'window') return record.dominant_emotion || 'Emotion window';
  return 'Selected record';
}

function stripPrivate(record) {
  const { _id, _time, _kind, ...rest } = record;
  return rest;
}

async function copySelectedRecord() {
  if (!selectedRecord) return;
  await navigator.clipboard?.writeText(JSON.stringify(stripPrivate(selectedRecord), null, 2));
}

function renderCharts(data) {
  drawTimeline(data.windows);
  drawDistribution(data.windows);
  const tnaResult = computeTna(data.windows);
  drawNetwork(tnaResult);
  drawDynamics(data.windows);
  renderSequenceAnalysis(tnaResult, data.windows);
  renderGazeView(data.windows);
}

function drawTimeline(windows) {
  els.timelineMeta.textContent = `${windows.length} windows`;
  const ctx = setupCanvas(els.timelineChart);
  clearCanvas(ctx);
  if (!windows.length) return drawNoData(ctx, 'No emotion windows');
  const plot = plotArea(ctx);
  drawAxes(ctx, plot);
  const minT = Math.min(...windows.map(w => w._time));
  const maxT = Math.max(...windows.map(w => w._time));
  const denom = Math.max(1, maxT - minT);
  const sorted = windows.slice().sort((a, b) => a._time - b._time);
  drawLine(ctx, plot, sorted, item => (item._time - minT) / denom, item => normAffect(item.valence), '#16a34a', 'Valence');
  drawLine(ctx, plot, sorted, item => (item._time - minT) / denom, item => normAffect(item.arousal), '#2563eb', 'Arousal');
  drawLegend(ctx, [['Valence', '#16a34a'], ['Arousal', '#2563eb']], plot.x + 10, plot.y + 10);
}

function drawDistribution(windows) {
  els.distributionMeta.textContent = `${uniqueCount(windows.map(w => w.dominant_emotion))} states`;
  const ctx = setupCanvas(els.distributionChart);
  clearCanvas(ctx);
  const counts = countBy(windows, w => normalizedEmotion(w.dominant_emotion) || 'insufficient');
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) return drawNoData(ctx, 'No distribution');
  const plot = plotArea(ctx);
  const max = Math.max(...entries.map(([, count]) => count), 1);
  const barGap = 8;
  const barH = Math.max(14, (plot.h - barGap * (entries.length - 1)) / entries.length);
  ctx.font = '12px ui-sans-serif, system-ui';
  entries.forEach(([label, count], index) => {
    const y = plot.y + index * (barH + barGap);
    const width = (count / max) * (plot.w - 130);
    ctx.fillStyle = colorFor(label);
    ctx.fillRect(plot.x + 120, y, width, barH);
    ctx.fillStyle = themeColor('--canvas-label', '#374151');
    ctx.fillText(titleCase(label), plot.x, y + barH - 4);
    ctx.fillStyle = themeColor('--canvas-muted', '#6b7280');
    ctx.fillText(String(count), plot.x + 126 + width, y + barH - 4);
  });
}

function drawNetwork(result) {
  const container = els.networkChart;
  container.replaceChildren();
  if (!result || !result.model) {
    els.networkMeta.textContent = '0 nodes, 0 transitions';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No transitions';
    container.append(empty);
    return;
  }
  const labels = result.model.labels;
  const weights = result.model.weights;
  let edgeCount = 0;
  for (let i = 0; i < weights.rows; i += 1) {
    for (let j = 0; j < weights.cols; j += 1) {
      if (weights.get(i, j) > 0) edgeCount += 1;
    }
  }
  els.networkMeta.textContent = `${labels.length} nodes, ${edgeCount} transitions`;
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
}

function drawDynamics(windows) {
  els.dynamicsMeta.textContent = `${windows.filter(w => w.dynamics).length} dynamics rows`;
  const rows = windows.filter(w => w.dynamics);
  const ctx = setupCanvas(els.dynamicsChart);
  clearCanvas(ctx);
  if (!rows.length) return drawNoData(ctx, 'No dynamics');
  const plot = plotArea(ctx);
  drawAxes(ctx, plot);
  const minT = Math.min(...rows.map(w => w._time));
  const maxT = Math.max(...rows.map(w => w._time));
  const denom = Math.max(1, maxT - minT);
  drawLine(ctx, plot, rows, item => (item._time - minT) / denom, item => item.dynamics.affect_speed, '#db2777', 'Speed');
  drawLine(ctx, plot, rows, item => (item._time - minT) / denom, item => item.dynamics.instability_score, '#d97706', 'Instability');
  drawLegend(ctx, [['Speed', '#db2777'], ['Instability', '#d97706']], plot.x + 10, plot.y + 10);
}

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
    .map(row => ({ x: xFn(row), y: yFn(row) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (valid.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  valid.forEach((point, index) => {
    const x = plot.x + point.x * plot.w;
    const y = plot.y + (1 - clamp01(point.y)) * plot.h;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawLegend(ctx, items, x, y) {
  ctx.font = '12px ui-sans-serif, system-ui';
  items.forEach(([label, color], index) => {
    const yy = y + index * 18;
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

function buildSequencesFromWindows(windows) {
  const bySession = new Map();
  const sorted = windows
    .slice()
    .sort((a, b) => parseTime(a.window_end || a.timestamp) - parseTime(b.window_end || b.timestamp));
  for (const window of sorted) {
    const sid = getSessionId(window) || '__default__';
    const state = normalizedEmotion(window.dominant_emotion) || 'insufficient';
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(state);
  }
  return Array.from(bySession.values()).filter(seq => seq.length > 0);
}

function computeTna(windows) {
  const sequences = buildSequencesFromWindows(windows);
  if (!sequences.length || sequences.every(seq => seq.length < 2)) return null;
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

function renderSequenceAnalysis(result) {
  drawSequenceDistribution(result);
  renderCentralityTable(result);
  renderPatternsTable(result);
  renderMatrixHeatmap(result);
  renderIndexPlotPanel(result);
  renderDistributionPlotPanel(result);
  renderSequenceSummary(result);
}

function renderIndexPlotPanel(result) {
  if (!result || !result.sequences || !result.model) {
    els.indexPlotMeta.textContent = 'no sequences yet';
    els.indexPlotContainer.replaceChildren();
    return;
  }
  els.indexPlotMeta.textContent = `${result.sequences.length} sequence${result.sequences.length === 1 ? '' : 's'}`;
  renderIndexPlot(els.indexPlotContainer, result.sequences, result.model.labels);
}

function renderDistributionPlotPanel(result) {
  if (!result || !result.sequences || !result.model) {
    els.distPlotMeta.textContent = 'no sequences yet';
    els.distPlotContainer.replaceChildren();
    return;
  }
  const maxLen = Math.max(...result.sequences.map(s => s.length));
  els.distPlotMeta.textContent = `up to ${maxLen} timesteps`;
  renderDistributionPlot(els.distPlotContainer, result.sequences, result.model.labels);
}

function renderSequenceSummary(result) {
  if (!result || !result.sequences) {
    els.seqSummaryMeta.textContent = '—';
    els.seqSummary.replaceChildren();
    return;
  }
  const sequences = result.sequences;
  const labels = result.model.labels;
  const lengths = sequences.map(s => s.length);
  const totalSteps = lengths.reduce((sum, n) => sum + n, 0);
  const meanLen = lengths.length ? totalSteps / lengths.length : 0;

  const stateCounts = Object.create(null);
  for (const seq of sequences) for (const s of seq) stateCounts[s] = (stateCounts[s] || 0) + 1;
  const stateProps = labels.map(l => (stateCounts[l] || 0) / Math.max(1, totalSteps));
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

  const spellRows = labels.map(label => {
    const arr = spellsByState[label] || [];
    return {
      label,
      count: arr.length,
      mean: arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : 0,
      max: arr.length ? Math.max(...arr) : 0,
    };
  }).filter(row => row.count > 0).sort((a, b) => b.count - a.count);

  els.seqSummaryMeta.textContent = `${sequences.length} sequences · ${totalSteps} steps`;
  const wrap = els.seqSummary;
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
        td(String(row.count)),
        td(row.mean.toFixed(2)),
        td(String(row.max)),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  }
}

function summaryTile(label, value) {
  const tile = document.createElement('div');
  tile.style.cssText = 'padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg-1);';
  const labelNode = document.createElement('div');
  labelNode.textContent = label;
  labelNode.style.cssText = 'font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:0.06em;';
  const valueNode = document.createElement('div');
  valueNode.textContent = value;
  valueNode.style.cssText = 'font-size:18px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums;';
  tile.append(labelNode, valueNode);
  return tile;
}

function shannonEntropy(probs) {
  let h = 0;
  for (const p of probs) {
    if (!Number.isFinite(p) || p <= 0) continue;
    h -= p * Math.log2(p);
  }
  return h;
}

function drawSequenceDistribution(result) {
  const ctx = setupCanvas(els.seqDistributionChart);
  clearCanvas(ctx);
  if (!result || !result.freq) {
    els.seqDistributionMeta.textContent = '0 states';
    return drawNoData(ctx, 'No sequence yet');
  }
  const entries = Object.entries(result.freq).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  els.seqDistributionMeta.textContent = `${entries.length} states · n=${total}`;
  if (!entries.length) return drawNoData(ctx, 'No sequence yet');
  const plot = plotArea(ctx);
  const max = Math.max(...entries.map(([, count]) => count), 1);
  const barGap = 8;
  const barH = Math.max(14, (plot.h - barGap * (entries.length - 1)) / entries.length);
  ctx.font = '12px ui-sans-serif, system-ui';
  entries.forEach(([label, count], index) => {
    const y = plot.y + index * (barH + barGap);
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

function renderCentralityTable(result) {
  els.centralityTable.replaceChildren();
  if (!result || !result.centrality) {
    els.centralityMeta.textContent = '0 states';
    els.centralityTable.append(tableEmpty(5, 'No centralities yet.'));
    return;
  }
  const { labels, measures } = result.centrality;
  els.centralityMeta.textContent = `${labels.length} states (loops on)`;
  if (!labels.length) {
    els.centralityTable.append(tableEmpty(5, 'No centralities yet.'));
    return;
  }
  const ranked = labels
    .map((label, index) => ({
      label,
      InStrength: measures.InStrength?.[index] ?? 0,
      OutStrength: measures.OutStrength?.[index] ?? 0,
      Closeness: measures.Closeness?.[index] ?? 0,
      Betweenness: measures.Betweenness?.[index] ?? 0,
    }))
    .sort((a, b) => b.InStrength - a.InStrength);
  for (const row of ranked) {
    const tr = document.createElement('tr');
    const labelCell = document.createElement('td');
    labelCell.append(emotionCell(row.label));
    tr.append(
      labelCell,
      td(formatNumber(row.InStrength)),
      td(formatNumber(row.OutStrength)),
      td(formatNumber(row.Closeness)),
      td(formatNumber(row.Betweenness)),
    );
    els.centralityTable.append(tr);
  }
}

function renderPatternsTable(result) {
  els.patternsTable.replaceChildren();
  const patterns = result?.patterns?.patterns || [];
  els.patternsMeta.textContent = patterns.length ? `${patterns.length} discovered` : 'no n-grams yet';
  if (!patterns.length) {
    els.patternsTable.append(tableEmpty(4, 'No patterns with frequency >= 2 yet.'));
    return;
  }
  const top = patterns.slice(0, 12);
  for (const pattern of top) {
    const tr = document.createElement('tr');
    tr.append(
      td(pattern.pattern),
      td(String(pattern.length)),
      td(String(pattern.count ?? pattern.frequency)),
      td(typeof pattern.support === 'number' ? pattern.support.toFixed(2) : '-'),
    );
    els.patternsTable.append(tr);
  }
}

function renderMatrixHeatmap(result) {
  els.matrixContainer.replaceChildren();
  if (!result || !result.model) {
    els.matrixMeta.textContent = 'no transitions';
    return;
  }
  const labels = result.model.labels;
  const weights = result.model.weights;
  els.matrixMeta.textContent = `${labels.length} x ${labels.length}`;
  if (!labels.length) return;
  const table = document.createElement('table');
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '11px';
  const head = document.createElement('tr');
  head.append(emptyCell());
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
  els.matrixContainer.append(table);
}

function td(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function emptyCell() {
  const cell = document.createElement('th');
  cell.textContent = '';
  return cell;
}

function exportStream(kind) {
  const filtered = currentFiltered();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (kind === 'events') {
    downloadJson(`oyon-events-${stamp}.json`, {
      schema_version: 'oyon-local-export-v1',
      exported_at: new Date().toISOString(),
      stream: 'events',
      events: filtered.logs.map(stripPrivate),
    });
  } else if (kind === 'metrics') {
    downloadJson(`oyon-metrics-${stamp}.json`, {
      schema_version: 'oyon-local-export-v1',
      exported_at: new Date().toISOString(),
      stream: 'metrics',
      metrics: filtered.metrics.map(stripPrivate),
    });
  } else if (kind === 'windows') {
    downloadJson(`oyon-emotion-windows-${stamp}.json`, {
      schema_version: 'oyon-local-export-v1',
      exported_at: new Date().toISOString(),
      stream: 'emotion_windows',
      emotion_windows: filtered.windows.map(stripPrivate),
    });
  } else if (kind === 'tna') {
    const result = computeTna(filtered.windows);
    if (!result || !result.model) {
      alert('No TNA model yet. Capture or load demo data first.');
      return;
    }
    const labels = result.model.labels;
    const matrix = labels.map((_, i) => labels.map((__, j) => result.model.weights.get(i, j)));
    downloadJson(`oyon-tna-${stamp}.json`, {
      schema_version: 'oyon-tna-export-v1',
      exported_at: new Date().toISOString(),
      stream: 'tna_analytics',
      labels,
      inits: Array.from(result.model.inits),
      transition_matrix: matrix,
      centralities: result.centrality
        ? {
            labels: result.centrality.labels,
            in_strength: Array.from(result.centrality.measures.InStrength || []),
            out_strength: Array.from(result.centrality.measures.OutStrength || []),
            closeness: Array.from(result.centrality.measures.Closeness || []),
            betweenness: Array.from(result.centrality.measures.Betweenness || []),
          }
        : null,
      state_frequencies: result.freq,
      patterns: result.patterns?.patterns || [],
      sequences: result.sequences,
    });
  }
}

function clearStream(kind) {
  if (kind === 'events') localStorage.removeItem(STORAGE.logs);
  else if (kind === 'metrics') localStorage.removeItem(STORAGE.metrics);
  else if (kind === 'windows') localStorage.removeItem(STORAGE.windows);
  else if (kind === 'all') {
    localStorage.removeItem(STORAGE.logs);
    localStorage.removeItem(STORAGE.metrics);
    localStorage.removeItem(STORAGE.windows);
  }
  cache = readData();
  selectedRecord = null;
  els.detailsTitle.textContent = 'Selected record';
  els.detailsJson.textContent = 'Select a row to inspect the exact stored payload.';
  render();
}

function loadDemoData() {
  const { windows, metrics, events } = generateDemoFixture();
  localStorage.setItem(STORAGE.windows, JSON.stringify(windows));
  localStorage.setItem(STORAGE.metrics, JSON.stringify(metrics));
  localStorage.setItem(STORAGE.logs, JSON.stringify(events));
  cache = readData();
  render();
}

function generateDemoFixture() {
  const sessions = ['demo-session-1', 'demo-session-2', 'demo-session-3'];
  const states = ['neutral', 'happy', 'surprise', 'sad', 'anger', 'fear'];
  const transitionTendencies = {
    neutral:  { neutral: 0.55, happy: 0.20, surprise: 0.10, sad: 0.10, anger: 0.03, fear: 0.02 },
    happy:    { neutral: 0.25, happy: 0.55, surprise: 0.10, sad: 0.05, anger: 0.02, fear: 0.03 },
    surprise: { neutral: 0.30, happy: 0.30, surprise: 0.20, sad: 0.10, anger: 0.05, fear: 0.05 },
    sad:      { neutral: 0.25, happy: 0.10, surprise: 0.05, sad: 0.50, anger: 0.05, fear: 0.05 },
    anger:    { neutral: 0.15, happy: 0.05, surprise: 0.10, sad: 0.20, anger: 0.45, fear: 0.05 },
    fear:     { neutral: 0.20, happy: 0.05, surprise: 0.15, sad: 0.20, anger: 0.10, fear: 0.30 },
  };

  function pickNext(prev) {
    const probs = transitionTendencies[prev] || transitionTendencies.neutral;
    const r = Math.random();
    let acc = 0;
    for (const [state, p] of Object.entries(probs)) {
      acc += p;
      if (r <= acc) return state;
    }
    return states[states.length - 1];
  }

  function valenceArousal(state) {
    const map = {
      neutral:  [0.0,   0.0],
      happy:    [0.7,   0.3],
      surprise: [0.2,   0.7],
      sad:      [-0.6, -0.3],
      anger:    [-0.7,  0.6],
      fear:     [-0.5,  0.5],
    };
    const [v, a] = map[state] || [0, 0];
    return { valence: v + (Math.random() - 0.5) * 0.15, arousal: a + (Math.random() - 0.5) * 0.15 };
  }

  const windows = [];
  const metrics = [];
  const events = [];
  const start = Date.now() - 30 * 60 * 1000;

  for (const sessionId of sessions) {
    const length = 24 + Math.floor(Math.random() * 12);
    let prev = 'neutral';
    let cursor = start + Math.floor(Math.random() * 5 * 60 * 1000);
    events.push({
      level: 'info',
      event_name: 'session.start',
      timestamp: new Date(cursor).toISOString(),
      session_id: sessionId,
      context: { session_id: sessionId, user_id: 'demo-user', model_profile: 'demo-mock' },
      source: 'demo',
    });
    for (let i = 0; i < length; i += 1) {
      const stepMs = 8000 + Math.floor(Math.random() * 4000);
      const startIso = new Date(cursor).toISOString();
      const endIso = new Date(cursor + stepMs).toISOString();
      const state = pickNext(prev);
      const { valence, arousal } = valenceArousal(state);
      const conf = 0.55 + Math.random() * 0.4;
      const entropy = 0.3 + Math.random() * 1.2;
      const missing = Math.random() * 0.08;
      windows.push({
        window_id: `${sessionId}-${i}`,
        window_start: startIso,
        window_end: endIso,
        dominant_emotion: state,
        confidence: conf,
        entropy,
        valence,
        arousal,
        missing_face_ratio: missing,
        valid_frames: Math.floor(20 * (1 - missing)),
        expected_samples: 20,
        model_profile: 'demo-mock',
        session_id: sessionId,
        context: { session_id: sessionId, user_id: 'demo-user', model_profile: 'demo-mock' },
      });
      metrics.push({
        metric_name: 'oyon.sample.duration',
        metric_value: 14 + Math.random() * 18,
        metric_unit: 'ms',
        timestamp: endIso,
        session_id: sessionId,
        context: { session_id: sessionId },
      });
      cursor += stepMs;
      prev = state;
    }
    events.push({
      level: 'info',
      event_name: 'session.end',
      timestamp: new Date(cursor).toISOString(),
      session_id: sessionId,
      context: { session_id: sessionId, user_id: 'demo-user' },
      source: 'demo',
    });
  }

  return { windows, metrics, events };
}

function startLiveTimer() {
  if (liveTimer) clearInterval(liveTimer);
  if (!els.live.checked) return;
  liveTimer = setInterval(() => {
    cache = readData();
    render();
  }, 3000);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function tableEmpty(colspan, text) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = colspan;
  cell.append(empty(text));
  row.append(cell);
  return row;
}

function empty(text) {
  const node = document.createElement('div');
  node.className = 'empty';
  node.textContent = text;
  return node;
}

function stackText(title, meta) {
  const wrap = document.createElement('div');
  const strong = document.createElement('div');
  strong.textContent = title || '-';
  const small = document.createElement('small');
  small.textContent = meta || '';
  wrap.append(strong, small);
  return wrap;
}

function emotionCell(label) {
  const wrap = document.createElement('span');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = colorFor(label);
  wrap.append(swatch, document.createTextNode(titleCase(label)));
  return wrap;
}

function pill(text, className = '') {
  const node = document.createElement('span');
  node.className = `pill ${className}`;
  node.textContent = text || '-';
  return node;
}

function latestMetric(metrics, name) {
  return metrics.slice().reverse().find(metric => metric.metric_name === name) || null;
}

function matchesQuery(item, query) {
  return JSON.stringify(stripPrivate(item)).toLowerCase().includes(query);
}

function contextLine(item) {
  const context = item.context || {};
  const parts = [
    context.tenant_id && `tenant ${context.tenant_id}`,
    context.user_id && `user ${context.user_id}`,
    context.session_id && `session ${context.session_id}`,
    context.case_id && `case ${context.case_id}`,
    context.model_profile && `model ${context.model_profile}`,
    item.session_id && `session ${item.session_id}`,
    item.model_profile && `model ${item.model_profile}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : '-';
}

function tagsLine(tags) {
  if (!tags || typeof tags !== 'object') return '';
  return Object.entries(tags).map(([key, value]) => `${key}=${value}`).join(' | ');
}

function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' | ');
}

function getSessionId(item) {
  return String(item?.context?.session_id || item?.session_id || '').trim();
}

function rangeMinTime(value) {
  const now = Date.now();
  if (value === '15m') return now - 15 * 60 * 1000;
  if (value === '1h') return now - 60 * 60 * 1000;
  if (value === '24h') return now - 24 * 60 * 60 * 1000;
  return null;
}

function parseTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortDateTime(value) {
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

function percent(value) {
  if (!Number.isFinite(value)) return '-';
  return `${Math.round(clamp01(value) * 100)}%`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizedEmotion(value) {
  if (!value) return '';
  return String(value).toLowerCase().replace(/\s+/g, '-');
}

function titleCase(value) {
  if (!value) return '-';
  return String(value).replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function phaseLabel(value) {
  if (!value) return '';
  return titleCase(value);
}

function colorFor(label) {
  return EMOTION_COLORS[normalizedEmotion(label)] || '#94a3b8';
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

function normAffect(value) {
  if (!Number.isFinite(value)) return null;
  return (Math.max(-1, Math.min(1, value)) + 1) / 2;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// ─── Gaze view ───────────────────────────────────────────────────────────
// Visualizes gaze data captured per emotion window. The runtime attaches a
// `gaze` block to each window when `gaze_window_share` is enabled.
// NAMED_3x3_ZONES is declared near the top of the file with the other
// module-level constants — keeping it there avoids a TDZ during bootstrap,
// since `render()` runs before this section's code is reached.

function renderGazeView(windows) {
  const gazeWindows = (windows || []).filter(w => w && w.gaze);
  const aois = readActiveAois();
  renderGazeKpis(gazeWindows);
  renderGazeHeatmap(gazeWindows, aois);
  renderGazeScanpath(gazeWindows, aois);
  renderGazeZoneRef(gazeWindows);
  renderGazeQuality(gazeWindows);
  renderGazeAoi(gazeWindows);
  renderGazeCalibration(gazeWindows);
  renderGazeTable(gazeWindows);
  bindGazeExports(gazeWindows);
}

/**
 * AOIs configured in the standalone Gaze tab live in localStorage under the
 * same key the capture page uses. Reading them here lets the dashboard
 * overlay them on the heatmap and scanpath without a runtime round-trip.
 */
function readActiveAois() {
  try {
    const raw = localStorage.getItem(STORAGE.settings);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.gazeAois) ? parsed.gazeAois : [];
  } catch {
    return [];
  }
}

function renderGazeKpis(gazeWindows) {
  if (!els.gazeKpis) return;
  if (gazeWindows.length === 0) {
    els.gazeKpis.replaceChildren(
      kpi('Gaze windows', 0),
      kpi('Mean σ', '—'),
      kpi('Mean valid', '—'),
      kpi('Off-screen', '—'),
      kpi('Calibration', '—'),
      kpi('Samples', 0),
    );
    return;
  }

  // Average dispersion and valid_frame_ratio across windows that have a
  // dispersion reading. Off-screen ratio averages across windows that had
  // any on-screen valid points (denominator non-zero in the runtime).
  const sigmas = gazeWindows.map(w => w.gaze.dispersion).filter(Number.isFinite);
  const validRatios = gazeWindows.map(w => w.gaze.valid_frame_ratio).filter(Number.isFinite);
  const offScreenRatios = gazeWindows.map(w => w.gaze.off_screen_ratio).filter(Number.isFinite);
  const totalSamples = gazeWindows.reduce((sum, w) => sum + (Number(w.gaze.n_points) || 0), 0);

  const meanSigma = sigmas.length ? sigmas.reduce((s, v) => s + v, 0) / sigmas.length : null;
  const meanValid = validRatios.length ? validRatios.reduce((s, v) => s + v, 0) / validRatios.length : null;
  const meanOff = offScreenRatios.length ? offScreenRatios.reduce((s, v) => s + v, 0) / offScreenRatios.length : null;

  // Calibration KPI: distribution of confidence enum across windows.
  const confCounts = countBy(gazeWindows, w => w.gaze.calibration_confidence || 'unknown');
  const totalConf = gazeWindows.length;
  const measured = confCounts.measured || 0;
  const inferred = confCounts.inferred || 0;
  const unknown = confCounts.unknown || 0;
  const calLabel = totalConf > 0
    ? `${Math.round((measured / totalConf) * 100)}% m · ${Math.round((inferred / totalConf) * 100)}% i · ${Math.round((unknown / totalConf) * 100)}% u`
    : '—';

  els.gazeKpis.replaceChildren(
    kpi('Gaze windows', gazeWindows.length),
    kpi('Mean σ', meanSigma == null ? '—' : meanSigma.toFixed(3)),
    kpi('Mean valid', meanValid == null ? '—' : `${Math.round(meanValid * 100)}%`),
    kpi('Off-screen', meanOff == null ? '—' : `${Math.round(meanOff * 100)}%`),
    kpi('Calibration', calLabel),
    kpi('Samples', totalSamples),
  );
}

/**
 * Smooth gaze density heatmap reconstructed from `zone_proportions` across
 * the session.
 *
 * Why this works on aggregated data:
 *   We don't persist raw gaze samples (privacy invariant in Oyon's runtime).
 *   What we DO persist is, per window, the proportion of valid frames that
 *   landed in each of N×N screen zones. Treating each zone as a 2-D
 *   Gaussian kernel centered at the zone's center, with σ ≈ half a zone
 *   width, and summing the weighted kernels reconstructs a smooth density
 *   that is consistent with the published per-window summaries.
 *
 *   It is not the same as a real raw-sample heatmap (which would resolve
 *   sub-zone fixations), but it is a faithful, deterministic estimate of
 *   what the captured data implies — and it scales with the configured
 *   zone grid resolution, so a 5×5 grid produces a sharper map than 3×3.
 *
 * Color ramp:
 *   A perceptually-uniform sequence approximating viridis: dark navy →
 *   teal → green → yellow. Reads correctly under grayscale conversion,
 *   colorblind-safe, and matches what cognitive-load eye-tracking literature
 *   tends to publish (Tobii Studio / iMotions both ship variants of it).
 *
 * Overlays:
 *   - AOIs from `settings.gazeAois` drawn as dashed rects with labels.
 *   - "Earlier dwell ↔ later dwell" color legend strip at the bottom.
 */
function renderGazeHeatmap(gazeWindows, aois = []) {
  const canvas = els.gazeHeatChart;
  if (!canvas || !els.gazeHeatMeta) return;
  const ctx = setupCanvas(canvas);
  clearCanvas(ctx);
  paintViewportBackground(ctx, canvas);

  if (gazeWindows.length === 0) {
    els.gazeHeatMeta.textContent = '0 windows';
    if (els.gazeHeatLegend) els.gazeHeatLegend.innerHTML = '<span>No data — run a session.</span>';
    drawHeatmapPlaceholder(ctx, canvas);
    return;
  }

  // Collect zone -> weight, where keys are either the named 3×3 set or
  // r<row>c<col> indexed forms. Average across windows to get a stationary
  // density estimate; running a per-window animation is a future stretch.
  const zoneTotals = new Map(); // key → cumulative weight
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
    els.gazeHeatMeta.textContent = `${gazeWindows.length} windows · no zone data`;
    if (els.gazeHeatLegend) els.gazeHeatLegend.innerHTML = '<span>No zone_proportions recorded.</span>';
    drawHeatmapPlaceholder(ctx, canvas);
    return;
  }

  // Project each zone key to its center in normalized [-0.5, 0.5] coords.
  const zoneCenters = [];
  for (const [key, weight] of zoneTotals.entries()) {
    const center = zoneKeyToCenter(key, gridN);
    if (!center) continue;
    zoneCenters.push({ x: center.x, y: center.y, weight: weight / totalWindows });
  }

  paintDensityField(ctx, canvas, zoneCenters, gridN);
  paintAoiOverlay(ctx, canvas, aois);

  els.gazeHeatMeta.textContent = `${gazeWindows.length} windows · ${gridN}×${gridN} zones`;
  paintHeatmapLegend();
}

/**
 * Paint a smooth density field on the canvas. The density is sampled at a
 * lower resolution (cellPx × cellPx) for speed, then drawn as filled rects.
 * For each on-screen pixel, density = Σ weight_i · exp(-d²/(2σ²)) where
 * (d) is the distance to each zone center and σ = half a zone width.
 *
 * The integral of each kernel is intentionally NOT normalized to 1 — the
 * weights ARE the integrals (zone proportions sum to ~1 per window). The
 * Gaussian shape just spreads them visually.
 */
function paintDensityField(ctx, canvas, points, gridN) {
  if (!points.length) return;
  const cssWidth = canvas.width / (devicePixelRatio || 1);
  const cssHeight = canvas.height / (devicePixelRatio || 1);
  const cellPx = 6; // grid-cell resolution; smaller = smoother but slower
  const sigmaPx = (cssWidth / gridN) * 0.55; // half a zone width
  const invTwoSigma2 = 1 / (2 * sigmaPx * sigmaPx);

  // Build a downsampled density grid.
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
      if (t < 0.02) continue; // skip near-black cells; let the bg show through
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
    // Label with backdrop for legibility against bright heat patches.
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
  // Dark navy backdrop matches the viridis ramp's low end and gives the
  // heatmap real contrast — light/cream backgrounds wash out the cool end.
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  // Center crosshair for orientation.
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
  ctx.fillText('No gaze data yet — calibrate and run a session', w / 2, h / 2);
  ctx.textAlign = 'start';
}

function paintHeatmapLegend() {
  if (!els.gazeHeatLegend) return;
  // 5-stop ramp visible to the user, mirroring viridisLike(t).
  const stops = [0, 0.25, 0.5, 0.75, 1];
  const swatches = stops.map(t => `<span style="display:inline-block;width:28px;height:10px;background:${viridisLike(t)};"></span>`).join('');
  els.gazeHeatLegend.innerHTML =
    `<span>lower dwell</span>${swatches}<span>higher dwell</span>` +
    `<span style="margin-left: 12px;">white dashed boxes = AOIs</span>`;
}

/**
 * Cheap viridis-ish ramp: pure JS, no external dep. Walks through anchor
 * stops with linear interpolation in RGB. Looks correct on dark BG and
 * preserves order under grayscale.
 */
function viridisLike(t) {
  const stops = [
    [0.0, [11, 18, 32]],     // near-bg
    [0.18, [40, 27, 87]],    // deep purple
    [0.40, [33, 145, 140]],  // teal
    [0.65, [94, 201, 98]],   // green
    [0.85, [253, 231, 37]],  // yellow
    [1.0, [255, 240, 200]],  // hot peak
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

/**
 * Gaze transition network.
 *
 * Build:
 *   1. For each window with a centroid, bin the centroid into the same N×N
 *      zone grid the runtime uses. Use named 3×3 keys for grid_n === 3,
 *      indexed r<row>c<col> otherwise.
 *   2. Per session, walk the windows in time order producing a sequence of
 *      zone labels. Each consecutive pair (z_i, z_{i+1}) is one transition.
 *   3. Aggregate transitions into a square count matrix indexed by zone.
 *   4. Layout: place each zone at its actual screen position (top-left zone
 *      top-left in the diagram, etc.) instead of the emotion-network's ring
 *      layout. This is the analytically right choice for spatial data —
 *      reading direction, attention to corners, etc., is preserved.
 *   5. Node radius = scaled instrength (Σ incoming weights). Larger circles
 *      = zones the gaze returns to often.
 *
 * The visual vocabulary matches the emotion transition network on the same
 * dashboard (filled disks, dark edges, directional arrows) for parity.
 */
function renderGazeScanpath(gazeWindows, aois = []) {
  const container = els.gazeNetworkChart;
  if (!container || !els.gazeScanpathMeta) return;
  container.replaceChildren();

  // Detect the configured grid resolution from the keys present. Default 3.
  let gridN = 3;
  for (const w of gazeWindows) {
    const zp = w.gaze?.zone_proportions;
    if (!zp) continue;
    for (const key of Object.keys(zp)) {
      const m = /^r(\d+)c(\d+)$/.exec(key);
      if (m) gridN = Math.max(gridN, Math.max(Number(m[1]), Number(m[2])) + 1);
    }
  }

  // Group windows by session so transitions don't bleed across sessions.
  const bySession = new Map();
  const sorted = gazeWindows
    .filter(w => w.gaze?.centroid &&
                 Number.isFinite(w.gaze.centroid.x) &&
                 Number.isFinite(w.gaze.centroid.y))
    .sort((a, b) => parseGazeTime(a) - parseGazeTime(b));
  for (const w of sorted) {
    const sid = getSessionId(w) || '__default__';
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(centroidToZoneKey(w.gaze.centroid, gridN));
  }

  // Build transition count matrix.
  const labels = enumerateZoneKeys(gridN);
  const labelToIndex = new Map(labels.map((k, i) => [k, i]));
  const n = labels.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  let totalTransitions = 0;
  for (const seq of bySession.values()) {
    for (let i = 1; i < seq.length; i += 1) {
      const a = labelToIndex.get(seq[i - 1]);
      const b = labelToIndex.get(seq[i]);
      if (a == null || b == null) continue;
      matrix[a][b] += 1;
      totalTransitions += 1;
    }
  }

  if (totalTransitions === 0) {
    els.gazeScanpathMeta.textContent = sorted.length > 0 ? '1 fixation · no transitions yet' : '0 fixations';
    container.append(makeNetworkEmptyState(
      sorted.length > 0
        ? 'Need at least two windows to draw a transition.'
        : 'No gaze windows yet — calibrate and capture a session.',
    ));
    return;
  }

  // Three node-strength metrics. Computed once; the renderer picks the
  // active one based on the user's toggle.
  //   - inStrength[j]  = Σ_i  matrix[i][j]  → where attention LANDS
  //   - outStrength[i] = Σ_j  matrix[i][j]  → where attention LEAVES FROM
  //   - visits[i]      = how many windows assigned to zone i (regardless of
  //                      whether they participated in a transition; an
  //                      isolated single-window session still gets visits=1
  //                      but instrength=outstrength=0)
  const inStrength = new Array(n).fill(0);
  const outStrength = new Array(n).fill(0);
  const visits = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      inStrength[j] += matrix[i][j];
      outStrength[i] += matrix[i][j];
    }
  }
  for (const seq of bySession.values()) {
    for (const k of seq) {
      const i = labelToIndex.get(k);
      if (i != null) visits[i] += 1;
    }
  }

  const visitedIndices = labels.map((_, i) => i).filter(i => visits[i] > 0);
  if (visitedIndices.length === 0) {
    els.gazeScanpathMeta.textContent = '0 fixations';
    container.append(makeNetworkEmptyState('No gaze windows yet — calibrate and capture a session.'));
    return;
  }

  els.gazeScanpathMeta.textContent =
    `${visitedIndices.length} zone${visitedIndices.length === 1 ? '' : 's'} · ` +
    `${totalTransitions} transition${totalTransitions === 1 ? '' : 's'} · ${gridN}×${gridN} grid`;

  drawGazeNetworkSvg(container, {
    labels,
    matrix,
    inStrength,
    outStrength,
    visits,
    visitedIndices,
    gridN,
    aois,
    nodeMetric: uiSettings.gazeNodeMetric || 'instrength',
    edgeMetric: uiSettings.gazeEdgeMetric || 'counts',
    showSelfLoops: uiSettings.gazeShowSelfLoops !== false,
  });
  paintGazeNetworkLegend();
}

function paintGazeNetworkLegend() {
  if (!els.gazeNetworkLegend) return;
  const node = uiSettings.gazeNodeMetric || 'instrength';
  const edge = uiSettings.gazeEdgeMetric || 'counts';
  const loops = uiSettings.gazeShowSelfLoops !== false ? 'shown' : 'hidden';
  const nodeDesc = {
    instrength: 'Σ incoming transitions (where attention lands)',
    outstrength: 'Σ outgoing transitions (where attention leaves from)',
    visits: 'window count per zone (raw dwell, no transitions)',
  }[node];
  const edgeDesc = edge === 'probabilities'
    ? 'P(j | i) — row-normalized: of transitions OUT of i, what fraction went to j'
    : 'raw transition counts between consecutive windows';
  els.gazeNetworkLegend.innerHTML =
    `<strong>node size</strong>: ${node} — ${nodeDesc}. ` +
    `<strong>edge width</strong>: ${edgeDesc}. ` +
    `self-loops: ${loops}.`;
}

function drawGazeNetworkSvg(container, data) {
  const {
    labels, matrix, inStrength, outStrength, visits, visitedIndices, gridN, aois,
    nodeMetric, edgeMetric, showSelfLoops,
  } = data;
  // Pick the active size metric. Fallback to instrength if the user-set
  // string is unrecognized (e.g. older localStorage payload).
  const sizeBy =
    nodeMetric === 'outstrength' ? outStrength :
    nodeMetric === 'visits' ? visits :
    inStrength;
  const W = 960;
  const H = 540; // matches the panel's 16:9 aspect on a typical screen
  const padding = 40;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.display = 'block';
  svg.style.background = '#ffffff';

  // Defs: arrowhead marker.
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

  // Faint grid lines so the spatial layout is obvious.
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

  // AOI overlays first so the network sits on top.
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

  // Position each node at its real zone center on the panel.
  const minRadius = 14;
  const maxRadius = 44;
  const maxSize = Math.max(...sizeBy, 1);
  const nodes = labels.map((label, i) => {
    const c = zoneKeyToCenter(label, gridN);
    const cx = padding + (0.5 + (c?.x ?? 0)) * (W - padding * 2);
    const cy = padding + (0.5 + (c?.y ?? 0)) * (H - padding * 2);
    // visits==0 means the zone was never observed → hide it entirely.
    // Otherwise scale radius by √(sizeBy / maxSize) so highly-active zones
    // dominate sub-linearly (keeps the diagram readable).
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

  // Edges. Build a row-normalized matrix if `probabilities` is selected.
  // Probabilities are P(j | i) = matrix[i][j] / Σ_j matrix[i][j], so each
  // outgoing row sums to 1. This re-scales weights independent of row
  // mass — a rarely-visited zone that always transitions to the same
  // neighbor will have a "thick" edge in this view.
  const n = labels.length;
  const weightFor = (i, j) => {
    if (edgeMetric === 'probabilities') {
      const rowSum = outStrength[i] || 0;
      return rowSum > 0 ? matrix[i][j] / rowSum : 0;
    }
    return matrix[i][j];
  };
  let maxWeight = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const w = weightFor(i, j);
      if (w > maxWeight) maxWeight = w;
    }
  }
  if (maxWeight <= 0) maxWeight = 1;
  const edgeGroup = document.createElementNS(ns, 'g');
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const w = weightFor(i, j);
      if (w <= 0) continue;
      if (i === j && !showSelfLoops) continue;
      const src = nodes[i];
      const tgt = nodes[j];
      if (src.radius === 0 || tgt.radius === 0) continue;
      const widthPx = 1 + (w / maxWeight) * 5;
      const opacity = 0.25 + (w / maxWeight) * 0.55;
      if (i === j) {
        // Self-loop: small arc above the node.
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
        // Straight directed edge, stopping at the target circle's rim.
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

  // Nodes on top of edges. Color by viridis(visits / maxVisits) so frequent
  // zones pop visually too, not just by size.
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
      nodeMetric === 'visits' ? 'visits' :
      'instrength';
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

function enumerateZoneKeys(gridN) {
  if (gridN === 3) return NAMED_3x3_ZONES.slice();
  const out = [];
  for (let r = 0; r < gridN; r += 1) {
    for (let c = 0; c < gridN; c += 1) out.push(`r${r}c${c}`);
  }
  return out;
}

function centroidToZoneKey(centroid, gridN) {
  // Centroid is in normalized [-0.5, 0.5]; clamp slightly inside the edge.
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
  // Names get abbreviated for the on-node label so they don't overflow:
  //   "top_left" → "TL"; "middle_center" → "MC"; "bottom_right" → "BR"; etc.
  const named = {
    top_left: 'TL', top_center: 'TC', top_right: 'TR',
    middle_left: 'ML', middle_center: 'MC', middle_right: 'MR',
    bottom_left: 'BL', bottom_center: 'BC', bottom_right: 'BR',
  };
  if (named[key]) return named[key];
  return key;
}

function withAlpha(rgbString, alpha) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgbString);
  if (!m) return rgbString;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
}

/**
 * Compact 3×3 zone-proportion reference. Kept as a SECONDARY panel because
 * the smooth density map is the headline visualization but the raw percentages
 * are useful when reading published research that quantifies coverage by
 * named zones (a common convention in reading-comprehension eye-tracking).
 */
function renderGazeZoneRef(gazeWindows) {
  const root = els.gazeZoneRef;
  if (!root || !els.gazeZoneRefMeta) return;
  if (gazeWindows.length === 0) {
    els.gazeZoneRefMeta.textContent = '0 windows';
    root.innerHTML = '<div class="empty" style="padding:24px;color:var(--ink-3);">No gaze windows yet.</div>';
    return;
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
    els.gazeZoneRefMeta.textContent = `${gazeWindows.length} windows · no zone data`;
    root.innerHTML = '<div class="empty" style="padding:24px;color:var(--ink-3);">No zone_proportions recorded.</div>';
    return;
  }
  const keysOrdered = NAMED_3x3_ZONES.every(k => k in accum)
    ? NAMED_3x3_ZONES
    : Object.keys(accum).slice(0, 9);
  const cells = keysOrdered.map(k => ({ key: k, value: (accum[k] || 0) / denom }));
  const max = Math.max(...cells.map(c => c.value), 1e-9);
  els.gazeZoneRefMeta.textContent = `averaged across ${gazeWindows.length}`;
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
}

function renderGazeQuality(gazeWindows) {
  if (!els.gazeQualityChart || !els.gazeQualityMeta) return;
  const ctx = setupCanvas(els.gazeQualityChart);
  clearCanvas(ctx);
  if (gazeWindows.length === 0) {
    els.gazeQualityMeta.textContent = '0 windows';
    return drawNoData(ctx, 'No gaze windows');
  }
  els.gazeQualityMeta.textContent = `${gazeWindows.length} windows`;

  // Stamp _time for ordering; fall back to window_end ISO when missing.
  const rows = gazeWindows
    .map(w => ({
      _time: parseGazeTime(w),
      sigma: Number.isFinite(w.gaze.dispersion) ? w.gaze.dispersion : null,
      valid: Number.isFinite(w.gaze.valid_frame_ratio) ? w.gaze.valid_frame_ratio : null,
    }))
    .filter(r => Number.isFinite(r._time))
    .sort((a, b) => a._time - b._time);
  if (!rows.length) return drawNoData(ctx, 'No timestamped gaze windows');

  const minT = rows[0]._time;
  const maxT = rows[rows.length - 1]._time;
  const denom = Math.max(1, maxT - minT);
  const plot = plotArea(ctx);
  drawAxes(ctx, plot);

  // Dispersion is non-negative and unbounded. Normalize to [0, 1] using the
  // observed max so the line stays in-plot even at high σ. Valid ratio is
  // already [0, 1].
  const sigmas = rows.map(r => r.sigma).filter(Number.isFinite);
  const sigmaMax = sigmas.length ? Math.max(...sigmas) : 0;
  const sigmaDenom = sigmaMax > 0 ? sigmaMax : 1;
  drawLine(
    ctx, plot, rows,
    item => (item._time - minT) / denom,
    item => item.sigma == null ? null : item.sigma / sigmaDenom,
    '#dc2626',
    'σ',
  );
  drawLine(
    ctx, plot, rows,
    item => (item._time - minT) / denom,
    item => item.valid,
    '#16a34a',
    'valid',
  );
  drawLegend(ctx, [[`σ (max ${sigmaMax.toFixed(3)})`, '#dc2626'], ['valid ratio', '#16a34a']], plot.x + 10, plot.y + 10);
}

function renderGazeAoi(gazeWindows) {
  if (!els.gazeAoiChart || !els.gazeAoiMeta) return;
  const ctx = setupCanvas(els.gazeAoiChart);
  clearCanvas(ctx);

  // Sum dwell per AOI id across windows.
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
  if (!entries.length) {
    els.gazeAoiMeta.textContent = 'No AOIs configured';
    return drawNoData(ctx, 'Define AOIs in the Gaze settings tab');
  }
  els.gazeAoiMeta.textContent = `${entries.length} AOI${entries.length === 1 ? '' : 's'}`;

  const plot = plotArea(ctx);
  const max = Math.max(...entries.map(([, total]) => total), 1);
  const barGap = 8;
  const barH = Math.max(14, (plot.h - barGap * (entries.length - 1)) / entries.length);
  ctx.font = '12px ui-sans-serif, system-ui';
  entries.forEach(([id, total], index) => {
    const y = plot.y + index * (barH + barGap);
    const width = (total / max) * (plot.w - 160);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(plot.x + 150, y, width, barH);
    ctx.fillStyle = themeColor('--canvas-label', '#374151');
    ctx.fillText(id, plot.x, y + barH - 4);
    ctx.fillStyle = themeColor('--canvas-muted', '#6b7280');
    ctx.fillText(`${(total / 1000).toFixed(1)} s`, plot.x + 156 + width, y + barH - 4);
  });
}

function renderGazeCalibration(gazeWindows) {
  if (!els.gazeCalibChart || !els.gazeCalibMeta) return;
  const ctx = setupCanvas(els.gazeCalibChart);
  clearCanvas(ctx);
  if (gazeWindows.length === 0) {
    els.gazeCalibMeta.textContent = '0 windows';
    return drawNoData(ctx, 'No gaze windows');
  }
  els.gazeCalibMeta.textContent = `${gazeWindows.length} windows`;

  const rows = gazeWindows
    .map(w => ({
      _time: parseGazeTime(w),
      ageMs: Number.isFinite(w.gaze.calibration_age_ms) ? w.gaze.calibration_age_ms : null,
      quality: Number.isFinite(w.gaze.calibration_quality) ? w.gaze.calibration_quality : null,
      confidence: w.gaze.calibration_confidence || 'unknown',
    }))
    .filter(r => Number.isFinite(r._time))
    .sort((a, b) => a._time - b._time);
  if (!rows.length) return drawNoData(ctx, 'No timestamped windows');

  const minT = rows[0]._time;
  const maxT = rows[rows.length - 1]._time;
  const denom = Math.max(1, maxT - minT);
  const ages = rows.map(r => r.ageMs).filter(Number.isFinite);
  const ageMax = ages.length ? Math.max(...ages) : 0;
  const ageDenom = ageMax > 0 ? ageMax : 1;
  const plot = plotArea(ctx);

  // Background ribbon: color per confidence enum below the axis.
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
  drawLine(
    ctx, plot, rows,
    item => (item._time - minT) / denom,
    item => item.ageMs == null ? null : item.ageMs / ageDenom,
    '#7c3aed',
    'age',
  );
  drawLine(
    ctx, plot, rows,
    item => (item._time - minT) / denom,
    item => item.quality,
    '#16a34a',
    'quality',
  );
  drawLegend(ctx, [
    [`age (max ${(ageMax / 1000).toFixed(1)} s)`, '#7c3aed'],
    ['quality', '#16a34a'],
    ['measured', '#16a34a'],
    ['inferred', '#d97706'],
    ['unknown', '#9ca3af'],
  ], plot.x + 10, plot.y + 10);
}

function renderGazeTable(gazeWindows) {
  if (!els.gazeTable || !els.gazeTableMeta) return;
  els.gazeTable.replaceChildren();
  els.gazeTableMeta.textContent = `${gazeWindows.length} window${gazeWindows.length === 1 ? '' : 's'}`;
  if (!gazeWindows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = 'No gaze data yet. Start a session, calibrate, and look around.';
    cell.style.padding = '14px';
    cell.style.color = 'var(--ink-3)';
    row.append(cell);
    els.gazeTable.append(row);
    return;
  }
  const recent = gazeWindows.slice(-50).reverse();
  for (const w of recent) {
    const g = w.gaze;
    const cells = [
      shortDateTime(g.window_end || w.window_end),
      String(g.n_points ?? '—'),
      g.dispersion == null ? '—' : Number(g.dispersion).toFixed(3),
      g.centroid ? `${g.centroid.x.toFixed(2)}, ${g.centroid.y.toFixed(2)}` : '—',
      g.valid_frame_ratio == null ? '—' : `${Math.round(g.valid_frame_ratio * 100)}%`,
      g.off_screen_ratio == null ? '—' : `${Math.round(g.off_screen_ratio * 100)}%`,
      formatGazeCalibration(g),
    ];
    const row = tr(w, cells);
    els.gazeTable.append(row);
  }
}

function formatGazeCalibration(g) {
  if (!Number.isFinite(g.calibration_age_ms)) return 'not calibrated';
  const conf = g.calibration_confidence || 'unknown';
  const qPart = Number.isFinite(g.calibration_quality)
    ? `q ${Number(g.calibration_quality).toFixed(2)} · ${conf}`
    : conf === 'unknown' ? 'quality unknown' : conf;
  return `${qPart} · ${(g.calibration_age_ms / 1000).toFixed(0)} s ago`;
}

function confidenceColor(confidence) {
  if (confidence === 'measured') return 'rgba(22, 163, 74, 0.55)';
  if (confidence === 'inferred') return 'rgba(217, 119, 6, 0.55)';
  return 'rgba(156, 163, 175, 0.55)';
}

function parseGazeTime(window) {
  if (window._time && Number.isFinite(window._time)) return window._time;
  const iso = window.gaze?.window_end || window.window_end;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function bindGazeExports(gazeWindows) {
  if (els.exportGazeCsv && !els.exportGazeCsv.__bound) {
    els.exportGazeCsv.addEventListener('click', () => downloadGazeCsv(gazeWindows));
    els.exportGazeCsv.__bound = true;
  }
  if (els.exportGazeJson && !els.exportGazeJson.__bound) {
    els.exportGazeJson.addEventListener('click', () => downloadGazeJson(gazeWindows));
    els.exportGazeJson.__bound = true;
  }
}

function downloadGazeCsv(gazeWindows) {
  // Collect every AOI id seen across windows so CSV columns stay stable.
  const aoiIds = new Set();
  for (const w of gazeWindows) {
    const dwell = w.gaze?.aoi_dwell_ms;
    if (dwell && typeof dwell === 'object') {
      for (const id of Object.keys(dwell)) aoiIds.add(id);
    }
  }
  const aoiCols = Array.from(aoiIds).sort();
  const header = [
    'window_start', 'window_end', 'duration_ms',
    'n_points', 'total_frames',
    'centroid_x', 'centroid_y', 'dispersion',
    'valid_frame_ratio', 'off_screen_ratio',
    'calibration_age_ms', 'calibration_quality', 'calibration_confidence',
    'model_version',
    ...aoiCols.map(id => `aoi_${id}_dwell_ms`),
  ];
  const lines = [header.join(',')];
  for (const w of gazeWindows) {
    const g = w.gaze || {};
    const row = [
      csvField(g.window_start),
      csvField(g.window_end),
      csvField(g.duration_ms),
      csvField(g.n_points),
      csvField(g.total_frames),
      csvField(g.centroid?.x),
      csvField(g.centroid?.y),
      csvField(g.dispersion),
      csvField(g.valid_frame_ratio),
      csvField(g.off_screen_ratio),
      csvField(g.calibration_age_ms),
      csvField(g.calibration_quality),
      csvField(g.calibration_confidence),
      csvField(g.model_version),
      ...aoiCols.map(id => csvField(g.aoi_dwell_ms?.[id])),
    ];
    lines.push(row.join(','));
  }
  triggerDownload(lines.join('\n'), 'oyon-gaze-windows.csv', 'text/csv');
}

function downloadGazeJson(gazeWindows) {
  const payload = gazeWindows.map(w => ({
    window_start: w.window_start,
    window_end: w.window_end,
    session_id: w.session_id || null,
    gaze: w.gaze || null,
  }));
  triggerDownload(JSON.stringify(payload, null, 2), 'oyon-gaze-windows.json', 'application/json');
}

function csvField(value) {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
