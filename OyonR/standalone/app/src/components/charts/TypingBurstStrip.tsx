import type { TypingQuality } from 'oyon';
import type { TypingMetricsV3 } from '@/lib/storedTypingWindows';
import { getColor } from '../analytics/charts/chartMath';
import {
  compressTimeAxis,
  axisTimeTicks,
  findPauses,
  reconstructBursts,
  formatDurationShort,
} from '@/lib/typingChartMath.js';

/*
 * TypingBurstStrip — the episode as a horizontal strip of production
 * bursts. Each segment spans a burst's real duration; its colour AND edge
 * glyph say how the burst ENDED: pause-terminated (P-burst) vs
 * revision-terminated (R-burst) — the theoretically distinct events of
 * Chenoweth & Hayes. Pauses are literal gaps drawn proportionally (with a
 * subtle band where they meet the fixed threshold), so burst/pause rhythm
 * is readable as texture: long P-segments = fluent, planning-limited
 * production; frequent R-terminations = production repeatedly interrupted
 * to fix text.
 *
 * The segmentation is RECONSTRUCTED from `revision_locations` (op + t per
 * committed edit) using exactly the aggregator's `_closeCurrentBurst` rule:
 * a gap ≥ `burst_threshold_ms` closes a P-burst first, then a delete/replace
 * closes an R-burst (pause wins the tie); a burst still open at episode end
 * closes as a P-burst (drawn with a dashed outline — submit/abandon is not a
 * revision); a burst with no production closes nothing.
 * tests/app-typing-charts.test.js asserts this reconstruction agrees with
 * the aggregator's own `p_burst_count` / `r_burst_count`. At render time the
 * reconstructed counts are still compared against the window's reported
 * counts, and any disagreement (possible when some edits carried no caret
 * offset and so never reached `revision_locations`) is disclosed under the
 * strip instead of presenting the picture as authoritative.
 *
 * Long idle gaps compress to a fixed labelled band, same as the other
 * typing charts; everything else keeps 1:1 time scale. Nothing is invented:
 * every segment edge is an observed edit timestamp.
 */

export interface TypingBurstStripProps {
  typing: TypingMetricsV3;
  quality?: TypingQuality;
}

const W = 860;
const H = 130;
const PAD_L = 14;
const PAD_R = 14;
const TRACK_TOP = 36;
const TRACK_BOTTOM = 88;
const GAP_COMPRESS_MS = 15000;

const P_COLOR = getColor(0); // pause-terminated
const R_COLOR = getColor(2); // revision-terminated

