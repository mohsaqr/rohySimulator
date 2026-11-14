import type { VoiceMetrics, VoiceQuality } from '../../../../../types/voice';
import type { VoiceFrameSample } from '@/lib/voiceChartMath';
import { getColor, linearScale } from '../analytics/charts/chartMath';
import { formatDurationShort } from '@/lib/typingChartMath.js';
import { loudnessEnvelope } from '@/lib/voiceChartMath.js';

/*
 * VoiceLoudnessEnvelope — per-frame RMS over turn time. The turn's delivery
 * dynamics: emphasis peaks, a fading tail, an unsteady level.
 *
 * The per-frame RMS is recorded on every turn and was previously summarised
 * to two numbers (`rms_mean`, `rms_variability`) and never drawn. A single
 * SD cannot distinguish a speaker who is uniformly variable from one who
 * started strong and trailed off — the shape can.
 *
 * Honesty rules:
 *  - The aggregator's `rms_mean` is SPEECH-scoped. Frames that entered it
 *    are drawn solid; silence frames are drawn faint (context, not part of
 *    the statistic) — the reference line is therefore visibly the mean of
 *    what is solid, not of everything on screen.
 *  - Clipped frames are marked on their own damage row: a clipped frame's
 *    RMS is a floor artifact, not the speaker's loudness.
 *  - Playback/muted frames are shaded excluded.
 *  - Under AGC the ABSOLUTE level is a gain-controller artifact. When
 *    `loudness_contaminated` is set the y axis is labelled as such and the
 *    mean line is drawn warn-toned: the SHAPE stays readable, the absolute
 *    height does not, and the chart says so instead of implying otherwise.
 *  - Frames with no finite rms are absent measurements: omitted, never 0.
 */

export interface VoiceLoudnessEnvelopeProps {
  frames: VoiceFrameSample[] | null | undefined;
  voice: VoiceMetrics;
  quality?: VoiceQuality | null;
}

const W = 860;
const H = 190;
const PAD_L = 52;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 30;
const CLIP_ROW_H = 5;

