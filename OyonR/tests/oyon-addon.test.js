import assert from 'node:assert/strict';
// All three resolve through the back-compat surface (RohyOyonAddon re-exports
// the generic pair and adds the Rohy wrapper) — matching `oyon/addon`.
import { createOyonAddon, createRohyOyonAddon, createNoopOyonAddon } from '../src/addon/RohyOyonAddon.js';

// 1. Disabled → inert noop twin (shape unchanged for back-compat).
{
  const addon = createOyonAddon({ enabled: false, disabledReason: 'flag-off' });
  assert.equal(addon.enabled, false);
  assert.equal(addon.available, false);
  assert.deepEqual(addon.getStatus(), {
    enabled: false, available: false, status: 'disabled', reason: 'flag-off',
  });
}

// 2. Generic addon: lifecycle + variant 'oyon' + passes getContext through.
{
  let seenOptions = null;
  let attached = 0, detached = 0, paused = 0, resumed = 0;
  const addon = createOyonAddon({
    enabled: true,
    getContext: () => ({ session_id: 's1', user_id: 'u1', course_id: 'bio-101' }),
    attachmentFactory: (options) => {
      seenOptions = options;
      return {
        runtime: {
          on: (type, handler) => { if (type === 'status') handler({ state: 'ready' }); },
          pause: () => { paused += 1; },
          resume: () => { resumed += 1; },
        },
        async attach() { attached += 1; options.mount?.(this.runtime); return this.runtime; },
        async detach() { detached += 1; },
      };
    },
  });

  assert.equal(addon.variant, 'oyon');
  const started = await addon.start();
  assert.equal(started.ok, true);
  assert.equal(attached, 1);
  assert.equal(addon.status, 'ready');
  assert.equal(addon.getStatus().variant, 'oyon');
  // Generic addon forwards getContext (LMS join keys reach the attachment).
  assert.equal(typeof seenOptions.getContext, 'function');
  assert.equal(seenOptions.getContext().course_id, 'bio-101');

  assert.deepEqual(addon.pause(), { ok: true });
  assert.deepEqual(addon.resume(), { ok: true });
  assert.equal(paused, 1);
  assert.equal(resumed, 1);
  assert.deepEqual(await addon.stop(), { ok: true });
  assert.equal(detached, 1);
}

// 3. The `rohy` flag selects the Rohy variant.
{
  const addon = createOyonAddon({
    enabled: true,
    rohy: true,
    getSession: () => ({ session_id: 's1' }),
    attachmentFactory: () => ({ runtime: { on: () => {} }, async attach() { return this.runtime; }, async detach() {} }),
  });
  assert.equal(addon.variant, 'rohy');
  await addon.start();
  assert.equal(addon.getStatus().variant, 'rohy');
}

// 4. Back-compat: createRohyOyonAddon === createOyonAddon({ rohy: true }).
{
  const addon = createRohyOyonAddon({
    enabled: true,
    getSession: () => ({ session_id: 's1' }),
    attachmentFactory: () => ({ runtime: { on: () => {} }, async attach() { return this.runtime; }, async detach() {} }),
  });
  assert.equal(addon.variant, 'rohy');
  assert.equal((await addon.start()).ok, true);
}

// 5. createNoopOyonAddon is re-exported from the generic module.
{
  assert.equal(createNoopOyonAddon('x').enabled, false);
}

console.log('oyon-addon.test.js passed');
