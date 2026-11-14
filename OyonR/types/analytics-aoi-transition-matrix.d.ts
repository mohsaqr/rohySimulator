/**
 * Pooling of per-window `aoi_transitions` into one labelled transition-count
 * matrix. Entropy is NOT computed here — feed `toProbabilityMatrix()` to
 * tnaj's `transitionEntropy()` (a verified port of Nestimate's
 * `transition_entropy()`), which owns that algorithm.
 */

export interface AoiTransitionMatrixResult {
  /** AOI ids, sorted, indexing both axes of `counts`. */
  labels: string[];
  /** counts[i][j] = observed transitions from labels[i] to labels[j]. */
  counts: number[][];
  /** Outgoing total per source AOI, aligned with `labels`. */
  rowTotals: number[];
  /** Total pooled transitions across all windows. */
  nTransitions: number;
  /** Windows that contributed at least one transition. */
  windows: number;
  /**
   * Whether enough transitions were pooled for an entropy estimate to mean
   * anything. Plug-in entropy is biased downward on sparse counts; ignoring
   * this flag reproduces the per-window estimate that had a 95% null interval
   * containing zero.
   */
  adequate: boolean;
  /** The floor that was applied to decide `adequate`. */
  minTransitions: number;
}

export interface AoiTransitionMatrixOptions {
  /**
   * Force the state set. Pass the configured AOI ids so a never-visited AOI
   * stays as a zero row — dropping it shrinks n and inflates every entropy
   * normalized by log(n).
   */
  labels?: string[];
  /** Override the adequacy floor (default: 5 x number of states). */
  minTransitions?: number;
}

export function aoiTransitionMatrix(
  windows: unknown[],
  options?: AoiTransitionMatrixOptions,
): AoiTransitionMatrixResult;

export interface AoiSubchain {
  /** States that participate in the chain. */
  labels: string[];
  counts: number[][];
  rowTotals: number[];
  /**
   * States pruned for having no outgoing transitions. Must be surfaced
   * alongside any normalized entropy, which divides by log(labels.length).
   */
  dropped: string[];
  nTransitions: number;
}

/**
 * Restrict the matrix to states that actually participate in the chain,
 * iteratively — pruning one state can strand another.
 *
 * Required before `transitionEntropy()`, which rejects zero-sum rows: a chain
 * with an absorbing state has no unique stationary distribution. An AOI that
 * was never looked at, or entered and never left, produces exactly that, and
 * both are ordinary rather than exotic.
 */
export function activeSubchain(matrix: AoiTransitionMatrixResult): AoiSubchain;

/**
 * Row-normalize the pooled counts. A state with no outgoing transitions keeps
 * an all-zero row rather than a uniform one: it is absorbing, and filling it
 * would invent branching that never happened. Pass `activeSubchain()` output
 * when feeding `transitionEntropy()`.
 */
export function toProbabilityMatrix(
  matrix: AoiTransitionMatrixResult | AoiSubchain,
): number[][];
