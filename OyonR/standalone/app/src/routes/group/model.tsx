import { InlineSelect } from '@/components/group/InlineSelect';
import { useEffect, useMemo } from 'react';
import { useGroupData } from './context';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  DEFAULT_NULL_N,
  buildTimelines,
  channelsInTimeline,
  computeDashboard,
  defaultMethod,
  timeExtent,
  type BuiltTimelines,
  type ChannelInfo,
  type DashboardOptions,
  type DashboardView,
  type GroupInput,
  type NullOptions,
  type TimelineRow,
} from '@/lib/groupDashboard';
import { GROUP_LANDING } from '@/lib/groupTabs';
import { useGroupStore, type BrushSpan, type NullState, type RegimeChoice } from '@/lib/groupStore';

/*
 * The group dashboard's derived data, shared by the /group layout and its
 * sub-pages.
 *
 *   useGroupDataValue()  the layout computes it once from the store (the
 *                        timelines, the resolved group / channel / method, the
 *                        time extent) and provides it to every sub-page.
 *   useGroupView()       a sub-page that shows the dashboard view computes it
 *                        here (ladyna, via lib/groupDashboard.js). Networks does
 *                        not, so it pays nothing for it.
 *
 * Only the most recent view is remembered (lastView below), so moving between
 * sub-pages on the same data and selection does not recompute it.
 */

export interface GroupData {
  input: GroupInput | null;
  mode: 'file' | 'live';
  sourceLabel: string;
  dataKey: string;
  built: { ok: BuiltTimelines | null; error: string | null } | null;
  groupIds: string[];
  groupId: string | null;
  timeline: TimelineRow[] | null;
  pool: TimelineRow[][];
  channels: ChannelInfo[];
  channel: string | null;
  channelInfo: ChannelInfo | null;
  method: string | null;
  extent: { min_s: number; max_s: number };
  memberCount: number;
}

export function useGroupDataValue(): GroupData {
  const mode = useGroupStore((s) => s.mode);
  const loaded = useGroupStore((s) => s.loaded);
  const hubInput = useGroupStore((s) => s.hub.input);
  const hubRevision = useGroupStore((s) => s.hub.revision);
  const groupSel = useGroupStore((s) => s.groupSel);
  const channelSel = useGroupStore((s) => s.channelSel);
  const methodByChannel = useGroupStore((s) => s.methodByChannel);

  const input = mode === 'live' ? hubInput : loaded?.input ?? null;
  const sourceLabel = mode === 'live' ? 'live' : loaded?.label ?? '–';
  // The content revision, not a window count: a replaced window or a new
  // marker leaves the count unchanged but must not reuse a cached null,
  // bootstrap or VAR fit (Codex #15).
  const dataKey = mode === 'live' ? `live:${hubRevision}` : `file:${loaded?.version ?? 0}`;

  const built = useMemo(() => {
    if (!input) return null;
    try {
      return { ok: buildTimelines(input), error: null as string | null };
    } catch (err) {
      return { ok: null, error: (err as Error).message };
    }
  }, [input]);

  const groupIds = useMemo(() => built?.ok?.group_ids ?? [], [built]);
  const groupId = groupSel && groupIds.includes(groupSel) ? groupSel : groupIds[0] ?? null;
  const timeline = groupId && built?.ok ? built.ok.timelines[groupId] : null;
  const pool = useMemo(
    () => (built?.ok && groupId ? built.ok.group_ids.filter((g) => g !== groupId).map((g) => built.ok!.timelines[g]) : []),
    [built, groupId],
  );

  const channels = useMemo(() => (timeline ? channelsInTimeline(timeline) : []), [timeline]);
  const channel = channelSel && channels.some((c) => c.channel === channelSel) ? channelSel
    : (channels.find((c) => c.channel === 'arousal') ?? channels.find((c) => c.kind === 'continuous') ?? channels[0])?.channel ?? null;
  const channelInfo = channels.find((c) => c.channel === channel) ?? null;
  const method = channel && channelInfo ? (methodByChannel[channel] ?? defaultMethod(channel, channelInfo.kind)) : null;
  const extent = useMemo(() => (timeline ? timeExtent(timeline) : { min_s: 0, max_s: 0 }), [timeline]);
  const memberCount = useMemo(() => (timeline ? new Set(timeline.map((r) => r.member_id)).size : 0), [timeline]);

  return {
    input, mode, sourceLabel, dataKey, built, groupIds, groupId, timeline, pool,
    channels, channel, channelInfo, method, extent, memberCount,
  };
}

// The context itself lives in ./context.ts (see there for why); re-exported here.
export { GroupDataProvider, useGroupData } from './context';

function optionsFor(
  d: GroupData,
  measure: string | null,
  span: BrushSpan | null,
  regime: RegimeChoice | null,
): DashboardOptions | null {
  if (!d.channel || !d.method) return null;
  return {
    channel: d.channel,
    method: d.method,
    measure,
    span,
    regime_kind: regime,
    windows: d.input?.windows ?? [],
    markers: (d.input?.markers ?? []).filter((m) => !m.group_id || m.group_id === d.groupId),
  };
}

