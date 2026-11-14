// Window integrity: clock corrections never overlap anchored windows (Codex #3),
// stopping never strands raw samples (#4), a boundary sample rides the window
// it belongs to (#11), and the raw recorder is lossless at its row bound (#12).
// Plain node, throws on failure.
import assert from 'node:assert/strict';
import { EmotionAggregator } from '../src/aggregation/EmotionAggregator.js';
import { RawStreamRecorder, rawOnlyEnvelope } from '../src/aggregation/RawStreamRecorder.js';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MultiFaceCapture } from '../src/core/MultiFaceCapture.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

const face = (ts) => ({ timestamp: ts, facePresent: true, probabilities: { happy: 1 }, valence: 0.5, arousal: 0.1, confidence: 1, entropy: 0 });
const ms = iso => Date.parse(iso);

// ── #3: the reproduction — anchor 0 → −2000 mid-window ──────────────────────
{
  let anchor = 0;
  const agg = new EmotionAggregator({ windowMs: 10_000, minValidFrames: 1, windowAnchorMs: () => anchor });
  const out = [];
  for (let t = 1000; t <= 7000; t += 1000) { const w = agg.addSample(face(t)); if (w) out.push(w); }
  anchor = -2000; // a clock re-sync moves the local anchor back by 2 s
  for (let t = 8500; t <= 30_000; t += 1000) { const w = agg.addSample(face(t)); if (w) out.push(w); }
  out.push(agg.flush(31_000));
  assert.equal(ms(out[0].window_start), 0);
  assert.equal(ms(out[0].window_end), 8000, 'the open window closes at its end on the corrected grid');
  assert.equal(out[0].anchor_correction_ms, -2000, 'and says the anchor moved');
  assert.equal(out[0].window_index, 0);
  assert.equal(ms(out[1].window_start), 8000, 'the next window starts where it ended — no overlap');
  assert.equal(out[1].window_index, 1);
  assert.equal(out[1].anchor_correction_ms, 0);
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(ms(out[i].window_start) >= ms(out[i - 1].window_end), `window ${i} overlaps window ${i - 1}`);
    assert.ok(out[i].window_index > out[i - 1].window_index, 'grid indices only increase');
  }
}

// ── #3: forward correction lengthens the open window ────────────────────────
{
  let anchor = 0;
  const agg = new EmotionAggregator({ windowMs: 10_000, minValidFrames: 1, windowAnchorMs: () => anchor });
  const out = [];
  for (const t of [1000, 5000]) agg.addSample(face(t));
  anchor = 2000;
  for (const t of [10_500, 11_999, 12_000, 13_000]) { const w = agg.addSample(face(t)); if (w) out.push(w); }
  assert.equal(out.length, 1);
  assert.equal(ms(out[0].window_end), 12_000);
  assert.equal(out[0].valid_frames, 4, 'samples before the corrected end stay in window 0');
  assert.equal(out[0].anchor_correction_ms, 2000);
  const next = agg.flush(20_000);
  assert.equal(ms(next.window_start), 12_000);
}

// ── #3 invariant: random corrections — no overlap, every sample in exactly one window ──
{
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 25; trial += 1) {
    let anchor = Math.round(rand() * 5000);
    const agg = new EmotionAggregator({ windowMs: 5000, minValidFrames: 1, windowAnchorMs: () => anchor });
    const out = [];
    let n = 0;
    for (let t = 10_000; t < 120_000; t += 250 + Math.round(rand() * 900)) {
      if (rand() < 0.05) anchor += Math.round((rand() - 0.5) * 30_000); // jumps up to ±15 s
      const w = agg.addSample(face(t));
      n += 1;
      if (w) out.push(w);
    }
    const last = agg.flush(200_000);
    if (last) out.push(last);
    assert.equal(out.reduce((s, w) => s + w.valid_frames, 0), n, 'every sample lands in exactly one window');
    for (let i = 0; i < out.length; i += 1) {
      assert.ok(ms(out[i].window_end) > ms(out[i].window_start), 'windows have positive length');
      if (i) assert.ok(ms(out[i].window_start) >= ms(out[i - 1].window_end), `trial ${trial}: window ${i} overlaps`);
    }
  }
}

// ── #12: lossless recorder; #11: drain by interval ──────────────────────────
{
  const full = [];
  const rec = new RawStreamRecorder({ maxRowsPerStream: 2, onFull: s => full.push(s) });
  for (const t of [1, 2, 3]) rec.record('x', t, { v: t });
  assert.deepEqual(full, ['x']);
  assert.equal(rec.maxRows, 3);
  rec.record('y', 10_000, { v: 1 });
  rec.record('y', 1_000, { v: 0 });
  const first = rec.drain({ before: 10_000 });
  assert.deepEqual(first.x.rows.map(r => r[0]), [1, 2, 3], 'three samples, cap two: all three kept');
  assert.deepEqual(first.y.rows.map(r => r[0]), [1_000], 'a row at the end bound waits');
  assert.equal(rec.pending, true);
  const inclusive = rec.drain({ before: 10_000, inclusive: true });
  assert.deepEqual(inclusive.y.rows.map(r => r[0]), [10_000]);
  assert.equal(rec.drain(), null);
  // Raw-only envelope: interval spans its rows, and it validates.
  const env = rawOnlyEnvelope({ s: { fields: ['ts_ms', 'ts_group_ms', 'v'], rows: [[5000, null, 1], [9000, null, 2]] } }, 'stop');
  assert.equal(env.modality, 'raw');
  assert.equal(ms(env.window_start), 5000);
  assert.equal(ms(env.window_end), 9001);
  assert.deepEqual(validateEmotionBatch({ events: [env] }).errors, []);
  assert.equal(rawOnlyEnvelope(null, 'stop'), null);
}

