import {
  CameraController,
  EmotionRuntime,
  EmotionAggregator,
  LocalEmotionTransport,
  HttpEmotionTransport,
  LocalLogTransport,
  LocalMetricTransport,
  MediaPipeFaceTracker,
  OnnxEmotionClassifier,
  OyonLogger,
  OyonMetricRecorder,
  PredictionSmoother,
  createOyonSettings,
  EMOTIEFF_MOBILEVIT_MTL_CONFIG,
  EMOTIEFF_MBF_MTL_CONFIG,
  HSE_EMOTION_MTL_CONFIG,
} from '../src/index.js';

// When opened from Rohy (?source=rohy&session_id=…&case_id=…) the standalone
// switches its transport from local-only to Rohy's authenticated backend so
// emotion windows are persisted per-session/student/case in Rohy's database.
const ROHY_QUERY = new URLSearchParams(window.location.search);
const ROHY_MODE = ROHY_QUERY.get('source') === 'rohy';
const ROHY_SESSION_ID = ROHY_QUERY.get('session_id') || null;
const ROHY_CASE_ID = ROHY_QUERY.get('case_id') || null;

// surface any unexpected error so the user sees it instead of a blank page
window.addEventListener('error', e => showToast(`JS error: ${e.message}`));
window.addEventListener('unhandledrejection', e => showToast(`Promise: ${e.reason?.message || e.reason}`));

// ---------- DOM refs ----------
const els = {
  status: document.querySelector('#pillState'),
  pillModel: document.querySelector('#pillModel'),
  pillFps: document.querySelector('#pillFps'),
  pillLatency: document.querySelector('#pillLatency'),
  pillSamples: document.querySelector('#pillSamples'),
  preview: document.querySelector('#preview'),
  previewZoom: document.querySelector('#previewZoom'),
  previewWrap: document.querySelector('.preview-wrap'),
  overlay: document.querySelector('#overlay'),
  faceBox: document.querySelector('#faceBox'),
  faceLabelText: document.querySelector('#faceLabelText'),
  previewEmpty: document.querySelector('#previewEmpty'),
  qualityBanner: document.querySelector('#qualityBanner'),
  qualityBannerText: document.querySelector('#qualityBannerText'),
  prediction: document.querySelector('#prediction'),
  predictionEmpty: document.querySelector('#predictionEmpty'),
  predictionBody: document.querySelector('#predictionBody'),
  emotionName: document.querySelector('#emotionName'),
  emotionSwatch: document.querySelector('#emotionSwatch'),
  confValue: document.querySelector('#confValue'),
  modelLineLabel: document.querySelector('#modelLineLabel'),
  modelLineHint: document.querySelector('#modelLineHint'),
  valenceBar: document.querySelector('#valenceBar'),
  valenceNum: document.querySelector('#valenceNum'),
  arousalBar: document.querySelector('#arousalBar'),
  arousalNum: document.querySelector('#arousalNum'),
  vaNote: document.querySelector('#vaNote'),
  probList: document.querySelector('#probList'),
  modelSelect: document.querySelector('#model'),
  drawer: document.querySelector('#settingsDrawer'),
  drawerBackdrop: document.querySelector('#drawerBackdrop'),
  drawerClose: document.querySelector('#drawerClose'),
  settingsToggle: document.querySelector('#settingsToggle'),
  drawerTabs: document.querySelectorAll('.drawer-tab'),
  drawerPanes: document.querySelectorAll('.drawer-pane'),
  sampleInterval: document.querySelector('#sampleInterval'),
  smoothingAlpha: document.querySelector('#smoothingAlpha'),
  cameraZoom: document.querySelector('#cameraZoom'),
  cameraOffsetX: document.querySelector('#cameraOffsetX'),
  cameraOffsetY: document.querySelector('#cameraOffsetY'),
  cameraSize: document.querySelector('#cameraSize'),
  cameraReset: document.querySelector('#cameraReset'),
  holdMs: document.querySelector('#holdMs'),
  switchConfidence: document.querySelector('#switchConfidence'),
  windowMs: document.querySelector('#windowMs'),
  minValidFrames: document.querySelector('#minValidFrames'),
  opsRefresh: document.querySelector('#opsRefresh'),
  opsExport: document.querySelector('#opsExport'),
  opsClear: document.querySelector('#opsClear'),
  opsLevelFilter: document.querySelector('#opsLevelFilter'),
  opsEventCount: document.querySelector('#opsEventCount'),
  opsMetricCount: document.querySelector('#opsMetricCount'),
  opsWindowCount: document.querySelector('#opsWindowCount'),
  opsQuality: document.querySelector('#opsQuality'),
  opsEvents: document.querySelector('#opsEvents'),
  opsMetrics: document.querySelector('#opsMetrics'),
  opsWindows: document.querySelector('#opsWindows'),
  dynajRefresh: document.querySelector('#dynajRefresh'),
  dynajExport: document.querySelector('#dynajExport'),
  dynajWindowCount: document.querySelector('#dynajWindowCount'),
  dynajSpeed: document.querySelector('#dynajSpeed'),
  dynajInstability: document.querySelector('#dynajInstability'),
  dynajPhase: document.querySelector('#dynajPhase'),
  dynajLatest: document.querySelector('#dynajLatest'),
  dynajTransitions: document.querySelector('#dynajTransitions'),
  startBtn: document.querySelector('#start'),
  pauseBtn: document.querySelector('#pause'),
  resumeBtn: document.querySelector('#resume'),
  stopBtn: document.querySelector('#stop'),
  timeline: document.querySelector('#timeline'),
  timelineLegend: document.querySelector('#timelineLegend'),
  toast: document.querySelector('#toast'),
};

// ---------- emotion → color map (stable across UI) ----------
const EMOTION_COLORS = {
  neutral:  '#94a3b8',
  happy:    '#34d399',
  happiness:'#34d399',
  joy:      '#34d399',
  surprise: '#fbbf24',
  sad:      '#60a5fa',
  sadness:  '#60a5fa',
  anger:    '#f87171',
  angry:    '#f87171',
  fear:     '#a78bfa',
  disgust:  '#84cc16',
  contempt: '#f472b6',
};
function colorFor(label) {
  if (!label) return '#94a3b8';
  return EMOTION_COLORS[label.toLowerCase()] || '#94a3b8';
}

