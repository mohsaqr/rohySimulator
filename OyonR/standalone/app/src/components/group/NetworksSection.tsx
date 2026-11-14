import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InfoTip, Notice } from '@/components/ui/InfoTip';
import { BarCell } from '@/components/ui/BarCell';
import type { TimelineRow } from '@/lib/groupDashboard';
import {
  INTERACTION_BIN_S,
  INTERACTION_TAU_S,
  NETWORK_BIN_S,
  NETWORK_TABS,
  bootstrapCooccurrence,
  cooccurrenceNetworks,
  interactionNetworks,
  sequenceViews,
  memberNetworks,
  networkChannels,
  networkRows,
  varNetworkViews,
  type NetworkTab,
  type NetworkView,
  type VarSection,
} from '@/lib/groupNetworks';
import { useGroupStore, type NetworkScope } from '@/lib/groupStore';
import { Figures, NetworkErrorLine } from './NetworkFigure';
import { Segmented } from '@/components/ui/Segmented';
import { InlineSelect } from './InlineSelect';

/*
 * Networks section of the group dashboard. Selection and layout only: the
 * models and pictures come from lib/groupNetworks.js (ladyna) and the VAR
 * fits from lib/groupVarFit.js (psychaj, in a Web Worker via
 * lib/varFitRunner.ts). Every view follows the dashboard's time-span brush.
 *
 * The choices (tab, rows, channel, members, VAR channels), the bootstrap and
 * the VAR fit live in lib/groupStore.ts, so leaving /group/dynamics neither
 * forgets them nor cancels a fit that is still running.
 */

type Scope = NetworkScope;

interface Span {
  start_s: number;
  end_s: number;
}

function errorText(err: unknown) {
  const e = err as { code?: string; message?: string };
  return `${e?.code ?? 'error'}: ${e?.message ?? String(err)}`;
}

function VarSectionBlock({ section, prefix }: { section: VarSection; prefix: string }) {
  const stats = [
    section.n_obs != null ? `n obs = ${section.n_obs}` : null,
    section.n_subjects != null ? `n subjects = ${section.n_subjects}` : null,
    section.n_rows != null ? `${section.n_rows} wide rows` : null,
    section.n_dropped ? `${section.n_dropped} ticks dropped for a missing variable` : null,
    section.elapsed_ms != null ? `${(section.elapsed_ms / 1000).toFixed(1)} s` : null,
  ].filter(Boolean);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h3 className="m-0 text-sm font-medium text-ink-0">{section.title}</h3>
        <InfoTip label={section.title}>
          {stats.length ? <p>{stats.join(' · ')}</p> : null}
          <p><code>{section.call}</code></p>
          {section.warnings.map((w, i) => <p key={i}>psychaj warning: {w}</p>)}
        </InfoTip>
      </div>
      {section.status === 'unavailable' ? <Notice>Unavailable: {section.reason}</Notice> : null}
      {section.error ? <NetworkErrorLine error={section.error} /> : null}
      {section.warnings.length ? <Notice>psychaj raised {section.warnings.length === 1 ? 'a warning' : `${section.warnings.length} warnings`} for this fit (see ?).</Notice> : null}
      {section.views.length ? <Figures views={section.views} prefix={prefix} /> : null}
    </section>
  );
}

