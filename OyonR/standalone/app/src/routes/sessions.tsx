import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Download, GitCompare, ListChecks, Database, Trash2 } from 'lucide-react';
import type { RecordSummaryRow } from 'oyon';
import { loadDemoData, clearAllStreams } from '@/legacy/demoFixture.js';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { RecordsOverview } from '@/components/overview/RecordsOverview';
import { useEnrichedWindows } from '@/lib/useEnrichedWindows';
import { useFilterStore } from '@/lib/filterStore';
import { summarizeWindowSet } from '@/lib/sessions';
import { sessionIdOf } from '@/lib/analyzeWindows';
import { buildSessionBundle, bundleRecords, downloadBundle } from '@/lib/exportBundle';
import { inSessions } from '@/lib/exportRecords';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useOverviewRecords } from '@/lib/overviewRecords';
import { RUNTIME_LOG_QUERY_KEY } from '@/lib/logRecords';
import { clearRuntimeLog } from '@/lib/runtimeLogStore';
import { useBridge } from '@/lib/hostBridge';

/*
 * Sessions — the standalone instrument's overview of everything recorded in
 * this browser: headline figures, a people table and a sessions table
 * (components/overview/RecordsOverview).
 *
 * Each row counts every record kind, not only camera windows, so a session
 * that held only typing or voice is listed with the figures it has. Tick
 * rows to narrow the whole dashboard to them (the same narrowing the filter
 * bar shows); tick two or more sessions and Compare lays them side by side;
 * Export writes one session's reproducibility bundle.
 */
function SessionsPage() {
  const { enriched } = useEnrichedWindows();
  const runtime = useRuntime();
  const { inScope } = useOverviewRecords();
  const fedWindows = useBridge((s) => s.hostRecords?.windows ?? null);
  const fed = useBridge((s) => s.hostRecords) != null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Ticked sessions ARE the filter bar's session narrowing: one selection,
  // shown in both places.
  const selected = useFilterStore((s) => s.sessionIds) ?? [];
  const setSessionIds = useFilterStore((s) => s.setSessionIds);

  function refreshStoredWindows() {
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }
  function handleLoadDemo() {
    loadDemoData();
    refreshStoredWindows();
  }
  function handleClearAll() {
    if (!window.confirm('Clear all stored windows, metrics, and logs from this browser?')) return;
    clearAllStreams();
    refreshStoredWindows();
    clearRuntimeLog().then(
      () => queryClient.invalidateQueries({ queryKey: RUNTIME_LOG_QUERY_KEY }),
      (err) => console.error('[oyon] could not clear the runtime log', err),
    );
  }
  function compareSelected() {
    if (selected.length < 2) return;
    navigate({
      to: '/analyze/comparison' as never,
      search: { ids: selected.join(',') } as never,
    });
  }

  async function handleExport(row: RecordSummaryRow) {
    // The bundle holds every record of the session: its interval windows,
    // matched with the same session-id derivation the table uses (sessionIdOf,
    // incl. the context.session_id fallback), and every other kind by
    // recordSessionId — the same rows the Logs page lists for this session.
    // A session with no camera windows (typing, voice, events only) exports
    // just the same, with an empty `windows`.
    const windows = enriched.filter((w) => sessionIdOf(w) === row.key);
    const records = await bundleRecords({ sets: inScope, fed, fedWindows, keep: inSessions([row.key]) });
    const bundle = buildSessionBundle({
      summary: summarizeWindowSet(row.key, windows),
      windows,
      records,
      settings: runtime.settings,
      model: {
        name: 'oyon',
        version: runtime.modelLabel,
        label: runtime.modelLabel,
      },
    });
    downloadBundle(bundle);
  }

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Everyone and every session recorded here, across all signals. Tick rows to narrow the dashboard; tick two or more sessions to compare them."
        actions={
          // flex-wrap so the row folds onto a second line on a phone rather
          // than running off the edge.
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleLoadDemo} aria-label="Load demo data">
              <Database className="size-4" aria-hidden="true" />
              Load demo
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClearAll} aria-label="Clear all stored data">
              <Trash2 className="size-4" aria-hidden="true" />
              Clear all
            </Button>
            {selected.length > 0 ? (
              <>
                <span className="text-xs text-ink-2">{selected.length} selected</span>
                <Button variant="ghost" size="sm" onClick={() => setSessionIds(null)}>
                  Clear
                </Button>
              </>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={compareSelected}
              disabled={selected.length < 2}
              aria-label="Compare selected sessions"
            >
              <GitCompare className="size-4" aria-hidden="true" />
              Compare ({selected.length})
            </Button>
          </div>
        }
      />
      <RecordsOverview
        sessionAction={(row) =>
          // Any recorded session exports: camera windows or not, the bundle
          // carries every record kind it has.
          row.records > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { handleExport(row).catch((err) => console.error('[oyon] session export failed', err)); }}
              aria-label={`Export bundle for ${row.key}`}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Export
            </Button>
          ) : null
        }
        empty={
          <EmptyState
            icon={<ListChecks className="size-8" />}
            title="No sessions in local storage yet"
            description="Capture a session (Capture → Start, wait at least one 10s window) and it will appear here. Or load synthetic demo data to exercise the analytics views right now."
            action={
              <Button onClick={handleLoadDemo} variant="primary" size="sm">
                <Database className="size-3.5" aria-hidden="true" />
                Load demo data (3 sessions)
              </Button>
            }
          />
        }
      />
    </>
  );
}

export const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsPage,
});
