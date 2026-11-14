/*
 * The Group dashboard's sub-pages — the row SubNav shows under the top bar
 * while you are inside /group, the same way Analytics lists its domains.
 * Kept in its own dependency-free module (like analyzeTabs.ts) so the shell
 * can render the row without importing the route tree.
 *
 * Order runs parallel to Analytics and puts the pages that show data before
 * those that need something fitted or run: Overview (source, events), the
 * members' series and the coded regimes; then Dynamics and Patterns (as in
 * Analytics); then the scores whose null is computed on request (Synchrony)
 * and joint attention; Export last.
 */
export interface GroupTab { to: string; label: string }

export const groupSubTabs: ReadonlyArray<GroupTab> = [
  { to: '/group/overview', label: 'Overview' },
  { to: '/group/members', label: 'Members' },
  { to: '/group/regimes', label: 'Regimes' },
  { to: '/group/dynamics', label: 'Dynamics' },
  { to: '/group/patterns', label: 'Patterns' },
  { to: '/group/synchrony', label: 'Synchrony' },
  { to: '/group/attention', label: 'Joint attention' },
  { to: '/group/export', label: 'Export' },
];

/** Where /group lands, and where every empty sub-page sends you to load data. */
export const GROUP_LANDING = '/group/overview' as const;
