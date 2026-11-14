/**
 * The affect-dynamics triad over a window series: variability (within-person
 * SD), instability (RMSSD) and inertia (lag-1 autocorrelation).
 *
 * Report all three. At constant variability, instability and inertia are
 * arithmetically inverse, so either one alone is ambiguous — that ambiguity is
 * the inertia-instability paradox. A useful summary is the ratio
 * instability / variability: it approaches sqrt(2) for independent noise and
 * falls toward 0 for a slow drift.
 */

export interface ChannelDynamics {
  /** Usable observations. */
  n: number;
  /** Adjacent pairs that survived the gap check. */
  n_pairs: number;
  /** Pairs rejected as non-adjacent in time. */
  pairs_dropped: number;
  mean: number | null;
  /** Within-person SD. */
  variability: number | null;
  /** RMSSD. */
  instability: number | null;
  /** Lag-1 autocorrelation, in [-1, 1]. Null for a flat series. */
  inertia: number | null;
}

export interface AffectDynamicsOptions {
  /** Label -> window field name. Default: valence and arousal. */
  channels?: Record<string, string>;
  /**
   * A pair spaced further than this multiple of the median spacing is not
   * treated as successive. Successive-difference measures assume even
   * sampling; a paused session violates that and inflates RMSSD.
   */
  gapTolerance?: number;
}

export interface AffectDynamicsResult {
  schema_version: string;
  /** Median inter-window spacing, ms. */
  spacing_ms: number | null;
  channels: Record<string, ChannelDynamics>;
}

/** @deprecated Use `seriesDynamics(values, { times })` from `ladyna/stats` (R-checked). */
export function affectDynamics(
  windows: unknown[],
  options?: AffectDynamicsOptions,
): AffectDynamicsResult;
