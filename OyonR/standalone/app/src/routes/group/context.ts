import { createContext, useContext } from 'react';
import type { GroupData } from './model';

/*
 * The /group layout's data context, in its own module on purpose: Vite's hot
 * reload re-runs a module when it changes, and a context created inside
 * model.tsx (which also holds components) was re-created on every edit,
 * leaving the open page's provider and its consumers on two different context
 * objects ("useGroupData() must be used inside the /group layout"). Nothing
 * here changes when the pages do.
 */
const GroupDataContext = createContext<GroupData | null>(null);
export const GroupDataProvider = GroupDataContext.Provider;

export function useGroupData(): GroupData {
  const value = useContext(GroupDataContext);
  if (!value) throw new Error('useGroupData() must be used inside the /group layout');
  return value;
}