export function VoiceLoudnessEnvelope({ frames, voice, quality }: VoiceLoudnessEnvelopeProps) {
  if (!frames || frames.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — this turn carries no per-frame series (<code>frame_series</code> absent).
        Only turns recorded by this app&rsquo;s voice test store the per-frame record.
      </p>
    );
  }

  const thresholds = quality?.thresholds ?? null;
  const frameMs = thresholds?.frame_ms ?? 32;
  const vadThreshold = thresholds?.vad_threshold ?? 0.5;
  const nearSilenceRms = thresholds?.near_silence_rms ?? 0.01;
  const contaminated = quality?.loudness_contaminated === true;

  const envelope = loudnessEnvelope(frames, { vadThreshold, nearSilenceRms });
  if (envelope.points.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        No frame carried a finite RMS — loudness was never measured on this turn. Nothing is drawn
        at zero: an absent measurement is not silence.
      </p>
    );
  }

  const t0 = frames[0].t;
  const tEnd = frames[frames.length - 1].t + frameMs;
  const spanMs = Math.max(1, tEnd - t0);
  const plotW = W - PAD_L - PAD_R;
  const xOf = (t: number) => PAD_L + ((t - t0) / spanMs) * plotW;

  const maxRms = Math.max(...envelope.points.map((point) => point.rms), envelope.speechMean ?? 0);
  const yScale = linearScale([0, Math.max(maxRms * 1.1, nearSilenceRms * 2)], [H - PAD_B, PAD_T]);
  const baseline = yScale(0);

  const color = getColor(0);
  const barW = Math.max(0.6, plotW / envelope.points.length);

  const xTicks = linearScale([0, spanMs], [0, 1])
    .ticks(6)
    .filter((v) => v >= 0 && v <= spanMs);

  const clipped = envelope.points.filter((point) => point.clipped);
  const excludedRuns: Array<{ x0: number; x1: number }> = [];
  for (const point of envelope.points) {
    if (!point.excluded) continue;
    const x0 = xOf(point.t);
    const last = excludedRuns[excludedRuns.length - 1];
    if (last && Math.abs(last.x1 - x0) < barW * 1.5) last.x1 = x0 + barW;
    else excludedRuns.push({ x0, x1: x0 + barW });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Loudness envelope: per-frame RMS over turn time, with speech frames solid, silence frames faint, and the speech-scoped mean overlaid"
      >
        <title>Loudness envelope — per-frame RMS over turn time</title>

        {/* Playback / muted stretches: outside every learner measurement. */}
        {excludedRuns.map((run, i) => (
          <rect
            key={`ex-${i}`}
            x={run.x0}
            y={PAD_T}
            width={Math.max(1, run.x1 - run.x0)}
            height={H - PAD_T - PAD_B}
            fill="var(--surface-2)"
            opacity={0.7}
          />
        ))}

        {yScale.ticks(4).map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={yScale(v)} x2={W - PAD_R} y2={yScale(v)} stroke="var(--line)" />
            <text x={PAD_L - 6} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {v.toFixed(v < 0.1 ? 3 : 2)}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={9} fontSize={9} fill={contaminated ? 'var(--status-warn)' : 'var(--ink-3)'}>
          {contaminated
            ? 'RMS — absolute level is an AGC artifact; read the SHAPE only'
            : 'RMS per frame'}
        </text>

        {/* Near-silence floor: below this the aggregator counts a frame as
            near-silent. Drawn so the reader can see how much of the turn
            hugged the floor rather than trusting one ratio. */}
        <line
          x1={PAD_L}
          y1={yScale(nearSilenceRms)}
          x2={W - PAD_R}
          y2={yScale(nearSilenceRms)}
          stroke="var(--ink-3)"
          strokeDasharray="2 3"
          opacity={0.8}
        />
        <text x={PAD_L + 3} y={yScale(nearSilenceRms) - 3} fontSize={9} fill="var(--ink-3)">
          near-silence floor
        </text>

        {/* One bar per measured frame. Solid = entered rms_mean. */}
        {envelope.points.map((point, i) => (
          <rect
            key={`f-${i}`}
            x={xOf(point.t)}
            y={yScale(point.rms)}
            width={barW}
            height={Math.max(0.5, baseline - yScale(point.rms))}
            fill={point.clipped ? 'var(--status-bad)' : color}
            opacity={point.speech ? 0.85 : 0.22}
          />
        ))}

        {/* Speech-scoped mean — the window's own rms_mean. */}
        {envelope.speechMean != null ? (
          <>
            <line
              x1={PAD_L}
              y1={yScale(envelope.speechMean)}
              x2={W - PAD_R}
              y2={yScale(envelope.speechMean)}
              stroke={contaminated ? 'var(--status-warn)' : 'var(--ink-1)'}
              strokeWidth={1}
              strokeDasharray="5 4"
            />
            <text
              x={W - PAD_R - 2}
              y={yScale(envelope.speechMean) - 4}
              textAnchor="end"
              fontSize={10}
              fill={contaminated ? 'var(--status-warn)' : 'var(--ink-1)'}
            >
              speech mean {envelope.speechMean.toFixed(4)}
              {contaminated ? ' (AGC)' : ''}
            </text>
          </>
        ) : null}

        {/* Clipping damage row. */}
        {clipped.map((point, i) => (
          <rect
            key={`c-${i}`}
            x={xOf(point.t)}
            y={PAD_T - CLIP_ROW_H - 2}
            width={barW}
            height={CLIP_ROW_H}
            fill="var(--status-bad)"
          />
        ))}

        <line x1={PAD_L} y1={baseline} x2={W - PAD_R} y2={baseline} stroke="var(--line-strong)" />
        {xTicks.map((v) => {
          const x = PAD_L + (v / spanMs) * plotW;
          return (
            <g key={`x-${v}`}>
              <line x1={x} y1={baseline} x2={x} y2={baseline + 4} stroke="var(--ink-3)" />
              <text x={x} y={baseline + 15} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                {formatDurationShort(v)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true"><rect width={10} height={10} fill={color} opacity={0.85} /></svg>
          speech frame (in the mean)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true"><rect width={10} height={10} fill={color} opacity={0.22} /></svg>
          silence frame (context only)
        </span>
        {clipped.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={10} height={10} aria-hidden="true"><rect width={10} height={10} fill="var(--status-bad)" /></svg>
            clipped ({clipped.length} frame{clipped.length === 1 ? '' : 's'}) — level is an artifact
          </span>
        )}
        {excludedRuns.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true"><rect x={1} y={1} width={10} height={10} fill="var(--surface-2)" /></svg>
            playback / muted (excluded)
          </span>
        )}
      </div>

      {envelope.speechMean == null ? (
        <p className="m-0 text-xs text-ink-3">
          No mean line — no frame was both VAD-speech and carried a finite RMS, so the aggregator
          reports <code>rms_mean</code> as not measured rather than a mean of silence.
        </p>
      ) : null}
      {/* The mean drawn here is recomputed from the series with the
          aggregator's own three gates, so it must equal the window's
          rms_mean. Checked rather than assumed: a mismatch means the series
          and the metrics were written by different runs, and the reader is
          looking at the series. */}
      {envelope.speechMean != null &&
      voice.rms_mean != null &&
      Math.abs(envelope.speechMean - voice.rms_mean) > 1e-4 ? (
        <p className="m-0 text-xs text-status-warn">
          The frame series and the stored metrics disagree: the series gives a speech mean of{' '}
          {envelope.speechMean.toFixed(4)}, the window reports {voice.rms_mean.toFixed(4)}. The
          chart draws the series. Most likely the two were written by different runs.
        </p>
      ) : null}
      <p className="m-0 text-xs text-ink-3">
        Reads: repeated tall spikes above the mean are emphasis; a level that decays across the
        turn is trailing off; solid bars hugging the near-silence floor are speech the VAD accepted
        but that barely registered — usually a distant or turned-away microphone.
        {contaminated
          ? ' Auto gain control was active, so compare shape within this turn only — never absolute level against another turn.'
          : ''}
      </p>
    </div>
  );
}
