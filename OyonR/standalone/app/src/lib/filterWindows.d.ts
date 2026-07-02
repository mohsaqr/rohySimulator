export declare const DEFAULT_SESSION: '__default__';
export declare const DEFAULT_USER: '__unknown__';

export type FilterScope = 'current' | 'past' | 'all';

export interface FilterOptions {
  scope?: FilterScope;
  currentSessionId?: string | null;
  sessionIds?: string[] | null;
  userIds?: string[] | null;
}

export declare function sessionIdOf(window: unknown): string;
export declare function userIdOf(window: unknown): string;
export declare function distinctUsers(windows: unknown[]): string[];
export declare function distinctSessions(windows: unknown[]): string[];
export declare function filterWindows<T>(windows: T[], options?: FilterOptions): T[];
