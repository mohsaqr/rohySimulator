import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Section } from '@/components/ui/Section';
import { Metric, type MetricTone } from '@/components/ui/Metric';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { useRuntime } from '@/lib/RuntimeProvider';
import { AffectPad } from '@/components/charts/AffectPad';
import { EmotionTimeline } from '@/components/charts/EmotionTimeline';
import { LiveGazeHeatmap } from '@/components/charts/LiveGazeHeatmap';
import { emotionColor } from '@/lib/emotionColors';
import { deriveFrameQuality } from '@/lib/frameQuality';

/*
 * Live — the page-shape every analytic follows:
 *   1. Summary band   — Metric tiles (real, with honest nulls)
 *   2. Trend band     — placeholder for Phase B.1 rolling timeline
 *   3. Structure band — placeholder for affect pad + spatial gaze tile
 *
 * All metrics in the Summary band derive from `lastWindow` (the most recent
 * window emitted by the runtime). Before the first window arrives, every
 * tile renders `null` with a reason — never a fabricated zero.
 */
function LivePage() {
  const {
    status,
    lastWindow,
    lastPrediction,
    lastEye,
    lastGaze,
    recentWindows,
    windowCount,
    eyeSampleCount,
    gazeSampleCount,
    mockGaze,
    setMockGaze,
    settings,
    start,
    gazeDiag,
  } = useRuntime();
  const cameraRunning = status === 'running';

  // Opt-in, in-tab-only attention heatmap. Off by default; nothing is
  // accumulated until the user explicitly turns it on (see disclosure).
  const [heatmapOptIn, setHeatmapOptIn] = useState(false);

  // Derive metric values once, with shared null-reason logic.
  const noWindow = !lastWindow;
  const reason =
    status === 'idle' || status === 'stopped'
      ? 'capture not started'
      : status === 'initializing'
        ? 'waiting for first window'
        : noWindow
          ? 'no window yet'
          : undefined;

  const engagement = lastWindow?.engagement ?? null;
  const dominantPct = lastWindow
    ? Math.max(...Object.values(lastWindow.probabilities ?? {}))
    : null;
  const validFrameRatio = deriveFrameQuality(lastWindow).ratio;

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 3"
        title="Live"
        description="Watch the signal as it streams. Engagement KPIs, current prediction, and a spatial gaze tile."
        actions={
          <StatusPill tone={statusTone(status)} size="md">
            {status} · {windowCount} window{windowCount === 1 ? '' : 's'}
          </StatusPill>
        }
      />

      <div className="flex flex-col gap-6">
        {/* Per-sample live readout — updates ~1Hz, far faster than 10s windows. */}
        <Card>
          <CardHeader>
            <CardTitle>Now (per-sample, ~1Hz)</CardTitle>
            <StatusPill tone={lastPrediction ? 'ok' : 'null'} reason={lastPrediction ? undefined : 'waiting for first sample'}>
              {lastPrediction
                ? `${lastPrediction.label} · ${(lastPrediction.confidence * 100).toFixed(0)}%`
                : 'no sample'}
            </StatusPill>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastPrediction ? (
              <>
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block size-10 rounded-full ring-4"
                    style={{
                      background: emotionColor(lastPrediction.label),
                      // @ts-expect-error CSS custom prop
                      '--tw-ring-color': emotionColor(lastPrediction.label) + '33',
                    }}
                    aria-hidden="true"
                  />
                  <div>
                    <div
                      className="text-2xl font-semibold capitalize"
                      style={{ color: emotionColor(lastPrediction.label) }}
                    >
                      {lastPrediction.label}
                    </div>
                    <div className="text-xs text-ink-3">
                      confidence {(lastPrediction.confidence * 100).toFixed(0)}% ·
                      last sample{' '}
                      {Math.max(0, ((Date.now() - lastPrediction.ts) / 1000)).toFixed(1)}s ago
                    </div>
                  </div>
                </div>
                <ProbBars probabilities={lastPrediction.probabilities} />
              </>
            ) : (
              <EmptyState
                title="No live samples yet"
                description="Per-sample predictions appear every ~1 second once capture starts. Window aggregates ship every 10s by default (Settings → Capture)."
              />
            )}
            {lastGaze ? (
              <div className="rounded border border-line bg-surface-0 p-2 text-xs text-ink-2">
                <span className="font-medium text-ink-1">Gaze (live):</span>{' '}
                x={lastGaze.x.toFixed(3)}, y={lastGaze.y.toFixed(3)} · quality{' '}
                {lastGaze.quality.toFixed(2)} · {gazeSampleCount} samples · state{' '}
                <code className="font-mono">{lastGaze.state ?? '—'}</code>
              </div>
            ) : (
              <div className="rounded border border-dashed border-line bg-surface-1 p-2 text-xs text-ink-3">
                {settings.gaze_calibration_required
                  ? 'Gaze: waiting for first sample. Run calibration before gaze windows are emitted.'
                  : 'Gaze: waiting for first sample. Calibration is optional and can improve quality.'}
              </div>
            )}
            {lastEye ? (
              <div className="rounded border border-line bg-surface-0 p-2 text-xs text-ink-2">
                <span className="font-medium text-ink-1">Eye module:</span>{' '}
                {eyeSampleCount} samples · {lastEye.valid ? 'valid' : 'invalid'} ·
                openness{' '}
                {lastEye.eyeOpennessMean != null
                  ? lastEye.eyeOpennessMean.toFixed(2)
                  : '—'} · zone{' '}
                <code className="font-mono">{lastEye.gazeZone ?? '—'}</code>
              </div>
            ) : (
              <div className="rounded border border-dashed border-line bg-surface-1 p-2 text-xs text-ink-3">
                Eye module: waiting for first sample.
              </div>
            )}
          </CardContent>
        </Card>

        <Section
          id="live-summary"
          title="Window summary (every 10s)"
          description="At-a-glance signal health for the most recent aggregate window."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Metric
              label="Dominant"
              value={lastWindow?.dominant_emotion ?? null}
              hint={
                dominantPct != null
                  ? `${(dominantPct * 100).toFixed(0)}% confidence`
                  : undefined
              }
              tone={lastWindow ? 'ok' : 'null'}
              reason={reason}
            />
            <Metric
              label="Focus score"
              value={engagement?.focus_score ?? null}
              format={(v) => v.toFixed(2)}
              tone={engagement?.focus_score == null ? 'null' : 'ok'}
              reason={reason}
            />
            <Metric
              label="Blink rate"
              value={engagement?.blink_rate_hz ?? null}
              unit="Hz"
              format={(v) => v.toFixed(2)}
              tone={engagement?.blink_rate_hz == null ? 'null' : 'info'}
              reason={reason}
            />
            <Metric
              label="Eye openness"
              value={engagement?.eye_openness_mean ?? null}
              format={(v) => v.toFixed(2)}
              tone={engagement?.eye_openness_mean == null ? 'null' : 'info'}
              reason={reason}
            />
            <Metric
              label="Valid frames"
              value={validFrameRatio}
              unit="%"
              format={(v) => `${(v * 100).toFixed(0)}`}
              tone={
                validFrameRatio == null
                  ? 'null'
                  : validFrameRatio > 0.8
                    ? 'ok'
                    : validFrameRatio > 0.5
                      ? 'warn'
                      : 'bad'
              }
              reason={reason}
            />
            <Metric
              label="Windows"
              value={windowCount}
              tone="info"
              hint="this session"
            />
          </div>
        </Section>

        <Section
          id="live-trend"
          title="Trend"
          description="Last 60 windows, newest on the right. Bar color = dominant emotion; bar height = confidence."
        >
          <Card>
            <CardHeader>
              <CardTitle>Emotion timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <EmotionTimeline recentWindows={recentWindows} />
            </CardContent>
          </Card>
        </Section>

        <Section
          id="live-structure"
          title="Structure"
          description="Affect pad shows the valence / arousal trajectory. Probability bars and gaze tile sit beside it."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Affect pad</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <AffectPad recentWindows={recentWindows} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Latest distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {lastWindow ? (
                  <ProbBars probabilities={lastWindow.probabilities ?? {}} />
                ) : (
                  <EmptyState title="No window yet" description="Probability distribution renders once the first window emits." />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Live gaze</CardTitle>
              </CardHeader>
              <CardContent>
                <LiveGazeTile
                  lastGaze={lastGaze}
                  gazeSampleCount={gazeSampleCount}
                  enabled={Boolean(settings.gaze_tracking_enabled)}
                  mockGaze={mockGaze}
                  onToggleMock={setMockGaze}
                />
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="live-heatmap"
          title="Live attention heatmap"
          description="Where gaze has pooled recently, accumulated live from the webcam (once the camera is running) or the demo stream."
        >
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHeatmapOptIn((v) => !v)}
                  className="rounded border border-line bg-surface-1 px-2 py-1 text-[11px] font-medium text-ink-1 hover:bg-surface-2"
                >
                  {heatmapOptIn ? '■ Stop & clear heatmap' : '▶ Enable live heatmap'}
                </button>
                {heatmapOptIn ? (
                  cameraRunning ? (
                    gazeDiag?.error ? (
                      <span className="text-[11px] text-status-bad">
                        ⚠ gaze adapter failed: {gazeDiag.error} — use “Demo gaze
                        stream” meanwhile
                      </span>
                    ) : gazeDiag && gazeDiag.status !== 'inference' ? (
                      <span className="text-[11px] text-status-warn">
                        camera running, gaze adapter status “{gazeDiag.status ?? 'unknown'}”
                        — not streaming yet
                      </span>
                    ) : (
                      <span className="text-[11px] text-status-ok">
                        ● live webcam gaze — no calibration needed for the heatmap
                      </span>
                    )
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void start();
                        }}
                        className="rounded border border-line bg-surface-1 px-2 py-1 text-[11px] font-medium text-ink-1 hover:bg-surface-2"
                      >
                        ▶ Start camera
                      </button>
                      <span className="text-[11px] text-ink-3">
                        no gaze stream yet — start the camera (status: {status}),
                        or use “Demo gaze stream” in the Live gaze card
                      </span>
                    </>
                  )
                ) : (
                  <span className="text-[11px] text-ink-3">
                    raw gaze accumulates in this tab only; cleared on stop /
                    navigation — not stored, not sent
                  </span>
                )}
              </div>
              {heatmapOptIn ? (
                <div className="flex justify-center">
                  <LiveGazeHeatmap active width={480} height={270} />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </Section>
      </div>
    </>
  );
}

