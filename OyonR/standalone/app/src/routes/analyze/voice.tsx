import { useMemo, useState } from 'react';
import { IndexedDbOyonStore } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import { StatusPill } from '@/components/ui/StatusPill';
import { StateDistributionBars } from '@/components/charts/StateDistributionBars';
import { VoiceSpeechStrip } from '@/components/charts/VoiceSpeechStrip';
import { VoicePitchContour } from '@/components/charts/VoicePitchContour';
import { VoicePitchDistribution } from '@/components/charts/VoicePitchDistribution';
import { VoiceLoudnessEnvelope } from '@/components/charts/VoiceLoudnessEnvelope';
import { VoiceTurnTrends } from '@/components/charts/VoiceTurnTrends';
import { VoiceTurnComposition } from '@/components/charts/VoiceTurnComposition';
import { VoiceStatsPanel } from '@/components/voice/VoiceStatsPanel';
import { aggregateVoiceTurns, voicePauseBucketLabel } from '@/lib/voiceAnalytics';
import {
  STORED_VOICE_WINDOWS_QUERY_KEY,
  type StoredVoiceWindow,
} from '@/components/voice/useVoiceTest';
import type { IdbStoreRuntime } from '@/lib/idbTransport';
import { useSignalRecords, type StoredResult } from '@/lib/signalSource';

/*
 * Analyze · Voice — the voice dashboard over episode windows
 * (`modality === 'voice'` in the `signal_windows` store). NOT a sequence
 * view: transitions between voice states (speech/silence/pause/…) live on
 * Dynamics under the voice channel; this page reads the `voice-v1` metrics
 * the VoiceTurnAggregator computes per turn.
 *
 * Two scopes, deliberately separated and in this order:
 *
 *   SESSION (all turns) — pooled headline figures, the across-turn
 *     trajectory (VoiceTurnTrends) and where each turn's time went
 *     (VoiceTurnComposition). This is the only place a session reads as a
 *     trajectory rather than a pile of snapshots.
 *   TURN (the selected row) — structure (speech strip + loudness envelope),
 *     pitch (contour + distribution), then the full metric panel. These are
 *     strictly per-turn: pooling a pitch contour across turns is meaningless.
 *
 * The turns table sits between the two and drives everything below it; the
 * trend and composition charts are also click-to-select, so the session view
 * is a way INTO a turn rather than a separate reading.
 *
 * Null discipline (the aggregator's contract): `—` means "not measured" —
 * pitch statistics below the voiced-frame floor, ratios with a zero
 * denominator — never "zero". Turns flagged `insufficient_data` carry a
 * visible pill in the table, a warn ring in the trend panels AND the panel's
 * banner; low-quality input must not read as confident measurement. Rows
 * written by other transports may lack the app-additive `frame_series`; the
 * charts then render an explicit "not drawable" state naming the missing
 * field instead of inventing one.
 */

const SIGNAL_WINDOWS_STORE_NAME = 'signal_windows';

function isVoiceWindowLike(value: unknown): value is StoredVoiceWindow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StoredVoiceWindow>;
  return (
    row.modality === 'voice' &&
    typeof row.window_start === 'string' &&
    row.voice != null &&
    typeof row.voice === 'object'
  );
}

// Singleton readonly store handle, same pattern as storedTypingWindows.ts.
let idbStore: IdbStoreRuntime | null = null;
function getStore(): IdbStoreRuntime {
  if (!idbStore) {
    idbStore = new IndexedDbOyonStore({ dbName: 'oyon-app' }) as unknown as IdbStoreRuntime;
  }
  return idbStore;
}

async function readAllStoredVoiceWindows(): Promise<StoredVoiceWindow[]> {
  try {
    const rows = await getStore().getAll(SIGNAL_WINDOWS_STORE_NAME);
    return rows
      .filter(isVoiceWindowLike)
      .sort((a, b) => Date.parse(a.window_start) - Date.parse(b.window_start));
  } catch {
    return [];
  }
}

function byWindowStart(a: StoredVoiceWindow, b: StoredVoiceWindow): number {
  return Date.parse(a.window_start) - Date.parse(b.window_start);
}

