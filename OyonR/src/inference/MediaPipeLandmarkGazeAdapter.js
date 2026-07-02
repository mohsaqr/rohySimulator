/**
 * MediaPipeLandmarkGazeAdapter — calibration-free gaze from the face tracker
 * the runtime already owns.
 *
 * Why this adapter exists (see AGENT-NOTE-GAZE-INTEGRATION.md): host apps
 * that already run Oyon's MediaPipeFaceTracker must not pay for a second
 * camera stream, a second FaceMesh runtime, or WebGazer's global-singleton
 * lifecycle just to get aggregate gaze windows. This adapter derives a
 * `GazeSample` stream from the iris landmarks in the face result that
 * `EmotionRuntime.sampleOnce()` already produces:
 *
 *   CameraController → MediaPipeFaceTracker → emotion + engagement + gaze
 *
 * Unlike the WebGazer / WebEyeTrack adapters it is NOT event-driven from its
 * own engine — the runtime pushes each face result in via
 * `handleFace(face, timestampMs)` (capability-detected; injected adapters
 * without that method are simply never called).
 *
 * Coordinate mapping: `extractEyeFeatures` yields head-pose-compensated iris
 * offsets normalized by the eye-corner span. Those are eye-rotation units,
 * not screen units, so a fixed gain maps them onto the screen square:
 *
 *   screen_x = clamp(-xGain · meanIrisX, ±0.5)   // flipX: camera → screen
 *   screen_y = clamp( yGain · meanIrisY, ±0.5)   // image +y down = screen down
 *
 * The X flip: landmarks live in unmirrored camera-image space, so a user
 * looking toward screen-left moves the iris toward +x in the image.
 * yGain > xGain because vertical iris travel is anatomically smaller.
 *
 * This is an UNCALIBRATED estimate. `calibrate()` resolves honestly with
 * `quality: null, confidence: 'inferred'` — there is no per-user regression
 * to train. `requiresCalibration = false` tells the runtime to bypass its
 * `gaze_calibration_required` gate; hosts that need calibrated screen-point
 * accuracy should opt into the `webgazer` engine instead.
 *
 * Privacy: consumes the in-memory face result, emits only the small scalar
 * `GazeSample` shape. No landmarks are retained or forwarded.
 */

import { extractEyeFeatures } from './EyeFeatureExtractor.js';

export const MEDIAPIPE_GAZE_MODEL = 'mediapipe-landmarks';

const DEFAULT_X_GAIN = 2.0;
const DEFAULT_Y_GAIN = 2.5;
// One eye gives no cross-eye agreement check; cap its quality below 1 but
// above the default min-quality threshold so single-eye frames still count.
const ONE_EYE_QUALITY = 0.6;
// Normalizer for the two-eye disagreement penalty: offsets 0.3 apart (in
// eye-span units) → quality 0.
const EYE_DISAGREEMENT_SPAN = 0.3;

export class MediaPipeLandmarkGazeAdapter {
  /**
   * @param {object} options
   * @param {(sample: object) => void} options.onGaze  Required.
   * @param {number} [options.minQualityScore=0.3]
   * @param {() => number} [options.clock]             Test-injectable wall clock.
   * @param {(err: unknown) => void} [options.onError]
   * @param {object} [options.settings]                Partial OyonSettings forwarded
   *        to extractEyeFeatures (blink_mask_threshold, gaze_zone_neutral_deg).
   * @param {number} [options.xGain=2.0]
   * @param {number} [options.yGain=2.5]
   * @param {boolean} [options.flipX=true]
   */
  constructor(options = {}) {
    if (typeof options.onGaze !== 'function') {
      throw new Error('MediaPipeLandmarkGazeAdapter: onGaze callback is required.');
    }
    this.options = {
      minQualityScore: 0.3,
      clock: () => Date.now(),
      settings: {},
      xGain: DEFAULT_X_GAIN,
      yGain: DEFAULT_Y_GAIN,
      flipX: true,
      ...options,
    };
    // The calibration-free capability travels with the adapter so the
    // runtime's gate works for host-injected instances without settings
    // coordination.
    this.requiresCalibration = false;
    this._state = null; // null until init(); then 'idle' | 'inference'
    this._diag = {
      rawFrames: 0,
      validSamples: 0,
      invalidSamples: 0,
      lastSampleAt: null,
      lastError: null,
      calibrationRuns: 0,
    };
  }

  /**
   * No resources to acquire — the runtime owns the camera and face tracker.
   * Legal after dispose() (dispose is non-terminal here, unlike the engine
   * adapters), which is what makes same-instance runtime restarts work.
   */
  async init() {
    this._state = 'idle';
  }

  async start() {
    if (this._state === null) {
      throw new Error('MediaPipeLandmarkGazeAdapter: call init() before start().');
    }
    this._state = 'inference';
  }

  /** 'idle' | 'inference', or null before init(). */
  status() {
    return this._state;
  }

  /** Idempotent and non-terminal: re-init()/start() after dispose is legal. */
  dispose() {
    if (this._state !== null) this._state = 'idle';
  }

