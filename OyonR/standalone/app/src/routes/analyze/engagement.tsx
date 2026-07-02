import { useMemo } from 'react';
import type { EmotionWindow } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { EngagementTimeline } from '@/components/charts/EngagementTimeline';
import { useFilteredWindows } from '@/lib/useFilteredWindows';

interface EngagementSummary {
  count: number;
  meanFocus: number | null;
  meanBlink: number | null;
  meanOpenness: number | null;
  meanEntropy: number | null;
}

function computeSummary(windows: EmotionWindow[]): EngagementSummary {
  let focusSum = 0, focusN = 0;
  let blinkSum = 0, blinkN = 0;
  let opSum = 0, opN = 0;
  let entSum = 0, entN = 0;
  for (const w of windows) {
    const e = (w.engagement ?? null) as {
      focus_score?: number | null;
      blink_rate_hz?: number | null;
      eye_openness_mean?: number | null;
      gaze_entropy?: number | null;
    } | null;
    if (!e) continue;
    if (typeof e.focus_score === 'number' && Number.isFinite(e.focus_score)) { focusSum += e.focus_score; focusN += 1; }
    if (typeof e.blink_rate_hz === 'number' && Number.isFinite(e.blink_rate_hz)) { blinkSum += e.blink_rate_hz; blinkN += 1; }
    if (typeof e.eye_openness_mean === 'number' && Number.isFinite(e.eye_openness_mean)) { opSum += e.eye_openness_mean; opN += 1; }
    if (typeof e.gaze_entropy === 'number' && Number.isFinite(e.gaze_entropy)) { entSum += e.gaze_entropy; entN += 1; }
  }
  return {
    count: windows.length,
    meanFocus: focusN ? focusSum / focusN : null,
    meanBlink: blinkN ? blinkSum / blinkN : null,
    meanOpenness: opN ? opSum / opN : null,
    meanEntropy: entN ? entSum / entN : null,
  };
}

export function EngagementView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  const summary = useMemo(() => computeSummary(enriched), [enriched]);

  if (isLoading) return <EmptyState title="Loading…" />;
  if (enriched.length === 0) {
    return <EmptyState title="No stored windows yet" description="Capture a session and engagement will appear here." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Section id="engagement-summary" title="Summary">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label="Windows" value={summary.count} tone="info" />
          <Metric
            label="Mean focus"
            value={summary.meanFocus}
            format={(v) => v.toFixed(2)}
            tone={summary.meanFocus == null ? 'null' : summary.meanFocus > 0.6 ? 'ok' : summary.meanFocus > 0.4 ? 'warn' : 'bad'}
            reason={summary.meanFocus == null ? 'no focus data' : undefined}
          />
          <Metric label="Mean blink" value={summary.meanBlink} unit="Hz" format={(v) => v.toFixed(2)} tone={summary.meanBlink == null ? 'null' : 'info'} reason={summary.meanBlink == null ? 'no blink data' : undefined} />
          <Metric label="Mean openness" value={summary.meanOpenness} format={(v) => v.toFixed(2)} tone={summary.meanOpenness == null ? 'null' : 'info'} reason={summary.meanOpenness == null ? 'no openness data' : undefined} />
          <Metric label="Mean entropy" value={summary.meanEntropy} format={(v) => v.toFixed(2)} tone={summary.meanEntropy == null ? 'null' : 'info'} reason={summary.meanEntropy == null ? 'no entropy data' : undefined} />
        </div>
      </Section>

      <Section
        id="engagement-trend"
        title="Focus & openness over time"
        description="Per-window focus_score and eye_openness_mean (0–1). Gaps mean no engagement block for that window."
      >
        <Card>
          <CardHeader>
            <CardTitle>Engagement timeline</CardTitle>
            <CardMeta>{summary.count} windows</CardMeta>
          </CardHeader>
          <CardContent>
            <EngagementTimeline recentWindows={enriched} height={220} />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
