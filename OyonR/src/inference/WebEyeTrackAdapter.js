/**
 * WebEyeTrackAdapter — Stage 1 of the screen-point gaze pipeline.
 *
 * Wraps the upstream `webeyetrack` library (v0.0.2) behind an Oyon-shaped
 * adapter so the rest of the pipeline (smoother, aggregator, runtime) only
 * ever sees a small normalized `GazeSample` shape:
 *
 *   GazeSample = {
 *     x: number,                  // [-0.5, 0.5] left→right, screen-normalized
 *     y: number,                  // [-0.5, 0.5] top→bottom
 *     quality: number,            // [0, 1] confidence proxy
 *     valid: boolean,             // true when face tracked AND eyes open
 *     gaze_state: 'open' | 'closed',
 *     ts_ms: number,              // wall-clock ms (Date.now() at receive time)
 *     ts_video_ms: number,        // upstream video-relative ms
 *   }
 *
 * Why an adapter at all:
 *   - `webeyetrack` is v0.0.2 with one principal maintainer. Bus-factor risk
 *     is documented in the plan (§6 #1); a thin adapter means swapping the
 *     engine later doesn't touch smoother/aggregator/runtime.
 *   - The upstream type `GazeResult` carries raw landmarks, blendshapes, an
 *     `eyePatch` ImageData, and a transformation matrix — strictly more than
 *     Oyon's privacy model allows downstream. The adapter strips all of it.
 *
 * Upstream API surface used:
 *   - `WebcamClient(videoElementId)` — owns the <video> stream.
 *   - `WebEyeTrackProxy(webcamClient)` — runs inference in a Web Worker;
 *     exposes a single `onGazeResults` callback and a public `status` field
 *     ('idle' | 'inference' | 'calib').
 *
 * Calibration:
 *   The upstream proxy does NOT publicly expose a `calibrate(points)` method.
 *   Calibration is driven through DOM click events that the library hooks
 *   into via `WebEyeTrack.handleClick`. The real calibration path is the
 *   Stage 5 overlay: it dispatches synthetic clicks at target dots, then
 *   calls this method so the runtime can flip its calibration gate.
 *
 * Constructor options:
 *   - videoElementId: string. Required.
 *   - onGaze: (sample: GazeSample) => void. Required.
 *   - minQualityScore: number in [0, 1]. Samples below this become valid:false
 *     but still flow through (the smoother decides whether to advance state).
 *   - clock: () => number. Test-injectable wall-clock; defaults to Date.now.
 *
 * Lifecycle:
 *   const adapter = new WebEyeTrackAdapter({ videoElementId: 'video', onGaze });
 *   await adapter.init();    // lazy-imports webeyetrack; throws if missing
 *   await adapter.start();   // starts the webcam frame loop
 *   ...
 *   adapter.dispose();       // idempotent; stops webcam, drops callback
 */

const PEER_DEPENDENCY_HINT =
  "Ensure `webeyetrack` is installed and bundled with this app. " +
  "See docs/SCREEN_POINT_GAZE.md for the full setup.";

export class WebEyeTrackAdapter {
  constructor(options = {}) {
    if (!options.videoElementId) {
      throw new Error('WebEyeTrackAdapter: videoElementId is required.');
    }
    if (typeof options.onGaze !== 'function') {
      throw new Error('WebEyeTrackAdapter: onGaze callback is required.');
    }
    this.options = {
      minQualityScore: 0.3,
      clock: () => Date.now(),
      ...options,
    };
    this._webcamClient = null;
    this._proxy = null;
    this._initialized = false;
    this._started = false;
    this._disposed = false;
    this._lastSample = null;
  }

  /**
   * Lazy-imports `webeyetrack` and instantiates the worker proxy.
   * Throws a clear error if the runtime dependency is missing.
   */
  async init() {
    if (this._initialized) return;
    if (this._disposed) throw new Error('WebEyeTrackAdapter: cannot init after dispose().');

    let mod;
    try {
      mod = await import('webeyetrack');
    } catch (err) {
      const e = new Error(`WebEyeTrackAdapter: failed to load 'webeyetrack'. ${PEER_DEPENDENCY_HINT}`);
      e.cause = err;
      throw e;
    }

    const WebcamClient = mod.WebcamClient || mod.default?.WebcamClient;
    const WebEyeTrackProxy = mod.WebEyeTrackProxy || mod.default?.WebEyeTrackProxy;
    if (!WebcamClient || !WebEyeTrackProxy) {
      throw new Error(
        "WebEyeTrackAdapter: 'webeyetrack' did not export WebcamClient + WebEyeTrackProxy. " +
          'Upstream API may have changed; pin webeyetrack@0.0.2.',
      );
    }

    this._webcamClient = new WebcamClient(this.options.videoElementId);
    this._proxy = new WebEyeTrackProxy(this._webcamClient);
    this._proxy.onGazeResults = (gazeResult) => this._handleGazeResult(gazeResult);
    this._initialized = true;
  }

