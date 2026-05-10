/**
 * Matrix class wrapping Float64Array with row-major layout.
 * Designed for small matrices (typically 9x9 to ~30x30) used in TNA.
 */
declare class Matrix {
    readonly data: Float64Array;
    readonly rows: number;
    readonly cols: number;
    constructor(rows: number, cols: number, data?: Float64Array | number[]);
    /** Create from a 2D array. */
    static from2D(arr: number[][]): Matrix;
    /** Create a matrix filled with a value. */
    static fill(rows: number, cols: number, value: number): Matrix;
    /** Create a zero matrix. */
    static zeros(rows: number, cols: number): Matrix;
    /** Get element at (i, j). */
    get(i: number, j: number): number;
    /** Set element at (i, j). */
    set(i: number, j: number, value: number): void;
    /** Deep copy. */
    clone(): Matrix;
    /** Convert to 2D array. */
    to2D(): number[][];
    /** Transpose. */
    transpose(): Matrix;
    /** Scalar multiply. */
    scale(s: number): Matrix;
    /** Element-wise apply. */
    map(fn: (value: number, i: number, j: number) => number): Matrix;
    /** Sum of all elements. */
    sum(): number;
    /** Row sums as array. */
    rowSums(): Float64Array;
    /** Column sums as array. */
    colSums(): Float64Array;
    /** Get diagonal as array. */
    diag(): Float64Array;
    /** Set diagonal values. */
    setDiag(value: number): Matrix;
    /** Max element. */
    max(): number;
    /** Min element. */
    min(): number;
    /** Count elements matching a predicate. */
    count(predicate: (v: number) => boolean): number;
    /** Flatten to array in row-major order. */
    flatten(): Float64Array;
    /** Get a row as array. */
    row(i: number): Float64Array;
    /** Get a column as array. */
    col(j: number): Float64Array;
    /** Is square? */
    get isSquare(): boolean;
    /** Mean of non-zero elements. */
    meanNonZero(): number;
}
/** Row normalize a matrix (each row sums to 1). */
declare function rowNormalize(mat: Matrix): Matrix;
/** Min-max normalization to [0, 1]. */
declare function minmaxScale(mat: Matrix): Matrix;
/** Divide by maximum value. */
declare function maxScale(mat: Matrix): Matrix;
/** Convert to ranks (1-based, average ties). */
declare function rankScale(mat: Matrix): Matrix;
/** Apply one or more scaling methods to a matrix. */
declare function applyScaling(mat: Matrix, scaling: string | string[] | null | undefined): {
    weights: Matrix;
    applied: string[];
};

/**
 * Core type definitions for dynajs.
 */

/** A sequence is a row of string tokens (states), possibly with null for missing. */
type Sequence = (string | null)[];
/** A sequence dataset: array of sequences. */
type SequenceData = Sequence[];
/**
 * TNA model type identifiers.
 * - 'relative': Row-normalized transition probabilities
 * - 'frequency': Raw transition counts
 * - 'co-occurrence': Bidirectional co-occurrence
 * - 'attention': Exponential decay weighted
 * - 'matrix': Direct matrix input
 */
