// Phase 0 alignment plumbing: anchored window boundaries, raw-stream
// recording on every window, group-clock stamping, the validator's raw_streams
// shape check, and the settings that drive it.
import assert from 'node:assert/strict';
import { EmotionAggregator } from '../src/aggregation/EmotionAggregator.js';
import { RawStreamRecorder, screenGazeRow, affectRow } from '../src/aggregation/RawStreamRecorder.js';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch, validateRawStreamsBlock } from '../src/validation/validateEmotionPayload.js';
import { createOyonSettings, settingsSnapshot } from '../src/settings/OyonSettings.js';
import { groupTimeline } from '../src/group/timeline.js';

const face = (ts) => ({ timestamp: ts, facePresent: true, probabilities: { happy: 1 }, valence: 0.5, arousal: 0.1, confidence: 1, entropy: 0 });

// ---------- anchored windows: boundaries on the grid, not at the first sample ----------
{
  const anchor = 1_000_000;
  const agg = new EmotionAggregator({ windowMs: 10_000, minValidFrames: 1, windowAnchorMs: anchor });
  // First sample 3.4 s after the anchor: window 0 = [anchor, anchor + 10 s).
  const out = [];
  for (const t of [3_400, 4_400, 9_400, 10_400, 12_000, 19_999, 20_000]) {
    const w = agg.addSample(face(anchor + t));
    if (w) out.push(w);
  }
  assert.equal(out.length, 2);
  assert.equal(out[0].window_start, new Date(anchor).toISOString());
  assert.equal(out[0].window_end, new Date(anchor + 10_000).toISOString());
  assert.equal(out[0].valid_frames, 3, 'the sample at +10.4 s belongs to window 1, not window 0');
  assert.equal(out[1].window_start, new Date(anchor + 10_000).toISOString());
  assert.equal(out[1].valid_frames, 3);
  // A gap (pause / late join) skips whole windows: the next window is the one containing the sample.
  const w = agg.addSample(face(anchor + 47_000));
  assert.equal(w.window_start, new Date(anchor + 20_000).toISOString());
  const last = agg.flush(anchor + 50_000);
  assert.equal(last.window_start, new Date(anchor + 40_000).toISOString());
}

// ---------- invariant: two members with different start times share boundaries ----------
{
  const anchor = 5_000;
  const starts = (first) => {
    const agg = new EmotionAggregator({ windowMs: 5_000, minValidFrames: 1, windowAnchorMs: () => anchor });
    const ws = [];
    for (let t = first; t < 40_000; t += 1_000) { const w = agg.addSample(face(t)); if (w) ws.push(w.window_start); }
    return ws;
  };
  const a = starts(5_300); const b = starts(13_900);
  const common = b.filter(x => a.includes(x));
  assert.deepEqual(common, b, 'every window of the late joiner coincides with one of the early member');
}

// ---------- free-running behaviour unchanged without an anchor ----------
{
  const agg = new EmotionAggregator({ windowMs: 2_000, minValidFrames: 1 });
  assert.equal(agg.addSample(face(100)), null);
  assert.equal(agg.addSample(face(1_100)), null);
  const w = agg.addSample(face(2_100));
  assert.equal(w.window_start, new Date(100).toISOString());
  assert.equal(w.valid_frames, 3);
}

