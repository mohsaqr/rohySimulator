import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import type { StoredTypingWindow } from '@/lib/storedTypingWindows';
import {
  compareTypingSummaries,
  summarizeTypingBy,
  PAUSE_LOCATION_ORDER,
  type TypingAggregateSummary,
  type TypingSummaryMeasureKind,
  type TypingSummaryRow,
} from '@/lib/typingAnalytics';

/*
 * Typing tables for the person and group scopes: one row per session, per
 * day or per person, each a pooled summary (lib/typingAnalytics →
 * oyon summarizeTypingBy), and a two-person comparison.
 *
 * Every figure follows the typing null discipline: `—` means the episodes
 * did not carry that measurement, never zero. Rates are pooled from sums.
 *
 * Nothing here is carried by colour alone: every bar sits beside the number
 * it draws, and the bar colour is the app's single accent token (themeable by the host).
 */

const DASH = '—';

const PAUSE_LOCATION_SHORT: Record<string, string> = {
  mid_word: 'mid-word',
  word_boundary: 'word',
  sentence_boundary: 'sentence',
  paragraph_boundary: 'paragraph',
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function fixed(value: number | null, digits = 1): string {
  return value === null ? DASH : value.toFixed(digits);
}

function percent(value: number | null): string {
  return value === null ? DASH : `${(value * 100).toFixed(0)}%`;
}

function formatMeasure(value: number | null, kind: TypingSummaryMeasureKind): string {
  if (value === null) return DASH;
  if (kind === 'count') return value.toLocaleString();
  if (kind === 'duration_ms') return formatDuration(value);
  if (kind === 'ratio') return value.toFixed(2);
  return value.toFixed(1);
}

function formatDifference(value: number | null, kind: TypingSummaryMeasureKind): string {
  if (value === null) return DASH;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatMeasure(Math.abs(value), kind)}`;
}

/** Pause distribution by location as shares of the located pauses. */
function pauseLocationText(summary: TypingAggregateSummary): string {
  const counts = summary.pauseLocationCounts;
  if (!counts) return DASH;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return 'no pauses';
  return PAUSE_LOCATION_ORDER.filter((key) => key in counts)
    .map((key) => `${PAUSE_LOCATION_SHORT[key] ?? key} ${((counts[key] / total) * 100).toFixed(0)}%`)
    .join(' · ');
}

/** A number with a proportional bar beside it (the number is the reading). */
function BarCell({ value, max, text }: { value: number | null; max: number; text: string }) {
  const width = value !== null && max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 tabular-nums">{text}</span>
      <span className="h-2 min-w-16 flex-1 rounded-sm bg-surface-2" aria-hidden="true">
        <span className="block h-2 rounded-sm bg-status-info" style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

function TableShell({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardMeta>{meta}</CardMeta>
      </CardHeader>
      <CardContent>
        {/* Own scroll container: a wide table must scroll itself, never the page. */}
        <div className="overflow-x-auto">{children}</div>
      </CardContent>
    </Card>
  );
}

const TH = 'py-1.5 pr-3 font-semibold';
const TD = 'py-1.5 pr-3 tabular-nums';

function SummaryCells({ summary }: { summary: TypingAggregateSummary }) {
  return (
    <>
      <td className={TD}>{summary.episodes.toLocaleString()}</td>
      <td className={TD}>{formatDuration(summary.totalActiveMs)}</td>
      <td className={TD}>{fixed(summary.charsPerMinActive)}</td>
      <td className={TD}>{percent(summary.productRatio)}</td>
      <td className="py-1.5 pr-3">{pauseLocationText(summary)}</td>
      <td className={TD}>{fixed(summary.pBurstMeanGraphemes)}</td>
      <td className={TD}>{fixed(summary.rBurstMeanGraphemes)}</td>
      <td className={TD}>{fixed(summary.revisionRatio, 2)}</td>
    </>
  );
}

function SummaryHeadings() {
  return (
    <>
      <th className={TH}>Episodes</th>
      <th className={TH}>Active time</th>
      <th className={TH}>Chars/min (active)</th>
      <th className={TH}>Product ratio</th>
      <th className={TH}>Pauses by location</th>
      <th className={TH}>P-burst mean</th>
      <th className={TH}>R-burst mean</th>
      <th className={TH}>Revision ratio</th>
    </>
  );
}

/** Person scope: one pooled row per session. */
export function TypingBySessionTable({ episodes }: { episodes: StoredTypingWindow[] }) {
  const rows = useMemo(() => summarizeTypingBy(episodes, { by: 'session' }), [episodes]);
  return (
    <TableShell title="Sessions" meta={`${rows.length} session${rows.length === 1 ? '' : 's'} · each row pools that session's episodes`}>
      <table className="w-full min-w-[56rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className={TH}>Session</th>
            <SummaryHeadings />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line text-ink-1">
              <td className="max-w-56 truncate py-1.5 pr-3" title={row.key}>{row.label}</td>
              <SummaryCells summary={row.summary} />
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

/** Person scope: the by-day trend, one pooled row per calendar day. */
export function TypingByDayTable({ episodes }: { episodes: StoredTypingWindow[] }) {
  const rows = useMemo(() => summarizeTypingBy(episodes, { by: 'day' }), [episodes]);
  const maxRate = Math.max(0, ...rows.map((row) => row.summary.charsPerMinActive ?? 0));
  return (
    <TableShell title="By day" meta="production rate per calendar day (local time), pooled from that day's episodes">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className={TH}>Day</th>
            <th className={TH}>Episodes</th>
            <th className={TH}>Active time</th>
            <th className={TH}>Chars/min (active)</th>
            <th className={TH}>Product ratio</th>
            <th className={TH}>Revision ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line text-ink-1">
              <td className={TD}>{row.key}</td>
              <td className={TD}>{row.summary.episodes.toLocaleString()}</td>
              <td className={TD}>{formatDuration(row.summary.totalActiveMs)}</td>
              <td className="py-1.5 pr-3">
                <BarCell
                  value={row.summary.charsPerMinActive}
                  max={maxRate}
                  text={fixed(row.summary.charsPerMinActive)}
                />
              </td>
              <td className={TD}>{percent(row.summary.productRatio)}</td>
              <td className={TD}>{fixed(row.summary.revisionRatio, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

/** Group scope: one pooled row per person, with each person's share of the text. */
export function TypingByPersonTable({ rows }: { rows: TypingSummaryRow[] }) {
  return (
    <TableShell
      title="People"
      meta={`${rows.length} ${rows.length === 1 ? 'person' : 'people'} · rates are pooled from sums, not averaged from per-episode rates`}
    >
      <table className="w-full min-w-[64rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className={TH}>Person</th>
            <SummaryHeadings />
            <th className={TH}>Share of text</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line text-ink-1">
              <td className="max-w-48 truncate py-1.5 pr-3" title={row.key}>{row.label}</td>
              <SummaryCells summary={row.summary} />
              <td className="py-1.5 pr-3">
                <BarCell value={row.textShare} max={1} text={percent(row.textShare)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

/** Group scope: two people side by side, one row per measure. */
export function TypingPersonComparison({ rows }: { rows: TypingSummaryRow[] }) {
  const [leftKey, setLeftKey] = useState<string | null>(null);
  const [rightKey, setRightKey] = useState<string | null>(null);
  const left = rows.find((row) => row.key === leftKey) ?? rows[0];
  const right = rows.find((row) => row.key === rightKey) ?? rows[1];
  const comparison = useMemo(
    () => (left && right ? compareTypingSummaries(left.summary, right.summary) : []),
    [left, right],
  );
  if (!left || !right) return null;

  const picker = (label: string, value: string, onChange: (key: string) => void) => (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line bg-surface-0 px-2 py-1 text-xs text-ink-0"
      >
        {rows.map((row) => (
          <option key={row.key} value={row.key}>{row.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <TableShell title="Compare two people" meta="difference is B − A; — where either side was not measured">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {picker('A', left.key, setLeftKey)}
        {picker('B', right.key, setRightKey)}
      </div>
      <table className="w-full min-w-[32rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className={TH}>Measure</th>
            <th className={TH}>A · {left.label}</th>
            <th className={TH}>B · {right.label}</th>
            <th className={TH}>B − A</th>
          </tr>
        </thead>
        <tbody>
          {comparison.map((row) => (
            <tr key={row.key} className="border-b border-line text-ink-1">
              <td className="py-1.5 pr-3">{row.label}</td>
              <td className={TD}>{formatMeasure(row.a, row.kind)}</td>
              <td className={TD}>{formatMeasure(row.b, row.kind)}</td>
              <td className={TD}>{formatDifference(row.difference, row.kind)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}
