import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InfoTip } from '@/components/ui/InfoTip';
import { download } from '@/components/group/download';
import { toCsv } from '@/lib/groupDashboard';

/*
 * A tidy table as it comes from the view model (one row per pathway /
 * pattern / order), headed by its column names, with a CSV download.
 * Nothing is computed here; the styling only reads the values:
 *   - numeric columns right-aligned;
 *   - p-value columns (p, p_adj, p_lt, …) emphasised below .05, "<.001" below .001;
 *   - verdict words (above chance, stable, over, …) as coloured chips —
 *     the word is always written, so colour never carries it alone;
 *   - `shade` columns tinted by size relative to the column's largest
 *     |value| (blue, vermillion for negatives).
 */
const UP = new Set(['yes', 'stable', 'above chance', 'over', 'more often', 'positive', 'converged']);
const DOWN = new Set(['below chance', 'under', 'less often', 'negative', 'unstable']);
const FLAT = new Set(['no', 'as expected', 'normal', 'too few to test', 'random', 'unclassifiable', 'not stable', 'acceptable', 'not estimable']);
const isP = (col: string) => /^p($|_)/.test(col);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function Chip({ word }: { word: string }) {
  const tone = UP.has(word) ? 'bg-status-ok-dim text-status-ok'
    : DOWN.has(word) ? 'bg-status-bad-dim text-status-bad'
      : 'bg-surface-2 text-ink-3';
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{word}</span>;
}
export function RowsTable({ rows, title, fileName, maxHeight = 320, info, shade = [] }: {
  rows: ReadonlyArray<Record<string, string | number>>;
  title: string;
  fileName: string;
  maxHeight?: number;
  /** What the columns mean, behind a "?" beside the title. */
  info?: ReactNode;
  /** Numeric columns to tint by size. */
  shade?: ReadonlyArray<string>;
}) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]!);
  const numeric = new Set(cols.filter((c) => rows.every((r) => isNum(r[c]) || r[c] === '–')));
  const top: Record<string, number> = Object.fromEntries(shade.filter((c) => numeric.has(c))
    .map((c) => [c, Math.max(0, ...rows.map((r) => (isNum(r[c]) ? Math.abs(r[c] as number) : 0)))]));
  const cell = (c: string, v: string | number) => {
    if (typeof v === 'string' && (UP.has(v) || DOWN.has(v) || FLAT.has(v))) return <Chip word={v} />;
    // p below .001 prints as "<.001" (an underflowed 0 would read as "0"); the CSV keeps the value.
    if (isP(c) && isNum(v) && (v as number) < 0.05) return <span className="font-semibold text-ink-0">{(v as number) < 0.001 ? '<.001' : String(v)}</span>;
    return String(v);
  };
  const tint = (c: string, v: string | number) => {
    if (!(c in top) || !isNum(v) || !top[c]) return undefined;
    const t = Math.abs(v as number) / top[c]!;
    return { backgroundColor: (v as number) < 0 ? `rgba(213, 94, 0, ${(0.08 + 0.42 * t).toFixed(3)})` : `rgba(0, 114, 178, ${(0.08 + 0.42 * t).toFixed(3)})` };
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink-1">{title}</span>
          {info ? <InfoTip label={title}>{info}</InfoTip> : null}
        </span>
        <Button size="sm" variant="outline" onClick={() => download({ name: fileName, content: toCsv(rows as Record<string, unknown>[]), mime: 'text/csv' })}>
          <Download className="size-3.5" aria-hidden="true" /> CSV
        </Button>
      </div>
      <div className="overflow-auto rounded border border-line" style={{ maxHeight }}>
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr>
              {cols.map((c) => (
                <th key={c} className={`border-b border-line px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3 ${numeric.has(c) ? 'text-right' : 'text-left'}`}>
                  {c.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="odd:bg-surface-1 hover:bg-surface-2">
                {cols.map((c) => (
                  <td key={c} style={tint(c, r[c]!)} className={`px-2 py-1 text-ink-1 ${numeric.has(c) ? 'text-right' : 'text-left'}`}>
                    {cell(c, r[c]!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
