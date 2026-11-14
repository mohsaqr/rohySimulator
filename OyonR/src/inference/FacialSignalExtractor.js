/**
 * FacialSignalExtractor — "Tier 0" per-frame signals derived from data the
 * face tracker ALREADY produces every frame, at zero extra model/inference
 * cost:
 *
 *   1. Head pose (pitch / yaw / roll, degrees) from the facial transformation
 *      matrix — the same Float32Array(16) `EyeFeatureExtractor` uses for iris
 *      compensation. Gives head orientation, nodding, head-shake, and a
 *      "facing the screen" attention proxy.
 *   2. Facial action units from the 52 MediaPipe/ARKit blendshapes. Oyon's
 *      face tracker requests `outputFaceBlendshapes: true` and today uses only
 *      `eyeBlinkLeft/Right`; the other ~50 (smile, brow-down, jaw-open, …) are
 *      discarded. This extractor surfaces ALL of them plus named affect
 *      proxies (smile, frown, brow-furrow, …).
 *
 * Pure, stateless per-frame math. Consumes a MediaPipe FaceLandmarker result
 * (as produced by `MediaPipeFaceTracker.analyze()` / `MockFaceTracker`) and
 * emits a small structured object. No I/O, no MediaPipe coupling beyond the
 * result shape.
 *
 * Matrix convention: `transformationMatrix` is COLUMN-MAJOR (graphics /
 * MediaPipe `facialTransformationMatrixes` convention). Element R[row][col]
 * lives at index `col*4 + row`; the 3×3 rotation is indices 0,1,2 / 4,5,6 /
 * 8,9,10; translation is 12,13,14 (unused here).
 *
 * Angle convention (MediaPipe canonical metric frame): +x right, +y up,
 * +z toward the camera. pitch = nod (look up/down), yaw = turn (look
 * left/right), roll = tilt head toward a shoulder. Signs follow that frame;
 * because downstream conventions vary, the raw 3×3 rotation is exposed too so
 * researchers can recompute angles their own way (data policy: expose
 * everything, coarsen nothing).
 */

// Default "facing the screen" half-angle: within ±this many degrees of yaw AND
// pitch counts as attentive/frontal. Coarse; tunable via settings.
const DEFAULT_FRONTAL_HALF_ANGLE_DEG = 20;

const RAD_TO_DEG = 180 / Math.PI;

// Named affect proxies built from ARKit blendshape categories. Each entry is
// the list of blendshape names to average (missing names contribute 0). These
// are AU-adjacent convenience aggregates; the full 52 are exposed alongside.
const ACTION_UNIT_MAP = Object.freeze({
  smile: ['mouthSmileLeft', 'mouthSmileRight'],
  frown: ['mouthFrownLeft', 'mouthFrownRight'],
  brow_furrow: ['browDownLeft', 'browDownRight'],
  brow_raise_inner: ['browInnerUp'],
  brow_raise_outer: ['browOuterUpLeft', 'browOuterUpRight'],
  jaw_open: ['jawOpen'],
  // MediaPipe/ARKit has no `mouthOpen`; listing it halved this value (< v3.5.4).
  mouth_open: ['jawOpen'],
  mouth_pucker: ['mouthPucker'],
  mouth_press: ['mouthPressLeft', 'mouthPressRight'],
  eye_wide: ['eyeWideLeft', 'eyeWideRight'],
  eye_squint: ['eyeSquintLeft', 'eyeSquintRight'],
  cheek_raise: ['cheekSquintLeft', 'cheekSquintRight'],
  cheek_puff: ['cheekPuff'],
  nose_sneer: ['noseSneerLeft', 'noseSneerRight'],
});

/**
 * Extract pitch/yaw/roll (degrees) from a column-major 4×4 transform.
 * Uses the standard XYZ (pitch-yaw-roll) decomposition with a gimbal-safe
 * yaw term. Returns null when the matrix is absent/degenerate.
 *
 * @param {Float32Array|number[]} m column-major 4×4
 * @returns {{pitch_deg:number,yaw_deg:number,roll_deg:number,rotation:number[]}|null}
 */
export function headPoseFromMatrix(m) {
  if (!m || m.length < 11) return null;
  // R[row][col] = m[col*4 + row].
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];
  // Degenerate (identity fallback or zeroed) matrices carry no pose signal.
  const rotation = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const finite = rotation.every(Number.isFinite);
  if (!finite) return null;

  const pitch = Math.atan2(r21, r22);
  const yaw = Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22));
  const roll = Math.atan2(r10, r00);

  return {
    pitch_deg: pitch * RAD_TO_DEG,
    yaw_deg: yaw * RAD_TO_DEG,
    roll_deg: roll * RAD_TO_DEG,
    rotation, // row-major 3×3, [r00,r01,r02, r10,r11,r12, r20,r21,r22]
  };
}

/**
 * Build a full {name: score} map of every blendshape plus the named
 * action-unit proxies from ACTION_UNIT_MAP.
 *
 * @param {Array<{categoryName?:string,score?:number}>} blendshapes
 * @returns {{blendshapes:Record<string,number>, action_units:Record<string,number>}}
 */
export function actionUnitsFromBlendshapes(blendshapes) {
  const map = Object.create(null);
  if (Array.isArray(blendshapes)) {
    for (let i = 0; i < blendshapes.length; i += 1) {
      const entry = blendshapes[i];
      if (!entry || typeof entry.categoryName !== 'string') continue;
      const score = Number(entry.score);
      map[entry.categoryName] = Number.isFinite(score) ? score : 0;
    }
  }
  const action_units = Object.create(null);
  for (const key of Object.keys(ACTION_UNIT_MAP)) {
    const names = ACTION_UNIT_MAP[key];
    let sum = 0;
    for (let i = 0; i < names.length; i += 1) {
      const v = map[names[i]];
      sum += Number.isFinite(v) ? v : 0;
    }
    action_units[key] = names.length > 0 ? sum / names.length : 0;
  }
  return { blendshapes: map, action_units };
}

/**
 * Extract per-frame facial signals from a MediaPipe FaceLandmarker result.
 *
 * @param {object} faceResult   result from MediaPipeFaceTracker.analyze()
 * @param {object} [settings]   partial OyonSettings; reads frontal_half_angle_deg
 * @returns {object|null}       null when no face is present
 */
export function extractFacialSignals(faceResult, settings) {
  if (!faceResult || faceResult.facePresent !== true) return null;

  const frontalHalfAngleDeg = clampAngle(
    settings?.facial_frontal_half_angle_deg,
    DEFAULT_FRONTAL_HALF_ANGLE_DEG,
  );

  const head_pose = headPoseFromMatrix(faceResult.transformationMatrix);
  const { blendshapes, action_units } = actionUnitsFromBlendshapes(faceResult.blendshapes);

  const frontal = head_pose
    ? Math.abs(head_pose.yaw_deg) <= frontalHalfAngleDeg &&
      Math.abs(head_pose.pitch_deg) <= frontalHalfAngleDeg
    : null;

  // Valid = we recovered a usable head pose. Blendshapes alone (no matrix)
  // still emit, but the frame doesn't count toward pose-based aggregates.
  const valid = head_pose != null;

  return {
    head_pose,       // {pitch_deg, yaw_deg, roll_deg, rotation} | null
    facing_screen: frontal, // boolean | null
    action_units,    // named proxies
    blendshapes,     // ALL 52 (or however many) raw scores
    valid,
    ts_ms: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

function clampAngle(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 1) return 1;
  if (n > 89) return 89;
  return n;
}

export { ACTION_UNIT_MAP, DEFAULT_FRONTAL_HALF_ANGLE_DEG };
