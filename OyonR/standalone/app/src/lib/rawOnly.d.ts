export declare function isRawOnly(record: unknown): boolean;
export declare function splitRawOnly<T extends object>(windows: ReadonlyArray<T>): { windows: T[]; rawOnly: T[] };
