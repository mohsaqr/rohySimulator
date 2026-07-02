/**
 * WebGazerAdapter — optional screen-point gaze engine backed by WebGazer.js.
 *
 * WebGazer emits viewport pixel predictions through `setGazeListener()`.
 * This adapter normalizes those pixels into Oyon's common `GazeSample`
 * convention: x/y in [-0.5, 0.5], origin at screen center.
 *
 * WebGazer is a selectable runtime dependency. The adapter lazy-loads it in
 * init(), so projects that keep using webeyetrack do not pay the startup cost.
 */

const PEER_DEPENDENCY_HINT =
  "Ensure `webgazer` is installed and bundled with this app. " +
  'WebGazer is GPL-3.0-or-later licensed; see NOTICE.md for the license disclosure.';

export class WebGazerAdapter {
  constructor(options = {}) {
    if (typeof options.onGaze !== 'function') {
      throw new Error('WebGazerAdapter: onGaze callback is required.');
    }
    this.options = {
      minQualityScore: 0.3,
      clock: () => Date.now(),
      viewport: null,
      regression: null,
      showVideoPreview: false,
      showFaceOverlay: false,
      showFaceFeedbackBox: false,
      showPredictionPoints: false,
      saveDataAcrossSessions: false,
      stream: null,
      faceMeshSolutionPath: null,
      scriptUrl: 'https://webgazer.cs.brown.edu/webgazer.js',
      ...options,
    };
    this._webgazer = options.webgazer || null;
    this._initialized = Boolean(options.webgazer);
    this._started = false;
    this._disposed = false;
    this._lastSample = null;
    this._lastError = null;
    this._status = this._initialized ? 'idle' : null;
    this._listener = null;
    // WebGazer can emit coarse screen-point predictions before explicit
    // calibration. Calibration improves the persisted regression model, but it
    // must not gate window emission or the analytics dashboard stays empty.
    this.requiresCalibration = false;
  }

  async init() {
    if (this._disposed) throw new Error('WebGazerAdapter: cannot init after dispose().');
    if (this._initialized) {
      this._configureWebGazer();
      this._status = 'idle';
      return;
    }

    let mod;
    try {
      mod = await import('webgazer');
    } catch (err) {
      await this._loadScriptFallback();
      const globalWebGazer = typeof globalThis !== 'undefined' ? globalThis.webgazer : null;
      if (!globalWebGazer) {
        const e = new Error(`WebGazerAdapter: failed to load 'webgazer'. ${PEER_DEPENDENCY_HINT}`);
        e.cause = err;
        throw e;
      }
      mod = globalWebGazer;
    }

    this._webgazer = mod?.default || mod?.webgazer || mod;
    if (!this._webgazer || typeof this._webgazer.setGazeListener !== 'function') {
      throw new Error("WebGazerAdapter: 'webgazer' did not expose setGazeListener().");
    }
    this._configureWebGazer();
    this._initialized = true;
    this._status = 'idle';
  }

  async start() {
    if (this._disposed) throw new Error('WebGazerAdapter: cannot start after dispose().');
    if (!this._initialized) throw new Error('WebGazerAdapter: call init() before start().');
    if (this._started) return;

    this._listener = (prediction, elapsedTime) => this._handlePrediction(prediction, elapsedTime);
    this._callChain('setGazeListener', this._listener);
    const stream = this._resolveStream();
    if (stream) this._callChain('setStaticVideo', stream);
    this._status = 'starting';
    try {
      await Promise.resolve(this._webgazer.begin?.());
      this._lastError = null;
      this._started = true;
      this._status = 'inference';
    } catch (err) {
      this._started = false;
      this._status = 'error';
      this._lastError = err;
      throw err;
    }
  }

