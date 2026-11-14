// Types for groupNetworks.js — the group dashboard's Networks section. Every
// model comes from ladyna / psychaj, every picture from a ladyna painter.
import type { TimelineRow } from './groupDashboard';
import type { NetworkErrorInfo, VarFitResult } from './groupVarFit';

export declare const NETWORK_BIN_S: number;
export declare const INTERACTION_BIN_S: number;
export declare const INTERACTION_TAU_S: number;
export declare const VAR_CUTOFF: number;

export type NetworkTab = 'sequences' | 'cooccurrence' | 'var' | 'member' | 'interaction';
export declare const NETWORK_TABS: ReadonlyArray<{ id: NetworkTab; label: string }>;

export declare class GroupNetworkError extends Error {
  /** 'group_networks_bad_input' | 'group_networks_unknown_group' | 'group_networks_empty' | 'group_networks_no_events' */
  code: string;
  constructor(message: string, code?: string);
}

export interface NetworkView {
  id: string;
  title: string;
  /** One line: the model and the ladyna/psychaj calls that produced it. */
  caption: string;
  /** The ladyna painter's SVG string, or null with a `note` or an `error`. */
  svg: string | null;
  note: string | null;
  error: NetworkErrorInfo | null;
  file_name: string;
  /**
   * Shown on the page beside a drawn figure: e.g. a partly estimable matrix
   * (the cells psychaj could not estimate are listed and not drawn).
   */
  warning?: string | null;
  /** Cells psychaj could not estimate, as "from → to" (undirected: "a — b"). */
  missing_cells?: string[];
}

export interface NetworkSpan {
  start_s: number;
  end_s: number;
}

export declare function networkRows(
  timelines: Record<string, TimelineRow[]>,
  opts?: { group_id?: string | null; scope?: 'group' | 'all'; span?: NetworkSpan | null },
): TimelineRow[];

export interface NetworkChannels {
  state: Array<{ channel: string; kind: string; label: string }>;
  continuous: string[];
  default_var: string[];
}
export declare function networkChannels(rows: TimelineRow[]): NetworkChannels;

export declare function sequenceViews(rows: TimelineRow[], opts: { channel: string; bin_s?: number }): NetworkView[];
export declare function cooccurrenceNetworks(rows: TimelineRow[], opts: { channel: string; bin_s?: number }): NetworkView[];
export interface CooccurrenceBootstrapEdge {
  pair: string; a: string; b: string; weight: number;
  ci_lower: number; ci_upper: number; p: number; significant: boolean;
}
export interface CooccurrenceBootstrap {
  view: NetworkView;
  edges: CooccurrenceBootstrapEdge[];
  iter: number;
  seed: number;
  /** Co-occurrence bins resampled (one per group × bin). */
  n_bins: number;
  n_significant: number;
  n_pairs: number;
  error: { source: string; code: string; message: string } | null;
}
export declare function bootstrapCooccurrence(
  rows: TimelineRow[],
  opts: { channel: string; bin_s?: number; iter?: number; seed?: number },
): CooccurrenceBootstrap;

export interface MemberNetworks {
  members: string[];
  member_a: string | null;
  member_b: string | null;
  views: NetworkView[];
}
export declare function memberNetworks(
  rows: TimelineRow[],
  opts: { channel: string; bin_s?: number; member_a?: string | null; member_b?: string | null },
): MemberNetworks;

export declare function interactionNetworks(rows: TimelineRow[], opts: { channel: string; bin_s?: number; tau_s?: number }): NetworkView[];

export declare function matrixModel(labels: string[], m: number[][]): unknown;

export interface VarSection {
  id: 'members' | 'groups' | 'graphicalvar';
  title: string;
  call: string;
  status: 'ok' | 'error' | 'unavailable';
  reason: string | null;
  error: NetworkErrorInfo | null;
  warnings: string[];
  n_obs: number | null;
  n_subjects: number | null;
  n_rows: number | null;
  n_dropped: number | null;
  elapsed_ms: number | null;
  views: NetworkView[];
}
export declare function varNetworkViews(result: VarFitResult): VarSection[];
