import { useMemo, useState } from 'react';
import {
  aggregateTypingEpisodes,
  recordUserId,
  summarizeWriting,
  summarizeWritingActs,
  summarizeWritingBy,
  writingByDayAndPerson,
  writingTimeline,
  type WritingSummaryRow,
} from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import {
  ActStrip, ORIGIN_COLOR, PERSON_COLORS, WritingActsSummary, WritingDayBars, WritingOriginBar, WritingProcessGraph,
} from '@/components/writing/WritingCharts';
import { useStoredEvents } from '@/lib/storedEvents';
import { useStoredTypingWindows } from '@/lib/storedTypingWindows';
import { useRecordScope } from '@/lib/recordScope';

/*
 * Analyze · Writing — what was done to the document, from `document_edit` events
 * (src/analytics/WritingAnalytics.js): how much was added and removed, where the
 * added text came from (typed, pasted, inserted by an AI), how the text grew over
 * the sittings it was written in, and the same per day, per person, per session
 * and per document.
 *
 * The Typing page is the keystroke view of one sitting (pauses, bursts,
 * revisions). This page is the document's view across sittings. It leads the
 * dashboard for a host that reports document edits.
 *
 * Descriptive only: no score, no ranking, no reading of intent. `—` means not
 * measured, never zero.
 */

