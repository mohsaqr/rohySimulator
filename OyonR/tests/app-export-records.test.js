// Codex #17: a session exports whatever it recorded (not only camera
// windows), and the comparison bundle carries every record kind too.
// Plain node, throws on failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPORT_RECORD_KINDS, collectRecords, inSessions, ofPeople, recordCounts,
} from '../standalone/app/src/lib/exportRecords.js';
import { splitRawOnly, isRawOnly } from '../standalone/app/src/lib/rawOnly.js';

const sets = {
  signalWindows: [
    { window_id: 'tw1', session_id: 's1', user_id: 'u1', modality: 'typing' },
    { window_id: 'vt1', session_id: 's2', user_id: 'u2', modality: 'voice' },
  ],
  signalEvents: [
    { event_id: 'e1', session_id: 's1', user_id: 'u1', modality: 'typing', state: 'burst', sequence_index: 0 },
    { event_id: 'e2', session_id: 's3', user_id: 'u1', modality: 'code_run', state: 'ok', sequence_index: 0 },
  ],
  logEvents: [
    { schema_version: 'oyon-log-v1', event_name: 'start', context: { session_id: 's1', user_id: 'u1' } },
    { schema_version: 'oyon-log-v1', event_name: 'start', context: { session_id: 's2', user_id: 'u2' } },
  ],
  metrics: [{ schema_version: 'oyon-metric-v1', name: 'fps', value: 15, context: { session_id: 's1', user_id: 'u1' } }],
};

assert.deepEqual(EXPORT_RECORD_KINDS, ['signal_windows', 'signal_events', 'log_events', 'metrics', 'raw_windows']);

// A typing-only session (no camera windows) still has its whole record.
const s1 = collectRecords(sets, inSessions(['s1']));
assert.deepEqual(recordCounts(s1), { signal_windows: 1, signal_events: 1, log_events: 1, metrics: 1, raw_windows: 0 });
assert.equal(s1.log_events[0].context.session_id, 's1', 'session read from the log context');

// Several sessions (a comparison): the union; nothing from other sessions.
const s12 = collectRecords(sets, inSessions(['s1', 's2']));
assert.deepEqual(recordCounts(s12), { signal_windows: 2, signal_events: 1, log_events: 2, metrics: 1, raw_windows: 0 });

// People compared: every session of each person.
const u1 = collectRecords(sets, ofPeople(['u1']));
assert.deepEqual(u1.signal_events.map((e) => e.event_id), ['e1', 'e2']);

// A missing set is empty, never a throw; bad input is a TypeError.
assert.deepEqual(recordCounts(collectRecords({}, () => true)), { signal_windows: 0, signal_events: 0, log_events: 0, metrics: 0, raw_windows: 0 });
assert.throws(() => collectRecords(null, () => true), TypeError);
assert.throws(() => collectRecords(sets, 'yes'), TypeError);
// Raw-only envelopes (modality 'raw'): never emotion windows, always exported.
{
  const F = ['ts_ms', 'ts_group_ms', 'valence'];
  const head = { session_id: 's1', window_start: 'a', window_end: 'b', valence: 0.1,
    raw_part: { id: 'p', index: 0, count: 2 }, raw_streams: { affect: { fields: F, rows: [[1, null, 0.1]] } } };
  const part = { session_id: 's1', modality: 'raw', raw_part: { id: 'p', index: 1, count: 2 },
    raw_streams: { affect: { fields: F, rows: [[2, null, 0.2]] } } };
  const stop = { session_id: 's1', modality: 'raw', raw_reason: 'stop', raw_streams: { affect: { fields: F, rows: [[3, null, 0.3]] } } };
  const other = { session_id: 's2', modality: 'raw', raw_reason: 'stop', raw_streams: {} };
  const { windows, rawOnly } = splitRawOnly([head, part, stop, other]);
  // The split window is joined back (both rows) and stays a window; the part is gone.
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].raw_streams.affect.rows, [[1, null, 0.1], [2, null, 0.2]]);
  assert.deepEqual(rawOnly, [stop, other]);
  assert.ok(isRawOnly(stop) && !isRawOnly(head) && !isRawOnly(null));
  const picked = collectRecords({ rawWindows: rawOnly }, inSessions(['s1']));
  assert.deepEqual(picked.raw_windows, [stop]);
  assert.throws(() => splitRawOnly(null), TypeError);
}

// Picking only removes: input untouched.
assert.equal(sets.signalEvents.length, 2);

// The Sessions page offers Export on any recorded session, and both bundles
// are built from the same record picker.
const read = (p) => readFileSync(new URL(`../standalone/app/src/${p}`, import.meta.url), 'utf8');
const sessions = read('routes/sessions.tsx');
assert.match(sessions, /row\.records > 0 \?/, 'Export gated on any record, not on camera windows');
assert.doesNotMatch(sessions, /row\.windows > 0 \?/);
assert.match(sessions, /bundleRecords\(\{ sets: inScope, fed, fedWindows, keep: inSessions\(\[row\.key\]\) \}\)/);
const bundle = read('lib/exportBundle.ts');
assert.match(bundle, /variant: 'multi',[\s\S]*records: \{/, 'the comparison bundle carries records');
assert.doesNotMatch(bundle, /schema_version: '1\.0'/, 'both bundles are 1.1');
assert.match(read('routes/analyze/comparison.tsx'), /bundleRecords\(\{ sets: inScope, fed, fedWindows, keep \}\)/);
// The analysed windows never include raw-only envelopes; the export reads them.
const stored = read('lib/storedWindows.ts');
assert.match(stored, /splitRawOnly\(merged\)/);
assert.match(stored, /splitRawOnly\(normalized\)\.windows/);
assert.match(stored, /splitRawOnly\(fedWindows\)\.windows/);
assert.match(bundle, /readStoredRawOnly\(\)/);

console.log('app-export-records tests passed');