type ModelType = 'relative' | 'frequency' | 'co-occurrence' | 'attention' | 'matrix';
/** Parameters for specific model types. */
interface TransitionParams {
    /** Decay parameter for attention model. Default 0.1. */
    beta?: number;
}
/** Options for building a TNA model. */
interface BuildModelOptions {
    type?: ModelType;
    scaling?: string | string[] | null;
    labels?: string[];
    beginState?: string;
    endState?: string;
    params?: TransitionParams;
}
/** TNA model. */
interface TNA {
    /** Adjacency/transition matrix (n_states x n_states). */
    weights: Matrix;
    /** Initial state probabilities (n_states). */
    inits: Float64Array;
    /** State labels. */
    labels: string[];
    /** Original sequence data (if built from sequences). */
    data: SequenceData | null;
    /** Model type. */
    type: ModelType;
    /** Scaling methods applied. */
    scaling: string[];
    /** Transition parameters (e.g. beta for attention model). */
    params?: TransitionParams;
}
/** GroupTNA: mapping from group name to TNA model. */
interface GroupTNA {
    models: Record<string, TNA>;
}
/** Centrality measure names. */
type CentralityMeasure = 'InStrength' | 'OutStrength' | 'Closeness' | 'Betweenness';
/** Centrality result: map from state label to measure values. */
interface CentralityResult {
    labels: string[];
    measures: Record<CentralityMeasure, Float64Array>;
    /** Optional group column for GroupTNA results. */
    groups?: string[];
}
/** Cluster result. */
interface ClusterResult {
    data: SequenceData;
    k: number;
    assignments: number[];
    silhouette: number;
    sizes: number[];
    method: string;
    distance: Matrix;
    dissimilarity: string;
}
/** Prepared data container. */
interface TNAData {
    sequenceData: SequenceData;
    labels: string[];
    statistics: {
        nSessions: number;
        nUniqueActions: number;
        uniqueActions: string[];
        maxSequenceLength: number;
        meanSequenceLength: number;
    };
}
/** Community detection result. */
interface CommunityResult {
    labels: string[];
    /** Community index (0-based) per node. */
    assignments: number[];
    /** Final modularity score. */
    modularity: number;
    /** Number of communities found. */
    nCommunities: number;
}
/** Layout algorithm names. */
type LayoutAlgorithm = 'spring' | 'fr' | 'circle' | 'grid' | 'spectral' | 'kamada-kawai' | 'star' | 'hierarchical' | 'concentric' | 'community' | 'random';
/** Force-directed layout result. */
interface LayoutResult {
    x: Float64Array;
    y: Float64Array;
    labels: string[];
}
/** Degree distribution per node. */
interface DegreeDistribution {
    /** Count of incoming edges per node (unweighted). */
    inDegree: Float64Array;
    /** Count of outgoing edges per node (unweighted). */
    outDegree: Float64Array;
    /** inDegree + outDegree. */
    totalDegree: Float64Array;
    labels: string[];
}

/**
 * TNA model class and build functions.
 */

/** Create a TNA model object. */
declare function createTNA(weights: Matrix, inits: Float64Array, labels: string[], data?: SequenceData | null, type?: ModelType, scaling?: string[], params?: TransitionParams): TNA;
/**
 * Build a TNA model from data.
 */
declare function buildModel(x: SequenceData | TNAData | number[][], options?: BuildModelOptions): TNA;
/** Build a relative transition probability model. */
declare function tna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type' | 'params'>): TNA;
/** Build a frequency-based transition model. */
declare function ftna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type' | 'params'>): TNA;
/** Build a co-occurrence transition model. */
declare function ctna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type'>): TNA;
/** Build an attention-weighted transition model. */
declare function atna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type'> & {
    beta?: number;
}): TNA;
/** Get a summary of the TNA model. */
declare function summary(model: TNA): Record<string, unknown>;

/**
 * Data preparation functions.
 */

/**
 * Create sequence data from a 2D string array (wide format).
 * Extracts unique state labels and optionally adds begin/end states.
 */
declare function createSeqdata(data: SequenceData, options?: {
    beginState?: string;
    endState?: string;
}): {
    data: SequenceData;
    labels: string[];
};
/**
 * Parse wide-format data into a TNAData object.
 */
declare function prepareData(data: SequenceData, options?: {
    beginState?: string;
    endState?: string;
}): TNAData;

/**
 * Transition computation algorithms.
 * Supports 4 model types: relative, frequency, co-occurrence, attention.
 */

/**
 * Compute transition matrix and initial probabilities from sequence data.
 */
declare function computeTransitions(data: SequenceData, states: string[], type?: ModelType, params?: TransitionParams): {
    weights: Matrix;
    inits: Float64Array;
};
/** Process an existing weight/count matrix. */
declare function computeWeightsFromMatrix(mat: Matrix, type?: ModelType): Matrix;

