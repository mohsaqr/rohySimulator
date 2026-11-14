import type { VoiceMetrics } from '../../../../../types/voice';
import { getColor, linearScale } from '../analytics/charts/chartMath';
import { turnMetricSeries, measuredRuns } from '@/lib/voiceChartMath.js';
import type { TurnMetricSeries } from '@/lib/voiceChartMath';

/*
 * VoiceTurnTrends — the ACROSS-turn view: one small panel per metric, turn
 * index on x, the metric on y. Every other voice chart is scoped to a single
 * turn, which makes a session read as disconnected snapshots; this is the
 * only place a trajectory is visible — did the speaker warm up, run out of
 * things to say, get quieter, start hesitating more.
 *
 * Honesty rules:
 *  - A turn whose metric was not measured (pitch below the voiced-frame
 *    floor, a ratio with a zero denominator) is a GAP: no dot, and the
 *    connecting line BREAKS rather than spanning it (`measuredRuns`).
 *    Bridging would draw a trend through turns where nothing was measured.
 *  - Turns flagged `insufficient_data` are drawn hollow with a warn ring:
 *    plotted because the value was measured, marked because it is not
 *    comparable. Never silently mixed into the trend's visual weight.
 *  - Each panel states `measured/total` so a sparse series cannot pass for
 *    a complete one.
 *  - No smoothing, no regression line. With the handful of turns a session
 *    typically produces, a fitted slope would read as far more evidence than
 *    exists; the reader gets the observations.
 */

export interface VoiceTurnTrendsProps {
  turns: Array<{ voice: VoiceMetrics }>;
  /** Index of the turn currently selected on the page — highlighted in every panel. */
  selectedIndex?: number | null;
  onSelectIndex?: (index: number) => void;
}

interface PanelSpec {
  key: string;
  label: string;
  unit: string;
  pick: (voice: VoiceMetrics) => number | null;
  format: (value: number) => string;
  /** Why this metric can be absent — shown when a panel has gaps. */
  absent: string;
}

const PANELS: PanelSpec[] = [
  {
    key: 'speech_ratio',
    label: 'Speech ratio',
    unit: '%',
    pick: (voice) => (voice.speech_ratio == null ? null : voice.speech_ratio * 100),
    format: (value) => `${value.toFixed(0)}%`,
    absent: 'zero-length turn',
  },
  {
    key: 'pitch_median_hz',
    label: 'Median F0',
    unit: 'Hz',
    pick: (voice) => voice.pitch_median_hz,
    format: (value) => `${value.toFixed(0)} Hz`,
    absent: 'below the voiced-frame floor',
  },
  {
    key: 'pause_rate',
    label: 'Pause rate',
    unit: '/min',
    pick: (voice) =>
      voice.turn_duration_ms > 0
        ? voice.internal_pause_count / (voice.turn_duration_ms / 60000)
        : null,
    format: (value) => `${value.toFixed(1)}/min`,
    absent: 'zero-length turn',
  },
  {
    key: 'segment_mean',
    label: 'Mean speech run',
    unit: 's',
    pick: (voice) =>
      voice.segment_duration_mean_ms == null ? null : voice.segment_duration_mean_ms / 1000,
    format: (value) => `${value.toFixed(1)}s`,
    absent: 'no speech segments',
  },
];

const W = 320;
const H = 132;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;