  async calibrate(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return { ok: false, reason: 'insufficient_samples' };
    }
    if (!this._initialized) {
      return { ok: false, reason: 'not_initialized' };
    }
    if (!this._started) {
      return { ok: false, reason: 'adapter_not_running' };
    }
    // WebGazer trains from page interactions. The Oyon overlay dispatches
    // real click events at the target positions, so by the time runtime
    // calls calibrate(points), WebGazer has already observed the anchors.
    // When available, record the same targets explicitly as a second path;
    // this makes calibration deterministic for hosts that call
    // runtime.calibrateGaze(points) after showing their own targets.
    let recorded = 0;
    if (typeof this._webgazer?.recordScreenPosition === 'function') {
      const viewport = this._viewport();
      for (const p of points) {
        if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
        const pixelX = Math.round((0.5 + p.x) * viewport.width);
        const pixelY = Math.round((0.5 + p.y) * viewport.height);
        try {
          this._webgazer.recordScreenPosition(pixelX, pixelY, 'click');
          recorded += 1;
        } catch { /* optional API */ }
      }
    }
    // WebGazer does not surface a calibration quality readout. When we
    // were able to record anchors explicitly, we report `'inferred'` with
    // a coarse fraction (anchors-recorded / anchors-supplied). Otherwise
    // the only training signal came from page clicks the host already
    // delivered — we have no way to quantify that, so `'unknown'`.
    if (recorded > 0) {
      return {
        ok: true,
        quality: clamp01(recorded / points.length),
        confidence: 'inferred',
        model: 'webgazer',
      };
    }
    return { ok: true, quality: null, confidence: 'unknown', model: 'webgazer' };
  }

  status() {
    return this._status;
  }

  lastError() {
    return this._lastError;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._started = false;
    this._status = 'idle';
    try { this._callChain('setGazeListener', null); } catch { /* idempotent */ }
    try { this._webgazer?.pause?.(); } catch { /* idempotent */ }
    // WebGazer's `end()` releases its FaceMesh worker + camera. It's not
    // available on every build, hence the optional call. Without this, the
    // legacy MediaPipe Module global hangs around in the page session and
    // can collide with Tasks Vision the next time MediaPipe loads.
    try { this._webgazer?.end?.(); } catch { /* idempotent */ }
    // Belt-and-braces: clear the same global Emscripten factories that
    // MediaPipeFaceTracker resets on init(). Doing it on dispose too means
    // the next non-MediaPipe consumer (a hot-reload, a test) also gets a
    // clean slate without waiting for the next face tracker init.
    if (typeof globalThis !== 'undefined') {
      for (const key of ['createMediapipeSolutionsWasm', 'createMediapipeSolutionsPackedAssets', 'Module']) {
        try { delete globalThis[key]; } catch { globalThis[key] = undefined; }
      }
    }
  }

  _configureWebGazer() {
    if (this.options.faceMeshSolutionPath && this._webgazer?.params) {
      this._webgazer.params.faceMeshSolutionPath = this.options.faceMeshSolutionPath;
    }
    if (this.options.regression) this._callChain('setRegression', this.options.regression);
    this._callChain('saveDataAcrossSessions', Boolean(this.options.saveDataAcrossSessions));
    this._callChain('showVideoPreview', Boolean(this.options.showVideoPreview));
    this._callChain('showFaceOverlay', Boolean(this.options.showFaceOverlay));
    this._callChain('showFaceFeedbackBox', Boolean(this.options.showFaceFeedbackBox));
    this._callChain('showPredictionPoints', Boolean(this.options.showPredictionPoints));
  }

  async _loadScriptFallback() {
    const url = this.options.scriptUrl;
    if (!url || typeof document === 'undefined') return;
    if (typeof globalThis !== 'undefined' && globalThis.webgazer) return;
    const existing = document.querySelector(`script[data-oyon-webgazer="true"]`);
    if (existing) {
      await new Promise((resolve, reject) => {
        if (typeof globalThis !== 'undefined' && globalThis.webgazer) { resolve(); return; }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
      return;
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.oyonWebgazer = 'true';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`failed to load ${url}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  _callChain(method, ...args) {
    const fn = this._webgazer?.[method];
    if (typeof fn !== 'function') return null;
    return fn.apply(this._webgazer, args);
  }

  _handlePrediction(prediction, elapsedTime) {
    if (this._disposed || !this._started) return;
    const sample = normalizeWebGazerPrediction(
      prediction,
      elapsedTime,
      this.options.clock(),
      this.options.minQualityScore,
      this._viewport(),
    );
    if (!sample) return;
    this._lastSample = sample;
    try {
      this.options.onGaze(sample);
    } catch (err) {
      this._reportCallbackError(err);
    }
  }

  _viewport() {
    const configured = typeof this.options.viewport === 'function'
      ? this.options.viewport()
      : this.options.viewport;
    if (configured && configured.width > 0 && configured.height > 0) {
      return configured;
    }
    const w = typeof window !== 'undefined' ? window : null;
    return {
      width: w?.innerWidth || 1,
      height: w?.innerHeight || 1,
    };
  }

  _resolveStream() {
    const configured = typeof this.options.stream === 'function'
      ? this.options.stream()
      : this.options.stream;
    return configured || null;
  }

  _reportCallbackError(err) {
    if (typeof this.options.onError === 'function') {
      try { this.options.onError(err); } catch { /* never reentrant */ }
    } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[oyon/gaze/webgazer] onGaze callback threw:', err?.message || err);
    }
  }
}

export function normalizeWebGazerPrediction(
  prediction,
  elapsedTime,
  wallClockMs,
  minQualityScore = 0.3,
  viewport = { width: 1, height: 1 },
) {
  if (!prediction || !Number.isFinite(prediction.x) || !Number.isFinite(prediction.y)) {
    return null;
  }
  const width = viewport.width > 0 ? viewport.width : 1;
  const height = viewport.height > 0 ? viewport.height : 1;
  const x = prediction.x / width - 0.5;
  const y = prediction.y / height - 0.5;
  const offAxis = Math.max(Math.abs(x), Math.abs(y));
  const quality = clamp01(1 - Math.max(0, offAxis - 0.5));
  return {
    x,
    y,
    quality,
    quality_source: 'geometric',
    valid: quality >= minQualityScore,
    gaze_state: 'open',
    ts_ms: wallClockMs,
    ts_video_ms: Number.isFinite(elapsedTime) ? elapsedTime : null,
  };
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
