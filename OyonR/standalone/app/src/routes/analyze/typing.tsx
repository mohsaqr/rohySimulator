import { useMemo, useState } from 'react';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import { StateDistributionBars } from '@/components/charts/StateDistributionBars';
import { TypingProgressionChart } from '@/components/charts/TypingProgressionChart';
import { TypingProductionCurve } from '@/components/charts/TypingProductionCurve';
import { TypingIkiDistribution } from '@/components/charts/TypingIkiDistribution';
import { TypingBurstStrip } from '@/components/charts/TypingBurstStrip';
import { TypingStatsPanel } from '@/components/typing/TypingStatsPanel';
import { useStoredTypingWindows, type StoredTypingWindow } from '@/lib/storedTypingWindows';
import {
  aggregateTypingEpisodes,
  episodeCharsPerMin,
  pauseBucketLabel,
  summarizeTypingBy,
} from '@/lib/typingAnalytics';
import { useRecordScope } from '@/lib/recordScope';
import {
  TypingByDayTable,
  TypingByPersonTable,
  TypingBySessionTable,
  TypingPersonComparison,
} from '@/components/typing/TypingScopeTables';

/*
 * Analyze · Typing — the writing-process dashboard over typing episode
 * windows (`modality === 'typing'` in the `signal_windows` store). NOT a
 * sequence view: transitions between typing states already live on Dynamics
 * (typing channel). This page reads the keystroke-logging metrics the
 * aggregator computes per episode (docs/TYPING.md) and pools them:
 * production, pausing (location is the most diagnostic measure in the
 * keystroke-logging literature — Leijten & Van Waes — so it leads the
 * section), P- vs R-bursts (Chenoweth & Hayes), and revision behaviour,
 * plus a per-episode table whose selected row drives the shared
 * TypingStatsPanel detail AND the four writing-process charts (progression,
 * production curve, IKI distribution, burst strip). The charts are strictly
 * per-episode — pooling a progression graph across episodes is meaningless —
 * so they follow the table's selected row.
 *
 * Null discipline: a `—` here means "not measured" (e.g. the capture adapter
 * never supplied word counts or boundary contexts, or rows predate
 * typing-v3), never "zero" — see lib/typingAnalytics.ts.
 */

const PAUSE_LOCATION_LABELS: Record<string, string> = {
  mid_word: 'Mid-word',
  word_boundary: 'Word boundary',
  sentence_boundary: 'Sentence boundary',
  paragraph_boundary: 'Paragraph boundary',
};

function relabel(
  counts: Record<string, number>,
  toLabel: (key: string) => string,
): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [toLabel(key), count]));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatStart(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : iso;
}

function episodeKey(episode: StoredTypingWindow, index: number): string {
  return episode.window_id ?? `${episode.window_start}|${index}`;
}

