import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { summarizeRecordsBy, type RecordSummaryRow } from 'oyon';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import { Section } from '@/components/ui/Section';
import { useBridge } from '@/lib/hostBridge';
import { useOverviewRecords } from '@/lib/overviewRecords';
import { useLevelSelection, type LevelView } from '@/lib/levelSelection';
import { LevelMenus, autoLevel } from './LevelMenus';
import { emotionColor } from '@/lib/emotionColors';
import { cn } from '@/lib/cn';

/*
 * RecordsOverview — the dashboard's front page: the headline figures of
 * what is in view and one table of the units at one aggregation level
 * (classes, groups, people or sessions — whichever the records carry). The
 * level drop-downs that drive it are in the top bar (LevelMenus).
 *
 * It replaces a session list that knew only camera windows. Every row here
 * counts all record kinds (interval windows, typing episodes, voice turns,
 * events), so a session that held only writing — or a host with no camera —
 * is listed with the figures it actually has. A figure whose signal was not
 * recorded is "—", never 0.
 *
 * The table lists every unit in the scope; ticking rows narrows the rest of
 * the dashboard to them (the headline figures and every Analyze view follow,
 * and a chip per narrowed level shows it), and "Analyze" opens the analytics
 * on one row. Columns sort on click.
 *
 * Nothing is carried by colour alone: a selected row has a ticked checkbox
 * and `aria-selected`, sort direction has an arrow and `aria-sort`, and the
 * emotion swatch always sits beside its label.
 */

const DASH = '—';

function duration(ms: number | null): string {
  if (ms === null) return DASH;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function when(ms: number | null): string {
  return ms === null ? DASH : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fixed(value: number | null, digits = 1): string {
  return value === null ? DASH : value.toFixed(digits);
}

const SIGNAL_LABELS: Record<string, string> = {
  emotion: 'affect',
  engagement: 'attention',
  gaze: 'gaze',
  typing: 'typing',
  voice: 'voice',
  discourse: 'discourse',
  interaction: 'interaction',
  ai_assist: 'AI assist',
  document_edit: 'document edits',
  code_run: 'code runs',
};

function signals(row: RecordSummaryRow): string {
  return row.modalities.length > 0
    ? row.modalities.map((name) => SIGNAL_LABELS[name] ?? name).join(', ')
    : DASH;
}

function Emotion({ row }: { row: RecordSummaryRow }) {
  if (!row.dominantEmotion) return <>{DASH}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ background: emotionColor(row.dominantEmotion) }}
        aria-hidden="true"
      />
      {row.dominantEmotion}
      <span className="text-ink-3">{row.dominantShare !== null ? `${(row.dominantShare * 100).toFixed(0)}%` : ''}</span>
    </span>
  );
}

interface Column {
  id: string;
  label: string;
  align?: 'right';
  /** Sort key; null sorts last in either direction. */
  sort: (row: RecordSummaryRow) => number | string | null;
  cell: (row: RecordSummaryRow) => ReactNode;
}

const COUNT = (value: number) => value.toLocaleString();

const SHARED_COLUMNS: Column[] = [
  { id: 'signals', label: 'Signals', sort: (r) => r.modalities.length, cell: signals },
  { id: 'windows', label: 'Windows', align: 'right', sort: (r) => r.windows, cell: (r) => COUNT(r.windows) },
  { id: 'emotion', label: 'Dominant affect', sort: (r) => r.dominantEmotion, cell: (r) => <Emotion row={r} /> },
  { id: 'focus', label: 'Focus', align: 'right', sort: (r) => r.meanFocus, cell: (r) => fixed(r.meanFocus, 2) },
  { id: 'episodes', label: 'Typing episodes', align: 'right', sort: (r) => r.typingEpisodes, cell: (r) => COUNT(r.typingEpisodes) },
  { id: 'active', label: 'Active typing', align: 'right', sort: (r) => r.typingActiveMs, cell: (r) => duration(r.typingActiveMs) },
  { id: 'rate', label: 'Chars/min (active)', align: 'right', sort: (r) => r.charsPerMinActive, cell: (r) => fixed(r.charsPerMinActive) },
  { id: 'revision', label: 'Revision ratio', align: 'right', sort: (r) => r.revisionRatio, cell: (r) => fixed(r.revisionRatio, 2) },
  { id: 'events', label: 'Events', align: 'right', sort: (r) => r.events, cell: (r) => COUNT(r.events) },
];

