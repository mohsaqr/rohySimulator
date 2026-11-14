import { useId } from 'react';
import type { VoiceMetrics, VoiceQuality } from '../../../../../types/voice';
import type { VoiceFrameSample } from '@/lib/voiceChartMath';
import type { StripSegmentKind } from '@/lib/voiceChartMath';
import { getColor } from '../analytics/charts/chartMath';
import { formatDurationShort } from '@/lib/typingChartMath.js';
import { speechStripSegments, clippedRuns } from '@/lib/voiceChartMath.js';

/*
 * VoiceSpeechStrip — the horizontal timeline of one voice turn: speech
 * segments, silences, internal pauses, AI-playback intervals (visually
 * distinct and labelled excluded) and clipped stretches, every band's width
 * proportional to time. This is the chart that makes "56% speech ratio"
 * legible: the ratio is an area you can see, not a number you must trust.
 *
 * Time axis honesty: bands sit on FRAME time (frames × frame_ms) — exactly
 * the accounting the aggregator uses for every duration it reports, so the
 * bands sum to the window's own speech/silence figures. Wall-clock gaps
 * from dropped frames are not represented (stated in the caption, never
 * silently stretched).
 *
 * Kind is never carried by hue alone: playback carries a hatch pattern and
 * an in-band label, pauses are the warn band the typing charts use, muted
 * is a dotted pattern, and clipping is a separate damage row above the
 * strip — plus the legend.
 *
 * Playback caveat (also in lib/voiceChartMath.js): the strip draws literal
 * per-frame runs; the aggregator's internal-pause count runs on a
 * structural timeline that excludes playback frames. On turns without
 * playback — every turn the voice test modal records — the two agree
 * exactly (asserted in tests/app-voice-charts.test.js).
 */

export interface VoiceSpeechStripProps {
  /** Per-frame series recorded with the turn (`frame_series`). */
  frames: VoiceFrameSample[] | null | undefined;
  voice: VoiceMetrics;
  quality?: VoiceQuality | null;
}

const W = 860;
const H = 120;
const PAD_L = 14;
const PAD_R = 14;
const STRIP_Y = 30;
const STRIP_H = 44;
const CLIP_Y = 20;
const AXIS_Y = STRIP_Y + STRIP_H;

const KIND_LABEL: Record<StripSegmentKind, string> = {
  speech: 'speech',
  silence: 'silence',
  pause: 'pause',
  playback: 'AI playback (excluded)',
  muted: 'muted',
};

