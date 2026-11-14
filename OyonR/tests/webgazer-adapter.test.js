import assert from 'node:assert/strict';
import {
  WebGazerAdapter,
  normalizeWebGazerPrediction,
} from '../src/inference/WebGazerAdapter.js';
import {
  createGazeAdapter,
  normalizeGazeEngine,
} from '../src/inference/GazeAdapterFactory.js';
import { WebEyeTrackAdapter } from '../src/inference/WebEyeTrackAdapter.js';

function makeWebGazerStub() {
  return {
    calls: [],
    listener: null,
    setGazeListener(fn) { this.calls.push(['setGazeListener', fn]); this.listener = fn; return this; },
    saveDataAcrossSessions(v) { this.calls.push(['saveDataAcrossSessions', v]); return this; },
    showVideoPreview(v) { this.calls.push(['showVideoPreview', v]); return this; },
    showFaceOverlay(v) { this.calls.push(['showFaceOverlay', v]); return this; },
    showFaceFeedbackBox(v) { this.calls.push(['showFaceFeedbackBox', v]); return this; },
    showPredictionPoints(v) { this.calls.push(['showPredictionPoints', v]); return this; },
    setStaticVideo(stream) { this.calls.push(['setStaticVideo', stream]); this.stream = stream; return this; },
    recordScreenPosition(x, y, type) { this.calls.push(['recordScreenPosition', x, y, type]); return this; },
    async begin() { this.calls.push(['begin']); return this; },
    pause() { this.calls.push(['pause']); return this; },
    params: { faceMeshSolutionPath: './mediapipe/face_mesh' },
  };
}

// A — Pure normalization: viewport pixels → Oyon [-0.5, 0.5].
{
  const s = normalizeWebGazerPrediction(
    { x: 960, y: 540 },
    123,
    9000,
    0.3,
    { width: 1920, height: 1080 },
  );
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
  assert.equal(s.valid, true);
  assert.equal(s.gaze_state, 'open');
  assert.equal(s.quality_source, 'geometric');
  assert.equal(s.ts_ms, 9000);
  assert.equal(s.ts_video_ms, 123);
}

// B — Bad prediction is dropped.
{
  assert.equal(normalizeWebGazerPrediction(null, 0, 0), null);
  assert.equal(normalizeWebGazerPrediction({ x: NaN, y: 0 }, 0, 0), null);
}

