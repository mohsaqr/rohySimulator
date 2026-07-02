import assert from 'node:assert/strict';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MediaPipeFaceTracker } from '../src/inference/MediaPipeFaceTracker.js';

const IDENTITY_4X4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// MockFaceTracker default result has blendshapes of length 52, all scores 0.
{
  const tracker = new MockFaceTracker();
  const result = await tracker.analyze();
  assert.ok(Array.isArray(result.blendshapes), 'blendshapes must be an array');
  assert.equal(result.blendshapes.length, 52);
  for (const entry of result.blendshapes) {
    assert.equal(typeof entry.categoryName, 'string');
    assert.equal(entry.score, 0);
  }
}

// MockFaceTracker default result has transformationMatrix of length 16, identity.
{
  const tracker = new MockFaceTracker();
  const result = await tracker.analyze();
  assert.ok(result.transformationMatrix instanceof Float32Array, 'transformationMatrix must be Float32Array');
  assert.equal(result.transformationMatrix.length, 16);
  for (let i = 0; i < 16; i++) {
    assert.equal(result.transformationMatrix[i], IDENTITY_4X4[i], `identity mismatch at index ${i}`);
  }
}

// MockFaceTracker accepts mockBlendshapes and mockTransformationMatrix overrides.
{
  const customBlendshapes = [
    { categoryName: 'eyeBlinkLeft', score: 0.42 },
    { categoryName: 'eyeBlinkRight', score: 0.13 },
  ];
  const customMatrix = new Float32Array([
    0.5, 0, 0, 0,
    0, 0.5, 0, 0,
    0, 0, 0.5, 0,
    1, 2, 3, 1,
  ]);
  const tracker = new MockFaceTracker({
    mockBlendshapes: customBlendshapes,
    mockTransformationMatrix: customMatrix,
  });
  const result = await tracker.analyze();
  assert.equal(result.blendshapes, customBlendshapes);
  assert.equal(result.blendshapes.length, 2);
  assert.equal(result.blendshapes[0].categoryName, 'eyeBlinkLeft');
  assert.equal(result.blendshapes[0].score, 0.42);
  assert.equal(result.transformationMatrix, customMatrix);
  assert.equal(result.transformationMatrix.length, 16);
  assert.equal(result.transformationMatrix[15], 1);
  assert.equal(result.transformationMatrix[12], 1);
}

// Constructing a real MediaPipeFaceTracker does not throw at import time.
// init() is not called because MediaPipe needs a real WASM environment.
{
  let tracker = null;
  let threw = null;
  try {
    tracker = new MediaPipeFaceTracker();
  } catch (err) {
    threw = err;
  }
  assert.equal(threw, null, 'MediaPipeFaceTracker constructor should not throw');
  assert.ok(tracker, 'constructed tracker should exist');
  assert.equal(tracker.faceLandmarker, null);
  assert.equal(typeof tracker.analyze, 'function');
  assert.equal(typeof tracker.init, 'function');
}

// Constructor accepts options without throwing.
{
  const tracker = new MediaPipeFaceTracker({
    minFaceDetectionConfidence: 0.7,
    minFacePresenceConfidence: 0.7,
  });
  assert.equal(tracker.options.minFaceDetectionConfidence, 0.7);
  assert.equal(tracker.options.minFacePresenceConfidence, 0.7);
}

console.log('face-tracker-output.test.js passed');
