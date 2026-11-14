// Codex #8: the non-camera records (typing, voice, writing, all events) read
// from the local store are narrowed exactly as the emotion windows are —
// the filter bar's scope, sessions, people and keys in standalone, the one
// current session in an embed. Plain node, throws on failure.
import assert from 'node:assert/strict';
import { narrowLocal, narrowByKeys } from '../standalone/app/src/lib/viewNarrowing.js';

const ev = (session_id, user_id, group_id, i) => ({ event_id: `${session_id}-${i}`, session_id, user_id, group_id, modality: 'typing', state: 'burst', sequence_index: i });
const rows = [ev('s1', 'u1', 'g1', 0), ev('s1', 'u1', 'g1', 1), ev('s2', 'u2', 'g1', 0), ev('s3', 'u2', 'g2', 0)];
const standalone = { embedded: false, currentSessionId: 's3', filterScope: 'all', sessionIds: null, userIds: null, keyFilters: {} };

// No narrowing chosen: every record.
assert.equal(narrowLocal(rows, standalone).length, 4);
// One session picked: only its records, never another session's typing.
assert.deepEqual(narrowLocal(rows, { ...standalone, sessionIds: ['s1'] }).map((r) => r.event_id), ['s1-0', 's1-1']);
// One person.
assert.deepEqual(narrowLocal(rows, { ...standalone, userIds: ['u2'] }).map((r) => r.session_id), ['s2', 's3']);
// A key above the person.
assert.deepEqual(narrowLocal(rows, { ...standalone, keyFilters: { group_id: ['g2'] } }).map((r) => r.session_id), ['s3']);
// Scope: current = the live session; past = the others.
assert.deepEqual(narrowLocal(rows, { ...standalone, filterScope: 'current' }).map((r) => r.session_id), ['s3']);
assert.deepEqual(narrowLocal(rows, { ...standalone, filterScope: 'past' }).map((r) => r.session_id), ['s1', 's1', 's2']);
// An embed is its one session, whatever the filter store holds.
const embed = { ...standalone, embedded: true, currentSessionId: 's2', sessionIds: ['s1'], userIds: ['u1'], keyFilters: { group_id: ['g2'] } };
assert.deepEqual(narrowLocal(rows, embed).map((r) => r.session_id), ['s2']);
// An embed with no current session draws nothing, never a fallback.
assert.deepEqual(narrowLocal(rows, { ...embed, currentSessionId: null }), []);
// Narrowing only removes; the input is untouched.
assert.equal(rows.length, 4);
assert.equal(narrowByKeys(rows, null), rows);
assert.throws(() => narrowLocal(null, standalone), TypeError);

console.log('app-view-narrowing tests passed');
