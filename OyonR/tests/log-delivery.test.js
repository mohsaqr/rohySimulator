// A failing log / metric sink is reported and retried, never silent (Codex #9);
// the IndexedDB transports share one connection and read incrementally (#16's
// library half); createLogEvent's defaults match its types (#29).
// Plain node, throws on failure.
import assert from 'node:assert/strict';
import { OyonLogger, createLogEvent, IndexedDbLogTransport, IndexedDbMetricTransport, sharedOyonStore } from '../src/logging/OyonLogger.js';
import { OyonMetricRecorder } from '../src/logging/OyonMetrics.js';
import { RecordDelivery } from '../src/logging/RecordDelivery.js';
import * as root from '../src/index.js';

/** A Map-backed store that can be switched to reject every write. */
function flakyStore() {
  const rows = new Map();
  const state = { down: false, bulkCalls: 0 };
  const keyOf = { runtime_events: 'event_id', metrics: 'metric_id' };
  const check = () => { if (state.down) throw new Error('QuotaExceededError'); };
  return {
    state,
    rows,
    async put(name, record) { check(); rows.set(`${name}:${record[keyOf[name]]}`, structuredClone(record)); },
    async bulkPut(name, records) {
      state.bulkCalls += 1;
      check();
      for (const r of records) rows.set(`${name}:${r[keyOf[name]]}`, structuredClone(r));
    },
    async getAll(name) { return [...rows.entries()].filter(([k]) => k.startsWith(`${name}:`)).map(([, v]) => v); },
    async clear(name) { for (const k of [...rows.keys()]) if (k.startsWith(`${name}:`)) rows.delete(k); },
  };
}

const settle = () => new Promise(r => setTimeout(r, 0));
let t = Date.parse('2026-11-14T10:00:00.000Z');
const clock = () => new Date((t += 1000));

// Capture console.error / console.info without hiding them from the test log entirely.
const realError = console.error; const realInfo = console.info;
const errors = []; const infos = [];
console.error = (...args) => { errors.push(args); };
console.info = (...args) => { infos.push(args); };
try {
  // ── the reproduction: a rejecting store persisted nothing and said nothing ──
  {
    const store = flakyStore();
    store.state.down = true;
    const reported = [];
    const transport = new IndexedDbLogTransport({ store });
    const logger = new OyonLogger({ transports: [transport], clock, maxEvents: 2, onTransportError: info => reported.push(info) });
    for (let i = 0; i < 5; i += 1) logger.info('tick', { i }); // never throws into capture
    await settle();
    assert.ok(reported.length >= 1, 'onTransportError was called');
    assert.equal(reported.at(-1).pending, 5, 'all five events are held for retry');
    assert.equal(errors.length, 1, 'console.error once for the run of failures, not per event');
    const status = logger.deliveryStatus();
    assert.equal(status[0].pending, 5);
    assert.ok(status[0].failures >= 1);
    assert.match(status[0].last_error, /QuotaExceeded/);
    assert.equal(logger.read().length, 2, 'the in-memory ring is still bounded — the queue is what keeps them');

    // The store comes back: the next event carries every held one, in order.
    store.state.down = false;
    logger.info('tick', { i: 5 });
    await settle(); await settle();
    const stored = await transport.read();
    assert.deepEqual(stored.map(r => r.details.i), [0, 1, 2, 3, 4, 5]);
    assert.equal(logger.deliveryStatus()[0].pending, 0);
    assert.equal(infos.length, 1, 'recovery is reported');

    // flush() retries without a new event.
    store.state.down = true;
    logger.warn('later', {});
    await settle();
    store.state.down = false;
    await logger.flush();
    assert.equal((await transport.read()).length, 7);
    assert.ok(store.state.bulkCalls > 0, 'a batch is one transaction (bulkPut)');
  }

  // ── a synchronously throwing sink is held and retried too ─────────────────
  {
    let fail = true;
    const written = [];
    const sink = { sendLogs(events) { if (fail) throw new Error('storage full'); written.push(...events); } };
    const logger = new OyonLogger({ transports: [sink], clock });
    logger.info('a'); logger.info('b');
    assert.equal(logger.deliveryStatus()[0].pending, 2);
    fail = false;
    logger.info('c');
    assert.deepEqual(written.map(e => e.event_name), ['a', 'b', 'c']);
  }

  // ── metrics: same contract ────────────────────────────────────────────────
  {
    const store = flakyStore();
    store.state.down = true;
    const reported = [];
    const transport = new IndexedDbMetricTransport({ store });
    const metrics = new OyonMetricRecorder({ transports: [transport], clock, onTransportError: info => reported.push(info) });
    metrics.record('m', 1); metrics.record('m', 2);
    await settle();
    assert.ok(reported.length >= 1);
    assert.equal(metrics.deliveryStatus()[0].pending, 2);
    store.state.down = false;
    await metrics.flush();
    assert.deepEqual((await transport.read()).map(m => m.metric_value), [1, 2]);
  }

  // ── a sink that never recovers: bounded memory, losses counted and said ───
  {
    const sink = { async sendLogs() { throw new Error('gone'); } };
    const logger = new OyonLogger({ transports: [sink], clock, maxPending: 3 });
    for (let i = 0; i < 5; i += 1) { logger.info('x', { i }); await settle(); }
    const s = logger.deliveryStatus()[0];
    assert.equal(s.pending, 3);
    assert.equal(s.lost, 2, 'the oldest beyond maxPending are counted, never silently gone');
    assert.ok(errors.some(args => String(args[0]).includes('no longer held')));
  }

  // ── order: a write in flight is never overtaken ──────────────────────────
  {
    const written = [];
    let release;
    const sink = {
      sendLogs(events) {
        if (!release) return new Promise((resolve) => { release = () => { written.push(...events); resolve(); }; });
        written.push(...events);
        return Promise.resolve();
      },
    };
    const d = new RecordDelivery({ method: 'sendLogs', label: 'log', transports: [sink] });
    d.deliver([1]); d.deliver([2]); d.deliver([3]);
    release();
    await settle(); await settle();
    assert.deepEqual(written, [1, 2, 3]);
  }
} finally {
  console.error = realError;
  console.info = realInfo;
}

// ── IndexedDB transports: one shared store per database; incremental reads ──
{
  assert.equal(sharedOyonStore('db-a'), sharedOyonStore('db-a'), 'one connection per database');
  assert.notEqual(sharedOyonStore('db-a'), sharedOyonStore('db-b'));
  assert.equal(new IndexedDbLogTransport({ dbName: 'db-a' })._records.store, new IndexedDbMetricTransport({ dbName: 'db-a' })._records.store);
  assert.equal(typeof root.sharedOyonStore, 'function');

  const store = flakyStore();
  const transport = new IndexedDbLogTransport({ store });
  const at = s => ({ timestamp: `2026-11-14T10:00:0${s}.000Z`, level: 'info', event_name: `e${s}`, context: {}, details: {} });
  await transport.sendLogs([at(1), at(2), at(3)]);
  const since = await transport.read({ since: '2026-11-14T10:00:02.000Z' });
  assert.deepEqual(since.map(e => e.event_name), ['e2', 'e3'], 'since is inclusive (merge by key)');
  assert.equal((await transport.read()).length, 3);
}

// ── #29: createLogEvent defaults match its declaration ──────────────────────
{
  const e = createLogEvent({ event_name: 'x' });
  assert.equal(e.source, 'oyon');
  assert.equal(typeof e.timestamp, 'string');
  assert.ok(Number.isFinite(Date.parse(e.timestamp)));
  assert.equal(e.level, 'info');
}

console.log('log-delivery.test.js: ok');