/** The columns for one level: the unit, what it contains, then the signals. */
function columnsFor(level: LevelView): Column[] {
  const unit: Column = {
    id: 'unit',
    label: level.label,
    sort: (r) => r.label.toLowerCase(),
    cell: (r) => (
      <span className={level.key === 'session_id' ? 'font-mono' : 'font-medium text-ink-0'} title={r.key}>
        {r.key === '__none__' ? `No ${level.label.toLowerCase()}` : r.label}
      </span>
    ),
  };
  if (level.key === 'session_id') {
    return [
      unit,
      {
        id: 'person',
        label: 'Person',
        sort: (r) => (r.userLabel ? r.userLabel.toLowerCase() : null),
        cell: (r) => r.userLabel ?? (r.people > 1 ? `${r.people} people` : DASH),
      },
      { id: 'start', label: 'Started', sort: (r) => r.firstMs, cell: (r) => when(r.firstMs) },
      { id: 'length', label: 'Length', align: 'right', sort: (r) => r.spanMs, cell: (r) => duration(r.spanMs) },
      ...SHARED_COLUMNS,
    ];
  }
  const contains: Column[] = level.key === 'user_id'
    ? []
    : [{ id: 'people', label: 'People', align: 'right', sort: (r) => r.people, cell: (r) => COUNT(r.people) }];
  return [
    unit,
    ...contains,
    { id: 'sessions', label: 'Sessions', align: 'right', sort: (r) => r.sessions, cell: (r) => COUNT(r.sessions) },
    { id: 'last', label: 'Last active', sort: (r) => r.lastMs, cell: (r) => when(r.lastMs) },
    ...SHARED_COLUMNS,
  ];
}

interface SortState {
  id: string;
  descending: boolean;
}

function sortRows(rows: RecordSummaryRow[], columns: Column[], sort: SortState | null): RecordSummaryRow[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.id === sort.id);
  if (!column) return rows;
  return rows
    .map((row, index) => ({ row, index, value: column.sort(row) }))
    .sort((a, b) => {
      // Not-measured values go last whichever way the column is sorted.
      if (a.value === null || b.value === null) {
        if (a.value === null && b.value === null) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      const order = typeof a.value === 'string' || typeof b.value === 'string'
        ? String(a.value).localeCompare(String(b.value))
        : a.value - b.value;
      // Ties keep the table's own order, so sorting is deterministic.
      return (sort.descending ? -order : order) || a.index - b.index;
    })
    .map((entry) => entry.row);
}

interface SummaryTableProps {
  title: string;
  meta: string;
  rows: RecordSummaryRow[];
  columns: Column[];
  /** Keys of the rows the dashboard is currently narrowed to (null = none). */
  selected: string[] | null;
  /** Toggle narrowing to one row. Omit where the scope allows no narrowing. */
  onToggle?: (key: string) => void;
  /** Narrow to the row and open the analytics. */
  onAnalyze: (key: string) => void;
  rowNoun: string;
  /** Extra trailing cell per row (the standalone page's export button). */
  rowAction?: (row: RecordSummaryRow) => ReactNode;
}

