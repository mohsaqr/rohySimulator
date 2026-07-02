import {
  CameraController,
  EmotionRuntime,
  EmotionAggregator,
  LocalEmotionTransport,
  LocalLogTransport,
  LocalMetricTransport,
  MediaPipeFaceTracker,
  OnnxEmotionClassifier,
  OyonLogger,
  OyonMetricRecorder,
  PredictionSmoother,
  WebGazerAdapter,
  WebEyeTrackAdapter,
  createOyonSettings,
  defineGazeCalibrationOverlay,
  EMOTIEFF_MOBILEVIT_MTL_CONFIG,
  EMOTIEFF_MBF_MTL_CONFIG,
  HSE_EMOTION_MTL_CONFIG,
} from '../src/index.js';

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
  gazeEngine: document.querySelector('#gazeEngine'),
  liveGazeEngine: document.querySelector('#liveGazeEngine'),
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
const localTransport = new LocalEmotionTransport({ storageKey: 'standalone-fer-events' });
// Wrap so live UI panels can update on every window flush without polling
// localStorage. Underlying LocalEmotionTransport still receives the batch.
const transport = {
  async send(events) {
    try { onLiveWindows(events); } catch (err) { console.warn('live UI update failed:', err); }
    return localTransport.send(events);
  },
  read() { return localTransport.read(); },
  clear() { return localTransport.clear(); },
};
const logTransport = new LocalLogTransport({ storageKey: 'standalone-oyon-logs' });
const metricTransport = new LocalMetricTransport({ storageKey: 'standalone-oyon-metrics' });
const camera = new CameraController();
let runtime = null;
let liveGazeAdapter = null;
let webGazerWasStarted = false;
let running = false;
let paused = false;
let settings = loadSettings();
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
showReloadNote();
renderPrediction({ probabilities: null, hint: modelHint(els.modelSelect.value) });
els.pillModel.textContent = modelLabelShort(els.modelSelect.value);
setRunState('idle');
window.addEventListener('resize', () => { drawOverlay(); drawTimeline(); });

