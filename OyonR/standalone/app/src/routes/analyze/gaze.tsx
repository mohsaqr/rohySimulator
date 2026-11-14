import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmotionWindow } from 'oyon';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { AttentionMonitor, type MonitorPoint } from '@/components/charts/AttentionMonitor';
import { GazeDynamicsPanel } from '@/components/analytics/GazeDynamicsPanel';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { LegacyCanvas, LegacyContainer } from '@/legacy/LegacyCanvas';
import {
  summarizeGazeKpis,
  renderGazeHeatmap,
  renderGazeScanpath,
  renderGazeZoneRef,
  renderGazeQuality,
  renderGazeAoi,
  renderGazeCalibration,
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

function monitorPointsOf(windows: EmotionWindow[]): MonitorPoint[] {
  const out: MonitorPoint[] = [];
  windows.forEach((window, index) => {
    const win = window as Record<string, unknown>;
    const gaze = win.gaze as {
      centroid?: { x?: number; y?: number };
      n_points?: number;
    } | undefined;
    const centroid = gaze?.centroid;
    const emotion = typeof win.dominant_emotion === 'string' ? win.dominant_emotion : null;
    if (!centroid || !finiteNumber(centroid.x) || !finiteNumber(centroid.y) || !emotion) return;

    const heartRate = win.heart_rate as {
      bpm_tracked?: number | null;
      bpm_robust?: number | null;
      bpm_mean?: number | null;
    } | undefined;
    const bpm = [heartRate?.bpm_tracked, heartRate?.bpm_robust, heartRate?.bpm_mean]
      .find((value): value is number => finiteNumber(value) && value > 0) ?? null;

    out.push({
      x: centroid.x,
      y: centroid.y,
      emotion,
      n: finiteNumber(gaze?.n_points) && gaze.n_points > 0 ? gaze.n_points : 1,
      bpm,
      at: String(win.window_end ?? win.timestamp ?? ''),
      index,
    });
  });
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Pooled std of centroid position — one number for how widely gaze roamed. */
function spreadOf(points: MonitorPoint[]): number | null {
  if (points.length < 2) return null;
  const mx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const my = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const variance = points.reduce(
    (sum, point) => sum + (point.x - mx) ** 2 + (point.y - my) ** 2,
    0,
  );
  return Math.sqrt(variance / points.length);
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
  const monitorPoints = useMemo(() => monitorPointsOf(displayGazeWindows), [displayGazeWindows]);
  const heartRatePoints = useMemo(
    () => monitorPoints.filter((point) => finiteNumber(point.bpm)),
    [monitorPoints],
  );
  const monitorSpread = useMemo(() => spreadOf(monitorPoints), [monitorPoints]);

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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Gaze windows" value={kpis.windows} />
          <Metric label="Samples" value={kpis.samples} />
          <Metric label="Mean dispersion" value={kpis.meanSigma} />
          <Metric label="Mean valid" value={kpis.meanValid} />
          <Metric label="Off-screen" value={kpis.offScreen} />
          <Metric
            label="Calibration"
            value={kpis.calibration}
            hint={kpis.calibrationDetail ?? undefined}
          />
          <Metric
            label="Gaze spread"
            value={monitorSpread == null ? '—' : monitorSpread.toFixed(3)}
            hint="0 = fixed stare; higher = more roaming"
          />
          <Metric
            label="Distinct emotions"
            value={String(new Set(monitorPoints.map((point) => point.emotion)).size)}
          />
        </div>
      </Section>

      <Section
        id="gaze-attention-monitor"
        title="Attention monitor"
        description="Aggregate gaze centroids coloured by emotion. Dot area shows gaze samples; heart area shows heart rate around the 72 BPM reference."
      >
        {monitorPoints.length > 0 ? (
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Gaze sample density</CardTitle>
                </CardHeader>
                <CardContent>
                  <AttentionMonitor points={monitorPoints} sizeBy="gazeSamples" />
                </CardContent>
              </Card>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Heart rate at gaze centroid</CardTitle>
                </CardHeader>
                <CardContent>
                  <AttentionMonitor points={heartRatePoints} sizeBy="heartRate" />
                </CardContent>
              </Card>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-surface-1 px-4 py-6 text-sm text-ink-2">
            Attention monitoring needs a gaze centroid and dominant emotion in the same window.
          </div>
        )}
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
              <div id="gaze-network-legend" className="mt-space-2 text-mini text-ink-3" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="gaze-dynamics"
        title="Attention mode and predictability"
        description="How the learner looked, rather than where. K is scored per window against this session's own distributions; the entropy is pooled across the whole selection, because one 3-second window holds too few transitions to estimate it."
      >
        <GazeDynamicsPanel windows={displayGazeWindows} />
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
    </div>
  );
}