export function TypingBurstStrip({ typing, quality }: TypingBurstStripProps) {
  const raw = Array.isArray(typing.revision_locations) ? typing.revision_locations : [];
  if (raw.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — <code>revision_locations</code> is empty: bursts are reconstructed from the
        per-edit op/time series and none was captured for this episode.
      </p>
    );
  }

  const burstThresholdMs =
    (quality?.thresholds as { burst_threshold_ms?: number } | undefined)?.burst_threshold_ms ?? 2000;
  const ops = raw.map((e) => e.op);
  const times = raw.map((e) => e.t);
  const rec = reconstructBursts(ops, times, burstThresholdMs);

  const reportedP = Number.isFinite(typing.p_burst_count as number)
    ? (typing.p_burst_count as number)
    : null;
  const reportedR = Number.isFinite(typing.r_burst_count as number)
    ? (typing.r_burst_count as number)
    : null;
  const matches =
    reportedP !== null && reportedR !== null
      ? rec.pCount === reportedP && rec.rCount === reportedR
      : null;

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

  const isBreak = (startT: number, endT: number) =>
    axis.breaks.some((b) => b.realStart === startT && b.realEnd === endT);
  const pauses = findPauses(times, burstThresholdMs).filter((p) => !isBreak(p.startT, p.endT));
  const revisions = raw.filter((e) => e.op === 'delete' || e.op === 'replace');
  const ticks = axisTimeTicks(axis, episodeStart, episodeEnd, 6);
  const trackH = TRACK_BOTTOM - TRACK_TOP;

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Timeline strip of production bursts: segment width is burst duration; pause-terminated and revision-terminated bursts are distinguished by colour and edge glyph, pauses are proportional gaps"
      >
        <title>Burst strip — P-bursts vs R-bursts over episode time</title>

        {/* Pause bands within the track (≥ threshold, not compressed). */}
        {pauses.map((p, i) => (
          <rect
            key={`pause-${i}`}
            x={xOf(p.startT)}
            y={TRACK_TOP}
            width={Math.max(1, xOf(p.endT) - xOf(p.startT))}
            height={trackH}
            fill="var(--status-warn-dim)"
          />
        ))}

        {/* Compressed idle gaps, labelled. */}
        {axis.breaks.map((b, i) => {
          const x0 = xOf(b.realStart);
          const x1 = xOf(b.realEnd);
          return (
            <g key={`break-${i}`}>
              <rect x={x0} y={TRACK_TOP} width={x1 - x0} height={trackH} fill="var(--surface-2)" opacity={0.6} />
              <line x1={x0} y1={TRACK_TOP} x2={x0} y2={TRACK_BOTTOM} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <line x1={x1} y1={TRACK_TOP} x2={x1} y2={TRACK_BOTTOM} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <text x={(x0 + x1) / 2} y={TRACK_TOP - 4} textAnchor="middle" fontSize={9} fill="var(--ink-3)">
                {formatDurationShort(b.gapMs)}
              </text>
            </g>
          );
        })}

        {/* Track baseline. */}
        <line x1={PAD_L} y1={TRACK_BOTTOM + 0.5} x2={W - PAD_R} y2={TRACK_BOTTOM + 0.5} stroke="var(--line-strong)" />

        {/* Burst segments. */}
        {rec.segments.map((s, i) => {
          const x = xOf(s.startT);
          const width = Math.max(2, xOf(s.endT) - x);
          const fill = s.kind === 'r' ? R_COLOR : P_COLOR;
          const trailing = s.closedBy === 'end';
          return (
            <g key={`seg-${i}`}>
              <rect
                x={x}
                y={TRACK_TOP + 6}
                width={width}
                height={trackH - 12}
                fill={fill}
                opacity={0.85}
                stroke={trailing ? 'var(--ink-1)' : 'none'}
                strokeWidth={trailing ? 1 : 0}
                strokeDasharray={trailing ? '3 3' : undefined}
              />
              {/* Letter label when the segment is wide enough — meaning
                  survives without colour. */}
              {width >= 16 && (
                <text
                  x={x + width / 2}
                  y={(TRACK_TOP + TRACK_BOTTOM) / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="#ffffff"
                >
                  {s.kind === 'r' ? 'R' : 'P'}
                </text>
              )}
            </g>
          );
        })}

        {/* Revision events (delete/replace): triangle terminator above the
            track at the revision's own observed time — the second non-colour
            cue for R-termination. */}
        {revisions.map((e, i) => (
          <path
            key={`rev-${i}`}
            d={`M${xOf(e.t) - 3},${TRACK_TOP - 2}L${xOf(e.t) + 3},${TRACK_TOP - 2}L${xOf(e.t)},${TRACK_TOP + 4}Z`}
            fill={R_COLOR}
          />
        ))}

        {/* x axis. */}
        {ticks.map((tk) => {
          const x = PAD_L + (tk.comp / spanMs) * plotW;
          return (
            <g key={`x-${tk.realMs}`}>
              <line x1={x} y1={TRACK_BOTTOM + 1} x2={x} y2={TRACK_BOTTOM + 5} stroke="var(--ink-3)" />
              <text x={x} y={TRACK_BOTTOM + 16} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                {formatDurationShort(tk.realMs)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        <span className="inline-flex items-center gap-1">
          <svg width={14} height={10} aria-hidden="true">
            <rect x={0} y={1} width={14} height={8} fill={P_COLOR} opacity={0.85} />
          </svg>
          P-burst (ended by a pause)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={18} height={10} aria-hidden="true">
            <rect x={0} y={1} width={12} height={8} fill={R_COLOR} opacity={0.85} />
            <path d="M13,0L19,0L16,6Z" fill={R_COLOR} transform="translate(-1 1) scale(0.9)" />
          </svg>
          R-burst (ended by a revision ▾)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={14} height={10} aria-hidden="true">
            <rect x={0.5} y={1.5} width={13} height={7} fill={P_COLOR} opacity={0.85} stroke="var(--ink-1)" strokeDasharray="2 2" />
          </svg>
          final burst (closed by submit/abandon, counts as P)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={12} height={10} aria-hidden="true">
            <rect x={0} y={0} width={12} height={10} fill="var(--status-warn-dim)" />
          </svg>
          pause ≥ {formatDurationShort(burstThresholdMs)}
        </span>
      </div>

      <p className="m-0 text-xs text-ink-3">
        Reconstructed {rec.pCount} P / {rec.rCount} R
        {matches === true && ' — matches the aggregator’s reported counts.'}
        {matches === null && ' — no reported counts on this row (pre-typing-v3), nothing to verify against.'}
      </p>
      {matches === false && (
        <p className="m-0 text-xs" style={{ color: 'var(--status-warn)' }}>
          Disagrees with the reported counts ({reportedP} P / {reportedR} R): some edits carried no
          caret offset and never reached <code>revision_locations</code>
          {quality?.revision_locations_truncated ? ', and the series was truncated at its cap' : ''}.
          Treat the strip as partial, the reported counts as authoritative.
        </p>
      )}
    </div>
  );
}
