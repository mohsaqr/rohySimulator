import { useChannelOptions } from '@/lib/channelOptions';
import { writingActEvents, writingActSequences } from 'oyon';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { lsa, plotLSAPolar } from 'legacy-tnaj';
import { describeSequences } from 'ladyna/sequences';
import { Section } from '@/components/ui/Section';
import { CentralityPanel } from '@/components/charts/CentralityPanel';
import { StateDistributionBars } from '@/components/charts/StateDistributionBars';
import { Select } from '@/components/ui/Select';
import {
  centralityRows,
  nodeRadiiFor,
  type NodeSizeKey,
} from '@/lib/centrality';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import { Button } from '@/components/ui/Button';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { useStoredEvents } from '@/lib/storedEvents';
import { buildSessionSequences, buildEventSequences } from '@/lib/tnaPooling';
import { channelUnit, channelLabel } from '@/lib/analyticsChannel';
import { useChannelStore } from '@/lib/channelStore';
import { LegacyContainer } from '@/legacy/LegacyCanvas';
import { loadDemoData } from '@/legacy/demoFixture.js';
import {
  computeTnaFromSequences,
  drawNetwork,
  renderIndexPlotPanel,
  renderDistributionPlotPanel,
  renderSequenceSummary,
} from '@/legacy/dashboard.js';

/* Sequence view — uses the legacy logs-dashboard renderers directly. */

function fitSunburstToCard(svg: string): string {
  // The card owns the title, so crop the header space reserved by TNA.js and
  // enlarge its tiny outer labels without changing the chart geometry.
  return svg
    .replace('viewBox="0 0 680 500"', 'viewBox="70 65 600 390"')
    .replace('.tiny{font-size:8px}', '.tiny{font-size:10px}');
}