export function NetworksSection({ timelines, groupId, groupIds, span, dataKey }: {
  timelines: Record<string, TimelineRow[]>;
  groupId: string;
  groupIds: string[];
  span: Span | null;
  dataKey: string;
}) {
  const { tab, scope, channelSel, memberA, memberB, varSel, fit, boot } = useGroupStore((s) => s.networks);
  const setNetworks = useGroupStore((s) => s.setNetworks);
  const startVarFit = useGroupStore((s) => s.startVarFit);
  const failVarFit = useGroupStore((s) => s.failVarFit);
  const cancelFit = useGroupStore((s) => s.cancelVarFit);
  const setTab = (next: NetworkTab) => setNetworks({ tab: next });
  const setScope = (next: Scope) => setNetworks({ scope: next });
  const setChannelSel = (next: string) => setNetworks({ channelSel: next });
  const setMemberA = (next: string) => setNetworks({ memberA: next });
  const setMemberB = (next: string) => setNetworks({ memberB: next });
  const setVarSel = (next: string[]) => setNetworks({ varSel: next });

  const effScope: Scope = groupIds.length > 1 ? scope : 'group';
  const rowsState = useMemo(() => {
    try {
      return { rows: networkRows(timelines, { group_id: groupId, scope: effScope, span }), error: null as string | null };
    } catch (err) {
      return { rows: null, error: errorText(err) };
    }
  }, [timelines, groupId, effScope, span]);
  const rows = rowsState.rows;

  const channels = useMemo(() => (rows ? networkChannels(rows) : null), [rows]);
  const stateChannels = channels?.state ?? [];
  const channel = channelSel && stateChannels.some((c) => c.channel === channelSel) ? channelSel
    : (stateChannels.find((c) => c.channel === 'arousal') ?? stateChannels[0])?.channel ?? null;

  const continuous = channels?.continuous ?? [];
  const varChannels = (varSel ?? channels?.default_var ?? []).filter((c) => continuous.includes(c));

  const seq = useMemo(() => {
    if (!rows || !channel || tab === 'var') return null;
    try {
      if (tab === 'sequences') return { views: sequenceViews(rows, { channel }), members: null, error: null };
      if (tab === 'cooccurrence') return { views: cooccurrenceNetworks(rows, { channel }), members: null, error: null };
      if (tab === 'interaction') return { views: interactionNetworks(rows, { channel }), members: null, error: null };
      const m = memberNetworks(rows, { channel, member_a: memberA, member_b: memberB });
      return { views: m.views, members: m, error: null };
    } catch (err) {
      return { views: [] as NetworkView[], members: null, error: errorText(err) };
    }
  }, [rows, channel, tab, memberA, memberB]);

  // ── Co-occurrence bootstrap (on demand; ~0.1–0.5 s, main thread) ───────
  const bootKey = JSON.stringify([dataKey, groupId, effScope, span, channel]);
  const bootNow = boot && boot.key === bootKey ? boot.result : null;
  const runBootstrap = () => {
    if (!rows || !channel) return;
    setNetworks({ boot: { key: bootKey, result: bootstrapCooccurrence(rows, { channel, iter: 1000, seed: 42 }) } });
  };

  // ── VAR fits (worker) ───────────────────────────────────────────────────
  const fitKey = JSON.stringify([dataKey, groupId, effScope, span, varChannels]);

  const startFit = () => {
    let allRows;
    try {
      allRows = networkRows(timelines, { scope: 'all', span });
    } catch (err) {
      failVarFit(fitKey, { result: null, error: { source: 'oyon', code: (err as { code?: string }).code ?? 'error', message: (err as Error).message }, thread: 'main', note: null, elapsed_ms: 0 });
      return;
    }
    startVarFit(fitKey, { rows: allRows, group_id: groupId, channels: varChannels, scope: effScope });
  };

  const varPainted = useMemo(() => {
    const result = fit?.outcome?.result;
    if (!result) return null;
    try {
      return { sections: varNetworkViews(result), error: null as string | null };
    } catch (err) {
      return { sections: [] as VarSection[], error: errorText(err) };
    }
  }, [fit?.outcome]);

  const prefix = effScope === 'all' ? 'all-groups' : groupId;
  const spanText = span ? `${span.start_s.toFixed(0)}–${span.end_s.toFixed(0)} s` : 'whole session';
  const scopeText = effScope === 'all' ? `all ${groupIds.length} groups` : `group ${groupId}`;

  const coding = tab === 'interaction'
    ? `Coded in ${INTERACTION_BIN_S} s bins (ladyna codeStates; continuous channels → per-person terciles low / mid / high); an interaction is a member changing state within τ = ${INTERACTION_TAU_S} s of another.`
    : `Coded in ${NETWORK_BIN_S} s bins (ladyna codeStates; continuous channels → per-person terciles low / mid / high).`;
  const info = tab === 'var' ? (
    <>
      <p>{scopeText} · {spanText}.</p>
      <p>psychaj mlVAR with members as subjects and with groups as subjects, and graphicalVAR for group {groupId}, on the raw values (<code>raw: true</code>) of the ticked channels. graphicalVAR takes a few seconds; the fit runs in a background worker.</p>
      <p>Temporal networks read from row (t − 1) → column (t): an edge is how one channel predicts another one tick later. Contemporaneous: partial correlations within the same tick. Between-subject (mlVAR): partial correlations of the subjects' means, which needs the means to vary.</p>
      {fit?.outcome ? <p>Fitted on the {fit.outcome.thread === 'worker' ? 'worker thread' : 'main thread'} in {(fit.outcome.elapsed_ms / 1000).toFixed(1)} s.</p> : null}
    </>
  ) : (
    <>
      <p>{scopeText} · {spanText}. Models from ladyna, pictures from ladyna painters.</p>
      <p>{coding}</p>
      {tab === 'cooccurrence' ? <p>Bootstrap (ladyna <code>bootstrapTna</code>, 1,000 resamples, seed 42): keeps the edges whose weight is stable across resampled bins (within ±25 %). Stable means reliable; it is not a test against chance.</p> : null}
      {bootNow && !bootNow.error && tab === 'cooccurrence' ? <p>{bootNow.n_significant} of {bootNow.n_pairs} member-state pairs stable, from {bootNow.n_bins} bins.</p> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented label="Dynamics view" value={tab} options={NETWORK_TABS} onChange={setTab} />
          {groupIds.length > 1 ? (
            <Segmented
              label="Rows"
              value={effScope}
              options={[{ id: 'group' as Scope, label: `Group ${groupId}` }, { id: 'all' as Scope, label: `All ${groupIds.length} groups` }]}
              onChange={setScope}
            />
          ) : null}
          {rows && tab !== 'var' && stateChannels.length ? (
            <InlineSelect
              label="channel"
              value={channel ?? ''}
              options={stateChannels.map((c) => ({ value: c.channel, label: c.label }))}
              onChange={setChannelSel}
            />
          ) : null}
          {rows && tab === 'member' && seq?.members && seq.members.members.length > 1 ? (
            <>
              <InlineSelect
                label="difference A"
                value={seq.members.member_a ?? ''}
                options={seq.members.members.map((m) => ({ value: m, label: m }))}
                onChange={setMemberA}
              />
              <InlineSelect
                label="B"
                value={seq.members.member_b ?? ''}
                options={seq.members.members.filter((m) => m !== seq.members?.member_a).map((m) => ({ value: m, label: m }))}
                onChange={setMemberB}
              />
            </>
          ) : null}
          {rows && tab === 'cooccurrence' && channel ? (
            <Button size="sm" variant="outline" onClick={runBootstrap}>Bootstrap edges</Button>
          ) : null}
          {rows && tab === 'var' ? (
            <>
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2" role="group" aria-label="Continuous channels">
                <span>channels</span>
                {continuous.length ? continuous.map((c) => (
                  <label key={c} className="inline-flex items-center gap-1 text-ink-1">
                    <input
                      type="checkbox"
                      checked={varChannels.includes(c)}
                      onChange={(e) => setVarSel(e.target.checked ? [...varChannels, c] : varChannels.filter((x) => x !== c))}
                    />
                    {c}
                  </label>
                )) : <span className="text-ink-3">none in this span</span>}
              </span>
              <Button size="sm" variant="primary" disabled={fit?.running || varChannels.length === 0} onClick={startFit}>
                {fit?.running ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                {fit?.running ? 'Fitting…' : 'Fit networks'}
              </Button>
              {fit?.running ? <Button size="sm" variant="outline" onClick={cancelFit}>Cancel</Button> : null}
            </>
          ) : null}
          <InfoTip label={NETWORK_TABS.find((t) => t.id === tab)?.label ?? 'this view'}>{info}</InfoTip>
        </div>

        {rowsState.error ? <p className="m-0 text-xs text-status-bad">{rowsState.error}</p> : null}

        {rows && tab !== 'var' ? (
          <>
            {!channel ? <p className="m-0 text-xs text-ink-3">No channel with valid values in this span.</p> : null}
            {seq?.error ? <p className="m-0 text-xs text-status-bad">{seq.error}</p> : null}
            {seq?.views.length ? <Figures views={seq.views} prefix={prefix} columns={tab === 'member' ? 1 : 2} /> : null}
            {tab === 'cooccurrence' && channel && bootNow ? (
              bootNow.error ? <NetworkErrorLine error={bootNow.error} /> : (
                <>
                  {bootNow.n_significant === 0
                    ? <Notice>No member-state pair is stable with {bootNow.n_bins} bins; pool all groups or widen the span.</Notice>
                    : null}
                  <Figures views={[bootNow.view]} prefix={prefix} columns={1} />
                  <div className="max-h-80 overflow-auto rounded border border-line">
                    <table className="w-full border-separate border-spacing-0 text-xs">
                      <thead className="sticky top-0 bg-surface-1">
                        <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                          <th className="px-2 py-1.5 font-medium">pair</th>
                          <th className="px-2 py-1.5 font-medium" title="bins the pair co-occurs in, with the 95 % bootstrap interval">bins · 95 % CI</th>
                          <th className="px-2 py-1.5 text-right font-medium">p</th>
                          <th className="px-2 py-1.5 font-medium">stable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const top = Math.max(1, ...bootNow.edges.map((e) => e.ci_upper));
                          return bootNow.edges.map((e) => (
                            <tr key={e.pair} className="odd:bg-surface-1">
                              <td className="px-2 py-2 font-medium text-ink-0">{e.pair}</td>
                              <td className="px-2 py-2">
                                <BarCell value={e.weight} min={0} max={top} range={[e.ci_lower, e.ci_upper]}
                                  colour={e.significant ? '#009E73' : '#999999'}
                                  text={`${e.weight} · ${e.ci_lower.toFixed(0)}–${e.ci_upper.toFixed(0)}`} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">{e.p.toFixed(3)}</td>
                              <td className="px-2 py-2">
                                <span className={e.significant
                                  ? 'rounded-full bg-status-ok-dim px-2 py-0.5 font-medium text-status-ok'
                                  : 'rounded-full bg-surface-2 px-2 py-0.5 text-ink-3'}>
                                  {e.significant ? 'stable' : 'not stable'}
                                </span>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            ) : null}
          </>
        ) : null}

        {rows && tab === 'var' ? (
          <>
            {fit && !fit.running && fit.key !== fitKey && fit.outcome ? (
              <Notice>The span, group, rows or channels changed since this fit; press Fit networks to refit.</Notice>
            ) : null}
            {fit && !fit.running && !fit.outcome ? <p className="m-0 text-xs text-ink-3">Fit cancelled.</p> : null}
            {fit?.outcome?.note ? <Notice>{fit.outcome.note}</Notice> : null}
            {fit?.outcome?.error ? <NetworkErrorLine error={fit.outcome.error} /> : null}
            {varPainted?.error ? <p className="m-0 text-xs text-status-bad">{varPainted.error}</p> : null}
            {varPainted?.sections.map((s) => <VarSectionBlock key={s.id} section={s} prefix={prefix} />)}
          </>
        ) : null}
    </div>
  );
}
