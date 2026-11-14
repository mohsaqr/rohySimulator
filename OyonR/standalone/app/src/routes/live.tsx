import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Keyboard, Mic } from 'lucide-react';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Section } from '@/components/ui/Section';
import { Metric, type MetricTone } from '@/components/ui/Metric';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { TypingTestModal } from '@/components/typing/TypingTestModal';
import { VoiceTestModal } from '@/components/voice/VoiceTestModal';
import { useVoiceEnabled } from '@/components/voice/useVoiceTest';
import { useRuntime } from '@/lib/RuntimeProvider';
import { AffectPad } from '@/components/charts/AffectPad';
import { EmotionTimeline } from '@/components/charts/EmotionTimeline';
import { LiveGazeHeatmap } from '@/components/charts/LiveGazeHeatmap';
import {
  LiveHeartRateTile,
  LiveHeadPoseTile,
  LivePostureTile,
} from '@/components/live/LiveSignals';
import { cn } from '@/lib/cn';
import { symmetricColumns } from '@/lib/gridColumns';
import { vitalTone } from '@/lib/vitalsTone';
import { emotionColor } from '@/lib/emotionColors';
import { deriveFrameQuality } from '@/lib/frameQuality';

/*
 * Every card in the two 3-up grids shares one height, so Signals and Structure
 * read as one uniform grid rather than two rows of different depths. `h-full`
 * makes the card fill its (stretched) grid cell and the min-height sets the
 * common floor; CARD_BODY lets the content area absorb the slack.
 *
 * The floor must sit AT the tallest natural content, not below it: a shorter
 * floor lets the taller row grow past it, which is the ragged layout this
 * replaces. It must also stay TIGHT, because every tile pays for it — an
 * over-tall floor turns each card into a mostly-empty box. So the tiles fill
 * their height (centre or distribute) rather than pooling at the top, and the
 * floor is only as tall as the affect pad actually needs.
 */
const CARD = 'flex h-full min-h-[19rem] flex-col';
const CARD_BODY = 'flex-1 min-h-0';

/* The top pair — "Now" and the attention heatmap — is taller than the 3-up
 * tiles because both carry a primary visual, but the two share one height with
 * each other so they read as a matched pair. */
/* Number of tiles in the Window-summary band. Kept next to the grid so the
 * column count and the tile count cannot drift apart. */
const SUMMARY_TILES = 9;

