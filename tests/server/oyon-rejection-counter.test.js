import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  recordRejection,
  getStats,
  _resetForTests,
} from '../../server/routes/oyon-rejection-counter.js';

test('records rejections and exposes per-endpoint counts', () => {
  _resetForTests();
  recordRejection('POST /emotion-records', 400);
  recordRejection('POST /emotion-records', 400);
  recordRejection('POST /consent', 403);
  const stats = getStats();
  assert.equal(stats['POST /emotion-records'].count_1h, 2);
  assert.equal(stats['POST /emotion-records'].count_5m, 2);
  assert.equal(stats['POST /emotion-records'].last_status, 400);
  assert.equal(stats['POST /consent'].count_1h, 1);
});

test('ignores 2xx and 3xx responses', () => {
  _resetForTests();
  recordRejection('GET /config', 200);
  recordRejection('GET /config', 304);
  const stats = getStats();
  assert.equal(Object.keys(stats).length, 0);
});

test('returns empty object when no rejections recorded', () => {
  _resetForTests();
  assert.deepEqual(getStats(), {});
});

test('handles invalid input without crashing', () => {
  _resetForTests();
  recordRejection('', 400);
  recordRejection(null, 400);
  recordRejection('POST /x', NaN);
  recordRejection('POST /x', undefined);
  assert.deepEqual(getStats(), {});
});
