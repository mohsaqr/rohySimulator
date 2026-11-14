export declare const RUNTIME_LOG_LOOKBACK_MS: number;
export interface LogCache<T> {
  rows: T[];
  keys: Set<string>;
}
export declare function mergeIncremental<T>(cache: LogCache<T> | null, read: T[], keyOf: (row: T) => string): LogCache<T>;
export declare function sinceFor(rows: ReadonlyArray<{ timestamp?: unknown }>, lookbackMs?: number): string | null;
