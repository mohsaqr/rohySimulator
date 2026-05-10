import { EventEmitter } from './EventEmitter.js';
import { CameraController } from '../capture/CameraController.js';
import { MediaPipeFaceTracker } from '../inference/MediaPipeFaceTracker.js';
import { OnnxEmotionClassifier } from '../inference/OnnxEmotionClassifier.js';
import { EmotionAggregator } from '../aggregation/EmotionAggregator.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';
import { OyonLogger } from '../logging/OyonLogger.js';
import { OyonMetricRecorder } from '../logging/OyonMetrics.js';
import { DynamicalFeatureTracker } from '../analytics/DynamicalFeatures.js';
import { createOyonSettings, settingsSnapshot } from '../settings/OyonSettings.js';

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
    // Pass the classifier's label set into the aggregator. Without this the
    // aggregator falls back to its 7-emotion default (legacy FER set, no
    // 'contempt'), but every shipped model config — HSE, EmotiEff MobileViT,
    // EmotiEff MBF — emits 8 emotions including 'contempt'. The aggregator
    // would then average 7 of 8 probabilities per window, producing sums
    // around 0.875 — outside the server validator's [0.95, 1.05] window.
    // Result: every emotion-records POST got a 400 and zero rows landed in
    // oyon_emotion_records. Wiring the label set through fixes it at the
    // source rather than relaxing the validator.
    this.aggregator = options.aggregator || new EmotionAggregator({
      windowMs: this.settings.aggregate_window_ms,
      minValidFrames: this.settings.min_valid_frames,
      sampleIntervalMs: this.settings.sample_interval_ms,
      labels: this.classifier?.options?.labels,
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
    if (finalWindow) await this.sendWindows([finalWindow]);
    this.camera.stop();
    this.logger.info('oyon.capture.stopped');
    this.events.emit('status', { state: 'stopped' });
  }

  /**
   * Tear down everything stop() doesn't: the ONNX inference session,
   * MediaPipe FaceLandmarker, and the references the runtime holds onto.
   *
   * Why this exists separately from stop():
   *   stop() is the "pause this capture" verb — the runtime can still be
   *   re-started afterwards and we want camera/timer cleanup but not model
   *   teardown (reloading would be expensive). dispose() is the "this
   *   runtime is done forever" verb. Without it, repeated widget re-mounts
   *   or model-profile changes accumulate WebGPU pipelines, ONNX sessions
   *   and MediaPipe WASM resources, eventually starving GPU memory and
   *   degrading subsequent captures.
   *
   * Idempotent: calling twice is safe — guarded by `this.disposed`.
   */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { await this.stop(); } catch { /* best-effort */ }

    // ONNX Runtime Web: InferenceSession.release() frees the WebGPU/WASM
    // backend's compiled kernels. The classifier wraps an `ort.InferenceSession`
    // on `this.classifier.session`.
    try {
      const release = this.classifier?.session?.release;
      if (typeof release === 'function') await release.call(this.classifier.session);
    } catch { /* best-effort */ }

    // MediaPipe: FaceLandmarker.close() releases the WASM heap allocations.
    try {
      const close = this.faceTracker?.faceLandmarker?.close;
      if (typeof close === 'function') await close.call(this.faceTracker.faceLandmarker);
    } catch { /* best-effort */ }

    // Drop strong references so GC can sweep the rest.
    this.camera = null;
    this.faceTracker = null;
    this.classifier = null;
    this.aggregator = null;
    this.transport = null;
    this.dynamics = null;
    this.metrics = null;
    this.contextProvider = () => ({});
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

    const durationMs = performanceNow() - startedAt;
    this.metrics.record('oyon.sample.duration', durationMs, { unit: 'ms' });
    this.events.emit('sample', { face, prediction, durationMs });
    if (windowResult) await this.sendWindows([windowResult]);
  }

  addMissingSample(timestamp, reason) {
    const windowResult = this.aggregator.addSample({
      timestamp,
      facePresent: false,
      quality: { reason },
    });
    this.events.emit('sample', { face: { facePresent: false, reason }, prediction: null });
    if (windowResult) {
      this.sendWindows([windowResult]).catch(error => this.events.emit('error', error));
    }
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
    await this.transport.send(events, context);
  }
}

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