const share = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString()}`;
const count = (v: number | null) => (v === null ? '—' : v.toLocaleString());

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const when = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

function ShareBar({ value, color }: { value: number | null; color: string }) {
  if (value === null) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-2 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </span>
      <span className="tabular-nums">{share(value)}</span>
    </span>
  );
}

/** One row per unit (person, session or document): the same columns at every level. */
function UnitTable({ rows, unitLabel, colored }: { rows: WritingSummaryRow[]; unitLabel: string; colored: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-1.5 pr-3 font-semibold">{unitLabel}</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Added</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Removed</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Net</th>
            <th className="py-1.5 pr-3 font-semibold" title="This row's added text out of all rows'">Share of added text</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Typed</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Pasted</th>
            <th className="py-1.5 pr-3 text-right font-semibold">AI</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Edits</th>
            <th className="py-1.5 pr-3 font-semibold">First edit</th>
            <th className="py-1.5 pr-3 font-semibold">Last edit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const words = row.wordsAdded !== null;
            const o = (key: 'typed' | 'pasted' | 'ai') => (row.origins[key].share === null ? '—' : share(row.origins[key].share!));
            return (
              <tr key={row.key} className="border-b border-line/60 last:border-b-0">
                <td className="py-1.5 pr-3 font-medium text-ink-1">
                  <span className="inline-flex items-center gap-1.5">
                    {colored ? <span className="inline-block size-2.5 shrink-0" style={{ background: PERSON_COLORS[i % PERSON_COLORS.length] }} aria-hidden="true" /> : null}
                    <span className="break-all">{row.label}</span>
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{count(words ? row.wordsAdded : row.graphemesAdded)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{count(words ? row.wordsRemoved : row.graphemesRemoved)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{(words ? row.netWords : row.netGraphemes) === null ? '—' : signed((words ? row.netWords : row.netGraphemes)!)}</td>
                <td className="py-1.5 pr-3"><ShareBar value={row.share} color={colored ? PERSON_COLORS[i % PERSON_COLORS.length] : ORIGIN_COLOR.typed} /></td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{o('typed')}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{o('pasted')}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{o('ai')}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.acts.toLocaleString()}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{when(row.firstMs)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{when(row.lastMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function WritingView() {
  const { data: events = [], isLoading } = useStoredEvents();
  const { data: episodes = [] } = useStoredTypingWindows();
  const { wide } = useRecordScope();
  const [unitChoice, setUnitChoice] = useState<'words' | 'characters' | null>(null);

  const summary = useMemo(() => summarizeWriting(events), [events]);
  const timeline = useMemo(() => writingTimeline(events), [events]);
  const days = useMemo(() => summarizeWritingBy(events, { by: 'day' }), [events]);
  const people = useMemo(() => summarizeWritingBy(events, { by: 'person' }), [events]);
  const sessions = useMemo(() => summarizeWritingBy(events, { by: 'session' }), [events]);
  const documents = useMemo(() => summarizeWritingBy(events, { by: 'context' }), [events]);
  const typing = useMemo(() => aggregateTypingEpisodes(episodes), [episodes]);
  const acts = useMemo(() => summarizeWritingActs(events), [events]);
  const actsByPerson = useMemo(() => people.map((person) => ({
    key: person.key,
    label: person.label,
    ...summarizeWritingActs(events.filter((event) => recordUserId(event) === person.key)),
  })), [events, people]);

  const hasWords = summary.wordsAdded !== null || summary.wordsRemoved !== null;
  const unit: 'words' | 'characters' = unitChoice ?? (hasWords ? 'words' : 'characters');
  const grid = useMemo(
    () => writingByDayAndPerson(events, { unit: unit === 'words' ? 'words' : 'graphemes' }),
    [events, unit],
  );

  if (isLoading) return <EmptyState title="Loading edits…" />;
  if (summary.acts === 0) {
    return (
      <EmptyState
        title="No document edits yet"
        description="This page draws what a host reports about edits to a document it owns: text added and removed, pastes, AI insertions, structural changes. Nothing of that kind is in view."
      />
    );
  }

  const net = unit === 'words' ? summary.netWords : summary.netGraphemes;
  const added = unit === 'words' ? summary.wordsAdded : summary.graphemesAdded;
  const removed = unit === 'words' ? summary.wordsRemoved : summary.graphemesRemoved;
  const unitSwitch = hasWords ? (
    <div className="inline-flex overflow-hidden rounded border border-line text-xs" role="group" aria-label="Count in">
      {(['words', 'characters'] as const).map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={unit === u}
          onClick={() => setUnitChoice(u)}
          className={unit === u ? 'bg-status-info-dim px-2.5 py-1 font-medium text-status-info' : 'px-2.5 py-1 text-ink-2 hover:bg-surface-2'}
        >
          {u === 'words' ? 'Words' : 'Characters'}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <Section
        id="wri-acts"
        title="All acts"
        description={`Every edit read as one of seven acts: ${acts.total.toLocaleString()} in view. The same acts are the states on the Dynamics and Patterns pages (channel “Writing acts”).`}
      >
        <Card><CardContent><WritingActsSummary acts={acts.acts} /></CardContent></Card>
        {wide && actsByPerson.length > 1 ? (
          <Card className="mt-4">
            <CardHeader><CardTitle>By person</CardTitle><CardMeta>each person's own mix of acts</CardMeta></CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {actsByPerson.map((person) => (
                  <div key={person.key} className="flex items-center gap-3 text-xs">
                    <span className="w-32 shrink-0 truncate font-medium text-ink-1">{person.label}</span>
                    <span className="min-w-0 flex-1"><ActStrip acts={person.acts} height={20} /></span>
                    <span className="w-20 shrink-0 text-right tabular-nums text-ink-2">{person.total.toLocaleString()} acts</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </Section>

      <Section
        id="wri-summary"
        title="The text"
        description={`${summary.acts.toLocaleString()} edit${summary.acts === 1 ? '' : 's'} over ${days.length} day${days.length === 1 ? '' : 's'} and ${summary.sessions} session${summary.sessions === 1 ? '' : 's'}${wide ? `, by ${summary.people} ${summary.people === 1 ? 'person' : 'people'}` : ''}. Counts are of what was added and removed since recording began; the text is never recorded.`}
        actions={unitSwitch}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Metric label={`Net ${unit}`} value={net} format={signed} hint="added minus removed" />
          <Metric label="Added" value={added} unit={unit} format={(v) => v.toLocaleString()} />
          <Metric label="Removed" value={removed} unit={unit} format={(v) => v.toLocaleString()} />
          <Metric label="Removed / added" value={summary.removedRatio} format={share} hint="of everything added, the part removed" />
          <Metric label="Pasted" value={summary.origins.pasted.share} format={share} hint="share of added text" />
          <Metric label="AI-inserted" value={summary.origins.ai.share} format={share} hint="share of added text" />
          <Metric
            label="Active typing"
            value={typing.episodes > 0 ? typing.totalActiveMs : null}
            format={duration}
            hint={typing.episodes > 0 ? 'hands on keys' : 'no typing episodes in view'}
          />
        </div>
      </Section>

      <Section
        id="wri-origin"
        title="Where the text came from"
        description="Every character added, by how it arrived: typed at the keyboard, pasted in, or inserted by an AI. A share of the text is not a share of the thinking."
      >
        <Card><CardContent><WritingOriginBar summary={summary} /></CardContent></Card>
      </Section>

      <Section
        id="wri-process"
        title="How the text grew"
        description="A step up is text added, a step down text removed. Each run is one sitting; the time between sittings is compressed to a labelled band, so slopes compare within a sitting, not across a band."
      >
        <Card>
          <CardHeader>
            <CardTitle>Process graph</CardTitle>
            <CardMeta>
              {timeline.points.length.toLocaleString()} measured edit{timeline.points.length === 1 ? '' : 's'}
              {timeline.unmeasured > 0 ? ` · ${timeline.unmeasured} without a count, left out` : ''}
            </CardMeta>
          </CardHeader>
          <CardContent><WritingProcessGraph points={timeline.points} unit={unit} /></CardContent>
        </Card>
      </Section>

      <Section
        id="wri-days"
        title="Day by day"
        description={wide ? 'Text added and removed on each calendar day (local time). Each day\'s added bar is stacked by person.' : 'Text added and removed on each calendar day (local time).'}
      >
        <Card><CardContent><WritingDayBars grid={grid} /></CardContent></Card>
      </Section>

      {wide ? (
        <Section
          id="wri-people"
          title="People"
          description="One row per person. Share of added text is the person's added characters out of everyone's in view. It counts text, not ideas, reviewing or discussion."
        >
          <Card><CardContent><UnitTable rows={people} unitLabel="Person" colored /></CardContent></Card>
        </Section>
      ) : null}

      {documents.length > 1 ? (
        <Section id="wri-documents" title="Documents" description="One row per document the edits belong to.">
          <Card><CardContent><UnitTable rows={documents} unitLabel="Document" colored={false} /></CardContent></Card>
        </Section>
      ) : null}

      {sessions.length > 1 ? (
        <Section id="wri-sessions" title="Sessions" description="One row per session, most added text first.">
          <Card><CardContent><UnitTable rows={sessions} unitLabel="Session" colored={false} /></CardContent></Card>
        </Section>
      ) : null}
    </div>
  );
}
