// Types for groupVarFit.js — the VAR fitting half of the group Networks
// section (runs in src/workers/varNetworks.ts). Every coefficient comes from
// psychaj; the wide rows from ladyna `toVarRows`.
import type { TimelineRow } from './groupDashboard';

export declare class GroupVarError extends Error {
  /** 'group_var_bad_input' | 'group_var_empty' | 'group_var_unknown_group' */
  code: string;
  constructor(message: string, code?: string);
}

export type VarFitId = 'members' | 'groups' | 'graphicalvar';
export declare const VAR_FITS: readonly VarFitId[];

export interface VarFitRequest {
  /** Long-table rows of every group, already cut to the brushed span. */
  rows: TimelineRow[];
  group_id: string;
  /** Continuous channels; ladyna refuses categorical ones (code synchrony_bad_input). */
  channels: string[];
  /** Rows the members-as-subjects fit pools: the selected group (default) or all groups. */
  scope?: 'group' | 'all';
}

export interface NetworkErrorInfo {
  /** 'ladyna' | 'psychaj' | 'oyon' */
  source: string;
  code: string;
  message: string;
}

export interface VarFit {
  id: VarFitId;
  model: 'mlvar' | 'graphicalvar';
  /** The ladyna + psychaj calls that produced it. */
  call: string;
  status: 'ok' | 'error' | 'unavailable';
  reason: string | null;
  error: NetworkErrorInfo | null;
  /** ladyna toVarRows variable names. */
  vars: string[];
  /** Display labels, index-aligned with the matrices. */
  labels: string[];
  /** [from][to]: row = predictor at t − 1, column = outcome at t. */
  temporal: number[][] | null;
  contemporaneous: number[][] | null;
  /** mlVAR only; NaN cells when psychaj could not estimate it. */
  between: number[][] | null;
  /** psychaj's per-matrix verdict (false = a cell psychaj could not estimate); null before a fit. */
  estimable: { temporal: boolean; contemporaneous: boolean; between: boolean | null } | null;
  /** psychaj's warnings, verbatim. */
  warnings: string[];
  /** groups-as-subjects: seat ('#k') → its display labels. */
  clusters: Record<string, string[]> | null;
  n_obs: number | null;
  n_subjects: number | null;
  /** Wide rows ladyna produced, and ticks it dropped for a missing variable. */
  n_rows: number | null;
  n_dropped: number | null;
  elapsed_ms: number | null;
}

export interface VarFitResult {
  group_id: string;
  channels: string[];
  scope: 'group' | 'all';
  n_groups: number;
  fits: Record<VarFitId, VarFit>;
}

export declare function fitVarNetworks(request: VarFitRequest): VarFitResult;
