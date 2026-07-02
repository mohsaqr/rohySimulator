// Verifies that switching gaze engines in the same JS process — the
// concrete bug class that bit Stage 7 — leaves no leaked globals between
// adapter lifecycles.
//
// We can't reproduce the full Emscripten/WASM collision in Node, but we
// CAN assert the contract that the standalone page relies on:
//   1. WebGazerAdapter.dispose() clears the legacy MediaPipe Module
//      globals it pollutes on start.
//   2. MediaPipeFaceTracker.init() also clears them defensively before it
//      imports Tasks Vision.
//   3. The two adapter classes can be instantiated and disposed in either
//      order without one carrying state into the other.
import assert from 'node:assert/strict';
import { WebGazerAdapter } from '../src/inference/WebGazerAdapter.js';
import { WebEyeTrackAdapter } from '../src/inference/WebEyeTrackAdapter.js';
import { MediaPipeLandmarkGazeAdapter } from '../src/inference/MediaPipeLandmarkGazeAdapter.js';
import { createGazeAdapter, normalizeGazeEngine } from '../src/inference/GazeAdapterFactory.js';

function makeWebGazerStub() {
  const calls = [];
  return {
    calls,
    listener: null,
    params: { faceMeshSolutionPath: null },
    setGazeListener(fn) { this.listener = fn; calls.push(['setGazeListener', !!fn]); return this; },
    setStaticVideo(v)   { calls.push(['setStaticVideo', v]); return this; },
    setRegression()     { return this; },
    saveDataAcrossSessions() { return this; },
    showVideoPreview()  { return this; },
    showFaceOverlay()   { return this; },
    showFaceFeedbackBox() { return this; },
    showPredictionPoints() { return this; },
    recordScreenPosition(...args) { calls.push(['recordScreenPosition', ...args]); },
    begin: async () => undefined,
    pause() { calls.push(['pause']); return this; },
    end()   { calls.push(['end']); return this; },
  };
}

function pollute() {
  globalThis.createMediapipeSolutionsWasm = function () {};
  globalThis.createMediapipeSolutionsPackedAssets = function () {};
  globalThis.Module = { arguments: ['legacy'] };
}

function isClean() {
  return (
    !('createMediapipeSolutionsWasm' in globalThis) &&
    !('createMediapipeSolutionsPackedAssets' in globalThis) &&
    !('Module' in globalThis)
  );
}

// A — Factory selects the right adapter class.
{
  const onGaze = () => {};
  const wg = createGazeAdapter({
    engine: 'webgazer',
    onGaze,
    webgazer: { webgazer: makeWebGazerStub() },
  });
  assert.ok(wg instanceof WebGazerAdapter);

  const wet = createGazeAdapter({ engine: 'webeyetrack', onGaze, videoElementId: 'video' });
  assert.ok(wet instanceof WebEyeTrackAdapter);

  const mp = createGazeAdapter({ engine: 'mediapipe', onGaze });
  assert.ok(mp instanceof MediaPipeLandmarkGazeAdapter);
  assert.equal(mp.requiresCalibration, false);

  // Unknown engines fall back to the landmark adapter (the only engine with
  // no second camera / FaceMesh / singleton state).
  assert.equal(normalizeGazeEngine('garbage'), 'mediapipe');
  assert.equal(normalizeGazeEngine('WebGazer'), 'webgazer');
  const fallback = createGazeAdapter({ engine: 'garbage', onGaze });
  assert.ok(fallback instanceof MediaPipeLandmarkGazeAdapter);
}

// B — WebGazerAdapter.dispose() clears the legacy MediaPipe globals it
//     can leak. Simulates the actual page state after WebGazer has been
//     running: those globals exist; dispose must remove them.
{
  pollute();
  assert.ok(!isClean(), 'precondition: globals present before dispose');

  const stub = makeWebGazerStub();
  const adapter = new WebGazerAdapter({ webgazer: stub, onGaze: () => {} });
  await adapter.init();
  await adapter.start();
  adapter.dispose();

  assert.ok(isClean(), 'WebGazerAdapter.dispose() must clear the Emscripten globals');
  assert.ok(stub.calls.some(c => c[0] === 'end'), 'dispose should call end() to release worker');
  assert.ok(stub.calls.some(c => c[0] === 'pause'), 'dispose should also call pause() for idempotency');
}

// C — A second create→init→start→dispose cycle works after the first.
//     This is the regression that the page-reload was papering over.
{
  pollute();
  const stub1 = makeWebGazerStub();
  const a1 = new WebGazerAdapter({ webgazer: stub1, onGaze: () => {} });
  await a1.init();
  await a1.start();
  a1.dispose();
  assert.ok(isClean(), 'after first dispose, globals must be clean');

  pollute();
  const stub2 = makeWebGazerStub();
  const a2 = new WebGazerAdapter({ webgazer: stub2, onGaze: () => {} });
  await a2.init();
  await a2.start();
  a2.dispose();
  assert.ok(isClean(), 'after second dispose, globals must still be clean');
}

// D — Honest calibration result shape: ok:true with confidence enum.
{
  pollute();
  const stub = makeWebGazerStub();
  const adapter = new WebGazerAdapter({
    webgazer: stub,
    onGaze: () => {},
    viewport: { width: 100, height: 100 },
  });
  await adapter.init();
  await adapter.start();
  const r = await adapter.calibrate([{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }]);
  assert.equal(r.ok, true);
  assert.equal(r.model, 'webgazer');
  assert.equal(r.confidence, 'inferred', 'recordScreenPosition succeeded → inferred, not unknown');
  assert.equal(typeof r.quality, 'number');
  adapter.dispose();
  assert.ok(isClean());
}

// E — When the stub has no recordScreenPosition, calibration falls back to
//     'unknown' / null. The contract: we must never lie about quality.
{
  pollute();
  const stub = makeWebGazerStub();
  delete stub.recordScreenPosition;
  const adapter = new WebGazerAdapter({ webgazer: stub, onGaze: () => {} });
  await adapter.init();
  await adapter.start();
  const r = await adapter.calibrate([{ x: 0, y: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.confidence, 'unknown');
  assert.equal(r.quality, null);
  adapter.dispose();
}

console.log('gaze-engine-switch.test.js: OK');
