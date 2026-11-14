// Types for logView.js — the Logs page's view of oyon's one log.
import type { LogRow, LogRowKind } from 'oyon';

export type LogKindTab = 'all' | LogRowKind;
export declare const LOG_KIND_TABS: ReadonlyArray<{ value: LogKindTab; label: string }>;
export declare const LOG_COLUMNS: readonly string[];

export interface LogRowFields {
  time: string | null;
  end: string | null;
  duration_ms: number | null;
  kind: LogRowKind;
  channel: string;
  label: string | null;
  value: number | null;
  unit: string | null;
  level: string | null;
  source: string | null;
  session_id: string | null;
  user_id: string | null;
  group_id: string | null;
  details: string;
}

export declare function logDetails(row: LogRow): string;
export declare function logRowFields(row: LogRow): LogRowFields;
export declare function filterLogRows(
  rows: readonly LogRow[],
  options?: { kind?: LogKindTab; channel?: string; level?: string; query?: string },
): LogRow[];
export declare function logChannels(rows: readonly LogRow[], kind?: LogKindTab): Array<{ value: string; n: number }>;
export declare function logCsv(rows: readonly LogRow[], options?: { wide?: boolean }): string;
export declare function logJson(rows: readonly LogRow[]): string;
