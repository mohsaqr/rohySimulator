import assert from 'node:assert/strict';
import { LocalEmotionTransport } from '../src/transport/LocalEmotionTransport.js';

{
  const transport = new LocalEmotionTransport({ storage: null, maxEvents: 2 });
  await transport.send([{ id: 1 }, { id: 2 }]);
  await transport.send([{ id: 3 }]);
  assert.deepEqual(transport.read(), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(transport.drain(), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(transport.read(), []);
  await transport.send([{ id: 4 }]);
  transport.clear();
  assert.deepEqual(transport.read(), []);
}

{
  const store = new Map();
  const storage = {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  };
  const transport = new LocalEmotionTransport({ storage, storageKey: 'x' });
  await transport.send([{ id: 'a' }]);
  assert.deepEqual(transport.read(), [{ id: 'a' }]);
}

console.log('local-transport.test.js passed');