// ---------- state ----------
const MODEL_PROFILES = {
  'emotieff-mobilevit': {
    label: 'EmotiEff MobileViT',
    hint: '8 expressions + valence/arousal',
    config: EMOTIEFF_MOBILEVIT_MTL_CONFIG,
  },
  'hse-emotion-mtl': {
    label: 'HSEmotion B0 MTL',
    hint: 'experimental, 8 expressions + valence/arousal',
    config: HSE_EMOTION_MTL_CONFIG,
  },
  'emotieff-mbf-mtl': {
    label: 'EmotiEff MobileFaceNet',
    hint: 'experimental, 8 expressions + valence/arousal',
    config: EMOTIEFF_MBF_MTL_CONFIG,
  },
};
const DEFAULT_MODEL_PROFILE = 'hse-emotion-mtl';
// CSRF: Rohy uses double-submit cookie pattern for cookie-auth state-changing
// requests. The `rohy_csrf` cookie is non-HttpOnly so client JS can copy it
// into `X-CSRF-Token` on every POST/PUT/PATCH/DELETE. Without this header,
// the standalone's consent + emotion-records writes get 403 in deployed Rohy
// even though they share an origin.
function readRohyCsrfCookie() {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const pair of document.cookie.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    if (k !== 'rohy_csrf') continue;
    const v = pair.slice(eq + 1).trim();
    try { return decodeURIComponent(v); }
    catch { return v; }
  }
  return null;
}
function rohyFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const tok = readRohyCsrfCookie();
    if (tok) headers['X-CSRF-Token'] = tok;
  }
  return fetch(url, { ...init, headers, credentials: 'include' });
}

// In Rohy mode, ship every aggregated window straight into the Rohy backend
// using same-origin cookie auth + CSRF token. Otherwise stick with the local
// IndexedDB-ish store the standalone dashboard reads from.
const transport = ROHY_MODE
  ? new HttpEmotionTransport({
      baseUrl: '',
      endpointForSession: () => '/api/addons/oyon/emotion-records',
      fetchImpl: rohyFetch,
    })
  : new LocalEmotionTransport({ storageKey: 'standalone-fer-events' });
const logTransport = new LocalLogTransport({ storageKey: 'standalone-oyon-logs' });
const metricTransport = new LocalMetricTransport({ storageKey: 'standalone-oyon-metrics' });
const camera = new CameraController();
let runtime = null;
let running = false;
let paused = false;

// Single source of truth for the IDs that go on every emotion event. In Rohy
// mode, the host app supplies session/case via query params; user/tenant come
// from the auth cookie on the backend. In standalone mode we use stable
// fixtures so the local logs page can group events.
function buildSessionContext(modelProfile) {
  if (ROHY_MODE) {
    return {
      session_id: ROHY_SESSION_ID || null,
      case_id: ROHY_CASE_ID || null,
      source: 'rohy',
      model_profile: modelProfile,
    };
  }
  return {
    session_id: `standalone-session-${modelProfile}`,
    user_id: 'standalone-user-1',
    case_id: 'standalone-case-1',
    tenant_id: 'standalone',
    model_profile: modelProfile,
  };
}

// Before the standalone can POST records, Rohy's backend requires a consent
// row for the active session. Fire-and-forget on first launch in Rohy mode;
// later we can add a UI prompt and route the click through this same call.
async function ensureRohyConsent() {
  if (!ROHY_MODE || !ROHY_SESSION_ID) return;
  try {
    await rohyFetch('/api/addons/oyon/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: ROHY_SESSION_ID,
        consent_granted: true,
        source_page: '/oyon/standalone/?source=rohy',
      }),
    });
  } catch (err) {
    console.warn('[oyon] consent POST failed, capture may be rejected:', err);
  }
}
ensureRohyConsent();
let settings = loadSettings();

// Single source of truth: whenever the standalone is served from a Rohy
// origin (same origin as `/api/addons/oyon/config`), we honor the tenant
// admin's model + runtime choice. We try this *unconditionally* — not just
// when ?source=rohy is present — because a user opening /oyon/standalone/
// directly is still inside the Rohy deployment and should see the tenant
// model, not whatever happens to be in their localStorage. If the API
// isn't reachable (no auth, OYON_ENABLED=0, dev/QA outside Rohy) we
// gracefully fall back to localStorage and the in-page picker stays live.
async function applyRohyTenantConfig() {
  let r;
  try {
    const res = await fetch('/api/addons/oyon/config', { credentials: 'include' });
    if (!res.ok) {
      console.info('[oyon] standalone running in local mode (config unreachable: ' + res.status + ')');
      return;
    }
    const config = await res.json();
    r = config?.runtime;
    if (!r) return;
  } catch (err) {
    console.info('[oyon] standalone running in local mode (config fetch error)', err?.message || err);
    return;
  }

  settings = normalizeSettings({
    ...settings,
    model: MODEL_PROFILES[r.model_profile] ? r.model_profile : settings.model,
    sampleIntervalMs: r.sample_interval_ms ?? settings.sampleIntervalMs,
    windowMs: r.window_ms ?? settings.windowMs,
    minValidFrames: r.min_valid_frames ?? settings.minValidFrames,
    smoothingAlpha: r.smoothing_alpha ?? settings.smoothingAlpha,
    minHoldMs: r.min_hold_ms ?? settings.minHoldMs,
    minSwitchConfidence: r.min_switch_confidence ?? settings.minSwitchConfidence,
  });
  applySettingsToControls();

  // The bootstrap above already painted the pill + render hint with the
  // *previous* model name (from localStorage). Re-paint them now so the UI
  // reflects what the runtime is actually going to use. Without this, the
  // pill says one model name while inference uses another — which is exactly
  // the "we're still using two models" symptom.
  if (els.pillModel) els.pillModel.textContent = modelLabelShort(settings.model);
  renderPrediction({ probabilities: null, hint: modelHint(settings.model) });

  if (els.modelSelect) {
    els.modelSelect.disabled = true;
    els.modelSelect.title = 'Model is set by the tenant admin in Rohy → Settings → Oyon';
  }
  // If the user is already running when the override lands (rare — fetch is
  // typically faster than starting capture), restart so inference picks up
  // the new model. No-op if not running.
  if (running) startSelectedModel();

  console.info('[oyon] standalone applied tenant config', { model: settings.model, windowMs: settings.windowMs, rohyMode: ROHY_MODE });
}
let latestFace = null;
let latestDisplay = null;

