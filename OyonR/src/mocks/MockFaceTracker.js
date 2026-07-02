const DEFAULT_BLENDSHAPE_COUNT = 52;

// MediaPipe refined-iris landmark layout (matches EyeFeatureExtractor).
const REFINED_LANDMARK_COUNT = 478;
const IRIS_LEFT_CENTER = 468;
const IRIS_RIGHT_CENTER = 473;
const EYE_LEFT_OUTER = 33;
const EYE_LEFT_INNER = 133;
const EYE_RIGHT_OUTER = 263;
const EYE_RIGHT_INNER = 362;

// Synthetic eye geometry: corners 0.1 apart in image space, so an iris
// placed at `mid + offset * 0.1` makes EyeFeatureExtractor recover exactly
// `offset` (span normalizer = 0.1, identity head pose).
const LEFT_EYE = { outer: { x: 0.35, y: 0.45 }, inner: { x: 0.45, y: 0.45 } };
const RIGHT_EYE = { outer: { x: 0.65, y: 0.45 }, inner: { x: 0.55, y: 0.45 } };
const EYE_SPAN = 0.1;

function defaultBlendshapes() {
  const out = new Array(DEFAULT_BLENDSHAPE_COUNT);
  for (let i = 0; i < DEFAULT_BLENDSHAPE_COUNT; i++) {
    out[i] = { categoryName: `name_${i}`, score: 0 };
  }
  return out;
}

function defaultTransformationMatrix() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function point(x, y) {
  return { x, y, z: 0 };
}

function buildIrisLandmarks(irisOffsets) {
  const landmarks = new Array(REFINED_LANDMARK_COUNT).fill(null)
    .map(() => point(0.5, 0.5));

  landmarks[EYE_LEFT_OUTER] = point(LEFT_EYE.outer.x, LEFT_EYE.outer.y);
  landmarks[EYE_LEFT_INNER] = point(LEFT_EYE.inner.x, LEFT_EYE.inner.y);
  landmarks[EYE_RIGHT_OUTER] = point(RIGHT_EYE.outer.x, RIGHT_EYE.outer.y);
  landmarks[EYE_RIGHT_INNER] = point(RIGHT_EYE.inner.x, RIGHT_EYE.inner.y);

  const leftMid = {
    x: (LEFT_EYE.outer.x + LEFT_EYE.inner.x) / 2,
    y: (LEFT_EYE.outer.y + LEFT_EYE.inner.y) / 2,
  };
  const rightMid = {
    x: (RIGHT_EYE.outer.x + RIGHT_EYE.inner.x) / 2,
    y: (RIGHT_EYE.outer.y + RIGHT_EYE.inner.y) / 2,
  };

  const l = irisOffsets?.l ?? null;
  const r = irisOffsets?.r ?? null;
  // A null per-eye offset yields a null landmark so EyeFeatureExtractor
  // returns a null normalized offset for that eye.
  landmarks[IRIS_LEFT_CENTER] = l
    ? point(leftMid.x + l.x * EYE_SPAN, leftMid.y + l.y * EYE_SPAN)
    : null;
  landmarks[IRIS_RIGHT_CENTER] = r
    ? point(rightMid.x + r.x * EYE_SPAN, rightMid.y + r.y * EYE_SPAN)
    : null;

  return landmarks;
}

export class MockFaceTracker {
  /**
   * @param {object} [options]
   * @param {Array}  [options.mockBlendshapes]
   * @param {Float32Array} [options.mockTransformationMatrix]
   * @param {{l:{x:number,y:number}|null, r:{x:number,y:number}|null}} [options.irisOffsets]
   *        When set, analyze() returns a full 478-point landmark array whose
   *        iris/corner geometry makes extractEyeFeatures() recover exactly
   *        these normalized offsets (identity head pose). When omitted,
   *        landmarks stay [] (legacy behavior — no refined irises).
   */
  constructor(options = {}) {
    this.mockBlendshapes = options.mockBlendshapes || null;
    this.mockTransformationMatrix = options.mockTransformationMatrix || null;
    this.irisOffsets = options.irisOffsets || null;
  }

  setIrisOffsets(irisOffsets) {
    this.irisOffsets = irisOffsets || null;
  }

  async init() {}

  async analyze() {
    const blendshapes = this.mockBlendshapes != null
      ? this.mockBlendshapes
      : defaultBlendshapes();
    const transformationMatrix = this.mockTransformationMatrix != null
      ? this.mockTransformationMatrix
      : defaultTransformationMatrix();
    return {
      facePresent: true,
      bbox: { x: 0.25, y: 0.15, width: 0.5, height: 0.65 },
      landmarks: this.irisOffsets ? buildIrisLandmarks(this.irisOffsets) : [],
      blendshapes,
      transformationMatrix,
      quality: {
        faceAreaRatio: 0.32,
        mock: true,
      },
    };
  }
}