const PAIR = 'flex h-full min-h-[24rem] flex-col';
const PAIR_BODY = 'flex-1 min-h-0';

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
    lastFacial,
    lastPosture,
    lastHeartRate,
    lastRespiration,
    lastIllumination,
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
    sessionId,
  } = useRuntime();
  const cameraRunning = status === 'running';
  // Typing test modal — a diagnostic tool for the typing pipeline; mounting
  // the modal starts an episode, unmounting tears it down (see the component).
  const [typingTestOpen, setTypingTestOpen] = useState(false);
  // Voice test modal — the voice pipeline's diagnostic tool. Opening the
  // dialog touches NO microphone: recording sits behind the library's
  // activation gate (voice_enabled + host + per-turn user action), enforced
  // and explained inside the modal. The button badge shows the gate state so
  // it is obvious BEFORE opening why recording will be unavailable.
  const [voiceTestOpen, setVoiceTestOpen] = useState(false);
  const voiceEnabled = useVoiceEnabled();

  // The attention heatmap is always on. It used to be behind an opt-in toggle,
  // which the project data policy explicitly forbids ("No signal gates. No
  // opt-in flags, no default-off events") — consent is handled outside the app,
  // and this is display-only anyway: nothing here is stored or transmitted.

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
  // Window-level sensing blocks. Typed loosely because the hand-written
  // EmotionWindow .d.ts predates the v3 pipelines (see types/index.d.ts).
  const windowHeartRate = (lastWindow as { heart_rate?: {
    bpm_tracked?: number | null;
    bpm_robust?: number | null;
    bpm_mean?: number | null;
    confidence_mean?: number | null;
    analysis_window_seconds?: number | null;
  } } | null)
    ?.heart_rate ?? null;
  const windowFacial = (lastWindow as { facial?: { facing_screen_ratio?: number | null } } | null)
    ?.facial ?? null;
  const windowRespiration = (lastWindow as { respiration?: {
    brpm_mean?: number | null;
    confidence_mean?: number | null;
    analysis_window_seconds?: number | null;
  } } | null)
    ?.respiration ?? null;
  // Plausibility bands, read off the live settings object (falling back to the
  // documented defaults) so display colour and estimator behaviour agree.
  const rs = settings as unknown as Record<string, unknown>;
  const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const hrBand = {
    min: numOr(rs.heart_rate_plausible_min_bpm, 60),
    max: numOr(rs.heart_rate_plausible_max_bpm, 100),
  };
  const brBand = {
    min: numOr(rs.respiration_plausible_min_brpm, 9),
    max: numOr(rs.respiration_plausible_max_brpm, 24),
  };
  // Heart rate shows BOTH estimators rather than substituting one for the
  // other. `lastHeartRate` is the per-sample reading (~1 Hz, ~12 s
  // integration); `trackedHeartBpm` is the cross-window value Analyze stores.
  // Overwriting the per-sample BPM with the tracked one — as this did — made
  // the two indistinguishable under one "live" heading, and left the beat
  // animation pulsing at the tracked rate. The gap between them is not noise:
  // the tracker's anchor is a trailing median over trackerWindows x the
  // aggregate window, so it necessarily reads low while the rate is climbing.
  const trackedHeartBpm = windowHeartRate?.bpm_tracked
    ?? windowHeartRate?.bpm_robust
    ?? windowHeartRate?.bpm_mean
    ?? null;
  // State the anchor's span instead of leaving the lag to be inferred.
  const trackedHeartSpanSeconds = (numOr(rs.heart_rate_tracker_windows, 9)
    * numOr(rs.aggregate_window_ms, 10000)) / 1000;
  const displayedRespiration = lastRespiration && windowRespiration?.brpm_mean != null
    ? {
        ...lastRespiration,
        brpm: windowRespiration.brpm_mean,
        confidence: windowRespiration.confidence_mean ?? lastRespiration.confidence,
        windowSeconds: windowRespiration.analysis_window_seconds ?? lastRespiration.windowSeconds,
      }
    : lastRespiration;
  const dominantPct = lastWindow
    ? Math.max(...Object.values(lastWindow.probabilities ?? {}))
    : null;
  const validFrameRatio = deriveFrameQuality(lastWindow).ratio;

  return (
    <>
      <PageHeader
        title="Live"
        description="Watch the signal as it streams. Engagement KPIs, current prediction, and a spatial gaze tile."
        actions={
          // flex-wrap: these three controls are 261 px together, which does not
          // fit beside the title on a phone. PageHeader's own action slot wraps,
          // but this nested row has to wrap too or it just overflows as a unit.
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTypingTestOpen(true)}>
              <Keyboard className="size-3.5" aria-hidden="true" />
              Test typing
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVoiceTestOpen(true)}
              title={
                voiceEnabled
                  ? 'Open the voice pipeline diagnostic (recording starts only from the dialog)'
                  : 'voice_enabled is off — the dialog explains the gate and holds the explicit enable control; no microphone is touched until enabled AND started'
              }
            >
              <Mic className="size-3.5" aria-hidden="true" />
              Test voice{voiceEnabled ? '' : ' (disabled)'}
            </Button>
            <StatusPill tone={statusTone(status)} size="md">
              {status} · {windowCount} window{windowCount === 1 ? '' : 's'}
            </StatusPill>
          </div>
        }
      />

      {typingTestOpen ? (
        <TypingTestModal sessionId={sessionId} onClose={() => setTypingTestOpen(false)} />
      ) : null}

      {voiceTestOpen ? (
        <VoiceTestModal sessionId={sessionId} onClose={() => setVoiceTestOpen(false)} />
      ) : null}

      <div className="flex flex-col gap-6">
        {/* The two live-stream views, paired: WHAT the affect is right now and
            WHERE attention has pooled. Equal columns, one shared height. */}
        <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-sample live readout — updates ~1Hz, far faster than 10s windows. */}
        <Card className={PAIR}>
          <CardHeader>
            <CardTitle>Now (per-sample, ~1Hz)</CardTitle>
            <StatusPill tone={lastPrediction ? 'ok' : 'null'} reason={lastPrediction ? undefined : 'waiting for first sample'}>
              {lastPrediction
                ? `${lastPrediction.label} · ${(lastPrediction.confidence * 100).toFixed(0)}%`
                : 'no sample'}
            </StatusPill>
          </CardHeader>
          <CardContent className={`${PAIR_BODY} space-y-3`}>
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
                {lastGaze.quality.toFixed(2)} · {gazeSampleCount} samples
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

        <Card className={PAIR}>
          <CardHeader>
            <CardTitle>Live attention heatmap</CardTitle>
            <StatusPill tone={cameraRunning || mockGaze ? 'ok' : 'null'} reason={cameraRunning || mockGaze ? undefined : 'no gaze stream'}>
              {cameraRunning || mockGaze ? 'accumulating' : 'idle'}
            </StatusPill>
          </CardHeader>
          <CardContent className={`${PAIR_BODY} flex flex-col gap-2`}>
            <LiveGazeHeatmap className="min-h-0 flex-1" />
            <div className="flex flex-wrap items-center gap-2 text-mini text-ink-3">
              {gazeDiag?.error ? (
                <span className="text-status-bad">
                  ⚠ gaze adapter failed: {gazeDiag.error} — use “Demo gaze stream” meanwhile
                </span>
              ) : cameraRunning ? (
                <span className="text-status-ok">● live webcam gaze — no calibration needed for the heatmap</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void start();
                    }}
                    className="rounded border border-line bg-surface-1 px-2 py-1 font-medium text-ink-1 hover:bg-surface-2"
                  >
                    ▶ Start camera
                  </button>
                  <span>or use “Demo gaze stream” in the Live gaze card</span>
                </>
              )}
              <span className="ml-auto">in-tab only · not stored, not sent</span>
            </div>
          </CardContent>
        </Card>
        </div>

        <Section
          id="live-signals"
          title="Signals (per-sample)"
          description="The v3 learner-facing signals as they stream: rPPG heart rate and breathing (one ROI colour signal, two bands), head pose + action units, and body posture. Sensor-quality checks, including lighting, live on Test."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Card className={CARD}>
              <CardHeader>
                <CardTitle>Heart rate &amp; breathing</CardTitle>
              </CardHeader>
              <CardContent className={CARD_BODY}>
                <LiveHeartRateTile
                  enabled={Boolean(settings.heart_rate_enabled)}
                  active={cameraRunning}
                  sample={lastHeartRate}
                  trackedBpm={trackedHeartBpm}
                  trackedSpanSeconds={trackedHeartSpanSeconds}
                  respirationEnabled={Boolean(settings.respiration_enabled)}
                  respiration={displayedRespiration}
                  lighting={lastIllumination?.assessment ?? null}
                  // Bands come from the RUNTIME settings, so the colour matches
                  // the prior the tracker actually applies rather than a
                  // hardcoded copy that could silently drift from it.
                  plausibleMinBpm={hrBand.min}
                  plausibleMaxBpm={hrBand.max}
                  plausibleMinBrpm={brBand.min}
                  plausibleMaxBrpm={brBand.max}
                />
              </CardContent>
            </Card>
            <Card className={CARD}>
              <CardHeader>
                <CardTitle>Head pose &amp; action units</CardTitle>
                <StatusPill
                  tone={lastFacial?.valid ? 'ok' : 'null'}
                  reason={settings.facial_signals_enabled ? undefined : 'disabled in Settings'}
                >
                  {settings.facial_signals_enabled
                    ? lastFacial?.valid ? 'live' : 'no face'
                    : 'off'}
                </StatusPill>
              </CardHeader>
              <CardContent className={CARD_BODY}>
                <LiveHeadPoseTile
                  enabled={Boolean(settings.facial_signals_enabled)}
                  sample={lastFacial}
                />
              </CardContent>
            </Card>
            <Card className={CARD}>
              <CardHeader>
                <CardTitle>Body posture</CardTitle>
                <StatusPill
                  tone={lastPosture?.valid ? 'ok' : 'null'}
                  reason={settings.posture_tracking_enabled ? undefined : 'disabled in Settings'}
                >
                  {settings.posture_tracking_enabled
                    ? lastPosture?.valid ? 'live' : 'no torso'
                    : 'off'}
                </StatusPill>
              </CardHeader>
              <CardContent className={CARD_BODY}>
                <LivePostureTile
                  enabled={Boolean(settings.posture_tracking_enabled)}
                  sample={lastPosture}
                />
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="live-summary"
          title="Window summary (every 10s)"
          description="At-a-glance signal health for the most recent aggregate window."
        >
          {/* 10 tiles -> 5 columns x 2 full rows. Derived, not hardcoded: a
              fixed column count goes ragged the moment a tile is added. */}
          <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', symmetricColumns(SUMMARY_TILES))}>
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
            {/* Window-level BPM is the number to trust: cross-window tracked,
                plausibility-gated. The per-sample tile above is the raw feed. */}
            <Metric
              label="BPM (tracked)"
              value={windowHeartRate?.bpm_tracked ?? null}
              format={(v) => v.toFixed(0)}
              hint={
                windowHeartRate?.bpm_tracked == null && windowHeartRate != null
                  ? 'settling'
                  : 'cross-window'
              }
              tone={vitalTone({
                value: windowHeartRate?.bpm_tracked,
                confidence: 1, // the tracked value is already quality-gated upstream
                min: hrBand.min,
                max: hrBand.max,
              }).tone}
              reason={settings.heart_rate_enabled ? reason : 'heart rate disabled'}
            />
            <Metric
              label="Facing screen"
              value={windowFacial?.facing_screen_ratio ?? null}
              unit="%"
              format={(v) => `${(v * 100).toFixed(0)}`}
              tone={windowFacial?.facing_screen_ratio == null ? 'null' : 'info'}
              reason={settings.facial_signals_enabled ? reason : 'facial signals disabled'}
            />
            <Metric
              label="Breaths / min"
              value={windowRespiration?.brpm_mean ?? null}
              format={(v) => v.toFixed(1)}
              hint={windowRespiration?.brpm_mean == null ? 'acquiring (~25s)' : 'low band of rPPG'}
              tone={vitalTone({
                value: windowRespiration?.brpm_mean,
                confidence: 1,
                min: brBand.min,
                max: brBand.max,
              }).tone}
              reason={settings.respiration_enabled ? reason : 'respiration disabled'}
            />
            <Metric
              label="Windows"
              value={windowCount}
              hint="this session"
            />
          </div>
        </Section>

        <Section
          id="live-structure"
          title="Structure"
          description="Affect pad shows the valence / arousal trajectory. Probability bars and gaze tile sit beside it."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className={CARD}>
              <CardHeader>
                <CardTitle>Affect pad</CardTitle>
              </CardHeader>
              <CardContent className={`${CARD_BODY} flex items-center justify-center`}>
                <AffectPad recentWindows={recentWindows} size={210} />
              </CardContent>
            </Card>
            <Card className={CARD}>
              <CardHeader>
                <CardTitle>Latest distribution</CardTitle>
              </CardHeader>
              <CardContent className={CARD_BODY}>
                {lastWindow ? (
                  <ProbBars probabilities={lastWindow.probabilities ?? {}} fill />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState title="No window yet" description="Probability distribution renders once the first window emits." />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className={CARD}>
              <CardHeader>
                <CardTitle>Live gaze</CardTitle>
              </CardHeader>
              <CardContent className={CARD_BODY}>
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

        {/* Last on the page: the timeline is the session-scale retrospective,
            so it reads as a footer under the live tiles rather than
            interrupting them. Full width — a strip has no useful neighbour. */}
        <Section
          id="live-trend"
          title="Trend"
          description="Last 60 windows on a time axis, newest on the right. Bar color = dominant emotion; bar height = confidence. Dropped windows leave gaps."
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

function ProbBars({ probabilities, fill }: { probabilities: Record<string, number>; fill?: boolean }) {
  const entries = Object.entries(probabilities)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return (
    <ul
      className={cn('flex flex-col gap-1.5', fill && 'h-full justify-around gap-0')}
      role="list"
    >
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
      className="rounded border border-line bg-surface-1 px-2 py-1 text-mini font-medium text-ink-1 hover:bg-surface-2"
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
      <div className="flex h-full flex-col justify-center gap-2 text-sm text-ink-2">
        <div className="text-xs uppercase tracking-wider text-ink-3">Gaze tracking off</div>
        <div>Enable it in Settings → Inference — or preview the dot with a synthetic stream:</div>
        <MockGazeToggle mockGaze={mockGaze} onToggleMock={onToggleMock} />
      </div>
    );
  }
  // Live gaze sample: normalized [-0.5, 0.5] coords onto the viewport preview.
  //
  // The preview fills the card width and the readouts sit BELOW it. The old
  // side-by-side layout hardcoded a 240px preview, which in a 3-up card left
  // ~58px for the value column — every reading truncated to a single character
  // ("QUALITY 1", "STATE o…"). Percentage positioning also makes the dot
  // correct at any card width, which fixed pixel maths never was.
  return (
    <div className="flex h-full flex-col gap-2">
      <div
        className="relative min-h-[110px] flex-1 overflow-hidden rounded border border-line bg-surface-3"
        aria-label="Live gaze position"
      >
        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line/60" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-line/60" />
        </div>
        {lastGaze ? (
          <div
            className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${Math.max(0, Math.min(1, 0.5 + lastGaze.x)) * 100}%`,
              top: `${Math.max(0, Math.min(1, 0.5 + lastGaze.y)) * 100}%`,
              background: lastGaze.quality > 0.5 ? 'var(--status-ok)' : 'var(--status-warn)',
              boxShadow: '0 0 0 4px rgba(0,0,0,0.05)',
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-xs">
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
      <div className="flex items-center gap-2">
        <MockGazeToggle mockGaze={mockGaze} onToggleMock={onToggleMock} />
        {mockGaze ? (
          <span className="text-mini text-ink-3">synthetic</span>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line py-1 last:border-b-0">
      <span className="label-eyebrow">{label}</span>
      <span className="font-medium tabular-nums text-ink-0 truncate">{value}</span>
    </div>
  );
}

export const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: LivePage,
});