function showReloadNote() {
  let note = '';
  try {
    note = sessionStorage.getItem('oyon:reload-note') || '';
    sessionStorage.removeItem('oyon:reload-note');
  } catch {}
  if (note) setTimeout(() => showToast(note), 100);
}
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
  els.gazeEngine.onchange = () => applyEngineChange(els.gazeEngine.value);
  els.liveGazeEngine.onchange = () => applyEngineChange(els.liveGazeEngine.value);
  paintEngineLicenseNote();
  bindGazeTab();
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
  // Once we've told the user a reload is required, every Start press should
  // re-surface the affordance, not silently retry. Retrying inside a
  // poisoned page session would either fail the same way or appear to
  // succeed while running on stale Emscripten globals — both worse than
  // making the user click "Reload now".
  if (reloadRequired) {
    paintReloadRequiredNote('Reload the page before starting again — Emscripten state is still resident from the previous WebGazer session.');
    showToast('Reload required before starting a new session.', 4000);
    return;
  }
  try {
    setRunState('initializing');
    running = false;
    paused = false;
    // Full disposal of the previous runtime before constructing a new one.
    // The runtime owns the gaze adapter; calling stop() drains the adapter
    // chain, including WebGazerAdapter.dispose() which now also clears the
    // legacy MediaPipe Module globals so a subsequent MediaPipe import gets
    // a clean Emscripten slate. No page reload required.
    try { await runtime?.stop(); } catch (err) {
      console.warn('[oyon/standalone] previous runtime stop() threw', err);
    }
    runtime = null;
    resetGazePanel(`engine: ${gazeEngineLabel(settings.gazeEngine)} · initializing`);
    renderPrediction({ probabilities: null, hint: `Loading ${modelLabelShort(els.modelSelect.value)}…` });
    try {
      runtime = createRuntime();
      await runtime.start();
      // Only mark WebGazer as "started in this session" after start() actually
      // resolves. If begin() threw before MediaPipe touched its WASM globals,
      // there's no Emscripten state to clean up — gating future switches
      // behind the reload-required path would be incorrect.
      if (settings.gazeEngine === 'webgazer') webGazerWasStarted = true;
    } catch (initError) {
      // Switching from WebGazer to MediaPipe / WebEyeTrack can hit Emscripten
      // global pollution that the defensive cleanup didn't catch. Detect
      // that family of failures and offer the user a manual reload — never
      // call window.location.reload() ourselves, since this code is reused
      // by host apps (Rohy) that won't tolerate a silent reload mid-session.
      if (webGazerWasStarted && isEmscriptenBoundaryFailure(initError)) {
        promptReloadForWebGazerBoundary(initError);
        return;
      }
      throw initError;
    }
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

/**
 * Surface a manual-reload affordance when in-page engine switching fails
 * because WebGazer's legacy MediaPipe globals couldn't be fully cleared.
 *
 * This intentionally does NOT call window.location.reload() — the previous
 * version did, and it broke host SPA state. Users (and host apps) decide
 * when to reload; we just say "this is why."
 */
/**
 * Heuristic: did this init error come from Emscripten / WASM module-loading
 * crosstalk between WebGazer's bundled MediaPipe runtime and the Tasks
 * Vision package Oyon loads? Real-world failures I've observed surface as:
 *   - Error.message ~ /Module|arguments_|wasm/
 *   - Error.message ~ /Aborted/    (Emscripten runtime abort)
 *   - Error.message ~ /Emscripten/
 *   - Error.message ~ /FilesetResolver/   (Tasks Vision wasm bootstrap)
 *   - Error.name === 'RuntimeError' | 'LinkError'   (WebAssembly stage)
 * Any one of these → reload affordance. Keep this conservative; a false
 * positive just over-suggests "reload to switch engines," which is a
 * lower-cost outcome than a false negative (silent Camera error toast).
 */
function isEmscriptenBoundaryFailure(error) {
  if (!error) return false;
  const name = String(error.name || '');
  if (name === 'RuntimeError' || name === 'LinkError' || name === 'CompileError') return true;
  const message = String(error.message || '');
  return /Module|arguments_|wasm|Aborted|Emscripten|FilesetResolver|MediaPipe/i.test(message);
}

// Sticky flag: once a reload is required, every subsequent UI repaint must
// preserve the affordance. The Live card has two warning slots — the GPL
// note and the reload-required note — and they used to fight over the same
// DOM element. Now each has its own slot and this flag prevents the GPL
// note's painter from running while a reload is outstanding.
let reloadRequired = false;

function promptReloadForWebGazerBoundary(error) {
  saveSettings();
  setRunState('error');
  reloadRequired = true;
  resetGazePanel(`engine: ${gazeEngineLabel(settings.gazeEngine)} · reload to switch from WebGazer`);
  const reason = error?.message || 'MediaPipe globals are still set in the page.';
  showToast(
    `Switching engines after WebGazer needs a page reload. ${reason} Click "Reload now" in the gaze panel.`,
    8000,
  );
  paintReloadRequiredNote(
    `WebGazer’s MediaPipe runtime is still resident in this page session (${reason}).`,
  );
  renderPrediction({
    probabilities: null,
    hint: 'WebGazer left MediaPipe globals in the page. Reload manually to switch engines cleanly.',
  });
  updateButtons();
}

/**
 * Paint the persistent reload-required affordance into its own DOM slot
 * (#liveGazeReloadNote, distinct from the GPL note). Includes a real
 * "Reload now" button so the user doesn't have to hunt for the browser
 * refresh — and so the action is captured as an explicit click, not a
 * silent window.location.reload() like the previous design.
 */
function paintReloadRequiredNote(detail) {
  const note = document.getElementById('liveGazeReloadNote');
  if (!note) return;
  note.hidden = false;
  note.innerHTML =
    `<strong>Reload required to switch engines.</strong> ` +
    `${escapeHtml(detail)} ` +
    `<button id="reloadNowBtn" type="button" style="margin-left: 8px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; cursor: pointer;">Reload now</button>`;
  // Re-binding is fine: replaceChildren-via-innerHTML drops any previous
  // listener attached to the old button, so we can't leak handlers.
  const btn = document.getElementById('reloadNowBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      saveSettings();
      window.location.reload();
    });
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
  await runtime?.stop();
  els.preview.srcObject = null;
  els.previewEmpty.hidden = false;
  latestFace = null;
  latestDisplay = null;
  els.faceBox.hidden = true;
  running = false;
  paused = false;
  sampleStamps.length = 0;
  resetGazePanel('adapter: stopped');
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
function createLiveGazeAdapter(engine) {
  if (engine === 'webgazer' && !isHttpsOrigin()) {
    throw new Error('WebGazer requires HTTPS. Restart with `npm run start:https` and open the https://127.0.0.1 URL.');
  }
  const common = {
    onGaze: () => {},
    onError: (err) => {
      const el = document.getElementById('liveGazeDiag');
      if (el) el.textContent = `adapter error: ${err?.message || err}`;
    },
    minQualityScore: Number.isFinite(settings.gazeMinQuality) ? settings.gazeMinQuality : 0.3,
  };
  if (engine === 'webgazer') {
    return new WebGazerAdapter({
      ...common,
      // The four debug surfaces stay user-controllable from the Gaze tab.
      // `showVideoPreview` remains off — we route the camera through Oyon's
      // own <video> element instead so WebGazer doesn't double-render.
      showVideoPreview: false,
      showFaceOverlay: Boolean(settings.webgazerShowFaceOverlay),
      showFaceFeedbackBox: Boolean(settings.webgazerShowFaceFeedbackBox),
      showPredictionPoints: Boolean(settings.webgazerShowPredictionPoints),
      saveDataAcrossSessions: Boolean(settings.webgazerSaveAcrossSessions),
      regression: settings.webgazerRegression || 'ridge',
      faceMeshSolutionPath: '/standalone/vendor/webgazer/face_mesh',
      viewport: () => ({
        width: window.innerWidth || document.documentElement.clientWidth || 1,
        height: window.innerHeight || document.documentElement.clientHeight || 1,
      }),
      stream: () => camera.stream,
    });
  }
  return new WebEyeTrackAdapter({
    ...common,
    videoElementId: 'preview',
  });
}

function isHttpsOrigin() {
  return window.location.protocol === 'https:';
}

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

  liveGazeAdapter = createLiveGazeAdapter(settings.gazeEngine);

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
    gazeAdapter: liveGazeAdapter,
    transport,
    logger: new OyonLogger({
      source: 'oyon-standalone',
      transports: [logTransport],
      contextProvider: () => ({
        session_id: `standalone-session-${modelProfile}`,
        user_id: 'standalone-user-1',
        case_id: 'standalone-case-1',
        tenant_id: 'standalone',
        model_profile: modelProfile,
      }),
    }),
    metrics: new OyonMetricRecorder({
      source: 'oyon-standalone',
      transports: [metricTransport],
      contextProvider: () => ({
        session_id: `standalone-session-${modelProfile}`,
        user_id: 'standalone-user-1',
        case_id: 'standalone-case-1',
        tenant_id: 'standalone',
        model_profile: modelProfile,
      }),
    }),
    camera,
    contextProvider: () => ({
      session_id: `standalone-session-${modelProfile}`,
      user_id: 'standalone-user-1',
      case_id: 'standalone-case-1',
      tenant_id: 'standalone',
      model_profile: modelProfile,
    }),
  });

  // Chain a live-dot painter onto the adapter's onGaze AFTER the runtime
  // installed its _handleGazeSample wrapper. We wrap the runtime's handler
  // so both run on every adapter callback.
  if (liveGazeAdapter?.options) {
    const runtimeHandler = liveGazeAdapter.options.onGaze;
    liveGazeAdapter.options.onGaze = (sample) => {
      try { runtimeHandler(sample); } catch (err) { console.warn('runtime gaze handler threw:', err); }
      try { paintLiveGazeDot(sample); } catch (err) { /* never break the worker callback */ }
    };
  }

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
  const ratio = face.quality?.faceAreaRatio ?? (face.bbox?.width * face.bbox?.height) ?? 0;
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

