import { useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InfoTip } from '@/components/ui/InfoTip';
import { download } from '@/components/group/download';
import { toCsv } from '@/lib/groupDashboard';
import { Segmented } from '@/components/ui/Segmented';
import { InlineSelect } from '@/components/group/InlineSelect';
import { Figures } from '@/components/group/NetworkFigure';
import { RowsTable } from './RowsTable';
import {
  PATTERN_SECTIONS,
  hypaReading,
  memoryReading,
  memoryViews,
  pathwayTable,
  pathwayViews,
  sequenceSummary,
  stateColors,
  subPatternViews,
  treeViews,
  type PatternSection,
  type Sequences,
} from '@/lib/patternViews';

/*
 * The four pattern sections over one set of state sequences — shared by
 * /analyze/patterns-next (a person's sessions) and /group/patterns (a group's
 * member, regime or interaction sequences). The page supplies the sequences
 * and a one-line description of what a state is; everything else comes from
 * lib/patternViews.js (ladyna verbs, ladyna painters).
 *
 * One toolbar row: the page's own controls (`lead`), the section tabs, the
 * section's options and a "?" holding the reading, the counts and the page's
 * `about` (e.g. how the group sequences were coded). The page shows the
 * figures and tables; their captions sit behind their own "?".
 *
 * Only the open section is computed, so switching to Memory (a permutation
 * test) costs nothing until it is opened. Sections are keyed on the identity
 * of `sequences`: pass a memoised array.
 */

type OrdersChoice = '3-4' | '3' | '4' | '3-5' | '2-3';
const ORDERS: Record<OrdersChoice, number[]> = { '3-4': [3, 4], '3': [3], '4': [4], '3-5': [3, 4, 5], '2-3': [2, 3] };
const ORDER_OPTIONS = (Object.keys(ORDERS) as OrdersChoice[]).map((k) => ({ value: k, label: `${k.replace('-', '–')} states` }));
type AnomalyChoice = 'all' | 'over' | 'under';
const ANOMALY_OPTIONS: ReadonlyArray<{ value: AnomalyChoice; label: string }> = [
  { value: 'all', label: 'all, by p' },
  { value: 'over', label: 'over-represented' },
  { value: 'under', label: 'under-represented' },
];

export function PatternSections({ sequences, filePrefix, unit, lead, about }: {
  sequences: Sequences;
  /** Prefix for downloaded files (e.g. the group id or "sessions"). */
  filePrefix: string;
  /** What one state in a sequence is, e.g. "5 s bin of one member". */
  unit: string;
  /** The page's own controls, first on the toolbar row. */
  lead?: ReactNode;
  /** Page-level detail for the "?" (e.g. the call that built the sequences). */
  about?: ReactNode;
}) {
  const [section, setSection] = useState<PatternSection>('pathways');
  const [orders, setOrders] = useState<OrdersChoice>('3-4');
  const [anomaly, setAnomaly] = useState<AnomalyChoice>('all');

  const summary = useMemo(() => sequenceSummary(sequences), [sequences]);
  // One colour per state, the same map Dynamics (next) uses.
  const colorMap = useMemo(() => stateColors(sequences), [sequences]);

  const pathways = useMemo(
    () => (section === 'pathways' ? pathwayViews(sequences, { orders: ORDERS[orders], anomaly, colorMap }) : null),
    [sequences, section, orders, anomaly, colorMap],
  );
  const sub = useMemo(() => (section === 'subpatterns' ? subPatternViews(sequences) : null), [sequences, section]);
  const memory = useMemo(() => (section === 'memory' ? memoryViews(sequences) : null), [sequences, section]);
  const trees = useMemo(() => (section === 'trees' ? treeViews(sequences, { colorMap }) : null), [sequences, section, colorMap]);

  const info = (
    <>
      <p>{summary.n_usable} sequence{summary.n_usable === 1 ? '' : 's'} · {summary.n_states} states · {summary.alphabet.length} distinct · one state = {unit}.</p>
      {about}
      {pathways?.counts ? (
        <>
          <p>HYPA (LaRock et al. 2020). {hypaReading(pathways.counts)}</p>
          <p>Each row is one pathway, its states in order. The dot is observed ÷ expected on a log scale (right of 1: more often than expected); filled when the difference is significant, hollow when not. HYPA classes a pathway only when it occurs (or is expected) at least 5 times; rarer ones read "too few to test" whatever their p.</p>
        </>
      ) : null}
      {sub ? <p>Sub-patterns (ladyna discoverPatterns, n-grams): runs of 2–3 states (short) and 4–6 states (long) that occur at least twice in at least 5 % of sequences; support is the share of sequences that contain them.</p> : null}
      {memory?.summary ? <p>{memoryReading(memory.summary)}</p> : null}
      {memory ? <p>Markov order: how many past states the next one depends on. Order 1 means the current state carries all the information; higher orders mean longer memory.</p> : null}
      {trees ? <p>Transition tree (context tree, up to 3 states back): which preceding paths change what comes next. Pathways: the most common paths through the same tree, by count.</p> : null}
    </>
  );

  if (!summary.n_usable) {
    return (
      <div className="flex flex-col gap-3">
        {lead ? <div className="flex flex-wrap items-center gap-2">{lead}</div> : null}
        <p className="m-0 text-xs text-ink-3">No sequence with two or more states here; pick another source, channel or span.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {lead}
        <Segmented label="Pattern view" value={section} options={PATTERN_SECTIONS} onChange={setSection} />
        {section === 'pathways' ? (
          <>
            <InlineSelect label="length" value={orders} options={ORDER_OPTIONS} onChange={setOrders}
              title="Pathway length in states, pooled. HYPA tests each length against its own first-order null." />
            <InlineSelect label="show" value={anomaly} options={ANOMALY_OPTIONS} onChange={setAnomaly} />
          </>
        ) : null}
        {/* The pathway figure already shows every column, so the rows are a download, not a second table. */}
        {pathways?.rows.length ? (
          <Button size="sm" variant="outline"
            onClick={() => download({ name: `${filePrefix}-pathways.csv`, content: toCsv(pathwayTable(pathways.rows) as Record<string, unknown>[]), mime: 'text/csv' })}>
            <Download className="size-3.5" aria-hidden="true" /> CSV
          </Button>
        ) : null}
        <InfoTip label={PATTERN_SECTIONS.find((p) => p.id === section)?.label ?? section}>{info}</InfoTip>
      </div>

      {pathways ? (
        <>
          <Figures views={pathways.views} prefix={filePrefix} columns={1} />
        </>
      ) : null}

      {sub ? (
        <>
          <Figures views={sub.views} prefix={filePrefix} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RowsTable rows={sub.tables.short} shade={['frequency', 'support']} title="Short patterns" fileName={`${filePrefix}-patterns-short.csv`} />
            <RowsTable rows={sub.tables.long} shade={['frequency', 'support']} title="Long patterns" fileName={`${filePrefix}-patterns-long.csv`} />
          </div>
        </>
      ) : null}

      {memory ? (
        <>
          <Figures views={memory.views} prefix={filePrefix} columns={1} />
          <RowsTable rows={memory.rows} title="Order tests" fileName={`${filePrefix}-markov-order.csv`} />
        </>
      ) : null}

      {trees ? (
        <>
          <Figures views={trees.views} prefix={filePrefix} />
          <RowsTable rows={trees.rows} shade={['count']} title="Most common pathways" fileName={`${filePrefix}-tree-pathways.csv`} />
        </>
      ) : null}
    </div>
  );
}