function SummaryTable({ title, meta, rows, columns, selected, onToggle, onAnalyze, rowNoun, rowAction }: SummaryTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);
  const chosen = new Set(selected ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardMeta>{meta}</CardMeta>
      </CardHeader>
      <CardContent className="p-0">
        {/* Own scroll container: a wide table scrolls itself, never the page. */}
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface-2 text-ink-2">
              <tr>
                {onToggle ? <th className="w-8 px-3 py-2"><span className="sr-only">Selected</span></th> : null}
                {columns.map((column) => {
                  const active = sort !== null && sort.id === column.id;
                  return (
                    <th
                      key={column.id}
                      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                      className={cn('whitespace-nowrap px-3 py-2 font-semibold', column.align === 'right' && 'text-right')}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSort((current) =>
                            current !== null && current.id === column.id
                              ? current.descending ? null : { id: column.id, descending: true }
                              : { id: column.id, descending: false },
                          )
                        }
                        className="inline-flex items-center gap-1 hover:text-ink-0"
                        title={`Sort by ${column.label.toLowerCase()}`}
                      >
                        {column.label}
                        <span aria-hidden="true" className="w-2 text-ink-3">
                          {active ? (sort.descending ? '▼' : '▲') : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const isSelected = chosen.has(row.key);
                return (
                  <tr
                    key={row.key}
                    aria-selected={onToggle ? isSelected : undefined}
                    className={cn(
                      'border-t border-line text-ink-1 transition-colors hover:bg-surface-2/60',
                      isSelected && 'bg-status-info-dim',
                    )}
                  >
                    {onToggle ? (
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggle(row.key)}
                          aria-label={`Show only ${rowNoun} ${row.label}`}
                          className="size-3.5 cursor-pointer"
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          'max-w-64 truncate px-3 py-1.5 tabular-nums',
                          column.align === 'right' && 'text-right',
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1">
                        {rowAction ? rowAction(row) : null}
                        <button
                          type="button"
                          onClick={() => onAnalyze(row.key)}
                          aria-label={`Analyze ${rowNoun} ${row.label}`}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-status-info hover:bg-status-info-dim"
                        >
                          Analyze
                          <ArrowRight className="size-3" aria-hidden="true" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function toggled(current: string[] | null, key: string): string[] | null {
  const next = new Set(current ?? []);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next.size > 0 ? [...next] : null;
}

function sumOf(rows: RecordSummaryRow[], read: (row: RecordSummaryRow) => number | null): number | null {
  return rows.reduce<number | null>((sum, row) => {
    const value = read(row);
    return value !== null ? (sum ?? 0) + value : sum;
  }, null);
}

export interface RecordsOverviewProps {
  /** Extra trailing cell on each session row (standalone: bundle export). */
  sessionAction?: (row: RecordSummaryRow) => ReactNode;
  /** Shown instead of the default when there is nothing in scope. */
  empty?: ReactNode;
}

export function RecordsOverview({ sessionAction, empty }: RecordsOverviewProps = {}) {
  const { inView } = useOverviewRecords();
  const { levels, select, isLoading } = useLevelSelection();
  const embedded = useBridge((s) => s.embedded);
  const overviewLevel = useBridge((s) => s.overviewLevel);
  const navigate = useNavigate();

  // Which level the table lists: the reader's "View by" choice, else the
  // widest level that still splits what is in view (see autoLevel).
  const level = levels.find((entry) => entry.id === overviewLevel) ?? autoLevel(levels);
  const narrowed = levels.some((entry) => entry.selected !== null);

  const inViewPeople = useMemo(() => summarizeRecordsBy(inView, { by: 'person' }), [inView]);
  const inViewSessions = useMemo(() => summarizeRecordsBy(inView, { by: 'session' }), [inView]);
  const columns = useMemo(() => (level ? columnsFor(level) : []), [level]);

  if (isLoading) return <EmptyState title="Loading records…" />;
  if (!level) {
    return (
      <>
        {empty ?? (
          <EmptyState
            title="No records yet"
            description="Sessions appear here once something has been captured: camera windows, typing episodes, voice turns or events."
          />
        )}
      </>
    );
  }

  const records = inViewSessions.reduce((sum, row) => sum + row.records, 0);
  const starts = inViewSessions.map((row) => row.firstMs).filter((ms): ms is number => ms !== null);
  const ends = inViewSessions.map((row) => row.lastMs).filter((ms): ms is number => ms !== null);
  const recordedMs = sumOf(inViewSessions, (row) => row.spanMs);
  const typingMs = sumOf(inViewSessions, (row) => row.typingActiveMs);
  const noun = level.label.toLowerCase();

  return (
    <div className="flex flex-col gap-5">
      {/* Embedded, the level drop-downs are in the top bar on every page. */}
      {embedded ? null : <LevelMenus viewBy />}

      <Section
        id="overview-figures"
        title={narrowed ? 'In view (narrowed)' : 'In view'}
        description={
          starts.length > 0 && ends.length > 0
            ? `${when(Math.min(...starts))} to ${when(Math.max(...ends))}`
            : undefined
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Metric label="People" value={inViewPeople.length} />
          <Metric label="Sessions" value={inViewSessions.length} />
          <Metric label="Records" value={records} format={(v) => v.toLocaleString()} hint="windows, episodes, events" />
          <Metric
            label="Recorded time"
            value={recordedMs === null ? null : duration(recordedMs)}
            hint="sum of session lengths"
          />
          <Metric
            label="Active typing"
            value={typingMs === null ? null : duration(typingMs)}
            hint="hands on keys"
          />
        </div>
      </Section>

      <SummaryTable
        key={level.id}
        title={level.plural}
        meta={
          `${level.rows.length.toLocaleString()} ${level.rows.length === 1 ? noun : level.plural.toLowerCase()}` +
          ' · every signal recorded' +
          (level.canNarrow ? ' · tick rows to narrow the dashboard to them' : '') +
          ' · click a heading to sort'
        }
        rows={level.rows}
        columns={columns}
        selected={level.selected}
        onToggle={level.canNarrow ? (key) => select(level.key, toggled(level.selected, key)) : undefined}
        onAnalyze={(key) => {
          select(level.key, [key]);
          void navigate({ to: '/analyze' as never });
        }}
        rowNoun={noun}
        rowAction={level.key === 'session_id' ? sessionAction : undefined}
      />
    </div>
  );
}
