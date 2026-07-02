import assert from 'node:assert/strict';
import { createOyonAttachment, normalizeContext } from '../src/adapters/oyonAttach.js';
import { createRohyFerAttachment } from '../src/adapters/rohyAttach.js';
import { LocalEmotionTransport } from '../src/transport/LocalEmotionTransport.js';

// Inject stubs so EmotionRuntime constructs without a browser/camera. attach()
// is only exercised up to its session_id guard (before runtime.start()).
const headless = () => ({
  transport: new LocalEmotionTransport({ storage: null }),
  runtimeOptions: { faceTracker: {}, classifier: {} },
});

// 1. normalizeContext PRESERVES host-specific keys and aliases camelCase identity.
{
  const ctx = normalizeContext({ sessionId: 's1', userId: 'u1', course_id: 'c9', activity_id: 'a3' });
  assert.equal(ctx.session_id, 's1');
  assert.equal(ctx.user_id, 'u1');
  assert.equal(ctx.course_id, 'c9', 'host-specific key must survive');
  assert.equal(ctx.activity_id, 'a3', 'host-specific key must survive');
}

// 2. snake_case passes through; arbitrary values (incl. 0) preserved.
{
  const ctx = normalizeContext({ session_id: 's2', tenant_id: 't1', attempt: 0 });
  assert.equal(ctx.session_id, 's2');
  assert.equal(ctx.tenant_id, 't1');
  assert.equal(ctx.attempt, 0);
}

// 3. nullish input is safe.
{
  assert.deepEqual(normalizeContext(null), {});
  assert.deepEqual(normalizeContext(undefined), {});
}

// 4. createOyonAttachment requires a context provider.
{
  assert.throws(() => createOyonAttachment({}), /requires getContext/);
}

// 5. getSession alias works; returns the { runtime, attach, detach } shape.
{
  const att = createOyonAttachment({ getSession: () => ({ session_id: 'x' }), ...headless() });
  assert.ok(att.runtime, 'exposes runtime');
  assert.equal(typeof att.attach, 'function');
  assert.equal(typeof att.detach, 'function');
}

// 6. attach() refuses without a session_id BEFORE touching the camera.
{
  const att = createOyonAttachment({ getContext: () => ({ user_id: 'u-only' }), ...headless() });
  await assert.rejects(() => att.attach(), /without a session_id/);
}

// 7. The runtime's contextProvider applies the same normalization (keys survive).
{
  const att = createOyonAttachment({ getContext: () => ({ sessionId: 'sess', cohort: 'fall' }), ...headless() });
  const ctx = att.runtime.contextProvider();
  assert.equal(ctx.session_id, 'sess');
  assert.equal(ctx.cohort, 'fall', 'LMS join keys must reach the window context');
}

// 8. Back-compat: the Rohy wrapper still DROPS to its fixed four fields.
{
  const att = createRohyFerAttachment({
    getSession: () => ({ sessionId: 'r1', userId: 'ru', course_id: 'SHOULD_DROP' }),
    ...headless(),
  });
  const ctx = att.runtime.contextProvider();
  assert.equal(ctx.session_id, 'r1');
  assert.equal(ctx.user_id, 'ru');
  assert.equal('course_id' in ctx, false, 'Rohy normalize must drop unknown keys');
  assert.equal(ctx.case_id, null);
  assert.equal(ctx.tenant_id, null);
}

// 9. Back-compat: the Rohy wrapper still requires getSession.
{
  assert.throws(() => createRohyFerAttachment({}), /requires getSession/);
}

console.log('oyon-attach.test.js: all assertions passed');
