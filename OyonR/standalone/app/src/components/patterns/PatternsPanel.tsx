import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import type { EmotionWindow } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useStoredEvents } from '@/lib/storedEvents';
import { buildSessionSequences, buildEventSequences } from '@/lib/tnaPooling';
import { CHANNEL_OPTIONS, channelUnit, channelLabel } from '@/lib/analyticsChannel';
import { useChannelStore } from '@/lib/channelStore';
import { emotionColor } from '@/lib/emotionColors';
import { discoverPatterns } from 'legacy-ladyna';
import { contextTree, commonPathways, plotTree, buildHypa } from 'legacy-tnaj';
import { drawSimplicialOverlay } from '@/components/simplicial/simplicialOverlay.js';
import { loadDemoData } from '@/legacy/demoFixture.js';
import { PatternTable, type Pattern } from './PatternTable';
import { tweakTreeSvg } from '@/lib/treeSvgTweaks';

/*
 * PatternsPanel — the "Patterns" analyze tab. Three sequence-structure views
 * over the pooled state sequences of whichever channel is selected (emotion
 * windows by default; typing/discourse/interaction/ai_assist/all pool the
 * signal-event log instead — see @/lib/analyticsChannel):
 *   1. Sub-patterns (short + long) — LAILA-v3's PatternsTab split, via ladyna
 *      discoverPatterns + the LAILA PatternTable.
 *   2. Most-frequency tree — tnaj contextTree + plotTree (SVG) + top pathways.
 *   3. Disentangled simplicial — the shipping carm-tna blob overlay, drawn one
 *      simplex per card (dismantled small multiples) instead of one tangled
 *      overlay; colour follows HYPA anomaly (red = over, blue = under).
 *
 * Owns its own data (events) and loading/empty gating — the picker must stay
 * visible and switchable even when the caller's `windows` (the emotion
 * channel) is empty but another channel has data. The channel selection
 * itself lives in channelStore, shared with Dynamics, so switching channel
 * on either tab carries to the other.
 */

const EMOTIONS = ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise', 'insufficient'];