/** Voice turns from the host's feed (scoped) when one is set, else the local store. */
function useStoredVoiceWindows(): StoredResult<StoredVoiceWindow> {
  return useSignalRecords<StoredVoiceWindow>({
    kind: 'signalWindows',
    queryKey: STORED_VOICE_WINDOWS_QUERY_KEY,
    queryFn: readAllStoredVoiceWindows,
    accept: isVoiceWindowLike,
    compare: byWindowStart,
  });
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

function turnKey(turn: StoredVoiceWindow, index: number): string {
  return turn.window_id ?? `${turn.window_start}|${index}`;
}

function relabel(
  counts: Record<string, number>,
  toLabel: (key: string) => string,
): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [toLabel(key), count]));
}

export function VoiceView() {
  const { data: turns = [], isLoading } = useStoredVoiceWindows();

  // Pooling rule and null discipline live in lib/voiceAnalytics.ts so the
  // session arithmetic is testable without React.
  const summary = useMemo(() => aggregateVoiceTurns(turns), [turns]);

  // Selected row drives every per-turn view; default is the most recent turn.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedIndex = useMemo(() => {
    if (selectedKey !== null) {
      const index = turns.findIndex((turn, i) => turnKey(turn, i) === selectedKey);
      if (index >= 0) return index;
    }
    return turns.length - 1;
  }, [turns, selectedKey]);
  const selected = turns[selectedIndex] ?? null;
  const selectByIndex = (index: number) => {
    const turn = turns[index];
    if (turn) setSelectedKey(turnKey(turn, index));
  };

  if (isLoading) {
    return <EmptyState title="Loading voice turns…" />;
  }
  if (turns.length === 0) {
    return (
      <EmptyState
        title="No voice turns yet"
        description="Voice analytics need at least one finished turn. Open Live → Test voice, enable voice capture, record a turn and stop it — the voice-v1 window lands here."
      />
    );
  }

  const pauseBars = relabel(summary.pauseHistogram, voicePauseBucketLabel);
  const selectedLabel = selected
    ? `turn ${selectedIndex + 1} of ${turns.length} — ${formatStart(selected.window_start)}, ${formatDuration(selected.voice.turn_duration_ms)}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Section
        id="voice-overview"
        title="Session"
        description={`${summary.turns} turn${summary.turns === 1 ? '' : 's'} · ${formatDuration(summary.totalTurnMs)} of turn time. Every rate divides pooled totals, so a long turn counts for more than a short one — these are not averages of per-turn figures.`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Turns" value={summary.turns} />
          <Metric label="Turn time" value={formatDuration(summary.totalTurnMs)} />
          <Metric
            label="Speech time"
            value={formatDuration(summary.totalSpeechMs)}
            hint="learner speech only"
          />
          <Metric
            label="Speech ratio"
            value={summary.pooledSpeechRatio}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            hint={summary.pooledSpeechRatio == null ? 'no turn time recorded' : 'pooled, not averaged'}
          />
          <Metric
            label="Pause rate"
            value={summary.pauseRatePerMin}
            format={(v) => `${v.toFixed(1)}/min`}
            hint={
              summary.pauseRatePerMin == null
                ? 'no turn time recorded'
                : `${summary.pauseCount} internal pause${summary.pauseCount === 1 ? '' : 's'}`
            }
          />
          <Metric
            label="Median F0 range"
            value={summary.pitchLo != null && summary.pitchHi != null ? summary.pitchLo : null}
            format={(v) =>
              summary.pitchHi != null && summary.pitchHi - v >= 1
                ? `${v.toFixed(0)}–${summary.pitchHi.toFixed(0)} Hz`
                : `${v.toFixed(0)} Hz`
            }
            hint={
              summary.withPitch === 0
                ? 'no turn reached the voiced-frame floor'
                : `across ${summary.withPitch} of ${summary.turns} turns`
            }
          />
        </div>
        {summary.insufficient > 0 ? (
          <p className="m-0 mt-3 flex items-center gap-2 text-xs text-ink-2">
            <StatusPill tone="warn" size="sm">
              {summary.insufficient} of {summary.turns} flagged
            </StatusPill>
            <span>
              Those turns did not support confident measurement, but their values ARE pooled into
              the figures above — excluding them would quietly change what the session means. They
              are marked everywhere they appear.
            </span>
          </p>
        ) : null}
      </Section>

      <Section
        id="voice-trends"
        title="Across turns"
        description="The session as a trajectory. Every other chart on this page describes one turn; this is where a change over the session becomes visible. Click any point to inspect that turn."
      >
        {/* Stacked, not side-by-side: both are wide-format charts. In a
            two-column grid the composition bars fell to ~58% scale, which
            put their in-bar duration labels below legibility — a chart you
            have to squint at is the problem this page is fixing. */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Trends</CardTitle>
              <CardMeta>
                Lines break at turns where the metric was not measured — a trend is never drawn
                through an absence.
              </CardMeta>
            </CardHeader>
            <CardContent>
              <VoiceTurnTrends
                turns={turns}
                selectedIndex={selectedIndex}
                onSelectIndex={selectByIndex}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Where each turn&rsquo;s time went</CardTitle>
              <CardMeta>
                One bar per turn, length proportional to duration. Two turns with the same speech
                ratio can look completely different here.
              </CardMeta>
            </CardHeader>
            <CardContent>
              <VoiceTurnComposition
                turns={turns}
                selectedIndex={selectedIndex}
                onSelectIndex={selectByIndex}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="voice-pausing"
        title="Pausing"
        description="Internal pauses only — silence bounded by speech on both sides. Leading and trailing silence are structural, never counted as hesitation."
      >
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Pause lengths</CardTitle>
              <CardMeta>every internal pause across all {summary.turns} turns</CardMeta>
            </CardHeader>
            <CardContent>
              {Object.keys(pauseBars).length > 0 ? (
                <StateDistributionBars frequencies={pauseBars} order="given" />
              ) : (
                <p className="m-0 text-sm text-ink-3">
                  No internal pauses recorded — every silence in these turns was leading or
                  trailing, which the aggregator treats as structure rather than hesitation.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pause load</CardTitle>
              <CardMeta>how much of the session was spent mid-turn silent</CardMeta>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Internal pauses" value={summary.pauseCount} />
                <Metric label="Time in pauses" value={formatDuration(summary.totalPauseMs)} />
                <Metric
                  label="Share of turn time"
                  value={summary.pauseShare}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                  hint={summary.pauseShare == null ? 'no turn time recorded' : undefined}
                />
                <Metric
                  label="Mean pause"
                  value={summary.meanPauseMs}
                  format={(v) => `${(v / 1000).toFixed(2)}s`}
                  hint={summary.meanPauseMs == null ? 'no internal pauses' : undefined}
                />
              </div>
              <p className="m-0 mt-3 text-xs text-ink-3">
                Read the distribution beside this, not the mean: a handful of long deliberations and
                a steady drip of short hesitations give the same average and mean different things.
              </p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="voice-turns"
        title="Turn table"
        description="One row per voice turn. The selected row drives every chart below."
      >
        <Card>
          <CardHeader>
            <CardTitle>Voice turns</CardTitle>
            <CardMeta>
              {summary.turns} total · {summary.insufficient} flagged insufficient
            </CardMeta>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th className="py-1.5 pr-3 font-semibold">#</th>
                    <th className="py-1.5 pr-3 font-semibold">Start</th>
                    <th className="py-1.5 pr-3 font-semibold">Duration</th>
                    <th className="py-1.5 pr-3 font-semibold">Speech ratio</th>
                    <th className="py-1.5 pr-3 font-semibold">Pauses</th>
                    <th className="py-1.5 pr-3 font-semibold">Pitch median</th>
                    <th className="py-1.5 pr-3 font-semibold">VAD</th>
                    <th className="py-1.5 pr-3 font-semibold">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {turns.map((turn, index) => {
                    const key = turnKey(turn, index);
                    const isSelected = index === selectedIndex;
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelectedKey(key)}
                        aria-selected={isSelected}
                        className={`cursor-pointer border-b border-line text-ink-1 hover:bg-surface-1 ${isSelected ? 'bg-surface-1' : ''}`}
                      >
                        <td className="py-1.5 pr-3 tabular-nums text-ink-3">{index + 1}</td>
                        <td className="py-1.5 pr-3">{formatStart(turn.window_start)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {formatDuration(turn.voice.turn_duration_ms)}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {turn.voice.speech_ratio == null
                            ? '—'
                            : `${(turn.voice.speech_ratio * 100).toFixed(0)}%`}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {turn.voice.internal_pause_count}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {turn.voice.pitch_median_hz == null
                            ? '—'
                            : `${turn.voice.pitch_median_hz.toFixed(0)} Hz`}
                        </td>
                        <td className="py-1.5 pr-3">
                          {turn.vad_engine === 'silero'
                            ? 'Silero'
                            : turn.vad_engine === 'energy'
                              ? 'energy fallback'
                              : '—'}
                        </td>
                        <td className="py-1.5 pr-3">
                          {turn.voice.insufficient_data ? (
                            <StatusPill tone="warn" size="sm">insufficient</StatusPill>
                          ) : (
                            <StatusPill tone="ok" size="sm">ok</StatusPill>
                          )}
                        </td>
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
        id="voice-structure"
        title="Turn structure"
        description={
          selectedLabel
            ? `Selected ${selectedLabel}. These are strictly per-turn — pooling a timeline across turns would be meaningless.`
            : undefined
        }
      >
        {selected ? (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Speech timeline</CardTitle>
                <CardMeta>
                  The strip that makes the speech ratio legible: band widths are time. Long silence
                  bands inside the turn are hesitation; a hatched band is the AI speaking —
                  excluded from every learner measurement.
                </CardMeta>
              </CardHeader>
              <CardContent>
                <VoiceSpeechStrip
                  frames={selected.frame_series ?? null}
                  voice={selected.voice}
                  quality={selected.quality ?? null}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Loudness envelope</CardTitle>
                <CardMeta>
                  Delivery dynamics under the speech bands: emphasis peaks, a decaying tail, or a
                  level that hugs the near-silence floor. Solid bars are the frames that make up
                  the reported mean.
                </CardMeta>
              </CardHeader>
              <CardContent>
                <VoiceLoudnessEnvelope
                  frames={selected.frame_series ?? null}
                  voice={selected.voice}
                  quality={selected.quality ?? null}
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-3">Select a turn above to chart its structure.</p>
        )}
      </Section>

      <Section
        id="voice-pitch"
        title="Pitch"
        description={
          selectedLabel
            ? `Intonation over time and its distribution, for ${selectedLabel}.`
            : undefined
        }
      >
        {selected ? (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Pitch contour</CardTitle>
                <CardMeta>
                  One mark per voiced frame; unvoiced audio stays a gap. Read the slope line for
                  rising/falling intonation, the band around the median for monotone delivery, and
                  the restart level after each gap for pitch resets at pauses.
                </CardMeta>
              </CardHeader>
              <CardContent>
                <VoicePitchContour
                  frames={selected.frame_series ?? null}
                  voice={selected.voice}
                  quality={selected.quality ?? null}
                  playbackIntervals={selected.turn_report?.playback_intervals ?? null}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Pitch distribution</CardTitle>
                <CardMeta>
                  The same frames without the time axis — the shape the median and IQR summarise.
                  Two humps mean two registers; one narrow peak means a steady one.
                </CardMeta>
              </CardHeader>
              <CardContent>
                <div className="max-w-lg">
                  <VoicePitchDistribution
                    frames={selected.frame_series ?? null}
                    voice={selected.voice}
                    quality={selected.quality ?? null}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-3">Select a turn above to chart its pitch.</p>
        )}
      </Section>

      <Section
        id="voice-detail"
        title="Turn detail"
        description={selectedLabel ? `Every measured figure for ${selectedLabel}.` : undefined}
      >
        <VoiceStatsPanel
          voice={selected?.voice ?? null}
          quality={selected?.quality ?? null}
          vadEngine={selected?.vad_engine ?? null}
        />
      </Section>
    </div>
  );
}
