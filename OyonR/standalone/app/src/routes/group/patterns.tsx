import { useMemo, useState } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { InlineSelect } from '@/components/group/InlineSelect';
import { NetworkErrorLine } from '@/components/group/NetworkFigure';
import { PatternSections } from '@/components/patterns/PatternSections';
import { networkRows } from '@/lib/groupNetworks';
import { PATTERN_SOURCES, groupPatternSequences, patternSourceOptions, type PatternSource } from '@/lib/groupPatterns';
import { useGroupStore } from '@/lib/groupStore';
import { GroupGate, useGroupData } from './model';

/*
 * /group/patterns — recurring pathways, sub-patterns, memory (Markov order)
 * and transition trees over one of three group sequences: each member's
 * coded states, the group's regime, or the interaction stream (who changed
 * state after whom). The sequences come from lib/groupPatterns.js and the
 * sections from the same pattern library /analyze/patterns-next uses.
 */
type Scope = 'group' | 'all';

export function GroupPatternsView() {
  const d = useGroupData();
  const span = useGroupStore((s) => s.span);
  const [source, setSource] = useState<PatternSource>('members');
  const [scope, setScope] = useState<Scope>('group');
  const [channelSel, setChannelSel] = useState<string | null>(null);
  const [regimeSel, setRegimeSel] = useState<string | null>(null);

  const effScope: Scope = d.groupIds.length > 1 ? scope : 'group';
  const timelines = d.built?.ok?.timelines ?? null;

  const rowsState = useMemo(() => {
    if (!timelines || !d.groupId) return { rows: null, error: null as string | null };
    try {
      return { rows: networkRows(timelines, { group_id: d.groupId, scope: effScope, span }), error: null };
    } catch (err) {
      return { rows: null, error: `${(err as { code?: string }).code ?? 'error'}: ${(err as Error).message}` };
    }
  }, [timelines, d.groupId, effScope, span]);
  const rows = rowsState.rows;

  const options = useMemo(() => (rows ? patternSourceOptions(rows) : { channels: [], regime_kinds: [] }), [rows]);
  const channel = channelSel && options.channels.some((c) => c.channel === channelSel)
    ? channelSel
    : (options.channels.find((c) => c.channel === 'arousal') ?? options.channels[0])?.channel ?? null;
  const regimeKind = regimeSel && options.regime_kinds.includes(regimeSel) ? regimeSel : options.regime_kinds[0] ?? null;

  const seq = useMemo(
    () => (rows ? groupPatternSequences(rows, { source, channel, regime_kind: regimeKind }) : null),
    [rows, source, channel, regimeKind],
  );

  if (!d.built?.ok || !d.groupId || !d.timeline) return <GroupGate />;

  const prefix = `${effScope === 'all' ? 'all-groups' : d.groupId}-${source}`;

  const lead = (
    <>
      <Segmented label="Sequence source" value={source} options={PATTERN_SOURCES} onChange={setSource} />
      {d.groupIds.length > 1 ? (
        <Segmented
          label="Rows"
          value={effScope}
          options={[{ id: 'group' as Scope, label: `Group ${d.groupId}` }, { id: 'all' as Scope, label: `All ${d.groupIds.length} groups` }]}
          onChange={setScope}
        />
      ) : null}
      {source !== 'regime' && options.channels.length ? (
        <InlineSelect
          label="channel"
          value={channel ?? ''}
          options={options.channels.map((c) => ({ value: c.channel, label: c.label }))}
          onChange={setChannelSel}
          title="Coded by ladyna codeStates (continuous channels → per-person terciles low / mid / high)."
        />
      ) : null}
      {source === 'regime' && options.regime_kinds.length ? (
        <InlineSelect
          label="regime"
          value={regimeKind ?? ''}
          options={options.regime_kinds.map((k) => ({ value: k, label: k }))}
          onChange={setRegimeSel}
        />
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {rowsState.error ? <p className="m-0 text-xs text-status-bad">{rowsState.error}</p> : null}
      {seq?.error ? <NetworkErrorLine error={seq.error} /> : null}
      {seq && !seq.error ? (
        <PatternSections sequences={seq.sequences} filePrefix={prefix} unit={seq.unit} lead={lead}
          about={<p>Sequences: <code>{seq.call}</code></p>} />
      ) : <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{lead}</div>}
    </div>
  );
}