/** A runtime on mocks, ticked by hand. */
function makeRuntime(settings, clockRef) {
  const batches = [];
  const runtime = new EmotionRuntime({
    settings: { sample_interval_ms: 1000, aggregate_window_ms: 10_000, min_valid_frames: 1, ...settings },
    camera: { video: { readyState: 2 }, async start() {}, stop() {} },
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport: { async send(events) { batches.push(events); } },
    contextProvider: () => ({ session_id: 's1', member_id: 'm1' }),
  });
  return { runtime, batches, clockRef };
}

async function withClock(start, fn) {
  const realNow = Date.now;
  const ref = { t: start };
  Date.now = () => ref.t;
  try { await fn(ref); } finally { Date.now = realNow; }
}

// ── #11: samples at 1000 and 10000 — the closed [0, 10000) holds only the first ──
await withClock(0, async (clock) => {
  const { runtime, batches } = makeRuntime({ window_anchor_ms: 0 });
  await runtime.start();
  runtime.running = false; clearTimeout(runtime.timer); runtime.timer = null;
  clock.t = 1000; await runtime.sampleOnce();
  clock.t = 10_000; await runtime.sampleOnce(); // closes [0, 10000)
  const closed = batches.flat()[0];
  assert.equal(ms(closed.window_end), 10_000);
  assert.deepEqual(closed.raw_streams.affect.rows.map(r => r[0]), [1000], 'the row at 10000 is not on [0, 10000)');
  clock.t = 12_000;
  await runtime.stop();
  const all = batches.flat();
  const rows = all.flatMap(e => e.raw_streams?.affect?.rows ?? []).map(r => r[0]);
  assert.deepEqual(rows, [1000, 10_000], 'the boundary row rides the next window, once');
});

// ── #4: a host sample right before stop, with no window open, is not stranded ──
await withClock(50_000, async (clock) => {
  const { runtime, batches } = makeRuntime({ window_anchor_ms: 0 });
  await runtime.start();
  runtime.running = false; clearTimeout(runtime.timer); runtime.timer = null;
  for (let t = 50_000; t <= 60_000; t += 1000) { clock.t = t; await runtime.sampleOnce(); } // 60000 closes [50000, 60000)
  // Flush the open window by hand, as an automatic flush would.
  const flushed = runtime.aggregator.flush(60_500);
  assert.ok(flushed);
  clock.t = 60_700;
  assert.equal(runtime.recordHostSample('speech', { state: 'speech' }, 60_700), true);
  const before = batches.flat().length;
  await runtime.stop();
  const sent = batches.flat().slice(before);
  const speech = sent.flatMap(e => e.raw_streams?.speech?.rows ?? []);
  assert.equal(speech.length, 1, 'the speech sample left on stop');
  const rawOnly = sent.find(e => e.modality === 'raw');
  assert.ok(rawOnly, 'in a raw-only envelope, since no window was open');
  assert.equal(rawOnly.raw_reason, 'stop');
  assert.equal(rawOnly.session_id, 's1', 'with the host context');
  assert.deepEqual(validateEmotionBatch({ events: sent }).errors, []);
  assert.equal(runtime.rawStreams.pending, false);
});

// ── #12 in the runtime: a stream at the bound is spilled raw-only, nothing cut ──
await withClock(0, async () => {
  const { runtime, batches } = makeRuntime({});
  runtime.rawStreams.maxRowsPerStream = 5;
  for (let i = 0; i < 12; i += 1) runtime.recordHostSample('hz', { v: i }, 100 + i);
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 12; i += 1) runtime.recordHostSample('hz', { v: i }, 200 + i);
  await new Promise(r => setTimeout(r, 0));
  await runtime._sendRawOnly(runtime.rawStreams.drain());
  const rows = batches.flat().flatMap(e => e.raw_streams?.hz?.rows ?? []);
  assert.equal(rows.length, 24, 'every host sample sent');
  assert.ok(batches.flat().some(e => e.raw_reason === 'row_bound'), 'spilled at the bound');
});

// ── #4 + #11 for MultiFaceCapture ───────────────────────────────────────────
await withClock(0, async (clock) => {
  const sent = [];
  const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  const tracker = { async init() {}, async analyzeAll() { return [{ facePresent: true, bbox: box, landmarks: [], quality: {} }]; } };
  const cap = new MultiFaceCapture({
    settings: { aggregate_window_ms: 10_000, min_valid_frames: 1, window_anchor_ms: 0, multi_face_confirm_hits: 1 },
    camera: { video: { readyState: 2 }, async start() {}, stop() {} },
    faceTracker: tracker,
    classifier: new MockEmotionClassifier(),
    transport: { async send(events) { sent.push(...events); } },
    contextProvider: () => ({ session_id: 's1', group_id: 'G1' }),
  });
  await cap.init();
  cap.running = false;
  for (const t of [1000, 2000, 10_000]) { clock.t = t; await cap.sampleOnce(); }
  const closed = sent.find(e => ms(e.window_end) === 10_000);
  assert.ok(closed, 'window [0, 10000) closed');
  assert.ok(closed.raw_streams.affect.rows.every(r => r[0] < 10_000), 'the 10000 row waits for the next window');
  clock.t = 11_000;
  await cap.stop();
  const affect = sent.flatMap(e => e.raw_streams?.affect?.rows ?? []).map(r => r[0]);
  assert.deepEqual(affect.sort((a, b) => a - b), [1000, 2000, 10_000], 'every row sent exactly once');
});

console.log('window-integrity.test.js: ok');
