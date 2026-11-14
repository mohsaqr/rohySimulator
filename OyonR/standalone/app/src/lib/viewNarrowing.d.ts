import type { FilterScope } from './filterWindows';

export interface LocalView {
  embedded: boolean;
  currentSessionId: string | null;
  filterScope: FilterScope;
  sessionIds: string[] | null;
  userIds: string[] | null;
  keyFilters: Record<string, string[]> | null;
}

export declare function narrowByKeys<T>(rows: T[], keyFilters: Record<string, string[]> | null): T[];
export declare function narrowLocal<T>(rows: T[], view: LocalView): T[];
