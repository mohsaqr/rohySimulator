/**
 * EyeSmoother — Stage 3 of the eye-tracking pipeline.
 *
 * Mirrors the shape of `PredictionSmoother`: a stateful per-frame smoother
 * that consumes the per-frame `EyeFeatures` object produced by
 * `extractEyeFeatures` (see `src/inference/EyeFeatureExtractor.js`) and emits
 * a smoothed sibling shape suitable for the downstream Stage 4 aggregator.
 *
 * Smoothing rules:
 *   - EWMA on the continuous scalars: `eye_openness_l`, `eye_openness_r`, and
 *     each available component of `iris_offset_normalized.{l,r}.{x,y}`.
 *   - On the first valid sample for a given component, state is initialized
 *     to that value (no blending).
 *   - A frame with `valid === false` is passed through (returned as a shallow
 *     clone filled from current state) but does NOT advance any state.
 *   - An iris offset of `null` for an eye (blink-masked on that side) does
 *     not advance that eye's EWMA accumulator. The other eye still updates.
 *   - `gaze_zone` is stabilized by a hold-time + switch-votes state machine:
 *     a new candidate zone only becomes visible after `gazeZoneMinHoldMs`
 *     have elapsed since the last visible-zone change AND
 *     `gazeZoneMinSwitchVotes` consecutive frames have observed it.
 *   - A `null` `gaze_zone` on an input frame does not advance or reset the
 *     gaze-zone state machine.
 */

export class EyeSmoother {
  constructor(options = {}) {
    this.options = {
      alpha: 0.3,
      gazeZoneMinHoldMs: 400,
      gazeZoneMinSwitchVotes: 2,
      ...options,
    };
    this._initState();
  }

  _initState() {
    this.openness_l = null;
    this.openness_r = null;
    this.offset_l = null; // { x, y } | null
    this.offset_r = null; // { x, y } | null
    this.visibleZone = null;
    this.visibleSince = 0;
    this.candidateZone = null;
    this.candidateStreak = 0;
  }

  reset() {
    this._initState();
  }

  update(eyeFeatures, timestamp = Date.now()) {
    if (eyeFeatures == null) return null;

    // Invalid frame: passthrough shape, do not advance any state.
    if (eyeFeatures.valid === false) {
      return {
        ...eyeFeatures,
        eye_openness_l: this.openness_l != null ? this.openness_l : eyeFeatures.eye_openness_l,
        eye_openness_r: this.openness_r != null ? this.openness_r : eyeFeatures.eye_openness_r,
        iris_offset_normalized: {
          l: this.offset_l ? { x: this.offset_l.x, y: this.offset_l.y } : null,
          r: this.offset_r ? { x: this.offset_r.x, y: this.offset_r.y } : null,
        },
        gaze_zone: this.visibleZone != null ? this.visibleZone : eyeFeatures.gaze_zone ?? null,
        raw: eyeFeatures,
        smoothed: false,
      };
    }

    const alpha = this.options.alpha;

    // EWMA on the two openness scalars.
    this.openness_l = ewmaScalar(this.openness_l, eyeFeatures.eye_openness_l, alpha);
    this.openness_r = ewmaScalar(this.openness_r, eyeFeatures.eye_openness_r, alpha);

    // EWMA on iris offsets, per-component. A null offset for an eye leaves that
    // eye's accumulator untouched.
    const inputOffset = eyeFeatures.iris_offset_normalized || { l: null, r: null };
    this.offset_l = ewmaOffset(this.offset_l, inputOffset.l, alpha);
    this.offset_r = ewmaOffset(this.offset_r, inputOffset.r, alpha);

    // Gaze-zone state machine.
    this._updateGazeZone(eyeFeatures.gaze_zone, timestamp);

    // Reported iris offset: null if THIS frame's input was null for that eye
    // (don't pretend to smooth a missing eye), otherwise the EWMA state.
    const reportedL = inputOffset.l && this.offset_l
      ? { x: this.offset_l.x, y: this.offset_l.y }
      : null;
    const reportedR = inputOffset.r && this.offset_r
      ? { x: this.offset_r.x, y: this.offset_r.y }
      : null;

    return {
      ...eyeFeatures,
      eye_openness_l: this.openness_l,
      eye_openness_r: this.openness_r,
      iris_offset_normalized: {
        l: reportedL,
        r: reportedR,
      },
      gaze_zone: this.visibleZone != null ? this.visibleZone : eyeFeatures.gaze_zone ?? null,
      raw: eyeFeatures,
      smoothed: true,
    };
  }

  _updateGazeZone(incomingZone, timestamp) {
    // Null input does not advance or reset zone state.
    if (incomingZone == null) return;

    // First-ever zone: initialize visible state directly.
    if (this.visibleZone == null) {
      this.visibleZone = incomingZone;
      this.visibleSince = timestamp;
      this.candidateZone = null;
      this.candidateStreak = 0;
      return;
    }

    // Incoming matches the visible zone: reset the candidate streak.
    if (incomingZone === this.visibleZone) {
      this.candidateZone = null;
      this.candidateStreak = 0;
      return;
    }

    // Incoming differs from visible. Track candidate streak.
    if (incomingZone === this.candidateZone) {
      this.candidateStreak += 1;
    } else {
      this.candidateZone = incomingZone;
      this.candidateStreak = 1;
    }

    const heldLongEnough = (timestamp - this.visibleSince) >= this.options.gazeZoneMinHoldMs;
    const votedEnough = this.candidateStreak >= this.options.gazeZoneMinSwitchVotes;
    if (heldLongEnough && votedEnough) {
      this.visibleZone = this.candidateZone;
      this.visibleSince = timestamp;
      this.candidateZone = null;
      this.candidateStreak = 0;
    }
  }
}

function ewmaScalar(previous, next, alpha) {
  if (!Number.isFinite(next)) return previous;
  if (previous == null || !Number.isFinite(previous)) return next;
  return previous * (1 - alpha) + next * alpha;
}

function ewmaOffset(previous, next, alpha) {
  // `next` can be null (blink-masked eye on this frame) — don't poison state.
  if (!next) return previous;
  const nx = next.x;
  const ny = next.y;
  const out = previous ? { x: previous.x, y: previous.y } : { x: null, y: null };
  if (Number.isFinite(nx)) {
    out.x = (out.x == null || !Number.isFinite(out.x)) ? nx : out.x * (1 - alpha) + nx * alpha;
  }
  if (Number.isFinite(ny)) {
    out.y = (out.y == null || !Number.isFinite(out.y)) ? ny : out.y * (1 - alpha) + ny * alpha;
  }
  // If neither component was ever set, treat as null.
  if (out.x == null && out.y == null) return previous;
  return out;
}
