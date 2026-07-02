/**
 * GazeCalibrationDriver — Stage 5 of the screen-point gaze pipeline.
 *
 * The pure-JS state machine that walks a user through an N-point calibration
 * sequence. Knows nothing about the DOM: it asks an injected `clickDispatcher`
 * to fire a click at a pixel coordinate, and notifies a set of injected hooks
 * as it advances. The custom element (`GazeCalibrationOverlay`) and the React
 * panel (`GazeCalibrationPanel`) are thin shells over this class.
 *
 * Why this split exists:
 *   `webeyetrack@0.0.2` does not expose a programmatic `calibrate(points)`
 *   API. Its `WebEyeTrackProxy` calibrates by listening for real DOM click
 *   events while the user looks at each target. Driving calibration in code
 *   therefore means dispatching synthetic `MouseEvent('click')` at the
 *   on-screen pixel position of each target — and that's exactly what the
 *   real overlay's clickDispatcher does. Separating that side effect from
 *   the timing/sequencing/state means we can test the state machine without
 *   a DOM, and swap in alternative dispatchers (e.g., a future
 *   programmatic-calibration upstream) without rewriting the overlay.
 *
 * Lifecycle:
 *   const driver = new GazeCalibrationDriver({
 *     points,                          // optional; defaults to 5-point center+corners
 *     fixationMs: 500,
 *     captureMs: 1000,
 *     clock: () => Date.now(),
 *     setTimer: (fn, ms) => setTimeout(fn, ms),
 *     clearTimer: (handle) => clearTimeout(handle),
 *     clickDispatcher: ({ pixelX, pixelY, point, index }) => {...},
 *     onShow:     ({ point, index, pixelX, pixelY, total }) => {},
 *     onCapture:  ({ point, index, total }) => {},
 *     onProgress: (event) => {},   // catch-all: 'show' | 'capture' | 'advance'
 *     onComplete: (result) => {},
 *     onAbort:    (reason) => {},
 *   });
 *
 *   const result = await driver.start(runtime, { viewport: { width, height } });
 *   // result is exactly what runtime.calibrateGaze(points) returned, OR
 *   //   { ok: false, reason: 'user_aborted' }
 *   //   { ok: false, reason: 'runtime_missing_calibrate_gaze' }
 *
 * State machine:
 *   idle → showing(i) → fixating(i) → capturing(i) → advancing → (showing(i+1) | finalizing) → complete
 *   Any state → aborted (terminal)
 *
 * Hook errors are swallowed (with onError-style logging) — same idiom as
 * `WebEyeTrackAdapter._handleGazeResult`: caller-thrown errors must not
 * stall the timer loop.
 */

const DEFAULT_FIXATION_MS = 500;
const DEFAULT_CAPTURE_MS = 1000;

/**
 * Default 5-point sequence. `webeyetrack@0.0.2` keeps only the most recent
 * five support points internally, so the default should be exactly the five
 * anchors we want it to retain: center plus the four corners. Points are in
 * WebEyeTrack's normalized [-0.5, 0.5] convention.
 */
const DEFAULT_POINTS = Object.freeze([
  { x:  0.0, y:  0.0 },  // center
  { x: -0.4, y: -0.4 },  // top-left
  { x:  0.4, y: -0.4 },  // top-right
  { x:  0.4, y:  0.4 },  // bottom-right
  { x: -0.4, y:  0.4 },  // bottom-left
]);

export class GazeCalibrationDriver {
  constructor(options = {}) {
    const points = Array.isArray(options.points) && options.points.length > 0
      ? options.points.map(sanitizePoint).filter(p => p !== null)
      : DEFAULT_POINTS.slice();
    if (points.length === 0) {
      throw new Error('GazeCalibrationDriver: at least one valid point is required.');
    }

    this.options = {
      points,
      fixationMs: positiveNumber(options.fixationMs, DEFAULT_FIXATION_MS),
      captureMs: positiveNumber(options.captureMs, DEFAULT_CAPTURE_MS),
      clock: typeof options.clock === 'function' ? options.clock : () => Date.now(),
      setTimer: typeof options.setTimer === 'function'
        ? options.setTimer
        : (fn, ms) => setTimeout(fn, ms),
      clearTimer: typeof options.clearTimer === 'function'
        ? options.clearTimer
        : handle => clearTimeout(handle),
      clickDispatcher: typeof options.clickDispatcher === 'function'
        ? options.clickDispatcher
        : null,
      onShow: typeof options.onShow === 'function' ? options.onShow : null,
      onCapture: typeof options.onCapture === 'function' ? options.onCapture : null,
      onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
      onComplete: typeof options.onComplete === 'function' ? options.onComplete : null,
      onAbort: typeof options.onAbort === 'function' ? options.onAbort : null,
      onHookError: typeof options.onHookError === 'function' ? options.onHookError : null,
    };

    this._state = 'idle';
    this._index = 0;
    this._timer = null;
    this._pending = null;
    this._viewport = null;
    this._runtime = null;
  }

  /** Current state name. Read-only. */
  get state() { return this._state; }
  /** Zero-based index of the currently-targeted point, or null when idle/done. */
  get currentIndex() { return this._state === 'idle' || this._state === 'complete' || this._state === 'aborted' ? null : this._index; }
  /** Total number of points in the configured sequence. */
  get totalPoints() { return this.options.points.length; }

