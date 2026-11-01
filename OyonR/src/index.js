export { EmotionRuntime } from './core/EmotionRuntime.js';
export { createSignalCapture } from './core/SignalCapture.js';
export { CameraController } from './capture/CameraController.js';
export { MediaPipeFaceTracker } from './inference/MediaPipeFaceTracker.js';
export { OnnxEmotionClassifier } from './inference/OnnxEmotionClassifier.js';
export { EmotionAggregator } from './aggregation/EmotionAggregator.js';
export { EngagementAggregator } from './aggregation/EngagementAggregator.js';
export { FacialSignalAggregator } from './aggregation/FacialSignalAggregator.js';
export { GazeAggregator } from './aggregation/GazeAggregator.js';
export { TypingAggregator } from './aggregation/TypingAggregator.js';
export { createTypingComposerAdapter } from './capture/TypingComposerAdapter.js';
export { AiAssistAggregator } from './aggregation/AiAssistAggregator.js';
export { createAiAssistTracker } from './capture/AiAssistTracker.js';
export { InteractionAggregator } from './aggregation/InteractionAggregator.js';
export { createInteractionTracker, createElementAoiResolver } from './capture/InteractionTracker.js';
export { DiscourseAggregator } from './aggregation/DiscourseAggregator.js';
export {
  analyzeText,
  classifySentence,
  splitSentences,
  extractWords,
  countWords,
  countParagraphs,
  computeTextMetrics,
  DEFAULT_HEDGES,
  DEFAULT_REQUEST_MARKERS,
  DEFAULT_WH_WORDS,
  DEFAULT_POLAR_AUX_WORDS,
  DEFAULT_DIRECTIVES,
} from './analytics/TextAnalyzer.js';
export { PredictionSmoother } from './smoothing/PredictionSmoother.js';
export { EyeSmoother } from './smoothing/EyeSmoother.js';
export { GazeSmoother } from './smoothing/GazeSmoother.js';
export {
  extractEyeFeatures,
  normalizeIrisByHeadPose,
  classifyGazeZone,
} from './inference/EyeFeatureExtractor.js';
export {
  extractFacialSignals,
  headPoseFromMatrix,
  actionUnitsFromBlendshapes,
  ACTION_UNIT_MAP,
} from './inference/FacialSignalExtractor.js';
export { MediaPipePoseTracker } from './inference/MediaPipePoseTracker.js';
export { extractPostureFeatures } from './inference/PostureFeatureExtractor.js';
export { PostureAggregator } from './aggregation/PostureAggregator.js';
export {
  HeartRateEstimator,
  sampleFaceRoiRgb,
  faceRoiRect,
  posSignal,
  posSignalWindowed,
  posWindowLength,
  detrend,
  movingAverageHighPass,
  resampleUniform,
} from './analytics/HeartRateEstimator.js';
export { HeartRateAggregator } from './aggregation/HeartRateAggregator.js';
export { robustBpm } from './aggregation/heartRateRobust.js';
export { HeartRateRoiSampler } from './analytics/HeartRateRoiSampler.js';
export {
  RespirationEstimator,
  meanDecimate,
  MIN_BRPM,
  MAX_BRPM,
} from './analytics/RespirationEstimator.js';
export { RespirationAggregator } from './aggregation/RespirationAggregator.js';
export {
  IlluminationEstimator,
  lumaStats,
  illuminationQuality,
  illuminationAssessment,
  sampleFrameLuma,
} from './analytics/IlluminationEstimator.js';
export { IlluminationAggregator } from './aggregation/IlluminationAggregator.js';
export { fftRadix2, powerSpectrum, nextPow2 } from './analytics/fft.js';
export {
  hannWindow,
  applyWindow,
  frameEnergy,
  spectralFeatures,
  analyzeFrame,
  CLIP_THRESHOLD,
} from './analytics/voiceFeatures.js';
export { estimateF0, computeNsdf } from './analytics/pitch.js';
export { WebEyeTrackAdapter, normalizeGazeResult } from './inference/WebEyeTrackAdapter.js';
export { WebGazerAdapter, normalizeWebGazerPrediction } from './inference/WebGazerAdapter.js';
export {
  MediaPipeLandmarkGazeAdapter,
  featuresToGazeSample,
  MEDIAPIPE_GAZE_MODEL,
} from './inference/MediaPipeLandmarkGazeAdapter.js';
export {
  createGazeAdapter,
  normalizeGazeEngine,
  SUPPORTED_GAZE_ENGINES,
  GAZE_ENGINE_MODEL_VERSIONS,
} from './inference/GazeAdapterFactory.js';
export { HttpEmotionTransport } from './transport/HttpEmotionTransport.js';
export { FallbackEmotionTransport } from './transport/FallbackEmotionTransport.js';
export { LocalEmotionTransport } from './transport/LocalEmotionTransport.js';
export { OyonLogger, LocalLogTransport, HttpLogTransport, createLogEvent } from './logging/OyonLogger.js';
export { SignalEventLog } from './logging/SignalEventLog.js';
export { OyonMetricRecorder, LocalMetricTransport, HttpMetricTransport } from './logging/OyonMetrics.js';
export { IndexedDbOyonStore, oyonRecordId } from './storage/IndexedDbOyonStore.js';
export { createOyonSettings, normalizeOyonSettings, settingsSnapshot, OYON_DEFAULT_SETTINGS, OYON_SETTINGS_PROFILES } from './settings/OyonSettings.js';
export { DynamicalFeatureTracker, computeDynamicalFeatures, enrichWindowsWithDynamics } from './analytics/DynamicalFeatures.js';
export { defineEmotionCaptureElement } from './ui/EmotionCaptureElement.js';
export { defineGazeCalibrationOverlay } from './ui/GazeCalibrationOverlay.js';
export { GazeCalibrationDriver, DEFAULT_CALIBRATION_POINTS } from './ui/GazeCalibrationDriver.js';
export { createOyonAttachment, normalizeContext } from './adapters/oyonAttach.js';
export { createRohyFerAttachment } from './adapters/rohyAttach.js';
export { createOyonAddon } from './addon/OyonAddon.js';
export { createRohyOyonAddon, createNoopOyonAddon } from './addon/RohyOyonAddon.js';
export { createStandaloneFerAttachment } from './adapters/standaloneAttach.js';
export { validateEmotionBatch, ALLOWED_EMOTIONS } from './validation/validateEmotionPayload.js';
export {
  OYON_VERSION,
  OYON_HOST_CONTRACT_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
  OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS,
} from './version.js';
export { domRectToGazeAoi, elementToGazeAoi } from './gaze/domAoi.js';
export {
  ONNX_RUNTIME_WASM_CDN,
  MEDIAPIPE_TASKS_WASM_CDN,
  MEDIAPIPE_FACE_LANDMARKER_URL,
  MEDIAPIPE_POSE_LANDMARKER_LITE_URL,
  MEDIAPIPE_POSE_LANDMARKER_FULL_URL,
  MEDIAPIPE_POSE_LANDMARKER_HEAVY_URL,
  poseLandmarkerUrlForModel,
  EMOTION_MODEL_HSE_B0_URL,
  EMOTION_MODEL_MOBILEVIT_MTL_URL,
  EMOTION_MODEL_MOBILEFACENET_MTL_URL,
  DEFAULT_EMOTION_MODEL_URL,
  SELF_HOSTED_ONNX_RUNTIME_WASM,
  SELF_HOSTED_MEDIAPIPE_TASKS_WASM,
  SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL,
  SELF_HOSTED_EMOTION_MODEL_HSE_B0_URL,
  SELF_HOSTED_EMOTION_MODEL_MOBILEVIT_MTL_URL,
  SELF_HOSTED_EMOTION_MODEL_MOBILEFACENET_MTL_URL,
  SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL,
  SILERO_VAD_MODEL_URL,
  SILERO_VAD_MODEL_VERSION,
  SILERO_VAD_MODEL_SHA256,
  SELF_HOSTED_SILERO_VAD_MODEL_URL,
  SELF_HOSTED_DEFAULTS,
} from './config/cdnDefaults.js';
export { OPENVINO_RETAIL_0003_CONFIG } from './config/openvinoRetail0003.js';
export { EMOTIEFF_MOBILEVIT_MTL_CONFIG } from './config/emotiEffMobileVitMtl.js';
export { EMOTIEFF_MBF_MTL_CONFIG } from './config/emotiEffMbfMtl.js';
export { HSE_EMOTION_MTL_CONFIG } from './config/hseEmotionMtl.js';
export { MockFaceTracker } from './mocks/MockFaceTracker.js';
export { MockEmotionClassifier } from './mocks/MockEmotionClassifier.js';
export { MockPoseTracker, buildPoseLandmarks } from './mocks/MockPoseTracker.js';
// Voice capture layer (audio_text.md §5): turn lifecycle + activation gate,
// worklet framing contract, pluggable VAD (adapter + mock + factory).
// The worklet module itself (voiceFrameWorklet.js) is deliberately NOT
// re-exported here: it is loaded by URL via audioWorklet.addModule(), and
// its framing/feature engine is importable directly from
// 'oyon' internals for tests via src/capture/voiceFrameWorklet.js.
export { createVoiceTurnController, linearResample } from './capture/VoiceTurnController.js';
export { VoiceTurnAggregator } from './aggregation/VoiceTurnAggregator.js';
export {
  SileroVadAdapter,
  createVadAdapter,
  normalizeVoiceEngine,
  SUPPORTED_VOICE_ENGINES,
  SILERO_SAMPLE_RATE,
  SILERO_FRAME_SAMPLES,
  SILERO_CONTEXT_SAMPLES,
} from './inference/SileroVadAdapter.js';
export { MockVadAdapter } from './mocks/MockVadAdapter.js';
// Worker analysis path (§5.2 thread split): the main-thread proxy, plus
// the worker's pure message core and its in-process (same-thread) wrapper
// so hosts and tests can drive the identical analysis code directly.
export { createWorkerVoiceAnalyzer } from './inference/WorkerVoiceAnalyzer.js';
export {
  createVoiceAnalysisWorkerCore,
  createInProcessVoiceAnalysisWorker,
  VOICE_WORKER_PROTOCOL_VERSION,
} from './workers/voiceAnalysisWorker.js';
