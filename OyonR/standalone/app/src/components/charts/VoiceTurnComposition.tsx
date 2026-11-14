import { useId } from 'react';
import type { VoiceMetrics } from '../../../../../types/voice';
import { getColor } from '../analytics/charts/chartMath';
import { turnTimeComposition } from '@/lib/voiceChartMath.js';
import { formatDurationShort } from '@/lib/typingChartMath.js';

/*
 * VoiceTurnComposition — one stacked bar per turn: where that turn's time
 * actually went. Bar LENGTH is absolute duration (turns are comparable to
 * each other), band width within a bar is that part's share.
 *
 * What it shows that `speech_ratio` cannot: two turns can both be "40%
 * speech" while one is a long think before answering (leading silence) and
 * the other is fragmented mid-turn hesitation (internal pauses). Those are
 * different behaviours and the single ratio collapses them.
 *
 * Honesty rules:
 *  - Parts are the aggregator's frame-time accounting; `turn_duration_ms` is
 *    wall clock. They need not agree (dropped frames, a turn stopped between
 *    frames), so the leftover is drawn as an explicit UNACCOUNTED band
 *    rather than the bar being normalised to hide it. When frame time
 *    OVERRUNS wall clock the bar is drawn at frame-time scale and the
 *    overrun is stated — never clipped away silently.
 *  - Kind is never hue-alone: playback hatches, muted dots, unaccounted uses
 *    the null token, and every band carries a title tooltip.
 */

export interface VoiceTurnCompositionProps {
  turns: Array<{ voice: VoiceMetrics; window_start: string }>;
  selectedIndex?: number | null;
  onSelectIndex?: (index: number) => void;
}

const ROW_H = 22;
const BAR_H = 13;
const PAD_L = 34;
const PAD_R = 8;
const W = 860;

const PART_LABEL: Record<string, string> = {
  initial_silence: 'Initial silence',
  speech: 'Speech',
  pause: 'Internal pauses',
  trailing_silence: 'Trailing silence',
  playback: 'AI playback (excluded)',
  muted: 'Muted',
  unaccounted: 'Unaccounted',
};

