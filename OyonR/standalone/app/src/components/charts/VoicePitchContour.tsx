import type { VoiceMetrics, VoiceQuality, VoicePlaybackInterval } from '../../../../../types/voice';
import type { VoiceFrameSample } from '@/lib/voiceChartMath';
import { getColor, linearScale } from '../analytics/charts/chartMath';
import { formatDurationShort } from '@/lib/typingChartMath.js';
import { pitchSegments, keptPitchPoints, pitchTrend } from '@/lib/voiceChartMath.js';
import { extent } from '@/lib/extent';

/*
 * VoicePitchContour — the intonation record of one voice turn: x = turn
 * time, y = F0 in Hz, ONE MARK PER VOICED FRAME. Unvoiced frames are GAPS.
 *
 * What it reveals that the summary numbers cannot: rising vs falling
 * intonation over the turn (the slope line), monotone delivery (a flat,
 * narrow band hugging the median), and pitch resets after pauses (each
 * speech run restarting high/low relative to where the previous one ended).
 *
 * Honesty rules:
 *  - NOTHING is interpolated. The connecting line only joins CONSECUTIVE
 *    voiced frames (pitchSegments breaks at every unvoiced frame and at
 *    dropped-frame gaps) — drawing a line across an unvoiced stretch would
 *    invent pitch that was not measured, so it is never drawn.
 *  - Low-confidence voiced frames (below the aggregator's
 *    `min_pitch_confidence`) are drawn HOLLOW: observed, but excluded from
 *    every pitch statistic — the same second gate the aggregator applies.
 *  - The overlaid median and slope are the WINDOW's own `pitch_median_hz` /
 *    `pitch_slope_hz_per_s` (null below the voiced-frame floor → no overlay,
 *    with the absence stated). The slope line is anchored at the kept
 *    points' OLS centroid, which is exactly where the aggregator's fit
 *    passes (lib/voiceChartMath.js, asserted against the real aggregator).
 *  - Frames inside host AI-playback intervals are shaded and labelled
 *    excluded: their pitch marks are drawn (it was measured) but the
 *    aggregator's statistics never include them.
 */

export interface VoicePitchContourProps {
  /** Per-frame series recorded with the turn (`frame_series`); charts need observations. */
  frames: VoiceFrameSample[] | null | undefined;
  voice: VoiceMetrics;
  quality?: VoiceQuality | null;
  /** Host AI-playback intervals from the controller's stop report. */
  playbackIntervals?: VoicePlaybackInterval[] | null;
}

const W = 860;
const H = 250;
const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 30;

