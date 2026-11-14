import type { VoiceMetrics, VoiceQuality } from '../../../../../types/voice';
import type { VoiceFrameSample } from '@/lib/voiceChartMath';
import { getColor, linearScale } from '../analytics/charts/chartMath';
import { keptPitchPoints, pitchHistogram } from '@/lib/voiceChartMath.js';

/*
 * VoicePitchDistribution — the SHAPE behind `pitch_median_hz` and
 * `pitch_iqr_hz`. The contour shows pitch over time; this shows how it was
 * distributed, which answers a different question: is a wide IQR one
 * animated speaker ranging smoothly, or two clustered registers (a modal
 * voice plus a raised one), or a tight core with a strained tail?
 *
 * Honesty rules:
 *  - Bars are built ONLY from the points the aggregator keeps — VAD-gated,
 *    confidence-gated, playback/muted excluded. The overlaid quartiles come
 *    from the same `quantileSorted` the aggregator uses, so the drawn IQR
 *    band spans exactly `pitch_iqr_hz` and the median line sits exactly at
 *    `pitch_median_hz`. Where the chart and the window would disagree, the
 *    chart states the discrepancy instead of drawing a plausible fiction.
 *  - Below the voiced-frame floor the aggregator reports NO pitch
 *    statistics. The distribution then draws the observed points but
 *    withholds the quartile overlay, saying why — a handful of frames is a
 *    sample, not a distribution.
 *  - Bin width is data-driven (Freedman–Diaconis, floored) so a monotone
 *    turn does not collapse to one bar; the chosen width is printed.
 */

export interface VoicePitchDistributionProps {
  frames: VoiceFrameSample[] | null | undefined;
  voice: VoiceMetrics;
  quality?: VoiceQuality | null;
}

const W = 420;
const H = 220;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 26;
const PAD_B = 34;