/** Check if an object is a GroupTNA (duck typing). */
declare function isGroupTNA(x: unknown): x is GroupTNA;
/** Create a GroupTNA from a models record. */
declare function createGroupTNA(models: Record<string, TNA>): GroupTNA;
/** Get group names. */
declare function groupNames(g: GroupTNA): string[];
/** Iterate over groups. */
declare function groupEntries(g: GroupTNA): [string, TNA][];
/** Apply a function to each group model. */
declare function groupApply<T>(g: GroupTNA, fn: (model: TNA, name: string) => T): Record<string, T>;
/** Rename groups. */
declare function renameGroups(g: GroupTNA, newNames: string[]): GroupTNA;
/** Build grouped relative transition probability models. */
declare function groupTna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type' | 'params'>): GroupTNA;
/** Build grouped frequency-based transition models. */
declare function groupFtna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type' | 'params'>): GroupTNA;
/** Build grouped co-occurrence transition models. */
declare function groupCtna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type' | 'params'>): GroupTNA;
/** Build grouped attention-weighted transition models. */
declare function groupAtna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type'> & {
    beta?: number;
}): GroupTNA;

declare const AVAILABLE_MEASURES: CentralityMeasure[];
/**
 * Compute centrality measures for a TNA model.
 */
declare function centralities(model: TNA | GroupTNA, options?: {
    loops?: boolean;
    normalize?: boolean;
    measures?: CentralityMeasure[];
}): CentralityResult;

/**
 * Threshold pruning for TNA models.
 */

/**
 * Prune edges below a weight threshold.
 */
declare function prune(model: TNA | GroupTNA, threshold?: number): TNA | Record<string, TNA>;

/**
 * Cluster sequence data.
 */
declare function clusterData(data: SequenceData | TNAData, k: number, options?: {
    dissimilarity?: 'hamming' | 'lv' | 'osa' | 'lcs';
    method?: string;
    naSyms?: string[];
    weighted?: boolean;
    lambda?: number;
}): ClusterResult;

/**
 * State frequency counts across sequences.
 */

/**
 * Count the frequency of each state across all sequences.
 * Returns a sorted record of { state: count }.
 */
declare function stateFrequencies(data: SequenceData): Record<string, number>;
/**
 * Count state frequencies per sequence (binary: present/absent).
 * Returns { state: number_of_sequences_containing_state }.
 */
declare function statePresence(data: SequenceData): Record<string, number>;

/**
 * Directly-Follows Graph (DFG) — process map computation.
 *
 * Builds a process-mining-style DFG from a TNA model or raw sequences.
 * Three metric modes: absolute counts, relative proportions, case-based fractions.
 */

type DFGMetric = 'absolute' | 'relative' | 'case';
interface DFGNode {
    id: string;
    type: 'activity' | 'start' | 'end';
    absoluteFreq: number;
    relativeFreq: number;
    caseFreq: number;
}
interface DFGEdge {
    from: string;
    to: string;
    absoluteCount: number;
    relativeCount: number;
    caseCount: number;
}
interface DFGResult {
    nodes: DFGNode[];
    edges: DFGEdge[];
    totalSequences: number;
    totalTransitions: number;
}
interface DFGOptions {
    startLabel?: string;
    endLabel?: string;
}
/**
 * Build a directly-follows graph from a TNA model.
 * Uses model.data (sequences) when available; falls back to weight matrix.
 */
declare function buildDFG(model: TNA | GroupTNA, options?: DFGOptions): DFGResult | Record<string, DFGResult>;
/**
 * Build a DFG directly from raw sequence data.
 */
declare function buildDFGFromSequences(sequences: SequenceData, labels?: string[], startLabel?: string, endLabel?: string): DFGResult;

/**
 * Louvain community detection for directed weighted networks.
 */

/**
 * Detect communities using the Louvain algorithm.
 *
 * Modularity formula (directed, weighted):
 *   Q = (1/m) * sum_ij [ A_ij - gamma * (s_out_i * s_in_j) / m ] * delta(c_i, c_j)
 *
 * @param resolution - gamma parameter (default 1.0). Higher = more communities.
 */
