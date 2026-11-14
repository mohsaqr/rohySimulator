import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { AffectDynamicsPanel } from '@/components/analytics/AffectDynamicsPanel';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { loadDemoData } from '@/legacy/demoFixture.js';
import OyonAffectV2 from '@/components/oyon/OyonAffectV2.jsx';

/*
 * Analyze · Affect — renders the Rohy 2.7 affect panels verbatim (the
 * 8-emotion co-occurrence map, emotion heat strip + totals, valence/arousal
 * plane, quadrant mix, and dynamics). The component and its whole helper chain
 * (affectAnalytics / coEmotionNetwork / EdgeBundling / chartMath — all pure JS,
 * no D3) were copied unchanged from rohySimulator/src/components; this route
 * only supplies the stored windows as its `records` input.
 */
export function AffectView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  const queryClient = useQueryClient();

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

  /*
   * The triad renders ABOVE the copied panel rather than inside it.
   * OyonAffectV2 and its whole helper chain were lifted verbatim from
   * rohySimulator; editing them would fork a file this repo deliberately
   * keeps identical to its source.
   */
  return (
    <div className="flex flex-col gap-6">
      <Section
        id="affect-dynamics"
        title="Dynamics"
      >
        <AffectDynamicsPanel windows={enriched} />
      </Section>
      <OyonAffectV2 records={enriched} />
    </div>
  );
}