// fps + telemetry
const fpsWindowMs = 4000;
const sampleStamps = []; // sliding window of sample timestamps for FPS
let sampleCount = 0;
let lastSampleAt = 0;
let lastSampleLatencyMs = null;

// rolling timeline buffer
const timelineWindowMs = 60_000;
const timeline = []; // { t, label, conf, valence, arousal }

// affect-pad trail
const affectTrail = []; // { v, a, t }

// ---------- bootstrap ----------
applySettingsToControls();
bindUi();
applyRohyTenantConfig();
renderPrediction({ probabilities: null, hint: modelHint(els.modelSelect.value) });
els.pillModel.textContent = modelLabelShort(els.modelSelect.value);
setRunState('idle');
window.addEventListener('resize', () => { drawOverlay(); drawTimeline(); });
setInterval(updateFps, 500);
requestAnimationFrame(animateAffect);

function bindUi() {
  els.startBtn.onclick = () => startSelectedModel();
  els.pauseBtn.onclick = () => doPause();
  els.resumeBtn.onclick = () => doResume();
  els.stopBtn.onclick = () => doStop();
  els.opsRefresh.onclick = () => renderOperations();
  els.opsExport.onclick = () => exportOyonData('operations');
  els.opsClear.onclick = clearOyonData;
  els.opsLevelFilter.onchange = () => renderOperations();
  els.dynajRefresh.onclick = () => renderDynaJ();
  els.dynajExport.onclick = () => exportOyonData('dynaj');

  els.settingsToggle.onclick = () => openDrawer(true);
  els.drawerClose.onclick = () => openDrawer(false);
  els.drawerBackdrop.onclick = () => openDrawer(false);
  for (const tab of els.drawerTabs) {
    tab.onclick = () => selectTab(tab.dataset.tab);
  }

  els.modelSelect.onchange = async () => {
    updateSettingsFromControls();
    saveSettings();
    els.pillModel.textContent = modelLabelShort(els.modelSelect.value);
    if (!running) {
      renderPrediction({ probabilities: null, hint: modelHint(els.modelSelect.value) });
      return;
    }
    await startSelectedModel();
  };
  for (const ctl of [els.sampleInterval, els.smoothingAlpha, els.holdMs, els.switchConfidence, els.windowMs, els.minValidFrames]) {
    ctl.oninput = () => { updateSettingsFromControls(); updateSettingLabels(); };
    ctl.onchange = async () => {
      updateSettingsFromControls();
      saveSettings();
      if (running) await startSelectedModel();
    };
  }

  // Camera-view sliders: cheap visual updates, no model restart needed.
  for (const ctl of [els.cameraZoom, els.cameraOffsetX, els.cameraOffsetY, els.cameraSize]) {
    ctl.oninput = () => { updateSettingsFromControls(); updateSettingLabels(); };
    ctl.onchange = () => { updateSettingsFromControls(); saveSettings(); };
  }
  els.cameraReset.onclick = () => {
    const d = defaultSettings();
    settings = normalizeSettings({
      ...settings,
      cameraZoom: d.cameraZoom,
      cameraOffsetX: d.cameraOffsetX,
      cameraOffsetY: d.cameraOffsetY,
      cameraSize: d.cameraSize,
    });
    applySettingsToControls();
    saveSettings();
  };

  document.addEventListener('keydown', onKeydown);
}

