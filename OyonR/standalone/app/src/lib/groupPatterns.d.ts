// Types for groupPatterns.js — a group's sequences for the pattern library.
import type { TimelineRow } from './groupDashboard';
import type { NetworkErrorInfo } from './groupVarFit';

export type PatternSource = 'members' | 'regime' | 'interaction';
export declare const PATTERN_SOURCES: ReadonlyArray<{ id: PatternSource; label: string }>;
export declare function patternSourceOptions(rows: TimelineRow[]): {
  channels: Array<{ channel: string; kind: string; label: string }>;
  regime_kinds: string[];
};
export declare function groupPatternSequences(rows: TimelineRow[], opts: {
  source: PatternSource; channel?: string | null; regime_kind?: string | null; bin_s?: number | null; tau_s?: number;
}): { sequences: (string | null)[][]; ids: string[]; unit: string; call: string; error: NetworkErrorInfo | null };