function TrendPanel({
  spec,
  series,
  turnCount,
  selectedIndex,
  onSelectIndex,
}: {
  spec: PanelSpec;
  series: TurnMetricSeries;
  turnCount: number;
  selectedIndex: number | null;
  onSelectIndex?: (index: number) => void;
}) {
  const color = getColor(0);
  const gaps = series.n - series.measured;

  if (series.measured === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="m-0 text-xs font-medium text-ink-1">{spec.label}</p>
        <p className="m-0 text-xs text-ink-3">
          Not measured in any of the {series.n} turn{series.n === 1 ? '' : 's'} — {spec.absent}.
        </p>
      </div>
    );
  }

  // A single measured turn has no trend; pad the domain so the lone dot sits
  // mid-panel instead of on an axis line implying it sat at a boundary.
  const lo = series.min as number;
  const hi = series.max as number;
  const pad = hi > lo ? (hi - lo) * 0.15 : Math.max(1, Math.abs(hi) * 0.1);
  const yScale = linearScale([lo - pad, hi + pad], [H - PAD_B, PAD_T]);

  const plotW = W - PAD_L - PAD_R;
  // Turn slots are centred in equal-width columns, so a single turn is centred
  // rather than pinned to the left edge.
  const slot = plotW / Math.max(1, turnCount);
  const xOf = (index: number) => PAD_L + slot * (index + 0.5);

  const runs = measuredRuns(series.points);
  const last = [...series.points].reverse().find((point) => point.value !== null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="m-0 text-xs font-medium text-ink-1">{spec.label}</p>
        <p className="m-0 text-xs tabular-nums text-ink-2">
          {last?.value != null ? spec.format(last.value) : '—'}
          <span className="ml-1 text-ink-3">latest</span>
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${spec.label} across ${series.n} turns; ${series.measured} measured, ${gaps} not measured`}
      >
        <title>{spec.label} across turns</title>

        {yScale.ticks(3).map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={yScale(v)} x2={W - PAD_R} y2={yScale(v)} stroke="var(--line)" />
            <text x={PAD_L - 5} y={yScale(v) + 3} textAnchor="end" fontSize={9} fill="var(--ink-3)">
              {Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Selected-turn highlight: the column the rest of the page is showing. */}
        {selectedIndex != null && selectedIndex >= 0 ? (
          <rect
            x={PAD_L + slot * selectedIndex}
            y={PAD_T}
            width={slot}
            height={H - PAD_T - PAD_B}
            fill="var(--surface-2)"
            opacity={0.8}
          />
        ) : null}

        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--line-strong)" />
        <text x={W - PAD_R} y={H - 4} textAnchor="end" fontSize={9} fill="var(--ink-3)">
          turn →
        </text>

        {/* Lines only across CONSECUTIVE measured turns — gaps stay gaps. */}
        {runs.map((run, i) =>
          run.length >= 2 ? (
            <path
              key={`run-${i}`}
              d={run
                .map((p, j) => `${j === 0 ? 'M' : 'L'}${xOf(p.index)},${yScale(p.value)}`)
                .join('')}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              opacity={0.75}
            />
          ) : null,
        )}

        {series.points.map((point) => {
          if (point.value === null) {
            // Absence is DRAWN, not omitted: a tick on the axis marks a turn
            // that happened but produced no measurement.
            return (
              <line
                key={`gap-${point.index}`}
                x1={xOf(point.index)}
                y1={H - PAD_B - 3}
                x2={xOf(point.index)}
                y2={H - PAD_B + 3}
                stroke="var(--ink-3)"
                strokeDasharray="1 1"
              />
            );
          }
          const cx = xOf(point.index);
          const cy = yScale(point.value);
          return (
            <g
              key={`pt-${point.index}`}
              onClick={onSelectIndex ? () => onSelectIndex(point.index) : undefined}
              style={onSelectIndex ? { cursor: 'pointer' } : undefined}
            >
              {/* Generous invisible hit target — a 3px dot is not clickable. */}
              {onSelectIndex ? <circle cx={cx} cy={cy} r={9} fill="transparent" /> : null}
              <circle
                cx={cx}
                cy={cy}
                r={point.index === selectedIndex ? 4 : 3}
                fill={point.flagged ? 'var(--surface-0)' : color}
                stroke={point.flagged ? 'var(--status-warn)' : color}
                strokeWidth={point.flagged ? 1.5 : 1}
              />
            </g>
          );
        })}
      </svg>
      {gaps > 0 ? (
        <p className="m-0 text-mini text-ink-3">
          {series.measured} of {series.n} turns measured — the rest: {spec.absent}.
        </p>
      ) : null}
    </div>
  );
}

export function VoiceTurnTrends({ turns, selectedIndex, onSelectIndex }: VoiceTurnTrendsProps) {
  if (!turns || turns.length === 0) {
    return <p className="m-0 text-sm text-ink-3">No turns to trend.</p>;
  }
  if (turns.length === 1) {
    return (
      <p className="m-0 text-sm text-ink-3">
        One turn only — a trajectory needs at least two. Record another turn and this becomes the
        session view; a single point is already fully described by the turn table above.
      </p>
    );
  }

  const flagged = turns.filter((turn) => turn.voice.insufficient_data).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {PANELS.map((spec) => (
          <TrendPanel
            key={spec.key}
            spec={spec}
            series={turnMetricSeries(turns, spec.pick)}
            turnCount={turns.length}
            selectedIndex={selectedIndex ?? null}
            onSelectIndex={onSelectIndex}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true">
            <circle cx={5} cy={5} r={3} fill={getColor(0)} />
          </svg>
          measured turn
        </span>
        {flagged > 0 ? (
          <span className="inline-flex items-center gap-1">
            <svg width={10} height={10} aria-hidden="true">
              <circle cx={5} cy={5} r={3} fill="var(--surface-0)" stroke="var(--status-warn)" strokeWidth={1.5} />
            </svg>
            flagged insufficient ({flagged}) — plotted, not comparable
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true">
            <line x1={5} y1={1} x2={5} y2={9} stroke="var(--ink-3)" strokeDasharray="1 1" />
          </svg>
          turn with no measurement (line breaks — never bridged)
        </span>
      </div>
      <p className="m-0 text-xs text-ink-3">
        Reads: a falling speech ratio with a rising pause rate is a speaker running out of things
        to say; median F0 drifting down across turns is fatigue or growing comfort; shortening
        speech runs mean production is getting more fragmented. Click a point to inspect that turn
        below.
      </p>
    </div>
  );
}
