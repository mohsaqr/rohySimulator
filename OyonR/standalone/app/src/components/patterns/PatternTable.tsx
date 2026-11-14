import { useState, useMemo, type CSSProperties } from 'react';

/*
 * PatternTable — the LAILA-v3 sub-pattern table (client/src/components/tna/
 * PatternTable.tsx), brought over as-is; the only adaptation is inlining the
 * i18n strings (LAILA used react-i18next) so it drops into Oyon unchanged.
 * Sort by support/frequency/lift; tinted state chips; support bar per row.
 */

export interface Pattern {
  pattern: string;
  length: number;
  frequency: number;
  support: number;
  lift: number;
  proportion: number;
  count?: number;
  pValue?: number;
}

interface PatternTableProps {
  patterns: Pattern[];
  colorMap: Record<string, string>;
  /** Hard cap on rows shown (no "show more"). Omit for the default 20 + paging. */
  limit?: number;
}

type SortKey = 'frequency' | 'support' | 'lift' | 'proportion';

function chipStyle(color: string): CSSProperties {
  const c = color || '#888';
  return {
    background: `color-mix(in srgb, ${c} 14%, transparent)`,
    color: c,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 32%, transparent)`,
  };
}

export function PatternTable({ patterns, colorMap, limit }: PatternTableProps) {
  const [sortBy, setSortBy] = useState<SortKey>('support');
  const [sortAsc, setSortAsc] = useState(false);
  const [maxRows, setMaxRows] = useState(limit ?? 20);

  const sorted = useMemo(
    () => [...patterns].sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      return sortAsc ? diff : -diff;
    }),
    [patterns, sortBy, sortAsc],
  );

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  const displayed = sorted.slice(0, maxRows);
  const maxSupport = Math.max(...displayed.map((p) => p.support), 1e-9);

  const sortKeys: { key: SortKey; label: string }[] = [
    { key: 'support', label: 'Support' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'lift', label: 'Lift' },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        {sortKeys.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => handleSort(s.key)}
            className={`rounded px-2 py-0.5 text-mini font-medium transition-colors ${
              sortBy === s.key ? 'bg-surface-2 text-ink-1' : 'text-ink-3 hover:text-ink-1'
            }`}
          >
            {s.label}{sortBy === s.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>

      <div>
        {displayed.map((p, idx) => {
          const states = p.pattern.split('->');
          const firstColor = colorMap[states[0]] ?? '#888';
          const barPct = Math.max(2, (p.support / maxSupport) * 100);
          const tip = `Support: ${(p.support * 100).toFixed(1)}% · Lift: ${p.lift.toFixed(2)}× · Proportion: ${(p.proportion * 100).toFixed(1)}%`;
          return (
            <div key={idx} title={tip} className="border-t border-line py-2.5 first:border-t-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-ink-3">{idx + 1}</span>
                <span
                  className="flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-x-auto whitespace-nowrap"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {states.map((state, si) => (
                    <span key={si} className="flex shrink-0 items-center gap-1.5">
                      {/* The arrow sits one step ABOVE the chip text: an
                          arrow glyph reads optically smaller than letterforms
                          at the same size. Was 15/13 off-scale, now 16/14 on
                          it — the +2px relationship is preserved exactly. */}
                      {si > 0 && <span className="shrink-0 text-base font-semibold leading-none text-ink-3">→</span>}
                      <span
                        className="inline-block rounded-full px-3 py-1 text-sm font-semibold leading-tight"
                        style={chipStyle(colorMap[state] ?? '#888')}
                      >
                        {state}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink-1">{p.frequency.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 pl-7">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: firstColor }} />
                </div>
                <span className="w-11 shrink-0 text-right text-sm font-medium tabular-nums text-ink-2">
                  {(p.support * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {limit == null && sorted.length > maxRows && (
        <button
          type="button"
          onClick={() => setMaxRows((prev) => prev + 20)}
          className="mt-2 text-sm text-ink-2 hover:underline"
        >
          Show more ({sorted.length - maxRows} remaining)
        </button>
      )}
    </div>
  );
}
