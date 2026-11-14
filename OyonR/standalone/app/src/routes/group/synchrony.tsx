import { InlineSelect } from '@/components/group/InlineSelect';
import { Card, CardActions, CardContent, CardHeader, CardMeta, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DEFAULT_NULL_N } from '@/lib/groupDashboard';
import { useGroupStore, type NullChoice } from '@/lib/groupStore';
import { SynchronyStrip, SynchronyStripInfo } from '@/components/group/SynchronyStrip';
import { PairMatrix, PairMatrixInfo } from '@/components/group/PairMatrix';
import { MemberIndicesInfo, MemberIndicesTable } from '@/components/group/GroupTables';
import { InfoTip } from '@/components/ui/InfoTip';
import { PanelErrors } from '@/components/group/groupChart';
import { ChannelSelect, GroupGate, useGroupData, useGroupView } from './model';

/*
 * /group/synchrony — the scores: which channel and measure, the surrogate
 * null (computed on demand, and once after a file or demo loads), the
 * synchrony strip over time, the pairwise matrix and each member's coupling
 * to the group (cluster phase).
 */
export function GroupSynchronyView() {
  const d = useGroupData();
  const { base, view, current, runNull } = useGroupView();
  const selectMethod = useGroupStore((s) => s.selectMethod);
  const selectMeasure = useGroupStore((s) => s.selectMeasure);
  const nullChoice = useGroupStore((s) => s.nullChoice);
  const setNullChoice = useGroupStore((s) => s.setNullChoice);

  if (!view || !d.channel || !d.channelInfo || !d.method) return <GroupGate base={base} />;
  const channel = d.channel;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChannelSelect />
        <InlineSelect
          label="measure family"
          value={d.method}
          options={view.methods.map((m) => ({ value: m.method, label: `${m.method}${m.is_default ? ' (default)' : ''}` }))}
          onChange={(m) => selectMethod(channel, m)}
          title={`${view.methods.find((m) => m.method === d.method)?.reference ?? ''} · default for ${d.channelInfo.channel_class} channels`}
        />
        <InlineSelect
          label="measure"
          value={view.measure ?? ''}
          options={view.measures.map((m) => ({ value: m, label: m }))}
          onChange={selectMeasure}
        />
      </div>

      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-1.5">
            <CardTitle>Synchrony strip</CardTitle>
            <InfoTip label="the synchrony strip"><SynchronyStripInfo strip={view.strip} singleGroup={!d.pool.length} /></InfoTip>
          </span>
          <CardActions>
            <CardMeta>
              {current?.running ? 'computing null…'
                : view.null ? `null: ${view.null.method}, n = ${view.null.n}${view.null.pool_groups ? `, pool ${view.null.pool_groups} groups` : ''}`
                  : 'no null yet'}
            </CardMeta>
            <select
              className="rounded border border-line bg-surface-1 px-1.5 py-1 text-xs text-ink-0"
              value={nullChoice}
              onChange={(e) => setNullChoice(e.target.value as NullChoice)}
              aria-label="Null method"
            >
              <option value="auto">auto ({d.pool.length ? 'pseudo-group' : 'circular shift'})</option>
              <option value="circular_shift">circular shift</option>
              <option value="segment_shuffle">segment shuffle</option>
              <option value="iaaft">IAAFT</option>
              <option value="pseudo_group" disabled={!d.pool.length}>pseudo-group</option>
            </select>
            <Button size="sm" variant="outline" disabled={current?.running} onClick={runNull}>
              Compute null (n = {DEFAULT_NULL_N})
            </Button>
          </CardActions>
        </CardHeader>
        <CardContent>
          <SynchronyStrip strip={view.strip} span={view.span} measure={view.measure} />
          {current?.error ? <p className="m-0 mt-1 text-xs text-status-bad">{current.error}</p> : null}
          <PanelErrors errors={view.errors} panels={['pairs', 'strip', 'null']} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>Pairwise matrix</CardTitle>
              <InfoTip label="the pairwise matrix"><PairMatrixInfo view={view} /></InfoTip>
            </span>
            <CardMeta>{view.method} · {view.measure}</CardMeta>
          </CardHeader>
          <CardContent>
            <PairMatrix view={view} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>Member indices</CardTitle>
              <InfoTip label="member indices"><MemberIndicesInfo view={view} /></InfoTip>
            </span>
          </CardHeader>
          <CardContent>
            <MemberIndicesTable view={view} />
            <PanelErrors errors={view.errors} panels={['member_indices']} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
