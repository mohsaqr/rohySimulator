import { EventEmitter } from './EventEmitter.js';
import { CameraController } from '../capture/CameraController.js';
import { MediaPipeFaceTracker } from '../inference/MediaPipeFaceTracker.js';
import { OnnxEmotionClassifier } from '../inference/OnnxEmotionClassifier.js';
import { EmotionAggregator } from '../aggregation/EmotionAggregator.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';
import { OyonLogger } from '../logging/OyonLogger.js';
import { OyonMetricRecorder } from '../logging/OyonMetrics.js';
import { DynamicalFeatureTracker } from '../analytics/DynamicalFeatures.js';
import { createOyonSettings, settingsSnapshot, normalizeAois } from '../settings/OyonSettings.js';
import { extractEyeFeatures } from '../inference/EyeFeatureExtractor.js';
import { EyeSmoother } from '../smoothing/EyeSmoother.js';
import { EngagementAggregator } from '../aggregation/EngagementAggregator.js';
import { createGazeAdapter, GAZE_ENGINE_MODEL_VERSIONS } from '../inference/GazeAdapterFactory.js';
import { GazeSmoother } from '../smoothing/GazeSmoother.js';
import { GazeAggregator } from '../aggregation/GazeAggregator.js';

const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

export class EmotionRuntime {
  constructor(options = {}) {
    const requestedSettings = createOyonSettings({
      ...options.settings,
      ...(Object.prototype.hasOwnProperty.call(options, 'sampleIntervalMs') ? { sample_interval_ms: options.sampleIntervalMs } : {}),
      ...(Object.prototype.hasOwnProperty.call(options, 'captureMode') ? { capture_mode: options.captureMode } : {}),
    });
    this.options = {
      sampleIntervalMs: requestedSettings.sample_interval_ms || DEFAULT_SAMPLE_INTERVAL_MS,
      consentVersion: 'fer-consent-v1',
      captureMode: requestedSettings.capture_mode || 'local-browser',
      ...options,
    };
    this.settings = requestedSettings;

    this.events = new EventEmitter();
    this.camera = options.camera || new CameraController(options.cameraOptions);
    this.faceTracker = options.faceTracker || new MediaPipeFaceTracker(options.mediaPipe);
    this.classifier = options.classifier || new OnnxEmotionClassifier(options.onnx);
    this.aggregator = options.aggregator || new EmotionAggregator({
      windowMs: this.settings.aggregate_window_ms,
      minValidFrames: this.settings.min_valid_frames,
      sampleIntervalMs: this.settings.sample_interval_ms,
      ...options.aggregation,
    });
    this.transport = options.transport || new HttpEmotionTransport(options.transportOptions);
    this.contextProvider = options.contextProvider || (() => ({}));
    this.logger = options.logger || new OyonLogger({
      contextProvider: this.contextProvider,
      transports: options.logTransports || [],
    });
    this.metrics = options.metrics || new OyonMetricRecorder({
      contextProvider: this.contextProvider,
      transports: options.metricTransports || [],
    });
    this.dynamics = options.dynamics || new DynamicalFeatureTracker(options.dynamicsOptions);

    // Eye-tracking pipeline (opt-in via settings.eye_tracking_enabled).
    if (this.settings.eye_tracking_enabled) {
      this.eyeEnabled = true;
      this.eyeExtractor = options.eyeExtractor || {
        extract: (face) => extractEyeFeatures(face, this.settings),
      };
      this.eyeSmoother = options.eyeSmoother || new EyeSmoother({
        alpha: this.settings.smoothing_alpha,
        gazeZoneMinHoldMs: this.settings.min_hold_ms,
        gazeZoneMinSwitchVotes: 2,
      });
      this.engagementAggregator = options.engagementAggregator || new EngagementAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
        blinkRateBaselineHz: this.settings.blink_rate_baseline_hz,
        gazeEntropyGridN: this.settings.gaze_entropy_grid_n,
        focusScoreWeights: this.settings.focus_score_weights,
      });
    } else {
      this.eyeEnabled = false;
      this.eyeExtractor = null;
      this.eyeSmoother = null;
      this.engagementAggregator = null;
    }

    // Screen-point gaze pipeline (opt-in via settings.gaze_tracking_enabled).
    // Adapter callback is event-driven (samples flow in whenever the worker
    // emits a result); we feed each into smoother → aggregator inside the
    // same JS task. Aggregator window is force-flushed at the emotion
    // window boundary when gaze_window_share is true.
    if (this.settings.gaze_tracking_enabled) {
      this.gazeEnabled = true;
      this.gazeCalibrated = false;
      this._gazeCalibrationMeta = { calibratedAt: null, quality: null, confidence: 'unknown', model: null };
      this._stashedGazeWindow = null;
      this._consecutiveEmptyGazeWindows = 0;
      this._gazeGateLogged = false;
      this.gazeSmoother = options.gazeSmoother || new GazeSmoother({
        alpha: 0.5,
        minQualityScore: this.settings.gaze_min_quality_score,
      });
      this.gazeAggregator = options.gazeAggregator || new GazeAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
        zoneGrid: this.settings.gaze_zone_grid,
        aois: this.settings.gaze_aois,
        dropOffScreen: this.settings.gaze_drop_off_screen,
        modelVersion: GAZE_ENGINE_MODEL_VERSIONS[this.settings.gaze_engine]
          || this.settings.gaze_engine,
      });
      this.gazeAdapter = options.gazeAdapter || options.webEyeTrackAdapter || createGazeAdapter({
        engine: this.settings.gaze_engine,
        videoElementId: options.gaze?.videoElementId,
        onGaze: (sample) => this._handleGazeSample(sample),
        minQualityScore: this.settings.gaze_min_quality_score,
        settings: this.settings,
        mediapipe: options.gaze?.mediapipe,
        webgazer: options.gaze?.webgazer,
        webeyetrack: options.gaze?.webeyetrack,
      });
      this.webEyeTrackAdapter = this.gazeAdapter;
      // Route any adapter's callback through the runtime so injected
      // adapters (incl. the mock) still flow samples into the smoother /
      // aggregator. Both real adapter and mock store the callback in
      // `options.onGaze`.
      if (this.gazeAdapter?.options) {
        this.gazeAdapter.options.onGaze = (sample) => this._handleGazeSample(sample);
      }
    } else {
      this.gazeEnabled = false;
      this.gazeCalibrated = false;
      this.gazeSmoother = null;
      this.gazeAggregator = null;
      this.gazeAdapter = null;
      this.webEyeTrackAdapter = null;
      this._gazeCalibrationMeta = { calibratedAt: null, quality: null, confidence: 'unknown', model: null };
      this._stashedGazeWindow = null;
    }

    this.running = false;
    this.paused = false;
    this.initialized = false;
    this.timer = null;
    this.lastFlushAt = 0;
  }

  on(type, handler) {
    return this.events.on(type, handler);
  }

  async init() {
    if (this.initialized) return;
    this.events.emit('status', { state: 'initializing' });
    this.logger.info('oyon.runtime.initializing', { settings_hash: settingsSnapshot(this.settings).settings_hash });
    await this.faceTracker.init();
    await this.classifier.init();
    if (this.gazeEnabled && this.gazeAdapter && typeof this.gazeAdapter.init === 'function') {
      try {
        await this.gazeAdapter.init();
      } catch (err) {
        this.logger.warn('oyon.gaze.adapter_init_failed', { message: err?.message || String(err) });
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('[oyon/gaze] adapter init failed:', err);
        }
        // Degrade gracefully: leave gazeEnabled true but emit warning; flushes
        // will simply have no buffered samples.
      }
    }
    this.initialized = true;
    this.logger.info('oyon.runtime.ready');
    this.events.emit('status', { state: 'ready' });
  }

  async start() {
    if (this.running) return;
    await this.init();
    this.running = true;
    this.paused = false;
    this.events.emit('status', { state: 'starting-camera' });
    await this.camera.start();
    if (this.gazeEnabled && this.gazeAdapter && typeof this.gazeAdapter.start === 'function') {
      try {
        await this.gazeAdapter.start();
      } catch (err) {
        this.logger.warn('oyon.gaze.adapter_start_failed', { message: err?.message || String(err) });
      }
    }
    this.logger.info('oyon.capture.started');
    this.events.emit('status', { state: 'running' });
    this.scheduleNextSample(0);
  }

  pause() {
    if (!this.running) return;
    this.paused = true;
    this.logger.info('oyon.capture.paused');
    this.events.emit('status', { state: 'paused' });
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.logger.info('oyon.capture.resumed');
    this.events.emit('status', { state: 'running' });
    this.scheduleNextSample(0);
  }

  async stop() {
    this.running = false;
    this.paused = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const finalWindow = this.aggregator.flush();
    let finalEngagement = null;
    if (this.eyeEnabled) {
      finalEngagement = this.engagementAggregator.flush();
    }
    let finalGaze = null;
    if (this.gazeEnabled && this._gazeAvailable()) {
      // _consumeGazeWindow drains any stashed window from a prior auto-flush
      // first, then falls back to a flush of any remaining buffered frames.
      finalGaze = this._consumeGazeWindow(Date.now());
    }

    if (finalWindow) {
      if (this.eyeEnabled && this.settings.engagement_window_share && finalEngagement) {
        finalWindow.engagement = finalEngagement;
      }
      if (this.gazeEnabled && this.settings.gaze_window_share && finalGaze) {
        finalWindow.gaze = finalGaze;
      }
      await this.sendWindows([finalWindow]);
    } else {
      // No emotion window. Synthesize research-only events for any signal
      // that did flush data of its own.
      const events = [];
      if (this.eyeEnabled && finalEngagement && !this.settings.engagement_window_share) {
        events.push({ engagement_only: true, ...finalEngagement });
      }
      if (this.gazeEnabled && finalGaze && !this.settings.gaze_window_share) {
        events.push({ gaze_only: true, gaze: finalGaze, window_start: finalGaze.window_start, window_end: finalGaze.window_end });
      }
      if (events.length > 0) await this.sendWindows(events);
    }

    if (this.gazeEnabled && this.gazeAdapter && typeof this.gazeAdapter.dispose === 'function') {
      try { this.gazeAdapter.dispose(); } catch { /* idempotent */ }
    }

    this.camera.stop();
    this.logger.info('oyon.capture.stopped');
    this.events.emit('status', { state: 'stopped' });
  }

  scheduleNextSample(delay = this.options.sampleIntervalMs) {
    if (!this.running || this.paused || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.sampleOnce();
      } catch (error) {
        this.logger.error('oyon.sample.error', error);
        this.events.emit('error', error);
      } finally {
        if (this.running && !this.paused) this.scheduleNextSample();
      }
    }, delay);
  }

  async sampleOnce() {
    const now = Date.now();
    const startedAt = performanceNow();
    const video = this.camera.video;
    if (!video || video.readyState < 2) {
      this.addMissingSample(now, 'video-not-ready');
      return;
    }

    const face = await this.faceTracker.analyze(video, now);

    // Face-derived gaze: adapters that expose handleFace (the MediaPipe
    // landmark engine, or a host-injected equivalent) are fed every face
    // result from the single shared tracker — before the facePresent
    // early-return, so absent-face frames are counted by the adapter
    // instead of disappearing silently.
    if (this.gazeEnabled && this.gazeAdapter && typeof this.gazeAdapter.handleFace === 'function') {
      try {
        this.gazeAdapter.handleFace(face, now);
      } catch (err) {
        this.logger.warn('oyon.gaze.handle_face_failed', { message: err?.message || String(err) });
      }
    }

    if (!face.facePresent) {
      this.addMissingSample(now, face.reason || 'no-face');
      return;
    }

    const prediction = await this.classifier.classify(video, {
      bbox: face.bbox,
      landmarks: face.landmarks,
    });

    const windowResult = this.aggregator.addSample({
      timestamp: now,
      facePresent: true,
      probabilities: prediction.probabilities,
      valence: prediction.valence,
      arousal: prediction.arousal,
      confidence: prediction.confidence,
      entropy: prediction.entropy,
      quality: face.quality,
      model: prediction.model,
    });

    // Eye / engagement pipeline. Feeds the same MediaPipe result into the
    // independent engagement aggregator (Stage 5).
    let engagementWindow = null;
    let eyeSample = null;
    if (this.eyeEnabled) {
      const eyeFeatures = this.eyeExtractor.extract(face);
      const smoothed = eyeFeatures ? this.eyeSmoother.update(eyeFeatures, now) : null;
      if (smoothed) {
        engagementWindow = this.engagementAggregator.consumeFrame(smoothed, now);
        eyeSample = summarizeEyeSample(smoothed);
      }
    }

    const durationMs = performanceNow() - startedAt;
    this.metrics.record('oyon.sample.duration', durationMs, { unit: 'ms' });
    this.events.emit('sample', { face, prediction, eye: eyeSample, durationMs });

    if (windowResult) {
      if (this.eyeEnabled && this.settings.engagement_window_share) {
        // If the engagement aggregator's own consumeFrame already produced a
        // window at this boundary (its buffer is now empty), use that result.
        // Otherwise force-flush to grab whatever buffered scalars remain so
        // the two streams stay aligned.
        const aligned = engagementWindow || this.engagementAggregator.flush(now);
        windowResult.engagement = aligned;
      }
      // Mirror the engagement boundary: pick up the most recent gaze
      // window (auto-flushed inside consumeFrame, or force-flushed now)
      // so both blocks describe the same window.
      this._attachGazeBlock(windowResult, now);
      await this.sendWindows([windowResult]);
    } else if (this.eyeEnabled && engagementWindow && !this.settings.engagement_window_share) {
      // Non-shared mode: research-only batch with engagement-only payload.
      await this.sendWindows([{ engagement_only: true, ...engagementWindow }]);
    }
  }

  addMissingSample(timestamp, reason) {
    const windowResult = this.aggregator.addSample({
      timestamp,
      facePresent: false,
      quality: { reason },
    });
    this.events.emit('sample', { face: { facePresent: false, reason }, prediction: null });
    if (windowResult) {
      if (this.eyeEnabled && this.settings.engagement_window_share) {
        const aligned = this.engagementAggregator.flush(timestamp);
        windowResult.engagement = aligned;
      }
      this._attachGazeBlock(windowResult, timestamp);
      this.sendWindows([windowResult]).catch(error => this.events.emit('error', error));
    }
  }

  /**
   * Public calibration entry. Hosts pass a sequence of normalized screen
   * targets in [-0.5, 0.5]; the adapter records samples for each and returns
   * a structured result. When `gaze_calibration_required` is true, gaze
   * blocks are emitted only after a successful calibrate(); when false, the
   * runtime emits gaze blocks immediately on adapter samples.
   *
   * @param {Array<{x:number, y:number}>} points
   * @returns {Promise<{ok:true, quality:number, model:string} | {ok:false, reason:string}>}
   */
  async calibrateGaze(points) {
    if (!this.gazeEnabled) return { ok: false, reason: 'gaze_tracking_not_enabled' };
    if (!this.gazeAdapter || typeof this.gazeAdapter.calibrate !== 'function') {
      return { ok: false, reason: 'adapter_unavailable' };
    }
    this.events.emit('status', { state: 'gaze:calibrating' });
    let result;
    try {
      result = await this.gazeAdapter.calibrate(points);
    } catch (err) {
      result = { ok: false, reason: 'adapter_threw', message: err?.message || String(err) };
    }
    if (result && result.ok) {
      this.gazeCalibrated = true;
      const confidence = result.confidence === 'measured' || result.confidence === 'inferred'
        ? result.confidence
        : 'unknown';
      this._gazeCalibrationMeta = {
        calibratedAt: Date.now(),
        quality: Number.isFinite(result.quality) ? result.quality : null,
        confidence,
        model: typeof result.model === 'string' ? result.model : null,
      };
      this.logger.info('oyon.gaze.calibrated', {
        quality: this._gazeCalibrationMeta.quality,
        confidence,
        model: this._gazeCalibrationMeta.model,
      });
      // Only record the metric when we actually have a number. Emitting
      // `0` for "unknown" would poison time-series dashboards.
      if (this._gazeCalibrationMeta.quality != null) {
        this.metrics.record('oyon.gaze.calibration_quality', this._gazeCalibrationMeta.quality, {
          unit: 'ratio',
          confidence,
        });
      }
      this.events.emit('status', { state: 'gaze:calibrated', confidence });
    } else {
      this.logger.warn('oyon.gaze.calibration_failed', {
        reason: result?.reason || 'unknown',
      });
      this.events.emit('status', { state: 'gaze:calibration_failed', reason: result?.reason || 'unknown' });
    }
    return result;
  }

  /**
   * Replace the gaze Areas-of-Interest LIVE, without restarting capture.
   * Hosts use this to track a moving/resizing on-screen target (e.g. a tutor
   * avatar's face region) — the aggregator reads `options.aois` at every
   * flush, so the next window's `aoi_dwell_ms` reflects the new rects.
   * Rects use the gaze coordinate convention: [-0.5, 0.5], origin = screen
   * center, x/y = the rect's top-left corner. Input is normalized/capped by
   * the same validator as the `gaze_aois` setting; invalid entries drop.
   *
   * @param {Array<{id:string,x:number,y:number,width:number,height:number}>} aois
   * @returns {Array} the normalized AOIs now in effect
   */
  setGazeAois(aois) {
    const normalized = normalizeAois(aois);
    this.settings.gaze_aois = normalized; // keep settingsSnapshot() honest
    if (this.gazeAggregator) this.gazeAggregator.options.aois = normalized;
    return normalized;
  }

  /**
   * @internal Per-sample gaze handler invoked by the adapter callback.
   * Runs smoother → aggregator inside the current JS task. No transport.
   */
  _handleGazeSample(sample) {
    if (!this.gazeEnabled || !this.gazeSmoother || !this.gazeAggregator) return;
    const smoothed = this.gazeSmoother.update(sample);
    if (!smoothed) return;
    const ts = Number.isFinite(smoothed.ts_ms) ? smoothed.ts_ms : Date.now();
    // consumeFrame auto-flushes when wall-clock crosses windowMs and returns
    // the completed window. We must capture and stash it: the emission path
    // (sampleOnce / addMissingSample) attaches gaze blocks at the emotion
    // window boundary, but if we discard this return value the buffer is
    // already empty by the time that path calls flush() — yielding null and
    // a gaze-less window. Stashing aligns the two streams without changing
    // the aggregator's auto-flush semantics.
    const completed = this.gazeAggregator.consumeFrame(smoothed, ts);
    if (completed) {
      // Attach calibration metadata at stash time so it reflects state when
      // the window closed, not when it later gets attached.
      const meta = this._currentCalibrationMeta();
      completed.calibration_age_ms = meta.calibrationAgeMs;
      completed.calibration_quality = meta.calibrationQuality;
      completed.calibration_confidence = meta.calibrationConfidence;
      this._stashedGazeWindow = completed;
    }
  }

  /**
   * @internal Attach the gaze block for this window boundary, or log why
   * there is none. Honest-absence contract (AGENT-NOTE-GAZE-INTEGRATION.md):
   * when gaze is enabled and available, every shared window carries a gaze
   * block — empty windows emit n_points: 0 rather than omitting the key, and
   * persistent emptiness produces a structured warning with adapter
   * diagnostics. When gated on calibration, the omission is logged once.
   */
  _attachGazeBlock(windowResult, ts) {
    if (!this.gazeEnabled || !this.settings.gaze_window_share) return;
    if (!this._gazeAvailable()) {
      if (!this._gazeGateLogged) {
        this._gazeGateLogged = true;
        this.logger.info('oyon.gaze.gated_awaiting_calibration', {
          engine: this.settings.gaze_engine,
        });
      }
      return;
    }
    const gazeBlock = this._consumeGazeWindow(ts, { emitEmpty: true });
    if (!gazeBlock) return;
    windowResult.gaze = gazeBlock;
    if (gazeBlock.n_points > 0) {
      this._consecutiveEmptyGazeWindows = 0;
      return;
    }
    this._consecutiveEmptyGazeWindows += 1;
    const consecutive = this._consecutiveEmptyGazeWindows;
    if (consecutive === 3 || (consecutive > 3 && (consecutive - 3) % 10 === 0)) {
      this.logger.warn('oyon.gaze.persistent_empty', {
        consecutive,
        engine: this.settings.gaze_engine,
        adapter_status: typeof this.gazeAdapter?.status === 'function'
          ? this.gazeAdapter.status()
          : null,
        diagnostics: typeof this.gazeAdapter?.diagnostics === 'function'
          ? this.gazeAdapter.diagnostics()
          : null,
      });
    }
  }

  /**
   * @internal Returns the most recent gaze window (stashed by an auto-flush
   * inside consumeFrame, or produced now by an explicit flush call), and
   * clears the stash. Returns null when nothing is available, unless
   * emitEmpty requests an honest zero window.
   */
  _consumeGazeWindow(ts, { emitEmpty = false } = {}) {
    if (this._stashedGazeWindow) {
      const w = this._stashedGazeWindow;
      this._stashedGazeWindow = null;
      return w;
    }
    return this.gazeAggregator.flush(ts, this._currentCalibrationMeta(), { emitEmpty });
  }

  /**
   * @internal Whether the gaze pipeline should emit (calibration gating).
   * Adapters that declare `requiresCalibration === false` (the MediaPipe
   * landmark engine, or host-injected face-derived adapters) bypass the
   * gate: their geometry needs no per-user training.
   */
  _gazeAvailable() {
    if (!this.gazeEnabled) return false;
    if (this.gazeAdapter?.requiresCalibration === false) return true;
    if (this.settings.gaze_calibration_required && !this.gazeCalibrated) return false;
    return true;
  }

  /**
   * @internal Snapshot of the calibration meta the aggregator needs at flush.
   */
  _currentCalibrationMeta() {
    const m = this._gazeCalibrationMeta;
    return {
      calibrationAgeMs: m.calibratedAt == null ? null : Date.now() - m.calibratedAt,
      calibrationQuality: m.quality,
      calibrationConfidence: m.confidence,
    };
  }

  async sendWindows(windows) {
    if (!windows.length) return;
    const context = this.contextProvider() || {};
    const snapshot = settingsSnapshot(this.settings);
    const events = windows.map(window => ({
      ...context,
      ...window,
      dynamics: this.settings.enable_dynamics ? this.dynamics.update(window) : null,
      settings_snapshot: snapshot,
      settings_hash: snapshot.settings_hash,
      capture_mode: this.options.captureMode,
      consent_version: this.options.consentVersion,
    }));
    this.events.emit('window', events);
    this.logger.info('oyon.window.emitted', {
      count: events.length,
      settings_hash: snapshot.settings_hash,
      valid_frames: events.reduce((sum, event) => sum + (event.valid_frames || 0), 0),
    });
    this.metrics.record('oyon.window.emitted', events.length, { unit: 'count' });

    // Stage 5: emit an engagement summary log + metric for any window with an
    // engagement block. One log line per batch; one metric per qualifying event.
    if (this.eyeEnabled) {
      const engagementEvents = events.filter(event => event && event.engagement);
      if (engagementEvents.length > 0) {
        this.logger.info('oyon.engagement.window', {
          count: engagementEvents.length,
          settings_hash: snapshot.settings_hash,
          summaries: engagementEvents.map(event => ({
            blink_rate_hz: event.engagement.blink_rate_hz ?? null,
            gaze_entropy: event.engagement.gaze_entropy ?? null,
            focus_score: event.engagement.focus_score ?? null,
            valid_frame_ratio: event.engagement.valid_frame_ratio ?? null,
          })),
        });
        for (const event of engagementEvents) {
          const focusScore = event.engagement.focus_score;
          if (Number.isFinite(focusScore)) {
            this.metrics.record('oyon.engagement.focus_score', focusScore, { unit: 'ratio' });
          }
        }
      }
    }

    // Gaze summary log per batch, mirroring the engagement pattern.
    if (this.gazeEnabled) {
      const gazeEvents = events.filter(event => event && event.gaze);
      if (gazeEvents.length > 0) {
        this.logger.info('oyon.gaze.window', {
          count: gazeEvents.length,
          settings_hash: snapshot.settings_hash,
          summaries: gazeEvents.map(event => ({
            n_points: event.gaze.n_points ?? null,
            dispersion: event.gaze.dispersion ?? null,
            off_screen_ratio: event.gaze.off_screen_ratio ?? null,
            valid_frame_ratio: event.gaze.valid_frame_ratio ?? null,
          })),
        });
        for (const event of gazeEvents) {
          if (Number.isFinite(event.gaze.dispersion)) {
            this.metrics.record('oyon.gaze.dispersion', event.gaze.dispersion, { unit: 'ratio' });
          }
        }
      }
    }

    await this.transport.send(events, context);
  }
}

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function summarizeEyeSample(sample) {
  if (!sample) return null;
  return {
    valid: sample.valid === true,
    smoothed: sample.smoothed === true,
    blink_l: sample.blink_l === true,
    blink_r: sample.blink_r === true,
    eye_openness_l: finiteOrNull(sample.eye_openness_l),
    eye_openness_r: finiteOrNull(sample.eye_openness_r),
    gaze_zone: typeof sample.gaze_zone === 'string' ? sample.gaze_zone : null,
    ts_ms: finiteOrNull(sample.ts_ms) ?? Date.now(),
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
