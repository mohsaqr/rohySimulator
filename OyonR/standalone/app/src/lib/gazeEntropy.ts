import { transitionEntropy } from 'legacy-tnaj';
import {
  aoiTransitionMatrix,
  activeSubchain,
  toProbabilityMatrix,
} from 'oyon/analytics/aoi-transition-matrix';

/*
 * Gaze transition entropy — the app-side half of the boundary.
 *
 * Oyon pools its own `aoi_transitions` into a labelled matrix; tnaj computes
 * the entropy from it. Neither library reaches into the other's territory,
 * which is the contract in ARCHITECTURE.md: Oyon senses, the network packages
 * own network algorithms.
 *
 * `transitionEntropy()` is tnaj's verified port of Nestimate's
 * `transition_entropy()` (R/transition_entropy.R), which implements Krejtz et
 * al. (2015) gaze transition entropy and the 2025 ETRA real-time transition
 * matrix entropy. It returns considerably more than the two scalars a
 * hand-rolled version would:
 *
 *   entropyRate   h(P) = Σ πᵢ H(Pᵢ·)   per-step uncertainty of the scanpath
 *   stationary    π from the eigenvector of Pᵀ, not observed occupancy
 *   redundancy    H(π) − h(P), the order-1 memory deficit
 *   rowEntropy    per-AOI branching entropy — WHERE the uncertainty sits
 *
 * `redundancy` is the one to lead with. It is zero for a memoryless scanpath
 * and rises as the next AOI becomes predictable from the current one, so it
 * answers "is this gaze pattern structured?" in a single normalized number —
 * whereas h(P) and H(π) are only interpretable as a pair.
 */

export interface GazeEntropy {
  /** False when too few transitions were pooled; every figure below is then unreliable. */
  adequate: boolean;
  nTransitions: number;
  /** Windows that contributed at least one transition. */
  windows: number;
  /** The states the entropy was actually computed over. */
  labels: string[];
  /**
   * AOIs excluded because they had no outgoing transitions — never looked at,
   * or entered and never left. Entropy over 2 of 5 AOIs is a different
   * quantity from entropy over 5, and every `*Norm` figure divides by
   * log(labels.length), so this must be shown wherever those are shown.
   */
  droppedStates: string[];
  /** Set when no figure could be produced. Never fails silently. */
  error: string | null;
  /** h(P), bits per transition. */
  entropyRate: number | null;
  entropyRateNorm: number | null;
  /** H(π), bits. */
  stationaryEntropy: number | null;
  stationaryEntropyNorm: number | null;
  /** H(π) − h(P), bits. Zero for a memoryless scanpath. */
  redundancy: number | null;
  /** (H(π) − h(P)) / H(π), in [0, 1]. */
  redundancyNorm: number | null;
  /** Per-AOI branching entropy, aligned with `labels`. */
  rowEntropy: number[];
  /** Stationary distribution, aligned with `labels`. */
  stationary: number[];
}

const EMPTY: GazeEntropy = {
  adequate: false,
  nTransitions: 0,
  windows: 0,
  labels: [],
  droppedStates: [],
  error: null,
  entropyRate: null,
  entropyRateNorm: null,
  stationaryEntropy: null,
  stationaryEntropyNorm: null,
  redundancy: null,
  redundancyNorm: null,
  rowEntropy: [],
  stationary: [],
};

/**
 * Pool the windows and compute the entropy suite.
 *
 * @param windows Window records carrying a `gaze` block.
 * @param aoiIds  The configured AOI ids. Pass them so an AOI that was never
 *                looked at stays in the state space as a zero row — dropping
 *                it shrinks n and inflates every measure normalized by log(n).
 */
export function gazeEntropy(windows: unknown[], aoiIds?: string[]): GazeEntropy {
  const matrix = aoiTransitionMatrix(windows, aoiIds ? { labels: aoiIds } : {});

  // Reporting the shape even when it is unusable: a caller needs to know
  // whether it got nothing because sensing was off or because the scanpath
  // was too short, and those look identical if this returns a bare null.
  const shape = {
    ...EMPTY,
    adequate: matrix.adequate,
    nTransitions: matrix.nTransitions,
    windows: matrix.windows,
    labels: matrix.labels,
  };
  if (matrix.labels.length < 2 || matrix.nTransitions === 0) {
    return { ...shape, error: 'no AOI transitions were recorded' };
  }

  /*
   * Prune before the entropy call. An AOI that was never looked at, or entered
   * and never left, leaves a zero-sum row, and `transitionEntropy()` rejects
   * those — a chain with an absorbing state has no unique stationary
   * distribution. Both cases are ordinary, not exotic, so this is the normal
   * path rather than error handling.
   */
  const chain = activeSubchain(matrix);
  const shapeWithChain = {
    ...shape,
    labels: chain.labels,
    droppedStates: chain.dropped,
    nTransitions: chain.nTransitions,
  };
  if (chain.labels.length < 2) {
    return {
      ...shapeWithChain,
      error: 'the scanpath never left an AOI often enough to form a chain',
    };
  }

  try {
    const result = transitionEntropy(toProbabilityMatrix(chain), { base: 2 });
    return {
      ...shapeWithChain,
      entropyRate: finite(result.entropyRate),
      entropyRateNorm: finite(result.entropyRateNorm),
      stationaryEntropy: finite(result.stationaryEntropy),
      stationaryEntropyNorm: finite(result.stationaryEntropyNorm),
      redundancy: finite(result.redundancy),
      redundancyNorm: finite(result.redundancyNorm),
      rowEntropy: Array.isArray(result.rowEntropy) ? result.rowEntropy : [],
      stationary: Array.isArray(result.stationary) ? result.stationary : [],
    };
  } catch (cause) {
    /*
     * A reducible chain can still defeat the stationary solve after pruning.
     * Degrade rather than crash the screen — but SURFACE the reason. An
     * earlier version swallowed this, which meant a whole panel could go blank
     * for a routine scanpath with nothing to say why.
     */
    return {
      ...shapeWithChain,
      error: cause instanceof Error ? cause.message : 'entropy could not be computed',
    };
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
