import assert from 'node:assert/strict';
import { LocalLogTransport, OyonLogger, createLogEvent } from '../src/logging/OyonLogger.js';

{
  const event = createLogEvent({
    level: 'warn',
    event_name: 'oyon.test',
    source: 'test',
    timestamp: '2026-05-08T00:00:00.000Z',
    context: { session_id: 's1' },
    details: { image: 'raw', nested: { frame: 'raw' }, ok: true },
  });
  assert.equal(event.level, 'warn');
  assert.equal(event.details.image, '[forbidden]');
  assert.equal(event.details.nested.frame, '[forbidden]');
  assert.equal(event.details.ok, true);
}

{
  const transport = new LocalLogTransport({ storage: null, maxEvents: 2 });
  const logger = new OyonLogger({
    contextProvider: () => ({ session_id: 's1' }),
    transports: [transport],
    maxEvents: 2,
  });
  logger.info('a');
  logger.warn('b');
  logger.error('c', new Error('boom'));
  assert.deepEqual(logger.read().map(event => event.event_name), ['b', 'c']);
  assert.deepEqual(transport.read().map(event => event.event_name), ['b', 'c']);
  assert.equal(logger.read()[1].details.error_message, 'boom');
}

console.log('logging.test.js passed');