  /**
   * Honest no-op: there is no per-user model to train. Quality is null (we
   * cannot measure one) with confidence 'inferred' — the geometry itself is
   * the calibration.
   */
  async calibrate() {
    this._diag.calibrationRuns += 1;
    return { ok: true, quality: null, confidence: 'inferred', model: MEDIAPIPE_GAZE_MODEL };
  }

  /**
   * Counters for debugging silent-absence failures (the chatoyon post-mortem):
   * when windows lack gaze, diagnostics() tells you whether frames ever
   * reached the adapter and why they didn't become valid samples.
   */
  diagnostics() {
    const lastError = this._diag.lastError;
    return {
      adapterStatus: this.status(),
      rawFrames: this._diag.rawFrames,
      validSamples: this._diag.validSamples,
      invalidSamples: this._diag.invalidSamples,
      lastSampleAt: this._diag.lastSampleAt,
      lastError: lastError == null ? null : (lastError.message || String(lastError)),
      calibrationRuns: this._diag.calibrationRuns,
    };
  }

  /**
   * Push one face-tracker result through the gaze mapping. Called by the
   * runtime per frame (including facePresent:false frames, which count as
   * invalid here rather than disappearing silently).
   *
   * @param {object} face          result of MediaPipeFaceTracker.analyze()
   * @param {number} [timestampMs] video/sample timestamp (becomes ts_video_ms)
   */
  handleFace(face, timestampMs) {
    if (this._state !== 'inference') return;
    this._diag.rawFrames += 1;

    const features = extractEyeFeatures(face, this.options.settings);
    const sample = featuresToGazeSample(
      features,
      this.options,
      this.options.clock(),
      Number.isFinite(timestampMs) ? timestampMs : null,
    );
    if (sample === null) {
      this._diag.invalidSamples += 1;
      return;
    }
    if (sample.valid) {
      this._diag.validSamples += 1;
    } else {
      this._diag.invalidSamples += 1;
    }
    this._diag.lastSampleAt = sample.ts_ms;
    try {
      this.options.onGaze(sample);
    } catch (err) {
      this._diag.lastError = err;
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
 * Pure mapping from EyeFeatureExtractor output to a GazeSample. Exported for
 * testing.
 *
 * Returns:
 *   - null when there is nothing to emit (no face, or no refined irises) —
 *     the adapter counts these as invalid frames;
 *   - a closed-eye sample ({x:0, y:0, quality:0, valid:false}) when both
 *     eyes are blinking, so blinks still count in the window's total_frames;
 *   - an open sample otherwise. Quality is geometric: with both eyes it is
 *     1 minus the eyes' disagreement (offsets far apart = unreliable), with
 *     one eye it is capped at ONE_EYE_QUALITY.
 *
 * @param {object|null} features      extractEyeFeatures() output
 * @param {object} [opts]             {minQualityScore, xGain, yGain, flipX}
 * @param {number} [wallClockMs]
 * @param {number|null} [videoMs]
 * @returns {object|null}
 */
export function featuresToGazeSample(features, opts = {}, wallClockMs = Date.now(), videoMs = null) {
  if (!features) return null;

  const minQualityScore = Number.isFinite(opts.minQualityScore) ? opts.minQualityScore : 0.3;
  const xGain = Number.isFinite(opts.xGain) ? opts.xGain : DEFAULT_X_GAIN;
  const yGain = Number.isFinite(opts.yGain) ? opts.yGain : DEFAULT_Y_GAIN;
  const flipX = opts.flipX !== false;

  if (features.blink_l === true && features.blink_r === true) {
    return {
      x: 0,
      y: 0,
      quality: 0,
      quality_source: 'geometric',
      valid: false,
      gaze_state: 'closed',
      ts_ms: wallClockMs,
      ts_video_ms: videoMs,
    };
  }

  const l = features.iris_offset_normalized?.l ?? null;
  const r = features.iris_offset_normalized?.r ?? null;
  if (!l && !r) return null; // no refined irises in this frame

  const meanX = l && r ? (l.x + r.x) / 2 : (l ? l.x : r.x);
  const meanY = l && r ? (l.y + r.y) / 2 : (l ? l.y : r.y);

  let quality;
  if (l && r) {
    const disagreement = Math.hypot(l.x - r.x, l.y - r.y);
    quality = clamp01(1 - disagreement / EYE_DISAGREEMENT_SPAN);
  } else {
    quality = ONE_EYE_QUALITY;
  }

  const rawX = (flipX ? -1 : 1) * xGain * meanX;
  const rawY = yGain * meanY;

  return {
    x: clampHalf(rawX),
    y: clampHalf(rawY),
    quality,
    quality_source: 'geometric',
    valid: quality >= minQualityScore,
    gaze_state: 'open',
    ts_ms: wallClockMs,
    ts_video_ms: videoMs,
  };
}

function clamp01(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampHalf(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < -0.5) return -0.5;
  if (v > 0.5) return 0.5;
  return v;
}