// ---------- RawStreamRecorder ----------
{
  const full = [];
  const rec = new RawStreamRecorder({ clock: { toGroupTime: ms => ms + 40 }, maxRowsPerStream: 2, onFull: (name) => full.push(name) });
  rec.record('affect', 1_000, affectRow({ valence: 0.2, arousal: -0.1, confidence: 0.9, probabilities: { sad: 0.1, happy: 0.9 } }));
  rec.record('affect', 2_000, affectRow(null));
  rec.record('affect', 3_000, affectRow(null)); // past the bound: kept (lossless), the owner was told
  rec.record('custom', 1_500, { b: 2, a: true, c: { nested: 1 } });
  assert.deepEqual(full, ['affect'], 'onFull fires once when the bound is reached');
  const out = rec.drain();
  assert.deepEqual(out.affect.fields, ['ts_ms', 'ts_group_ms', 'valence', 'arousal', 'confidence', 'label', 'face_present']);
  assert.deepEqual(out.affect.rows[0], [1_000, 1_040, 0.2, -0.1, 0.9, 'happy', 1]);
  assert.deepEqual(out.affect.rows[1], [2_000, 2_040, null, null, null, null, 0]);
  assert.equal(out.affect.rows.length, 3, 'nothing is dropped at the bound (Codex #12)');
  assert.equal('dropped_rows' in out.affect, false);
  assert.deepEqual(out.custom.fields, ['ts_ms', 'ts_group_ms', 'a', 'b', 'c']);
  assert.deepEqual(out.custom.rows[0], [1_500, 1_540, 1, 2, null]);
  assert.equal(rec.drain(), null, 'drain empties the recorder');
  const errors = [];
  validateRawStreamsBlock(out, 'raw', errors);
  assert.deepEqual(errors, []);
  // A field first seen later back-fills earlier rows with null.
  const r2 = new RawStreamRecorder();
  r2.record('x', 1, { a: 1 });
  r2.record('x', 2, { a: 2, b: 3 });
  assert.deepEqual(r2.drain().x.rows, [[1, null, 1, null], [2, null, 2, 3]]);
  // AOI hit test in the gaze convention.
  const aois = [{ id: 'partner', x: 0.1, y: -0.2, width: 0.3, height: 0.4 }];
  assert.equal(screenGazeRow({ x: 0.2, y: 0, quality: 0.8 }, aois).aoi, 'partner');
  assert.equal(screenGazeRow({ x: -0.2, y: 0 }, aois).aoi, null);
  assert.equal(screenGazeRow({ x: 0.9, y: 0 }, aois).on_screen, 0);
}

// ---------- validator: raw_streams shape and size, never names ----------
{
  const check = (rs, opts) => { const e = []; validateRawStreamsBlock(rs, 'r', e, opts); return e; };
  assert.deepEqual(check({ anything_goes: { fields: ['ts_ms', 'whatever'], rows: [[1, 'x'], [2, null]] } }), []);
  assert.equal(check([]).length, 1);
  assert.equal(check({ BadName: { fields: ['ts_ms'], rows: [] } }).length, 1);
  assert.equal(check({ s: { fields: ['t'], rows: [] } }).length, 1, "fields[0] must be 'ts_ms'");
  assert.equal(check({ s: { fields: ['ts_ms', 'a'], rows: [[1]] } }).length, 1, 'row length mismatch');
  assert.equal(check({ s: { fields: ['ts_ms', 'a'], rows: [[1, { o: 1 }]] } }).length, 1, 'object cells rejected');
  assert.equal(check({ s: { fields: ['ts_ms', 'ts_ms'], rows: [] } }).length, 1, 'duplicate fields');
  assert.equal(check({ s: { fields: ['ts_ms'], rows: [[1], [2], [3]] } }, { maxRawStreamBytes: 10 }).length, 1, 'byte budget');
}

// ---------- settings ----------
{
  const s = createOyonSettings({ window_anchor_ms: '1700000000000', group_clock_url: ' http://hub/clock ', group_clock_resync_ms: 1 });
  assert.equal(s.window_anchor_ms, 1_700_000_000_000);
  assert.equal(s.group_clock_url, 'http://hub/clock');
  assert.equal(s.group_clock_resync_ms, 5_000, 'resync is bounded below');
  const d = createOyonSettings({});
  assert.equal(d.window_anchor_ms, null);
  assert.equal(d.group_clock_url, null);
  assert.equal(createOyonSettings({ window_anchor_ms: true }).window_anchor_ms, null);
  assert.equal(createOyonSettings({ window_anchor_ms: -5 }).window_anchor_ms, null);
  assert.notEqual(settingsSnapshot(s).settings_hash, settingsSnapshot(d).settings_hash);
}