export function VoicePitchContour({ frames, voice, quality, playbackIntervals }: VoicePitchContourProps) {
  if (!frames || frames.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — this turn carries no per-frame series (<code>frame_series</code> absent).
        Only turns recorded by this app&rsquo;s voice test store the per-frame record; the
        voice-v1 window alone holds summaries, not observations.
      </p>
    );
  }

  const segments = pitchSegments(frames);
  const allPoints = segments.flat();
  if (allPoints.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        No voiced frames — the pitch estimator never detected voicing in this turn, so there is
        no contour to draw. A silent (or whispered) turn has no F0; nothing is invented.
      </p>
    );
  }

  const thresholds = quality?.thresholds ?? null;
  const frameMs = thresholds?.frame_ms ?? 32;
  const minConfidence = thresholds?.min_pitch_confidence ?? 0.6;

  const t0 = frames[0].t;
  const tEnd = frames[frames.length - 1].t + frameMs;
  const spanMs = Math.max(1, tEnd - t0);
  const plotW = W - PAD_L - PAD_R;
  const xOf = (t: number) => PAD_L + ((t - t0) / spanMs) * plotW;

  const f0s = allPoints.map((p) => p.f0);
  const median = voice.pitch_median_hz;
  const range = extent(f0s, { include: median != null ? [median] : [] });
  const yLo = range ? range.min : median ?? 0;
  const yHi = range ? range.max : median ?? 0;
  const yPad = Math.max(5, (yHi - yLo) * 0.12);
  const yScale = linearScale([Math.max(0, yLo - yPad), yHi + yPad], [H - PAD_B, PAD_T]);

  const kept = keptPitchPoints(frames, { minConfidence });
  const trend = pitchTrend(kept);
  const slope = voice.pitch_slope_hz_per_s; // Hz per SECOND, the window's own fit

  // Trend line across the kept points' time range, through the OLS centroid.
  let trendLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (slope != null && trend != null && kept.length >= 2) {
    const tA = kept[0].t;
    const tB = kept[kept.length - 1].t;
    const f0At = (t: number) => trend.meanF0 + slope * ((t - trend.meanT) / 1000);
    trendLine = { x1: xOf(tA), y1: yScale(f0At(tA)), x2: xOf(tB), y2: yScale(f0At(tB)) };
  }

  const playback = (playbackIntervals ?? []).filter(
    (interval) => Number.isFinite(interval.start_ms) && Number.isFinite(interval.end_ms as number),
  );

  const xTicks = linearScale([0, spanMs], [0, 1])
    .ticks(6)
    .filter((v) => v >= 0 && v <= spanMs);

  const pointColor = getColor(0);
  const lowCount = allPoints.filter((p) => p.confidence < minConfidence).length;

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Pitch contour: F0 in hertz per voiced frame over turn time; unvoiced frames are gaps, with the turn median and fitted slope overlaid"
      >
        <title>Pitch contour — F0 per voiced frame over turn time</title>

        {/* AI-playback intervals: shaded + labelled excluded (§5.9). */}
        {playback.map((interval, i) => {
          const x0 = xOf(Math.max(t0, interval.start_ms));
          const x1 = xOf(Math.min(tEnd, interval.end_ms as number));
          if (!(x1 > x0)) return null;
          return (
            <g key={`pb-${i}`}>
              <rect x={x0} y={PAD_T} width={x1 - x0} height={H - PAD_T - PAD_B} fill="var(--surface-2)" opacity={0.7} />
              <text x={(x0 + x1) / 2} y={PAD_T + 11} textAnchor="middle" fontSize={9} fill="var(--ink-3)">
                AI playback (excluded)
              </text>
            </g>
          );
        })}

        {/* Gridlines + y axis (Hz). */}
        {yScale.ticks(4).map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={yScale(v)} x2={W - PAD_R} y2={yScale(v)} stroke="var(--line)" />
            <text x={PAD_L - 6} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={10} fontSize={9} fill="var(--ink-3)">
          F0 (Hz) — voiced frames only
        </text>

        {/* x axis: turn time. */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--line-strong)" />
        {xTicks.map((v) => {
          const x = PAD_L + (v / spanMs) * plotW;
          return (
            <g key={`x-${v}`}>
              <line x1={x} y1={H - PAD_B} x2={x} y2={H - PAD_B + 4} stroke="var(--ink-3)" />
              <text x={x} y={H - PAD_B + 15} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                {formatDurationShort(v)}
              </text>
            </g>
          );
        })}

        {/* Median (dashed) — the window's own pitch_median_hz. */}
        {median != null ? (
          <>
            <line
              x1={PAD_L}
              y1={yScale(median)}
              x2={W - PAD_R}
              y2={yScale(median)}
              stroke="var(--ink-1)"
              strokeWidth={1}
              strokeDasharray="5 4"
            />
            <text x={W - PAD_R - 2} y={yScale(median) - 4} textAnchor="end" fontSize={10} fill="var(--ink-1)">
              median {median.toFixed(0)} Hz
            </text>
          </>
        ) : null}

        {/* Fitted slope — the window's pitch_slope_hz_per_s through the OLS centroid. */}
        {trendLine ? (
          <>
            <line
              x1={trendLine.x1}
              y1={trendLine.y1}
              x2={trendLine.x2}
              y2={trendLine.y2}
              stroke="var(--status-info)"
              strokeWidth={1.5}
            />
            {/* Label at the line's START — the median label owns the right edge. */}
            <text x={trendLine.x1 + 2} y={trendLine.y1 - 6} textAnchor="start" fontSize={10} fill="var(--status-info)">
              slope {(slope as number).toFixed(1)} Hz/s
            </text>
          </>
        ) : null}

        {/* Contour: line only between CONSECUTIVE voiced frames; gaps stay gaps. */}
        {segments.map((segment, i) =>
          segment.length >= 2 ? (
            <path
              key={`seg-${i}`}
              d={segment.map((p, j) => `${j === 0 ? 'M' : 'L'}${xOf(p.t)},${yScale(p.f0)}`).join('')}
              fill="none"
              stroke={pointColor}
              strokeWidth={1}
              opacity={0.5}
            />
          ) : null,
        )}

        {/* One mark per voiced frame: filled = kept for statistics, hollow = below confidence gate. */}
        {allPoints.map((p, i) =>
          p.confidence >= minConfidence ? (
            <circle key={`pt-${i}`} cx={xOf(p.t)} cy={yScale(p.f0)} r={2} fill={pointColor} />
          ) : (
            <circle
              key={`pt-${i}`}
              cx={xOf(p.t)}
              cy={yScale(p.f0)}
              r={2}
              fill="none"
              stroke={pointColor}
              strokeWidth={1}
              opacity={0.7}
            />
          ),
        )}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true"><circle cx={5} cy={5} r={2.5} fill={pointColor} /></svg>
          voiced frame (kept)
        </span>
        {lowCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={10} height={10} aria-hidden="true">
              <circle cx={5} cy={5} r={2.5} fill="none" stroke={pointColor} strokeWidth={1} />
            </svg>
            below confidence {minConfidence} (excluded from statistics)
          </span>
        )}
        {median != null && (
          <span className="inline-flex items-center gap-1">
            <svg width={16} height={10} aria-hidden="true">
              <line x1={0} y1={5} x2={16} y2={5} stroke="var(--ink-1)" strokeDasharray="4 3" />
            </svg>
            median
          </span>
        )}
        {trendLine && (
          <span className="inline-flex items-center gap-1">
            <svg width={16} height={10} aria-hidden="true">
              <line x1={0} y1={7} x2={16} y2={3} stroke="var(--status-info)" strokeWidth={1.5} />
            </svg>
            fitted slope
          </span>
        )}
        {playback.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true">
              <rect x={1} y={1} width={10} height={10} fill="var(--surface-2)" />
            </svg>
            AI playback (excluded)
          </span>
        )}
      </div>

      {median == null ? (
        <p className="m-0 text-xs text-ink-3">
          Median and slope are not overlaid — this turn sat below the voiced-frame floor
          ({thresholds?.min_voiced_frames_for_pitch ?? 5} confident frames), so the aggregator
          reports no pitch statistics rather than a fabricated 0 Hz.
        </p>
      ) : null}
      <p className="m-0 text-xs text-ink-3">
        Reads: a rising/falling slope line is the turn&rsquo;s overall intonation drift; a flat,
        narrow band hugging the median is monotone delivery; a jump where a new speech run starts
        after a gap is a pitch reset at a pause. Gaps are unvoiced audio — pitch is only drawn
        where it was measured, never interpolated.
      </p>
    </div>
  );
}
