/** Smallest and largest finite number in one pass (no argument spreading); null when none is finite. */
export declare function extent(values: Iterable<unknown> | null | undefined, opts?: { include?: number[] }): { min: number; max: number } | null;
