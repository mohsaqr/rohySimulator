import { useMemo, useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Download, GitCompare, ListChecks, Database, Trash2 } from 'lucide-react';
import { loadDemoData, clearAllStreams } from '@/legacy/demoFixture.js';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStoredWindows } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { summarizeSessions, type SessionSummary } from '@/lib/sessions';
import { sessionIdOf } from '@/lib/analyzeWindows';
import { buildSessionBundle, downloadBundle } from '@/lib/exportBundle';
import { useRuntime } from '@/lib/RuntimeProvider';
import { emotionColor } from '@/lib/emotionColors';
import { cn } from '@/lib/cn';

/*
 * Sessions — every session_id that has stored windows in localStorage.
 *
 * Each row surfaces the dimensions a researcher needs to triage:
 *   - when (start → end timestamp)
 *   - how many windows
 *   - what was dominant
 *   - quality (mean valid-frame ratio, mean confidence)
 *   - whether gaze was on, and at what calibration quality
 *   - one-click reproducibility-bundle export
 *
 * Comparison mode (multi-select → /analyze/comparison) is scaffolded in
 * Phase D.1; this view is the entry point.
 */

const MAX_SESSIONS_SHOWN = 20;

function SessionsPage() {
  const stored = useStoredWindows();
  const { filtered } = useFilteredWindows();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Session list respects the FilterBar scope (current/past/all + user).
  const allSessions = useMemo(() => summarizeSessions(filtered), [filtered]);
  // Most recent first, cap to the last 20.
  const sessions = useMemo(() => {
    return allSessions
      .slice()
      .sort((a, b) => (b.windowEnd ?? 0) - (a.windowEnd ?? 0))
      .slice(0, MAX_SESSIONS_SHOWN);
  }, [allSessions]);
  const truncated = allSessions.length > MAX_SESSIONS_SHOWN;

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
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function compareSelected() {
    if (selected.size < 2) return;
    navigate({
      to: '/analyze/comparison' as never,
      search: { ids: [...selected].join(',') } as never,
    });
  }

  if (stored.isLoading) return <EmptyState title="Loading sessions…" />;
  if (sessions.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Workflow · Step 5"
          title="Sessions"
          description="Browse, select, and export prior sessions."
        />
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
      </>
    );
  }

  function handleExport(summary: SessionSummary) {
    // Export exactly what the row displays: same FilterBar-scoped set the
    // list is summarized from, same session-id derivation (sessionIdOf,
    // incl. the context.session_id fallback). A divergent predicate here
    // exported windows the table never counted — or none at all for
    // records whose id lives only in `context`.
    const ws = filtered.filter((w) => sessionIdOf(w) === summary.sessionId);
    const bundle = buildSessionBundle({
      summary,
      windows: ws,
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
        eyebrow="Workflow · Step 5"
        title="Sessions"
        description="Each row is one session_id worth of aggregate windows. Tick two or more to compare them side-by-side; click Export to produce a reproducibility bundle."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleLoadDemo} aria-label="Load demo data">
              <Database className="size-4" aria-hidden="true" />
              Load demo
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClearAll} aria-label="Clear all stored data">
              <Trash2 className="size-4" aria-hidden="true" />
              Clear all
            </Button>
            {selected.size > 0 ? (
              <>
                <span className="text-xs text-ink-2">
                  {selected.size} selected
                </span>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Clear
                </Button>
              </>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={compareSelected}
              disabled={selected.size < 2}
              aria-label="Compare selected sessions"
            >
              <GitCompare className="size-4" aria-hidden="true" />
              Compare ({selected.size})
            </Button>
          </div>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Recent sessions</CardTitle>
          <CardMeta>
            {truncated
              ? `latest ${sessions.length} of ${allSessions.length}`
              : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}{' '}
            ·{' '}
            {sessions.reduce((acc, s) => acc + s.windowCount, 0)} windows shown
          </CardMeta>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-2 text-ink-2">
                <tr>
                  <Th>
                    <span className="sr-only">Select</span>
                  </Th>
                  <Th>Session</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                  <Th align="right">Windows</Th>
                  <Th>Dominant</Th>
                  <Th align="right">Mean conf</Th>
                  <Th align="right">Valid</Th>
                  <Th align="right">Focus</Th>
                  <Th>Gaze</Th>
                  <Th align="right">Export</Th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.sessionId}
                    className={cn(
                      'border-t border-line transition-colors',
                      selected.has(s.sessionId)
                        ? 'bg-status-info-dim/40 hover:bg-status-info-dim/60'
                        : 'hover:bg-surface-2/50',
                    )}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={selected.has(s.sessionId)}
                        onChange={() => toggleSelect(s.sessionId)}
                        aria-label={`Select session ${s.sessionId}`}
                        className="size-3.5 cursor-pointer"
                      />
                    </Td>
                    <Td className="font-mono">{s.sessionId}</Td>
                    <Td>{new Date(s.windowStart).toLocaleString()}</Td>
                    <Td>{new Date(s.windowEnd).toLocaleString()}</Td>
                    <Td align="right">{s.windowCount}</Td>
                    <Td>
                      {s.dominantEmotion ? (
                        <span
                          className="inline-flex items-center gap-1.5"
                          style={{ color: emotionColor(s.dominantEmotion) }}
                        >
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ background: emotionColor(s.dominantEmotion) }}
                            aria-hidden="true"
                          />
                          {s.dominantEmotion}
                          <span className="text-ink-3">
                            ({s.dominantShare ? (s.dominantShare * 100).toFixed(0) : '—'}%)
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td align="right">
                      {s.meanConfidence != null
                        ? (s.meanConfidence * 100).toFixed(0) + '%'
                        : '—'}
                    </Td>
                    <Td align="right">
                      {s.meanValidFrameRatio != null
                        ? (s.meanValidFrameRatio * 100).toFixed(0) + '%'
                        : '—'}
                    </Td>
                    <Td align="right">
                      {s.meanFocus != null ? s.meanFocus.toFixed(2) : '—'}
                    </Td>
                    <Td>
                      {s.hasGaze ? (
                        s.meanCalibrationQuality != null ? (
                          <StatusPill
                            tone={
                              s.meanCalibrationQuality > 0.7
                                ? 'ok'
                                : s.meanCalibrationQuality > 0.4
                                  ? 'warn'
                                  : 'bad'
                            }
                            size="sm"
                          >
                            q {s.meanCalibrationQuality.toFixed(2)}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="null" reason="quality unknown" size="sm">
                            on
                          </StatusPill>
                        )
                      ) : (
                        <StatusPill tone="null" reason="not enabled" size="sm">
                          off
                        </StatusPill>
                      )}
                    </Td>
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleExport(s)}
                        aria-label={`Export bundle for ${s.sessionId}`}
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        Export
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-[10px] font-medium uppercase tracking-wider',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={cn(
        'px-3 py-1.5 tabular-nums',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

export const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsPage,
});
