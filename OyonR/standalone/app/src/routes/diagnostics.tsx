import { useMemo, type ReactNode } from 'react';
import { Link, createRoute } from '@tanstack/react-router';
import { Camera, Crosshair, Pause, Play, Square } from 'lucide-react';
import type { EmotionWindow } from 'oyon';
import type { SignalEvent } from 'oyon/signal-events';
import { useStoredEvents } from '@/lib/storedEvents';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Section } from '@/components/ui/Section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useCameraDock } from '@/lib/CameraDockContext';
import { useBridge, type GazeAoi } from '@/lib/hostBridge';
import { respirationPhase, respirationStatusText } from '@/lib/respirationState.js';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'null';

type TimingSummary = {
  frames_observed?: unknown;
  estimated_dropped_frames?: unknown;
  drop_ratio?: unknown;
  drop_estimate_source?: unknown;
  observed_fps?: unknown;
  frame_interval_ms_std?: unknown;
  max_frame_gap_ms?: unknown;
};

type DiagnosticWindow = EmotionWindow & {
  capture_quality?: {
    available?: boolean;
    settings?: Record<string, unknown> | null;
    timing?: {
      source?: string;
      window?: TimingSummary | null;
      frame_width?: unknown;
      frame_height?: unknown;
    } | null;
  } | null;
  gaze?: {
    n_points?: unknown;
    total_frames?: unknown;
    valid_frame_ratio?: unknown;
    observed_sample_rate_hz?: unknown;
    max_observed_sample_gap_ms?: unknown;
    fixation_sampling_adequate?: boolean;
    fixation_count?: unknown;
    fixation_duration_ms_median?: unknown;
    scanpath_length?: unknown;
    off_screen_episode_count?: unknown;
    aoi_dwell_ms?: Record<string, number> | null;
    aoi_transition_count?: unknown;
    aoi_transition_entropy?: unknown;
    aoi_transitions?: Record<string, number> | null;
  } | null;
  respiration?: {
    brpm_mean?: unknown;
    confidence_mean?: unknown;
    valid_frame_ratio?: unknown;
    sample_rate_hz?: unknown;
    max_sample_gap_ms?: unknown;
    sampling_adequate?: boolean;
    rgb_corroboration_available_ratio?: unknown;
    rgb_corroboration_agreement_ratio?: unknown;
    rgb_corroboration_required?: boolean;
  } | null;
  illumination?: {
    assessment?: unknown;
    mean_luma?: unknown;
    luma_temporal_std?: unknown;
    clipped_low?: unknown;
    clipped_high?: unknown;
    stability?: unknown;
    quality_mean?: unknown;
    quality_min?: unknown;
    valid_frame_ratio?: unknown;
  } | null;
};

const TEST_AOIS: GazeAoi[] = [
  { id: 'left', x: -0.5, y: -0.5, width: 1 / 3, height: 1 },
  { id: 'center', x: -1 / 6, y: -0.5, width: 1 / 3, height: 1 },
  { id: 'right', x: 1 / 6, y: -0.5, width: 1 / 3, height: 1 },
];

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fixed(value: unknown, digits = 1): string | null {
  const number = finite(value);
  return number == null ? null : number.toFixed(digits);
}

function percent(value: unknown, digits = 0): string | null {
  const number = finite(value);
  return number == null ? null : `${(number * 100).toFixed(digits)}%`;
}

function frameObserverLabel(source: unknown): string | null {
  if (source === 'requestVideoFrameCallback') return 'video-frame callback';
  if (source === 'unavailable') return 'unavailable';
  return null;
}

function timestampAgeLabel(timestampMs: number | null): string | null {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (seconds < 2) return 'now';
  if (seconds < 120) return `${seconds}s ago`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function ageLabel(window: DiagnosticWindow | null): string | null {
  if (!window?.window_end) return null;
  const end = Date.parse(window.window_end);
  if (!Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - end) / 1000));
  return seconds < 2 ? 'now' : `${seconds}s ago`;
}

const RESULT_CARD_CLASS = 'flex h-full min-h-[23rem] flex-col overflow-hidden';