function statusTone(status: string): MetricTone {
  if (status === 'running') return 'ok';
  if (status === 'paused') return 'warn';
  if (status === 'error') return 'bad';
  if (
    status === 'initializing' ||
    status === 'ready' ||
    status === 'starting-camera' ||
    status === 'stopping'
  ) return 'info';
  return 'null';
}

function ProbBars({ probabilities }: { probabilities: Record<string, number> }) {
  const entries = Object.entries(probabilities)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return (
    <ul className="flex flex-col gap-1.5" role="list">
      {entries.map(([label, value]) => (
        <li key={label} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate capitalize text-ink-2">{label}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded bg-surface-2">
            <div
              className="h-full"
              style={{
                width: `${Math.max(0, Math.min(1, value)) * 100}%`,
                background: emotionColor(label),
              }}
            />
          </div>
          <span className="w-10 text-right tabular-nums text-ink-1">
            {(value * 100).toFixed(0)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

interface LiveGazeTileProps {
  lastGaze: { x: number; y: number; quality: number; state?: string; ts: number } | null;
  gazeSampleCount: number;
  enabled: boolean;
  mockGaze: boolean;
  onToggleMock: (on: boolean) => void;
}

function MockGazeToggle({
  mockGaze,
  onToggleMock,
}: Pick<LiveGazeTileProps, 'mockGaze' | 'onToggleMock'>) {
  return (
    <button
      type="button"
      onClick={() => onToggleMock(!mockGaze)}
      className="rounded border border-line bg-surface-1 px-2 py-1 text-[11px] font-medium text-ink-1 hover:bg-surface-2"
    >
      {mockGaze ? '■ Stop demo gaze stream' : '▶ Demo gaze stream (no camera)'}
    </button>
  );
}

function LiveGazeTile({
  lastGaze,
  gazeSampleCount,
  enabled,
  mockGaze,
  onToggleMock,
}: LiveGazeTileProps) {
  if (!enabled) {
    return (
      <div className="text-sm text-ink-2 space-y-2">
        <div className="text-xs uppercase tracking-wider text-ink-3">Gaze tracking off</div>
        <div>Enable it in Settings → Inference — or preview the dot with a synthetic stream:</div>
        <MockGazeToggle mockGaze={mockGaze} onToggleMock={onToggleMock} />
      </div>
    );
  }
  // Live gaze sample: render normalized [-0.5, 0.5] coords onto a small
  // viewport rectangle so the user sees the dot in real time.
  const W = 240;
  const H = 135;
  const dotX = lastGaze ? (0.5 + lastGaze.x) * W : null;
  const dotY = lastGaze ? (0.5 + lastGaze.y) * H : null;
  return (
    <div className="flex flex-col gap-2">
    <div className="flex gap-3 items-start">
      <div
        className="relative rounded border border-line bg-surface-3 overflow-hidden"
        style={{ width: W, height: H }}
        aria-label="Live gaze position"
      >
        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line/60" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-line/60" />
        </div>
        {dotX != null && dotY != null ? (
          <div
            className="absolute size-3 rounded-full"
            style={{
              left: Math.max(0, Math.min(W - 12, dotX - 6)),
              top: Math.max(0, Math.min(H - 12, dotY - 6)),
              background: lastGaze!.quality > 0.5 ? 'var(--status-ok)' : 'var(--status-warn)',
              boxShadow: '0 0 0 4px rgba(0,0,0,0.05)',
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="text-xs space-y-1 flex-1 min-w-0">
        <Row label="Samples" value={String(gazeSampleCount)} />
        <Row
          label="Quality"
          value={lastGaze ? lastGaze.quality.toFixed(2) : '—'}
        />
        <Row
          label="Position"
          value={lastGaze ? `${lastGaze.x.toFixed(2)}, ${lastGaze.y.toFixed(2)}` : '—'}
        />
        <Row label="State" value={lastGaze?.state ?? '—'} />
      </div>
    </div>
      <div className="flex items-center gap-2">
        <MockGazeToggle mockGaze={mockGaze} onToggleMock={onToggleMock} />
        {mockGaze ? (
          <span className="text-[11px] text-ink-3">
            synthetic stream — not a real adapter sample
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line py-1 last:border-b-0">
      <span className="text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
      <span className="font-medium tabular-nums text-ink-0 truncate">{value}</span>
    </div>
  );
}

export const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: LivePage,
});