function onKeydown(event) {
  const tag = (event.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (event.key === 'Escape') { openDrawer(false); return; }
  if (event.key === ' ' || event.key === 'Spacebar') {
    if (!running) return;
    event.preventDefault();
    paused ? doResume() : doPause();
    return;
  }
  if (event.key === 's' || event.key === 'S') {
    if (!running) startSelectedModel();
  } else if (event.key === 'x' || event.key === 'X') {
    if (running) doStop();
  }
}

// ---------- runtime control ----------
async function startSelectedModel() {
  try {
    setRunState('initializing');
    running = false;
    paused = false;
    // Replacing the runtime: dispose the old one fully so ONNX session,
    // MediaPipe FaceLandmarker, and any WebGPU pipelines are released.
    // stop() alone keeps those resources alive for restart; calling start
    // with a different model would otherwise leak them across switches.
    try { await runtime?.dispose?.(); }
    catch (err) { console.warn('[oyon] dispose on restart failed', err); }
    runtime = null;
    runtime = createRuntime();
    renderPrediction({ probabilities: null, hint: `Loading ${modelLabelShort(els.modelSelect.value)}…` });
    await runtime.start();
    running = true;
    paused = false;

    // Single-consumer fix: detach the in-memory video the CameraController created,
    // route the visible <video> as the only stream consumer, and point the runtime's
    // inference at it so MediaPipe + ONNX read the same element the user sees.
    const internalVideo = camera.video;
    if (internalVideo && internalVideo !== els.preview) {
      try { internalVideo.pause(); } catch {}
      internalVideo.srcObject = null;
    }
    els.preview.srcObject = camera.stream;
    await els.preview.play();
    camera.video = els.preview;

    els.previewEmpty.hidden = true;
    setRunState('running');
    setQualityBanner('warn', 'Looking for a face…');
    updateButtons();
  } catch (error) {
    setRunState('error');
    showToast(`Camera error: ${error.message}`);
    renderPrediction({ probabilities: null, hint: error.message });
    updateButtons();
  }
}

function doPause() {
  if (!running || paused) return;
  runtime?.pause();
  paused = true;
  setRunState('paused');
  updateButtons();
}

function doResume() {
  if (!running || !paused) return;
  runtime?.resume();
  paused = false;
  setRunState('running');
  updateButtons();
}

async function doStop() {
  // Permanent stop — release everything. Repeated start/stop cycles would
  // otherwise pile up resources.
  try { await runtime?.dispose?.(); }
  catch (err) { console.warn('[oyon] dispose on stop failed', err); }
  runtime = null;
  els.preview.srcObject = null;
  els.previewEmpty.hidden = false;
  latestFace = null;
  latestDisplay = null;
  els.faceBox.hidden = true;
  running = false;
  paused = false;
  sampleStamps.length = 0;
  setRunState('stopped');
  setQualityBanner(null);
  updateButtons();
}

function updateButtons() {
  els.startBtn.disabled = running;
  els.startBtn.hidden = running;
  els.pauseBtn.disabled = !running || paused;
  els.pauseBtn.hidden = paused;
  els.resumeBtn.disabled = !paused;
  els.resumeBtn.hidden = !paused;
  els.stopBtn.disabled = !running;
}

function setRunState(state) {
  const labelMap = {
    idle: 'idle',
    initializing: 'initializing…',
    running: 'capturing',
    paused: 'paused',
    stopped: 'stopped',
    error: 'error',
  };
  els.status.dataset.state = state;
  els.status.querySelector('strong').textContent = labelMap[state] || state;
}

function setQualityBanner(level, text) {
  if (!level) { els.qualityBanner.hidden = true; return; }
  els.qualityBanner.hidden = false;
  els.qualityBanner.dataset.level = level;
  els.qualityBannerText.textContent = text;
}

// ---------- runtime construction ----------
function createRuntime() {
  const modelProfile = settings.model;
  const modelConfig = modelConfigFor(modelProfile);
  const classifier = new OnnxEmotionClassifier(modelConfig);
  const labels = modelConfig.labels;
  const smoother = new PredictionSmoother({
    labels,
    alpha: settings.smoothingAlpha,
    minHoldMs: settings.minHoldMs,
    minSwitchConfidence: settings.minSwitchConfidence,
  });

  const next = new EmotionRuntime({
    sampleIntervalMs: settings.sampleIntervalMs,
    consentVersion: 'standalone-dev',
    settings: toOyonSettings(settings),
    faceTracker: new MediaPipeFaceTracker({
      wasmBaseUrl: '/standalone/vendor/mediapipe/wasm',
      modelAssetPath: '/standalone/models/mediapipe/face_landmarker.task',
    }),
    classifier,
    aggregator: new EmotionAggregator({
      windowMs: settings.windowMs,
      minValidFrames: settings.minValidFrames,
      sampleIntervalMs: settings.sampleIntervalMs,
      labels,
    }),
    transport,
    logger: new OyonLogger({
      source: 'oyon-standalone',
      transports: [logTransport],
      contextProvider: () => buildSessionContext(modelProfile),
    }),
    metrics: new OyonMetricRecorder({
      source: 'oyon-standalone',
      transports: [metricTransport],
      contextProvider: () => buildSessionContext(modelProfile),
    }),
    camera,
    contextProvider: () => buildSessionContext(modelProfile),
  });

  next.on('status', event => {
    // map runtime state -> our pill state if not in error
    const map = { running: 'running', paused: 'paused', stopped: 'stopped', initializing: 'initializing' };
    const next = map[event.state] || event.state;
    if (els.status.dataset.state !== 'error') setRunState(next);
  });
  next.on('sample', event => {
    const now = performance.now();
    const smoothed = smoother.update(event.prediction);
    latestFace = event.face || null;
    latestDisplay = smoothed ? {
      label: smoothed.visibleLabel,
      confidence: smoothed.visibleConfidence,
      probabilities: smoothed.probabilities,
    } : null;

    // FPS / latency telemetry
    sampleStamps.push(now);
    while (sampleStamps.length && now - sampleStamps[0] > fpsWindowMs) sampleStamps.shift();
    if (lastSampleAt) lastSampleLatencyMs = Math.round(now - lastSampleAt);
    lastSampleAt = now;
    sampleCount += 1;
    els.pillSamples.textContent = String(sampleCount);
    if (lastSampleLatencyMs !== null) els.pillLatency.textContent = `${lastSampleLatencyMs} ms`;

    // quality banner
    updateQuality(latestFace);

    // timeline
    if (smoothed?.visibleLabel) {
      timeline.push({
        t: Date.now(),
        label: smoothed.visibleLabel,
        conf: smoothed.visibleConfidence ?? 0,
        valence: smoothed.valence ?? null,
        arousal: smoothed.arousal ?? null,
      });
      const cutoff = Date.now() - timelineWindowMs;
      while (timeline.length && timeline[0].t < cutoff) timeline.shift();
    }

    // affect pad
    if (Number.isFinite(smoothed?.valence) && Number.isFinite(smoothed?.arousal)) {
      affectTrail.push({ v: smoothed.valence, a: smoothed.arousal, t: now });
      if (affectTrail.length > 60) affectTrail.shift();
    }

    drawOverlay();
    drawTimeline();
    renderPrediction({
      model: modelConfig.modelName,
      profile: modelProfile,
      supportsValenceArousal: modelConfig.supportsValenceArousal,
      probabilities: smoothed?.probabilities || null,
      visibleLabel: smoothed?.visibleLabel || null,
      visibleConfidence: smoothed?.visibleConfidence ?? null,
      valence: smoothed?.valence ?? null,
      arousal: smoothed?.arousal ?? null,
      confidence: smoothed?.confidence ?? null,
    });
    updateButtons();
  });
  next.on('error', error => {
    setRunState('error');
    showToast(`Runtime error: ${error.message}`);
  });

  return next;
}

function updateQuality(face) {
  if (!face) {
    setQualityBanner('warn', 'Looking for a face…');
    return;
  }
  if (!face.facePresent) {
    if (face.reason === 'duplicate-frame') {
      setQualityBanner(null);
      return;
    }
    setQualityBanner('bad', 'No face detected — face the camera.');
    return;
  }
  // multiplication never returns nullish, so `??` would be a no-op; fall
  // back to `||` to also catch 0 / NaN bbox dimensions as "no signal yet".
  const ratio = face.quality?.faceAreaRatio ?? ((face.bbox?.width * face.bbox?.height) || 0);
  if (ratio < 0.04) {
    setQualityBanner('warn', 'Face is small — move closer to the camera.');
  } else if (face.bbox && (face.bbox.x < 0.05 || face.bbox.x + face.bbox.width > 0.95)) {
    setQualityBanner('warn', 'Face is near the edge — recenter.');
  } else {
    setQualityBanner('ok', 'Face tracked.');
  }
}

function updateFps() {
  if (sampleStamps.length < 2) {
    els.pillFps.textContent = running ? '…' : '0.0';
    return;
  }
  const span = (sampleStamps[sampleStamps.length - 1] - sampleStamps[0]) / 1000;
  const fps = span > 0 ? (sampleStamps.length - 1) / span : 0;
  els.pillFps.textContent = fps.toFixed(1);
}

// ---------- overlay (DOM-based, no canvas-over-video to fight the compositor) ----------
function drawOverlay() {
  const wrap = els.preview.parentElement;
  if (!wrap) return;
  if (!latestFace?.facePresent || !latestFace.bbox) {
    els.faceBox.hidden = true;
    return;
  }
  // offsetWidth/Height are layout-space dims (ignore CSS transforms on the
  // parent), so face-box coords stay correct even when the .preview-zoom
  // wrapper is scaled by the camera-zoom setting.
  const area = visibleVideoArea(wrap.offsetWidth, wrap.offsetHeight);
  const left = area.x + latestFace.bbox.x * area.width;
  const top = area.y + latestFace.bbox.y * area.height;
  const w = latestFace.bbox.width * area.width;
  const h = latestFace.bbox.height * area.height;
  const label = latestDisplay?.label || 'detecting';
  const confidence = latestDisplay?.confidence || 0;
  const tone = colorFor(label);

  els.faceBox.hidden = false;
  els.faceBox.style.setProperty('--box-color', tone);
  els.faceBox.style.left = `${Math.max(0, left)}px`;
  els.faceBox.style.top = `${Math.max(0, top)}px`;
  els.faceBox.style.width = `${Math.max(0, w)}px`;
  els.faceBox.style.height = `${Math.max(0, h)}px`;
  els.faceLabelText.textContent = `${label} ${percent(confidence)}`;
}

function visibleVideoArea(width, height) {
  const videoWidth = els.preview.videoWidth || width || 1;
  const videoHeight = els.preview.videoHeight || height || 1;
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  return {
    x: (width - renderedWidth) / 2,
    y: (height - renderedHeight) / 2,
    width: renderedWidth,
    height: renderedHeight,
  };
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const num = parseInt(value, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------- prediction card rendering (in-place updates, no innerHTML thrash) ----------
function renderPrediction(data) {
  if (!data.probabilities) {
    els.prediction.dataset.empty = 'true';
    els.predictionEmpty.hidden = false;
    els.predictionEmpty.textContent = data.hint || 'No face detected yet.';
    els.predictionBody.hidden = true;
    return;
  }

  els.prediction.dataset.empty = 'false';
  els.predictionEmpty.hidden = true;
  els.predictionBody.hidden = false;

  const entries = Object.entries(data.probabilities).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;

  // "Most likely" shows the live top of the smoothed distribution, not the
  // display-stable visibleLabel — the latter is held by minHoldMs/min-switch
  // confidence in the smoother and can lag for several seconds, making the
  // headline appear stuck even as the model output changes.
  const topEmotion = entries[0][0];
  const topValue = entries[0][1];
  const tone = colorFor(topEmotion);

  els.emotionName.textContent = topEmotion;
  els.emotionName.style.color = tone;
  els.emotionSwatch.style.background = tone;
  els.emotionSwatch.style.boxShadow = `0 0 18px ${hexToRgba(tone, 0.6)}`;
  els.confValue.textContent = percent(topValue);
  els.modelLineLabel.textContent = modelLabelShort(data.profile);
  els.modelLineHint.textContent = modelHint(data.profile);

  if (data.supportsValenceArousal) {
    const v = Number.isFinite(data.valence) ? data.valence : 0;
    const a = Number.isFinite(data.arousal) ? data.arousal : 0;
    applySignedBar(els.valenceBar, v);
    applySignedBar(els.arousalBar, a);
    els.valenceNum.textContent = v.toFixed(2);
    els.arousalNum.textContent = a.toFixed(2);
    els.valenceNum.classList.remove('unavailable');
    els.arousalNum.classList.remove('unavailable');
    els.vaNote.textContent = 'Valence: negative ↔ positive · Arousal: calm ↔ activated.';
  } else {
    applySignedBar(els.valenceBar, 0);
    applySignedBar(els.arousalBar, 0);
    els.valenceNum.textContent = 'n/a';
    els.arousalNum.textContent = 'n/a';
    els.valenceNum.classList.add('unavailable');
    els.arousalNum.classList.add('unavailable');
    els.vaNote.textContent = 'This model does not output valence/arousal.';
  }

  renderProbRows(entries);
}

function applySignedBar(node, value) {
  const v = Math.max(-1, Math.min(1, value));
  if (v >= 0) {
    node.style.left = '50%';
    node.style.width = `${(v * 50).toFixed(1)}%`;
  } else {
    node.style.left = `${(50 + v * 50).toFixed(1)}%`;
    node.style.width = `${Math.abs(v * 50).toFixed(1)}%`;
  }
}

function renderProbRows(entries) {
  const list = els.probList;
  // Re-key by label so we can update existing rows instead of recreating them
  const known = new Map();
  for (const child of list.children) known.set(child.dataset.label, child);
  const seen = new Set();
  for (const [label, value] of entries) {
    seen.add(label);
    let row = known.get(label);
    const pct = Math.round((Number(value) || 0) * 100);
    if (!row) {
      row = document.createElement('div');
      row.className = 'prob-row';
      row.dataset.label = label;
      row.innerHTML = `<span class="label"></span><div class="bar"><span></span></div><span class="num"></span>`;
      list.appendChild(row);
    }
    row.style.setProperty('--row-color', colorFor(label));
    row.querySelector('.label').textContent = label;
    row.querySelector('.bar > span').style.width = `${pct}%`;
    row.querySelector('.num').textContent = `${pct}%`;
  }
  for (const [label, node] of known) if (!seen.has(label)) node.remove();
}

// ---------- affect pad ----------
function drawAffectPad() {
  const canvas = document.querySelector('#affectPad');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  // crosshairs
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  // outer ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  const inset = 10;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // quadrant tints (Russell circumplex hint)
  const tints = [
    { x: w / 2, y: 0, color: 'rgba(248, 113, 113, 0.06)' }, // top-left: anger/fear
    { x: w / 2, y: 0, color: 'rgba(251, 191, 36, 0.06)' },  // top-right: happy/surprise
    { x: 0, y: h / 2, color: 'rgba(96, 165, 250, 0.05)' },  // bottom-left: sad
    { x: w / 2, y: h / 2, color: 'rgba(52, 211, 153, 0.05)' }, // bottom-right: calm/content
  ];
  // simple corner gradients
  tints.forEach(({ x, y, color }) => {
    ctx.fillStyle = color;
    ctx.fillRect(x - (x === 0 ? 0 : 0), y, w / 2, h / 2);
  });

  // trail
  if (affectTrail.length > 1) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    affectTrail.forEach((pt, i) => {
      const px = ((pt.v + 1) / 2) * w;
      const py = (1 - (pt.a + 1) / 2) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // current point
  if (affectTrail.length > 0) {
    const last = affectTrail[affectTrail.length - 1];
    const px = ((last.v + 1) / 2) * w;
    const py = (1 - (last.a + 1) / 2) * h;
    const tone = colorFor(latestDisplay?.label || 'neutral');
    ctx.fillStyle = hexToRgba(tone, 0.25);
    ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = tone;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.stroke();
  }
}

function animateAffect() {
  drawAffectPad();
  requestAnimationFrame(animateAffect);
}

// ---------- timeline (valence + arousal as two lines) ----------
const TIMELINE_VALENCE_COLOR = '#22d3ee';
const TIMELINE_AROUSAL_COLOR = '#fbbf24';

function drawTimeline() {
  const canvas = els.timeline;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  // zero baseline + ±1 tick lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(w, 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, h - 4); ctx.lineTo(w, h - 4); ctx.stroke();

  // axis labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('+1', 4, 12);
  ctx.fillText(' 0', 4, h / 2 - 2);
  ctx.fillText('−1', 4, h - 6);

  if (timeline.length === 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('No samples yet.', 24, h / 2 - 8);
    renderLegend({ hasValence: false, hasArousal: false });
    return;
  }

  const now = Date.now();
  const start = now - timelineWindowMs;
  const xFor = t => ((t - start) / timelineWindowMs) * w;
  const yFor = v => (1 - (v + 1) / 2) * (h - 8) + 4;

  const valencePoints = timeline.filter(p => Number.isFinite(p.valence)).map(p => ({ x: xFor(p.t), y: yFor(p.valence) }));
  const arousalPoints = timeline.filter(p => Number.isFinite(p.arousal)).map(p => ({ x: xFor(p.t), y: yFor(p.arousal) }));

  drawLine(ctx, valencePoints, TIMELINE_VALENCE_COLOR);
  drawLine(ctx, arousalPoints, TIMELINE_AROUSAL_COLOR);

  if (!valencePoints.length && !arousalPoints.length) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('This model does not output valence/arousal.', 24, h / 2 - 8);
  }

  renderLegend({ hasValence: valencePoints.length > 0, hasArousal: arousalPoints.length > 0 });
}

function drawLine(ctx, points, color) {
  if (points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();

  if (points.length > 0) {
    const last = points[points.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function renderLegend({ hasValence, hasArousal }) {
  if (!els.timelineLegend) return;
  const note = hasValence || hasArousal
    ? `<span class="item"><span class="swatch" style="background:${TIMELINE_VALENCE_COLOR};"></span>Valence (negative ↔ positive)</span>` +
      `<span class="item"><span class="swatch" style="background:${TIMELINE_AROUSAL_COLOR};"></span>Arousal (calm ↔ activated)</span>`
    : '<span style="color: var(--ink-3);">Run a session with a model that supports valence/arousal to populate the timeline.</span>';
  els.timelineLegend.innerHTML = note;
}

// ---------- operations + DynaJ UI ----------
function readOyonData() {
  const events = logTransport.read();
  const metrics = metricTransport.read();
  const windows = transport.read();
  return { events, metrics, windows };
}

function renderOperations() {
  const { events, metrics, windows } = readOyonData();
  const level = els.opsLevelFilter.value;
  const filteredEvents = level === 'all' ? events : events.filter(event => event.level === level);
  const latestWindow = windows[windows.length - 1] || null;

  els.opsEventCount.textContent = String(events.length);
  els.opsMetricCount.textContent = String(metrics.length);
  els.opsWindowCount.textContent = String(windows.length);
  els.opsQuality.textContent = latestWindow ? percent(1 - (latestWindow.missing_face_ratio || 0)) : '—';

  renderEventList(els.opsEvents, filteredEvents.slice(-12).reverse());
  renderMetricList(els.opsMetrics, latestMetrics(metrics));
  renderWindowList(els.opsWindows, windows.slice(-8).reverse());
}

function renderDynaJ() {
  const { windows } = readOyonData();
  const withDynamics = windows.filter(window => window.dynamics);
  const latest = withDynamics[withDynamics.length - 1] || null;
  els.dynajWindowCount.textContent = String(withDynamics.length);
  els.dynajSpeed.textContent = latest?.dynamics?.affect_speed != null ? latest.dynamics.affect_speed.toFixed(3) : '—';
  els.dynajInstability.textContent = latest?.dynamics?.instability_score != null ? latest.dynamics.instability_score.toFixed(2) : '—';
  els.dynajPhase.textContent = latest?.dynamics?.phase_quadrant ? phaseLabel(latest.dynamics.phase_quadrant) : '—';

  if (!withDynamics.length) {
    setEmpty(els.dynajLatest, 'No dynamics yet. Run a capture session until at least one aggregate window is emitted.');
    setEmpty(els.dynajTransitions, 'No label transitions yet.');
    return;
  }

  renderDynamicsList(els.dynajLatest, withDynamics.slice(-8).reverse());
  renderTransitionList(els.dynajTransitions, withDynamics.filter(window => window.dynamics?.label_changed).slice(-8).reverse());
}

function renderEventList(node, events) {
  node.replaceChildren();
  if (!events.length) {
    setEmpty(node, 'No runtime events match the selected filter.');
    return;
  }
  for (const event of events) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.append(
      textSpan('time', shortTime(event.timestamp)),
      textSpan('name', event.event_name || 'unknown'),
      levelPill(event.level),
    );
    node.appendChild(row);
  }
}

function renderMetricList(node, metrics) {
  node.replaceChildren();
  if (!metrics.length) {
    setEmpty(node, 'No metrics recorded yet.');
    return;
  }
  for (const metric of metrics) {
    const row = document.createElement('div');
    row.className = 'metric-row';
    row.append(
      textSpan('name', metric.metric_name || 'metric'),
      textSpan('value', `${formatNumber(metric.metric_value)}${metric.metric_unit ? ` ${metric.metric_unit}` : ''}`),
    );
    node.appendChild(row);
  }
}

function renderWindowList(node, windows) {
  node.replaceChildren();
  if (!windows.length) {
    setEmpty(node, 'No aggregate emotion windows yet.');
    return;
  }
  for (const window of windows) {
    const row = document.createElement('div');
    row.className = 'window-row';
    const main = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = window.dominant_emotion || 'insufficient data';
    const meta = textSpan('meta', `${shortTime(window.window_end)} · conf ${percent(window.confidence || 0)} · valid ${window.valid_frames || 0}`);
    main.append(label, document.createElement('br'), meta);
    row.append(main, textSpan('meta', `miss ${percent(window.missing_face_ratio || 0)}`));
    node.appendChild(row);
  }
}

function renderDynamicsList(node, windows) {
  node.replaceChildren();
  for (const window of windows) {
    const d = window.dynamics;
    const row = document.createElement('div');
    row.className = 'window-row';
    const main = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = phaseLabel(d.phase_quadrant) || 'unphased';
    const meta = textSpan('meta', `${shortTime(window.window_end)} · speed ${formatNumber(d.affect_speed)} · instability ${formatNumber(d.instability_score)}`);
    main.append(label, document.createElement('br'), meta);
    row.append(main, textSpan('meta', `v ${formatNumber(d.valence_velocity)} · a ${formatNumber(d.arousal_velocity)}`));
    node.appendChild(row);
  }
}

function renderTransitionList(node, windows) {
  node.replaceChildren();
  if (!windows.length) {
    setEmpty(node, 'No dominant-label transitions have persisted into aggregate windows.');
    return;
  }
  for (const window of windows) {
    const d = window.dynamics;
    const row = document.createElement('div');
    row.className = 'window-row';
    const main = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = `${d.transition_from || 'unknown'} → ${d.transition_to || 'unknown'}`;
    const meta = textSpan('meta', `${shortTime(window.window_end)} · instability ${formatNumber(d.instability_score)}`);
    main.append(label, document.createElement('br'), meta);
    row.append(main, textSpan('meta', phaseLabel(d.phase_quadrant) || '—'));
    node.appendChild(row);
  }
}

function latestMetrics(metrics) {
  const byName = new Map();
  for (const metric of metrics) byName.set(metric.metric_name, metric);
  return Array.from(byName.values()).slice(-8).reverse();
}

function exportOyonData(scope) {
  const payload = {
    exportedAt: new Date().toISOString(),
    scope,
    settings,
    ...readOyonData(),
  };
  downloadJson(`oyon-${scope}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, payload);
  showToast(`Exported ${scope} JSON.`);
}

function clearOyonData() {
  logTransport.clear();
  metricTransport.clear();
  transport.clear();
  timeline.length = 0;
  affectTrail.length = 0;
  renderOperations();
  renderDynaJ();
  drawTimeline();
  showToast('Cleared local Oyon logs, metrics, and windows.');
}

function setEmpty(node, text) {
  node.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = text;
  node.appendChild(empty);
}

function textSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function levelPill(level) {
  const span = textSpan('level-pill', level || 'info');
  span.dataset.level = level || 'info';
  return span;
}

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(Math.abs(value) >= 10 ? 1 : 3).replace(/\.?0+$/, '') : '—';
}

function phaseLabel(value) {
  if (!value) return null;
  return value.replaceAll('-', ' ');
}

// ---------- export ----------
function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- drawer ----------
function openDrawer(open) {
  els.drawer.dataset.open = String(open);
  els.drawerBackdrop.dataset.open = String(open);
  if (open) {
    renderOperations();
    renderDynaJ();
  }
}
function selectTab(name) {
  for (const tab of els.drawerTabs) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const pane of els.drawerPanes) pane.hidden = pane.dataset.pane !== name;
  if (name === 'operations') renderOperations();
  if (name === 'dynaj') renderDynaJ();
}

// ---------- toast ----------
let toastTimer = null;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.dataset.open = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.dataset.open = 'false'; }, 2400);
}

// ---------- settings ----------
function defaultSettings() {
  return {
    model: DEFAULT_MODEL_PROFILE,
    sampleIntervalMs: 1000,
    smoothingAlpha: 0.28,
    minHoldMs: 3000,
    minSwitchConfidence: 0.5,
    windowMs: 10000,
    minValidFrames: 6,
    cameraZoom: 1,
    cameraOffsetX: 0,
    cameraOffsetY: 0,
    cameraSize: 360,
  };
}
function loadSettings() {
  try {
    return normalizeSettings({ ...defaultSettings(), ...JSON.parse(localStorage.getItem('standalone-fer-settings') || '{}') });
  } catch {
    return defaultSettings();
  }
}
function saveSettings() {
  localStorage.setItem('standalone-fer-settings', JSON.stringify(settings));
}
function applySettingsToControls() {
  settings = normalizeSettings(settings);
  els.modelSelect.value = settings.model;
  els.sampleInterval.value = String(settings.sampleIntervalMs);
  els.smoothingAlpha.value = String(settings.smoothingAlpha);
  els.holdMs.value = String(settings.minHoldMs);
  els.switchConfidence.value = String(settings.minSwitchConfidence);
  els.windowMs.value = String(settings.windowMs);
  els.minValidFrames.value = String(settings.minValidFrames);
  els.cameraZoom.value = String(settings.cameraZoom);
  els.cameraOffsetX.value = String(settings.cameraOffsetX);
  els.cameraOffsetY.value = String(settings.cameraOffsetY);
  els.cameraSize.value = String(settings.cameraSize);
  updateSettingLabels();
  applyCameraView();
}

function applyCameraView() {
  const root = els.previewWrap;
  if (!root) return;
  root.style.setProperty('--cam-zoom', String(settings.cameraZoom));
  root.style.setProperty('--cam-offset-x', `${settings.cameraOffsetX}%`);
  root.style.setProperty('--cam-offset-y', `${settings.cameraOffsetY}%`);
  root.style.setProperty('--cam-size', `${settings.cameraSize}px`);
  // .stage owns the column-width var too so the card can grow with the preview.
  document.querySelector('.stage')?.style.setProperty('--cam-size', `${settings.cameraSize}px`);
}
function updateSettingsFromControls() {
  settings = normalizeSettings({
    model: els.modelSelect.value,
    sampleIntervalMs: Number(els.sampleInterval.value),
    smoothingAlpha: Number(els.smoothingAlpha.value),
    minHoldMs: Number(els.holdMs.value),
    minSwitchConfidence: Number(els.switchConfidence.value),
    windowMs: Number(els.windowMs.value),
    minValidFrames: Number(els.minValidFrames.value),
    cameraZoom: Number(els.cameraZoom.value),
    cameraOffsetX: Number(els.cameraOffsetX.value),
    cameraOffsetY: Number(els.cameraOffsetY.value),
    cameraSize: Number(els.cameraSize.value),
  });
  els.minValidFrames.value = String(settings.minValidFrames);
  applyCameraView();
}
function updateSettingLabels() {
  syncMinValidFrameControl();
  document.querySelector('#sampleIntervalValue').textContent = `${els.sampleInterval.value} ms`;
  document.querySelector('#smoothingAlphaValue').textContent = Number(els.smoothingAlpha.value).toFixed(2);
  document.querySelector('#holdMsValue').textContent = `${els.holdMs.value} ms`;
  document.querySelector('#switchConfidenceValue').textContent = `${Math.round(Number(els.switchConfidence.value) * 100)}%`;
  document.querySelector('#windowMsValue').textContent = `${Number(els.windowMs.value) / 1000}s`;
  document.querySelector('#minValidFramesValue').textContent = `${els.minValidFrames.value} frames`;
  document.querySelector('#cameraZoomValue').textContent = `${Number(els.cameraZoom.value).toFixed(2)}×`;
  document.querySelector('#cameraOffsetXValue').textContent = `${els.cameraOffsetX.value}%`;
  document.querySelector('#cameraOffsetYValue').textContent = `${els.cameraOffsetY.value}%`;
  document.querySelector('#cameraSizeValue').textContent = `${els.cameraSize.value}px`;
}

function normalizeSettings(next) {
  const defaults = defaultSettings();
  const sampleIntervalMs = Number(next.sampleIntervalMs) || defaults.sampleIntervalMs;
  const windowMs = Number(next.windowMs) || defaults.windowMs;
  const maxValidFrames = expectedSamplesPerWindow(sampleIntervalMs, windowMs);
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, num(value, fallback)));
  const model = MODEL_PROFILES[next.model] ? next.model : defaults.model;
  return {
    ...next,
    model,
    sampleIntervalMs,
    windowMs,
    minValidFrames: Math.max(1, Math.min(num(next.minValidFrames, defaults.minValidFrames), maxValidFrames)),
    cameraZoom: clamp(next.cameraZoom, 1, 3, defaults.cameraZoom),
    cameraOffsetX: clamp(next.cameraOffsetX, -30, 30, defaults.cameraOffsetX),
    cameraOffsetY: clamp(next.cameraOffsetY, -30, 30, defaults.cameraOffsetY),
    cameraSize: clamp(next.cameraSize, 280, 640, defaults.cameraSize),
  };
}

function toOyonSettings(localSettings) {
  return createOyonSettings({
    profile_id: 'learning-analytics',
    model_profile: localSettings.model,
    sample_interval_ms: localSettings.sampleIntervalMs,
    aggregate_window_ms: localSettings.windowMs,
    min_valid_frames: localSettings.minValidFrames,
    smoothing_alpha: localSettings.smoothingAlpha,
    min_hold_ms: localSettings.minHoldMs,
    switch_confidence: localSettings.minSwitchConfidence,
    logging_mode: 'windows-and-runtime',
    enable_dynamics: true,
  });
}

function syncMinValidFrameControl() {
  const maxValidFrames = expectedSamplesPerWindow(Number(els.sampleInterval.value), Number(els.windowMs.value));
  els.minValidFrames.max = String(maxValidFrames);
  if (Number(els.minValidFrames.value) > maxValidFrames) {
    els.minValidFrames.value = String(maxValidFrames);
  }
}

function expectedSamplesPerWindow(sampleIntervalMs, windowMs) {
  return Math.max(1, Math.floor(windowMs / sampleIntervalMs) + 1);
}

// ---------- labels ----------
function modelLabelShort(profile) {
  return MODEL_PROFILES[profile]?.label || MODEL_PROFILES[DEFAULT_MODEL_PROFILE].label;
}
function modelHint(profile) {
  return MODEL_PROFILES[profile]?.hint || MODEL_PROFILES[DEFAULT_MODEL_PROFILE].hint;
}
function modelConfigFor(profile) {
  return (MODEL_PROFILES[profile] || MODEL_PROFILES[DEFAULT_MODEL_PROFILE]).config;
}

// ---------- utils ----------
function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}
