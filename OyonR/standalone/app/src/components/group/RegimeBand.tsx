import { REGIME_COLOURS, type DashboardView } from '@/lib/groupDashboard';
import { GUTTER, HatchPattern, PAL, TimeAxis, fmtNum, fmtTime, makeX, useElementWidth, type TimeSpan } from './groupChart';

/*
 * Regime band: ladyna regimeSequence (on codeStates bins) as one labelled
 * band on the shared clock, and the transition counts between consecutive
 * regimes (ladyna toSequences → ftna) as a from × to matrix shaded by count.
 * Regime names are written in the band where they fit and always in the
 * legend; `sparse` is hatched. Colours: REGIME_COLOURS (lib), shared with the
 * transition network.
 */

const H = 44;

export function RegimeBand({ regime, span }: { regime: Pick<DashboardView['regime'], 'kind' | 'rows' | 'bin_s' | 'channel'>; span: TimeSpan }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const x = makeX(span, width);
  const seen = [...new Set(regime.rows.map((r) => r.regime))];
  return (
    <div ref={ref} className="w-full">
      {width > 0 && regime.rows.length ? (
        <svg width={width} height={H + 20} role="img" aria-label={`Group ${regime.kind} regime sequence`}>
          <HatchPattern id="regime-hatch" />
          <text x={4} y={16} fontSize={11} className="text-ink-1" fill="currentColor">{regime.kind} regime</text>
          <text x={4} y={30} fontSize={10} className="text-ink-3" fill="currentColor">{regime.bin_s} s bins · {regime.channel}</text>
          {regime.rows.map((r) => {
            const x0 = Math.max(x(r.bin_start_s), GUTTER);
            const x1 = x(Math.min(r.bin_end_s, span.end_s));
            const w = Math.max(x1 - x0, 0.5);
            const sparse = r.regime === 'sparse';
            return (
              <g key={r.bin}>
                <rect x={x0} y={4} width={w} height={H - 12} fill={sparse ? 'url(#regime-hatch)' : (REGIME_COLOURS[r.regime] ?? PAL.grey)} fillOpacity={sparse ? 1 : 0.8} stroke="var(--surface-1)" strokeWidth={0.5}>
                  <title>
                    {`${fmtTime(r.bin_start_s)}–${fmtTime(r.bin_end_s)} · ${r.regime} · ${r.n_valid}/${r.n_members} members valid`
                      + (r.modal_state ? ` · modal ${r.modal_state} (${fmtNum(r.modal_share)})` : '')
                      + (r.da !== null ? ` · DA ${fmtNum(r.da)}` : '')}
                  </title>
                </rect>
                {w > 60 ? <text x={x0 + 3} y={H / 2 + 2} fontSize={10} fill={PAL.black}>{r.regime}</text> : null}
              </g>
            );
          })}
          <TimeAxis span={span} width={width} y={H - 6} />
        </svg>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
        {seen.map((s) => (
          <span key={s}>
            {s === 'sparse'
              ? <span className="mr-1 inline-block size-2.5 border border-ink-3 align-middle" />
              : <span className="mr-1 inline-block size-2.5 align-middle" style={{ backgroundColor: REGIME_COLOURS[s] ?? PAL.grey }} />}
            {s} ({regime.rows.filter((r) => r.regime === s).length})
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Transitions between consecutive bins as a from (rows) × to (columns)
 * matrix: each cell's count, shaded by its size relative to the largest, a
 * coloured swatch per regime, the self-transitions on the outlined diagonal.
 * The row share (of the transitions out of that regime) is in the tooltip.
 */
export function TransitionMatrix({ transitions }: { transitions: DashboardView['regime']['transitions'] }) {
  if (!transitions.length) return <p className="m-0 text-xs text-ink-3">Fewer than two regime bins: no transitions.</p>;
  const states = [...new Set(transitions.flatMap((t) => [t.from, t.to]))].sort();
  const count = (from: string, to: string) => transitions.find((t) => t.from === from && t.to === to)?.count ?? 0;
  const max = Math.max(...transitions.map((t) => t.count));
  // The row share is ladyna's transition probability (tna), not computed here.
  const prob = (from: string, to: string) => transitions.find((t) => t.from === from && t.to === to)?.prob ?? 0;
  const swatch = (s: string) => (
    <span className="mr-1 inline-block size-2.5 shrink-0 align-middle" style={{ backgroundColor: REGIME_COLOURS[s] ?? PAL.grey }} />
  );
  // Long regime names (convergent_negative) wrap at their underscores rather than being cut.
  const name = (s: string) => s.replace(/_/g, ' ');
  return (
    <table className="w-full border-separate border-spacing-0.5 text-xs tabular-nums">
      <thead>
        <tr>
          <th className="text-left align-bottom font-medium text-ink-3">from ↓ · to →</th>
          {states.map((s) => <th key={s} className="px-1 text-left align-bottom font-medium leading-tight text-ink-2" title={s}>{swatch(s)}{name(s)}</th>)}
        </tr>
      </thead>
      <tbody>
        {states.map((from) => (
          <tr key={from}>
            <th className="pr-1 text-left font-medium leading-tight text-ink-2" title={from}>{swatch(from)}{name(from)}</th>
            {states.map((to) => {
              const n = count(from, to);
              const share = prob(from, to);
              return (
                <td
                  key={to}
                  title={`${from} → ${to}: ${n} (${(share * 100).toFixed(0)} % of the transitions out of ${from})`}
                  className={`rounded-sm px-1.5 py-1.5 text-right ${from === to && n ? 'outline outline-1 outline-ink-3' : ''} ${n / max > 0.55 ? 'text-white' : 'text-ink-0'}`}
                  style={{ backgroundColor: n ? `rgba(0, 114, 178, ${(0.12 + 0.78 * (n / max)).toFixed(3)})` : 'transparent' }}
                >
                  {n || '·'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
