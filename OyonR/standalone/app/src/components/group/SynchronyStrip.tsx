import type { StripPoint } from '@/lib/groupDashboard';
import { GUTTER, PAD_R, PAL, TimeAxis, fmtNum, fmtTime, makeX, useElementWidth, type TimeSpan } from './groupChart';
import { extent } from '@/lib/extent';

/*
 * Synchrony strip: the mean over pairs (ladyna meanPairwise) of the selected
 * measure per window, with the surrogate null band (ladyna surrogateNull,
 * null_lo–null_hi) under it. Plan §6: the trace is solid where it leaves the
 * band and faint inside it; points outside are filled, inside hollow, so the
 * distinction is shape + weight, not colour.
 */

const H = 150;
const TOP = 8;
const BOTTOM = 26;

export function SynchronyStrip({ strip, span, measure }: { strip: StripPoint[]; span: TimeSpan; measure: string | null }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const x = makeX(span, width);
  const vals: number[] = [];
  for (const p of strip) {
    for (const v of [p.value, p.null_lo, p.null_hi]) if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
  }
  const range = extent(vals, { include: [0] });
  const lo = range ? range.min : 0;
  const hi = range ? range.max : 1;
  const pad = (hi - lo) * 0.08 || 0.1;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const plotH = H - TOP - BOTTOM;
  const y = (v: number) => TOP + (1 - (v - y0) / (y1 - y0)) * plotH;
  const hasNull = strip.some((p) => p.null_lo !== null && p.null_hi !== null);

  const band = strip.filter((p) => p.null_lo !== null && p.null_hi !== null);
  const bandPath = band.length > 1
    ? `M${band.map((p) => `${x(p.t_mid_s)},${y(p.null_hi as number)}`).join(' L')} L${band.slice().reverse().map((p) => `${x(p.t_mid_s)},${y(p.null_lo as number)}`).join(' L')} Z`
    : null;

  const segments: Array<{ a: StripPoint; b: StripPoint; solid: boolean }> = [];
  for (let i = 1; i < strip.length; i += 1) {
    const a = strip[i - 1];
    const b = strip[i];
    if (a.value === null || b.value === null) continue;
    segments.push({ a, b, solid: !hasNull || a.outside === true || b.outside === true });
  }

  return (
    <div ref={ref} className="w-full">
      {width > 0 ? (
        <svg width={width} height={H} role="img" aria-label={`Mean pairwise ${measure ?? ''} over time with surrogate null band`}>
          <text x={4} y={TOP + 10} fontSize={11} className="text-ink-1" fill="currentColor">mean {measure ?? '–'}</text>
          <text x={4} y={TOP + 24} fontSize={10} className="text-ink-3" fill="currentColor">over pairs, per window</text>
          {[y1 - pad, 0, y0 + pad].map((v, i) => (
            <g key={i} className="text-ink-3">
              <line x1={GUTTER} x2={width - PAD_R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.5 : 0.15} strokeDasharray={v === 0 ? undefined : '2 3'} />
              <text x={GUTTER - 4} y={y(v) + 3} fontSize={10} textAnchor="end" fill="currentColor">{fmtNum(v)}</text>
            </g>
          ))}
          {bandPath ? <path d={bandPath} fill={PAL.grey} fillOpacity={0.28} stroke={PAL.grey} strokeOpacity={0.6} strokeDasharray="3 2" /> : null}
          {segments.map((s, i) => (
            <line
              key={i}
              x1={x(s.a.t_mid_s)}
              y1={y(s.a.value as number)}
              x2={x(s.b.t_mid_s)}
              y2={y(s.b.value as number)}
              stroke={PAL.blue}
              strokeWidth={s.solid ? 2.2 : 1.2}
              strokeOpacity={s.solid ? 1 : 0.35}
            />
          ))}
          {strip.map((p, i) => (p.value === null ? null : (
            <circle
              key={i}
              cx={x(p.t_mid_s)}
              cy={y(p.value)}
              r={3}
              fill={!hasNull || p.outside ? PAL.blue : 'transparent'}
              stroke={PAL.blue}
              strokeOpacity={!hasNull || p.outside ? 1 : 0.5}
            >
              <title>
                {`${fmtTime(p.window_start_s)}–${fmtTime(p.window_end_s)} · ${measure} ${fmtNum(p.value)} · ${p.n_pairs} pair(s), overlap ${fmtNum(p.overlap)}`
                  + (p.null_lo !== null ? ` · null [${fmtNum(p.null_lo)}, ${fmtNum(p.null_hi)}], z ${fmtNum(p.z)}, p ${fmtNum(p.p_null, 3)}` : '')}
              </title>
            </circle>
          )))}
          <TimeAxis span={span} width={width} y={H - BOTTOM + 4} />
        </svg>
      ) : null}
      {strip.length === 0 ? <p className="m-0 mt-1 text-xs text-ink-3">No windows have a value for this measure.</p> : null}
    </div>
  );
}

/** How to read the strip, for the "?" beside its title. */
export function SynchronyStripInfo({ strip, singleGroup }: { strip: StripPoint[]; singleGroup: boolean }) {
  const hasNull = strip.some((p) => p.null_lo !== null && p.null_hi !== null);
  return (
    <>
      <p>The mean over member pairs (ladyna meanPairwise) of the selected measure, window by window.</p>
      <p>
        {hasNull
          ? '● solid = outside the surrogate band (grey, 2.5–97.5 %); ○ faint = inside it, not distinguishable from the null.'
          : 'No null computed yet: every window is drawn solid. Compute the null to see which windows leave the band.'}
      </p>
      {singleGroup ? <p>One group only: the null is a circular shift, which keeps shared-stimulus co-activation as &quot;synchrony&quot;. Load several groups doing the same task for a pseudo-group null.</p> : null}
    </>
  );
}
