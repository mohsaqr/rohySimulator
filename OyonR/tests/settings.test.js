import assert from 'node:assert/strict';
import { createOyonSettings, expectedSamplesPerWindow, settingsSnapshot } from '../src/settings/OyonSettings.js';

{
  const settings = createOyonSettings();
  assert.equal(settings.sample_interval_ms, 1000);
  assert.equal(settings.aggregate_window_ms, 10000);
  assert.equal(settings.min_valid_frames, 3);
  assert.equal(settings.enable_dynamics, true);
}

{
  const settings = createOyonSettings({
    sampleIntervalMs: 2000,
    windowMs: 5000,
    minValidFrames: 99,
  });
  assert.equal(settings.sample_interval_ms, 2000);
  assert.equal(settings.aggregate_window_ms, 5000);
  assert.equal(settings.min_valid_frames, expectedSamplesPerWindow(2000, 5000));
}

{
  const one = settingsSnapshot(createOyonSettings({ model: 'mock' }));
  const two = settingsSnapshot(createOyonSettings({ model_profile: 'mock' }));
  assert.equal(one.settings_hash, two.settings_hash);
  assert.match(one.settings_hash, /^fnv1a32:/);
}

console.log('settings.test.js passed');