export function TypingView() {
  const { data: episodes = [], isLoading } = useStoredTypingWindows();
  const summary = useMemo(() => aggregateTypingEpisodes(episodes), [episodes]);
  // Person and group scopes (host-fed embeds) add their own tables: a person
  // gets a per-session table and a by-day trend; a group gets one row per
  // person and a two-person comparison. The pooled sections below are the
  // same page in every scope, over whatever episodes the scope allows.
  const { scope, wide } = useRecordScope();
  const personRows = useMemo(
    () => (wide ? summarizeTypingBy(episodes, { by: 'person' }) : []),
    [episodes, wide],
  );

  // Selected row drives the per-episode detail; default is the most recent
  // episode (episodes arrive sorted by window_start ascending).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedIndex = useMemo(() => {
    if (selectedKey !== null) {
      const index = episodes.findIndex((episode, i) => episodeKey(episode, i) === selectedKey);
      if (index >= 0) return index;
    }
    return episodes.length - 1;
  }, [episodes, selectedKey]);
  const selectedEpisode = episodes[selectedIndex] ?? null;

  if (isLoading) {
    return <EmptyState title="Loading typing episodes…" />;
  }
  if (episodes.length === 0) {
    return (
      <EmptyState
        title="No typing episodes yet"
        description="Typing analytics need at least one finished composition episode. Enable typing capture, write into a registered composer, and submit or abandon it — the episode window lands here."
      />
    );
  }

  const locationBars = summary.pauseLocationCounts
    ? relabel(summary.pauseLocationCounts, (key) => PAUSE_LOCATION_LABELS[key] ?? key)
    : null;
  const histogramBars = relabel(summary.pauseHistogram, pauseBucketLabel);

  return (
    <div className="flex flex-col gap-6">
      {wide ? (
        <Section
          id="typ-people"
          title="People"
          description="Each person's episodes pooled into one row. Share of text is the person's net committed graphemes out of everyone's in view."
        >
          <div className="flex flex-col gap-4">
            <TypingByPersonTable rows={personRows} />
            {personRows.length >= 2 ? <TypingPersonComparison rows={personRows} /> : null}
          </div>
        </Section>
      ) : null}

      <Section
        id="typ-production"
        title="Production"
        description={`${summary.episodes} episode${summary.episodes === 1 ? '' : 's'} · ${formatDuration(summary.totalElapsedMs)} writing time · ${formatDuration(summary.totalActiveMs)} active. Rates divide pooled totals, not averaged per-episode rates.`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Metric label="Chars/min" value={summary.charsPerMin} format={(v) => v.toFixed(1)} />
          <Metric
            label="Chars/min (active)"
            value={summary.charsPerMinActive}
            format={(v) => v.toFixed(1)}
            hint="over hands-on-keys time only"
          />
          <Metric label="Words/min" value={summary.wordsPerMin} format={(v) => v.toFixed(1)} />
          <Metric
            label="Words/min (active)"
            value={summary.wordsPerMinActive}
            format={(v) => v.toFixed(1)}
            hint="over hands-on-keys time only"
          />
          <Metric
            label="Net added"
            value={summary.netGraphemes}
            unit="graphemes"
            format={(v) => v.toLocaleString()}
            hint="inserted minus deleted in these episodes; negative when more was removed than written"
          />
          <Metric
            label="Produced"
            value={summary.producedGraphemes}
            unit="graphemes"
            format={(v) => v.toLocaleString()}
            hint="everything typed"
          />
          <Metric
            label="Product ratio"
            value={summary.productRatio}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            hint="share of typed text that survived"
          />
        </div>
      </Section>

      <Section
        id="typ-pausing"
        title="Pausing"
        description="Where a writer pauses is more diagnostic than how long: mid-word pauses signal transcription trouble, clause/sentence boundaries signal planning (keystroke-logging literature)."
      >
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Pause location</CardTitle>
              <CardMeta>pauses bucketed by where the caret sat</CardMeta>
            </CardHeader>
            <CardContent>
              {locationBars ? (
                <StateDistributionBars frequencies={locationBars} order="given" />
              ) : (
                <p className="m-0 text-sm text-ink-3">
                  Not measured — no episode carried caret boundary contexts (typing-v3 capture required).
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pause lengths</CardTitle>
              <CardMeta>inter-edit intervals per duration bucket</CardMeta>
            </CardHeader>
            <CardContent>
              <StateDistributionBars frequencies={histogramBars} order="given" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="typ-bursts"
        title="Bursts"
        description="Runs of uninterrupted production. A burst ended by a pause (P-burst) and one ended by a revision (R-burst) are theoretically distinct events (Chenoweth & Hayes)."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="P-bursts" value={summary.pBurstCount} hint="ended by a pause" />
          <Metric label="R-bursts" value={summary.rBurstCount} hint="ended by a revision" />
          <Metric
            label="Mean P-burst length"
            value={summary.pBurstMeanGraphemes}
            unit="graphemes"
            format={(v) => v.toFixed(1)}
          />
          <Metric
            label="Mean R-burst length"
            value={summary.rBurstMeanGraphemes}
            unit="graphemes"
            format={(v) => v.toFixed(1)}
          />
        </div>
      </Section>

      <Section id="typ-revision" title="Revision">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            label="Revision ratio"
            value={summary.revisionRatio}
            format={(v) => v.toFixed(2)}
            hint="deleted / inserted graphemes"
          />
          <Metric
            label="Mean revision distance"
            value={summary.revisionDistanceMean}
            unit="graphemes"
            format={(v) => v.toFixed(1)}
            hint="back from the text's leading edge"
          />
          <Metric
            label="Leading-edge revisions"
            value={summary.leadingEdgeRevisionRatio}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            hint="revisions at or near the point of inscription"
          />
          <Metric label="Corrections" value={summary.correctionCount} hint="accepted correction events" />
        </div>
      </Section>

      {scope === 'person' ? (
        <Section
          id="typ-sessions"
          title="Sessions and days"
          description="The same pooled measures per session and per calendar day."
        >
          <div className="flex flex-col gap-4">
            <TypingBySessionTable episodes={episodes} />
            <TypingByDayTable episodes={episodes} />
          </div>
        </Section>
      ) : null}

      <Section
        id="typ-episodes"
        title="Episodes"
        description="One row per composition episode. Select a row to inspect its full metrics below."
      >
        <Card>
          <CardHeader>
            <CardTitle>Typing episodes</CardTitle>
            <CardMeta>
              {summary.episodes} total · {summary.submitted} submitted · {summary.abandoned} abandoned
            </CardMeta>
          </CardHeader>
          <CardContent>
            {/* Five columns of timestamps and counts do not fit a narrow
                viewport. Without a scroll container of its own the table
                widens its ancestors instead, and the whole PAGE scrolls
                sideways — the one thing a layout must never do. */}
            <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="py-1.5 pr-3 font-semibold">Start</th>
                  <th className="py-1.5 pr-3 font-semibold">Elapsed</th>
                  <th className="py-1.5 pr-3 font-semibold" title="The whole text's length when the episode ended, including what was there before it">Text length</th>
                  <th className="py-1.5 pr-3 font-semibold">Outcome</th>
                  <th className="py-1.5 pr-3 font-semibold">Chars/min</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((episode, index) => {
                  const key = episodeKey(episode, index);
                  const rate = episodeCharsPerMin(episode.typing);
                  const isSelected = index === selectedIndex;
                  return (
                    <tr
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      aria-selected={isSelected}
                      className={`cursor-pointer border-b border-line text-ink-1 hover:bg-surface-1 ${isSelected ? 'bg-surface-1' : ''}`}
                    >
                      <td className="py-1.5 pr-3">{formatStart(episode.window_start)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatDuration(episode.typing.elapsed_ms)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{episode.typing.committed_graphemes.toLocaleString()}</td>
                      <td className="py-1.5 pr-3">{episode.typing.submitted ? 'submitted' : episode.typing.abandoned ? 'abandoned' : '—'}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{rate === null ? '—' : rate.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section
        id="typ-process"
        title="Writing process"
        description={
          selectedEpisode
            ? `Per-episode charts for the selected row — started ${formatStart(selectedEpisode.window_start)}, ${formatDuration(selectedEpisode.typing.elapsed_ms)}. Select a different episode above to switch; pooling these across episodes would be meaningless.`
            : undefined
        }
      >
        {selectedEpisode ? (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Progression</CardTitle>
                <CardMeta>
                  Look for vertical drops below the faint leading-edge line — each one is the writer
                  abandoning the point of inscription to revise earlier text.
                </CardMeta>
              </CardHeader>
              <CardContent>
                <TypingProgressionChart
                  typing={selectedEpisode.typing}
                  quality={selectedEpisode.quality}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Production curve</CardTitle>
                <CardMeta>
                  Flat shelves are pauses and downward steps are deletions — read the slope against
                  the dashed mean-rate line to spot acceleration and stalling.
                </CardMeta>
              </CardHeader>
              <CardContent>
                <TypingProductionCurve
                  typing={selectedEpisode.typing}
                  quality={selectedEpisode.quality}
                />
              </CardContent>
            </Card>
            <div className="grid items-stretch gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Pause-length distribution</CardTitle>
                  <CardMeta>
                    Check whether the conventional 2 s pause cut actually falls in the valley between
                    this writer&rsquo;s fluent-transcription mode and their deliberation tail.
                  </CardMeta>
                </CardHeader>
                <CardContent>
                  <TypingIkiDistribution
                    typing={selectedEpisode.typing}
                    quality={selectedEpisode.quality}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Burst strip</CardTitle>
                  <CardMeta>
                    Long pause-ended segments mean fluent, planning-limited writing; frequent
                    revision-ended segments mean production keeps getting interrupted to fix text.
                  </CardMeta>
                </CardHeader>
                <CardContent>
                  <TypingBurstStrip
                    typing={selectedEpisode.typing}
                    quality={selectedEpisode.quality}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-3">Select an episode above to chart its writing process.</p>
        )}
      </Section>

      <Section
        id="typ-detail"
        title="Episode detail"
        description={
          selectedEpisode
            ? `Started ${formatStart(selectedEpisode.window_start)} · ${formatDuration(selectedEpisode.typing.elapsed_ms)}`
            : undefined
        }
      >
        <TypingStatsPanel
          typing={selectedEpisode?.typing ?? null}
          quality={selectedEpisode?.quality}
        />
      </Section>
    </div>
  );
}
