/**
 * EyeFeatureExtractor — Stage 2 of the eye-tracking pipeline.
 *
 * Pure, stateless per-frame feature math. Consumes a MediaPipe FaceLandmarker
 * result (as produced by `src/inference/MediaPipeFaceTracker.js` and
 * `src/mocks/MockFaceTracker.js`) and emits a small scalar feature object that
 * downstream smoothing/aggregation stages will consume.
 *
 * Matrix convention: `transformationMatrix` is a Float32Array(16) stored in
 * COLUMN-MAJOR order (standard graphics / MediaPipe
 * `facialTransformationMatrixes` convention). That is, the first four entries
 * are the matrix's first column (the rotated x-axis basis vector + 0). The
 * translation lives in indices 12..14 and is ignored here — only the 3x3
 * rotation portion is used.
 *
 * No external imports, no I/O, no MediaPipe coupling beyond the result shape.
 */

// MediaPipe FaceMesh canonical landmark indices (refined-iris output, 478 points).
const IRIS_LEFT_CENTER = 468;
const IRIS_RIGHT_CENTER = 473;
const EYE_LEFT_OUTER = 33;
const EYE_LEFT_INNER = 133;
const EYE_RIGHT_OUTER = 263;
const EYE_RIGHT_INNER = 362;

const REFINED_LANDMARK_COUNT = 478;
const DEFAULT_BLINK_MASK_THRESHOLD = 0.2;
const DEFAULT_GAZE_ZONE_NEUTRAL_DEG = 8;

/**
 * Multiply the inverse rotation of a column-major 4x4 matrix against a 3D point.
 * For a pure rotation R, the inverse is R^T, which means each output component
 * is the dot product of the input vector against one column of R.
 *
 * @param {{x:number,y:number,z:number}} irisPoint3d
 * @param {Float32Array} transformationMatrix  column-major 4x4
 * @returns {{x:number,y:number,z:number}}
 */
export function normalizeIrisByHeadPose(irisPoint3d, transformationMatrix) {
  const { x, y, z } = irisPoint3d;
  const m = transformationMatrix;
  if (!m || m.length < 12) {
    return { x, y, z };
  }
  // Dot product against each of the three rotation columns (R-transpose × v).
  return {
    x: m[0] * x + m[1] * y + m[2] * z,
    y: m[4] * x + m[5] * y + m[6] * z,
    z: m[8] * x + m[9] * y + m[10] * z,
  };
}

/**
 * Classify a normalized iris offset into one of five coarse zones.
 *
 * Uses a small-angle approximation to convert the configured neutral half-width
 * (in degrees) into a normalized-offset threshold: `tan(neutralDeg)`. At the
 * default 8°, threshold ≈ 0.1405.
 *
 * Image-coordinate convention: +y is down (MediaPipe / canvas), so positive y
 * maps to 'down' and negative y maps to 'up'.
 *
 * @param {{x:number,y:number}} normalizedOffsetXY
 * @param {number} neutralDeg  neutral-zone half-width in degrees
 * @returns {'center'|'left'|'right'|'up'|'down'}
 */
export function classifyGazeZone(normalizedOffsetXY, neutralDeg) {
  const { x, y } = normalizedOffsetXY;
  const threshold = Math.tan((neutralDeg * Math.PI) / 180);
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax <= threshold && ay <= threshold) return 'center';
  if (ax >= ay) {
    return x > 0 ? 'right' : 'left';
  }
  return y > 0 ? 'down' : 'up';
}

/**
 * Extract per-frame eye features from a MediaPipe FaceLandmarker result.
 *
 * @param {object} mediaPipeResult  result from MediaPipeFaceTracker.analyze()
 * @param {object} [settings]       partial OyonSettings; reads two keys only
 * @returns {object|null}
 */
