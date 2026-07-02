import assert from 'node:assert/strict';
import {
  GazeCalibrationDriver,
  DEFAULT_CALIBRATION_POINTS,
} from '../src/ui/GazeCalibrationDriver.js';

/**
 * Tests exercise the pure state machine (`GazeCalibrationDriver`) directly.
 * The DOM-bearing custom element (`GazeCalibrationOverlay`) is a thin shell
 * that injects a real click dispatcher and renders the dot; visual /
 * pointer-event behavior is the Stage 7 Playwright smoke's responsibility.
 *
 * A `FakeTimer` queue lets us advance the state machine deterministically
 * without sleeping. Same idiom that other Oyon tests use for clocks
 * (see `mocks/MockWebEyeTrackAdapter` — clock-injectable). The difference
 * here is that the driver also needs a controllable `setTimer` (it waits
 * across two timeouts per dot), not just a controllable wall clock.
 */

function makeFakeTimer() {
  const queue = [];
  let nextHandle = 1;
  return {
    setTimer(fn, ms) {
      const handle = nextHandle++;
      queue.push({ handle, fn, ms });
      return handle;
    },
    clearTimer(handle) {
      const i = queue.findIndex(e => e.handle === handle);
      if (i >= 0) queue.splice(i, 1);
    },
    /** Fire the next pending timer (FIFO). */
    flushOne() {
      const next = queue.shift();
      if (!next) throw new Error('FakeTimer: no pending timer to flush');
      next.fn();
    },
    /** Fire every queued timer in arrival order until the queue is empty. */
    flushAll() {
      while (queue.length > 0) {
        const next = queue.shift();
        next.fn();
      }
    },
    pending() { return queue.length; },
    /** Wait one microtask so chained promises settle before flushing the next timer. */
    async tick() { await Promise.resolve(); await Promise.resolve(); },
  };
}

function makeStubRuntime() {
  return {
    calls: [],
    nextResult: { ok: true, quality: 0.82, model: 'mock-blazegaze' },
    async calibrateGaze(points) {
      this.calls.push(points.map(p => ({ x: p.x, y: p.y })));
      return this.nextResult;
    },
  };
}

// A — Default 5-point sequence: five clicks at correct pixel coords, in order.
{
  const timer = makeFakeTimer();
  const clicks = [];
  const driver = new GazeCalibrationDriver({
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: (evt) => clicks.push({ x: evt.pixelX, y: evt.pixelY, index: evt.index }),
  });

  const runtime = makeStubRuntime();
  const promise = driver.start(runtime, { viewport: { width: 1000, height: 800 } });

  // Drive 5 dots; each dot has 2 timers (fixation then capture).
  for (let i = 0; i < 5; i += 1) {
    assert.equal(driver.currentIndex, i, `before dot ${i}: index`);
    assert.equal(driver.state, 'showing', `before dot ${i}: state`);
    timer.flushOne();
    assert.equal(driver.state, 'capturing', `mid dot ${i}: state`);
    timer.flushOne();
  }

  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(clicks.length, 5);

  // Click coords match the documented mapping: (0.5 + x) * width / height.
  for (let i = 0; i < 5; i += 1) {
    const p = DEFAULT_CALIBRATION_POINTS[i];
    assert.equal(clicks[i].x, Math.round((0.5 + p.x) * 1000), `click[${i}].x`);
    assert.equal(clicks[i].y, Math.round((0.5 + p.y) * 800), `click[${i}].y`);
    assert.equal(clicks[i].index, i);
  }
}

// B — runtime.calibrateGaze() invoked exactly once at the end with the points.
{
  const timer = makeFakeTimer();
  const driver = new GazeCalibrationDriver({
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: () => {},
  });
  const runtime = makeStubRuntime();
  const promise = driver.start(runtime, { viewport: { width: 800, height: 600 } });

  timer.flushAll();
  const result = await promise;

  assert.equal(result.ok, true);
  assert.equal(runtime.calls.length, 1, 'calibrateGaze called once');
  assert.equal(runtime.calls[0].length, 5);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(runtime.calls[0][i].x, DEFAULT_CALIBRATION_POINTS[i].x);
    assert.equal(runtime.calls[0][i].y, DEFAULT_CALIBRATION_POINTS[i].y);
  }
}

