// Ambient types for the vendored ladyna bundle (standalone/vendor/ladyna),
// aliased `legacy-ladyna`. Only the surface the patterns panel uses.
declare module 'legacy-ladyna' {
  export interface PatternEntry {
    pattern: string;
    length: number;
    frequency: number;
    support: number;
    lift: number;
    proportion: number;
    count?: number;
    pValue?: number;
  }
  export function discoverPatterns(
    data: (string | null | undefined)[][],
    options?: { len?: number[]; minFreq?: number; minSupport?: number; type?: string },
  ): { patterns: PatternEntry[]; [k: string]: unknown };
}
