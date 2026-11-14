import type { TypingQuality } from 'oyon';
import type { TypingMetricsV3 } from '@/lib/storedTypingWindows';
import { getColor, linearScale, monotonePath } from '../analytics/charts/chartMath';
import {
  compressTimeAxis,
  axisTimeTicks,
  productionSeries,
  formatDurationShort,
} from '@/lib/typingChartMath.js';

/*
 * TypingProductionCurve — cumulative committed graphemes over episode time.
 *
 * The y value at each edit is recovered EXACTLY (offset + distance of the
 * revision_locations entry — the aggregator computed distance as
 * currentGraphemes − caretOffset), so the curve is the true document length
 * after every observed edit: flat stretches are pauses, downward steps are
 * deletions, local slope is instantaneous production rate. The straight
 * dashed reference line is the episode's mean rate (final committed length /
 * elapsed time); production running above it is acceleration, below it is
 * stalling.
 *
 * The path between observed points uses Fritsch–Carlson monotone
 * interpolation (chartMath.monotonePath — the d3.curveMonotoneX algorithm),
 * which passes through every observation and can never overshoot beyond the
 * observed values; small dots mark the actual observations so drawn-through
 * segments are distinguishable from data. Long idle gaps compress to a
 * fixed labelled band (same explicit-compression stance as
 * TypingProgressionChart / EmotionTimeline), and the mean-rate reference is
 * mapped through the same compression so the comparison stays honest in
 * every un-compressed region.
 *
 * When the series cannot be derived exactly (no positioned edits, or
 * typing-v2 rows without the v3 `distance` field) the chart states which
 * field is missing rather than accumulating a guess.
 */

export interface TypingProductionCurveProps {
  typing: TypingMetricsV3;
  quality?: TypingQuality;
}

const W = 860;
const H = 220;
const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 30;
const GAP_COMPRESS_MS = 15000;

const MISSING_MESSAGE: Record<string, string> = {
  revision_locations:
    'revision_locations is empty: no positioned edits were captured for this episode.',
  offset: 'a revision_locations entry lacks a caret offset (caretOffset was not supplied).',
  distance:
    'the v3 distance field is absent (typing-v2 row) — committed length per edit cannot be recovered exactly.',
};

