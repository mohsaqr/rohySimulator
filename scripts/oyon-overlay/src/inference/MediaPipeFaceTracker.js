export class MediaPipeFaceTracker {
  constructor(options = {}) {
    this.options = {
      wasmBaseUrl: '/models/mediapipe/wasm',
      modelAssetPath: '/models/mediapipe/face_landmarker.task',
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      // 'CPU' (default in mediapipe) keeps inference on the main thread.
      // 'GPU' offloads the face graph to WebGL/WebGPU so the host UI keeps rendering.
      delegate: undefined,
      ...options,
    };
    this.faceLandmarker = null;
    this.lastVideoTime = -1;
  }

  async init() {
    const mod = await import('@mediapipe/tasks-vision');
    const vision = await mod.FilesetResolver.forVisionTasks(this.options.wasmBaseUrl);
    const baseOptions = { modelAssetPath: this.options.modelAssetPath };
    if (this.options.delegate) baseOptions.delegate = this.options.delegate;
    this.faceLandmarker = await mod.FaceLandmarker.createFromOptions(vision, {
      baseOptions,
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: this.options.minFaceDetectionConfidence,
      minFacePresenceConfidence: this.options.minFacePresenceConfidence,
      minTrackingConfidence: this.options.minTrackingConfidence,
    });
  }

  async analyze(video, timestampMs) {
    if (!this.faceLandmarker) throw new Error('MediaPipeFaceTracker.init() must run first.');
    if (video.currentTime === this.lastVideoTime) {
      return { facePresent: false, reason: 'duplicate-frame' };
    }
    this.lastVideoTime = video.currentTime;

    const result = this.faceLandmarker.detectForVideo(video, timestampMs);
    const landmarks = result.faceLandmarks?.[0] || null;
    if (!landmarks) return { facePresent: false, reason: 'no-face' };

    const bbox = bboxFromLandmarks(landmarks);
    const quality = {
      bbox,
      faceAreaRatio: bbox.width * bbox.height,
      blendshapeCount: result.faceBlendshapes?.[0]?.categories?.length || 0,
    };

    return {
      facePresent: true,
      landmarks,
      bbox,
      blendshapes: categoriesToObject(result.faceBlendshapes?.[0]?.categories || []),
      matrix: result.facialTransformationMatrixes?.[0] || null,
      quality,
    };
  }
}

function categoriesToObject(categories) {
  const out = {};
  for (const item of categories) {
    out[item.categoryName] = item.score;
  }
  return out;
}

function bboxFromLandmarks(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: clamp(minX, 0, 1),
    y: clamp(minY, 0, 1),
    width: clamp(maxX - minX, 0, 1),
    height: clamp(maxY - minY, 0, 1),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