// C — Adapter lifecycle configures WebGazer, begins, emits samples, disposes.
{
  const received = [];
  const webgazer = makeWebGazerStub();
  const stream = { id: 'camera-stream' };
  const adapter = new WebGazerAdapter({
    webgazer,
    onGaze: (s) => received.push(s),
    clock: () => 42,
    viewport: { width: 1000, height: 800 },
    stream: () => stream,
    faceMeshSolutionPath: '/standalone/vendor/webgazer/face_mesh',
  });
  await adapter.init();
  assert.equal(adapter.status(), 'idle');
  assert.equal(webgazer.params.faceMeshSolutionPath, '/standalone/vendor/webgazer/face_mesh');
  await adapter.start();
  assert.equal(adapter.status(), 'inference');
  assert.ok(webgazer.calls.some(c => c[0] === 'begin'));
  assert.ok(webgazer.calls.some(c => c[0] === 'setStaticVideo' && c[1] === stream));
  webgazer.listener({ x: 500, y: 400 }, 77);
  assert.equal(received.length, 1);
  assert.equal(received[0].x, 0);
  assert.equal(received[0].y, 0);
  const r = await adapter.calibrate([{ x: 0, y: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.model, 'webgazer');
  // recordScreenPosition was available + succeeded → 'inferred' with a real
  // fraction. The number is a coarse proxy, not a calibrated probability.
  assert.equal(r.confidence, 'inferred');
  assert.equal(r.quality, 1);
  assert.ok(webgazer.calls.some(c => c[0] === 'recordScreenPosition' && c[1] === 500 && c[2] === 400));
  adapter.dispose();
  assert.equal(adapter.status(), 'idle');
  assert.ok(webgazer.calls.some(c => c[0] === 'pause'));
}

// D — Structured errors before init/start and failed begin().
{
  assert.throws(() => new WebGazerAdapter({}), /onGaze/);
  const uninitialized = new WebGazerAdapter({ onGaze: () => {} });
  await assert.rejects(async () => uninitialized.start(), /init\(\) before start\(\)/);

  const webgazer = makeWebGazerStub();
  const adapter = new WebGazerAdapter({ webgazer, onGaze: () => {} });
  await adapter.init();
  const r = await adapter.calibrate([{ x: 0, y: 0 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'adapter_not_running');

  const failingWebGazer = makeWebGazerStub();
  failingWebGazer.begin = async function begin() {
    this.calls.push(['begin']);
    throw new Error('camera refused');
  };
  const failingAdapter = new WebGazerAdapter({ webgazer: failingWebGazer, onGaze: () => {} });
  await failingAdapter.init();
  await assert.rejects(async () => failingAdapter.start(), /camera refused/);
  assert.equal(failingAdapter.status(), 'error');
  assert.equal(failingAdapter.lastError().message, 'camera refused');
}

// E — WebGazer's obsolete protocol modal is suppressed, but no other host
// alert is swallowed and the global function is restored after begin().
{
  const hadAlert = Object.hasOwn(globalThis, 'alert');
  const originalAlert = globalThis.alert;
  const forwarded = [];
  const hostAlert = (message) => forwarded.push(String(message));
  globalThis.alert = hostAlert;
  try {
    const webgazer = makeWebGazerStub();
    webgazer.begin = async function begin() {
      this.calls.push(['begin']);
      globalThis.alert('WebGazer works only over https. If you are doing local development, you need to run a local server.');
      globalThis.alert('another WebGazer message');
      return this;
    };
    const adapter = new WebGazerAdapter({ webgazer, onGaze: () => {} });
    await adapter.init();
    await adapter.start();
    assert.deepEqual(forwarded, ['another WebGazer message']);
    assert.equal(globalThis.alert, hostAlert, 'host alert must be restored after begin');
  } finally {
    if (hadAlert) globalThis.alert = originalAlert;
    else delete globalThis.alert;
  }
}

// F — Factory chooses engines; unknown values normalize to the project
// default (the MediaPipe landmark engine — see gaze-engine-switch.test.js).
{
  assert.equal(normalizeGazeEngine('webgazer'), 'webgazer');
  assert.equal(normalizeGazeEngine('bad'), 'mediapipe');
  const webgazerAdapter = createGazeAdapter({
    engine: 'webgazer',
    onGaze: () => {},
    webgazer: { webgazer: makeWebGazerStub(), viewport: { width: 100, height: 100 } },
  });
  assert.ok(webgazerAdapter instanceof WebGazerAdapter);
  const webEyeTrackAdapter = createGazeAdapter({
    engine: 'webeyetrack',
    videoElementId: 'video',
    onGaze: () => {},
  });
  assert.ok(webEyeTrackAdapter instanceof WebEyeTrackAdapter);
}

// init() without an injected instance: the `webgazer` package is an optional
// peer and is not installed here, so `import('webgazer')` fails — the same
// outcome, for the adapter, as the <oyon-app> element bundle's inert stand-in
// (a module with no WebGazer API). Either way the script fallback is tried.
{
  const hadGlobal = Object.prototype.hasOwnProperty.call(globalThis, 'webgazer');
  const previous = globalThis.webgazer;
  try {
    // Fallback supplies WebGazer (here: already on the page): init succeeds.
    const fromScript = makeWebGazerStub();
    globalThis.webgazer = fromScript;
    const adapter = new WebGazerAdapter({ onGaze: () => {}, scriptUrl: null, viewport: { width: 100, height: 100 } });
    await adapter.init();
    assert.equal(adapter._webgazer, fromScript, 'the script-provided WebGazer is used when the import gives nothing usable');
    assert.equal(adapter.status(), 'idle');

    // Neither the package nor the script: a clear, classed-by-message failure
    // at init() — when the engine is chosen — never at module load.
    delete globalThis.webgazer;
    const missing = new WebGazerAdapter({ onGaze: () => {}, scriptUrl: null, viewport: { width: 100, height: 100 } });
    await assert.rejects(() => missing.init(), /failed to load 'webgazer'/);

    // Something that is not WebGazer on the page is refused, not adopted.
    globalThis.webgazer = { notWebGazer: true };
    const wrong = new WebGazerAdapter({ onGaze: () => {}, scriptUrl: null, viewport: { width: 100, height: 100 } });
    await assert.rejects(() => wrong.init(), /did not expose setGazeListener/);
  } finally {
    if (hadGlobal) globalThis.webgazer = previous;
    else delete globalThis.webgazer;
  }
}

console.log('webgazer-adapter.test.js — all cases passed');
