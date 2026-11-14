import type { TypingQuality } from 'oyon';
import type { TypingMetricsV3 } from '@/lib/storedTypingWindows';
import { getColor } from '../analytics/charts/chartMath';
import { linearScale } from '../analytics/charts/chartMath';
import {
  compressTimeAxis,
  axisTimeTicks,
  findPauses,
  computeFrontier,
  formatDurationShort,
} from '@/lib/typingChartMath.js';

/*
 * TypingProgressionChart — the canonical keystroke-logging visualization
 * (Inputlog/Leijten & Van Waes call it the process graph): x = episode time,
 * y = document offset of each committed edit, one mark per edit, connected in
 * time order.
 *
 * What it reveals that no summary statistic can: a writer producing linearly
 * traces a single rising diagonal; a writer who jumps back to revise draws a
 * vertical drop below the leading edge and then a second rising line.
 * Recursive vs. linear composition is visible at a glance. The leading edge
 * (the furthest point the text has reached so far, recovered exactly as
 * `offset + distance` per entry) is drawn as a faint step line so any edit
 * BELOW the frontier is unmistakably a revision into already-written text.
 *
 * Time axis honesty (same stance as EmotionTimeline's labelled breaks):
 * the x axis is REAL episode time, not edit index — pause structure is half
 * of what this chart is for, and index layout would erase it. But a long
 * idle gap (the writer walked away) would squash every burst into a sliver,
 * so any gap longer than GAP_COMPRESS_MS collapses to a fixed-width band
 * with dashed edges and its REAL duration printed inside — compressed but
 * stated, never silent. Everything outside such a band keeps 1:1 time scale.
 * Shorter pauses at/above the episode's own `burst_threshold_ms` are marked
 * as subtle vertical bands, because a jump-back after a long pause (planned
 * restructuring) means something different from an immediate self-correction.
 *
 * Nothing here is interpolated: every mark is an observed edit from
 * `typing.revision_locations`; the thin connecting line only encodes reading
 * order. Ops are distinguished by SHAPE as well as colour (deletes are
 * triangles, replaces diamonds — the interesting events are bigger than the
 * insert dots), so meaning never rides on hue alone. Entries without a caret
 * offset cannot be positioned and are disclosed as omitted, not guessed at.
 */

export interface TypingProgressionChartProps {
  typing: TypingMetricsV3;
  quality?: TypingQuality;
}

const W = 860;
const H = 280;
const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 30;
/** Idle gaps longer than this compress to a fixed labelled band. */
const GAP_COMPRESS_MS = 15000;

const OP_COLOR: Record<string, string> = {
  insert: getColor(0),
  delete: getColor(2),
  replace: getColor(1),
  paste: getColor(5),
  correct: getColor(4),
};

function opColor(op: string): string {
  return OP_COLOR[op] ?? 'var(--ink-3)';
}

/** Shape per op — colour is never the only encoding. */
function opMark(op: string, x: number, y: number, key: string) {
  const c = opColor(op);
  switch (op) {
    case 'delete': // triangle-down, larger than an insert dot: deletes matter
      return <path key={key} d={`M${x - 3.4},${y - 3}L${x + 3.4},${y - 3}L${x},${y + 3.4}Z`} fill={c} />;
    case 'replace': // open diamond
      return (
        <path
          key={key}
          d={`M${x},${y - 3.8}L${x + 3.8},${y}L${x},${y + 3.8}L${x - 3.8},${y}Z`}
          fill="none"
          stroke={c}
          strokeWidth={1.5}
        />
      );
    case 'paste': // square
      return <rect key={key} x={x - 2.7} y={y - 2.7} width={5.4} height={5.4} fill={c} />;
    case 'correct': // plus
      return (
        <path
          key={key}
          d={`M${x - 3.2},${y}H${x + 3.2}M${x},${y - 3.2}V${y + 3.2}`}
          stroke={c}
          strokeWidth={1.6}
          fill="none"
        />
      );
    case 'insert':
      return <circle key={key} cx={x} cy={y} r={2} fill={c} />;
    default: // compose/commit/undo/redo — rare mechanics, drawn neutrally
      return <circle key={key} cx={x} cy={y} r={2} fill="none" stroke="var(--ink-3)" strokeWidth={1} />;
  }
}

function legendSwatch(op: string) {
  return (
    <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden="true">
      {opMark(op, 0, 0, op)}
    </svg>
  );
}

