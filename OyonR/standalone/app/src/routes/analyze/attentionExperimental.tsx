import { useMemo, type CSSProperties } from 'react';
import { FlaskConical } from 'lucide-react';
import type { EmotionWindow } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { StatusPill } from '@/components/ui/StatusPill';
import { LineChart, type Series } from '@/components/sensing/SensingCharts';
import {
  ATTENTION_STATE_META,
  buildAttentionAnalytics,
  type AttentionState,
} from '@/lib/attentionAnalytics.js';

const STATE_ORDER: AttentionState[] = ['focused', 'shifting', 'available', 'away', 'unmeasured'];
const ATTENTION_CARD = 'flex h-full min-h-[20rem] flex-col overflow-hidden';

function pct(value: number | null, digits = 0): string {
  return value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function EvidenceRow({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 last:border-b-0">
      <span className="text-xs text-ink-2">{label}</span>
      <span className="text-right text-sm font-medium tabular-nums text-ink-0">
        {value}
        {hint ? <span className="ml-1 text-micro font-normal text-ink-3">{hint}</span> : null}
      </span>
    </div>
  );
}

function AttentionRibbon({ states }: { states: AttentionState[] }) {
  return (
    <div
      className="flex h-10 overflow-hidden rounded border border-line bg-surface-0"
      role="img"
      aria-label={`Experimental attention states across ${states.length} windows`}
    >
      {states.map((state, index) => (
        <span
          key={`${index}-${state}`}
          className="h-full min-w-px flex-1"
          style={{ backgroundColor: ATTENTION_STATE_META[state].color } as CSSProperties}
          title={`Window ${index + 1}: ${ATTENTION_STATE_META[state].label}`}
        />
      ))}
    </div>
  );
}

function StateDistribution({ states, counts }: {
  states: AttentionState[];
  counts: Record<AttentionState, number>;
}) {
  const denominator = Math.max(1, states.length);
  return (
    <div className="flex flex-col gap-2.5">
      {STATE_ORDER.map((state) => {
        const meta = ATTENTION_STATE_META[state];
        const share = counts[state] / denominator;
        return (
          <div key={state} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2">
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: meta.color }} />
              {meta.label}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: meta.color }} />
            </span>
            <span className="text-right text-xs tabular-nums text-ink-3">{counts[state]} · {pct(share)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RankedRows({ rows, unit, empty }: {
  rows: Array<{ label: string; value: number }>;
  unit: string;
  empty: string;
}) {
  const visible = rows.slice(0, 4);
  if (visible.length === 0) return <p className="m-0 text-xs text-ink-3">{empty}</p>;
  const max = Math.max(...visible.map((row) => row.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {visible.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-ink-2">{row.label.replace(/->/g, ' → ')}</span>
            <span className="tabular-nums text-ink-1">{row.value.toLocaleString()} {unit}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-status-info" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AttentionExperimentalPanels({
  records,
  showSummary = true,
}: {
  records: EmotionWindow[];
  showSummary?: boolean;
}) {
  const analytics = useMemo(() => buildAttentionAnalytics(records), [records]);

  const focusedShare = analytics.states.length
    ? analytics.stateCounts.focused / analytics.states.length
    : null;
  const focusSeries: Series[] = [
    { name: 'focus score', color: '#2ea043', values: analytics.series.focus },
    { name: 'on screen', color: '#58a6ff', values: analytics.series.onScreen },
    { name: 'valid gaze', color: '#8b949e', values: analytics.series.gazeValid },
  ];
  const breathingRange = analytics.respiration.min == null || analytics.respiration.max == null
    ? '—'
    : `${analytics.respiration.min.toFixed(1)}–${analytics.respiration.max.toFixed(1)}`;
  const correlation = analytics.respiration.focusCorrelation;
  const correlationLabel = correlation == null
    ? 'Not estimated'
    : correlation > 0.25
      ? 'moves together'
      : correlation < -0.25
        ? 'moves oppositely'
        : 'little linear relation';

  return (
    <div className="flex flex-col gap-6">
      {showSummary ? (
        <Section
          id="attention-summary"
          title="Experimental attention analytics"
          description="Aggregate indicators of availability, visual engagement and shifting—not a validated measure of learning, comprehension or internal attention."
          actions={
            <StatusPill tone="warn" icon={<FlaskConical className="size-3" aria-hidden="true" />}>
              experimental
            </StatusPill>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Windows" value={analytics.windows.length} />
            <Metric label="Measured" value={`${analytics.measuredAttentionWindows} / ${analytics.windows.length}`} />
            <Metric label="Mean focus" value={pct(analytics.meanFocus)} />
            <Metric label="On screen" value={pct(analytics.meanOnScreen)} />
            <Metric label="Focused windows" value={pct(focusedShare)} />
            <Metric label="Fixations" value={analytics.totalFixations || null} hint="detected across windows" />
          </div>
        </Section>
      ) : null}

      <Section
        id="attention-signal"
        title="Availability and visual attention"
        description="The trace shows measured aggregates. The ribbon applies transparent thresholds to each window so possible episodes are easier to inspect."
        actions={
          <StatusPill tone="warn" icon={<FlaskConical className="size-3" aria-hidden="true" />}>
            experimental
          </StatusPill>
        }
      >
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <Card className={ATTENTION_CARD}>
            <CardHeader>
              <CardTitle>Measured signals over time</CardTitle>
              <span className="text-micro text-ink-3">0–100%</span>
            </CardHeader>
            <CardContent className="flex flex-1 items-center">
              <LineChart
                series={focusSeries}
                height={250}
                yDomain={[0, 1]}
                formatY={(value) => `${Math.round(value * 100)}%`}
              />
            </CardContent>
          </Card>

          <Card className={ATTENTION_CARD}>
            <CardHeader>
              <CardTitle>Descriptive state ribbon</CardTitle>
              <StatusPill tone="warn" size="sm">rule-based</StatusPill>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-5">
              <AttentionRibbon states={analytics.states} />
              <StateDistribution states={analytics.states} counts={analytics.stateCounts} />
              <p className="mt-auto mb-0 border-t border-line pt-3 text-mini leading-relaxed text-ink-3">
                Focused: focus ≥65%, off-screen ≤20% and usable gaze. Away: off-screen ≥35% or missing face ≥40%.
                Shifting describes visible, lower-focus windows with multiple fixations. Unmeasured remains separate.
              </p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="attention-episodes"
        title="Episodes and navigation"
        description="Session-level summaries retain time and AOI structure instead of collapsing everything into one score."
      >
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <Card className={ATTENTION_CARD}>
            <CardHeader><CardTitle>Attention episodes</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center px-5">
              <EvidenceRow label="Focused episodes" value={analytics.focusedRuns} />
              <EvidenceRow label="Longest focused run" value={formatDuration(analytics.longestFocusedRunMs)} />
              <EvidenceRow label="Away → focused recoveries" value={analytics.recoveries} />
              <EvidenceRow label="Shifting windows" value={analytics.stateCounts.shifting} />
              <EvidenceRow label="Mean usable gaze" value={pct(analytics.meanGazeValid)} />
              <EvidenceRow label="AOI transitions" value={analytics.totalTransitions || '—'} />
            </CardContent>
          </Card>

          <Card className={ATTENTION_CARD}>
            <CardHeader><CardTitle>Where attention moved</CardTitle></CardHeader>
            <CardContent className="grid flex-1 items-center gap-5 md:grid-cols-2">
              <div>
                <h3 className="label-eyebrow mt-0 mb-3">Top AOI transitions</h3>
                <RankedRows rows={analytics.topAoiTransitions} unit="moves" empty="No AOI transitions were captured." />
              </div>
              <div>
                <h3 className="label-eyebrow mt-0 mb-3">Top AOI dwell</h3>
                <RankedRows rows={analytics.topAoiDwell} unit="ms" empty="No AOI dwell was captured." />
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="attention-respiration"
        title="Respiration context"
        description="One exploratory cross-modal summary only. The full breathing trend has a single home in Heart & breathing."
      >
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Breathing × attention</CardTitle>
            <StatusPill tone="warn" size="sm">exploratory</StatusPill>
          </CardHeader>
          <CardContent className="grid gap-6 px-5 py-5 md:grid-cols-2 md:items-center">
            <div className="md:border-r md:border-line md:pr-6">
              <div>
                <div className="label-eyebrow">Focus–breathing correlation</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-4xl font-semibold tabular-nums tracking-tight text-ink-0">
                    {correlation == null ? '—' : correlation.toFixed(2)}
                  </span>
                  <span className="text-xs text-ink-2">{correlationLabel}</span>
                </div>
              </div>
              <p className="mt-4 mb-0 text-mini leading-relaxed text-ink-3">
                Pearson r is shown only with ≥5 paired windows. It is a within-session association, not evidence that breathing caused attention to change.
              </p>
            </div>
            <div>
              <EvidenceRow label="Overlapping windows" value={analytics.respiration.overlapWindows} hint={analytics.respiration.overlapWindows < 5 ? 'needs ≥5' : undefined} />
              <EvidenceRow label="Mean breathing rate" value={analytics.respiration.mean == null ? '—' : analytics.respiration.mean.toFixed(1)} hint="br/min" />
              <EvidenceRow label="Observed range" value={breathingRange} hint="br/min" />
              <EvidenceRow label="Mean signal quality" value={pct(analytics.respiration.meanConfidence)} />
              <EvidenceRow label="Mean RGB agreement" value={pct(analytics.respiration.meanRgbAgreement)} />
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
