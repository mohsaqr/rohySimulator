import assert from 'node:assert/strict';
import { FallbackEmotionTransport } from '../src/transport/FallbackEmotionTransport.js';

{
  let sent = 0;
  const transport = new FallbackEmotionTransport({
    transport: {
      async send(events) {
        sent += events.length;
      },
    },
  });

  const result = await transport.send([{ id: 1 }, { id: 2 }], { session_id: 's1' });
  assert.deepEqual(result, { ok: true, sent: 2, dropped: 0 });
  assert.equal(sent, 2);
}

{
  let drops = 0;
  let disabled = 0;
  const transport = new FallbackEmotionTransport({
    maxFailures: 2,
    transport: {
      async send() {
        throw new Error('backend down');
      },
    },
    onDrop({ events }) {
      drops += events.length;
    },
    onDisabled() {
      disabled += 1;
    },
  });

  const first = await transport.send([{ id: 1 }], { session_id: 's1' });
  assert.equal(first.ok, false);
  assert.equal(first.dropped, 1);
  assert.equal(first.disabled, false);
  assert.equal(drops, 1);

  const second = await transport.send([{ id: 2 }], { session_id: 's1' });
  assert.equal(second.ok, false);
  assert.equal(second.dropped, 1);
  assert.equal(second.disabled, true);
  assert.equal(transport.disabled, true);
  assert.equal(disabled, 1);
  assert.equal(drops, 2);

  const third = await transport.send([{ id: 3 }], { session_id: 's1' });
  assert.equal(third.ok, false);
  assert.equal(third.disabled, true);
  assert.equal(drops, 3);
}

{
  let calls = 0;
  const transport = new FallbackEmotionTransport({
    retryOnce: true,
    transport: {
      async send() {
        calls += 1;
        if (calls === 1) throw new Error('temporary');
      },
    },
  });

  const result = await transport.send([{ id: 1 }], { session_id: 's1' });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(transport.failureCount, 0);
}

console.log('fallback-transport.test.js passed');