export function SequenceView() {
  const { filtered: enriched, isLoading: windowsLoading } = useFilteredWindows();
  const { data: events = [], isLoading: eventsLoading } = useStoredEvents();
  const queryClient = useQueryClient();

  // Affect (emotion) is the default and reproduces the original behavior
  // exactly. Every other channel pools the signal-event log instead of
  // emotion windows — same `string[][]` shape, so nothing below this line
  // needs to know which channel is active. Shared with Patterns via
  // channelStore, so the selection carries across the two tabs.
  const channel = useChannelStore((s) => s.channel);
  const setChannel = useChannelStore((s) => s.setChannel);
  const channelOptions = useChannelOptions(channel, windowsLoading || eventsLoading ? null : { windows: enriched, events });
  const writingLevel = useChannelStore((s) => s.writingLevel);
  const setWritingLevel = useChannelStore((s) => s.setWritingLevel);
  const isLoading = channel === 'emotion' ? windowsLoading : eventsLoading;
  // The chosen channel's own events, not every channel's under its name.
  const recordCount = channel === 'emotion' ? enriched.length
    : channel === 'all' ? events.length
      : channel === 'writing' ? writingActEvents(events).length
        : events.filter((event) => event.modality === channel).length;
  const unit = channelUnit(channel);

  // One chain per session (or per session+capture for events), pooled by
  // dynajs tna() — no phantom transitions between distinct sessions/captures
  // when the filter scope aggregates them.
  const sequences = useMemo(
    () => channel === 'emotion'
      ? buildSessionSequences(enriched)
      : channel === 'writing' ? writingActSequences(events, { level: writingLevel })
        : buildEventSequences(events, channel === 'all' ? null : channel),
    [enriched, events, channel, writingLevel],
  );
  const tnaResult = useMemo(
    () => computeTnaFromSequences(sequences),
    [sequences],
  );
  const sunburstSvg = useMemo(() => {
    try {
      const fit = lsa(sequences);
      if (fit.kind !== 'lsa') return '';
      return fitSunburstToCard(plotLSAPolar(fit, {
        style: 'rose',
        fill: 'prob',
        size: 'count',
        labels: 'auto',
        width: 680,
        height: 500,
        title: 'Transition sunburst',
        subtitle: '',
        background: 'transparent',
      }));
    } catch {
      return '';
    }
  }, [sequences]);

  /*
   * Node sizing is OFF by default. Size is the first channel the eye reads, so
   * a diagram that encodes something the reader did not ask for is worse than
   * one that encodes nothing.
   */
  const [sizeBy, setSizeBy] = useState<NodeSizeKey>('none');
  const rows = useMemo(() => centralityRows(tnaResult?.centrality ?? null), [tnaResult]);
  const nodeRadii = useMemo(() => nodeRadiiFor(rows, sizeBy), [rows, sizeBy]);
  // Counts and the normalised state entropy come from ladyna describeSequences
  // (R-checked: tests/series-statistics-r-groundtruth.test.ts in ladyna).
  const overview = useMemo(() => {
    if (!tnaResult) return null;
    const d = describeSequences((tnaResult.sequences ?? []) as string[][]);
    return {
      sequences: d.nSequences,
      windows: d.nStates,
      meanLength: d.nSequences ? d.meanLength : 0,
      states: tnaResult.model?.labels?.length ?? d.alphabet.length,
      transitions: d.nTransitions,
      entropy: Number.isFinite(d.stateEntropy) ? d.stateEntropy : 0,
    };
  }, [tnaResult]);

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }

  // Demo data only seeds emotion windows (legacy/demoFixture.js) — there is
  // no synthetic typing/discourse/interaction/ai_assist event generator, so
  // the "Load demo data" action only makes sense on the emotion channel.
  const demoAction = channel === 'emotion' ? (
    <Button variant="primary" size="sm" onClick={handleLoadDemo}>
      <Database className="size-3.5" aria-hidden="true" />
      Load demo data
    </Button>
  ) : undefined;

  // Rendered above every branch below (including loading/empty) so switching
  // channels is always possible, not just once a channel already has data.
  const channelPicker = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full max-w-xs">
        <Select label="Channel" value={channel} options={channelOptions} onChange={setChannel} />
      </div>
      {channel === 'writing' ? (
        <div className="inline-flex overflow-hidden rounded border border-line text-xs" role="group" aria-label="Grain of the writing acts">
          {(['main', 'detail'] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={writingLevel === level}
              onClick={() => setWritingLevel(level)}
              className={writingLevel === level ? 'bg-status-info-dim px-2.5 py-1.5 font-medium text-status-info' : 'px-2.5 py-1.5 text-ink-2 hover:bg-surface-2'}
            >
              {level === 'main' ? 'Main acts' : 'With detail'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        {channelPicker}
        <EmptyState title="Loading…" />
      </div>
    );
  }
  if (recordCount === 0) {
    return (
      <div className="flex flex-col gap-6">
        {channelPicker}
        <EmptyState
          title={`No stored ${unit.plural} yet`}
          description={
            channel === 'emotion'
              ? 'Capture a session, or load synthetic demo data to populate every panel.'
              : `Capture a session with ${channelLabel(channel)} activity, or switch channels.`
          }
          action={demoAction}
        />
      </div>
    );
  }
  if (tnaResult == null) {
    return (
      <div className="flex flex-col gap-6">
        {channelPicker}
        <EmptyState
          title={`${recordCount} ${unit.singular}${recordCount === 1 ? '' : 's'} present, but no multi-${unit.singular} session`}
          description={`Sequence analytics need at least two ${unit.plural} in one session. Keep capturing${channel === 'emotion' ? ' or load demo data' : ''}.`}
          action={demoAction}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {channelPicker}
      <Section id="seq-overview" title="Sequence overview">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Sequences" value={overview?.sequences ?? null} />
          <Metric label={channel === 'emotion' ? 'Windows' : 'Events'} value={overview?.windows ?? null} />
          <Metric label="Mean length" value={overview ? overview.meanLength.toFixed(1) : null} />
          <Metric label="Distinct states" value={overview?.states ?? null} />
          <Metric label="Transitions" value={overview?.transitions ?? null} />
          <Metric label="State entropy" value={overview ? overview.entropy.toFixed(2) : null} hint="normalised 0–1" />
        </div>
      </Section>

      <Section
        id="seq-network"
        title="Transition network"
        description={
          channel === 'emotion'
            ? 'Which affective states the session moved between, and which of them are structurally central.'
            : `Which ${channelLabel(channel).toLowerCase()} states the session moved between, and which of them are structurally central.`
        }
      >
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <Card className="flex h-[34rem] min-h-0 flex-col overflow-hidden">
            <CardContent className="flex min-h-0 flex-1 p-3">
              <LegacyContainer
                render={(el) => drawNetwork(el, tnaResult, {
                  nodeRadii,
                  svgWidth: Math.max(1, el.clientWidth),
                  graphHeight: Math.max(1, el.clientHeight),
                })}
                deps={[tnaResult, nodeRadii]}
                className="min-h-0 w-full flex-1"
              />
            </CardContent>
          </Card>
          <Card className="flex h-[34rem] min-h-0 flex-col overflow-hidden">
            <CardHeader>
              <CardTitle>Centrality</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              <CentralityPanel
                rows={rows}
                sizeBy={sizeBy}
                onSizeBy={setSizeBy}
                sizingInert={sizeBy !== 'none' && nodeRadii === null}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="seq-dist" title="State distribution">
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <Card className="flex h-[32rem] min-h-0 flex-col overflow-hidden">
            <CardHeader>
              <CardTitle>Counts per state</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              <StateDistributionBars frequencies={tnaResult.freq} />
            </CardContent>
          </Card>
          <Card className="flex h-[32rem] min-h-0 flex-col overflow-hidden">
            <CardHeader>
              <CardTitle>Transition sunburst</CardTitle>
              <CardMeta>height = count · colour = probability</CardMeta>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 items-center justify-center p-2">
              {sunburstSvg
                ? (
                    <div
                      className="h-full w-full [&_.title]:hidden [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: sunburstSvg }}
                    />
                  )
                : <p className="m-0 text-sm text-ink-3">Not enough transitions for a sunburst yet.</p>}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="seq-plots" title="Sequence plots">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card id="seq-index">
            <CardHeader>
              <CardTitle>Sequence index plot</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyContainer
                render={(el) => renderIndexPlotPanel(el, tnaResult)}
                deps={[tnaResult]}
                className="w-full"
              />
            </CardContent>
          </Card>
          <Card id="seq-distplot">
            <CardHeader>
              <CardTitle>State distribution by timestep</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyContainer
                render={(el) => renderDistributionPlotPanel(el, tnaResult)}
                deps={[tnaResult]}
                className="w-full"
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="seq-summary" title="Spell statistics">
        <Card>
          <CardContent>
            <LegacyContainer
              render={(el) => renderSequenceSummary(el, tnaResult, { includeOverview: false })}
              deps={[tnaResult]}
              style={{ padding: 14 }}
            />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
