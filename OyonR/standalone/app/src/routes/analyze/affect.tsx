import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Metric } from '@/components/ui/Metric';
import { Button } from '@/components/ui/Button';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { LegacyCanvas } from '@/legacy/LegacyCanvas';
import { EmotionTimeline } from '@/components/charts/EmotionTimeline';
import { AffectPad } from '@/components/charts/AffectPad';
import { loadDemoData } from '@/legacy/demoFixture.js';
import {
  drawDistribution,
  drawDynamics,
  summarizeKpis,
} from '@/legacy/dashboard.js';

/*
 * Analyze · Affect — emotion-window-centric view: KPIs, valence/arousal
 * timeline, emotion distribution, dynamics. Sequence / TNA analytics live
 * on /analyze/sequence — kept separate so panels don't repeat.
 */

export function AffectView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  const queryClient = useQueryClient();
  const kpis = useMemo(() => summarizeKpis(enriched), [enriched]);

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }

  if (isLoading) return <EmptyState title="Loading stored windows…" />;
  if (enriched.length === 0) {
    return (
      <EmptyState
        title="No stored windows yet"
        description="Capture a real session, or load synthetic demo data (3 sessions × ~30 windows) to exercise every panel."
        action={
          <Button variant="primary" size="sm" onClick={handleLoadDemo}>
            <Database className="size-3.5" aria-hidden="true" />
            Load demo data
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section id="affect-summary" title="Summary" description="KPIs across stored windows.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Windows" value={kpis.windows} tone="info" />
          <Metric label="Latest state" value={kpis.latestState} tone="info" />
          <Metric label="Latest quality" value={kpis.latestQuality} tone="info" />
          <Metric label="Analyzed" value={kpis.analyzedWindows} tone="info" hint="with dynamics" />
          <Metric label="Affect speed" value={kpis.affectSpeed} tone="info" />
          <Metric label="Instability" value={kpis.instability} tone="info" />
        </div>
      </Section>

      <Section id="affect-trend" title="Capture timeline" description="Dominant emotion per window — newest on the right.">
        <Card>
          <CardHeader>
            <CardTitle>Capture timeline</CardTitle>
            <CardMeta>{enriched.length} windows</CardMeta>
          </CardHeader>
          <CardContent>
            <EmotionTimeline recentWindows={enriched} height={180} />
          </CardContent>
        </Card>
      </Section>

      <Section id="affect-plane" title="Affect plane" description="Valence × arousal — recent windows fade into a trail.">
        <Card>
          <CardContent>
            <div className="flex justify-center">
              <AffectPad recentWindows={enriched} size={320} />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section id="affect-distribution" title="Emotion distribution" description="Count of windows per dominant emotion.">
        <Card>
          <CardContent>
            <LegacyCanvas draw={(c) => drawDistribution(c, enriched)} deps={[enriched]} height={260} />
          </CardContent>
        </Card>
      </Section>

      <Section id="affect-dynamics" title="Dynamics timeline" description="Affect speed and instability over time.">
        <Card>
          <CardContent>
            <LegacyCanvas draw={(c) => drawDynamics(c, enriched)} deps={[enriched]} height={220} />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
