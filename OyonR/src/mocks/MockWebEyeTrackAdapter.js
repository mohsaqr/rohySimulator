/**
 * MockWebEyeTrackAdapter — drop-in replacement for `WebEyeTrackAdapter` in
 * tests, demos, and runtime smoke checks. No camera, no worker, no peer dep.
 *
 * The mock implements the *full* adapter contract that downstream code
 * relies on (smoother, aggregator, runtime tests), even where the real
 * Stage 1 adapter is upstream-limited (calibration — see real adapter's
 * class docstring). This lets us drive Stages 2-4 with realistic tests.
 *
 * Usage:
 *   const adapter = new MockWebEyeTrackAdapter({ onGaze });
 *   await adapter.init();
 *   await adapter.start();
 *
 *   // Scripted samples — main test mode.
 *   adapter.emitSample({ x: 0.1, y: -0.2, quality: 0.9 });
 *
 *   // Or auto-emit on a clock (rarely needed; prefer scripted).
 *   adapter.scheduleSamples([{ x: 0, y: 0, quality: 1, atMs: 100 }], clock);
 *
 *   // Calibration — full contract, returns ok:true after sample threshold.
 *   await adapter.calibrate(five_points); // → { ok: true, quality, model }
 */

const DEFAULT_MIN_CALIBRATION_SAMPLES = 5;

export class MockWebEyeTrackAdapter {
  constructor(options = {}) {
    if (typeof options.onGaze !== 'function') {
      throw new Error('MockWebEyeTrackAdapter: onGaze callback is required.');
    }
    this.options = {
      minQualityScore: 0.3,
      minCalibrationSamples: DEFAULT_MIN_CALIBRATION_SAMPLES,
      calibrationQuality: 0.82,
      modelName: 'mock-blazegaze',
      clock: () => Date.now(),
      ...options,
    };
    this._initialized = false;
    this._started = false;
    this._disposed = false;
    this._status = 'idle';
    this._lastSample = null;
    this._calibratedAt = null;
    this._emitCount = 0;
  }

  async init() {
    if (this._disposed) throw new Error('MockWebEyeTrackAdapter: cannot init after dispose().');
    this._initialized = true;
  }

  async start() {
    if (this._disposed) throw new Error('MockWebEyeTrackAdapter: cannot start after dispose().');
    if (!this._initialized) throw new Error('MockWebEyeTrackAdapter: call init() before start().');
    this._started = true;
    this._status = 'inference';
  }

  /**
   * Emit a synthetic gaze sample through the onGaze callback. The sample
   * shape matches the real adapter's `GazeSample`.
   */
  emitSample(partial = {}) {
    if (!this._started) return;
    if (this._disposed) return;
    const wallClock = this.options.clock();
    const x = Number.isFinite(partial.x) ? partial.x : 0;
    const y = Number.isFinite(partial.y) ? partial.y : 0;
    const quality = Number.isFinite(partial.quality) ? clamp01(partial.quality) : 1;
    const gazeState = partial.gaze_state === 'closed' ? 'closed' : 'open';
    const valid = gazeState === 'open' && quality >= this.options.minQualityScore;
    const sample = {
      x,
      y,
      quality,
      quality_source: typeof partial.quality_source === 'string' ? partial.quality_source : 'geometric',
      valid,
      gaze_state: gazeState,
      ts_ms: Number.isFinite(partial.ts_ms) ? partial.ts_ms : wallClock,
      ts_video_ms: Number.isFinite(partial.ts_video_ms) ? partial.ts_video_ms : this._emitCount * 33,
    };
    this._lastSample = sample;
    this._emitCount += 1;
    try {
      this.options.onGaze(sample);
    } catch {
      // Swallow caller errors to match real adapter's contract.
    }
  }

  /**
   * Drive a scripted sequence of samples. Useful for table-driven tests.
   * Each item: { x, y, quality?, gaze_state? }.
   */
  emitSequence(samples) {
    if (!Array.isArray(samples)) return;
    for (const s of samples) this.emitSample(s);
  }

  /**
   * Full calibration contract (real adapter is upstream-limited in Stage 1).
   * Empty / too-short input → ok:false. Otherwise records a "trained" state
   * and returns ok:true.
   */
  async calibrate(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return { ok: false, reason: 'insufficient_samples' };
    }
    if (points.length < this.options.minCalibrationSamples) {
      return { ok: false, reason: 'insufficient_samples' };
    }
    if (!this._initialized) {
      return { ok: false, reason: 'not_initialized' };
    }
    this._status = 'calib';
    this._calibratedAt = this.options.clock();
    this._status = 'inference';
    return {
      ok: true,
      quality: this.options.calibrationQuality,
      confidence: 'measured',
      model: this.options.modelName,
    };
  }

  status() {
    if (!this._initialized) return null;
    return this._status;
  }

  /**
   * ms since the most recent successful calibrate(); null if never calibrated.
   */
  calibrationAgeMs() {
    if (this._calibratedAt == null) return null;
    return this.options.clock() - this._calibratedAt;
  }

  /**
   * The configured calibration quality reported on the most recent
   * successful calibrate(). null if never calibrated.
   */
  calibrationQuality() {
    return this._calibratedAt == null ? null : this.options.calibrationQuality;
  }

  modelName() {
    return this.options.modelName;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._started = false;
    this._status = 'idle';
  }
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
