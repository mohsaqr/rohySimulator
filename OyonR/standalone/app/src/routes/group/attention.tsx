import { Card, CardContent, CardHeader, CardMeta, CardTitle } from '@/components/ui/Card';
import { JointAttentionTable, JointAttentionInfo } from '@/components/group/GroupTables';
import { InfoTip } from '@/components/ui/InfoTip';
import { EventList, EventTimeline } from '@/components/group/EventTimeline';
import { PanelErrors } from '@/components/group/groupChart';
import type { EventKind } from '@/lib/groupDashboard';
import { GroupGate, useGroupView } from './model';

/*
 * /group/attention — joint attention: per pair, how often the partner was on
 * the same target (ladyna jointAttention), and the windows where that fell
 * below chance (ladyna jointAttentionBreaks), on the timeline and in words.
 */
const BREAKS: EventKind[] = ['attention_break'];

export function GroupAttentionView() {
  const { base, view } = useGroupView();
  if (!view) return <GroupGate base={base} />;
  const breaks = view.events.filter((e) => e.kind === 'attention_break');

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-1.5">
            <CardTitle>Joint attention</CardTitle>
            <InfoTip label="joint attention"><JointAttentionInfo view={view} /></InfoTip>
          </span>
          <CardMeta>{view.attention_channel ?? 'no gaze channel'}</CardMeta>
        </CardHeader>
        <CardContent><JointAttentionTable view={view} /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Joint-attention breaks</CardTitle>
          <CardMeta>{breaks.length} in this span</CardMeta>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <EventTimeline events={view.events} span={view.span} kinds={BREAKS} />
          <EventList events={breaks} />
          <PanelErrors errors={view.errors} panels={['joint_attention']} />
        </CardContent>
      </Card>
    </div>
  );
}