  /**
   * Marks the adapter as started. Upstream WebEyeTrackProxy owns the webcam
   * frame loop and calls WebcamClient.startWebcam(callback) when its worker
   * emits "ready"; calling startWebcam() here would create a second camera
   * stream / frame loop.
   */
  async start() {
    if (this._disposed) throw new Error('WebEyeTrackAdapter: cannot start after dispose().');
    if (!this._initialized) throw new Error('WebEyeTrackAdapter: call init() before start().');
    if (this._started) return;
    this._started = true;
  }

  /**
   * Calibration entry point. See class docstring for the Stage 1 limitation.
   * Returns a structured result (resolved promise, never rejects).
   *
   * @param {Array<{x:number, y:number}>} points  Calibration targets in [-0.5, 0.5].
   * @returns {Promise<{ok:true, quality:number, model:string} | {ok:false, reason:string}>}
   */
  async calibrate(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return { ok: false, reason: 'insufficient_samples' };
    }
    if (!this._initialized) {
      return { ok: false, reason: 'not_initialized' };
    }
    // Contract with the Stage 5 calibration overlay: the overlay walks the
    // user through each `points[i]` and dispatches a synthetic
    // `MouseEvent('click', { clientX, clientY })` at the dot's pixel
    // position. `webeyetrack@0.0.2`'s worker treats each click as a brief
    // calib state, returns to idle immediately after handleClick(), and
    // resumes inference on the next accepted video frame. By the time the
    // overlay finishes the 5-point sweep and calls `runtime.calibrateGaze`,
    // the worker has already adapted from those click anchors.
    //
    // webeyetrack@0.0.2 does not surface a calibration quality value.
    // Return `quality: null` with `confidence: 'unknown'` so callers can
    // tell the difference between "the engine measured a real number" and
    // "we have no number". Hosts that drive `runtime.calibrateGaze()`
    // without the overlay (no clicks) still see ok:true here, but their
    // gaze data will be poorly calibrated — the runtime's gating relies
    // on the host respecting the click contract above.
    if (!this._started || !this._proxy) {
      return { ok: false, reason: 'adapter_not_running' };
    }
    return {
      ok: true,
      quality: null,
      confidence: 'unknown',
      model: 'webeyetrack-0.0.2',
    };
  }

  /**
   * The current proxy status reported by webeyetrack: 'idle' | 'inference' | 'calib'.
   * Returns null when not initialized.
   */
  status() {
    return this._proxy?.status ?? null;
  }

  /**
   * Releases the camera and detaches the callback. Idempotent.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try {
      if (this._webcamClient && typeof this._webcamClient.stopWebcam === 'function') {
        this._webcamClient.stopWebcam();
      }
    } catch {
      // Swallow: dispose must be idempotent and never throw.
    }
    if (this._proxy) {
      this._proxy.onGazeResults = () => {};
    }
    this._proxy = null;
    this._webcamClient = null;
    this._started = false;
  }

  /**
   * @internal Normalizes a webeyetrack `GazeResult` into our `GazeSample`.
   * Strips raw landmarks / eyePatch / matrices — privacy invariant.
   */
  _handleGazeResult(gazeResult) {
    if (this._disposed) return;
    const sample = normalizeGazeResult(gazeResult, this.options.clock(), this.options.minQualityScore);
    if (sample === null) return;
    this._lastSample = sample;
    try {
      this.options.onGaze(sample);
    } catch (err) {
      // Caller-thrown errors must not poison the worker callback. Re-throwing
      // here would bubble into webeyetrack's internals.
      this._reportCallbackError(err);
    }
  }

  _reportCallbackError(err) {
    if (typeof this.options.onError === 'function') {
      try { this.options.onError(err); } catch { /* never reentrant */ }
    } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[oyon/gaze] onGaze callback threw:', err?.message || err);
    }
  }
}

/**
 * Pure normalization helper. Exported for testing.
 *
 * Quality model:
 *   - `gazeState === 'closed'`  → quality 0, valid false (blink).
 *   - Missing/invalid normPog   → returns null (drop the frame entirely).
 *   - Otherwise                  → quality 1 minus a small penalty for
 *     points beyond the unit screen square. Below `minQualityScore` → valid false.
 *
 * `webeyetrack@0.0.2` does not expose a per-frame confidence; this is a
 * pragmatic proxy that the smoother (Stage 2) and aggregator (Stage 3) can
 * filter on. When upstream ships a confidence value we wire it in here.
 */
export function normalizeGazeResult(gazeResult, wallClockMs, minQualityScore = 0.3) {
  if (!gazeResult || !Array.isArray(gazeResult.normPog) || gazeResult.normPog.length < 2) {
    return null;
  }
  const x = Number(gazeResult.normPog[0]);
  const y = Number(gazeResult.normPog[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const gazeState = gazeResult.gazeState === 'closed' ? 'closed' : 'open';
  const offAxis = Math.max(Math.abs(x), Math.abs(y));
  const baseQuality = gazeState === 'closed' ? 0 : Math.max(0, 1 - Math.max(0, offAxis - 0.5));
  const quality = clamp01(baseQuality);
  const valid = gazeState === 'open' && quality >= minQualityScore;

  return {
    x,
    y,
    quality,
    quality_source: 'geometric',
    valid,
    gaze_state: gazeState,
    ts_ms: wallClockMs,
    ts_video_ms: Number.isFinite(gazeResult.timestamp) ? gazeResult.timestamp : null,
  };
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