// ---------- runtime: every window carries raw_streams + group alignment; timeline reads it back ----------
{
  const realNow = Date.now;
  let clock = Date.UTC(2026, 0, 1, 0, 0, 3, 200); // 3.2 s after the anchor below
  const clockStart = clock;
  Date.now = () => clock;
  try {
    const anchor = Date.UTC(2026, 0, 1);
    const offset = 750; // this laptop is 750 ms behind the group clock
    const groupClock = {
      started: 0,
      start() { this.started += 1; return Promise.resolve(); },
      stop() {},
      toGroupTime: (ms) => ms + offset,
      toLocalTime: (ms) => ms - offset,
      snapshot: () => ({ clock_offset_ms: offset, clock_rtt_ms: 12, clock_source: 'handshake' }),
    };
    const batches = [];
    const samples = [];
    const runtime = new EmotionRuntime({
      settings: { sample_interval_ms: 1000, aggregate_window_ms: 5000, min_valid_frames: 1, window_anchor_ms: anchor },
      camera: { video: { readyState: 2 }, async start() {}, stop() {} },
      faceTracker: new MockFaceTracker(),
      classifier: new MockEmotionClassifier(),
      transport: { async send(events) { batches.push(events); } },
      contextProvider: () => ({ session_id: 's1', group_id: 'G1', member_id: 'm1', seat: 'left' }),
      groupClock,
    });
    runtime.on('sample', (e) => samples.push(e));
    assert.equal(runtime.recordHostSample('speech', { state: 'speech' }, clock), true);
    assert.equal(runtime.recordHostSample('Bad Name', { state: 'x' }), false);
    assert.equal(runtime.recordHostSample('speech', null), false);
    await runtime.start();
    assert.equal(groupClock.started, 1);
    runtime.running = false; // drive ticks by hand
    clearTimeout(runtime.timer); runtime.timer = null;
    for (let i = 0; i < 12; i += 1) { await runtime.sampleOnce(); clock += 1000; }
    await runtime.stop();

    assert.equal(samples[0].ts_ms, Date.UTC(2026, 0, 1, 0, 0, 3, 200));
    assert.equal(samples[0].ts_group_ms, samples[0].ts_ms + offset);
    const events = batches.flat();
    assert.ok(events.length >= 3, `expected ≥ 3 windows, got ${events.length}`);
    // Local anchor = group anchor − offset; boundaries are on that grid.
    const localAnchor = anchor - offset;
    for (const e of events.slice(1)) {
      const start = Date.parse(e.window_start);
      assert.equal((start - localAnchor) % 5000, 0, `window ${e.window_start} is off the anchored grid`);
    }
    for (const e of events) {
      assert.equal(e.clock_offset_ms, offset);
      assert.equal(e.clock_rtt_ms, 12);
      assert.equal(e.window_anchor_ms, anchor);
      assert.equal(e.window_start_group_ms, Date.parse(e.window_start) + offset);
      assert.ok(e.raw_streams?.affect, 'every window carries the affect stream');
      assert.ok(e.raw_streams?.head, 'and head pose from the face transform');
    }
    assert.deepEqual(events[0].raw_streams.speech.rows[0], [clockStart, clockStart + offset, 'speech'], 'host samples ride the same streams, group-stamped');
    const total = events.reduce((n, e) => n + e.raw_streams.affect.rows.length, 0);
    assert.equal(total, 12, 'every tick recorded exactly once across windows');
    const v = validateEmotionBatch({ events });
    assert.deepEqual(v.errors, []);

    // The group layer reads it back on the group clock: first tick at group t = 3.2 s + 0.75 s.
    const tl = groupTimeline({ windows: events, channels: ['emotion'], normalize: 'none' });
    assert.equal(tl[0].t_group_ms, anchor);
    const firstValued = tl.find(r => r.state !== null);
    assert.equal(firstValued.t_s, 4, 'first 1 Hz tick at or after group time 3.95 s');
    assert.equal(firstValued.state, 'happy', 'mock classifier: tick 1 → labels[1]');
  } finally {
    Date.now = realNow;
  }
}

console.log('group-alignment.test.js passed');