export function extractEyeFeatures(mediaPipeResult, settings) {
  if (!mediaPipeResult || !mediaPipeResult.facePresent || !mediaPipeResult.landmarks) {
    return null;
  }

  const blinkMaskThreshold = settings?.blink_mask_threshold ?? DEFAULT_BLINK_MASK_THRESHOLD;
  const gazeZoneNeutralDeg = settings?.gaze_zone_neutral_deg ?? DEFAULT_GAZE_ZONE_NEUTRAL_DEG;

  const blendshapes = Array.isArray(mediaPipeResult.blendshapes) ? mediaPipeResult.blendshapes : [];
  const blinkLeftScore = lookupBlendshape(blendshapes, 'eyeBlinkLeft');
  const blinkRightScore = lookupBlendshape(blendshapes, 'eyeBlinkRight');

  const eye_openness_l = clamp01(1 - blinkLeftScore);
  const eye_openness_r = clamp01(1 - blinkRightScore);

  const landmarks = mediaPipeResult.landmarks;
  const hasRefinedIrises = Array.isArray(landmarks) && landmarks.length >= REFINED_LANDMARK_COUNT;

  let blink_l = eye_openness_l < blinkMaskThreshold;
  let blink_r = eye_openness_r < blinkMaskThreshold;
  let leftNormalized = null;
  let rightNormalized = null;

  if (hasRefinedIrises) {
    const matrix = mediaPipeResult.transformationMatrix;
    leftNormalized = computeNormalizedIrisOffset(
      landmarks[IRIS_LEFT_CENTER],
      landmarks[EYE_LEFT_OUTER],
      landmarks[EYE_LEFT_INNER],
      matrix,
    );
    rightNormalized = computeNormalizedIrisOffset(
      landmarks[IRIS_RIGHT_CENTER],
      landmarks[EYE_RIGHT_OUTER],
      landmarks[EYE_RIGHT_INNER],
      matrix,
    );
  }

  // Blink mask: drop the offset for any eye whose openness is below threshold.
  if (blink_l) leftNormalized = null;
  if (blink_r) rightNormalized = null;

  // If we never had refined irises, both offsets are null regardless of blink state.
  const irisAvailable = hasRefinedIrises;

  let gaze_zone = null;
  if (leftNormalized || rightNormalized) {
    const xs = [];
    const ys = [];
    if (leftNormalized) { xs.push(leftNormalized.x); ys.push(leftNormalized.y); }
    if (rightNormalized) { xs.push(rightNormalized.x); ys.push(rightNormalized.y); }
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    gaze_zone = classifyGazeZone({ x: meanX, y: meanY }, gazeZoneNeutralDeg);
  }

  const bothBlinked = blink_l && blink_r;
  const valid = irisAvailable && !bothBlinked;

  return {
    eye_openness_l,
    eye_openness_r,
    blink_l,
    blink_r,
    iris_offset_normalized: {
      l: leftNormalized,
      r: rightNormalized,
    },
    gaze_zone,
    valid,
    ts_ms: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

function computeNormalizedIrisOffset(irisPoint, outerCorner, innerCorner, matrix) {
  if (!irisPoint || !outerCorner || !innerCorner) return null;
  // Eye-corner midpoint in image coords.
  const midX = (outerCorner.x + innerCorner.x) / 2;
  const midY = (outerCorner.y + innerCorner.y) / 2;
  const midZ = ((outerCorner.z ?? 0) + (innerCorner.z ?? 0)) / 2;
  // Eye-corner span (Euclidean distance in 2D; used as the normalizer).
  const dx = outerCorner.x - innerCorner.x;
  const dy = outerCorner.y - innerCorner.y;
  const span = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(span) || span <= 0) return null;
  const offset = {
    x: (irisPoint.x - midX) / span,
    y: (irisPoint.y - midY) / span,
    z: ((irisPoint.z ?? 0) - midZ) / span,
  };
  // Compensate for head pose so a head-rotated eye doesn't read as gaze.
  const headLocal = matrix ? normalizeIrisByHeadPose(offset, matrix) : offset;
  return { x: headLocal.x, y: headLocal.y };
}

function lookupBlendshape(blendshapes, name) {
  for (let i = 0; i < blendshapes.length; i += 1) {
    const entry = blendshapes[i];
    if (entry && entry.categoryName === name) {
      const score = Number(entry.score);
      return Number.isFinite(score) ? score : 0;
    }
  }
  return 0;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
