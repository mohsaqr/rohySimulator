import { useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import type { EmotionWindow } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useEnrichedWindows } from '@/lib/useEnrichedWindows';
import { summarizeSessions, type SessionSummary } from '@/lib/sessions';
import { LegacyCanvas } from '@/legacy/LegacyCanvas';
import { EmotionTimeline } from '@/components/charts/EmotionTimeline';
import { drawDistribution } from '@/legacy/dashboard.js';
import {
  buildMultiSessionBundle,
  downloadMultiSessionBundle,
} from '@/lib/exportBundle';
import { useRuntime } from '@/lib/RuntimeProvider';
import { groupWindowsBySession, topSessionIds } from '@/lib/analyzeWindows';
import { windowEndMs } from '@/lib/windowTime';
import { cn } from '@/lib/cn';

/*
 * Comparison — two modes:
 *
 *   1. Multi-session: ≥2 sessions in storage, or `?ids=a,b,c` in URL.
 *      Lays out one timeline + distribution per session.
 *   2. Split-within-session: only one session present. Splits the windows
 *      by time into halves (or thirds/quarters), compares the slices.
 *      Useful for "first half vs second half" drift analysis on a single
 *      capture.
 */

interface ComparisonSearch {
  ids?: string;
  splits?: string;
}

interface ComparisonGroup {
  id: string;
  label: string;
  windows: EmotionWindow[];
  summary: SessionSummary;
}

function splitInto(windows: EmotionWindow[], parts: number): EmotionWindow[][] {
  if (parts <= 1 || windows.length <= 1) return [windows];
  const sorted = windows
    .slice()
    .sort((a, b) => (windowEndMs(a) ?? 0) - (windowEndMs(b) ?? 0));
  const size = Math.ceil(sorted.length / parts);
  const slices: EmotionWindow[][] = [];
  for (let i = 0; i < parts; i += 1) {
    const slice = sorted.slice(i * size, (i + 1) * size);
    if (slice.length) slices.push(slice);
  }
  return slices;
}

export function ComparisonView() {
  const { ids, splits } = useSearch({ strict: false }) as ComparisonSearch;
  const idList = useMemo(
    () =>
      typeof ids === 'string'
        ? ids.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    [ids],
  );
  const [splitCount, setSplitCount] = useState<number>(() => {
    const parsed = Number(splits ?? 2);
    return Number.isFinite(parsed) && parsed >= 2 && parsed <= 6 ? Math.floor(parsed) : 2;
  });
  const { enriched, isLoading } = useEnrichedWindows();
  const runtime = useRuntime();

  // Decide which mode we're in.
  const sessions = useMemo(() => {
    const byId = groupWindowsBySession(enriched as EmotionWindow[]);
    return Array.from(byId.entries()).map(([id, ws]) => ({ id, windows: ws }));
  }, [enriched]);

  const isMulti = sessions.length >= 2 || idList.length >= 2;

  const groups: ComparisonGroup[] = useMemo(() => {
    if (!enriched.length) return [];
    const byId = groupWindowsBySession(enriched as EmotionWindow[]);

    if (isMulti) {
      const selected = idList.length >= 2
        ? idList
        : topSessionIds(enriched as EmotionWindow[], Math.min(3, sessions.length));
      return selected
        .map((id) => {
          const ws = byId.get(id) ?? [];
          return {
            id,
            label: id,
            windows: ws,
            summary: summarizeOne(id, ws),
          };
        })
        .filter((g) => g.windows.length > 0);
    }

    // Single-session split mode.
    const only = sessions[0];
    if (!only) return [];
    const slices = splitInto(only.windows, splitCount);
    return slices.map((ws, i) => ({
      id: `${only.id}#${i + 1}`,
      label: `${only.id} · slice ${i + 1}/${slices.length}`,
      windows: ws,
      summary: summarizeOne(`${only.id}#${i + 1}`, ws),
    }));
  }, [enriched, isMulti, idList, sessions, splitCount]);

  if (isLoading) return <EmptyState title="Loading…" />;
  if (!enriched.length) {
    return <EmptyState title="No stored windows yet" description="Capture a session and comparisons will appear here." />;
  }
  if (groups.length < 2) {
    return (
      <EmptyState
        title="Not enough windows yet"
        description="At least two windows in one session (or two distinct sessions) are needed to compare."
      />
    );
  }

  function handleExportAll() {
    const bundle = buildMultiSessionBundle({
      groups: groups.map((g) => ({ summary: g.summary, windows: g.windows })),
      settings: runtime.settings,
      model: { name: 'oyon', version: runtime.modelLabel, label: runtime.modelLabel },
    });
    downloadMultiSessionBundle(bundle);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-ink-2">
          {isMulti ? (
            <>
              {idList.length >= 2 ? 'Comparing selected' : 'Auto-comparing latest'}{' '}
              <span className="font-medium text-ink-0">{groups.length}</span>{' '}
              session{groups.length === 1 ? '' : 's'}
            </>
          ) : (
            <>
              Single session — split into{' '}
              <span className="font-medium text-ink-0">{groups.length}</span> time slice
              {groups.length === 1 ? '' : 's'}
            </>
          )}{' '}
          · {groups.reduce((acc, g) => acc + g.windows.length, 0)} windows total
        </div>
        <div className="flex items-center gap-2">
          {!isMulti ? (
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              Slices
              <select
                value={splitCount}
                onChange={(e) => setSplitCount(Number(e.target.value))}
                className="rounded border border-line bg-surface-0 px-2 py-1 text-xs"
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button onClick={handleExportAll} variant="secondary" size="sm">
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Button>
        </div>
      </div>

      <Section id="cmp-timelines" title="Capture timelines" description="Dominant emotion per window, per group.">
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Card key={`tl-${g.id}`}>
              <CardHeader>
                <CardTitle className={cn('font-mono normal-case tracking-normal text-sm', !isMulti && 'font-medium')}>
                  {g.label}
                </CardTitle>
                <CardMeta>
                  {g.windows.length} window{g.windows.length === 1 ? '' : 's'}
                </CardMeta>
              </CardHeader>
              <CardContent>
                <EmotionTimeline recentWindows={g.windows} height={140} />
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="cmp-distribution" title="Emotion distribution" description="Per-group dominant-emotion counts.">
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={`dist-${g.id}`}>
              <CardHeader>
                <CardTitle className="font-mono normal-case tracking-normal text-sm">
                  {g.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LegacyCanvas draw={(c) => drawDistribution(c, g.windows)} deps={[g.windows]} height={200} />
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

function summarizeOne(id: string, windows: EmotionWindow[]): SessionSummary {
  const all = summarizeSessions(windows);
  return (
    all[0] ?? {
      sessionId: id,
      windowCount: 0,
      windowStart: 0,
      windowEnd: 0,
      dominantEmotion: null,
      dominantShare: null,
      meanConfidence: null,
      meanValidFrameRatio: null,
      meanFocus: null,
      hasGaze: false,
      meanCalibrationQuality: null,
    }
  );
}
