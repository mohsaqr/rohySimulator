import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { GROUP_LANDING } from '@/lib/groupTabs';
import { useGroupStore } from '@/lib/groupStore';
import { GroupBar } from '@/components/group/GroupBar';
import { GroupDataProvider, useGroupDataValue } from './group/model';
import { GroupOverviewView } from './group/overview';
import { GroupSynchronyView } from './group/synchrony';
import { GroupAttentionView } from './group/attention';
import { GroupMembersView } from './group/members';
import { GroupRegimesView } from './group/regimes';
import { GroupDynamicsView } from './group/dynamics';
import { GroupPatternsView } from './group/patterns';
import { GroupExportView } from './group/export';

/*
 * Group synchrony dashboard (docs/GROUP_SYNCHRONY_PLAN.md §6) — parent route.
 *
 * It was one long page; it is now a layout with one child route per part,
 * reached from the SubNav row under the top bar the same way Analytics lists
 * its domains (lib/groupTabs.ts):
 *
 *   /group/overview   sources, members, feedback mode, trigger-event timeline
 *   /group/synchrony  channel + measure, null, strip, pair matrix, member indices
 *   /group/attention  joint attention and its breaks
 *   /group/members    member ribbons
 *   /group/regimes    regime band and transitions
 *   /group/dynamics   member state sequences + co-occurrence / VAR / per-member / interaction networks
 *   /group/export     the brushed span's files
 *
 * The layout renders the bar every sub-page shares (group picker, what is
 * loaded, the time-span brush) above the page. All state is in
 * lib/groupStore.ts, so it — and a live hub connection — survives moving
 * between sub-pages. Layout, selection, rendering and export only: every
 * measure, null, event and sequence is computed by ladyna (and psychaj for the
 * VAR networks) inside the lib files.
 */

function GroupLayout() {
  const data = useGroupDataValue();
  const span = useGroupStore((s) => s.span);
  const setSpan = useGroupStore((s) => s.setSpan);
  const selectGroup = useGroupStore((s) => s.selectGroup);
  const hub = useGroupStore((s) => s.hub);
  const { built, timeline, groupId } = data;

  return (
    <GroupDataProvider value={data}>
      <div className="flex flex-col gap-4">
        {built?.error ? <p className="m-0 text-xs text-status-bad">{built.error}</p> : null}
        {built?.ok?.errors.length ? (
          <ul className="m-0 list-none p-0 text-xs text-status-bad">
            {built.ok.errors.map((e, i) => <li key={i}><code>{e.code}</code> {e.group_id ? `(${e.group_id}) ` : ''}— {e.message}</li>)}
          </ul>
        ) : null}
        {data.mode === 'live' && data.input && !timeline && !built?.ok?.errors.length ? (
          <p className="m-0 text-xs text-ink-3">Waiting for windows from the hub…</p>
        ) : null}

        {timeline && groupId ? (
          <GroupBar
            groupIds={data.groupIds}
            groupId={groupId}
            onGroup={selectGroup}
            summary={{
              source: data.sourceLabel,
              members: data.memberCount,
              channels: data.channels.length,
              live: data.mode === 'live' ? `hub ${hub.status}, ${hub.n_windows} windows` : null,
            }}
            extent={data.extent}
            span={span}
            onSpan={setSpan}
          />
        ) : null}

        <Outlet />
      </div>
    </GroupDataProvider>
  );
}

export const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/group',
  component: GroupLayout,
});

export const groupIndexRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: GROUP_LANDING });
  },
});

export const groupOverviewRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/overview',
  component: GroupOverviewView,
});
export const groupSynchronyRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/synchrony',
  component: GroupSynchronyView,
});
export const groupAttentionRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/attention',
  component: GroupAttentionView,
});
export const groupMembersRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/members',
  component: GroupMembersView,
});
export const groupRegimesRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/regimes',
  component: GroupRegimesView,
});
export const groupDynamicsRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/dynamics',
  component: GroupDynamicsView,
});
export const groupPatternsRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/patterns',
  component: GroupPatternsView,
});
export const groupExportRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/export',
  component: GroupExportView,
});
