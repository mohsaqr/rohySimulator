import type { Ribbon } from '@/lib/groupDashboard';
import { GUTTER, HatchPattern, PAL, PAD_R, TimeAxis, fmtPct, makeX, stateColorMap, useElementWidth, type TimeSpan } from './groupChart';
import { extent } from '@/lib/extent';

/*
 * Member ribbons: one row per member on the shared clock for the selected
 * channel (ladyna channelMatrix of the brushed table). Continuous channels are
 * a line of the member's own series; categorical channels are runs of states,
 * each run labelled where it fits and listed in the legend. Ticks with
 * quality < 0.5 — including missing ticks — are drawn HATCHED over the row,
 * never removed (data policy: flag, don't hide).
 */

const ROW_H = 40;

function runs(points: Ribbon['points']) {
  const out: Array<{ state: string; start: number; end: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const next = points[i + 1]?.t_s ?? p.t_s + (i > 0 ? p.t_s - points[i - 1].t_s : 1);
    if (p.state === null) continue;
    const last = out[out.length - 1];
    if (last && last.state === p.state && Math.abs(last.end - p.t_s) < 1e-9) last.end = next;
    else out.push({ state: p.state, start: p.t_s, end: next });
  }
  return out;
}

function linePath(points: Ribbon['points'], x: (t: number) => number, y: (v: number) => number) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.value === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.t_s).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function MemberRibbons({ ribbons, span, channel }: { ribbons: Ribbon[]; span: TimeSpan; channel: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const x = makeX(span, width);
  const categorical = ribbons[0]?.kind === 'categorical';
  const colors = stateColorMap(ribbons.flatMap((r) => r.points.map((p) => p.state)));
  const height = ribbons.length * ROW_H + 24;
  return (
    <div ref={ref} className="w-full">
      {width > 0 && ribbons.length ? (
        <svg width={width} height={height} role="img" aria-label={`Member ribbons for ${channel}`}>
          <HatchPattern id="ribbon-hatch" color={PAL.black} />
          {ribbons.map((r, i) => {
            const top = i * ROW_H + 4;
            const h = ROW_H - 10;
            // One pass over every observation; no spread into Math.min/max (argument limit).
            const range = extent(r.points.map((p) => p.value));
            const lo = range ? range.min : 0;
            const hi = range ? range.max : 1;
            const y = (v: number) => top + h - ((v - lo) / (hi - lo || 1)) * h;
            return (
              <g key={r.member_id}>
                <text x={4} y={top + 13} fontSize={11} className="text-ink-0" fill="currentColor">
                  {r.member_id}{r.seat ? ` (${r.seat})` : ''}
                </text>
                <text x={4} y={top + 26} fontSize={10} className="text-ink-3" fill="currentColor">
                  {fmtPct(r.quality_share)} usable
                </text>
                <rect x={GUTTER} y={top} width={Math.max(width - GUTTER - PAD_R, 0)} height={h} fill="currentColor" className="text-ink-3" fillOpacity={0.05} />
                {categorical
                  ? runs(r.points).map((run, k) => {
                    const x0 = x(run.start);
                    const w = Math.max(x(run.end) - x0, 0.5);
                    return (
                      <g key={k}>
                        <rect x={x0} y={top + 4} width={w} height={h - 8} fill={colors.get(run.state)} fillOpacity={0.75}>
                          <title>{`${r.member_id}: ${run.state}`}</title>
                        </rect>
                        {w > 44 ? <text x={x0 + 3} y={top + h / 2 + 4} fontSize={10} fill={PAL.black}>{run.state}</text> : null}
                      </g>
                    );
                  })
                  : <path d={linePath(r.points, x, y)} fill="none" stroke={PAL.blue} strokeWidth={1.4} />}
                {r.low_quality_spans.map((s, k) => (
                  <rect key={`q${k}`} x={x(s.start_s)} y={top} width={Math.max(x(s.end_s) - x(s.start_s), 1)} height={h} fill="url(#ribbon-hatch)">
                    <title>{`${r.member_id}: quality < 0.5 or missing`}</title>
                  </rect>
                ))}
              </g>
            );
          })}
          <TimeAxis span={span} width={width} y={ribbons.length * ROW_H} />
        </svg>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        <span>
          <svg width={14} height={10} aria-hidden="true" className="mr-1 inline-block align-middle">
            <HatchPattern id="ribbon-hatch-key" color={PAL.black} />
            <rect width={14} height={10} fill="url(#ribbon-hatch-key)" />
          </svg>
          hatched = quality &lt; 0.5 or missing (kept, flagged)
        </span>
        {categorical
          ? [...colors.entries()].map(([state, color]) => (
            <span key={state}>
              <span className="mr-1 inline-block size-2.5 align-middle" style={{ backgroundColor: color }} />
              {state}
            </span>
          ))
          : <span>line = each member&apos;s {channel} (own scale per row)</span>}
      </div>
    </div>
  );
}
