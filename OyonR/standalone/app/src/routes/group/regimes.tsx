import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardMeta, CardTitle } from '@/components/ui/Card';
import { InfoTip } from '@/components/ui/InfoTip';
import { regimePanels, type RegimePanel } from '@/lib/groupDashboard';
import { useGroupStore } from '@/lib/groupStore';
import { RegimeBand, TransitionMatrix } from '@/components/group/RegimeBand';
import { NetworkFigure } from '@/components/group/NetworkFigure';
import { PanelErrors } from '@/components/group/groupChart';
import { GroupGate, useGroupData, useGroupView } from './model';

/*
 * /group/regimes — every regime kind the data supports (affect, arousal,
 * attention) at once, one card each: the group's coded state over time
 * (ladyna regimeSequence), and the transitions between consecutive bins as a
 * ladyna transition network (ftna → plotNetwork) beside a from × to matrix.
 */
export function GroupRegimesView() {
  const d = useGroupData();
  const { base, view } = useGroupView();
  const span = useGroupStore((s) => s.span);
  const built = useMemo(() => {
    if (!d.timeline) return { panels: [] as RegimePanel[], error: null as string | null };
    try {
      return { panels: regimePanels(d.timeline, { span }), error: null };
    } catch (err) {
      return { panels: [] as RegimePanel[], error: `${(err as { code?: string }).code ?? 'error'}: ${(err as Error).message}` };
    }
  }, [d.timeline, span]);
  const panels = built.panels;
  if (!view) return <GroupGate base={base} />;
  if (built.error) return <p className="m-0 text-xs text-status-bad">{built.error}</p>;
  if (!panels.length) return <p className="m-0 text-xs text-ink-3">Regimes need an emotion, arousal or gaze channel.</p>;

  return (
    <div className="flex flex-col gap-4">
      {panels.map((p) => (
        <Card key={p.kind}>
          <CardHeader>
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>{p.kind} regime</CardTitle>
              <InfoTip label={`the ${p.kind} regime`}>
                <p>The group&apos;s coded state per {p.bin_s} s bin, from {p.channel} (ladyna codeStates → regimeSequence); sparse bins (too few members with valid data) are hatched.</p>
                <p>Transitions: counts between consecutive bins (ladyna toSequences → ftna). The network draws them as arrows (self-loops = staying in a regime); the matrix reads from the row to the column, darker = more, the row share in each cell&apos;s tooltip.</p>
              </InfoTip>
            </span>
            <CardMeta>{p.channel} · {p.rows.length} bins</CardMeta>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RegimeBand regime={p} span={view.span} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {p.network ? (
                <NetworkFigure
                  filePrefix={`${view.group_id}-regime-${p.kind}`}
                  view={{
                    id: `regime-network-${p.kind}`, title: 'Transition network', svg: p.network, note: null, error: null,
                    caption: `ladyna toSequences(regimes) → ftna → plotNetwork (${p.kind} regime, counts).`,
                    file_name: 'transitions.svg',
                  }}
                />
              ) : <p className="m-0 text-xs text-ink-3">Fewer than two regime bins: no transitions.</p>}
              <div className="flex h-full min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-1">Transitions between consecutive bins</span>
                <div className="flex flex-1 items-center rounded border border-line bg-white p-3">
                  <TransitionMatrix transitions={p.transitions} />
                </div>
              </div>
            </div>
            <PanelErrors errors={p.errors} panels={['regimes']} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