// C — abort() during fixation resolves cleanly; no further clicks dispatched.
{
  const timer = makeFakeTimer();
  const clicks = [];
  const aborts = [];
  const driver = new GazeCalibrationDriver({
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: (evt) => clicks.push(evt),
    onAbort: (reason) => aborts.push(reason),
  });
  const runtime = makeStubRuntime();
  const promise = driver.start(runtime, { viewport: { width: 1000, height: 800 } });

  // We've shown the first dot (fixation timer is pending). Abort before it fires.
  assert.equal(driver.state, 'showing');
  driver.abort();

  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'user_aborted');
  assert.equal(driver.state, 'aborted');
  assert.equal(clicks.length, 0, 'no clicks dispatched after abort');
  assert.equal(aborts.length, 1);
  assert.equal(runtime.calls.length, 0, 'runtime.calibrateGaze not called on abort');

  // Idempotent — second abort is a no-op.
  driver.abort('other');
  assert.equal(aborts.length, 1);
}

// D — start() rejects-but-doesn't-throw if runtime is missing calibrateGaze.
{
  const driver = new GazeCalibrationDriver({ clickDispatcher: () => {} });
  const r1 = await driver.start({}, { viewport: { width: 100, height: 100 } });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'runtime_missing_calibrate_gaze');

  const r2 = await driver.start(null, { viewport: { width: 100, height: 100 } });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'runtime_missing_calibrate_gaze');

  // Invalid viewport produces a structured failure too.
  const r3 = await driver.start(makeStubRuntime(), { viewport: { width: 0, height: 100 } });
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'invalid_viewport');

  const r4 = await driver.start(makeStubRuntime(), {});
  assert.equal(r4.ok, false);
  assert.equal(r4.reason, 'invalid_viewport');
}

// E — onProgress hook that throws does NOT stall the state machine.
{
  const timer = makeFakeTimer();
  const driver = new GazeCalibrationDriver({
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: () => {},
    onProgress: () => { throw new Error('boom'); },
    onHookError: () => {}, // swallow logging so the test output stays clean
  });
  const runtime = makeStubRuntime();
  const promise = driver.start(runtime, { viewport: { width: 100, height: 100 } });
  timer.flushAll();
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(runtime.calls.length, 1);
}

// F — Custom points sequence is honored end-to-end.
{
  const timer = makeFakeTimer();
  const clicks = [];
  const customPoints = [
    { x: -0.3, y:  0.0 },
    { x:  0.3, y:  0.0 },
    { x:  0.0, y: -0.3 },
  ];
  const driver = new GazeCalibrationDriver({
    points: customPoints,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: (evt) => clicks.push(evt),
  });
  assert.equal(driver.totalPoints, 3);
  const runtime = makeStubRuntime();
  const promise = driver.start(runtime, { viewport: { width: 200, height: 100 } });
  timer.flushAll();
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(clicks.length, 3);
  // First custom point: x=-0.3 maps to (0.5 - 0.3) * 200 = 40px
  assert.equal(clicks[0].pixelX, 40);
  assert.equal(clicks[0].pixelY, 50); // y=0.0 → 0.5 * 100 = 50
  assert.equal(runtime.calls[0].length, 3);
}

// G — Constructor rejects an empty / fully-invalid points array.
{
  assert.throws(
    () => new GazeCalibrationDriver({ points: [{ x: 'nope' }, null, { x: NaN, y: 1 }] }),
    /at least one valid point/i,
  );
}

// H — Default points: a Promise still resolves with the runtime's failure result.
{
  const timer = makeFakeTimer();
  const driver = new GazeCalibrationDriver({
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: () => {},
  });
  const runtime = {
    async calibrateGaze() {
      return { ok: false, reason: 'gaze_tracking_not_enabled' };
    },
  };
  const promise = driver.start(runtime, { viewport: { width: 100, height: 100 } });
  timer.flushAll();
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'gaze_tracking_not_enabled');
  assert.equal(driver.state, 'complete');
}

// I — Runtime throws synchronously / asynchronously: surfaced as runtime_threw.
{
  const timer = makeFakeTimer();
  const driver = new GazeCalibrationDriver({
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    clickDispatcher: () => {},
  });
  const runtime = {
    async calibrateGaze() { throw new Error('upstream down'); },
  };
  const promise = driver.start(runtime, { viewport: { width: 100, height: 100 } });
  timer.flushAll();
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime_threw');
  assert.equal(result.message, 'upstream down');
}

console.log('gaze-calibration-overlay tests passed');
