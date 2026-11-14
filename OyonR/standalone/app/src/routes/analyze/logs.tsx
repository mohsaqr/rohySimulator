import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database, Download } from 'lucide-react';
import { summarizeLogRows } from 'oyon';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { InfoTip } from '@/components/ui/InfoTip';
import { InlineSelect } from '@/components/group/InlineSelect';
import { download } from '@/components/group/download';
import { LogTable } from '@/components/logs/LogTable';
import { useLogRows } from '@/lib/logRecords';
import { LOG_KIND_TABS, filterLogRows, logChannels, logCsv, logJson, type LogKindTab } from '@/lib/logView';
import { loadDemoData } from '@/legacy/demoFixture.js';
import { cn } from '@/lib/cn';

/*
 * Analyze · Logs — the one log. Every record this surface holds, of every
 * kind, in one time-ordered table: camera windows, typing / voice / AI
 * episodes, per-event states, the runtime's own log and its metrics (or a
 * host's fed log events). Narrow by kind, channel and level, search, open a
 * row for every field, export what is shown as CSV or JSON.
 *
 * The rows are oyon's `toLogRows` (oyon/records); nothing is derived here.
 */
export function LogsView() {
  const { rows, isLoading } = useLogRows();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LogKindTab>('all');
  const [channel, setChannel] = useState('all');
  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');

  const summary = useMemo(() => summarizeLogRows(rows), [rows]);
  const channels = useMemo(() => logChannels(rows, kind), [rows, kind]);
  const shown = useMemo(
    () => filterLogRows(rows, { kind, channel, level, query }),
    [rows, kind, channel, level, query],
  );

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries();
  }

  if (isLoading) return <EmptyState title="Loading the log…" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing recorded yet"
        description="Capture a session, or load synthetic demo data to fill the log."
        action={
          <Button variant="primary" size="sm" onClick={handleLoadDemo}>
            <Database className="size-3.5" aria-hidden="true" />
            Load demo data
          </Button>
        }
      />
    );
  }

  const pickKind = (next: LogKindTab) => {
    setKind(next);
    setChannel('all');
    if (next !== 'all' && next !== 'log') setLevel('all');
  };
  const showLevel = (kind === 'all' || kind === 'log') && Object.keys(summary.levels).length > 0;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base = `oyon-log-${kind}-${stamp}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Record kind" className="inline-flex flex-wrap gap-1 rounded border border-line bg-surface-0 p-1">
          {LOG_KIND_TABS.map((tab) => {
            const n = tab.value === 'all' ? summary.total : summary.kinds[tab.value];
            if (tab.value !== 'all' && n === 0) return null;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={kind === tab.value}
                onClick={() => pickKind(tab.value)}
                className={cn(
                  'whitespace-nowrap rounded px-2 py-1 text-xs font-medium',
                  kind === tab.value ? 'bg-surface-3 text-ink-0' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                {tab.label} <span className="tabular-nums text-ink-3">{n.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        {channels.length > 1 ? (
          <InlineSelect
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={[{ value: 'all', label: 'All' }, ...channels.map((c) => ({ value: c.value, label: `${c.value} (${c.n})` }))]}
          />
        ) : null}
        {showLevel ? (
          <InlineSelect
            label="Level"
            value={level}
            onChange={setLevel}
            options={[{ value: 'all', label: 'All' }, ...Object.entries(summary.levels).map(([l, n]) => ({ value: l, label: `${l} (${n})` }))]}
          />
        ) : null}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the log…"
          aria-label="Search the log"
          className="h-7 w-24 min-w-24 flex-1 rounded border border-line bg-surface-0 px-2 text-xs text-ink-0"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={shown.length === 0}
          onClick={() => download({ name: `${base}.csv`, mime: 'text/csv', content: logCsv(shown, { wide: kind !== 'all' }) })}
        >
          <Download className="size-3.5" aria-hidden="true" /> CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={shown.length === 0}
          onClick={() => download({ name: `${base}.json`, mime: 'application/json', content: logJson(shown) })}
        >
          <Download className="size-3.5" aria-hidden="true" /> JSON
        </Button>
        <InfoTip label="the log">
          <p>
            Every record in view, newest first: <b>windows</b> (camera: emotion, engagement, gaze, body signals),
            <b> episodes</b> (a typing episode, a voice turn, an AI cycle), <b>events</b> (each typing, voice,
            interaction, AI, document-edit or code-run state), the <b>runtime log</b> (start, stop, errors,
            calibration, clock sync) and runtime <b>metrics</b>. A host that feeds records shows its own log events.
          </p>
          <p className="mt-2">
            {summary.sessions} session{summary.sessions === 1 ? '' : 's'}, {summary.people} {summary.people === 1 ? 'person' : 'people'}
            {summary.firstMs != null && summary.lastMs != null
              ? `, ${new Date(summary.firstMs).toLocaleString()} to ${new Date(summary.lastMs).toLocaleString()}`
              : ''}.
            The filter bar's session and person choices apply here as on every page.
          </p>
          <p className="mt-2">
            Open a row for every field of its record. CSV writes what is shown: under one kind, one column per field;
            under All, the shared columns and each record as JSON. JSON writes the records whole, per-sample
            <code> raw_streams</code> included.
          </p>
        </InfoTip>
      </div>
      {shown.length === 0
        ? <EmptyState title="No rows match" description="Clear the search or pick another kind or channel." />
        : <LogTable key={`${kind}|${channel}|${level}|${query}`} rows={shown} />}
    </div>
  );
}
