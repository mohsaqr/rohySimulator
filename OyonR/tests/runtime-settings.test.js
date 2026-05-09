import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { LocalEmotionTransport } from '../src/transport/LocalEmotionTransport.js';

const dummy = {
  async init() {},
};

{
  const runtime = new EmotionRuntime({
    settings: {
      sample_interval_ms: 2000,
      aggregate_window_ms: 15000,
      min_valid_frames: 5,
    },
    camera: {},
    faceTracker: dummy,
    classifier: dummy,
    transport: new LocalEmotionTransport({ storage: null }),
  });
  assert.equal(runtime.options.sampleIntervalMs, 2000);
  assert.equal(runtime.settings.aggregate_window_ms, 15000);
  assert.equal(runtime.aggregator.options.windowMs, 15000);
  assert.equal(runtime.aggregator.options.minValidFrames, 5);
}

console.log('runtime-settings.test.js passed');
