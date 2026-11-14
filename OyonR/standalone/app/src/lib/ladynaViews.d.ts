// Types for ladynaViews.js — the view contract ladyna-backed sections share.
import type { NetworkView } from './groupNetworks';
import type { NetworkErrorInfo } from './groupVarFit';

export declare class OyonViewError extends Error {
  code: string;
  constructor(message: string, code?: string);
}
export declare function errorOf(err: unknown, source?: string): NetworkErrorInfo;
export declare function slug(s: unknown): string;
export declare function view(id: string, title: string, caption: string, extra?: Partial<NetworkView>): NetworkView;
export declare function paint(v: NetworkView, fn: () => string, source?: string): NetworkView;
export declare function step<T>(fn: () => T): { ok: T | null; error: NetworkErrorInfo | null };
export declare function matrixModel(labels: string[], m: number[][]): unknown;
