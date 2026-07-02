import assert from 'node:assert/strict';
import {
  normalizeIrisByHeadPose,
  classifyGazeZone,
  extractEyeFeatures,
} from '../src/inference/EyeFeatureExtractor.js';

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

// Build a column-major yaw-rotation matrix (rotation about world Y axis).
function yawMatrixColumnMajor(degrees) {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Column-major: indices 0..3 are column 0, 4..7 column 1, 8..11 column 2, 12..15 column 3.
  // Mathematical matrix (row-major in math notation):
  //   [  c   0   s   0 ]
  //   [  0   1   0   0 ]
  //   [ -s   0   c   0 ]
  //   [  0   0   0   1 ]
  return new Float32Array([
    c, 0, -s, 0,   // column 0
    0, 1, 0, 0,    // column 1
    s, 0, c, 0,    // column 2
    0, 0, 0, 1,    // column 3 (translation, ignored)
  ]);
}

// Build a 478-landmark array, all at (0.5, 0.5, 0). Caller overrides specific indices.
function buildLandmarks(overrides = {}, length = 478) {
  const out = new Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = { x: 0.5, y: 0.5, z: 0 };
  }
  for (const key of Object.keys(overrides)) {
    out[Number(key)] = overrides[key];
  }
  return out;
}

// Build a 52-entry blendshape array; named entries inserted at fixed positions.
// Order should not matter to the extractor (it looks up by name).
function buildBlendshapes(named = {}) {
  const out = new Array(52);
  for (let i = 0; i < 52; i += 1) {
    out[i] = { categoryName: `name_${i}`, score: 0 };
  }
  let cursor = 0;
  for (const [name, score] of Object.entries(named)) {
    out[cursor] = { categoryName: name, score };
    cursor += 1;
  }
  return out;
}

// Build a synthetic MediaPipe-style result with sensible defaults.
function buildResult({ landmarks, blendshapes, transformationMatrix, facePresent = true } = {}) {
  return {
    facePresent,
    landmarks: landmarks === undefined ? buildLandmarks() : landmarks,
    blendshapes: blendshapes === undefined ? buildBlendshapes() : blendshapes,
    transformationMatrix: transformationMatrix === undefined ? IDENTITY_MATRIX : transformationMatrix,
  };
}

// A — Identity matrix returns the input unchanged.
{
  const input = { x: 0.123, y: -0.456, z: 0.789 };
  const out = normalizeIrisByHeadPose(input, IDENTITY_MATRIX);
  assert.ok(Math.abs(out.x - input.x) < 1e-9, `x mismatch: ${out.x}`);
  assert.ok(Math.abs(out.y - input.y) < 1e-9, `y mismatch: ${out.y}`);
  assert.ok(Math.abs(out.z - input.z) < 1e-9, `z mismatch: ${out.z}`);
}