export function VoiceSpeechStrip({ frames, voice, quality }: VoiceSpeechStripProps) {
  const patternId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

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
  const pauseThresholdMs = thresholds?.pause_threshold_ms ?? 500;

  const { segments, totalMs } = speechStripSegments(frames, { frameMs, vadThreshold, pauseThresholdMs });
  const clips = clippedRuns(frames, { frameMs });

  const plotW = W - PAD_L - PAD_R;
  const xOf = (ms: number) => PAD_L + (ms / Math.max(1, totalMs)) * plotW;

  const speechFill = getColor(0);
  const playbackHatch = `url(#${patternId}-hatch)`;
  const mutedDots = `url(#${patternId}-dots)`;

  const fillOf: Record<StripSegmentKind, string> = {
    speech: speechFill,
    silence: 'var(--surface-2)',
    pause: 'var(--status-warn-dim)',
    playback: playbackHatch,
    muted: mutedDots,
  };

  const kindsPresent = [...new Set(segments.map((segment) => segment.kind))];
  // "Nice" round ticks: 5 divisions of the strip, labelled with real durations.
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (totalMs / tickCount) * i);

  const speechRatioPct = voice.speech_ratio != null ? `${(voice.speech_ratio * 100).toFixed(0)}%` : '—';

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Turn timeline strip: speech, silence, internal pauses, AI-playback exclusions and clipped stretches, each band's width proportional to time"
      >
        <title>Voice turn timeline — speech / silence / pause structure over frame time</title>
        <defs>
          {/* Playback: diagonal hatch — never hue-alone. */}
          <pattern id={`${patternId}-hatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6} height={6} fill="var(--surface-2)" />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--ink-3)" strokeWidth={1.5} />
          </pattern>
          {/* Muted: dotted — the track produced synthetic zeros, not the speaker. */}
          <pattern id={`${patternId}-dots`} width={6} height={6} patternUnits="userSpaceOnUse">
            <rect width={6} height={6} fill="var(--surface-3)" />
            <circle cx={3} cy={3} r={1} fill="var(--ink-3)" />
          </pattern>
        </defs>

        {/* Clipped stretches: a damage row above the strip. */}
        {clips.map((run, i) => (
          <rect
            key={`clip-${i}`}
            x={xOf(run.startMs)}
            y={CLIP_Y}
            width={Math.max(1.5, xOf(run.endMs) - xOf(run.startMs))}
            height={5}
            fill="var(--status-bad)"
          />
        ))}
        {clips.length > 0 && (
          <text x={PAD_L} y={CLIP_Y - 3} fontSize={9} fill="var(--status-bad)">
            clipping
          </text>
        )}

        {/* The bands. 0.5px gaps keep adjacent fills separable. */}
        {segments.map((segment, i) => {
          const x0 = xOf(segment.startMs);
          const x1 = xOf(segment.endMs);
          const width = Math.max(0.75, x1 - x0 - 0.5);
          return (
            <g key={`seg-${i}`}>
              <rect x={x0} y={STRIP_Y} width={width} height={STRIP_H} fill={fillOf[segment.kind]} />
              {/* In-band label when there is room — meaning never rides on fill alone. */}
              {x1 - x0 > 70 ? (
                <text
                  x={(x0 + x1) / 2}
                  y={STRIP_Y + STRIP_H / 2 + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fill={segment.kind === 'speech' ? 'var(--surface-0)' : 'var(--ink-2)'}
                >
                  {KIND_LABEL[segment.kind]} {formatDurationShort(segment.endMs - segment.startMs)}
                </text>
              ) : null}
            </g>
          );
        })}
        <rect x={PAD_L} y={STRIP_Y} width={plotW} height={STRIP_H} fill="none" stroke="var(--line-strong)" />

        {/* Frame-time axis. */}
        {ticks.map((ms) => (
          <g key={`t-${ms}`}>
            <line x1={xOf(ms)} y1={AXIS_Y} x2={xOf(ms)} y2={AXIS_Y + 4} stroke="var(--ink-3)" />
            <text x={xOf(ms)} y={AXIS_Y + 15} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
              {formatDurationShort(ms)}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        {kindsPresent.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1">
            <svg width={14} height={12} aria-hidden="true">
              {/* Local swatch patterns: cross-<svg> pattern references are
                  unreliable, so hatch/dots are re-declared per swatch. */}
              <defs>
                <pattern id={`${patternId}-lg-hatch-${kind}`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={4} height={4} fill="var(--surface-2)" />
                  <line x1={0} y1={0} x2={0} y2={4} stroke="var(--ink-3)" strokeWidth={1} />
                </pattern>
                <pattern id={`${patternId}-lg-dots-${kind}`} width={4} height={4} patternUnits="userSpaceOnUse">
                  <rect width={4} height={4} fill="var(--surface-3)" />
                  <circle cx={2} cy={2} r={0.8} fill="var(--ink-3)" />
                </pattern>
              </defs>
              <rect
                x={1}
                y={1}
                width={12}
                height={10}
                fill={
                  kind === 'playback'
                    ? `url(#${patternId}-lg-hatch-${kind})`
                    : kind === 'muted'
                      ? `url(#${patternId}-lg-dots-${kind})`
                      : fillOf[kind]
                }
                stroke="var(--line)"
              />
            </svg>
            {KIND_LABEL[kind]}
          </span>
        ))}
        {clips.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={14} height={12} aria-hidden="true">
              <rect x={1} y={4} width={12} height={4} fill="var(--status-bad)" />
            </svg>
            clipped stretch
          </span>
        )}
      </div>

      <p className="m-0 text-xs text-ink-3">
        Speech {formatDurationShort(voice.speech_duration_ms)} of{' '}
        {formatDurationShort(voice.turn_duration_ms)} ({speechRatioPct} speech ratio) ·{' '}
        {voice.internal_pause_count} internal pause{voice.internal_pause_count === 1 ? '' : 's'} ≥{' '}
        {pauseThresholdMs} ms · axis is frame time (frames × {frameMs} ms), the same accounting the
        aggregator&rsquo;s durations use; wall-clock gaps from dropped frames are not drawn.
      </p>
    </div>
  );
}