declare function communities(model: TNA, options?: {
    resolution?: number;
}): CommunityResult;

/**
 * Network layout algorithms for TNA models.
 *
 * All algorithms output positions normalized to [0, 1].
 * Available: spring, fr, circle, grid, spectral, kamada-kawai,
 *            star, hierarchical, concentric, community, random.
 */

/**
 * Compute a 2D layout for a TNA network.
 *
 * @param algorithm - Layout algorithm (default 'spring')
 * @param iterations - Simulation steps for iterative algorithms (default 300)
 * @param width - Layout area width (default 100)
 * @param height - Layout area height (default 100)
 */
declare function layout(model: TNA, options?: {
    algorithm?: LayoutAlgorithm;
    iterations?: number;
    width?: number;
    height?: number;
}): LayoutResult;

/**
 * Network-level metrics: density and degree distribution.
 */

/**
 * Network density: fraction of possible edges that exist.
 * Directed by default. For undirected (co-occurrence/attention), divides by 2.
 */
declare function networkDensity(model: TNA, options?: {
    loops?: boolean;
}): number;
/**
 * Degree distribution: in-degree, out-degree, total degree per node.
 * Counts non-zero entries (unweighted).
 */
declare function degreeDistribution(model: TNA, options?: {
    loops?: boolean;
}): DegreeDistribution;

/** Single pattern entry in discovery results. */
interface PatternEntry {
    pattern: string;
    length: number;
    frequency: number;
    proportion: number;
    count: number;
    support: number;
    lift: number;
    /** Per-group counts (keys are "count_<groupLabel>"). */
    groupCounts?: Record<string, number>;
    chisq?: number;
    pValue?: number;
}
/** Options for discoverPatterns. */
interface DiscoverOptions {
    type?: 'ngram' | 'gapped' | 'repeated';
    pattern?: string;
    len?: number[];
    gap?: number[];
    minFreq?: number;
    minSupport?: number;
    start?: string[];
    end?: string[];
    contain?: string[];
    group?: string[] | null;
}
/** Result from discoverPatterns. */
interface PatternResult {
    patterns: PatternEntry[];
    _raw: RawPatterns[];
}
/** Internal: raw pattern matrix from extraction. */
interface RawPatterns {
    /** Count matrix [nSequences x nUniquePatterns]. */
    matrix: number[][];
    /** Unique pattern labels. */
    unique: string[];
    /** Pattern length. */
    length: number;
}

/**
 * Pattern discovery engine: n-grams, gapped, repeated, custom search.
 */

/**
 * Discover sequence patterns: n-grams, gapped, repeated, or custom search.
 */
declare function discoverPatterns(data: (string | null | undefined)[][], options?: DiscoverOptions): PatternResult;

export { AVAILABLE_MEASURES, type BuildModelOptions, type CentralityMeasure, type CentralityResult, type ClusterResult, type CommunityResult, type DFGEdge, type DFGMetric, type DFGNode, type DFGOptions, type DFGResult, type DegreeDistribution, type DiscoverOptions, type GroupTNA, type LayoutAlgorithm, type LayoutResult, Matrix, type ModelType, type PatternEntry, type PatternResult, type RawPatterns, type Sequence, type SequenceData, type TNA, type TNAData, type TransitionParams, applyScaling, atna, buildDFG, buildDFGFromSequences, buildModel, centralities, clusterData, communities, computeTransitions, computeWeightsFromMatrix, createGroupTNA, createSeqdata, createTNA, ctna, degreeDistribution, discoverPatterns, ftna, groupApply, groupAtna, groupCtna, groupEntries, groupFtna, groupNames, groupTna, isGroupTNA, layout, maxScale, minmaxScale, networkDensity, prepareData, prune, rankScale, renameGroups, rowNormalize, stateFrequencies, statePresence, summary, tna };