export function PatternsPanel({
  windows,
  isLoading = false,
}: {
  windows: EmotionWindow[];
  /** Loading state of `windows`, from the caller's useFilteredWindows(). */
  isLoading?: boolean;
}) {
  const { data: events = [], isLoading: eventsLoading } = useStoredEvents();
  const queryClient = useQueryClient();

  // Affect (emotion) is the default and reproduces the original behavior
  // exactly. Every other channel pools the signal-event log instead of
  // emotion windows — same `string[][]` shape, so discoverPatterns,
  // contextTree, and buildHypa below need no changes at all. Shared with
  // Dynamics via channelStore, so the selection carries across the two tabs.
  const channel = useChannelStore((s) => s.channel);
  const setChannel = useChannelStore((s) => s.setChannel);
  const loading = channel === 'emotion' ? isLoading : eventsLoading;
  const recordCount = channel === 'emotion' ? windows.length : events.length;
  const unit = channelUnit(channel);

  const sequences = useMemo(
    () => (channel === 'emotion'
      ? buildSessionSequences(windows)
      : buildEventSequences(events, channel === 'all' ? null : channel)) as (string | null)[][],
    [windows, events, channel],
  );
  const colorMap = useMemo(
    () => Object.fromEntries(EMOTIONS.map((e) => [e, emotionColor(e)])) as Record<string, string>,
    [],
  );

  // 1. Sub-patterns — short (len 2-3) and long (len 4-6).
  const { shortPatterns, longPatterns } = useMemo(() => {
    let sp: Pattern[] = [];
    let lp: Pattern[] = [];
    try { sp = discoverPatterns(sequences, { len: [2, 3], minFreq: 1, minSupport: 0.02 }).patterns as Pattern[]; } catch { /* ignore */ }
    try { lp = discoverPatterns(sequences, { len: [4, 5, 6], minFreq: 1, minSupport: 0.02 }).patterns as Pattern[]; } catch { /* ignore */ }
    return { shortPatterns: sp, longPatterns: lp };
  }, [sequences]);

  // 2. Most-frequency tree.
  const { treeSvg, topPathways } = useMemo(() => {
    try {
      const tree = contextTree(sequences, { maxDepth: 3, minCount: 2 });
      return {
        treeSvg: tweakTreeSvg(plotTree(tree, { style: 'horizontal', maxNodes: 40 })),
        topPathways: commonPathways(tree, { top: 15 }),
      };
    } catch {
      return { treeSvg: '', topPathways: [] };
    }
  }, [sequences]);

  // 3. Disentangled simplicial — one simplex per card (small multiples).
  // Pool HYPA over orders 3–5 (De Bruijn k = 2,3,4 → paths of k+1 = 3,4,5
  // states), so each blob is a real higher-order simplex, not a 2-node edge.
  const SIM_ORDERS = [2, 3, 4];
  const simRef = useRef<HTMLDivElement>(null);
  const hypaCounts = useMemo(() => {
    const c = { total: 0, over: 0, under: 0, normal: 0 } as Record<string, number>;
    for (const k of SIM_ORDERS) {
      try {
        const r = buildHypa(sequences, { k, alpha: 0.05, minCount: 1, pAdjustMethod: 'BH' });
        c.total += r.scores.length;
        for (const s of r.scores) c[s.anomaly] += 1;
      } catch { /* order too high for this data */ }
    }
    return c;
  }, [sequences]);

  useEffect(() => {
    const host = simRef.current;
    if (!host) return;
    host.innerHTML = '';
    try {
      // Take the most anomalous few from EACH order (3,4,5) so the range is
      // represented, not just the single order that dominates the global rank.
      const byPadj = (a: { pAdjustedUnder: number; pAdjustedOver: number }, b: typeof a) =>
        Math.min(a.pAdjustedUnder, a.pAdjustedOver) - Math.min(b.pAdjustedUnder, b.pAdjustedOver);
      const ranked = [] as ReturnType<typeof buildHypa>['scores'];
      for (const k of SIM_ORDERS) {
        try {
          const perOrder = buildHypa(sequences, { k, alpha: 0.05, minCount: 1, pAdjustMethod: 'BH' })
            .scores.slice().sort(byPadj).slice(0, 4);
          ranked.push(...perOrder);
        } catch { /* order too high for this data */ }
      }
      if (!ranked.length) {
        host.innerHTML = '<div style="color:var(--ink-3);font-size:12px;padding:8px">No anomalous pathways to plot.</div>';
        return;
      }
      // Small-multiples grid: one simplex per card, its own states only.
      host.style.display = 'grid';
      host.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))';
      host.style.gap = '10px';
      for (const r of ranked) {
        const parts = r.path.split(' -> ');
        const pw = { parts, ids: parts.slice(), count: r.observed, order: parts.length, hypa: r };
        const cell = document.createElement('div');
        cell.style.cssText = 'border:1px solid var(--line);border-radius:8px;padding:4px';
        host.appendChild(cell);
        // baseStates:[] → the overlay lays out only this pathway's states,
        // isolating each simplex (dismantled/disentangled), not the full circle.
        drawSimplicialOverlay(cell, [pw], { baseStates: [], colorBy: 'anomaly', height: 340 });
      }
    } catch (err) {
      host.innerHTML = `<div style="color:var(--ink-3);font-size:12px;padding:8px">Simplicial: ${String(err)}</div>`;
    }
  }, [sequences]);

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }

  // Demo data only seeds emotion windows (legacy/demoFixture.js) — there is
  // no synthetic typing/discourse/interaction/ai_assist event generator, so
  // the "Load demo data" action only makes sense on the emotion channel.
  const demoAction = channel === 'emotion' ? (
    <Button variant="primary" size="sm" onClick={handleLoadDemo}>
      <Database className="size-3.5" aria-hidden="true" />
      Load demo data
    </Button>
  ) : undefined;

  // Rendered above every branch below (including loading/empty) so switching
  // channels is always possible, not just once a channel already has data.
  const channelPicker = (
    <div className="max-w-xs">
      <Select label="Channel" value={channel} options={CHANNEL_OPTIONS} onChange={setChannel} />
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {channelPicker}
        <EmptyState title="Loading stored data…" />
      </div>
    );
  }
  if (recordCount === 0) {
    return (
      <div className="flex flex-col gap-6">
        {channelPicker}
        <EmptyState
          title={`No stored ${unit.plural} yet`}
          description={
            channel === 'emotion'
              ? 'Capture a real session, or load synthetic demo data to compute patterns, trees, and simplices.'
              : `Capture a session with ${channelLabel(channel)} activity, or switch channels.`
          }
          action={demoAction}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {channelPicker}
      <Section id="pat-overview" title="Pattern overview">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label={channel === 'emotion' ? 'Windows' : 'Events'} value={recordCount} tone="info" />
          <Metric label="Sequences" value={sequences.length} tone="info" />
          <Metric
            label="Distinct states"
            value={new Set(sequences.flat().filter((state): state is string => typeof state === 'string')).size}
            tone="info"
          />
          <Metric label="Short patterns" value={shortPatterns.length} tone="info" />
          <Metric label="Long patterns" value={longPatterns.length} tone="info" />
          <Metric
            label="Anomalous paths"
            value={hypaCounts.over + hypaCounts.under}
            hint={`${hypaCounts.total} tested`}
            tone="info"
          />
        </div>
      </Section>

      <Section id="pat-simplicial" title="Disentangled simplicial" description={`Each over/under-represented ${channel === 'emotion' ? 'emotion' : channelLabel(channel).toLowerCase()} pathway (order 3–5) as its own simplex (dismantled). Red = over-represented, blue = under, gray = normal.`}>
        <Card>
          <CardHeader>
            <CardTitle>Simplicial small multiples (HYPA)</CardTitle>
            <CardMeta>{hypaCounts.total} paths · {hypaCounts.over} over · {hypaCounts.under} under</CardMeta>
          </CardHeader>
          <CardContent>
            <div ref={simRef} />
          </CardContent>
        </Card>
      </Section>

      <Section id="pat-sub" title="Sub-patterns" description={`Frequent ${channel === 'emotion' ? 'emotion' : channelLabel(channel).toLowerCase()} sub-sequences — short (2–3) and long (4–6), by support.`}>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Short patterns</CardTitle>
              <CardMeta>{shortPatterns.length} found</CardMeta>
            </CardHeader>
            <CardContent>
              {shortPatterns.length > 0
                ? <PatternTable patterns={shortPatterns} colorMap={colorMap} limit={10} />
                : <p className="text-sm text-ink-3">No short patterns.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Long patterns</CardTitle>
              <CardMeta>{longPatterns.length} found</CardMeta>
            </CardHeader>
            <CardContent>
              {longPatterns.length > 0
                ? <PatternTable patterns={longPatterns} colorMap={colorMap} limit={10} />
                : <p className="text-sm text-ink-3">No long patterns.</p>}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="pat-tree" title="Most-frequency tree" description={`Variable-order context tree with the most frequent ${channel === 'emotion' ? 'emotion' : channelLabel(channel).toLowerCase()} pathways.`}>
        <Card>
          <CardHeader>
            <CardTitle>Frequency tree</CardTitle>
            <CardMeta>{topPathways.length} pathways</CardMeta>
          </CardHeader>
          <CardContent>
            {treeSvg
              ? <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: treeSvg }} />
              : <p className="text-sm text-ink-3">Not enough sequence data for a tree yet.</p>}
            {topPathways.length > 0 && (
              <table className="mt-3 w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th className="py-1.5 pr-3 font-semibold">Pathway</th>
                    <th className="py-1.5 pr-3 font-semibold">Count</th>
                    <th className="py-1.5 pr-3 font-semibold">Likely next</th>
                    <th className="py-1.5 pr-3 font-semibold">P(next)</th>
                  </tr>
                </thead>
                <tbody>
                  {topPathways.map((p, i) => (
                    <tr key={i} className="border-b border-line text-ink-1">
                      <td className="py-1.5 pr-3">{p.pathway}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{p.count}</td>
                      <td className="py-1.5 pr-3">{p.likelyNext ?? '—'}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{typeof p.nextProbability === 'number' ? p.nextProbability.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
