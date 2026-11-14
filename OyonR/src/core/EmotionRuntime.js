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
import { extractFacialSignals, headPoseFromMatrix } from '../inference/FacialSignalExtractor.js';
import { FacialSignalAggregator } from '../aggregation/FacialSignalAggregator.js';
import { MediaPipePoseTracker } from '../inference/MediaPipePoseTracker.js';
import { extractPostureFeatures } from '../inference/PostureFeatureExtractor.js';
import { PostureAggregator } from '../aggregation/PostureAggregator.js';
import { poseLandmarkerUrlForModel } from '../config/cdnDefaults.js';
import { HeartRateEstimator, sampleFaceRoiRgb } from '../analytics/HeartRateEstimator.js';
import { HeartRateRoiSampler } from '../analytics/HeartRateRoiSampler.js';
import { HeartRateAggregator } from '../aggregation/HeartRateAggregator.js';
import { RespirationEstimator } from '../analytics/RespirationEstimator.js';
import { RespirationAggregator } from '../aggregation/RespirationAggregator.js';
import { IlluminationEstimator } from '../analytics/IlluminationEstimator.js';
import { IlluminationAggregator } from '../aggregation/IlluminationAggregator.js';
import { createGazeAdapter, GAZE_ENGINE_MODEL_VERSIONS } from '../inference/GazeAdapterFactory.js';
import { GazeSmoother } from '../smoothing/GazeSmoother.js';
import { GazeAggregator } from '../aggregation/GazeAggregator.js';
import { GroupSessionClock, httpClockSource } from './GroupSessionClock.js';
import {
  RawStreamRecorder, affectRow, eyeRow, headRow, postureRow, heartRateRow,
  respirationRow, illuminationRow, screenGazeRow, rawOnlyEnvelope,
} from '../aggregation/RawStreamRecorder.js';

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
    this.camera = options.camera || new CameraController({
      diagnosticsEnabled: this.settings.capture_quality_enabled,
      ...options.cameraOptions,
    });
    this.faceTracker = options.faceTracker || new MediaPipeFaceTracker(options.mediaPipe);
    this.classifier = options.classifier || new OnnxEmotionClassifier(options.onnx);
    this.aggregator = options.aggregator || new EmotionAggregator({
      windowMs: this.settings.aggregate_window_ms,
      minValidFrames: this.settings.min_valid_frames,
      sampleIntervalMs: this.settings.sample_interval_ms,
      ...options.aggregation,
    });
    this.transport = options.transport || new HttpEmotionTransport({
      maxPostBytes: this.settings.transport_max_post_bytes,
      ...options.transportOptions,
    });
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

    // Group alignment (docs/GROUP_SYNCHRONY.md): an injectable group clock —
    // or one built from settings.group_clock_url — stamps ts_group_ms beside
    // every local timestamp, and window_anchor_ms makes every member's window
    // k cover the same group-time interval.
    this.groupClock = options.groupClock || (this.settings.group_clock_url
      ? new GroupSessionClock({
        getServerTime: httpClockSource(this.settings.group_clock_url),
        resyncMs: this.settings.group_clock_resync_ms,
        onError: (err) => this.logger.warn('oyon.group_clock.sync_failed', { message: err?.message || String(err) }),
        onSync: (snap) => this.logger.info('oyon.group_clock.synced', snap),
      })
      : null);
    if (Number.isFinite(this.settings.window_anchor_ms) && this.aggregator?.options) {
      this.aggregator.options.windowAnchorMs = () => this._windowAnchorLocalMs();
    }
    // Per-sample series at the rate each producer runs, drained onto the next
    // window as raw_streams. On by default (research-grade data policy).
    // Lossless: a stream that reaches the recorder's row bound is sent early as
    // a raw-only envelope (_spillRawStreams) instead of being cut.
    this.rawStreams = options.rawStreams || new RawStreamRecorder({
      clock: this.groupClock,
      onFull: () => { this._spillRawStreams(); },
    });

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

    // Facial-signals pipeline (head pose + action units). Free-rides on the
    // face result the emotion pipeline already produces — no extra model or
    // inference. Opt-in via settings.facial_signals_enabled.
    if (this.settings.facial_signals_enabled) {
      this.facialEnabled = true;
      this.facialExtractor = options.facialExtractor || {
        extract: (face) => extractFacialSignals(face, this.settings),
      };
      this.facialAggregator = options.facialAggregator || new FacialSignalAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
      });
    } else {
      this.facialEnabled = false;
      this.facialExtractor = null;
      this.facialAggregator = null;
    }

    // Body-posture pipeline (MediaPipe PoseLandmarker). Opt-in via
    // settings.posture_tracking_enabled. Runs its own detectForVideo on the
    // shared camera frame — a second model load, but the SAME tasks-vision
    // wasm fileset as the face tracker.
    if (this.settings.posture_tracking_enabled) {
      this.postureEnabled = true;
      this._stashedPostureWindow = null;
      this._lastPostureSample = null;
      this.poseTracker = options.poseTracker || new MediaPipePoseTracker({
        ...(options.pose || {}),
        modelAssetPath: (options.pose && options.pose.modelAssetPath)
          || poseLandmarkerUrlForModel(this.settings.posture_model),
      });
      this.postureExtractor = options.postureExtractor || {
        extract: (pose) => extractPostureFeatures(pose, this.settings),
      };
      this.postureAggregator = options.postureAggregator || new PostureAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
      });
    } else {
      this.postureEnabled = false;
      this.poseTracker = null;
      this.postureExtractor = null;
      this.postureAggregator = null;
      this._stashedPostureWindow = null;
      this._lastPostureSample = null;
    }

    // Remote heart-rate (rPPG) pipeline. Opt-in via settings.heart_rate_enabled.
    // A lightweight video-frame loop samples the latest face ROI independently
    // of the expensive face/emotion loop. The slow loop only refreshes the bbox
    // and reads the estimator's throttled rolling result.
    // Respiration reads the LOW band (0.1-0.5 Hz) of the same ROI colour
    // stream, so it needs the ROI sampler running — but not the heart-rate
    // pipeline itself. Either signal alone is enough to justify the sampler.
    this.respirationEnabled = Boolean(this.settings.respiration_enabled);
    if (this.respirationEnabled) {
      this._stashedRespirationWindow = null;
      this.respirationEstimator = options.respirationEstimator || new RespirationEstimator({
        bufferSeconds: this.settings.respiration_buffer_seconds,
        minWindowSeconds: this.settings.respiration_min_window_seconds,
        minConfidence: this.settings.respiration_min_confidence,
        plausibleMinBrpm: this.settings.respiration_plausible_min_brpm,
        plausibleMaxBrpm: this.settings.respiration_plausible_max_brpm,
        rgbCorroboration: this.settings.respiration_rgb_corroboration,
        requireRgbCorroboration: this.settings.respiration_require_rgb_corroboration,
        minimumSampleRateHz: this.settings.respiration_min_sample_rate_hz,
        maxSampleGapMs: this.settings.respiration_max_sample_gap_ms,
      });
      this.respirationAggregator = options.respirationAggregator || new RespirationAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
      });
    } else {
      this.respirationEstimator = null;
      this.respirationAggregator = null;
      this._stashedRespirationWindow = null;
    }

    if (this.settings.heart_rate_enabled || this.respirationEnabled) {
      this.heartRateEnabled = Boolean(this.settings.heart_rate_enabled);
      this._stashedHeartRateWindow = null;
      this.roiSampler = options.roiSampler
        || ((video, face) => sampleFaceRoiRgb(video, face, this.settings.heart_rate_roi));
      this.heartRateEstimator = !this.heartRateEnabled ? null : options.heartRateEstimator || new HeartRateEstimator({
        bufferSeconds: this.settings.heart_rate_buffer_seconds,
        minWindowSeconds: this.settings.heart_rate_min_window_seconds,
        method: this.settings.heart_rate_method,
        minConfidence: this.settings.heart_rate_min_confidence,
      });
      this._hrLastPose = null; // for the head-motion sampling gate
      this.heartRateAggregator = !this.heartRateEnabled ? null : options.heartRateAggregator || new HeartRateAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
        maxSlewBpmPerS: this.settings.heart_rate_max_slew_bpm_per_s,
        trackerWindows: this.settings.heart_rate_tracker_windows,
        minEstimatesForAnchor: this.settings.heart_rate_tracker_min_estimates,
        resetBpm: this.settings.heart_rate_tracker_reset_bpm,
        resetWindows: this.settings.heart_rate_tracker_reset_windows,
        plausibleMinBpm: this.settings.heart_rate_plausible_min_bpm,
        plausibleMaxBpm: this.settings.heart_rate_plausible_max_bpm,
        implausibleCorroboration: this.settings.heart_rate_implausible_corroboration,
        robust: {
          enabled: this.settings.heart_rate_anomaly_filter,
          fold: this.settings.heart_rate_harmonic_fold,
          foldTol: this.settings.heart_rate_fold_tolerance,
          madH: this.settings.heart_rate_mad_h,
          madFloor: this.settings.heart_rate_mad_floor_bpm,
          weighted: this.settings.heart_rate_confidence_weighted,
          minWeight: this.settings.heart_rate_min_weight,
        },
      });
      this.heartRateSampler = new HeartRateRoiSampler({
        getVideo: () => this.camera.video,
        sampleRoi: this.roiSampler,
        estimator: this.heartRateEstimator,
        estimators: this.respirationEstimator ? [this.respirationEstimator] : [],
        targetFps: this.settings.heart_rate_target_fps,
        maxFaceAgeMs: Math.max(2000, this.settings.sample_interval_ms * 2.5),
        onError: (err) => this.logger.warn('oyon.heart_rate.roi_sample_failed', {
          message: err?.message || String(err),
        }),
      });
    } else {
      this.heartRateEnabled = false;
      this.roiSampler = null;
      this.heartRateEstimator = null;
      this.heartRateAggregator = null;
      this.heartRateSampler = null;
      this._stashedHeartRateWindow = null;
    }

    // Ambient illumination. Not a signal about the learner — the covariate
    // that says how far to trust every other signal, since rPPG, emotion
    // confidence and gaze quality all degrade in poor or unstable light.
    // Costs one 32x18 canvas read per sample tick.
    if (this.settings.illumination_enabled) {
      this.illuminationEnabled = true;
      this._stashedIlluminationWindow = null;
      this.illuminationEstimator = options.illuminationEstimator || new IlluminationEstimator();
      this.illuminationAggregator = options.illuminationAggregator || new IlluminationAggregator({
        windowMs: this.settings.aggregate_window_ms,
        sampleIntervalMs: this.settings.sample_interval_ms,
      });
    } else {
      this.illuminationEnabled = false;
      this.illuminationEstimator = null;
      this.illuminationAggregator = null;
      this._stashedIlluminationWindow = null;
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
        // Calibrated browser engines are event-driven and normally emit near
        // video cadence. The slow emotion interval is only the correct fallback
        // for the face-derived MediaPipe engine.
        sampleIntervalMs: this.settings.gaze_engine === 'mediapipe'
          ? this.settings.sample_interval_ms
          : 33,
        zoneGrid: this.settings.gaze_zone_grid,
        aois: this.settings.gaze_aois,
        dropOffScreen: this.settings.gaze_drop_off_screen,
        fixationMinDurationMs: this.settings.gaze_fixation_min_duration_ms,
        fixationDispersionThreshold: this.settings.gaze_fixation_dispersion_threshold,
        minFixationSampleRateHz: this.settings.gaze_fixation_min_sample_rate_hz,
        maxSampleGapMs: this.settings.gaze_max_sample_gap_ms,
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
    if (this.postureEnabled && this.poseTracker && typeof this.poseTracker.init === 'function') {
      try {
        await this.poseTracker.init();
      } catch (err) {
        this.logger.warn('oyon.posture.tracker_init_failed', { message: err?.message || String(err) });
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('[oyon/posture] pose tracker init failed:', err);
        }
      }
    }
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
    if (this.running) {
      // Re-announce the actual lifecycle state instead of returning silently.
      // A host whose UI drifted out of sync (it thinks capture is off) calls
      // start() and waits for a status event to clear its spinner — without
      // this emit, nothing ever arrives and the host spins forever.
      this.events.emit('status', { state: this.paused ? 'paused' : 'running' });
      return;
    }
    await this.init();
    this.running = true;
    this.paused = false;
    if (this.groupClock && typeof this.groupClock.start === 'function') {
      // Not awaited: the first handshake must not delay the camera. Failures
      // are reported through the clock's onError and leave ts_group_ms null.
      Promise.resolve(this.groupClock.start()).catch(err => this.logger.warn('oyon.group_clock.sync_failed', { message: err?.message || String(err) }));
    }
    this.events.emit('status', { state: 'starting-camera' });
    await this.camera.start();
    // Gate on the SAMPLER, not on heartRateEnabled: respiration shares this
    // sampler and may be the only consumer. Keying the start on heart rate
    // meant a respiration-only session constructed the sampler and never
    // started it, so the estimator was fed nothing and reported "acquiring"
    // forever.
    if (this.heartRateSampler) this.heartRateSampler.start();
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
    if (this.heartRateSampler) this.heartRateSampler.stop();
    this.logger.info('oyon.capture.paused');
    this.events.emit('status', { state: 'paused' });
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    if (this.heartRateSampler) this.heartRateSampler.start();
    this.logger.info('oyon.capture.resumed');
    this.events.emit('status', { state: 'running' });
    this.scheduleNextSample(0);
  }

  async stop() {
    this.running = false;
    this.paused = false;
    if (this.groupClock && typeof this.groupClock.stop === 'function') this.groupClock.stop();
    if (this.heartRateSampler) this.heartRateSampler.stop();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const finalWindow = this.aggregator.flush();
    let finalEngagement = null;
    if (this.eyeEnabled) {
      finalEngagement = this.engagementAggregator.flush();
    }
    let finalFacial = null;
    if (this.facialEnabled) {
      finalFacial = this.facialAggregator.flush();
    }
    let finalPosture = null;
    if (this.postureEnabled) {
      finalPosture = this._stashedPostureWindow || this.postureAggregator.flush();
      this._stashedPostureWindow = null;
    }
    let finalHeartRate = null;
    if (this.heartRateEnabled) {
      finalHeartRate = this._stashedHeartRateWindow || this.heartRateAggregator.flush();
      this._stashedHeartRateWindow = null;
    }
    let finalRespiration = null;
    if (this.respirationEnabled) {
      finalRespiration = this._stashedRespirationWindow || this.respirationAggregator.flush();
      this._stashedRespirationWindow = null;
    }
    let finalIllumination = null;
    if (this.illuminationEnabled) {
      finalIllumination = this._stashedIlluminationWindow || this.illuminationAggregator.flush();
      this._stashedIlluminationWindow = null;
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
      if (this.facialEnabled && this.settings.facial_signals_window_share && finalFacial) {
        finalWindow.facial = finalFacial;
      }
      if (this.postureEnabled && this.settings.posture_window_share && finalPosture) {
        finalWindow.posture = finalPosture;
      }
      if (this.heartRateEnabled && this.settings.heart_rate_window_share && finalHeartRate) {
        finalWindow.heart_rate = finalHeartRate;
      }
      if (this.respirationEnabled && this.settings.respiration_window_share && finalRespiration) {
        finalWindow.respiration = finalRespiration;
      }
      if (this.illuminationEnabled && this.settings.illumination_window_share && finalIllumination) {
        finalWindow.illumination = finalIllumination;
      }
      if (this.gazeEnabled && this.settings.gaze_window_share && finalGaze) {
        finalWindow.gaze = finalGaze;
      }
      this._attachCaptureQualityBlock(finalWindow);
      await this.sendWindows([finalWindow], { drainAll: true });
    } else {
      // No emotion window. Synthesize research-only events for any signal
      // that did flush data of its own.
      const events = [];
      if (this.eyeEnabled && finalEngagement && !this.settings.engagement_window_share) {
        events.push({ engagement_only: true, ...finalEngagement });
      }
      if (this.facialEnabled && finalFacial && !this.settings.facial_signals_window_share) {
        events.push({ facial_only: true, facial: finalFacial, window_start: finalFacial.window_start, window_end: finalFacial.window_end });
      }
      if (this.postureEnabled && finalPosture && !this.settings.posture_window_share) {
        events.push({ posture_only: true, posture: finalPosture, window_start: finalPosture.window_start, window_end: finalPosture.window_end });
      }
      if (this.heartRateEnabled && finalHeartRate && !this.settings.heart_rate_window_share) {
        events.push({ heart_rate_only: true, heart_rate: finalHeartRate, window_start: finalHeartRate.window_start, window_end: finalHeartRate.window_end });
      }
      if (this.gazeEnabled && finalGaze && !this.settings.gaze_window_share) {
        events.push({ gaze_only: true, gaze: finalGaze, window_start: finalGaze.window_start, window_end: finalGaze.window_end });
      }
      if (events.length > 0) await this.sendWindows(events, { drainAll: true });
    }
    // Raw samples nothing above carried (no window closed since they were
    // recorded, or recorded at/after the last window's end) leave now, in a
    // raw-only envelope, so stopping never strands them.
    await this._sendRawOnly(this.rawStreams.drain());

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
    if (this.heartRateSampler) {
      // Head-motion gate: while the head is rotating fast, pause ROI sampling
      // (feed a null face) so motion-corrupted frames never enter the rPPG
      // buffer — motion is the dominant rPPG artifact. Resumes automatically
      // once the head settles.
      const paused = this._hrHeadMotionPaused(face);
      this._hrMotionPaused = paused; // surfaced on heart_rate_status (report only)
      this.heartRateSampler.updateFace(paused ? null : face, now);
    }

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

    // Body-posture pipeline. Independent of face presence — runs its own
    // detectForVideo on the same frame and feeds the posture aggregator. Its
    // auto-flushed window is stashed for attachment at the emotion-window
    // boundary; the per-frame sample (with the derived scalars) rides the
    // `sample` event on both the face-present and no-face paths.
    let postureSample = null;
    if (this.postureEnabled && this.poseTracker) {
      try {
        const pose = await this.poseTracker.analyze(video, now);
        postureSample = this.postureExtractor.extract(pose);
      } catch (err) {
        this.logger.warn('oyon.posture.analyze_failed', { message: err?.message || String(err) });
      }
      if (postureSample) {
        const completed = this.postureAggregator.consumeFrame(postureSample, now);
        if (completed) this._stashedPostureWindow = completed;
      }
      this.rawStreams.record('posture', now, postureRow(postureSample));
      this._lastPostureSample = postureSample;
    }

    if (!face.facePresent) {
      this.addMissingSample(now, face.reason || 'no-face');
      return;
    }

    const prediction = await this.classifier.classify(video, {
      bbox: face.bbox,
      landmarks: face.landmarks,
    });

    this.rawStreams.record('affect', now, affectRow(prediction));
    const headPose = headPoseFromMatrix(face.transformationMatrix);
    if (headPose) this.rawStreams.record('head', now, headRow(headPose));

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
        this.rawStreams.record('eye', now, eyeRow(smoothed));
      }
    }

    // Facial-signals pipeline (head pose + action units). Same shared face
    // result; the full per-frame signal (all blendshapes) rides the local
    // `sample` event, the window carries aggregates.
    let facialWindow = null;
    let facialSample = null;
    if (this.facialEnabled) {
      facialSample = this.facialExtractor.extract(face);
      if (facialSample) {
        facialWindow = this.facialAggregator.consumeFrame(facialSample, now);
        if (facialSample.action_units) this.rawStreams.record('au', now, { ...facialSample.action_units });
        if (facialSample.blendshapes) this.rawStreams.record('blendshapes', now, { ...facialSample.blendshapes });
      }
    }

    // Heart-rate (rPPG) result consumption stays on the slow/window cadence.
    // ROI acquisition is handled independently by HeartRateRoiSampler using
    // the cached bbox updated above.
    let heartRateSample = null;
    let heartRateStatus = null;
    if (this.heartRateEnabled) {
      heartRateSample = this.heartRateEstimator.estimate();
      const status = typeof this.heartRateEstimator.status === 'function'
        ? this.heartRateEstimator.status()
        : null;
      if (status) {
        heartRateStatus = {
          ready: status.ready,
          progress: status.progress,
          buffered_seconds: status.span_seconds,
          sample_rate_hz: status.sample_rate_hz,
          reason: status.ready && !heartRateSample ? 'no_stable_rate' : status.reason,
          // True while the head-motion gate is pausing ROI sampling this tick.
          motion_paused: this._hrMotionPaused === true,
        };
      }
      const completed = this.heartRateAggregator.consumeFrame(heartRateSample, now);
      if (completed) this._stashedHeartRateWindow = completed;
      this.rawStreams.record('heart_rate', now, heartRateRow(heartRateSample));
      this._recordNewBeats();
    }

    // Respiration shares the ROI stream; its own estimator throttles to ~5s
    // because a resting breathing rate cannot move faster than that.
    let respirationSample = null;
    let respirationStatus = null;
    if (this.respirationEnabled) {
      respirationSample = this.respirationEstimator.estimate(now);
      // Status rides alongside the estimate ALWAYS, because a null estimate has
      // two completely different meanings — "the buffer is still filling" and
      // "there is signal but no rate could be confirmed" — and a UI that cannot
      // tell them apart shows "acquiring…" forever once the second one starts
      // happening. Which it does, by design, whenever the subject moves or the
      // light is poor.
      respirationStatus = typeof this.respirationEstimator.status === 'function'
        ? this.respirationEstimator.status(now)
        : null;
      const completed = this.respirationAggregator.consumeFrame(respirationSample, now);
      if (completed) this._stashedRespirationWindow = completed;
      this.rawStreams.record('respiration', now, respirationRow(respirationSample));
    }

    // Illumination reads the raw frame, so it works with or without a face —
    // "too dark to detect a face" is itself the finding.
    let illuminationSample = null;
    if (this.illuminationEnabled) {
      illuminationSample = this.illuminationEstimator.estimate(this.camera.video);
      const completed = this.illuminationAggregator.consumeFrame(illuminationSample, now);
      if (completed) this._stashedIlluminationWindow = completed;
      this.rawStreams.record('illumination', now, illuminationRow(illuminationSample));
    }

    const durationMs = performanceNow() - startedAt;
    this.metrics.record('oyon.sample.duration', durationMs, { unit: 'ms' });
    this.events.emit('sample', { ts_ms: now, ts_group_ms: this._groupTime(now), face, prediction, eye: eyeSample, facial: facialSample, posture: postureSample, heart_rate: heartRateSample, heart_rate_status: heartRateStatus, respiration: respirationSample, respiration_status: respirationStatus, illumination: illuminationSample, durationMs });

    if (windowResult) {
      if (this.eyeEnabled && this.settings.engagement_window_share) {
        // If the engagement aggregator's own consumeFrame already produced a
        // window at this boundary (its buffer is now empty), use that result.
        // Otherwise force-flush to grab whatever buffered scalars remain so
        // the two streams stay aligned.
        const aligned = engagementWindow || this.engagementAggregator.flush(now);
        windowResult.engagement = aligned;
      }
      if (this.facialEnabled && this.settings.facial_signals_window_share) {
        const alignedFacial = facialWindow || this.facialAggregator.flush(now);
        windowResult.facial = alignedFacial;
      }
      this._attachPostureBlock(windowResult, now);
      this._attachHeartRateBlock(windowResult, now);
      this._attachRespirationBlock(windowResult, now);
      this._attachIlluminationBlock(windowResult, now);
      // Mirror the engagement boundary: pick up the most recent gaze
      // window (auto-flushed inside consumeFrame, or force-flushed now)
      // so both blocks describe the same window.
      this._attachGazeBlock(windowResult, now);
      this._attachCaptureQualityBlock(windowResult);
      await this.sendWindows([windowResult]);
    } else if (this.eyeEnabled && engagementWindow && !this.settings.engagement_window_share) {
      // Non-shared mode: research-only batch with engagement-only payload.
      await this.sendWindows([{ engagement_only: true, ...engagementWindow }]);
    } else if (this.facialEnabled && facialWindow && !this.settings.facial_signals_window_share) {
      await this.sendWindows([{ facial_only: true, facial: facialWindow, window_start: facialWindow.window_start, window_end: facialWindow.window_end }]);
    } else if (this.postureEnabled && this._stashedPostureWindow && !this.settings.posture_window_share) {
      const pw = this._stashedPostureWindow;
      this._stashedPostureWindow = null;
      await this.sendWindows([{ posture_only: true, posture: pw, window_start: pw.window_start, window_end: pw.window_end }]);
    } else if (this.heartRateEnabled && this._stashedHeartRateWindow && !this.settings.heart_rate_window_share) {
      const hw = this._stashedHeartRateWindow;
      this._stashedHeartRateWindow = null;
      await this.sendWindows([{ heart_rate_only: true, heart_rate: hw, window_start: hw.window_start, window_end: hw.window_end }]);
    }
  }

  addMissingSample(timestamp, reason) {
    if (this.heartRateSampler) this.heartRateSampler.updateFace(null, timestamp);
    this.rawStreams.record('affect', timestamp, affectRow(null));
    const windowResult = this.aggregator.addSample({
      timestamp,
      facePresent: false,
      quality: { reason },
    });
    // No face ⇒ no ROI to sample, but keep the heart-rate window aligned by
    // consuming an invalid frame (drops valid_frame_ratio honestly).
    if (this.heartRateEnabled) {
      const completed = this.heartRateAggregator.consumeFrame(null, timestamp);
      if (completed) this._stashedHeartRateWindow = completed;
    }
    this.events.emit('sample', { ts_ms: timestamp, ts_group_ms: this._groupTime(timestamp), face: { facePresent: false, reason }, prediction: null, posture: this.postureEnabled ? (this._lastPostureSample ?? null) : undefined });
    if (windowResult) {
      if (this.eyeEnabled && this.settings.engagement_window_share) {
        const aligned = this.engagementAggregator.flush(timestamp);
        windowResult.engagement = aligned;
      }
      if (this.facialEnabled && this.settings.facial_signals_window_share) {
        windowResult.facial = this.facialAggregator.flush(timestamp);
      }
      this._attachPostureBlock(windowResult, timestamp);
      this._attachHeartRateBlock(windowResult, timestamp);
      this._attachRespirationBlock(windowResult, timestamp);
      this._attachIlluminationBlock(windowResult, timestamp);
      this._attachGazeBlock(windowResult, timestamp);
      this._attachCaptureQualityBlock(windowResult);
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
    // Calibration progress goes out on its OWN channel, never on 'status'.
    // 'status' is the capture lifecycle (idle → running → paused → stopped);
    // hosts reduce it into "is the camera on?". Emitting 'gaze:calibrating'
    // there made every status-driven UI (the capture pill, the camera dock)
    // conclude capture had stopped the moment calibration finished, while
    // the camera kept running — and the "restart" they then offered hit the
    // already-running guard and spun forever.
    this.events.emit('gaze-calibration', { state: 'calibrating' });
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
      this.events.emit('gaze-calibration', { state: 'calibrated', confidence });
    } else {
      this.logger.warn('oyon.gaze.calibration_failed', {
        reason: result?.reason || 'unknown',
      });
      this.events.emit('gaze-calibration', { state: 'calibration_failed', reason: result?.reason || 'unknown' });
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
   * @internal Attach the posture block for this window boundary. Uses the
   * window auto-flushed inside consumeFrame (stashed) when present, otherwise
   * force-flushes any buffered frames so the posture window aligns with the
   * emotion window.
   */
  _attachPostureBlock(windowResult, ts) {
    if (!this.postureEnabled || !this.settings.posture_window_share) return;
    let block = this._stashedPostureWindow;
    this._stashedPostureWindow = null;
    if (!block) block = this.postureAggregator.flush(ts);
    if (block) windowResult.posture = block;
  }

  /**
   * @internal Attach the heart-rate block for this window boundary
   * (stash-or-flush), mirroring the posture/gaze pattern.
   */
  _attachHeartRateBlock(windowResult, ts) {
    if (!this.heartRateEnabled || !this.settings.heart_rate_window_share) return;
    let block = this._stashedHeartRateWindow;
    this._stashedHeartRateWindow = null;
    if (!block) block = this.heartRateAggregator.flush(ts);
    if (block) windowResult.heart_rate = block;
  }

  _attachRespirationBlock(windowResult, ts) {
    if (!this.respirationEnabled || !this.settings.respiration_window_share) return;
    let block = this._stashedRespirationWindow;
    this._stashedRespirationWindow = null;
    if (!block) block = this.respirationAggregator.flush(ts);
    if (block) windowResult.respiration = block;
  }

  _attachIlluminationBlock(windowResult, ts) {
    if (!this.illuminationEnabled || !this.settings.illumination_window_share) return;
    let block = this._stashedIlluminationWindow;
    this._stashedIlluminationWindow = null;
    if (!block) block = this.illuminationAggregator.flush(ts);
    if (block) windowResult.illumination = block;
  }

  _attachCaptureQualityBlock(windowResult) {
    if (!this.settings.capture_quality_enabled || !this.settings.capture_quality_window_share) return;
    if (typeof this.camera?.getDiagnostics !== 'function') return;
    const diagnostics = this.camera.getDiagnostics({ resetWindow: true });
    if (diagnostics) windowResult.capture_quality = diagnostics;
  }

  /**
   * @internal True when the head rotated more than
   * settings.heart_rate_max_head_movement_deg since the previous face, so ROI
   * sampling should pause. Head pose comes straight from the face transform
   * (no dependency on the facial-signals pipeline). 0 threshold disables it.
   */
  _hrHeadMotionPaused(face) {
    const threshold = this.settings.heart_rate_max_head_movement_deg;
    if (!(threshold > 0)) return false;
    if (!face || face.facePresent !== true || !face.transformationMatrix) {
      this._hrLastPose = null;
      return false;
    }
    const pose = headPoseFromMatrix(face.transformationMatrix);
    if (!pose) { this._hrLastPose = null; return false; }
    const prev = this._hrLastPose;
    this._hrLastPose = pose;
    if (!prev) return false;
    const dp = pose.pitch_deg - prev.pitch_deg;
    const dy = pose.yaw_deg - prev.yaw_deg;
    const dr = pose.roll_deg - prev.roll_deg;
    return Math.sqrt(dp * dp + dy * dy + dr * dr) > threshold;
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
    this.rawStreams.record('screen_gaze', ts, screenGazeRow(smoothed, this.gazeAggregator.options?.aois));
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

  /**
   * @internal Record beat-to-beat intervals found since the last tick
   * (EXPERIMENTAL ibi stream). Each beat is recorded once, at its own time.
   */
  _recordNewBeats() {
    if (!this.heartRateEstimator || typeof this.heartRateEstimator.interBeatIntervals !== 'function') return;
    if (!this.heartRateEstimator.lastEstimate) return;
    const last = this._lastBeatMs ?? -Infinity;
    for (const beat of this.heartRateEstimator.interBeatIntervals()) {
      if (beat.ts_ms <= last + 1) continue;
      this.rawStreams.record('ibi', Math.round(beat.ts_ms), { ibi_ms: beat.ibi_ms, quality: beat.quality });
      this._lastBeatMs = beat.ts_ms;
    }
  }

  /**
   * Record a host-supplied per-sample value into the raw streams, so it rides
   * on the next window and reaches the group timeline beside Oyon's own
   * signals. For channels Oyon does not sense itself: speaking turns from a
   * VAD, task phases, partner events.
   *
   *   voice = createVoiceTurnController({ onEvent: (e) =>
   *     runtime.recordHostSample('speech', { state: e.state }, e.timestamp_ms) });
   *
   * @param {string} stream  lower_snake_case stream name (e.g. 'speech')
   * @param {object} values  field → number | string | boolean | null
   * @param {number} [tsMs]  local epoch ms (default now)
   * @returns {boolean} false when the arguments are not recordable
   */
  recordHostSample(stream, values, tsMs = Date.now()) {
    if (typeof stream !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(stream)) return false;
    if (!values || typeof values !== 'object' || Array.isArray(values) || !Number.isFinite(tsMs)) return false;
    this.rawStreams.record(stream, tsMs, values);
    return true;
  }

  /** @internal Group time of a local epoch ms (null without a synced clock). */
  _groupTime(localMs) {
    return this.groupClock && typeof this.groupClock.toGroupTime === 'function'
      ? this.groupClock.toGroupTime(localMs)
      : null;
  }

  /**
   * @internal settings.window_anchor_ms (group time) in local time. Before the
   * clock's first sync the anchor is used as-is, i.e. local ≈ group time.
   */
  _windowAnchorLocalMs() {
    const anchor = this.settings.window_anchor_ms;
    if (!Number.isFinite(anchor)) return null;
    const local = this.groupClock && typeof this.groupClock.toLocalTime === 'function'
      ? this.groupClock.toLocalTime(anchor)
      : null;
    return Number.isFinite(local) ? local : anchor;
  }

  /** @internal Alignment fields persisted on every window when group work is configured. */
  _alignmentFields() {
    const anchored = Number.isFinite(this.settings.window_anchor_ms);
    if (!this.groupClock && !anchored) return null;
    const snap = this.groupClock && typeof this.groupClock.snapshot === 'function'
      ? this.groupClock.snapshot()
      : {};
    return {
      clock_offset_ms: Number.isFinite(snap.clock_offset_ms) ? snap.clock_offset_ms : null,
      clock_rtt_ms: Number.isFinite(snap.clock_rtt_ms) ? snap.clock_rtt_ms : null,
      clock_source: typeof snap.clock_source === 'string' ? snap.clock_source : null,
      window_anchor_ms: anchored ? this.settings.window_anchor_ms : null,
    };
  }

  /**
   * Raw rows that belong with these windows: everything before the latest
   * window end (anchored windows are [start, end); a free-running window
   * closes on, and includes, the sample at its end). Rows at or after it wait
   * for the next window. `drainAll` (stop) takes everything.
   * @internal
   */
  _drainRawFor(windows, drainAll = false) {
    if (drainAll) return this.rawStreams.drain();
    const ends = windows.map(w => Date.parse(w?.window_end)).filter(Number.isFinite);
    if (!ends.length) return this.rawStreams.drain();
    return this.rawStreams.drain({ before: Math.max(...ends), inclusive: this._windowAnchorLocalMs() === null });
  }

  /**
   * Send raw rows no window carries, as a raw-only envelope
   * (`modality: 'raw'`; see docs/ROHY_INTEGRATION.md "Raw-only envelopes").
   * Its window_start/window_end span the rows it holds.
   * @internal
   */
  async _sendRawOnly(rawStreams, reason = 'stop') {
    const event = rawOnlyEnvelope(rawStreams, reason);
    if (!event) return;
    const context = this.contextProvider() || {};
    const snapshot = settingsSnapshot(this.settings);
    const alignment = this._alignmentFields();
    const events = [{
      ...context,
      ...event,
      ...(alignment ? withGroupWindowTimes(alignment, event) : {}),
      settings_snapshot: snapshot,
      settings_hash: snapshot.settings_hash,
      capture_mode: this.options.captureMode,
      consent_version: this.options.consentVersion,
    }];
    this.events.emit('window', events);
    this.logger.info('oyon.raw_streams.sent', { reason, streams: Object.keys(rawStreams || {}) });
    await this.transport.send(events, context);
  }

  /**
   * A stream reached the recorder's row bound: send everything recorded up to
   * now as a raw-only envelope. Recording carries on meanwhile; a failed send
   * is reported, never swallowed.
   * @internal
   */
  _spillRawStreams() {
    if (this._spilling) return;
    this._spilling = true;
    Promise.resolve()
      .then(() => this._sendRawOnly(this.rawStreams.drain(), 'row_bound'))
      .catch((err) => {
        this.logger.error('oyon.raw_streams.spill_failed', err);
        this.events.emit('error', err);
      })
      .finally(() => { this._spilling = false; });
  }

  async sendWindows(windows, options = {}) {
    if (!windows.length) return;
    const context = this.contextProvider() || {};
    const snapshot = settingsSnapshot(this.settings);
    const rawStreams = this._drainRawFor(windows, options.drainAll === true);
    const alignment = this._alignmentFields();
    const events = windows.map((window, index) => ({
      ...context,
      ...window,
      ...(alignment ? withGroupWindowTimes(alignment, window) : {}),
      ...(index === 0 && rawStreams ? { raw_streams: rawStreams } : {}),
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

/** Window start/end in group time, beside the local ISO stamps (never replacing them). */
function withGroupWindowTimes(alignment, window) {
  const offset = alignment.clock_offset_ms;
  const start = Date.parse(window?.window_start);
  const end = Date.parse(window?.window_end);
  return {
    ...alignment,
    window_start_group_ms: Number.isFinite(offset) && Number.isFinite(start) ? start + offset : null,
    window_end_group_ms: Number.isFinite(offset) && Number.isFinite(end) ? end + offset : null,
  };
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