function PrimaryReading({ label, value, unit, hint }: {
  label: string;
  value: string | number | null;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="border-b border-line pb-4">
      <div className="label-eyebrow">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-4xl font-semibold tabular-nums tracking-tight ${value == null ? 'text-ink-3' : 'text-ink-0'}`}>
          {value ?? '—'}
        </span>
        {value != null && unit ? <span className="text-sm text-ink-2">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

function QualityBar({ label, value, tone = 'info' }: {
  label: string;
  value: number | null;
  tone?: Tone;
}) {
  const bounded = value == null ? 0 : Math.max(0, Math.min(1, value));
  const color = tone === 'ok'
    ? 'bg-status-ok'
    : tone === 'warn'
      ? 'bg-status-warn'
      : tone === 'bad'
        ? 'bg-status-bad'
        : tone === 'null'
          ? 'bg-status-null'
          : 'bg-status-info';
  return (
    <div className="py-3">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-mini">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums text-ink-3">{value == null ? 'not measured' : `${Math.round(bounded * 100)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${bounded * 100}%` }} />
      </div>
    </div>
  );
}

function EvidenceRow({ label, value, unit }: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
}) {
  const absent = value == null;
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 border-b border-line/70 py-1.5 last:border-b-0">
      <span className="text-xs text-ink-2">{label}</span>
      <span className={`text-right text-xs font-medium tabular-nums ${absent ? 'text-ink-3' : 'text-ink-0'}`}>
        {absent ? '—' : value}{!absent && unit ? <span className="ml-1 font-normal text-ink-3">{unit}</span> : null}
      </span>
    </div>
  );
}

/**
 * Typing / signal-event diagnostics: what the per-event log has actually
 * persisted to IndexedDB (`oyon-app`/`signal_events`), plus the
 * `Intl.Segmenter` capability check — without it, grapheme and word counts
 * silently degrade to code points / whitespace splits, which is a real
 * correctness caveat for the typing metrics.
 *
 * No "clear signal events" action: this page has no comparable destructive
 * action (Start/Stop/Pause and AOI toggles only), so none is introduced.
 *
 * Styled with PrimaryReading + EvidenceRow like the sensor result cards —
 * metric tiles on this page are reserved for the run summary band (asserted
 * by tests/sensing-diagnostics-screen.test.js).
 */
function SignalEventsSection() {
  const eventsQuery = useStoredEvents({ all: true });
  const events = eventsQuery.data;
  const loading = events == null;

  const summary = useMemo(() => {
    if (!events) return null;
    const byModality = new Map<string, number>();
    const captureIds = new Set<string>();
    const sessionIds = new Set<string>();
    let latestTimestamp: number | null = null;
    events.forEach((event: SignalEvent) => {
      byModality.set(event.modality, (byModality.get(event.modality) ?? 0) + 1);
      if (event.capture_id) captureIds.add(event.capture_id);
      if (event.session_id) sessionIds.add(event.session_id);
      if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) {
        latestTimestamp = latestTimestamp == null ? event.timestamp : Math.max(latestTimestamp, event.timestamp);
      }
    });
    return {
      total: events.length,
      byModality: [...byModality.entries()].sort((a, b) => b[1] - a[1]),
      captures: captureIds.size,
      sessions: sessionIds.size,
      latestTimestamp,
    };
  }, [events]);

  // Capability check, once per mount: constructing a Segmenter per
  // granularity is the honest test — presence of the constructor alone does
  // not prove a granularity is supported.
  const segmenter = useMemo(() => {
    const available = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
    const supports = (granularity: 'grapheme' | 'word'): boolean => {
      if (!available) return false;
      try {
        void new Intl.Segmenter(undefined, { granularity });
        return true;
      } catch {
        return false;
      }
    };
    return { grapheme: supports('grapheme'), word: supports('word') };
  }, []);
  const segmenterOk = segmenter.grapheme && segmenter.word;

  const latest = summary?.latestTimestamp ?? null;
  const eventsState: { tone: Tone; label: string; reason?: string } = loading
    ? { tone: 'info', label: 'reading', reason: 'IndexedDB' }
    : summary && summary.total > 0
      ? { tone: 'ok', label: 'persisted' }
      : { tone: 'null', label: 'empty', reason: 'run the typing test on Live' };

  return (
    <Section
      id="diagnostics-signal-events"
      title="Typing & signal events"
      description="The per-event state log behind sequence analysis, as persisted to IndexedDB (oyon-app/signal_events). Rows are written by the typing test tool on Live and any capture-time event loggers."
    >
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <Card className="flex h-full flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>Signal event log</CardTitle>
            <StatusPill tone={eventsState.tone} reason={eventsState.reason}>{eventsState.label}</StatusPill>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col px-5 py-4">
            <PrimaryReading
              label="Stored signal events"
              value={summary?.total ?? null}
              unit="rows"
              hint={loading ? 'Reading IndexedDB…' : 'Database oyon-app, store signal_events'}
            />
            <div className="mt-1">
              <EvidenceRow label="Distinct captures" value={summary?.captures ?? null} />
              <EvidenceRow label="Distinct sessions" value={summary?.sessions ?? null} />
              <EvidenceRow
                label="Latest event"
                value={latest != null
                  ? `${new Date(latest).toISOString().slice(11, 19)} UTC · ${timestampAgeLabel(latest)}`
                  : null}
              />
              {summary?.byModality.map(([modality, count]) => (
                <EvidenceRow
                  key={modality}
                  label={<>modality <code className="font-mono">{modality}</code></>}
                  value={count}
                />
              ))}
            </div>
            <p className="mt-auto mb-0 border-t border-line pt-3 text-micro leading-relaxed text-ink-3">
              Events are ordered by sequence_index per capture (wall-clock time is not monotonic
              across a tab suspend). getAll() here never drains the store.
            </p>
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>Text segmentation capability</CardTitle>
            <StatusPill
              tone={segmenterOk ? 'ok' : 'warn'}
              reason={segmenterOk ? undefined : 'counts degrade'}
            >
              {segmenterOk ? 'full' : 'degraded'}
            </StatusPill>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col px-5 py-4">
            <PrimaryReading
              label="Intl.Segmenter"
              value={segmenterOk ? 'Available' : segmenter.grapheme ? 'Partial' : 'Missing'}
              hint="Required for true grapheme-cluster and word counts in the typing metrics"
            />
            <div className="mt-1">
              <EvidenceRow label="Grapheme granularity" value={segmenter.grapheme ? 'supported' : 'missing'} />
              <EvidenceRow label="Word granularity" value={segmenter.word ? 'supported' : 'missing'} />
            </div>
            <p className="mt-auto mb-0 border-t border-line pt-3 text-micro leading-relaxed text-ink-3">
              Without Intl.Segmenter, grapheme counts silently degrade to code points (an emoji
              family counts as 7, not 1) and word counts to whitespace splits (mis-counting CJK and
              Thai) — a real correctness caveat for stored typing metrics, not a cosmetic one.
            </p>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}

export function DiagnosticsView() {
  const runtime = useRuntime();
  const cameraDock = useCameraDock();
  const bridgeControls = useBridge((state) => state.controls);
  const configuredAois = useBridge((state) => state.gazeAois);
  const setBridge = useBridge((state) => state.setBridge);

  const latest = useMemo<DiagnosticWindow | null>(() => {
    if (runtime.lastWindow) return runtime.lastWindow as DiagnosticWindow;
    const rows = runtime.recentWindows;
    return rows.length > 0 ? rows[rows.length - 1] as DiagnosticWindow : null;
  }, [runtime.lastWindow, runtime.recentWindows]);

  const capture = latest?.capture_quality ?? null;
  const timing = capture?.timing?.window ?? null;
  const cameraSettings = capture?.settings ?? null;
  const gaze = latest?.gaze ?? null;
  const respiration = latest?.respiration ?? null;
  const illumination = latest?.illumination ?? null;

  const droppedRatio = finite(timing?.drop_ratio);
  const captureState: { tone: Tone; label: string; reason?: string } = !runtime.cameraStream
    ? { tone: 'null', label: 'idle', reason: 'start camera' }
    : !capture
      ? { tone: 'info', label: 'waiting', reason: 'first window' }
      : capture.timing?.source === 'unavailable'
        ? { tone: 'null', label: 'partial', reason: 'frame callback unsupported' }
        : droppedRatio != null && droppedRatio >= 0.25
          ? { tone: 'bad', label: 'poor delivery' }
          : droppedRatio != null && droppedRatio >= 0.1
            ? { tone: 'warn', label: 'degraded' }
            : { tone: 'ok', label: 'healthy' };

  const gazeFrames = finite(gaze?.total_frames);
  const gazeRate = finite(gaze?.observed_sample_rate_hz);
  const gazeState: { tone: Tone; label: string; reason?: string } = !runtime.settings.gaze_tracking_enabled
    ? { tone: 'null', label: 'off', reason: 'enable gaze' }
    : !runtime.cameraStream
      ? { tone: 'null', label: 'idle', reason: 'start camera' }
    : !gaze
      ? { tone: 'info', label: 'waiting', reason: 'first gaze window' }
      : (gazeFrames == null || gazeFrames < 2) && runtime.gazeSampleCount > 0
        ? { tone: 'info', label: 'next window', reason: 'live samples arriving' }
      : gazeRate != null && gaze.fixation_sampling_adequate === false
        ? { tone: 'warn', label: 'low cadence' }
        : gazeFrames != null && gazeFrames > 0 && finite(gaze.n_points) === 0
          ? { tone: 'bad', label: 'no points' }
          : { tone: 'ok', label: 'measuring' };

  const liveRespiration = runtime.lastRespiration;
  const liveRespirationPhase = respirationPhase(liveRespiration);
  const respirationState: { tone: Tone; label: string; reason?: string } = !runtime.settings.respiration_enabled
    ? { tone: 'null', label: 'off', reason: 'enable respiration' }
    : !runtime.cameraStream
      ? { tone: 'null', label: 'idle', reason: 'start camera' }
    : liveRespiration?.brpm != null
      ? liveRespiration.current === false
        ? { tone: 'warn', label: 'held', reason: 'current estimate unavailable; retaining the last reading' }
        : liveRespiration.qualityAccepted === false
          ? { tone: 'warn', label: 'low quality', reason: liveRespiration.statusReason ?? undefined }
          : liveRespiration.rgbCorroborationAvailable === true && liveRespiration.rgbCorroborationAgrees === false
            ? { tone: 'warn', label: 'RGB disagrees' }
            : { tone: 'ok', label: 'confirmed' }
      : liveRespirationPhase === 'confirming'
        ? { tone: 'info', label: 'confirming', reason: respirationStatusText(liveRespiration) }
        : liveRespirationPhase === 'unconfirmed'
          ? { tone: 'warn', label: 'unconfirmed', reason: respirationStatusText(liveRespiration) }
          : { tone: 'info', label: liveRespiration?.statusReason === 'sample_gap' ? 'rebuilding' : 'acquiring' };

  const respirationQualityLabel = liveRespirationPhase === 'confirming'
    ? 'Stability checks'
    : liveRespirationPhase === 'acquiring'
      ? 'Acquisition progress'
      : 'Estimate confidence';
  const respirationQuality = liveRespirationPhase === 'confirming'
    ? liveRespiration?.confirmationCount != null && liveRespiration.confirmationRequired
      ? liveRespiration.confirmationCount / liveRespiration.confirmationRequired
      : null
    : liveRespirationPhase === 'acquiring'
      ? finite(liveRespiration?.progress)
      : finite(respiration?.confidence_mean);

  const liveIllumination = runtime.lastIllumination;
  const illuminationAssessment = liveIllumination?.assessment
    ?? (typeof illumination?.assessment === 'string' ? illumination.assessment : null);
  const illuminationState: { tone: Tone; label: string; reason?: string } = !runtime.settings.illumination_enabled
    ? { tone: 'null', label: 'off', reason: 'enable lighting' }
    : !runtime.cameraStream
      ? { tone: 'null', label: 'idle', reason: 'start camera' }
      : illuminationAssessment == null
        ? { tone: 'info', label: 'waiting', reason: 'first lighting sample' }
        : illuminationAssessment === 'good'
          ? { tone: 'ok', label: 'good' }
          : { tone: 'warn', label: illuminationAssessment };

  const busy = runtime.status === 'initializing'
    || runtime.status === 'starting-camera'
    || runtime.status === 'stopping';
  const running = runtime.status === 'running';
  const paused = runtime.status === 'paused';

  const testAoisActive = TEST_AOIS.every((expected) =>
    configuredAois?.some((aoi) => aoi.id === expected.id),
  );

  function applyTestAois() {
    setBridge({ gazeAois: TEST_AOIS });
    bridgeControls?.setGazeAois?.(TEST_AOIS);
  }

  function clearTestAois() {
    setBridge({ gazeAois: null });
    bridgeControls?.setGazeAois?.([]);
  }

  const width = finite(cameraSettings?.width) ?? finite(capture?.timing?.frame_width);
  const height = finite(cameraSettings?.height) ?? finite(capture?.timing?.frame_height);
  const resolution = width != null && height != null ? `${width}×${height}` : null;
  const rgbAvailable = finite(respiration?.rgb_corroboration_available_ratio);
  const rgbAgreement = finite(respiration?.rgb_corroboration_agreement_ratio);
  const rawEvidence = latest
    ? {
        window_end: latest.window_end,
        capture_quality: capture,
        gaze,
        respiration,
        illumination,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Sensor diagnostics"
        description="Real-camera evidence for frame delivery, gaze events, breathing estimation and lighting quality. Results update at each aggregate window."
        actions={
          <StatusPill tone={running ? 'ok' : paused ? 'warn' : 'null'}>
            {runtime.status} · {runtime.windowCount} windows
          </StatusPill>
        }
      />

      <div className="flex flex-col gap-6">
        <Section
          id="diagnostics-run"
          title="Run the test"
          description="Start capture, keep steady for one window, then move your gaze left → centre → right. Breathing needs roughly 25–45 seconds."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => cameraDock.setVisible(true)}>
                <Camera className="size-3.5" aria-hidden="true" />
                Open preview
              </Button>
              {!running && !paused ? (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void runtime.start()}>
                  <Play className="size-3.5" aria-hidden="true" />
                  Start
                </Button>
              ) : null}
              {running ? (
                <Button size="sm" onClick={runtime.pause}>
                  <Pause className="size-3.5" aria-hidden="true" />
                  Pause
                </Button>
              ) : null}
              {paused ? (
                <Button variant="primary" size="sm" onClick={runtime.resume}>
                  <Play className="size-3.5" aria-hidden="true" />
                  Resume
                </Button>
              ) : null}
              {running || paused ? (
                <Button variant="danger" size="sm" onClick={() => void runtime.stop()}>
                  <Square className="size-3.5" aria-hidden="true" />
                  Stop
                </Button>
              ) : null}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Runtime" value={runtime.status} tone={running ? 'ok' : paused ? 'warn' : 'null'} />
            <Metric label="Camera stream" value={runtime.cameraStream ? 'connected' : null} tone={runtime.cameraStream ? 'ok' : 'null'} hint={runtime.cameraStream ? undefined : 'not started'} />
            <Metric label="Windows emitted" value={runtime.windowCount} tone={runtime.windowCount > 0 ? 'ok' : 'info'} />
            <Metric label="Latest evidence" value={ageLabel(latest)} tone={latest ? 'ok' : 'null'} hint={latest ? undefined : 'no window yet'} />
            <Metric label="Gaze samples" value={runtime.gazeSampleCount} tone={runtime.gazeSampleCount > 0 ? 'ok' : runtime.cameraStream ? 'info' : 'null'} />
            <Metric
              label="Breathing buffer"
              value={liveRespiration?.progress == null ? null : `${Math.round(liveRespiration.progress * 100)}%`}
              tone={liveRespiration?.ready ? 'ok' : runtime.settings.respiration_enabled && runtime.cameraStream ? 'info' : 'null'}
              hint={!runtime.settings.respiration_enabled ? 'disabled' : runtime.cameraStream ? 'waiting for samples' : 'start camera'}
            />
          </div>
        </Section>

        <Section
          id="diagnostics-results"
          title="Latest measured window"
          description="Four independent checks, aligned to the same emitted window. Missing values stay missing—they are never converted to zero."
        >
          <div className="grid items-stretch gap-4 xl:grid-cols-2">
            <Card className={RESULT_CARD_CLASS}>
              <CardHeader>
                <CardTitle>Camera delivery</CardTitle>
                <StatusPill tone={captureState.tone} reason={captureState.reason}>{captureState.label}</StatusPill>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-5 py-4">
                <PrimaryReading
                  label="Observed frame rate"
                  value={fixed(timing?.observed_fps, 1)}
                  unit="fps"
                  hint={fixed(cameraSettings?.frame_rate, 1) == null ? 'Awaiting selected camera settings' : `Selected ${fixed(cameraSettings?.frame_rate, 1)} fps`}
                />
                <QualityBar
                  label="Delivered against selected rate"
                  value={droppedRatio == null ? null : 1 - droppedRatio}
                  tone={captureState.tone}
                />
                <div className="mt-1">
                  <EvidenceRow label="Actual resolution" value={resolution} />
                  <EvidenceRow label="Decoded frames" value={finite(timing?.frames_observed)} />
                  <EvidenceRow label="Delivery shortfall" value={percent(droppedRatio, 1)} />
                  <EvidenceRow label="Frame jitter" value={fixed(timing?.frame_interval_ms_std, 1)} unit="ms" />
                  <EvidenceRow label="Largest gap" value={fixed(timing?.max_frame_gap_ms, 0)} unit="ms" />
                  <EvidenceRow label="Frame observer" value={frameObserverLabel(capture?.timing?.source)} />
                </div>
              </CardContent>
            </Card>

            <Card className={RESULT_CARD_CLASS}>
              <CardHeader>
                <CardTitle>Gaze events</CardTitle>
                <StatusPill tone={gazeState.tone} reason={gazeState.reason}>{gazeState.label}</StatusPill>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-5 py-4">
                <PrimaryReading
                  label="Observed gaze cadence"
                  value={fixed(gaze?.observed_sample_rate_hz, 1)}
                  unit="Hz"
                  hint={runtime.gazeSampleCount > 0 ? `${runtime.gazeSampleCount} live samples received` : 'No live samples yet'}
                />
                <QualityBar
                  label="Usable gaze frames"
                  value={finite(gaze?.valid_frame_ratio)}
                  tone={gazeState.tone}
                />
                <div className="mt-1 grid grid-cols-2 gap-x-5">
                  <EvidenceRow label="Window points" value={finite(gaze?.n_points)} />
                  <EvidenceRow label="Fixations" value={finite(gaze?.fixation_count)} />
                  <EvidenceRow label="Median fixation" value={fixed(gaze?.fixation_duration_ms_median, 0)} unit="ms" />
                  <EvidenceRow label="Scanpath" value={fixed(gaze?.scanpath_length, 3)} />
                  <EvidenceRow label="Largest gap" value={fixed(gaze?.max_observed_sample_gap_ms, 0)} unit="ms" />
                  <EvidenceRow label="AOI transitions" value={finite(gaze?.aoi_transition_count)} />
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-ink-1">
                      Left / centre / right AOIs
                      <StatusPill tone={testAoisActive ? 'ok' : 'null'} size="sm">
                        {testAoisActive ? 'active' : 'not applied'}
                      </StatusPill>
                    </div>
                    <div className="mt-0.5 truncate text-micro text-ink-3">Look across all three columns after applying.</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" onClick={applyTestAois}>
                      <Crosshair className="size-3.5" aria-hidden="true" />
                      Apply
                    </Button>
                    {testAoisActive ? <Button variant="ghost" size="sm" onClick={clearTestAois}>Clear</Button> : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={RESULT_CARD_CLASS}>
              <CardHeader>
                <CardTitle>Respiration</CardTitle>
                <StatusPill tone={respirationState.tone} reason={respirationState.reason}>{respirationState.label}</StatusPill>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-5 py-4">
                <PrimaryReading
                  label={liveRespiration?.brpm == null ? 'Breathing estimate' : 'Live breathing'}
                  value={fixed(liveRespiration?.brpm, 1)}
                  unit="br/min"
                  hint={liveRespiration?.brpm == null ? 'Requires roughly 25–45 seconds of steady video' : `Latest window ${fixed(respiration?.brpm_mean, 1) ?? '—'} br/min`}
                />
                <QualityBar
                  label={respirationQualityLabel}
                  value={respirationQuality}
                  tone={respirationState.tone}
                />
                <div className="mt-1 grid grid-cols-2 gap-x-5">
                  <EvidenceRow label="Window mean" value={fixed(respiration?.brpm_mean, 1)} unit="br/min" />
                  <EvidenceRow label="Sample rate" value={fixed(respiration?.sample_rate_hz ?? liveRespiration?.sampleRateHz, 1)} unit="Hz" />
                  <EvidenceRow label="Valid estimates" value={liveRespiration?.ready === true ? percent(respiration?.valid_frame_ratio, 0) : null} />
                  <EvidenceRow label="Largest gap" value={fixed(respiration?.max_sample_gap_ms, 0)} unit="ms" />
                  <EvidenceRow label="RGB available" value={percent(rgbAvailable, 0)} />
                  <EvidenceRow label="RGB agreement" value={percent(rgbAgreement, 0)} />
                </div>
                <p className="mt-auto mb-0 border-t border-line pt-3 text-micro leading-relaxed text-ink-3">
                  Motion-derived breathing is retained only when sampling is adequate; RGB agreement is corroboration, not a second estimate.
                </p>
              </CardContent>
            </Card>

            <Card className={RESULT_CARD_CLASS}>
              <CardHeader>
                <CardTitle>Lighting</CardTitle>
                <StatusPill tone={illuminationState.tone} reason={illuminationState.reason}>{illuminationState.label}</StatusPill>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-5 py-4">
                <PrimaryReading
                  label="Lighting assessment"
                  value={illuminationAssessment == null
                    ? null
                    : illuminationAssessment.charAt(0).toUpperCase() + illuminationAssessment.slice(1)}
                  hint="A quality covariate for heart rate, breathing and facial inference"
                />
                <QualityBar
                  label="Lighting quality"
                  value={liveIllumination?.quality ?? finite(illumination?.quality_mean)}
                  tone={illuminationState.tone}
                />
                <div className="mt-1 grid grid-cols-2 gap-x-5">
                  <EvidenceRow label="Mean exposure" value={percent(liveIllumination?.meanLuma ?? illumination?.mean_luma, 0)} />
                  <EvidenceRow label="Stability" value={percent(illumination?.stability, 0)} />
                  <EvidenceRow label="Temporal variation" value={fixed(illumination?.luma_temporal_std, 3)} />
                  <EvidenceRow label="Minimum quality" value={percent(illumination?.quality_min, 0)} />
                  <EvidenceRow label="Dark clipping" value={percent(liveIllumination?.clippedLow ?? illumination?.clipped_low, 0)} />
                  <EvidenceRow label="Bright clipping" value={percent(liveIllumination?.clippedHigh ?? illumination?.clipped_high, 0)} />
                </div>
                <p className="mt-auto mb-0 border-t border-line pt-3 text-micro leading-relaxed text-ink-3">
                  Unstable brightness is especially harmful to webcam pulse and breathing estimates; dim or clipped frames also reduce facial detail.
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <SignalEventsSection />

        <Section
          id="diagnostics-evidence"
          title="Raw evidence"
          description="The exact aggregate blocks behind the cards, useful when checking host transport or a stored session."
          actions={
            <Link to="/settings" className="text-xs font-medium text-status-info hover:underline">
              Change sensing settings
            </Link>
          }
        >
          <details className="rounded-lg border border-line bg-surface-1">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-1">
              Show latest diagnostic payload
            </summary>
            <pre className="m-0 max-h-[32rem] overflow-auto border-t border-line bg-surface-0 p-4 text-mini leading-relaxed text-ink-2">
              {rawEvidence ? JSON.stringify(rawEvidence, null, 2) : 'No aggregate window has been emitted yet.'}
            </pre>
          </details>
        </Section>
      </div>
    </>
  );
}

export const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/diagnostics',
  component: DiagnosticsView,
});
