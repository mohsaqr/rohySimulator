import type { WritingByDayAndPerson, WritingOrigin, WritingSummary, WritingTimelinePoint } from 'oyon';
import { gapWords, niceTicks, sittingAxis } from '@/lib/writingChartMath';

/*
 * The writing dashboard's charts. Colours are Okabe–Ito only, and no distinction rests on colour alone:
 * every origin has its own marker shape and a direct label, every person a direct label.
 */

export const ORIGIN_COLOR: Record<WritingOrigin, string> = {
  typed: '#0072B2', pasted: '#E69F00', ai: '#CC79A7', system: '#999999',
};
export const ORIGIN_LABEL: Record<WritingOrigin, string> = {
  typed: 'Typed', pasted: 'Pasted', ai: 'AI-inserted', system: 'System',
};
const ADDED = '#009E73';
const REMOVED = '#D55E00';
/** People, in order. Black last: it reads as an axis. */
export const PERSON_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'];
const ORIGINS: WritingOrigin[] = ['typed', 'pasted', 'ai', 'system'];

/** The marker of one origin, centred on (x, y): circle, square, triangle, diamond. */
export function OriginMark({ origin, x, y, r = 3.2 }: { origin: WritingOrigin; x: number; y: number; r?: number }) {
  const fill = ORIGIN_COLOR[origin];
  if (origin === 'typed') return <circle cx={x} cy={y} r={r} fill={fill} />;
  if (origin === 'pasted') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={fill} />;
  if (origin === 'ai') return <path d={`M${x},${y - r * 1.25}L${x + r * 1.15},${y + r}L${x - r * 1.15},${y + r}Z`} fill={fill} />;
  return <path d={`M${x},${y - r * 1.3}L${x + r * 1.3},${y}L${x},${y + r * 1.3}L${x - r * 1.3},${y}Z`} fill={fill} />;
}