export function VoiceTurnComposition({
  turns,
  selectedIndex,
  onSelectIndex,
}: VoiceTurnCompositionProps) {
  const patternId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const rows = turns.map((turn, index) => ({
    index,
    composition: turnTimeComposition(turn.voice),
  }));
  const drawable = rows.filter((row) => row.composition !== null);

  if (drawable.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — no turn carries a positive duration, so there is no time to compose.
      </p>
    );
  }

  const fillOf: Record<string, string> = {
    initial_silence: 'var(--surface-2)',
    speech: getColor(0),
    pause: 'var(--status-warn-dim)',
    trailing_silence: 'var(--surface-3)',
    playback: `url(#${patternId}-hatch)`,
    muted: `url(#${patternId}-dots)`,
    unaccounted: 'var(--status-null-dim)',
  };

  // One shared time scale so bar lengths are comparable ACROSS turns. The
  // scale spans whichever is larger per turn — wall clock or the summed
  // parts — so an overrunning turn is drawn in full rather than clipped.
  const maxMs = Math.max(
    ...drawable.map((row) => Math.max(row.composition!.totalMs, row.composition!.accountedMs)),
  );
  const plotW = W - PAD_L - PAD_R;
  const wOf = (ms: number) => (ms / Math.max(1, maxMs)) * plotW;

  const H = rows.length * ROW_H + 16;
  const kindsPresent = new Set<string>();
  for (const row of drawable) {
    for (const part of row.composition!.parts) kindsPresent.add(part.key);
    if (row.composition!.unaccountedMs > 0) kindsPresent.add('unaccounted');
  }
  const overrunning = drawable.filter((row) => row.composition!.overrunMs > 0).length;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Turn time composition: one stacked bar per turn showing initial silence, speech, internal pauses, trailing silence and exclusions, across ${rows.length} turns`}
      >
        <title>Where each turn&rsquo;s time went</title>
        <defs>
          <pattern id={`${patternId}-hatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6} height={6} fill="var(--surface-2)" />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--ink-3)" strokeWidth={1.5} />
          </pattern>
          <pattern id={`${patternId}-dots`} width={4} height={4} patternUnits="userSpaceOnUse">
            <rect width={4} height={4} fill="var(--surface-1)" />
            <circle cx={1} cy={1} r={0.9} fill="var(--ink-3)" />
          </pattern>
        </defs>

        {rows.map((row) => {
          const y = row.index * ROW_H + 8;
          const isSelected = row.index === selectedIndex;
          if (!row.composition) {
            return (
              <g key={`row-${row.index}`}>
                <text x={PAD_L - 5} y={y + BAR_H - 3} textAnchor="end" fontSize={9} fill="var(--ink-3)">
                  {row.index + 1}
                </text>
                <text x={PAD_L} y={y + BAR_H - 3} fontSize={9} fill="var(--ink-3)">
                  zero-length turn — nothing to compose
                </text>
              </g>
            );
          }
          const { parts, unaccountedMs, totalMs, overrunMs } = row.composition;
          let cursor = PAD_L;
          const bands = parts.map((part) => {
            const x = cursor;
            const width = wOf(part.ms);
            cursor += width;
            return { ...part, x, width };
          });
          const tailX = cursor;

          return (
            <g
              key={`row-${row.index}`}
              onClick={onSelectIndex ? () => onSelectIndex(row.index) : undefined}
              style={onSelectIndex ? { cursor: 'pointer' } : undefined}
            >
              {isSelected ? (
                <rect
                  x={0}
                  y={y - 3}
                  width={W}
                  height={BAR_H + 6}
                  fill="var(--surface-1)"
                  rx={2}
                />
              ) : null}
              <text x={PAD_L - 5} y={y + BAR_H - 3} textAnchor="end" fontSize={9} fill="var(--ink-3)">
                {row.index + 1}
              </text>
              {bands.map((band) =>
                band.width > 0 ? (
                  <rect
                    key={band.key}
                    x={band.x}
                    y={y}
                    width={Math.max(0.5, band.width)}
                    height={BAR_H}
                    fill={fillOf[band.key]}
                  >
                    <title>
                      {PART_LABEL[band.key]} — {formatDurationShort(band.ms)} (
                      {((band.ms / Math.max(1, totalMs)) * 100).toFixed(0)}% of the turn)
                    </title>
                  </rect>
                ) : null,
              )}
              {unaccountedMs > 0 ? (
                <rect
                  x={tailX}
                  y={y}
                  width={Math.max(0.5, wOf(unaccountedMs))}
                  height={BAR_H}
                  fill={fillOf.unaccounted}
                >
                  <title>
                    Unaccounted — {formatDurationShort(unaccountedMs)}: wall-clock turn time the
                    frame-time parts do not cover (dropped frames, or a turn stopped between frames)
                  </title>
                </rect>
              ) : null}
              {overrunMs > 0 ? (
                <text x={tailX + 4} y={y + BAR_H - 3} fontSize={8} fill="var(--status-warn)">
                  +{formatDurationShort(overrunMs)} over wall clock
                </text>
              ) : null}
              <text
                x={Math.min(W - PAD_R, tailX + wOf(unaccountedMs)) + 5}
                y={y + BAR_H - 3}
                fontSize={9}
                fill="var(--ink-3)"
              >
                {overrunMs > 0 ? '' : formatDurationShort(totalMs)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        {[...kindsPresent].map((key) => (
          <span key={key} className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true">
              <defs>
                <pattern id={`${patternId}-lg-${key}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={6} height={6} fill="var(--surface-2)" />
                  <line x1={0} y1={0} x2={0} y2={6} stroke="var(--ink-3)" strokeWidth={1.5} />
                </pattern>
              </defs>
              <rect
                x={1}
                y={1}
                width={10}
                height={10}
                fill={key === 'playback' ? `url(#${patternId}-lg-${key})` : fillOf[key]}
                stroke="var(--line)"
              />
            </svg>
            {PART_LABEL[key]}
          </span>
        ))}
      </div>

      <p className="m-0 text-xs text-ink-3">
        Reads: bar length is the turn&rsquo;s wall-clock duration, so turns are comparable. A wide
        leading band is a long think before answering; wide mid-bar warn bands are hesitation
        inside the answer; a wide trailing band is trailing off. The two produce the same speech
        ratio and mean different things.
        {overrunning > 0
          ? ` ${overrunning} turn${overrunning === 1 ? '' : 's'} accumulated more frame time than wall clock — the excess is labelled rather than clipped.`
          : ''}
      </p>
    </div>
  );
}
