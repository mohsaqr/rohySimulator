import assert from 'node:assert/strict';
import {
  headPoseFromMatrix,
  actionUnitsFromBlendshapes,
  extractFacialSignals,
} from '../src/inference/FacialSignalExtractor.js';
import { FacialSignalAggregator } from '../src/aggregation/FacialSignalAggregator.js';

const IDENTITY = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

// Column-major yaw rotation about world Y (matches tests/eye-features.test.js).
function yawMatrix(degrees) {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

function blendshapes(pairs) {
  return Object.entries(pairs).map(([categoryName, score]) => ({ categoryName, score }));
}

// ── headPoseFromMatrix ──────────────────────────────────────────────
{
  const flat = headPoseFromMatrix(IDENTITY);
  assert.ok(flat, 'identity yields a pose');
  assert.ok(Math.abs(flat.pitch_deg) < 1e-6, 'identity pitch ~0');
  assert.ok(Math.abs(flat.yaw_deg) < 1e-6, 'identity yaw ~0');
  assert.ok(Math.abs(flat.roll_deg) < 1e-6, 'identity roll ~0');
  assert.equal(flat.rotation.length, 9, 'exposes 9 rotation entries');

  const turned = headPoseFromMatrix(yawMatrix(30));
  assert.ok(Math.abs(turned.yaw_deg - 30) < 1e-3, `yaw 30° recovered (got ${turned.yaw_deg})`);
  assert.ok(Math.abs(turned.pitch_deg) < 1e-3, 'yaw-only pitch ~0');

  assert.equal(headPoseFromMatrix(null), null, 'null matrix → null');
  assert.equal(headPoseFromMatrix([1, 2, 3]), null, 'short matrix → null');
}

// ── actionUnitsFromBlendshapes ──────────────────────────────────────
{
  const { blendshapes: all, action_units } = actionUnitsFromBlendshapes(
    blendshapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0.6, browDownLeft: 0.4, browDownRight: 0.2, jawOpen: 0.5 }),
  );
  assert.ok(Math.abs(action_units.smile - 0.7) < 1e-9, 'smile = mean(0.8,0.6)=0.7');
  assert.ok(Math.abs(action_units.brow_furrow - 0.3) < 1e-9, 'brow_furrow = mean(0.4,0.2)=0.3');
  assert.ok(Math.abs(action_units.jaw_open - 0.5) < 1e-9, 'jaw_open passthrough');
  assert.ok(Math.abs(action_units.mouth_open - 0.5) < 1e-9, 'mouth_open = jawOpen, not jawOpen/2');
  assert.equal(all.mouthSmileLeft, 0.8, 'raw blendshape retained');
  assert.equal(action_units.frown, 0, 'missing names contribute 0');

  const empty = actionUnitsFromBlendshapes([]);
  assert.equal(empty.action_units.smile, 0, 'no blendshapes → 0 units');
}

// ── extractFacialSignals ────────────────────────────────────────────
{
  assert.equal(extractFacialSignals({ facePresent: false }), null, 'no face → null');
  assert.equal(extractFacialSignals(null), null, 'null → null');

  const s = extractFacialSignals({
    facePresent: true,
    transformationMatrix: yawMatrix(5),
    blendshapes: blendshapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
  }, { facial_frontal_half_angle_deg: 20 });
  assert.ok(s.head_pose, 'has head pose');
  assert.equal(s.facing_screen, true, '5° yaw within 20° cone → facing');
  assert.ok(Math.abs(s.action_units.smile - 0.9) < 1e-9, 'smile surfaced');
  assert.equal(s.valid, true, 'pose present → valid');

  const away = extractFacialSignals({
    facePresent: true,
    transformationMatrix: yawMatrix(45),
    blendshapes: [],
  }, { facial_frontal_half_angle_deg: 20 });
  assert.equal(away.facing_screen, false, '45° yaw outside 20° cone → not facing');
}

// ── FacialSignalAggregator ──────────────────────────────────────────
{
  const agg = new FacialSignalAggregator({ windowMs: 10000, sampleIntervalMs: 1000 });
  const base = 1_000_000;
  // Three frames: yaw 0, 10, 20 (facing at 0/10, not at 20 for a 15° cone).
  const yaws = [0, 10, 20];
  for (let i = 0; i < yaws.length; i += 1) {
    const sample = extractFacialSignals({
      facePresent: true,
      transformationMatrix: yawMatrix(yaws[i]),
      blendshapes: blendshapes({ mouthSmileLeft: 0.2 * i, mouthSmileRight: 0.2 * i }),
    }, { facial_frontal_half_angle_deg: 15 });
    const out = agg.consumeFrame(sample, base + i * 1000);
    assert.equal(out, null, 'no auto-flush before windowMs');
  }
  const win = agg.flush(base + 3000);
  assert.ok(win, 'flush returns a window');
  assert.equal(win.total_frames, 3, '3 frames');
  assert.equal(win.valid_frames, 3, '3 valid poses');
  assert.ok(Math.abs(win.head_pose_mean.yaw_deg - 10) < 1e-3, `mean yaw ~10 (got ${win.head_pose_mean.yaw_deg})`);
  assert.ok(win.head_pose_std.yaw_deg > 0, 'yaw std > 0');
  assert.ok(win.head_movement_deg > 0, 'movement > 0 across changing yaw');
  // facing at yaw 0 and 10 (≤15), not at 20 → 2/3.
  assert.ok(Math.abs(win.facing_screen_ratio - 2 / 3) < 1e-9, `facing ratio 2/3 (got ${win.facing_screen_ratio})`);
  assert.ok(win.action_units_mean.smile > 0, 'mean smile surfaced');
  assert.ok(win.blendshapes_mean.mouthSmileLeft > 0, 'all blendshapes averaged & exposed');
  assert.equal(typeof win.model_version, 'string', 'model_version present');

  // Empty aggregator flush is null.
  assert.equal(new FacialSignalAggregator().flush(), null, 'empty flush → null');
}

console.log('facial-signals.test.js — all cases passed');
