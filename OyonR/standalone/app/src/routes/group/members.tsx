import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardMeta, CardTitle } from '@/components/ui/Card';
import { MemberRibbons } from '@/components/group/MemberRibbons';
import { channelRibbons, filterSpan } from '@/lib/groupDashboard';
import { useGroupStore } from '@/lib/groupStore';
import { GroupGate, useGroupData, useGroupView } from './model';

/*
 * /group/members — each member's series on the shared clock, for every
 * channel at once (one card per channel, the brushed span), so the page is
 * the whole group rather than one channel behind a picker.
 */
export function GroupMembersView() {
  const d = useGroupData();
  const { base, view } = useGroupView();
  const span = useGroupStore((s) => s.span);

  const rows = useMemo(() => (d.timeline ? filterSpan(d.timeline, span ?? {}) : null), [d.timeline, span]);
  const panels = useMemo(() => (rows ? d.channels.map((c) => {
    try {
      return { channel: c, ribbons: channelRibbons(rows, c.channel), error: null as string | null };
    } catch (err) {
      return { channel: c, ribbons: [], error: `${(err as { code?: string }).code ?? 'error'}: ${(err as Error).message}` };
    }
  }) : []), [rows, d.channels]);

  if (!view) return <GroupGate base={base} />;

  return (
    <div className="flex flex-col gap-4">
      {panels.map(({ channel: c, ribbons, error }) => (
        <Card key={c.channel}>
          <CardHeader>
            <CardTitle>{c.channel}</CardTitle>
            <CardMeta>{c.kind}{c.evidence ? ` · ${c.evidence}` : ''}</CardMeta>
          </CardHeader>
          <CardContent>
            {error ? <p className="m-0 text-xs text-status-bad">{error}</p>
              : <MemberRibbons ribbons={ribbons} span={view.span} channel={c.channel} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
