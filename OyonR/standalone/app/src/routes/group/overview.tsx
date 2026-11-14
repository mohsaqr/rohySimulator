import { Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardMeta, CardTitle } from '@/components/ui/Card';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toggle } from '@/components/ui/Toggle';
import { demoGroupRows, demoRows, parseGroupInput, type GroupInput } from '@/lib/groupDashboard';
import { useGroupStore } from '@/lib/groupStore';
import { GroupHeader } from '@/components/group/GroupHeader';
import { EventList, EventTimeline } from '@/components/group/EventTimeline';
import { SourcePanel } from '@/components/group/SourcePanel';
import { InterpretationNote } from '@/components/group/InterpretationNote';
import { PanelErrors, fmtTime } from '@/components/group/groupChart';
import { useGroupData, useGroupView } from './model';

/*
 * /group/overview — where the data comes from and what happened: the sources
 * (bundle file, the demos, a live hub), who is in the group, the feedback-mode
 * banner, and the trigger-event timeline. Events first, scores second: the
 * other sub-pages explain what this one shows.
 */
export function GroupOverviewView() {
  const d = useGroupData();
  const { base, view } = useGroupView();
  const load = useGroupStore((s) => s.load);
  const setLoadError = useGroupStore((s) => s.setLoadError);
  const loadError = useGroupStore((s) => s.loadError);
  const hub = useGroupStore((s) => s.hub);
  const connectHub = useGroupStore((s) => s.connectHub);
  const disconnectHub = useGroupStore((s) => s.disconnectHub);
  const feedback = useGroupStore((s) => s.feedback);
  const setFeedback = useGroupStore((s) => s.setFeedback);

  const onFile = (text: string, name: string) => {
    let parsed: GroupInput;
    try {
      parsed = parseGroupInput(text);
    } catch (err) {
      setLoadError(`${name}: ${(err as Error).message}`);
      return;
    }
    load(parsed, `replay (${name})`);
  };
  const onDemo = () =>
    load(parseGroupInput(demoRows()), 'synthetic demo (ladyna simulateGroup)');
  const onDemoGroups = () =>
    load(parseGroupInput(demoGroupRows({ n_groups: 6 })), 'synthetic demo, 6 groups (ladyna simulateGroup)');

  return (
    <div className="flex flex-col gap-4">
      <SourcePanel
        onFile={onFile}
        onDemo={onDemo}
        onDemoGroups={onDemoGroups}
        hub={hub}
        onConnect={connectHub}
        onDisconnect={disconnectHub}
        error={loadError}
      />

      {!d.input && d.mode === 'file' ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden="true" />}
          title="No group loaded"
          description="Load a hub export bundle, connect to a live group hub, or start from the synthetic demo (three coupled members with a shared stimulus and missing data)."
          action={<Button size="sm" onClick={onDemo}>Load synthetic demo</Button>}
        />
      ) : null}

      {base?.error ? <p className="m-0 text-xs text-status-bad">{base.error}</p> : null}

      {view ? (
        <>
          <GroupHeader view={view} source={d.sourceLabel} />

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Toggle label="Feedback mode — study condition" checked={feedback} onChange={setFeedback} />
            </div>
            <InfoTip label="feedback mode">
              <p>Off by default. When on, the single most recent shared event is surfaced in a banner, as a feedback condition in a study (Golrang &amp; Sharma 2026), not a product feature.</p>
            </InfoTip>
          </div>
          {feedback ? (
            <div role="status" className="rounded-lg border-2 border-status-info bg-surface-1 p-3 text-sm text-ink-0">
              {view.latest_event
                ? <>Most recent shared event: <b>{view.latest_event.label}</b> at {fmtTime(view.latest_event.start_s ?? 0)}–{fmtTime(view.latest_event.end_s ?? 0)} ({view.latest_event.detail})</>
                : 'No shared event in this span yet.'}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Trigger events</CardTitle>
              <CardMeta>
                arousal events on {view.events_channel ?? '–'} · joint attention on {view.attention_channel ?? '–'}
              </CardMeta>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <EventTimeline events={view.events} span={view.span} />
              <EventList events={view.events} />
              <PanelErrors errors={view.errors} panels={['events', 'joint_attention']} />
            </CardContent>
          </Card>
        </>
      ) : null}

      <InterpretationNote />
    </div>
  );
}