const pct = (share: number) => `${share >= 0.995 || share < 0.005 ? Math.round(share * 100) : (share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

/** Where the added text came from: one bar, each origin labelled with its share and its count. */
export function WritingOriginBar({ summary }: { summary: WritingSummary }) {
  if (summary.graphemesAdded === null || summary.graphemesAdded === 0) {
    return <p className="m-0 text-sm text-ink-3">Not measured: no edit in view carried a count of added text.</p>;
  }
  const rows = ORIGINS.map((origin) => ({ origin, ...summary.origins[origin] })).filter((row) => (row.graphemes ?? 0) > 0);
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-7 w-full overflow-hidden rounded"
        role="img"
        aria-label={`Added text by origin: ${rows.map((row) => `${ORIGIN_LABEL[row.origin]} ${pct(row.share ?? 0)}`).join(', ')}`}
      >
        {rows.map((row) => (
          <div
            key={row.origin}
            title={`${ORIGIN_LABEL[row.origin]}: ${pct(row.share ?? 0)}`}
            style={{ width: `${(row.share ?? 0) * 100}%`, background: ORIGIN_COLOR[row.origin], minWidth: 2 }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        {ORIGINS.map((origin) => {
          const row = summary.origins[origin];
          return (
            <div key={origin} className="flex items-start gap-2 text-xs">
              <svg width={14} height={14} className="mt-0.5 shrink-0" aria-hidden="true"><OriginMark origin={origin} x={7} y={7} r={4.2} /></svg>
              <div className="min-w-0">
                <div className="font-medium text-ink-1">{ORIGIN_LABEL[origin]}</div>
                <div className="tabular-nums text-ink-2">
                  {row.share === null ? '—' : pct(row.share)}
                  <span className="text-ink-3"> · {(row.graphemes ?? 0).toLocaleString()} characters{row.words !== null ? ` · ${row.words.toLocaleString()} words` : ''}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const W = 900, H = 280, PAD_L = 52, PAD_R = 16, PAD_T = 18, PAD_B = 46;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayWords = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

/**
 * The process graph: the text's net growth since the first recorded edit, over the sittings it was
 * written in. A step up is text added, a step down text removed; the marker says where added text came
 * from. Gaps between sittings are compressed to one labelled band each.
 */
export function WritingProcessGraph({ points, unit }: { points: WritingTimelinePoint[]; unit: 'words' | 'characters' }) {
  if (points.length === 0) {
    return <p className="m-0 text-sm text-ink-3">Not drawable: no edit in view carried a count of text added or removed.</p>;
  }
  const value = (p: WritingTimelinePoint) => (unit === 'words' ? p.netWords ?? 0 : p.net);
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const axis = sittingAxis(points.map((p) => p.t), plotW);
  const values = points.map(value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(1, ...values));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const x = (t: number) => PAD_L + axis.x(t);
  // A step line: the text stays as it was until the next edit changes it.
  let d = `M${x(points[0].t)},${y(0)}V${y(values[0])}`;
  for (let i = 1; i < points.length; i += 1) d += `H${x(points[i].t)}V${y(values[i])}`;
  // Markers thin out when there are too many to tell apart; every paste and AI insertion is kept.
  const every = Math.max(1, Math.ceil(points.length / 400));
  const last = points[points.length - 1];
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`Net ${unit} since the first recorded edit, over ${axis.sittings.length} sitting${axis.sittings.length === 1 ? '' : 's'}; ends at ${values[values.length - 1].toLocaleString()}`}>
        <title>Process graph: net {unit} over the sittings the text was written in</title>
        {axis.gaps.map((gap, i) => (
          <g key={`gap-${i}`}>
            <rect x={PAD_L + gap.x0} y={PAD_T} width={gap.x1 - gap.x0} height={plotH} fill="var(--surface-2)" />
            <text x={PAD_L + (gap.x0 + gap.x1) / 2} y={PAD_T + 11} textAnchor="middle" fontSize={9} fill="var(--ink-3)">{gapWords(gap.end - gap.start)}</text>
          </g>
        ))}
        {ticks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke={v === 0 ? 'var(--line-strong)' : 'var(--line)'} />
            <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">{v.toLocaleString()}</text>
          </g>
        ))}
        <text x={PAD_L} y={11} fontSize={9} fill="var(--ink-3)">net {unit} since the first recorded edit</text>
        {axis.sittings.map((s, i) => (
          <g key={`sit-${i}`}>
            <line x1={PAD_L + s.x0} y1={H - PAD_B} x2={PAD_L + s.x1} y2={H - PAD_B} stroke="var(--ink-3)" strokeWidth={1.5} />
            {s.x1 - s.x0 > 44 || axis.sittings.length <= 6 ? (
              <>
                <text x={PAD_L + s.x0} y={H - PAD_B + 14} fontSize={10} fill="var(--ink-2)">{clock(s.start)}</text>
                <text x={PAD_L + s.x0} y={H - PAD_B + 27} fontSize={9} fill="var(--ink-3)">{dayWords(s.start)}</text>
              </>
            ) : null}
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--ink-1)" strokeWidth={1.4} />
        {points.map((p, i) => (p.added > 0 && (p.origin !== 'typed' || i % every === 0)
          ? <OriginMark key={`m-${i}`} origin={p.origin} x={x(p.t)} y={y(values[i])} r={p.origin === 'typed' ? 2.2 : 4} />
          : null))}
        {points.map((p, i) => (p.removed > 0 && p.added === 0 && i % every === 0
          ? <path key={`r-${i}`} d={`M${x(p.t) - 3},${y(values[i]) - 3}l6,6m0,-6l-6,6`} stroke={REMOVED} strokeWidth={1.3} />
          : null))}
        <text x={Math.min(W - PAD_R - 4, x(last.t) + 6)} y={y(values[values.length - 1]) - 6} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ink-1)">
          {values[values.length - 1].toLocaleString()}
        </text>
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        {ORIGINS.filter((origin) => points.some((p) => p.origin === origin && p.added > 0)).map((origin) => (
          <span key={origin} className="inline-flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true"><OriginMark origin={origin} x={6} y={6} r={3.6} /></svg>
            {ORIGIN_LABEL[origin].toLowerCase()}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <svg width={12} height={12} aria-hidden="true"><path d="M3,3l6,6m0,-6l-6,6" stroke={REMOVED} strokeWidth={1.4} /></svg>
          removed
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={14} height={10} aria-hidden="true"><rect width={14} height={10} fill="var(--surface-2)" /></svg>
          time between sittings, compressed
        </span>
      </div>
    </div>
  );
}

const DW = 900, DH = 190, DPAD_L = 52, DPAD_R = 16, DPAD_T = 18, DPAD_B = 30;
/** The widest one day's slot gets: two days are two bars side by side at the left, not two pillars in a field. */
const DAY_SLOT_MAX = 64;

/**
 * Per calendar day: text added (up) and removed (down). With several people each day's added bar is
 * stacked by person, in the same order as the legend, and the legend names each colour.
 */
export function WritingDayBars({ grid }: { grid: WritingByDayAndPerson }) {
  if (grid.days.length === 0) return <p className="m-0 text-sm text-ink-3">No edits in view.</p>;
  const plotW = DW - DPAD_L - DPAD_R, plotH = DH - DPAD_T - DPAD_B;
  const ticks = niceTicks(-grid.maxRemoved, Math.max(1, grid.maxAdded));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => DPAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const slot = Math.min(DAY_SLOT_MAX, plotW / grid.days.length);
  const barW = Math.min(34, slot * 0.62);
  const usedW = slot * grid.days.length;
  const several = grid.people.length > 1;
  const colorOf = (person: string) => (several ? PERSON_COLORS[grid.people.findIndex((p) => p.key === person) % PERSON_COLORS.length] : ADDED);
  const labelEvery = Math.max(1, Math.ceil(grid.days.length / 12));
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${Math.max(360, DPAD_L + usedW + DPAD_R)} ${DH}`} className="h-auto" style={{ width: `${(Math.max(360, DPAD_L + usedW + DPAD_R) / DW) * 100}%` }} role="img"
        aria-label={`${grid.unit} added and removed per day over ${grid.days.length} day${grid.days.length === 1 ? '' : 's'}`}>
        <title>{grid.unit} added and removed per day</title>
        {ticks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={DPAD_L} y1={y(v)} x2={DPAD_L + usedW} y2={y(v)} stroke={v === 0 ? 'var(--line-strong)' : 'var(--line)'} />
            <text x={DPAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">{v < 0 ? '\u2212' : ''}{Math.abs(v).toLocaleString()}</text>
          </g>
        ))}
        <text x={DPAD_L} y={11} fontSize={9} fill="var(--ink-3)">{grid.unit} added ↑ · removed ↓</text>
        {grid.days.map((day, i) => {
          const cx = DPAD_L + slot * (i + 0.5);
          const cells = grid.people.map((person) => grid.cells.find((c) => c.day === day && c.person === person.key)).filter((c) => c != null);
          let up = 0;
          const removed = cells.reduce((sum, c) => sum + c!.removed, 0);
          const added = cells.reduce((sum, c) => sum + c!.added, 0);
          return (
            <g key={day}>
              {cells.map((c) => {
                const y1 = y(up + c!.added), y0 = y(up);
                up += c!.added;
                return c!.added > 0
                  ? <rect key={c!.person} x={cx - barW / 2} y={y1} width={barW} height={Math.max(0, y0 - y1)} fill={colorOf(c!.person)}><title>{`${grid.people.find((p) => p.key === c!.person)?.label}: +${c!.added.toLocaleString()}`}</title></rect>
                  : null;
              })}
              {removed > 0 ? (
                <rect x={cx - barW / 2} y={y(0)} width={barW} height={Math.max(0, y(-removed) - y(0))} fill={REMOVED} opacity={0.85}><title>{`removed ${removed.toLocaleString()}`}</title></rect>
              ) : null}
              {added > 0 ? <text x={cx} y={y(added) - 4} textAnchor="middle" fontSize={10} fill="var(--ink-2)">+{added.toLocaleString()}</text> : null}
              {removed > 0 ? <text x={cx} y={y(-removed) + 11} textAnchor="middle" fontSize={10} fill="var(--ink-2)">−{removed.toLocaleString()}</text> : null}
              {i % labelEvery === 0 ? <text x={cx} y={DH - DPAD_B + 16} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{day.slice(5)}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        {several
          ? grid.people.map((person, i) => (
            <span key={person.key} className="inline-flex items-center gap-1">
              <svg width={10} height={10} aria-hidden="true"><rect width={10} height={10} fill={PERSON_COLORS[i % PERSON_COLORS.length]} /></svg>
              {person.label} (added)
            </span>
          ))
          : <span className="inline-flex items-center gap-1"><svg width={10} height={10} aria-hidden="true"><rect width={10} height={10} fill={ADDED} /></svg>added</span>}
        <span className="inline-flex items-center gap-1"><svg width={10} height={10} aria-hidden="true"><rect width={10} height={10} fill={REMOVED} /></svg>removed (below the line)</span>
      </div>
    </div>
  );
}

const KIND_COLOR = (state: string): string => (
  state === 'delete' || state === 'block_remove' ? REMOVED
    : state === 'paste' ? ORIGIN_COLOR.pasted
      : state === 'insert' || state === 'block_add' ? ADDED : ORIGIN_COLOR.typed
);

/** How many edits of each kind: one labelled row per kind, most frequent first. */
export function WritingKindBars({ states, labels }: { states: Record<string, number>; labels: Record<string, string> }) {
  const rows = Object.entries(states).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="grid gap-x-8 gap-y-2 md:grid-cols-2" role="list" aria-label="Edits by kind">
      {rows.map(([state, n]) => (
        <div key={state} className="flex items-center gap-3 text-xs" role="listitem">
          <span className="w-28 shrink-0 font-medium text-ink-1">{labels[state] ?? state}</span>
          <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <span className="block h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: KIND_COLOR(state) }} />
          </span>
          <span className="w-24 shrink-0 text-right tabular-nums text-ink-2">{n.toLocaleString()} <span className="text-ink-3">({((n / total) * 100).toFixed(0)}%)</span></span>
        </div>
      ))}
    </div>
  );
}

export const ACT_COLOR: Record<string, string> = {
  write: '#0072B2', revise: '#D55E00', paste: '#E69F00', organise: '#999999', ai: '#CC79A7', decide: '#009E73', pause: '#56B4E9',
};
export const ACT_LABEL: Record<string, string> = {
  write: 'Write', revise: 'Revise', paste: 'Paste', organise: 'Organise', ai: 'AI', decide: 'Decide', pause: 'Pause',
};
export const ACT_MEANING: Record<string, string> = {
  write: 'new text typed', revise: 'existing text changed', paste: 'text brought in', organise: 'format or structure',
  ai: "an AI asked, or its words placed", decide: "an AI's words kept or rejected", pause: 'two minutes or more without an act',
};
const DETAIL_LABEL: Record<string, string> = {
  delete: 'deleted', replace: 'replaced', undo: 'undone or redone', format: 'format', structure: 'structure',
  insert: 'inserted', kept: 'kept', rejected: 'rejected',
};
export interface ActRow { act: string; count: number; share: number | null; details: Array<{ detail: string; count: number }> }

/** One strip of all acts, each segment labelled when wide enough. */
export function ActStrip({ acts, height = 26 }: { acts: ActRow[]; height?: number }) {
  const rows = acts.filter((row) => row.count > 0);
  if (rows.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <div className="flex w-full overflow-hidden rounded" style={{ height }} role="img"
      aria-label={rows.map((row) => `${ACT_LABEL[row.act]} ${Math.round((row.share ?? 0) * 100)}%`).join(', ')}>
      {rows.map((row) => (
        <div key={row.act} title={`${ACT_LABEL[row.act]}: ${row.count.toLocaleString()} (${Math.round((row.share ?? 0) * 100)}%)`}
          className="flex items-center justify-center overflow-hidden whitespace-nowrap text-[11px] font-medium"
          style={{ width: `${(row.share ?? 0) * 100}%`, minWidth: 3, background: ACT_COLOR[row.act], color: row.act === 'write' || row.act === 'revise' ? '#fff' : '#000' }}>
          {(row.share ?? 0) >= 0.08 ? ACT_LABEL[row.act] : ''}
        </div>
      ))}
    </div>
  );
}

/** The coarse summary: the strip, then all seven acts as tiles with count, share and detail. */
export function WritingActsSummary({ acts }: { acts: ActRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <ActStrip acts={acts} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {acts.map((row) => (
          <div key={row.act} className="rounded-lg border border-line bg-surface-1 p-3" style={{ borderTop: `4px solid ${ACT_COLOR[row.act]}`, opacity: row.count === 0 ? 0.55 : 1 }}>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{ACT_LABEL[row.act]}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-0">
              {row.share === null ? '—' : `${Math.round(row.share * 100)}%`}
            </div>
            <div className="text-xs tabular-nums text-ink-2">{row.count.toLocaleString()} act{row.count === 1 ? '' : 's'}</div>
            <div className="mt-1 text-mini text-ink-3">
              {row.details.length > 0
                ? row.details.map((d) => `${d.count.toLocaleString()} ${DETAIL_LABEL[d.detail] ?? d.detail}`).join(' · ')
                : ACT_MEANING[row.act]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
