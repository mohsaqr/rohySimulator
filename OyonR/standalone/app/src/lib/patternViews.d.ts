// Types for patternViews.js — the pattern library both Patterns pages call.
import type { NetworkView } from './groupNetworks';

export type PatternSection = 'pathways' | 'subpatterns' | 'memory' | 'trees';
export declare const PATTERN_SECTIONS: ReadonlyArray<{ id: PatternSection; label: string }>;
export declare const DEFAULT_ORDERS: ReadonlyArray<number>;

export type Sequences = ReadonlyArray<ReadonlyArray<string | null>>;
export type TableRow = Record<string, string | number>;

export declare function sequenceSummary(sequences: Sequences): {
  n_sequences: number; n_usable: number; n_states: number; alphabet: string[];
  /** ladyna describeSequences: mean states per sequence, adjacent state pairs, normalised state entropy (0–1). */
  mean_length: number; n_transitions: number; state_entropy: number;
};

export interface PathwayRow {
  rank: number; path: string; order: number; count: number;
  observed: number | null; expected: number | null; ratio: number | null;
  pAdjustedOver: number | null; pAdjustedUnder: number | null; pAdjusted: number | null;
  anomaly: 'over' | 'under' | 'normal' | null; testable: boolean | null; target: string;
}
/** ladyna kgramPathways summary: `tested` = over + under + normal; `too_few` = scored but below HYPA's minimum count. */
export interface PathwayCounts { over: number; under: number; normal: number; too_few: number; tested: number; pathways: number }

export declare function pathwayViews(sequences: Sequences, opts?: {
  orders?: ReadonlyArray<number>; min_count?: number; max_pathways?: number; alpha?: number;
  adjust?: 'BH' | 'bonferroni' | 'holm' | 'none'; gaps?: 'split' | 'drop'; anomaly?: 'all' | 'over' | 'under';
  colorMap?: Record<string, string> | null;
}): { views: NetworkView[]; rows: PathwayRow[]; counts: PathwayCounts | null; alphabet: string[] };
export declare function pathwayTable(rows: PathwayRow[]): TableRow[];

export declare function subPatternViews(sequences: Sequences, opts?: {
  short?: number[]; long?: number[]; min_freq?: number; min_support?: number; top?: number;
}): { views: NetworkView[]; tables: { short: TableRow[]; long: TableRow[] } };

export declare function memoryViews(sequences: Sequences, opts?: { max_order?: number; n_perm?: number; seed?: number }): {
  views: NetworkView[]; rows: TableRow[];
  summary: { optimal: number; bic: number; aic: number; n_sequences: number; n_observations: number } | null;
};

export declare function treeViews(sequences: Sequences, opts?: {
  max_depth?: number; min_count?: number; max_nodes?: number; top?: number; colorMap?: Record<string, string> | null;
}): { views: NetworkView[]; rows: TableRow[] };
export declare function stateColors(sequences: Sequences): Record<string, string>;
/** ladyna gapFreeRuns, re-exported: each sequence cut at missing (null/empty) states into nonempty runs. */
export { gapFreeRuns } from 'ladyna/sequences';

/** A plain reading of pathway counts that never affirms the memoryless null. */
export declare function hypaReading(counts: PathwayCounts | null, opts?: { alpha?: number }): string;
/** A plain reading of the Markov-order summary; never affirms order 1. */
export declare function memoryReading(m: { optimal: number; bic: number; aic: number; n_sequences: number; n_observations: number }): string;