// B — 30° yaw rotation: pre-rotate a centered eye point, verify normalization undoes it.
{
  const yaw = yawMatrixColumnMajor(30);
  const rad = (30 * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // A "centered eye" in head-local frame at (0, 0, zHead). After applying the
  // matrix R to that local point, the world-frame position is:
  //   R · (0,0,z) = (s*z, 0, c*z)   (column 2 of R times z)
  const zHead = 0.05;
  const worldFrame = { x: s * zHead, y: 0, z: c * zHead };
  const headLocal = normalizeIrisByHeadPose(worldFrame, yaw);
  assert.ok(Math.abs(headLocal.x - 0) < 1e-6, `x should be ~0, got ${headLocal.x}`);
  assert.ok(Math.abs(headLocal.y - 0) < 1e-6, `y should be ~0, got ${headLocal.y}`);
  assert.ok(Math.abs(headLocal.z - zHead) < 1e-6, `z should be ~${zHead}, got ${headLocal.z}`);
}

// C — classifyGazeZone boundary table.
{
  assert.equal(classifyGazeZone({ x: 0, y: 0 }, 8), 'center');
  assert.equal(classifyGazeZone({ x: 0.5, y: 0 }, 8), 'right');
  assert.equal(classifyGazeZone({ x: -0.5, y: 0 }, 8), 'left');
  assert.equal(classifyGazeZone({ x: 0, y: 0.5 }, 8), 'down');
  assert.equal(classifyGazeZone({ x: 0, y: -0.5 }, 8), 'up');
  assert.equal(classifyGazeZone({ x: 0.05, y: 0.05 }, 8), 'center');
  assert.equal(classifyGazeZone({ x: 0.4, y: 0.5 }, 8), 'down');
}

// D — facePresent: false returns null.
{
  const result = extractEyeFeatures({ facePresent: false }, {});
  assert.equal(result, null);
}

// E — eyeBlinkLeft = 0.95 yields openness ~0.05, blink_l true, iris_offset_normalized.l null.
{
  // Need non-degenerate eye-corner spans so right-eye iris can compute.
  const landmarks = buildLandmarks({
    33:  { x: 0.40, y: 0.50, z: 0 },
    133: { x: 0.46, y: 0.50, z: 0 },
    468: { x: 0.43, y: 0.50, z: 0 },
    263: { x: 0.60, y: 0.50, z: 0 },
    362: { x: 0.54, y: 0.50, z: 0 },
    473: { x: 0.57, y: 0.50, z: 0 },
  });
  const result = buildResult({
    landmarks,
    blendshapes: buildBlendshapes({ eyeBlinkLeft: 0.95, eyeBlinkRight: 0.0 }),
  });
  const features = extractEyeFeatures(result, {});
  assert.ok(Math.abs(features.eye_openness_l - 0.05) < 1e-9, `openness_l = ${features.eye_openness_l}`);
  assert.equal(features.blink_l, true);
  assert.equal(features.iris_offset_normalized.l, null);
  // Right eye still tracks normally.
  assert.equal(features.blink_r, false);
  assert.ok(features.iris_offset_normalized.r !== null);
}

// F — Both eyes blinked → valid false, gaze_zone null.
{
  const result = buildResult({
    blendshapes: buildBlendshapes({ eyeBlinkLeft: 0.95, eyeBlinkRight: 0.95 }),
  });
  const features = extractEyeFeatures(result, {});
  assert.equal(features.blink_l, true);
  assert.equal(features.blink_r, true);
  assert.equal(features.valid, false);
  assert.equal(features.gaze_zone, null);
  assert.equal(features.iris_offset_normalized.l, null);
  assert.equal(features.iris_offset_normalized.r, null);
}

// G — landmarks.length = 100 (no refined irises): iris fields null, valid false, blink path still works.
{
  const result = buildResult({
    landmarks: buildLandmarks({}, 100),
    blendshapes: buildBlendshapes({ eyeBlinkLeft: 0.1, eyeBlinkRight: 0.2 }),
  });
  const features = extractEyeFeatures(result, {});
  assert.ok(Math.abs(features.eye_openness_l - 0.9) < 1e-9);
  assert.ok(Math.abs(features.eye_openness_r - 0.8) < 1e-9);
  assert.equal(features.iris_offset_normalized.l, null);
  assert.equal(features.iris_offset_normalized.r, null);
  assert.equal(features.valid, false);
  assert.equal(features.gaze_zone, null);
}

// H — Eyes open + centered iris → gaze_zone center, valid true.
{
  // Place eye corners at known positions and the iris at the exact midpoint.
  const landmarks = buildLandmarks({
    33:  { x: 0.40, y: 0.50, z: 0 }, // left outer
    133: { x: 0.46, y: 0.50, z: 0 }, // left inner
    468: { x: 0.43, y: 0.50, z: 0 }, // left iris center == midpoint
    263: { x: 0.60, y: 0.50, z: 0 }, // right outer
    362: { x: 0.54, y: 0.50, z: 0 }, // right inner
    473: { x: 0.57, y: 0.50, z: 0 }, // right iris center == midpoint
  });
  const result = buildResult({
    landmarks,
    blendshapes: buildBlendshapes({ eyeBlinkLeft: 0.0, eyeBlinkRight: 0.0 }),
  });
  const features = extractEyeFeatures(result, {});
  assert.equal(features.valid, true);
  assert.equal(features.gaze_zone, 'center');
  assert.equal(features.blink_l, false);
  assert.equal(features.blink_r, false);
  assert.ok(features.iris_offset_normalized.l !== null);
  assert.ok(features.iris_offset_normalized.r !== null);
  assert.ok(Math.abs(features.iris_offset_normalized.l.x) < 1e-9);
  assert.ok(Math.abs(features.iris_offset_normalized.r.x) < 1e-9);
}

console.log('eye-features.test.js passed');
