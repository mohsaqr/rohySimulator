/**
 * GazeSmoother — Stage 2 of the screen-point gaze pipeline.
 *
 * EWMA smoother for the noisy per-frame `GazeSample` stream emitted by the
 * `WebEyeTrackAdapter`. Mirrors the shape and rules of `EyeSmoother`:
 *
 *   - First valid sample initializes state with no blending.
 *   - Subsequent valid samples blend with exponential weight `alpha`.
 *   - Below-quality samples (`sample.quality < minQualityScore`) pass through
 *     with `smoothed: false`; smoother state is NOT advanced. Downstream
 *     aggregation can still count them via `valid_frame_ratio`.
 *   - `gaze_state === 'closed'` samples (blinks) pass through with
 *     `smoothed: false`; state is not advanced.
 *   - Invalid samples (`valid: false`) pass through; state is not advanced.
 *
 * The smoother is intentionally per-axis (x, y separately) but with a single
 * `alpha` — the gaze regressor's output is already low-pass filtered upstream
 * (BlazeGaze uses a Kalman filter), so heavy EWMA would lag saccades.
 *
 * Output shape mirrors the input `GazeSample` plus:
 *   - `smoothed: boolean`  — did this frame advance EWMA state?
 *   - `raw: GazeSample`    — original sample, for downstream debugging only;
 *                            aggregator does not persist this.
 */

export class GazeSmoother {
  constructor(options = {}) {
    this.options = {
      alpha: 0.5,
      minQualityScore: 0.3,
      ...options,
    };
    this._initState();
  }

  _initState() {
    this.x = null;
    this.y = null;
    this._initialized = false;
  }

  reset() {
    this._initState();
  }

  /**
   * @param {GazeSample} sample
   * @returns {SmoothedGazeSample | null}
   */
  update(sample) {
    if (sample == null) return null;

    const passthrough = (smoothed) => ({
      ...sample,
      x: this._initialized ? this.x : sample.x,
      y: this._initialized ? this.y : sample.y,
      raw: sample,
      smoothed,
    });

    // Blinks and below-quality samples: state untouched, passthrough.
    if (sample.gaze_state === 'closed') return passthrough(false);
    if (!Number.isFinite(sample.quality) || sample.quality < this.options.minQualityScore) {
      return passthrough(false);
    }
    if (sample.valid === false) return passthrough(false);
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return passthrough(false);

    // Advance EWMA state.
    if (!this._initialized) {
      this.x = sample.x;
      this.y = sample.y;
      this._initialized = true;
    } else {
      const a = this.options.alpha;
      this.x = this.x * (1 - a) + sample.x * a;
      this.y = this.y * (1 - a) + sample.y * a;
    }

    return {
      ...sample,
      x: this.x,
      y: this.y,
      raw: sample,
      smoothed: true,
    };
  }
}
