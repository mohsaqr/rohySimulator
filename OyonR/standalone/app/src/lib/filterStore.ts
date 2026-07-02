import { create } from 'zustand';
import type { FilterScope } from './filterWindows';

/*
 * Filter store — the analytics scope every /analyze dashboard and /sessions
 * inherits via the shell FilterBar.
 *
 *   scope:      'current' (live capture session) | 'past' (everything else)
 *               | 'all' (system-aggregated, the default).
 *   sessionIds: optional narrowing to specific sessions (null = no narrowing).
 *   userIds:    optional narrowing to specific users (null = no narrowing).
 *
 * Kept separate from sessionContext (capture identity) and settingsStore
 * (capture configuration): this store describes what the dashboards LOOK AT,
 * not what the runtime records.
 */

export interface FilterState {
  scope: FilterScope;
  sessionIds: string[] | null;
  userIds: string[] | null;
  setScope: (scope: FilterScope) => void;
  setSessionIds: (ids: string[] | null) => void;
  setUserIds: (ids: string[] | null) => void;
  reset: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  scope: 'all',
  sessionIds: null,
  userIds: null,
  setScope: (scope) => set({ scope }),
  setSessionIds: (sessionIds) =>
    set({ sessionIds: sessionIds && sessionIds.length > 0 ? sessionIds : null }),
  setUserIds: (userIds) => set({ userIds: userIds && userIds.length > 0 ? userIds : null }),
  reset: () => set({ scope: 'all', sessionIds: null, userIds: null }),
}));