export function TypingProgressionChart({ typing, quality }: TypingProgressionChartProps) {
  const raw = Array.isArray(typing.revision_locations) ? typing.revision_locations : [];
  if (raw.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — <code>revision_locations</code> is empty: no positioned edits were captured
        for this episode.
      </p>
    );
  }
  const positioned = raw.filter((e) => Number.isFinite(e.offset) && Number.isFinite(e.t));
  if (positioned.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — no <code>revision_locations</code> entry carries a caret <code>offset</code>{' '}
        (the capture adapter did not supply <code>caretOffset</code>).
      </p>
    );
  }
  const omitted = raw.length - positioned.length;

  // Real episode time anchors: episode start sits first_input_latency before
  // the first edit; episode end covers the full elapsed span (a long tail
  // between the last edit and submit is data, not padding).
  const times = positioned.map((e) => e.t);
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

  const frontier = computeFrontier(positioned);
  const yMax = Math.max(
    1,
    ...positioned.map((e) => e.offset as number),
    ...frontier.map((p) => p.frontier),
  );
  const yScale = linearScale([0, yMax], [H - PAD_B, PAD_T]);

  // Frontier as a step line: horizontal to each edit's time, then vertical.
  const frontierPath = frontier
    .map((p, i) => {
      const x = xOf(p.t);
      const y = yScale(p.frontier);
      if (i === 0) return `M${x},${y}`;
      const prevY = yScale(frontier[i - 1].frontier);
      return `L${x},${prevY}L${x},${y}`;
    })
    .join('');

  // Reading-order connection (NOT interpolation of unobserved keystrokes).
  const connectPath = positioned
    .map((e, i) => `${i === 0 ? 'M' : 'L'}${xOf(e.t)},${yScale(e.offset as number)}`)
    .join('');

  const burstThresholdMs =
    (quality?.thresholds as { burst_threshold_ms?: number } | undefined)?.burst_threshold_ms ?? 2000;
  const isBreak = (startT: number, endT: number) =>
    axis.breaks.some((b) => b.realStart === startT && b.realEnd === endT);
  const pauses = findPauses(times, burstThresholdMs).filter((p) => !isBreak(p.startT, p.endT));

  const ticks = axisTimeTicks(axis, episodeStart, episodeEnd, 6);
  const opsPresent = [...new Set(positioned.map((e) => e.op))];

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Typing progression: document offset of every committed edit over episode time; drops below the leading-edge line are revisions into earlier text"
      >
        <title>Typing progression — document offset per edit over episode time</title>

        {/* Pause bands (≥ fixed burst threshold, not long enough to compress). */}
        {pauses.map((p, i) => (
          <rect
            key={`pause-${i}`}
            x={xOf(p.startT)}
            y={PAD_T}
            width={Math.max(1, xOf(p.endT) - xOf(p.startT))}
            height={H - PAD_T - PAD_B}
            fill="var(--status-warn-dim)"
          />
        ))}

        {/* Compressed idle gaps: dashed edges + real duration, never silent. */}
        {axis.breaks.map((b, i) => {
          const x0 = xOf(b.realStart);
          const x1 = xOf(b.realEnd);
          return (
            <g key={`break-${i}`}>
              <rect x={x0} y={PAD_T} width={x1 - x0} height={H - PAD_T - PAD_B} fill="var(--surface-2)" opacity={0.6} />
              <line x1={x0} y1={PAD_T} x2={x0} y2={H - PAD_B} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <line x1={x1} y1={PAD_T} x2={x1} y2={H - PAD_B} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <text
                x={(x0 + x1) / 2}
                y={PAD_T + 11}
                textAnchor="middle"
                fontSize={9}
                fill="var(--ink-3)"
              >
                {formatDurationShort(b.gapMs)}
              </text>
            </g>
          );
        })}

        {/* Gridlines + y axis (document offset in graphemes). */}
        {yScale.ticks(4).map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={yScale(v)} x2={W - PAD_R} y2={yScale(v)} stroke="var(--line)" />
            <text x={PAD_L - 6} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={10} fontSize={9} fill="var(--ink-3)">
          document offset (graphemes)
        </text>

        {/* x axis: real episode time. */}
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

        {/* Leading edge (faint step line) — revision below it is unmistakable. */}
        <path d={frontierPath} fill="none" stroke="var(--ink-3)" strokeWidth={1} opacity={0.4} />

        {/* Reading-order thread through the marks. */}
        <path d={connectPath} fill="none" stroke="var(--ink-3)" strokeWidth={0.75} opacity={0.3} />

        {/* One mark per observed edit. */}
        {positioned.map((e, i) => opMark(e.op, xOf(e.t), yScale(e.offset as number), `m-${i}`))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        {opsPresent.map((op) => (
          <span key={op} className="inline-flex items-center gap-1">
            {legendSwatch(op)}
            {op}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <svg width={14} height={12} aria-hidden="true">
            <path d="M1,9H7V3H13" fill="none" stroke="var(--ink-3)" strokeWidth={1} opacity={0.4} />
          </svg>
          leading edge
        </span>
        {pauses.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true">
              <rect x={1} y={1} width={10} height={10} fill="var(--status-warn-dim)" />
            </svg>
            pause ≥ {formatDurationShort(burstThresholdMs)}
          </span>
        )}
        {axis.breaks.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true">
              <rect x={1} y={1} width={10} height={10} fill="var(--surface-2)" />
              <line x1={1.5} y1={1} x2={1.5} y2={11} stroke="var(--ink-3)" strokeDasharray="2 2" />
              <line x1={10.5} y1={1} x2={10.5} y2={11} stroke="var(--ink-3)" strokeDasharray="2 2" />
            </svg>
            compressed idle (labelled)
          </span>
        )}
      </div>

      {omitted > 0 && (
        <p className="m-0 text-xs text-ink-3">
          {omitted} of {raw.length} edits carried no caret offset and are not drawn.
        </p>
      )}
      {quality?.revision_locations_truncated && (
        <p className="m-0 text-xs text-ink-3">
          <code>revision_locations</code> hit its retention cap — early edits are shown, later ones
          were dropped by the aggregator.
        </p>
      )}
    </div>
  );
}
