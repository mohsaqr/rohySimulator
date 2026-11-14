import { useGroupStore } from '@/lib/groupStore';
import { NetworksSection } from '@/components/group/NetworksSection';
import { GroupGate, useGroupData } from './model';

/*
 * /group/dynamics — member state sequences, and the co-occurrence, VAR,
 * per-member and interaction networks. The
 * only sub-page that builds them, and it does not compute the dashboard view.
 */
export function GroupDynamicsView() {
  const d = useGroupData();
  const span = useGroupStore((s) => s.span);
  if (!d.built?.ok || !d.groupId || !d.timeline) return <GroupGate />;
  return (
    <NetworksSection
      timelines={d.built.ok.timelines}
      groupId={d.groupId}
      groupIds={d.groupIds}
      span={span}
      dataKey={d.dataKey}
    />
  );
}