export function VoicePitchDistribution({ frames, voice, quality }: VoicePitchDistributionProps) {
  if (!frames || frames.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — this turn carries no per-frame series (<code>frame_series</code> absent).
      </p>
    );
  }

  const thresholds = quality?.thresholds ?? null;
  const minConfidence = thresholds?.min_pitch_confidence ?? 0.6;
  const floor = thresholds?.min_voiced_frames_for_pitch ?? 5;

  const kept = keptPitchPoints(frames, { minConfidence });
  const histogram = pitchHistogram(kept);

  if (!histogram) {
    return (
      <p className="m-0 text-sm text-ink-3">
        No pitch points passed the aggregator&rsquo;s gates (VAD speech, confidence ≥{' '}
        {minConfidence}, outside playback and mute), so there is no distribution to draw. A turn
        with no measurable F0 is not a turn at 0 Hz.
      </p>
    );
  }

  // The window reports statistics only above the floor. Below it, the bars
  // are the observations but the quartile overlay is withheld.
  const reported = voice.pitch_median_hz != null;
  const plotH = H - PAD_T - PAD_B;

  const xScale = linearScale(
    [histogram.bins[0].lo, histogram.bins[histogram.bins.length - 1].hi],
    [PAD_L, W - PAD_R],
  );
  const maxCount = Math.max(...histogram.bins.map((bin) => bin.count));
  const yOf = (count: number) => PAD_T + plotH - (count / Math.max(1, maxCount)) * plotH;

  const color = getColor(0);
  const iqrX0 = xScale(histogram.q1);
  const iqrX1 = xScale(histogram.q3);

  // The overlay is computed from the kept points with the aggregator's own
  // quantile function, so it MUST reproduce the window's reported figures.
  // Checking rather than assuming: a mismatch means the stored frame series
  // and the stored metrics came from different runs, and the reader needs to
  // know which is on screen.
  const medianDrift =
    voice.pitch_median_hz != null ? Math.abs(histogram.median - voice.pitch_median_hz) : null;
  const iqrDrift =
    voice.pitch_iqr_hz != null ? Math.abs(histogram.q3 - histogram.q1 - voice.pitch_iqr_hz) : null;
  const disagrees = (medianDrift != null && medianDrift > 0.5) || (iqrDrift != null && iqrDrift > 0.5);

  const xTicks = xScale.ticks(5);

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Pitch distribution: histogram of ${histogram.n} kept F0 estimates with the turn median and interquartile range overlaid`}
      >
        <title>Pitch distribution — kept F0 estimates</title>

        {/* IQR band — spans exactly pitch_iqr_hz when the window reports it. */}
        {reported ? (
          <>
            <rect
              x={iqrX0}
              y={PAD_T}
              width={Math.max(1, iqrX1 - iqrX0)}
              height={plotH}
              fill="var(--status-info-dim)"
              opacity={0.5}
            />
            <text x={(iqrX0 + iqrX1) / 2} y={PAD_T - 14} textAnchor="middle" fontSize={9} fill="var(--ink-3)">
              IQR {(histogram.q3 - histogram.q1).toFixed(0)} Hz
            </text>
          </>
        ) : null}

        {/* Bars. */}
        {histogram.bins.map((bin, i) => {
          const x0 = xScale(bin.lo);
          const x1 = xScale(bin.hi);
          return bin.count > 0 ? (
            <rect
              key={`b-${i}`}
              x={x0}
              y={yOf(bin.count)}
              width={Math.max(1, x1 - x0 - 0.5)}
              height={PAD_T + plotH - yOf(bin.count)}
              fill={color}
              opacity={0.8}
            >
              <title>
                {bin.lo.toFixed(0)}–{bin.hi.toFixed(0)} Hz: {bin.count} frame
                {bin.count === 1 ? '' : 's'}
              </title>
            </rect>
          ) : null;
        })}

        {/* Median — the window's own pitch_median_hz where it reports one. */}
        {reported ? (
          <>
            <line
              x1={xScale(histogram.median)}
              y1={PAD_T - 4}
              x2={xScale(histogram.median)}
              y2={PAD_T + plotH}
              stroke="var(--ink-1)"
              strokeWidth={1.25}
            />
            <text
              x={xScale(histogram.median)}
              y={PAD_T - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--ink-1)"
            >
              median {histogram.median.toFixed(0)}
            </text>
          </>
        ) : null}

        <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="var(--line-strong)" />
        {xTicks.map((v) => (
          <g key={`x-${v}`}>
            <line x1={xScale(v)} y1={PAD_T + plotH} x2={xScale(v)} y2={PAD_T + plotH + 4} stroke="var(--ink-3)" />
            <text x={xScale(v)} y={PAD_T + plotH + 15} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--ink-3)">
          F0 (Hz)
        </text>
        <text x={PAD_L - 6} y={PAD_T + 4} textAnchor="end" fontSize={9} fill="var(--ink-3)">
          {maxCount}
        </text>
        <text x={PAD_L - 6} y={PAD_T + plotH} textAnchor="end" fontSize={9} fill="var(--ink-3)">
          0
        </text>
      </svg>

      <p className="m-0 text-mini text-ink-3">
        {histogram.n} kept frame{histogram.n === 1 ? '' : 's'} · {histogram.binHz.toFixed(1)} Hz bins ·
        range {histogram.min.toFixed(0)}–{histogram.max.toFixed(0)} Hz
      </p>

      {!reported ? (
        <p className="m-0 text-xs text-ink-3">
          Median and IQR are not overlaid — {histogram.n} confident frame
          {histogram.n === 1 ? '' : 's'} sits below the voiced-frame floor ({floor}), so the window
          reports no pitch statistics. The bars are the observations; the summary would not be one.
        </p>
      ) : null}
      {disagrees ? (
        <p className="m-0 text-xs text-status-warn">
          The frame series and the stored metrics disagree: this turn&rsquo;s kept points give a
          median of {histogram.median.toFixed(1)} Hz, but the window reports{' '}
          {voice.pitch_median_hz?.toFixed(1)} Hz. Everything drawn above comes from the SERIES.
          Most likely the two were written by different runs.
        </p>
      ) : null}
      <p className="m-0 text-xs text-ink-3">
        Reads: one narrow peak is a steady register; two separated humps are two registers (often a
        modal voice plus a raised, questioning one); a long right tail is strain or emphatic
        high-pitch excursions. A wide IQR alone cannot tell those apart.
      </p>
    </div>
  );
}
