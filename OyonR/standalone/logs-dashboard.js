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

// When opened from the Rohy miniature (?source=rohy&session_id=…&case_id=…)
// the dashboard reads emotion records from the Rohy backend via authenticated
// fetch instead of localStorage. The launching session is preselected in the
// existing session filter; admins/educators see records from every session
// they're allowed to read, students see only their own.
//
// Auto-detect: if a rohy auth cookie exists for this origin, default to
// rohy mode even without `?source=rohy` in the URL. `?source=standalone`
// is the explicit opt-out for "I really want local-only mode while logged
// into rohy." This means opening /oyon/standalone/logs.html bare from a
// logged-in rohy tab Just Works (shows server records by session) instead
// of silently reading from empty localStorage.
const ROHY_QUERY = new URLSearchParams(window.location.search);
function hasRohyAuthCookie() {
  if (typeof document === 'undefined' || !document.cookie) return false;
  return /\b(rohy_session|rohy_csrf)\s*=/.test(document.cookie);
}
const ROHY_SOURCE = ROHY_QUERY.get('source');
const ROHY_MODE = ROHY_SOURCE === 'rohy'
  ? true
  : ROHY_SOURCE === 'standalone'
  ? false
  : hasRohyAuthCookie();
const ROHY_SESSION_ID = ROHY_QUERY.get('session_id') || null;
const ROHY_API_BASE = '/api/addons/oyon';

const TABLE_PAGE_SIZE = 50;

const DEFAULT_UI_SETTINGS = {
  showEvents: false,
  showMetrics: false,
  showWindows: false,
  showDemo: false,
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

let activeView = 'analytics';
let selectedRecord = null;
let cache = { logs: [], metrics: [], windows: [], settings: {} };
let liveTimer = null;

bindUi();
applyUiSettings();
render();
loadAndRender().then(() => {
  // Preselect the launching session in Rohy mode so the page lands on the
  // session the operator clicked from, not "All sessions".
  if (ROHY_MODE && ROHY_SESSION_ID && els.session) {
    els.session.value = String(ROHY_SESSION_ID);
    render();
  }
});
startLiveTimer();
window.addEventListener('resize', () => renderCharts(currentFiltered()));

function bindUi() {
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  }
  els.refresh.addEventListener('click', () => { loadAndRender(); });
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

// Load + render. In Rohy mode this fetches windows from the Rohy backend;
// logs/metrics aren't persisted server-side so they stay empty. In standalone
// mode it reads everything from localStorage as before.
async function loadAndRender() {
  cache = ROHY_MODE ? await readDataFromRohy() : readData();
  render();
}

async function readDataFromRohy() {
  let rawWindows = [];
  try {
    const res = await fetch(`${ROHY_API_BASE}/emotion-records?limit=500`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn('[oyon dashboard] backend returned', res.status);
    } else {
      const body = await res.json();
      rawWindows = (body?.records || []).map(rohyRecordToWindow);
    }
  } catch (err) {
    console.warn('[oyon dashboard] backend fetch failed, falling back to local cache', err);
    rawWindows = readJsonArray(STORAGE.windows);
  }
  const enrichedWindows = enrichWindowsWithDynamics(rawWindows);
  const enriched = rawWindows.map((window, index) => ({
    ...window,
    dynamics: window.dynamics || enrichedWindows[index]?.dynamics || null,
    _kind: 'window',
    _id: `window-${index}-${window.window_end || ''}`,
    _time: parseTime(window.window_end || window.timestamp),
  }));
  return { logs: [], metrics: [], windows: enriched, settings: {} };
}

// The Rohy backend stores records with snake_case columns and JSON-encoded
// probabilities/quality. Reshape to match the in-page window shape that the
// renderer expects.
function rohyRecordToWindow(r) {
  return {
    session_id: r.session_id,
    user_id: r.user_id,
    case_id: r.case_id,
    student_name: r.student_name_snapshot,
    case_title: r.case_title_snapshot,
    window_start: r.window_start,
    window_end: r.window_end,
    duration_ms: Number(r.duration_ms) || 0,
    expected_samples: Number(r.expected_samples) || null,
    dominant_emotion: r.dominant_emotion,
    probabilities: typeof r.probabilities === 'object' && r.probabilities
      ? r.probabilities
      : (r.emotion_probabilities_json ? safeJson(r.emotion_probabilities_json) : null),
    valence: numOrNull(r.valence),
    valence_std: numOrNull(r.valence_std),
    valence_min: numOrNull(r.valence_min),
    valence_max: numOrNull(r.valence_max),
    arousal: numOrNull(r.arousal),
    arousal_std: numOrNull(r.arousal_std),
    arousal_min: numOrNull(r.arousal_min),
    arousal_max: numOrNull(r.arousal_max),
    confidence: numOrNull(r.confidence),
    confidence_std: numOrNull(r.confidence_std),
    entropy: numOrNull(r.entropy),
    entropy_std: numOrNull(r.entropy_std),
    stability_score: numOrNull(r.stability_score),
    label_switch_count: Number(r.label_switch_count) || 0,
    valid_frames: Number(r.valid_frames) || 0,
    missing_face_ratio: numOrNull(r.missing_face_ratio),
    quality: r.quality || (r.quality_json ? safeJson(r.quality_json) : null),
    model_name: r.model_name,
    model_version: r.model_version,
    model_profile: r.model_profile,
    settings_hash: r.settings_hash,
    settings_snapshot: r.settings_snapshot || (r.settings_snapshot_json ? safeJson(r.settings_snapshot_json) : null),
    dynamics: r.dynamics || (r.dynamics_json ? safeJson(r.dynamics_json) : null),
    capture_mode: r.capture_mode,
  };
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

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
  liveTimer = setInterval(() => { loadAndRender(); }, 3000);
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
