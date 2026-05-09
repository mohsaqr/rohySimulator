import assert from 'node:assert/strict';
import { createNoopOyonAddon, createRohyOyonAddon } from '../src/addon/RohyOyonAddon.js';

{
  const addon = createNoopOyonAddon('flag-off');
  assert.equal(addon.enabled, false);
  assert.equal(addon.available, false);
  assert.deepEqual(addon.getStatus(), {
    enabled: false,
    available: false,
    status: 'disabled',
    reason: 'flag-off',
  });
  assert.deepEqual(await addon.start(), { ok: false, reason: 'flag-off' });
  assert.equal(addon.getRuntime(), null);
}

{
  const addon = createRohyOyonAddon({ enabled: false });
  assert.equal(addon.enabled, false);
  assert.equal(addon.available, false);
}

{
  let attached = 0;
  let detached = 0;
  let paused = 0;
  let resumed = 0;
  const addon = createRohyOyonAddon({
    enabled: true,
    getSession: () => ({ session_id: 's1', user_id: 'u1' }),
    attachmentFactory: options => ({
      runtime: {
        on: (type, handler) => {
          if (type === 'status') handler({ state: 'ready' });
        },
        pause: () => { paused += 1; },
        resume: () => { resumed += 1; },
      },
      async attach() {
        attached += 1;
        options.mount?.(this.runtime);
        return this.runtime;
      },
      async detach() {
        detached += 1;
      },
    }),
  });

  const started = await addon.start();
  assert.equal(started.ok, true);
  assert.equal(attached, 1);
  assert.equal(addon.status, 'ready');
  assert.deepEqual(addon.pause(), { ok: true });
  assert.deepEqual(addon.resume(), { ok: true });
  assert.equal(paused, 1);
  assert.equal(resumed, 1);
  assert.deepEqual(await addon.stop(), { ok: true });
  assert.equal(detached, 1);
}

{
  let unavailable = 0;
  const addon = createRohyOyonAddon({
    enabled: true,
    getSession: () => ({ session_id: 's1', user_id: 'u1' }),
    onUnavailable: () => { unavailable += 1; },
    attachmentFactory: () => ({
      runtime: { on: () => {} },
      async attach() {
        throw new Error('model missing');
      },
      async detach() {},
    }),
  });

  const result = await addon.start();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'start-failed');
  assert.equal(addon.available, false);
  assert.equal(addon.getStatus().status, 'unavailable');
  assert.equal(unavailable, 1);
}

{
  let detached = 0;
  let mountedTransport = null;
  const addon = createRohyOyonAddon({
    enabled: true,
    maxSaveFailures: 1,
    getSession: () => ({ session_id: 's1', user_id: 'u1' }),
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => 'down',
    }),
    attachmentFactory: options => {
      mountedTransport = options.transport;
      return {
        runtime: { on: () => {} },
        async attach() {
          return this.runtime;
        },
        async detach() {
          detached += 1;
        },
      };
    },
  });

  assert.equal((await addon.start()).ok, true);
  const result = await mountedTransport.send([{ id: 1 }], { session_id: 's1' });
  assert.equal(result.ok, false);
  assert.equal(addon.available, false);
  assert.equal(detached, 1);
}

console.log('rohy-addon.test.js passed');