function displayBox(bbox, width, height) {
  const area = visibleVideoArea(width, height);
  return {
    x: area.x + bbox.x * area.width,
    y: area.y + bbox.y * area.height,
    width: bbox.width * area.width,
    height: bbox.height * area.height,
  };
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

function drawScanGlow(ctx, width, height, tone) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(tone, 0.10);
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFaceBox(ctx, box, tone) {
  const corner = Math.min(38, box.width * 0.2, box.height * 0.2);
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = tone;
  ctx.shadowColor = hexToRgba(tone, 0.65);
  ctx.shadowBlur = 12;
  const x1 = box.x;
  const y1 = box.y;
  const x2 = box.x + box.width;
  const y2 = box.y + box.height;
  cornerPath(ctx, x1, y1, corner, 1, 1);
  cornerPath(ctx, x2, y1, corner, -1, 1);
  cornerPath(ctx, x1, y2, corner, 1, -1);
  cornerPath(ctx, x2, y2, corner, -1, -1);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = hexToRgba(tone, 0.32);
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

function cornerPath(ctx, x, y, length, sx, sy) {
  ctx.beginPath();
  ctx.moveTo(x, y + sy * length);
  ctx.lineTo(x, y);
  ctx.lineTo(x + sx * length, y);
  ctx.stroke();
}

function drawLandmarkDots(ctx, landmarks, width, height, tone) {
  if (!landmarks.length) return;
  const area = visibleVideoArea(width, height);
  ctx.save();
  ctx.fillStyle = hexToRgba(tone, 0.7);
  const every = Math.max(1, Math.floor(landmarks.length / 40));
  for (let i = 0; i < landmarks.length; i += every) {
    const point = landmarks[i];
    ctx.beginPath();
    ctx.arc(area.x + point.x * area.width, area.y + point.y * area.height, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBadge(ctx, box, label, confidence, tone, canvasWidth) {
  const text = `${label} ${percent(confidence)}`;
  ctx.save();
  ctx.font = '600 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const metrics = ctx.measureText(text);
  const paddingX = 11;
  const badgeWidth = metrics.width + paddingX * 2;
  const badgeHeight = 28;
  const x = Math.max(8, Math.min(box.x, canvasWidth - badgeWidth - 8));
  const y = Math.max(8, box.y - badgeHeight - 8);

  ctx.fillStyle = 'rgba(7, 10, 16, 0.86)';
  roundRect(ctx, x, y, badgeWidth, badgeHeight, 8);
  ctx.fill();

  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.arc(x + 10, y + badgeHeight / 2, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f4f6fb';
  ctx.fillText(text, x + 22, y + 19);
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
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
function showToast(text, durationMs = 2400) {
  els.toast.textContent = text;
  els.toast.dataset.open = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.dataset.open = 'false'; }, durationMs);
}

// ---------- settings ----------
function defaultSettings() {
  return {
    model: DEFAULT_MODEL_PROFILE,
    sampleIntervalMs: 1000,
    smoothingAlpha: 0.28,
    minHoldMs: 3000,
    minSwitchConfidence: 0.5,
    gazeEngine: 'webgazer',
    gazeMinQuality: 0.3,
    gazeCalibrationPoints: 5,
    gazeZoneGrid: 3,
    webgazerShowFaceOverlay: false,
    webgazerShowPredictionPoints: false,
    webgazerShowFaceFeedbackBox: false,
    webgazerSaveAcrossSessions: false,
    webgazerRegression: 'ridge',
    gazeAois: [],
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
  els.gazeEngine.value = settings.gazeEngine;
  els.liveGazeEngine.value = settings.gazeEngine;
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
    gazeEngine: els.liveGazeEngine?.value || els.gazeEngine.value,
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
  // WebGazer is the demo default (calibrated screen-point accuracy);
  // 'webeyetrack' and 'mediapipe' (the library default) are explicit opt-ins.
  const gazeEngine = next.gazeEngine === 'webeyetrack' || next.gazeEngine === 'mediapipe'
    ? next.gazeEngine
    : 'webgazer';
  const regressionAllowed = ['ridge', 'weightedRidge', 'threadedRidge'];
  const webgazerRegression = regressionAllowed.includes(next.webgazerRegression)
    ? next.webgazerRegression
    : defaults.webgazerRegression;
  const gazeCalibrationPoints = next.gazeCalibrationPoints === 9 ? 9 : 5;
  return {
    ...next,
    model,
    gazeEngine,
    sampleIntervalMs,
    windowMs,
    minValidFrames: Math.max(1, Math.min(num(next.minValidFrames, defaults.minValidFrames), maxValidFrames)),
    cameraZoom: clamp(next.cameraZoom, 1, 3, defaults.cameraZoom),
    cameraOffsetX: clamp(next.cameraOffsetX, -30, 30, defaults.cameraOffsetX),
    cameraOffsetY: clamp(next.cameraOffsetY, -30, 30, defaults.cameraOffsetY),
    cameraSize: clamp(next.cameraSize, 280, 640, defaults.cameraSize),
    gazeMinQuality: clamp(next.gazeMinQuality, 0, 1, defaults.gazeMinQuality),
    gazeCalibrationPoints,
    gazeZoneGrid: clamp(next.gazeZoneGrid, 2, 6, defaults.gazeZoneGrid),
    webgazerShowFaceOverlay: Boolean(next.webgazerShowFaceOverlay),
    webgazerShowPredictionPoints: Boolean(next.webgazerShowPredictionPoints),
    webgazerShowFaceFeedbackBox: Boolean(next.webgazerShowFaceFeedbackBox),
    webgazerSaveAcrossSessions: Boolean(next.webgazerSaveAcrossSessions),
    webgazerRegression,
    gazeAois: normalizeStandaloneAois(next.gazeAois),
  };
}

function normalizeStandaloneAois(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const a of input) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.id !== 'string' || !a.id) continue;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    if (!Number.isFinite(a.width) || !Number.isFinite(a.height)) continue;
    if (a.width <= 0 || a.height <= 0) continue;
    out.push({ id: a.id, x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) });
    if (out.length >= 16) break;
  }
  return out;
}

// ---------- live engagement + gaze panels ----------
const ZONE_KEYS = [
  'top_left', 'top_center', 'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

let lastGazeSampleAt = 0;
let gazeSampleCount = 0;
// Rolling rate buffer: timestamps of recent samples within the last 2s.
const gazeRateWindow = [];
const GAZE_RATE_WINDOW_MS = 2000;

function gazeEngineLabel(engine) {
  if (engine === 'webgazer') return 'WebGazer';
  if (engine === 'mediapipe') return 'MediaPipe landmarks';
  return 'WebEyeTrack';
}

function resetGazePanel(message = 'adapter: not created') {
  lastGazeSampleAt = 0;
  gazeSampleCount = 0;
  setText('liveGazeN', '—');
  setText('liveGazeDispersion', '—');
  setText('liveGazeCentroid', '—');
  const diag = document.getElementById('liveGazeDiag');
  if (diag) diag.textContent = message;
  const dot = document.getElementById('liveGazeDot');
  if (dot) {
    dot.style.left = '50%';
    dot.style.top = '50%';
    dot.setAttribute('data-stale', '');
  }
}

function onLiveWindows(events) {
  if (!Array.isArray(events)) return;
  for (const w of events) {
    if (w?.engagement) updateEngagementPanel(w.engagement);
    if (w?.gaze) updateGazePanel(w.gaze);
  }
}

function updateGazeDiagnostics() {
  const el = document.getElementById('liveGazeDiag');
  const statusEl = document.getElementById('liveGazeStatus');
  const statusPill = document.getElementById('liveGazeStatusPill');
  const rateEl = document.getElementById('liveGazeRate');

  const adapter = liveGazeAdapter;
  if (!adapter) {
    if (el) el.textContent = 'adapter: not created';
    if (statusEl) statusEl.textContent = 'idle';
    if (statusPill) statusPill.dataset.state = 'warn';
    if (rateEl) rateEl.textContent = '— Hz';
    return;
  }

  // Surface any adapter init/start warning the runtime logged. The logger
  // ring keeps these so a slow init isn't lost.
  const logs = logTransport.read();
  const gazeWarn = logs
    .filter(ev => typeof ev?.event_name === 'string' && ev.event_name.startsWith('oyon.gaze.adapter_'))
    .pop();

  const status = typeof adapter.status === 'function' ? adapter.status() : '?';
  const adapterError = typeof adapter.lastError === 'function' ? adapter.lastError() : null;
  const ageMs = lastGazeSampleAt ? Math.round(performance.now() - lastGazeSampleAt) : null;
  const ageText = ageMs == null ? 'never' : `${ageMs} ms ago`;
  const warnMessage = adapterError?.message || gazeWarn?.fields?.message || '';
  const warnText = gazeWarn || adapterError
    ? ` · ${(gazeWarn?.event_name || 'oyon.gaze.adapter_error').replace('oyon.gaze.', '')}: ${warnMessage}`
    : '';
  if (el) {
    el.textContent = `engine: ${gazeEngineLabel(settings.gazeEngine)} · status: ${status ?? 'null'} · samples: ${gazeSampleCount} · last: ${ageText}${warnText}`;
  }

  // Status pill: green for inference, blue-warn for starting, red for error,
  // grey for idle/null/anything else.
  if (statusEl) statusEl.textContent = status || 'null';
  if (statusPill) {
    if (adapterError || status === 'error') {
      statusPill.dataset.state = 'warn';
      statusPill.title = `Adapter error: ${warnMessage || 'unknown'}`;
    } else if (status === 'inference') {
      statusPill.dataset.state = 'ok';
      statusPill.title = 'Adapter is producing samples';
    } else {
      statusPill.dataset.state = 'warn';
      statusPill.title = `Adapter status: ${status || 'null'}`;
    }
  }
  if (rateEl) {
    const hz = gazeRateHz();
    rateEl.textContent = hz > 0 ? `${hz.toFixed(1)} Hz` : '— Hz';
  }
}
setInterval(updateGazeDiagnostics, 500);

function updateEngagementPanel(e) {
  const focus = document.getElementById('liveFocus');
  const focusBar = document.getElementById('liveFocusBar');
  if (focus) focus.textContent = fmt2(e.focus_score);
  if (focusBar) focusBar.style.width = `${Math.round((e.focus_score ?? 0) * 100)}%`;
  setText('liveBlinkRate', fmt2(e.blink_rate_hz));
  setText('liveOpenness', fmt2(e.eye_openness_mean));
  setText('liveEntropy', fmt2(e.gaze_entropy));
}

function updateGazePanel(g) {
  setText('liveGazeN', String(g.n_points ?? 0));
  setText('liveGazeDispersion', g.dispersion == null ? '—' : Number(g.dispersion).toFixed(3));
  setText('liveGazeCentroid', g.centroid ? `${fmt2(g.centroid.x)}, ${fmt2(g.centroid.y)}` : '—');
  const calBadge = document.getElementById('liveGazeCalibrated');
  if (calBadge) {
    if (Number.isFinite(g.calibration_age_ms)) {
      const ageSec = Math.round(g.calibration_age_ms / 1000);
      const confidence = g.calibration_confidence || 'unknown';
      const qLabel =
        Number.isFinite(g.calibration_quality)
          ? `q ${Number(g.calibration_quality).toFixed(2)} · ${confidence}`
          : confidence === 'unknown'
            ? 'quality unknown'
            : `${confidence}`;
      calBadge.textContent = `Calibrated · ${qLabel} · ${ageSec} s ago`;
      // 'measured' → strong green; 'inferred' → green-but-soft; 'unknown' →
      // warn yellow. We never lie about quality the user can see.
      calBadge.dataset.state = confidence === 'unknown' ? 'warn' : 'ok';
    } else {
      calBadge.textContent = 'Not calibrated';
      calBadge.dataset.state = 'warn';
    }
  }
  const zones = g.zone_proportions || {};
  for (const key of ZONE_KEYS) {
    const tile = document.querySelector(`.live-heat-tile[data-zone="${key}"]`);
    if (!tile) continue;
    const v = Number(zones[key]) || 0;
    const pct = tile.querySelector('.live-heat-pct');
    if (pct) pct.textContent = v === 0 ? '0' : `${Math.round(v * 100)}`;
    const alpha = Math.min(1, Math.sqrt(v));
    tile.style.background = `rgba(37, 99, 235, ${0.06 + 0.7 * alpha})`;
  }
}

function paintLiveGazeDot(sample) {
  if (sample) {
    gazeSampleCount += 1;
    const now = performance.now();
    lastGazeSampleAt = now;
    gazeRateWindow.push(now);
    // Cheap eviction — only retain timestamps within the 2 s window.
    const cutoff = now - GAZE_RATE_WINDOW_MS;
    while (gazeRateWindow.length && gazeRateWindow[0] < cutoff) gazeRateWindow.shift();
  }
  const box = document.getElementById('liveGazeViewport');
  const dot = document.getElementById('liveGazeDot');
  if (!box || !dot) return;
  if (!sample || sample.gaze_state === 'closed' || !(sample.quality > 0)) {
    dot.setAttribute('data-stale', '');
    return;
  }
  dot.removeAttribute('data-stale');
  const rect = box.getBoundingClientRect();
  const px = (0.5 + sample.x) * rect.width;
  const py = (0.5 + sample.y) * rect.height;
  dot.style.left = `${px}px`;
  dot.style.top = `${py}px`;
}

function gazeRateHz() {
  const now = performance.now();
  const cutoff = now - GAZE_RATE_WINDOW_MS;
  while (gazeRateWindow.length && gazeRateWindow[0] < cutoff) gazeRateWindow.shift();
  if (gazeRateWindow.length < 2) return 0;
  const spanMs = gazeRateWindow[gazeRateWindow.length - 1] - gazeRateWindow[0];
  if (spanMs <= 0) return 0;
  return ((gazeRateWindow.length - 1) / spanMs) * 1000;
}

let calibrationOverlayEl = null;
async function startCalibrationFlow() {
  if (!runtime || typeof runtime.calibrateGaze !== 'function') {
    showToast('Start the camera first.');
    return;
  }
  defineGazeCalibrationOverlay();
  if (!calibrationOverlayEl) {
    calibrationOverlayEl = document.createElement('oyon-gaze-calibration');
    document.body.appendChild(calibrationOverlayEl);
  }
  calibrationOverlayEl.points = buildCalibrationPoints(settings.gazeCalibrationPoints);
  const result = await calibrationOverlayEl.startCalibration(runtime);
  if (result.ok) {
    showToast(formatCalibrationOutcome(result));
    // Reflect the result immediately on the badge instead of waiting for
    // the next gaze window to flush. Mirrors the same vocabulary the
    // gaze window will surface.
    paintCalibrationBadgeFromResult(result);
  } else {
    showToast(`Calibration failed: ${result.reason}`);
  }
}

/**
 * Build a calibration sequence in normalized [-0.5, 0.5] coords. 5-point is
 * center + four corners (the engine's "fast" default). 9-point is the 3×3
 * grid that gives the regressor more anchors at the cost of extra time.
 */
function buildCalibrationPoints(count) {
  if (count === 9) {
    const out = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        out.push({ x: col * 0.4 - 0.4, y: row * 0.4 - 0.4 });
      }
    }
    return out;
  }
  return [
    { x: 0, y: 0 },
    { x: -0.4, y: -0.4 },
    { x: 0.4, y: -0.4 },
    { x: -0.4, y: 0.4 },
    { x: 0.4, y: 0.4 },
  ];
}

function formatCalibrationOutcome(result) {
  const confidence = result.confidence || 'unknown';
  if (confidence === 'unknown' || !Number.isFinite(result.quality)) {
    return `Calibrated · quality unknown (engine: ${gazeEngineLabel(settings.gazeEngine)})`;
  }
  return `Calibrated · q ${fmt2(result.quality)} · ${confidence}`;
}

/**
 * Single source of truth for engine selection. All three selectors
 * (Model tab, Live card, Gaze tab) route here. Persists the choice,
 * syncs the other dropdowns, and either restarts the runtime or — when
 * switching FROM WebGazer mid-session — paints a reload affordance
 * instead, since WebGazer's MediaPipe runtime is still resident.
 */
async function applyEngineChange(value) {
  const previous = settings.gazeEngine;
  settings = normalizeSettings({ ...settings, gazeEngine: value });
  els.gazeEngine.value = settings.gazeEngine;
  els.liveGazeEngine.value = settings.gazeEngine;
  const gazeTab = document.getElementById('gazeEngineSettings');
  if (gazeTab) gazeTab.value = settings.gazeEngine;
  saveSettings();
  paintEngineLicenseNote();
  paintGazeTabLockState();
  if (webGazerWasStarted && previous === 'webgazer' && settings.gazeEngine !== 'webgazer') {
    paintReloadRequiredNote(
      `Switching from WebGazer to ${gazeEngineLabel(settings.gazeEngine)} needs a fresh page. ` +
      `WebGazer’s MediaPipe runtime is still resident from the previous start.`,
    );
    resetGazePanel(`engine: ${gazeEngineLabel(settings.gazeEngine)} · reload required to switch from WebGazer`);
    return;
  }
  resetGazePanel(`engine: ${gazeEngineLabel(settings.gazeEngine)} · restart required`);
  if (running) await startSelectedModel();
}

/**
 * Show a small GPL disclosure note when WebGazer is the active engine,
 * hide it otherwise. We do this in-UI rather than only in NOTICE.md so a
 * user trying the engine for the first time can see the trade-off without
 * digging through the repo.
 */
function paintEngineLicenseNote() {
  const note = document.getElementById('liveGazeEngineNote');
  if (!note) return;
  // GPL note and reload-required note are independent. Reload-required has
  // its own slot (#liveGazeReloadNote) and a sticky flag; we never wipe it
  // from here. This painter only owns the license disclosure.
  if (settings.gazeEngine === 'webgazer') {
    note.hidden = false;
    note.innerHTML =
      '<strong>WebGazer is GPL-3.0-or-later.</strong> ' +
      'It is bundled when this engine is selected. Hosts shipping a combined ' +
      'work must comply with GPL obligations or pick the default WebEyeTrack ' +
      'engine. See <code>NOTICE.md</code> for the full disclosure.';
  } else {
    note.hidden = true;
    note.textContent = '';
  }
}

function paintCalibrationBadgeFromResult(result) {
  const calBadge = document.getElementById('liveGazeCalibrated');
  if (!calBadge) return;
  const confidence = result.confidence || 'unknown';
  const qPart =
    confidence === 'unknown' || !Number.isFinite(result.quality)
      ? 'quality unknown'
      : `q ${Number(result.quality).toFixed(2)} · ${confidence}`;
  calBadge.textContent = `Calibrated · ${qPart} · 0 s ago`;
  calBadge.dataset.state = confidence === 'unknown' ? 'warn' : 'ok';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fmt2(v) {
  return v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(2);
}

function bindLivePanelControls() {
  const btn = document.getElementById('liveCalibrateBtn');
  if (btn && !btn.__bound) {
    btn.addEventListener('click', () => { startCalibrationFlow(); });
    btn.__bound = true;
  }
  const recal = document.getElementById('liveRecalibrateBtn');
  if (recal && !recal.__bound) {
    recal.addEventListener('click', () => { startCalibrationFlow(); });
    recal.__bound = true;
  }
  const clear = document.getElementById('liveClearCalibrationBtn');
  if (clear && !clear.__bound) {
    clear.addEventListener('click', () => clearCalibration());
    clear.__bound = true;
  }
}
window.addEventListener('DOMContentLoaded', bindLivePanelControls);

/**
 * Wire the new Gaze settings tab. Idempotent — safe to call from bindUi().
 * Each control writes back to `settings` via normalizeSettings + saveSettings,
 * then either repaints inline (toggles, regression, AOIs) or marks the
 * runtime as dirty so the next Start picks the new value up.
 */
function bindGazeTab() {
  const engineSel = document.getElementById('gazeEngineSettings');
  if (engineSel && !engineSel.__bound) {
    engineSel.value = settings.gazeEngine;
    engineSel.addEventListener('change', () => applyEngineChange(engineSel.value));
    engineSel.__bound = true;
  }

  const minQ = document.getElementById('gazeMinQuality');
  const minQVal = document.getElementById('gazeMinQualityValue');
  if (minQ && !minQ.__bound) {
    minQ.value = String(settings.gazeMinQuality);
    if (minQVal) minQVal.textContent = Number(minQ.value).toFixed(2);
    minQ.addEventListener('input', () => {
      if (minQVal) minQVal.textContent = Number(minQ.value).toFixed(2);
    });
    minQ.addEventListener('change', async () => {
      settings = normalizeSettings({ ...settings, gazeMinQuality: Number(minQ.value) });
      saveSettings();
      if (running) await startSelectedModel();
    });
    minQ.__bound = true;
  }

  const calPts = document.getElementById('gazeCalibrationPoints');
  if (calPts && !calPts.__bound) {
    calPts.value = String(settings.gazeCalibrationPoints);
    calPts.addEventListener('change', () => {
      settings = normalizeSettings({ ...settings, gazeCalibrationPoints: Number(calPts.value) });
      saveSettings();
    });
    calPts.__bound = true;
  }

  const grid = document.getElementById('gazeZoneGrid');
  const gridVal = document.getElementById('gazeZoneGridValue');
  if (grid && !grid.__bound) {
    grid.value = String(settings.gazeZoneGrid);
    if (gridVal) gridVal.textContent = `${grid.value}×${grid.value}`;
    grid.addEventListener('input', () => {
      if (gridVal) gridVal.textContent = `${grid.value}×${grid.value}`;
    });
    grid.addEventListener('change', async () => {
      settings = normalizeSettings({ ...settings, gazeZoneGrid: Number(grid.value) });
      saveSettings();
      if (running) await startSelectedModel();
    });
    grid.__bound = true;
  }

  const reg = document.getElementById('webgazerRegression');
  if (reg && !reg.__bound) {
    reg.value = settings.webgazerRegression;
    reg.addEventListener('change', async () => {
      settings = normalizeSettings({ ...settings, webgazerRegression: reg.value });
      saveSettings();
      if (running) await startSelectedModel();
    });
    reg.__bound = true;
  }

  // The four checkboxes share a write-back / restart-on-change pattern.
  const toggleMap = [
    ['webgazerShowFaceOverlay', 'webgazerShowFaceOverlay'],
    ['webgazerShowPredictionPoints', 'webgazerShowPredictionPoints'],
    ['webgazerShowFaceFeedbackBox', 'webgazerShowFaceFeedbackBox'],
    ['webgazerSaveAcrossSessions', 'webgazerSaveAcrossSessions'],
  ];
  for (const [elementId, settingKey] of toggleMap) {
    const cb = document.getElementById(elementId);
    if (!cb || cb.__bound) continue;
    cb.checked = Boolean(settings[settingKey]);
    cb.addEventListener('change', async () => {
      settings = normalizeSettings({ ...settings, [settingKey]: cb.checked });
      saveSettings();
      if (running) await startSelectedModel();
    });
    cb.__bound = true;
  }

  const addBtn = document.getElementById('aoiAddBtn');
  if (addBtn && !addBtn.__bound) {
    addBtn.addEventListener('click', () => {
      const id = (document.getElementById('aoiNewId').value || '').trim();
      const x = Number(document.getElementById('aoiNewX').value);
      const y = Number(document.getElementById('aoiNewY').value);
      const size = Number(document.getElementById('aoiNewSize').value);
      if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) {
        showToast('AOI needs an id and finite x, y, size.');
        return;
      }
      const aoi = { id, x, y, width: size, height: size };
      const next = [...(settings.gazeAois || []).filter(a => a.id !== id), aoi];
      settings = normalizeSettings({ ...settings, gazeAois: next });
      saveSettings();
      renderAoiList();
      renderAoiOverlays();
      document.getElementById('aoiNewId').value = '';
    });
    addBtn.__bound = true;
  }

  paintGazeTabLockState();
  renderAoiList();
  renderAoiOverlays();
}

/**
 * Visually disable WebGazer-specific options when WebEyeTrack is the active
 * engine. We don't hide them — being able to read what an option *would* do
 * is part of "options to control the default."
 */
function paintGazeTabLockState() {
  const inWebgazer = settings.gazeEngine === 'webgazer';
  const note = document.getElementById('webgazerOptionsInactiveNote');
  if (note) note.hidden = inWebgazer;
  for (const id of [
    'webgazerRegression',
    'webgazerShowFaceOverlay',
    'webgazerShowPredictionPoints',
    'webgazerShowFaceFeedbackBox',
    'webgazerSaveAcrossSessions',
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !inWebgazer;
  }
}

function renderAoiList() {
  const list = document.getElementById('aoiList');
  if (!list) return;
  const aois = settings.gazeAois || [];
  if (aois.length === 0) {
    list.innerHTML = '<div class="empty-state">No AOIs defined yet. Add one below.</div>';
    return;
  }
  list.innerHTML = '';
  for (const a of aois) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.innerHTML =
      `<span class="level-pill" title="ID">${escapeHtml(a.id)}</span>` +
      `<span class="name">x ${a.x.toFixed(2)} · y ${a.y.toFixed(2)} · ${a.width.toFixed(2)} × ${a.height.toFixed(2)}</span>` +
      `<button class="icon-button" type="button" data-aoi-remove="${escapeHtml(a.id)}" style="padding: 3px 8px; font-size: 11px;">Remove</button>`;
    list.appendChild(row);
  }
  for (const btn of list.querySelectorAll('[data-aoi-remove]')) {
    btn.addEventListener('click', (ev) => {
      const id = ev.currentTarget.getAttribute('data-aoi-remove');
      settings = normalizeSettings({ ...settings, gazeAois: settings.gazeAois.filter(a => a.id !== id) });
      saveSettings();
      renderAoiList();
      renderAoiOverlays();
    });
  }
}

/**
 * Paint each AOI as a translucent rect inside #liveGazeViewport. The
 * viewport uses normalized [-0.5, 0.5] coords on each axis, so we map
 *   px = (0.5 + x_norm) * viewportWidth
 *   py = (0.5 + y_norm) * viewportHeight
 * Width / height are normalized too, so they scale by the same factor.
 */
function renderAoiOverlays() {
  const viewport = document.getElementById('liveGazeViewport');
  if (!viewport) return;
  // Remove existing overlays.
  for (const old of viewport.querySelectorAll('.aoi-overlay')) old.remove();
  const aois = settings.gazeAois || [];
  for (const a of aois) {
    const div = document.createElement('div');
    div.className = 'aoi-overlay';
    div.title = `AOI ${a.id}`;
    div.style.position = 'absolute';
    div.style.left = `${(0.5 + a.x - a.width / 2) * 100}%`;
    div.style.top = `${(0.5 + a.y - a.height / 2) * 100}%`;
    div.style.width = `${a.width * 100}%`;
    div.style.height = `${a.height * 100}%`;
    div.style.border = '1px dashed var(--info)';
    div.style.background = 'rgba(37, 99, 235, 0.06)';
    div.style.borderRadius = '4px';
    div.style.pointerEvents = 'none';
    const label = document.createElement('span');
    label.textContent = a.id;
    label.style.position = 'absolute';
    label.style.top = '-16px';
    label.style.left = '0';
    label.style.fontSize = '10px';
    label.style.color = 'var(--info)';
    label.style.background = 'var(--bg-0)';
    label.style.padding = '0 4px';
    label.style.borderRadius = '3px';
    div.appendChild(label);
    viewport.appendChild(div);
  }
}

/**
 * Best-effort calibration reset. Engine-specific notes:
 *
 *   WebGazer: exposes a public `clearData()` that drops the regressor
 *   weights AND any localStorage-persisted training data (the latter only
 *   matters when `saveDataAcrossSessions` is on). We call it before the
 *   runtime teardown so the next start gets a truly fresh regressor.
 *
 *   WebEyeTrack: upstream has no untrain / clear API as of 0.0.2. The best
 *   we can do is tear down the runtime so the next Start instantiates a
 *   new `WebEyeTrackProxy`. Worker-internal state is opaque to us.
 *
 * In both cases the badge flips to "Not calibrated" so the user has a
 * truthful visual signal, even if the engine's internal state is only
 * partially reset.
 */
async function clearCalibration() {
  if (settings.gazeEngine === 'webgazer') {
    try {
      // The webgazer module is a global singleton; reaching for it via
      // globalThis avoids needing a runtime reference (which we are about
      // to dispose).
      const wg = typeof globalThis !== 'undefined' ? globalThis.webgazer : null;
      if (wg && typeof wg.clearData === 'function') {
        await Promise.resolve(wg.clearData());
      }
    } catch (err) {
      console.warn('[oyon/standalone] webgazer.clearData() threw', err);
    }
  }
  if (running) {
    try { await runtime?.stop(); } catch {}
  }
  runtime = null;
  setRunState('stopped');
  const badge = document.getElementById('liveGazeCalibrated');
  if (badge) {
    badge.textContent = 'Not calibrated';
    badge.dataset.state = 'warn';
  }
  resetGazePanel(`engine: ${gazeEngineLabel(settings.gazeEngine)} · calibration cleared`);
  const detail = settings.gazeEngine === 'webgazer'
    ? 'Calibration cleared (WebGazer regressor reset). Press Start to bring up a fresh session.'
    : 'Runtime torn down (WebEyeTrack has no upstream untrain API). Press Start to bring up a fresh session.';
  showToast(detail, 4000);
  updateButtons();
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
    eye_tracking_enabled: true,
    gaze_tracking_enabled: true,
    gaze_engine: localSettings.gazeEngine,
    gaze_min_quality_score: localSettings.gazeMinQuality,
    gaze_zone_grid: localSettings.gazeZoneGrid,
    gaze_aois: localSettings.gazeAois,
    webgazer_show_face_overlay: localSettings.webgazerShowFaceOverlay,
    webgazer_show_prediction_points: localSettings.webgazerShowPredictionPoints,
    webgazer_show_face_feedback_box: localSettings.webgazerShowFaceFeedbackBox,
    webgazer_save_across_sessions: localSettings.webgazerSaveAcrossSessions,
    webgazer_regression: localSettings.webgazerRegression,
    gaze_calibration_points: localSettings.gazeCalibrationPoints,
    // Emit gaze blocks before calibration too — the user sees something
    // moving immediately; once they click Calibrate, accuracy improves.
    gaze_calibration_required: false,
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
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