export function TypingProductionCurve({ typing, quality }: TypingProductionCurveProps) {
  const raw = Array.isArray(typing.revision_locations) ? typing.revision_locations : [];
  const series = productionSeries(raw);
  if (series.missing !== null) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — {MISSING_MESSAGE[series.missing] ?? `missing field: ${series.missing}.`}
      </p>
    );
  }

  const times = series.points.map((p) => p.t);
  const latency = Number.isFinite(typing.first_input_latency_ms as number)
    ? (typing.first_input_latency_ms as number)
    : 0;
  const episodeStart = times[0] - latency;
  const elapsed = Number.isFinite(typing.elapsed_ms) ? typing.elapsed_ms : 0;
  const episodeEnd = Math.max(times[times.length - 1], episodeStart + elapsed);

  const axis = compressTimeAxis([episodeStart, ...times, episodeEnd], { maxGapMs: GAP_COMPRESS_MS });
  const spanMs = Math.max(1, axis.spanMs);
  const plotW = W - PAD_L - PAD_R;
  const xOf = (t: number) => PAD_L + (axis.toCompressed(t) / spanMs) * plotW;

  const yMax = Math.max(1, ...series.points.map((p) => p.committed), typing.committed_graphemes);
  const yScale = linearScale([0, yMax], [H - PAD_B, PAD_T]);

  const curve = monotonePath(
    series.points.map((p) => ({ x: xOf(p.t), y: yScale(p.committed) })),
  );

  // Mean-rate reference: y = rate · (t − episodeStart), sampled at the start,
  // every compressed-break edge, and the end — piecewise through the same
  // compression the data uses, so slope comparisons hold region by region.
  // The rate of THIS episode's writing: text that was there before the episode
  // (`baseline_graphemes`) is where the line starts, not part of its slope —
  // the same basis as `chars_per_min`.
  const baseline = Number.isFinite(typing.baseline_graphemes as number) ? (typing.baseline_graphemes as number) : 0;
  const meanRate = elapsed > 0 ? (typing.committed_graphemes - baseline) / elapsed : 0;
  const refAnchors = [
    episodeStart,
    ...axis.breaks.flatMap((b) => [b.realStart, b.realEnd]),
    episodeEnd,
  ];
  const refPath = refAnchors
    .map((t, i) => `${i === 0 ? 'M' : 'L'}${xOf(t)},${yScale(baseline + meanRate * (t - episodeStart))}`)
    .join('');

  const ticks = axisTimeTicks(axis, episodeStart, episodeEnd, 6);
  const lineColor = getColor(0);

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Cumulative committed graphemes over episode time; flat stretches are pauses, downward steps are deletions, the dashed line is the episode mean rate"
      >
        <title>Production curve — cumulative committed graphemes over episode time</title>

        {/* Compressed idle gaps, labelled. */}
        {axis.breaks.map((b, i) => {
          const x0 = xOf(b.realStart);
          const x1 = xOf(b.realEnd);
          return (
            <g key={`break-${i}`}>
              <rect x={x0} y={PAD_T} width={x1 - x0} height={H - PAD_T - PAD_B} fill="var(--surface-2)" opacity={0.6} />
              <line x1={x0} y1={PAD_T} x2={x0} y2={H - PAD_B} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <line x1={x1} y1={PAD_T} x2={x1} y2={H - PAD_B} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <text x={(x0 + x1) / 2} y={PAD_T + 11} textAnchor="middle" fontSize={9} fill="var(--ink-3)">
                {formatDurationShort(b.gapMs)}
              </text>
            </g>
          );
        })}

        {/* Gridlines + y axis (committed graphemes). */}
        {yScale.ticks(4).map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={yScale(v)} x2={W - PAD_R} y2={yScale(v)} stroke="var(--line)" />
            <text x={PAD_L - 6} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={10} fontSize={9} fill="var(--ink-3)">
          committed graphemes
        </text>

        {/* x axis. */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--line-strong)" />
        {ticks.map((tk) => {
          const x = PAD_L + (tk.comp / spanMs) * plotW;
          return (
            <g key={`x-${tk.realMs}`}>
              <line x1={x} y1={H - PAD_B} x2={x} y2={H - PAD_B + 4} stroke="var(--ink-3)" />
              <text x={x} y={H - PAD_B + 15} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                {formatDurationShort(tk.realMs)}
              </text>
            </g>
          );
        })}

        {/* Mean-rate reference (dashed, through the same compression). */}
        <path d={refPath} fill="none" stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="5 4" opacity={0.6} />

        {/* The production curve itself + observation dots. */}
        <path d={curve} fill="none" stroke={lineColor} strokeWidth={1.75} />
        {series.points.map((p, i) => (
          <circle key={`pt-${i}`} cx={xOf(p.t)} cy={yScale(p.committed)} r={1.6} fill={lineColor} />
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        <span className="inline-flex items-center gap-1">
          <svg width={14} height={8} aria-hidden="true">
            <line x1={0} y1={4} x2={14} y2={4} stroke={lineColor} strokeWidth={2} />
          </svg>
          committed length (observed edits)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={14} height={8} aria-hidden="true">
            <line x1={0} y1={4} x2={14} y2={4} stroke="var(--ink-3)" strokeDasharray="4 3" />
          </svg>
          mean rate ({elapsed > 0 ? (meanRate * 60000).toFixed(1) : '—'} graphemes/min)
        </span>
        {axis.breaks.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true">
              <rect x={1} y={1} width={10} height={10} fill="var(--surface-2)" />
            </svg>
            compressed idle (labelled)
          </span>
        )}
      </div>

      {quality?.revision_locations_truncated && (
        <p className="m-0 text-xs text-ink-3">
          <code>revision_locations</code> hit its retention cap — the curve covers retained edits
          only.
        </p>
      )}
    </div>
  );
}
