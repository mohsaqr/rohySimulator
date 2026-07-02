import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmotionWindow } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { LegacyCanvas, LegacyContainer, LegacyTable } from '@/legacy/LegacyCanvas';
import {
  summarizeGazeKpis,
  renderGazeHeatmap,
  renderGazeScanpath,
  renderGazeZoneRef,
  renderGazeQuality,
  renderGazeAoi,
  renderGazeCalibration,
  renderGazeTable,
} from '@/legacy/dashboard.js';

type GazePayload = {
  n_points?: unknown;
  dispersion?: unknown;
  valid_frame_ratio?: unknown;
  off_screen_ratio?: unknown;
  zone_proportions?: unknown;
  centroid?: unknown;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUsableGazePayload(value: unknown): value is GazePayload {
  if (!value || typeof value !== 'object') return false;
  const gaze = value as GazePayload;
  const hasSamples = Number(gaze.n_points) > 0;
  const hasSummary = finiteNumber(gaze.dispersion)
    || finiteNumber(gaze.valid_frame_ratio)
    || finiteNumber(gaze.off_screen_ratio);
  const zoneProportions = gaze.zone_proportions;
  const hasZones = Boolean(
    zoneProportions
      && typeof zoneProportions === 'object'
      && Object.values(zoneProportions as Record<string, unknown>).some(finiteNumber),
  );
  const centroid = gaze.centroid as { x?: unknown; y?: unknown } | null;
  const hasCentroid = Boolean(
    centroid
      && typeof centroid === 'object'
      && finiteNumber(centroid.x)
      && finiteNumber(centroid.y),
  );
  return hasSamples || hasSummary || hasZones || hasCentroid;
}

export function GazeView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  const gazeWindows = useMemo(
    () => enriched.filter((w) => isUsableGazePayload((w as { gaze?: unknown }).gaze)),
    [enriched],
  );
  const lastNonEmptyGazeWindowsRef = useRef<EmotionWindow[] | null>(null);
  const [emptyStateReady, setEmptyStateReady] = useState(false);

  useEffect(() => {
    if (gazeWindows.length > 0) {
      lastNonEmptyGazeWindowsRef.current = gazeWindows;
      setEmptyStateReady(false);
      return;
    }
    if (isLoading) {
      setEmptyStateReady(false);
      return;
    }
    const id = window.setTimeout(() => setEmptyStateReady(true), 1500);
    return () => window.clearTimeout(id);
  }, [gazeWindows, isLoading]);

  const displayGazeWindows = gazeWindows.length > 0
    ? gazeWindows
    : lastNonEmptyGazeWindowsRef.current ?? [];
  const kpis = useMemo(() => summarizeGazeKpis(displayGazeWindows), [displayGazeWindows]);

  const [nodeMetric, setNodeMetric] = useState<'instrength' | 'outstrength' | 'visits'>('instrength');
  const [edgeMetric, setEdgeMetric] = useState<'counts' | 'probabilities'>('counts');
  const [showSelfLoops, setShowSelfLoops] = useState(true);

  if (isLoading || (displayGazeWindows.length === 0 && !emptyStateReady)) {
    return <EmptyState title="Loading…" />;
  }
  if (displayGazeWindows.length === 0) {
    return (
      <EmptyState
        title="No gaze windows yet"
        description="Enable gaze tracking in Settings, start capture, and keep your face in view."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section id="gaze-kpis" title="Summary">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Gaze windows" value={kpis.windows} tone="info" />
          <Metric label="Mean σ" value={kpis.meanSigma} tone="info" />
          <Metric label="Mean valid" value={kpis.meanValid} tone="info" />
          <Metric label="Off-screen" value={kpis.offScreen} tone="info" />
          <Metric
            label="Calibration"
            value={kpis.calibration}
            hint={kpis.calibrationDetail ?? undefined}
            tone="info"
          />
          <Metric label="Samples" value={kpis.samples} tone="info" />
        </div>
      </Section>

      <Section id="gaze-structure" title="Coverage and transitions">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Coverage heatmap</CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ position: 'relative' }}>
                <LegacyCanvas
                  draw={(c) => {
                    const legend = document.getElementById('gaze-heat-legend') as HTMLDivElement | null;
                    renderGazeHeatmap(c, legend, displayGazeWindows);
                  }}
                  deps={[displayGazeWindows]}
                  width={900}
                  height={506}
                />
                <div
                  id="gaze-heat-legend"
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 11,
                    color: 'var(--ink-2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gaze transition network</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-space-2 flex flex-wrap items-center gap-x-4 gap-y-space-2 text-xs text-ink-2">
                <label className="inline-flex items-center gap-1.5">
                  Node size
                  <select value={nodeMetric} onChange={(e) => setNodeMetric(e.target.value as typeof nodeMetric)} className="rounded border border-line bg-surface-0 px-1.5 py-0.5 text-xs">
                    <option value="instrength">Instrength</option>
                    <option value="outstrength">Outstrength</option>
                    <option value="visits">Visits</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  Edge weight
                  <select value={edgeMetric} onChange={(e) => setEdgeMetric(e.target.value as typeof edgeMetric)} className="rounded border border-line bg-surface-0 px-1.5 py-0.5 text-xs">
                    <option value="counts">Counts</option>
                    <option value="probabilities">P(j | i)</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={showSelfLoops} onChange={(e) => setShowSelfLoops(e.target.checked)} />
                  Show self-loops
                </label>
              </div>
              <LegacyContainer
                render={(el) => {
                  const legend = document.getElementById('gaze-network-legend') as HTMLDivElement | null;
                  renderGazeScanpath(el, legend, displayGazeWindows, [], { nodeMetric, edgeMetric, showSelfLoops });
                }}
                deps={[displayGazeWindows, nodeMetric, edgeMetric, showSelfLoops]}
                className="aspect-video overflow-hidden rounded-sm border border-line bg-surface-0"
              />
              <div id="gaze-network-legend" className="mt-space-2 text-[11px] text-ink-3" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="gaze-quality" title="Quality and zones">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Dispersion &amp; valid-frame ratio</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyCanvas draw={(c) => renderGazeQuality(c, displayGazeWindows)} deps={[displayGazeWindows]} height={260} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Zone proportions (3×3 reference)</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyContainer
                render={(el) => renderGazeZoneRef(el, displayGazeWindows)}
                deps={[displayGazeWindows]}
                style={{ padding: 16 }}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="gaze-aoi-calib" title="AOI and calibration">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>AOI dwell totals</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyCanvas draw={(c) => renderGazeAoi(c, displayGazeWindows)} deps={[displayGazeWindows]} height={260} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Calibration timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <LegacyCanvas draw={(c) => renderGazeCalibration(c, displayGazeWindows)} deps={[displayGazeWindows]} height={260} />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="gaze-table" title="Gaze windows">
        <Card>
          <CardContent className="p-0">
            <LegacyTable
              render={(tbody) => renderGazeTable(tbody, displayGazeWindows)}
              deps={[displayGazeWindows]}
              headers={[
                { label: 'Window end', width: '138px' },
                { label: 'n_points', width: '70px' },
                { label: 'σ', width: '90px' },
                { label: 'centroid (x, y)', width: '110px' },
                { label: 'valid', width: '80px' },
                { label: 'off-screen', width: '80px' },
                { label: 'calibration' },
              ]}
            />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
