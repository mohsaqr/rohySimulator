/**
 * Coefficient K — the ambient/focal attention index (Krejtz, Duchowski &
 * Krejtz, ACM TAP 2016).
 *
 *   K = z(fixation duration) - z(amplitude of the following saccade)
 *
 * Negative: short fixations, long saccades — ambient scanning. Positive: long
 * fixations, short saccades — focal inspection.
 *
 * K is reported PER WINDOW against session-pooled moments. Pooled over every
 * fixation at once it is identically zero, because the mean of a z-score is
 * zero by construction.
 */

export interface PooledMoments {
  /** Total observations across windows. */
  n: number;
  mean: number | null;
  sd: number | null;
  /** Windows that contributed. */
  windows: number;
}

export interface MomentFields {
  mean: string;
  sd: string;
  count: string;
}

/**
 * Pool mean and SD from per-window moments:
 * sigma^2 = sum n_i(sigma_i^2 + (mu_i - mu)^2) / sum n_i.
 *
 * Exact given each window's own n, mean and SD. Estimating sigma from the
 * window means alone captures only between-window variance and inflates
 * every |K|.
 */
export function pooledMoments(windows: unknown[], fields: MomentFields): PooledMoments;

export interface WindowK {
  window_start: string | null;
  k: number;
  fixation_z: number;
  saccade_z: number;
}

export interface CoefficientKResult {
  schema_version: string;
  fixation: PooledMoments;
  saccade: PooledMoments;
  /** Windows that yielded a K value. */
  boundary_pairs: number;
  /** Readability label, not a significance test. */
  mode: 'ambient' | 'focal' | 'mixed' | null;
  k_mean: number | null;
  windows: WindowK[];
}

export function coefficientK(windows: unknown[]): CoefficientKResult;
