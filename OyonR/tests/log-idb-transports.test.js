// Tests for src/logging/IndexedDbLogTransports.js — the uncapped runtime log
// and metrics in IndexedDB. A Map-backed store stands in for IndexedDB.
// Plain node, throws on failure.

import assert from 'node:assert/strict';
import { OyonLogger, IndexedDbLogTransport, IndexedDbMetricTransport } from '../src/logging/OyonLogger.js';
import { OyonMetricRecorder } from '../src/logging/OyonMetrics.js';
import * as root from '../src/index.js';

function memoryStore() {
  const stores = new Map();
  const keyOf = { runtime_events: 'event_id', metrics: 'metric_id' };
  return {
    stores,
    async put(name, record) {
      if (!stores.has(name)) stores.set(name, new Map());
      stores.get(name).set(record[keyOf[name]], structuredClone(record));
      return record[keyOf[name]];
    },
    async getAll(name) { return [...(stores.get(name)?.values() ?? [])]; },
    async clear(name) { stores.get(name)?.clear(); },
  };
}

let t = Date.parse('2026-11-14T10:00:00.000Z');
const clock = () => new Date((t += 1000));

// ── Every event kept: no cap, unlike LocalLogTransport's 1000 ──
{
  const store = memoryStore();
  const transport = new IndexedDbLogTransport({ store });
  const logger = new OyonLogger({ transports: [transport], clock, contextProvider: () => ({ session_id: 's1' }), maxEvents: 10 });
  for (let i = 0; i < 1500; i += 1) logger.info('tick', { i });
  await new Promise((r) => setTimeout(r, 0));
  const rows = await transport.read();
  assert.equal(rows.length, 1500, 'nothing dropped');
  assert.equal(logger.read().length, 10, 'the in-memory ring stays bounded');
  assert.ok(rows.every((r) => typeof r.event_id === 'string' && r.event_id.startsWith('log_')));
  assert.equal(new Set(rows.map((r) => r.event_id)).size, 1500, 'keys are unique');
  // Oldest first, and the event itself unchanged apart from its key.
  assert.deepEqual(rows.slice(0, 3).map((r) => r.details.i), [0, 1, 2]);
  const { event_id: _id, ...first } = rows[0];
  assert.equal(first.schema_version, 'oyon-log-v1');
  assert.deepEqual(first.context, { session_id: 's1' });
  await transport.clear();
  assert.deepEqual(await transport.read(), []);
}

// ── An event that already has a key keeps it (re-sent → overwritten, not duplicated) ──
{
  const store = memoryStore();
  const transport = new IndexedDbLogTransport({ store });
  const event = { event_id: 'e1', timestamp: '2026-11-14T10:00:00.000Z', level: 'info', event_name: 'x', context: {}, details: {} };
  await transport.sendLogs([event]);
  await transport.sendLogs([event]);
  assert.deepEqual((await transport.read()).map((r) => r.event_id), ['e1']);
  await transport.sendLogs([]);
  await transport.sendLogs(null);
  assert.equal((await transport.read()).length, 1, 'empty and non-array sends write nothing');
}

// ── Metrics: same contract on the `metrics` store ──
{
  const store = memoryStore();
  const transport = new IndexedDbMetricTransport({ store });
  const metrics = new OyonMetricRecorder({ transports: [transport], clock, maxMetrics: 5 });
  for (let i = 0; i < 2500; i += 1) metrics.record('fps', 15 + (i % 3), { unit: 'Hz' });
  metrics.record('bad', Number.NaN);
  await new Promise((r) => setTimeout(r, 0));
  const rows = await transport.read();
  assert.equal(rows.length, 2500, 'every finite metric kept; NaN never recorded');
  assert.ok(rows.every((r) => r.metric_id.startsWith('metric_') && r.metric_unit === 'Hz'));
  assert.ok(store.stores.has('metrics') && !store.stores.has('runtime_events'), 'metrics go to the metrics store only');
}

// ── A failing store never breaks the logger ──
{
  const broken = { put: async () => { throw new Error('quota'); }, getAll: async () => [], clear: async () => {} };
  const logger = new OyonLogger({ transports: [new IndexedDbLogTransport({ store: broken })] });
  assert.doesNotThrow(() => logger.warn('still logs'));
  assert.equal(logger.read().length, 1);
}

assert.equal(root.IndexedDbLogTransport, IndexedDbLogTransport);
assert.equal(root.IndexedDbMetricTransport, IndexedDbMetricTransport);
console.log('log-idb-transports: ok');
