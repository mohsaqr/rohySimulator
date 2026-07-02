import assert from 'node:assert/strict';
import { HttpEmotionTransport } from '../src/transport/HttpEmotionTransport.js';

function validWindow(overrides = {}) {
  return {
    session_id: 's1',
    window_start: new Date(0).toISOString(),
    window_end: new Date(1000).toISOString(),
    dominant_emotion: 'neutral',
    probabilities: {
      anger: 0.05,
      contempt: 0.05,
      disgust: 0.05,
      fear: 0.05,
      happy: 0.05,
      neutral: 0.65,
      sad: 0.05,
      surprise: 0.05,
    },
    valence: 0,
    arousal: 0,
    entropy: 1,
    confidence: 0.65,
    valid_frames: 2,
    missing_face_ratio: 0,
    ...overrides,
  };
}

{
  let request = null;
  const transport = new HttpEmotionTransport({
    baseUrl: 'https://example.test',
    tokenProvider: async () => 'token-1',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true };
    },
  });

  await transport.send([validWindow()], { session_id: 's1' });
  assert.equal(request.url, 'https://example.test/api/sessions/s1/emotions/batch');
  assert.equal(request.init.headers.Authorization, 'Bearer token-1');
  assert.deepEqual(JSON.parse(request.init.body).events[0].probabilities.neutral, 0.65);
}

{
  let called = false;
  const transport = new HttpEmotionTransport({
    fetchImpl: async () => {
      called = true;
      return { ok: true };
    },
  });

  await assert.rejects(
    () => transport.send([validWindow({ image: 'raw' })], { session_id: 's1' }),
    /Invalid emotion telemetry/,
  );
  assert.equal(called, false, 'invalid payloads must not reach fetch');
}

{
  let called = false;
  const transport = new HttpEmotionTransport({
    validate: false,
    fetchImpl: async () => {
      called = true;
      return { ok: true };
    },
  });
  await transport.send([validWindow({ image: 'raw' })], { session_id: 's1' });
  assert.equal(called, true, 'validation can be disabled explicitly for custom hosts');
}

console.log('http-transport.test.js passed');
