import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { buildSessionSequences } from '@/lib/tnaPooling';
import { LegacyCanvas, LegacyContainer, LegacyTable } from '@/legacy/LegacyCanvas';
import { loadDemoData } from '@/legacy/demoFixture.js';
import {
  computeTnaFromSequences,
  drawNetwork,
  drawSequenceDistribution,
  renderCentralityTable,
  renderPatternsTable,
  renderMatrixHeatmap,
  renderIndexPlotPanel,
  renderDistributionPlotPanel,
  renderSequenceSummary,
} from '@/legacy/dashboard.js';

/* Sequence view — uses the legacy logs-dashboard renderers directly. */

export function SequenceView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  const queryClient = useQueryClient();
  // One chain per session, pooled by dynajs tna() — no phantom transitions
  // between distinct sessions when the filter scope aggregates them.
  const tnaResult = useMemo(
    () => computeTnaFromSequences(buildSessionSequences(enriched)),
    [enriched],
  );

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }

  if (isLoading) return <EmptyState title="Loading…" />;
  if (enriched.length === 0) {
    return (
      <EmptyState
        title="No stored windows yet"
        description="Capture a session, or load synthetic demo data to populate every panel."
        action={
          <Button variant="primary" size="sm" onClick={handleLoadDemo}>
            <Database className="size-3.5" aria-hidden="true" />
            Load demo data
          </Button>
        }
      />
    );
  }
  if (tnaResult == null) {
    return (
      <EmptyState
        title={`${enriched.length} window${enriched.length === 1 ? '' : 's'} present, but no multi-window session`}
        description="Sequence analytics need at least two windows in one session. Keep capturing or load demo data."
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
      <Section id="seq-network" title="Transition network">
        <Card>
          <CardContent>
            <LegacyContainer
              render={(el) => drawNetwork(el, tnaResult)}
              deps={[tnaResult]}
              style={{ minHeight: 500 }}
            />
          </CardContent>
        </Card>
      </Section>

      <Section id="seq-dist" title="State distribution">
        <Card>
          <CardHeader>
            <CardTitle>Counts per state</CardTitle>
          </CardHeader>
          <CardContent>
            <LegacyCanvas
              draw={(c) => drawSequenceDistribution(c, tnaResult)}
              deps={[tnaResult]}
              height={220}
            />
          </CardContent>
        </Card>
      </Section>

      <Section id="seq-centrality" title="Centralities (dynajs)">
        <Card>
          <CardContent className="p-0">
            <LegacyTable
              render={(tbody) => renderCentralityTable(tbody, tnaResult)}
              deps={[tnaResult]}
              headers={[
                { label: 'State' },
                { label: 'InStrength', align: 'right' },
                { label: 'OutStrength', align: 'right' },
                { label: 'Closeness', align: 'right' },
                { label: 'Betweenness', align: 'right' },
              ]}
            />
          </CardContent>
        </Card>
      </Section>

      <Section id="seq-patterns-matrix" title="Patterns and matrix">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top n-gram patterns</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <LegacyTable
                render={(tbody) => renderPatternsTable(tbody, tnaResult)}
                deps={[tnaResult]}
                headers={[
                  { label: 'Pattern' },
                  { label: 'Length', width: '80px' },
                  { label: 'Count', width: '90px' },
                  { label: 'Support', width: '110px' },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Transition matrix P(j | i)</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyContainer
                render={(el) => renderMatrixHeatmap(el, tnaResult)}
                deps={[tnaResult]}
                style={{ overflow: 'auto', maxHeight: 280 }}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="seq-index" title="Sequence index plot">
        <Card>
          <CardContent>
            <LegacyContainer
              render={(el) => renderIndexPlotPanel(el, tnaResult)}
              deps={[tnaResult]}
              style={{ minHeight: 200 }}
            />
          </CardContent>
        </Card>
      </Section>

      <Section id="seq-distplot" title="State distribution by timestep">
        <Card>
          <CardContent>
            <LegacyContainer
              render={(el) => renderDistributionPlotPanel(el, tnaResult)}
              deps={[tnaResult]}
              style={{ minHeight: 200 }}
            />
          </CardContent>
        </Card>
      </Section>

      <Section id="seq-summary" title="Sequence summary">
        <Card>
          <CardContent>
            <LegacyContainer
              render={(el) => renderSequenceSummary(el, tnaResult)}
              deps={[tnaResult]}
              style={{ padding: 14 }}
            />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
