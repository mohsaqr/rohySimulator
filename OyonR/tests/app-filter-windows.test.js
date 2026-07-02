// Pure-logic tests for the app's scope/session/user window filtering
// (standalone/app/src/lib/filterWindows.js — plain JS so this node chain
// can execute it directly, same precedent as the legacy dashboard module).

import assert from 'node:assert/strict';
import {
  filterWindows,
  distinctUsers,
  distinctSessions,
  sessionIdOf,
  userIdOf,
  DEFAULT_SESSION,
  DEFAULT_USER,
} from '../standalone/app/src/lib/filterWindows.js';

const w = (session, user, extra = {}) => ({
  session_id: session,
  ...(user === undefined ? {} : { user_id: user }),
  window_end: '2026-06-11T10:00:00.000Z',
  ...extra,
});

const WINDOWS = [
  w('s1', 'alice'),
  w('s1', 'alice'),
  w('s2', 'bob'),
  w('s2', 'alice'),
  w('s3', undefined), // pre-identity record — no user_id
];

// ─── id extraction ────────────────────────────────────────────────────────
assert.equal(sessionIdOf(WINDOWS[0]), 's1');
assert.equal(sessionIdOf({}), DEFAULT_SESSION);
assert.equal(sessionIdOf({ context: { session_id: 'ctx' } }), 'ctx');
assert.equal(userIdOf(WINDOWS[0]), 'alice');
assert.equal(userIdOf(WINDOWS[4]), DEFAULT_USER);
assert.equal(userIdOf({ context: { user_id: 'ctx-user' } }), 'ctx-user');

// ─── distinct values ──────────────────────────────────────────────────────
assert.deepEqual(distinctUsers(WINDOWS), ['alice', 'bob', DEFAULT_USER]);
assert.deepEqual(distinctSessions(WINDOWS), ['s1', 's2', 's3']);

// ─── scope: all (default) ─────────────────────────────────────────────────
assert.equal(filterWindows(WINDOWS).length, 5);
assert.equal(filterWindows(WINDOWS, { scope: 'all' }).length, 5);

// ─── scope: current ───────────────────────────────────────────────────────
assert.deepEqual(
  filterWindows(WINDOWS, { scope: 'current', currentSessionId: 's2' }).map(sessionIdOf),
  ['s2', 's2'],
);
// No live session → 'current' is honestly empty, not silently everything.
assert.equal(filterWindows(WINDOWS, { scope: 'current', currentSessionId: null }).length, 0);

// ─── scope: past ──────────────────────────────────────────────────────────
assert.deepEqual(
  filterWindows(WINDOWS, { scope: 'past', currentSessionId: 's2' }).map(sessionIdOf),
  ['s1', 's1', 's3'],
);
// No live session → nothing is "current", so 'past' degrades to everything.
assert.equal(filterWindows(WINDOWS, { scope: 'past', currentSessionId: null }).length, 5);

// ─── session narrowing ────────────────────────────────────────────────────
assert.equal(filterWindows(WINDOWS, { sessionIds: ['s1', 's3'] }).length, 3);
// Empty array means "no narrowing", same as null.
assert.equal(filterWindows(WINDOWS, { sessionIds: [] }).length, 5);

// ─── user narrowing ───────────────────────────────────────────────────────
assert.equal(filterWindows(WINDOWS, { userIds: ['alice'] }).length, 3);
// Pre-identity records are selectable under the DEFAULT_USER bucket.
assert.equal(filterWindows(WINDOWS, { userIds: [DEFAULT_USER] }).length, 1);

// ─── intersection of all dimensions ───────────────────────────────────────
const both = filterWindows(WINDOWS, {
  scope: 'past',
  currentSessionId: 's1',
  sessionIds: ['s2'],
  userIds: ['alice'],
});
assert.equal(both.length, 1);
assert.equal(sessionIdOf(both[0]), 's2');
assert.equal(userIdOf(both[0]), 'alice');

// ─── garbage tolerance ────────────────────────────────────────────────────
assert.deepEqual(filterWindows(null), []);
assert.deepEqual(filterWindows(undefined, { scope: 'current' }), []);
assert.equal(filterWindows([null, w('s1', 'a')], { sessionIds: ['s1'] }).length, 1);

console.log('app-filter-windows.test.js — all cases passed');
