import assert from 'node:assert/strict';
import { LocalMetricTransport, OyonMetricRecorder } from '../src/logging/OyonMetrics.js';

{
  const transport = new LocalMetricTransport({ storage: null, maxMetrics: 2 });
  const recorder = new OyonMetricRecorder({
    contextProvider: () => ({ session_id: 's1' }),
    transports: [transport],
    maxMetrics: 2,
  });
  recorder.record('a', 1, { unit: 'ms' });
  recorder.record('b', 2);
  recorder.record('c', Number.NaN);
  recorder.record('d', 4);
  assert.deepEqual(recorder.read().map(metric => metric.metric_name), ['b', 'd']);
  assert.deepEqual(transport.read().map(metric => metric.metric_name), ['b', 'd']);
  assert.equal(recorder.read()[1].context.session_id, 's1');
}

console.log('metrics.test.js passed');