type BaseView = { view: DashboardView | null; error: string | null };

// One remembered view: the inputs that made it (by identity) and the result.
let lastView: { deps: unknown[]; value: BaseView } | null = null;

function baseViewFor(d: GroupData, measure: string | null, span: BrushSpan | null, regime: RegimeChoice | null): BaseView | null {
  const opts = optionsFor(d, measure, span, regime);
  if (!d.timeline || !opts) return null;
  const deps = [d.timeline, d.channel, d.method, measure, span, regime, d.input, d.groupId];
  if (lastView && lastView.deps.every((v, i) => Object.is(v, deps[i]))) return lastView.value;
  let value: BaseView;
  try {
    value = { view: computeDashboard(d.timeline, opts), error: null };
  } catch (err) {
    value = { view: null, error: `${(err as { code?: string }).code ?? 'error'}: ${(err as Error).message}` };
  }
  lastView = { deps, value };
  return value;
}

export interface GroupViewModel {
  base: BaseView | null;
  /** The view with its null when one has been computed for this selection, else without. */
  view: DashboardView | null;
  /** The null run for the current selection (running, done or failed), if any. */
  current: NullState | null;
  runNull: () => void;
}

export function useGroupView(): GroupViewModel {
  const d = useGroupData();
  const measureSel = useGroupStore((s) => s.measureSel);
  const span = useGroupStore((s) => s.span);
  const regimeSel = useGroupStore((s) => s.regimeSel);
  const nullChoice = useGroupStore((s) => s.nullChoice);
  const nullState = useGroupStore((s) => s.nullState);
  const autoNull = useGroupStore((s) => s.autoNull);
  const setNullState = useGroupStore((s) => s.setNullState);
  const consumeAutoNull = useGroupStore((s) => s.consumeAutoNull);

  const base = useMemo(
    () => baseViewFor(d, measureSel, span, regimeSel),
    // d is rebuilt every layout render; its parts are the dependencies.
    [d.timeline, d.channel, d.method, measureSel, span, regimeSel, d.input, d.groupId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const nullKey = JSON.stringify([d.dataKey, d.groupId, d.channel, d.method, base?.view?.measure ?? null, span, regimeSel, nullChoice]);

  const runNull = () => {
    const opts = optionsFor(d, measureSel, span, regimeSel);
    const timeline = d.timeline;
    if (!timeline || !opts) return;
    const key = nullKey;
    setNullState({ key, running: true, view: null, error: null });
    const nullOpts: NullOptions = { n: DEFAULT_NULL_N, method: nullChoice === 'auto' ? null : nullChoice, pool: d.pool, seed: 1 };
    // Yield one frame so the "computing" state paints before the work starts.
    window.setTimeout(() => {
      try {
        const view = computeDashboard(timeline, { ...opts, measure: base?.view?.measure ?? opts.measure, null: nullOpts });
        setNullState({ key, running: false, view, error: null });
      } catch (err) {
        setNullState({ key, running: false, view: null, error: (err as Error).message });
      }
    }, 30);
  };

  // A file or the demo gets its null once, right after it loads, on whichever
  // sub-page first shows the view.
  useEffect(() => {
    if (autoNull && d.mode === 'file' && base?.view) {
      consumeAutoNull();
      runNull();
    }
  }, [base, d.mode, autoNull]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = nullState?.key === nullKey ? nullState : null;
  return { base, view: current?.view ?? base?.view ?? null, current, runNull };
}

/*
 * What a sub-page shows instead of its panels when there is nothing to draw:
 * no data yet (with the way to Overview's sources), the hub still silent, or
 * the view's own error. Never an empty chart.
 */
export function GroupGate({ base }: { base?: BaseView | null }) {
  const d = useGroupData();
  if (!d.input) {
    if (d.mode === 'live') return <p className="m-0 text-xs text-ink-3">Waiting for windows from the hub…</p>;
    return (
      <EmptyState
        icon={<Users className="size-6" aria-hidden="true" />}
        title="No group loaded"
        description="Load a hub export bundle, connect to a live group hub, or start from a synthetic demo on Overview."
        action={
          <Button asChild size="sm">
            <Link to={GROUP_LANDING}>Go to sources</Link>
          </Button>
        }
      />
    );
  }
  if (base?.error) return <p className="m-0 text-xs text-status-bad">{base.error}</p>;
  if (!d.timeline) return <p className="m-0 text-xs text-ink-3">Nothing to draw for this group; the messages above say why.</p>;
  return <p className="m-0 text-xs text-ink-3">No channel with data for group {d.groupId}.</p>;
}

/** The channel picker Synchrony and Members share (one selection for both). */
export function ChannelSelect() {
  const d = useGroupData();
  const selectChannel = useGroupStore((s) => s.selectChannel);
  if (!d.channel) return null;
  return (
    <InlineSelect
      label="channel"
      value={d.channel}
      options={d.channels.map((c) => ({
        value: c.channel,
        label: `${c.channel} · ${c.kind}${c.evidence ? ` · ${c.evidence}` : ''}`,
      }))}
      onChange={selectChannel}
    />
  );
}
