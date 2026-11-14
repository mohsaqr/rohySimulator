// One camera, several people: IoU track association (identity survives
// MediaPipe's face reordering), SORT-style lifecycle, seats, and
// MultiFaceCapture emitting per-track windows that groupTimeline reads.
import assert from 'node:assert/strict';
import { FaceTrackAssigner, iou } from '../src/capture/FaceTrackAssigner.js';
import { MultiFaceCapture } from '../src/core/MultiFaceCapture.js';
import { groupTimeline } from '../src/group/timeline.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

const box = (x, y = 0.2, w = 0.2, h = 0.3) => ({ x, y, width: w, height: h });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} vs ${b}`);

// ---------- iou: hand-computed ----------
{
  // a = [0,0,2,2], b = [1,1,2,2] (as x,y,w,h) → inter 1, union 4 + 4 − 1 = 7.
  near(iou({ x: 0, y: 0, width: 2, height: 2 }, { x: 1, y: 1, width: 2, height: 2 }), 1 / 7, 'hand-computed');
  assert.equal(iou(box(0), box(0.5)), 0, 'disjoint');
  near(iou(box(0.1), box(0.1)), 1, 'identical');
  assert.equal(iou(null, box(0)), 0);
}

// ---------- identity survives reordering; lifecycle; seats ----------
{
  const tr = new FaceTrackAssigner({ confirmHits: 3, coastMs: 2000 });
  const L = (dx = 0) => ({ bbox: box(0.1 + dx), who: 'L' });
  const R = (dx = 0) => ({ bbox: box(0.6 + dx), who: 'R' });
  const f1 = tr.update([L(), R()], 0);
  assert.deepEqual(f1.map(o => [o.track_id, o.status, o.face.who]), [['t1', 'tentative', 'L'], ['t2', 'tentative', 'R']], 'equal-size births are numbered left to right');
  const idOf = (out, who) => out.find(o => o.face.who === who).track_id;
  const idL = idOf(f1, 'L'); const idR = idOf(f1, 'R');
  // MediaPipe reorders the array every frame; small drift each frame.
  const f2 = tr.update([R(0.01), L(0.01)], 1000);
  const f3 = tr.update([L(0.02), R(0.015)], 2000);
  assert.equal(idOf(f2, 'L'), idL); assert.equal(idOf(f3, 'L'), idL);
  assert.equal(idOf(f3, 'R'), idR);
  assert.ok(f3.every(o => o.status === 'confirmed'), 'confirmed after 3 consecutive hits');
  assert.deepEqual(tr.seats(), { [idL]: 'left', [idR]: 'right' });
  assert.equal(f3.find(o => o.track_id === idL).seat, 'left');
  // R leaves: coasts within coastMs, dies after.
  tr.update([L(0.02)], 3000);
  assert.equal(tr.status().length, 2, 'R coasts');
  tr.update([L(0.02)], 5100);
  assert.deepEqual(tr.status().map(t => t.track_id), [idL], 'R died after 2 s unmatched');
  assert.equal(tr.retired[0].track_id, idR);
  // R returns: a NEW track — ids are never reused (no re-identification).
  const back = tr.update([L(0.02), R()], 6000);
  assert.ok(!back.map(o => o.track_id).includes(idR));
  // A tentative track that misses one frame is dropped, not coasted.
  tr.update([L(0.02)], 7000);
  assert.deepEqual(tr.status().map(t => t.track_id), [idL]);
}

// ---------- invariant: input order never changes the assignment ----------
{
  const faces = [{ bbox: box(0.05), k: 'a' }, { bbox: box(0.4), k: 'b' }, { bbox: box(0.7), k: 'c' }];
  const run = (order) => {
    const tr = new FaceTrackAssigner({ confirmHits: 1 });
    tr.update(order.map(i => faces[i]), 0);
    return tr.update([faces[2], faces[0], faces[1]], 1000).map(o => `${o.face.k}:${o.seat}`).sort().join();
  };
  assert.equal(run([0, 1, 2]), run([2, 1, 0]));
  assert.equal(run([0, 1, 2]), 'a:left,b:center,c:right');
}

// ---------- invariant: births do not depend on the detector's array order ----------
{
  const a = new FaceTrackAssigner().update([{ bbox: box(0.6), k: 'R' }, { bbox: box(0.1), k: 'L' }], 0);
  const b = new FaceTrackAssigner().update([{ bbox: box(0.1), k: 'L' }, { bbox: box(0.6), k: 'R' }], 0);
  assert.deepEqual(a.map(o => `${o.track_id}:${o.face.k}`), b.map(o => `${o.track_id}:${o.face.k}`));
}

// ---------- cap: largest faces first ----------
{
  const tr = new FaceTrackAssigner({ maxFaces: 2, confirmHits: 1 });
  const out = tr.update([{ bbox: box(0, 0, 0.1, 0.1), k: 'small' }, { bbox: box(0.3, 0, 0.3, 0.3), k: 'big' }, { bbox: box(0.7, 0, 0.2, 0.2), k: 'mid' }], 0);
  assert.deepEqual(out.map(o => o.face.k).sort(), ['big', 'mid']);
}

// ---------- MultiFaceCapture end to end ----------
{
  const realNow = Date.now;
  let clock = Date.UTC(2026, 0, 1);
  Date.now = () => clock;
  try {
    let frame = 0;
    // Two faces whose array order flips every frame; one leaves for 5 s mid-session.
    const tracker = {
      async init() {},
      async analyzeAll() {
        frame += 1;
        const left = { facePresent: true, bbox: box(0.1), landmarks: [], quality: { faceAreaRatio: 0.06 }, transformationMatrix: null };
        const right = { facePresent: true, bbox: box(0.6), landmarks: [], quality: { faceAreaRatio: 0.06 } };
        const gone = frame >= 12 && frame < 17;
        const faces = gone ? [left] : [left, right];
        return frame % 2 ? faces : faces.reverse();
      },
    };
    // The classifier sees the crop: left person is happy (+0.6), right is sad (−0.4).
    const classifier = {
      async init() {},
      async classify(_video, { bbox }) {
        const leftSide = bbox.x < 0.5;
        return {
          probabilities: leftSide ? { happy: 0.9, sad: 0.1 } : { happy: 0.1, sad: 0.9 },
          valence: leftSide ? 0.6 : -0.4, arousal: 0.1, confidence: 0.9, entropy: 0.3, model: { name: 'mock', version: 'x' },
        };
      },
    };
    const batches = [];
    const mf = new MultiFaceCapture({
      settings: { sample_interval_ms: 1000, aggregate_window_ms: 5000, min_valid_frames: 1, window_anchor_ms: clock, multi_face_confirm_hits: 2 },
      camera: { video: { readyState: 2 }, async start() {}, stop() {} },
      faceTracker: tracker,
      classifier,
      transport: { async send(events) { batches.push(events); } },
      contextProvider: () => ({ group_id: 'G1', session_id: 's1', member_id: 'host-wide-should-not-win' }),
      memberMap: { t1: 'm_left', t2: 'm_right' },
    });
    for (let i = 0; i < 30; i += 1) { await mf.sampleOnce(); clock += 1000; }
    await mf.stop();
    const events = batches.flat();
    const members = [...new Set(events.map(e => e.member_id))].sort();
    // t1/t2 are the first pair; the right person's return after 5 s is a new track (t3).
    assert.deepEqual(members, ['m_left', 'm_right', 't3']);
    for (const e of events) {
      assert.equal(e.group_id, 'G1');
      assert.equal(e.capture_setup, 'one_camera_multi_face');
      assert.ok(e.raw_streams?.affect, 'per-track raw streams');
      assert.equal((Date.parse(e.window_start) - Date.UTC(2026, 0, 1)) % 5000, 0, 'anchored grid');
    }
    // Identity held through the reordering: every left window is happy, every right one sad.
    for (const e of events.filter(x => x.dominant_emotion)) {
      assert.equal(e.dominant_emotion, e.member_id === 'm_left' ? 'happy' : 'sad', `${e.member_id} ${e.window_start}`);
    }
    assert.equal(events.find(e => e.member_id === 'm_left').seat, 'left');
    assert.deepEqual(validateEmotionBatch({ events }).errors, []);
    // The coasting gap is recorded as missing, not filled.
    const tl = groupTimeline({ windows: events, channels: ['valence'], normalize: 'none' });
    const right = tl.filter(r => r.member_id === 'm_right');
    assert.ok(right.some(r => r.value !== null && Math.abs(r.value + 0.4) < 1e-12));
    assert.ok(right.some(r => r.value === null), 'gap while the right person was away');
    assert.ok(tl.filter(r => r.member_id === 'm_left' && r.value !== null).every(r => Math.abs(r.value - 0.6) < 1e-12));
  } finally {
    Date.now = realNow;
  }
}

console.log('multi-face.test.js passed');