  /**
   * Start the calibration sequence. Resolves with the runtime's
   * calibrateGaze() result, or a structured failure (`user_aborted` /
   * `runtime_missing_calibrate_gaze`). Never rejects.
   *
   * Cannot be started twice — second call rejects with `already_running`.
   *
   * @param {{calibrateGaze: (points: Array<{x:number,y:number}>) => Promise<any>}} runtime
   * @param {{viewport: {width: number, height: number}}} options
   */
  start(runtime, options = {}) {
    if (this._state !== 'idle' && this._state !== 'complete' && this._state !== 'aborted') {
      return Promise.resolve({ ok: false, reason: 'already_running' });
    }
    if (!runtime || typeof runtime.calibrateGaze !== 'function') {
      return Promise.resolve({ ok: false, reason: 'runtime_missing_calibrate_gaze' });
    }
    const viewport = options.viewport;
    if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) {
      return Promise.resolve({ ok: false, reason: 'invalid_viewport' });
    }

    this._runtime = runtime;
    this._viewport = { width: viewport.width, height: viewport.height };
    this._index = 0;
    this._state = 'idle';

    return new Promise(resolve => {
      this._pending = resolve;
      this._advanceToShowing();
    });
  }

  /**
   * Abort the current run. Idempotent; safe to call after completion.
   * Resolves the in-flight start() promise with { ok: false, reason }
   * where `reason` defaults to 'user_aborted'.
   */
  abort(reason = 'user_aborted') {
    if (this._state === 'complete' || this._state === 'aborted') return;
    this._clearTimer();
    this._state = 'aborted';
    this._fire('onAbort', reason);
    this._fire('onProgress', { type: 'aborted', reason });
    this._resolve({ ok: false, reason });
  }

  // ---- internal: state transitions ----

  _advanceToShowing() {
    if (this._state === 'aborted') return;
    const point = this.options.points[this._index];
    const { pixelX, pixelY } = this._toPixel(point);
    this._state = 'showing';
    const evt = {
      point,
      index: this._index,
      total: this.options.points.length,
      pixelX,
      pixelY,
    };
    this._fire('onShow', evt);
    this._fire('onProgress', { type: 'show', ...evt });
    this._scheduleAfter(this.options.fixationMs, () => this._advanceToCapturing(point, pixelX, pixelY));
  }

  _advanceToCapturing(point, pixelX, pixelY) {
    if (this._state === 'aborted') return;
    this._state = 'capturing';
    this._dispatchClick({ pixelX, pixelY, point, index: this._index });
    const evt = {
      point,
      index: this._index,
      total: this.options.points.length,
      pixelX,
      pixelY,
    };
    this._fire('onCapture', evt);
    this._fire('onProgress', { type: 'capture', ...evt });
    this._scheduleAfter(this.options.captureMs, () => this._advanceToNext());
  }

  _advanceToNext() {
    if (this._state === 'aborted') return;
    this._index += 1;
    this._fire('onProgress', { type: 'advance', index: this._index, total: this.options.points.length });
    if (this._index >= this.options.points.length) {
      this._finalize();
    } else {
      this._advanceToShowing();
    }
  }

  _finalize() {
    if (this._state === 'aborted') return;
    this._state = 'finalizing';
    const points = this.options.points.map(p => ({ x: p.x, y: p.y }));
    Promise.resolve()
      .then(() => this._runtime.calibrateGaze(points))
      .catch(err => ({ ok: false, reason: 'runtime_threw', message: err?.message || String(err) }))
      .then(result => {
        if (this._state === 'aborted') return;
        this._state = 'complete';
        this._fire('onComplete', result);
        this._fire('onProgress', { type: 'complete', result });
        this._resolve(result);
      });
  }

  // ---- internal: side effects ----

  _dispatchClick(evt) {
    const dispatcher = this.options.clickDispatcher;
    if (!dispatcher) return;
    try {
      dispatcher(evt);
    } catch (err) {
      this._reportHookError('clickDispatcher', err);
    }
  }

  _toPixel(point) {
    const { width, height } = this._viewport;
    return {
      pixelX: Math.round((0.5 + point.x) * width),
      pixelY: Math.round((0.5 + point.y) * height),
    };
  }

  _scheduleAfter(ms, fn) {
    this._clearTimer();
    this._timer = this.options.setTimer(() => {
      this._timer = null;
      fn();
    }, ms);
  }

  _clearTimer() {
    if (this._timer != null) {
      try { this.options.clearTimer(this._timer); } catch { /* idempotent */ }
      this._timer = null;
    }
  }

  _fire(name, payload) {
    const fn = this.options[name];
    if (typeof fn !== 'function') return;
    try {
      fn(payload);
    } catch (err) {
      this._reportHookError(name, err);
    }
  }

  _reportHookError(hook, err) {
    if (typeof this.options.onHookError === 'function') {
      try { this.options.onHookError({ hook, error: err }); } catch { /* never reentrant */ }
    } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(`[oyon/gaze] calibration hook '${hook}' threw:`, err?.message || err);
    }
  }

  _resolve(result) {
    const r = this._pending;
    this._pending = null;
    if (r) r(result);
  }
}

/** Frozen reference to the default 5-point sequence (for introspection / tests). */
export const DEFAULT_CALIBRATION_POINTS = DEFAULT_POINTS;

function sanitizePoint(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function positiveNumber(v, fallback) {
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
