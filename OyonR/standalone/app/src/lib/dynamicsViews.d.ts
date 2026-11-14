// Types for dynamicsViews.js — the library behind /analyze/sequence.
import type { NetworkView } from './groupNetworks';
import type { NetworkErrorInfo } from './groupVarFit';
import type { Sequences, TableRow } from './patternViews';

export type DynamicsSection = 'sequences' | 'network' | 'reliability' | 'lag' | 'transfer' | 'clusters';
export declare const DYNAMICS_SECTIONS: ReadonlyArray<{ id: DynamicsSection; label: string }>;
export declare const CENTRALITY_MEASURES: ReadonlyArray<string>;
export type CommunityMethod = 'walktrap' | 'louvain' | 'leading_eigen' | 'fast_greedy' | 'label_prop' | 'edge_betweenness';
export declare const COMMUNITY_METHODS: ReadonlyArray<CommunityMethod>;
export type Dissimilarity = 'lcs' | 'hamming' | 'lv' | 'osa' | 'dl';
export declare const DISSIMILARITIES: ReadonlyArray<Dissimilarity>;
export type PAdjust = 'BH' | 'bonferroni' | 'holm' | 'none';

export declare function usableSequences(sequences: Sequences, labels?: ReadonlyArray<string> | null, opts?: { min_states?: number }): {
  sequences: (string | null)[][]; labels: string[];
};

interface Common { labels?: ReadonlyArray<string> | null; colorMap?: Record<string, string> | null }

export type PositionCut = 'p75' | 'p50' | 'p90' | 'all';
export declare const POSITION_CUTS: ReadonlyArray<{ id: PositionCut; label: string; trim: { mode: string; percentile?: number } }>;
export declare function stateColors(sequences: Sequences): Record<string, string>;

export declare function sequenceDescViews(sequences: Sequences, opts?: Common & { positions?: PositionCut }): {
  views: NetworkView[]; rows: TableRow[]; error?: NetworkErrorInfo | null;
  /** ladyna trimSummary of the cut: `label` is its description, `note` the figure line (null when nothing is cut). */
  positions: { cut: PositionCut; label: string; shown: number; longest: number; n_cut: number; note: string | null } | null;
};

export declare function networkViews(sequences: Sequences, opts?: Common & {
  measures?: ReadonlyArray<string>; community?: CommunityMethod;
}): {
  views: NetworkView[]; centralities: TableRow[]; communities: TableRow[]; n_communities: number | null;
  method_errors?: Record<string, NetworkErrorInfo>;
};

export declare function reliabilityViews(sequences: Sequences, opts?: Common & { iter?: number; cs_iter?: number; seed?: number }): {
  views: NetworkView[]; edges: TableRow[];
  cs: Array<{ measure: string; cs: number | string; cs_min: number | string; cs_max: number | string; seeds: number; reading: CSReading }>;
  counts: { edges: number; stable: number; iter: number; seed: number } | null;
};
/** ladyna csReading (Epskamp et al. 2018), re-exported. */
export type CSReading = 'stable' | 'acceptable' | 'unstable' | 'not estimable';
export declare function csReading(cs: number): CSReading;

export declare function lagViews(sequences: Sequences, opts?: Common & { lag?: number; alpha?: number; adjust?: PAdjust }): {
  views: NetworkView[]; rows: TableRow[];
  counts: { cells: number; above: number; below: number; lag: number; alpha: number; adjust: PAdjust } | null;
};

export declare function transferViews(sequences: Sequences, opts?: Common & {
  lag?: number; history?: number; iterations?: number; seed?: number; alpha?: number; adjust?: PAdjust;
}): {
  views: NetworkView[]; rows: TableRow[];
  counts: { pairs: number; significant: number; iterations: number; lag: number; history: number; alpha: number; adjust: PAdjust } | null;
  elapsed_ms: number;
};

export declare function clusterViews(sequences: Sequences, opts?: Common & {
  method?: 'mmm' | 'pam'; k?: number; ks?: number[]; dissimilarity?: Dissimilarity; n_starts?: number; seed?: number;
  /** Positions cut for the per-cluster index plots (default 'p75'). */
  positions?: PositionCut;
}): {
  views: NetworkView[]; fits: TableRow[]; assignments: TableRow[]; sizes: Array<{ cluster: string; sequences: number }>;
  /** The drawn mixture Markov fit (ladyna mmm): starts that reached its log-likelihood, starts run, convergence. */
  chosen: { starts_at_best: number; n_starts: number; converged: boolean } | null;
};
