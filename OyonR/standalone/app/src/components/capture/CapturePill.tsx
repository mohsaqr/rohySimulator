import { useRef, useState } from 'react';
import { Camera, Pause, Play, Square, ExternalLink, Loader2, Crosshair } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { GazeCalibrationPanel } from 'oyon/react/gaze-calibration';
import type {
  GazeCalibrationCompleteDetail,
  GazeCalibrationPanelHandle,
} from 'oyon/react/gaze-calibration';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useSessionContext } from '@/lib/sessionContext';

/*
 * CapturePill — the canonical Oyon capture control, rendered as the sole UI in
 * `chrome="capture"` mode. Ported faithfully from chatoyon-plus
 * `src/components/sensing/SensingPill.tsx` (itself the Rohy OyonCaptureWidget):
 * a constant dark-glass badge (`bg-black/40 text-cyan-50 border-white/10`)
 * where only the status dot changes color per emotion (`emotionTone`); a
 * headline (dominant / "camera…" / "Ready" / "Error"); a confidence %;
 * capture controls (Start when idle, else Pause/Resume + Stop); a Calibrate
 * crosshair while active; and an external-link.
 *
 * Ported from chatoyon's `SensingPill`; the badge, `IconBtn`, and `emotionTone`
 * are verbatim. Differences from the original, all intentional:
 *   - data source is Oyon's REAL `useRuntime()` (NOT the chrome="none" viewer
 *     stub), not chatoyon's `useSensingStore`/`useAppStore`;
 *   - the ↗ routes to the in-element Analyze view (`<Link to="/analyze">`),
 *     not a static dashboard tab;
 *   - gaze calibration is wired through `GazeCalibrationPanel` here, where the
 *     original deferred to a separate modal;
 *   - the original's "Off" / `disabled` headline is dropped — Oyon's
 *     RuntimeStatus has no `disabled` state.
 */

// IconBtn — verbatim from the chatoyon/Rohy OyonCaptureWidget.IconBtn.
function IconBtn({
  children, onClick, disabled, title, danger,
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'text-red-200 hover:bg-red-500/20' : 'hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  );
}

export function CapturePill() {
  const {
    status,
    error,
    lastPrediction,
    gazeSampleCount,
    gazeDiag,
    runtime,
    start,
    pause,
    resume,
    stop,
  } = useRuntime();
  // Calibration provenance lives in the session-context store (set by the
  // calibration panel's onComplete), so the crosshair can show "calibrated"
  // vs. "calibrate" exactly like chatoyon's gazeCalibrated flag.
  const calibration = useSessionContext((s) => s.calibration);
  const setSessionContext = useSessionContext((s) => s.setContext);
  const gazeCalibrated = calibration.status === 'ok';

  // Full-screen calibration overlay — always mounted so the imperative ref is
  // ready; the crosshair drives panelRef.current.start(runtime). Same wiring
  // as CalibrationSection.
  const panelRef = useRef<GazeCalibrationPanelHandle>(null);
  const [calibrating, setCalibrating] = useState(false);

  // Map Oyon's RuntimeStatus to the pill's chatoyon states.
  //   running/paused → active ; running → liveNow ; paused → paused ;
  //   initializing/starting-camera → starting ; idle/ready/stopping/stopped →
  //   the "Ready" (waiting-to-start) headline.
  const active = status === 'running' || status === 'paused';
  const paused = status === 'paused';
  const liveNow = status === 'running';
  const starting = status === 'initializing' || status === 'starting-camera';
  const dom = lastPrediction?.label ?? null;
  const conf =
    typeof lastPrediction?.confidence === 'number'
      ? Math.round(lastPrediction.confidence * 100)
      : null;
  const tone = emotionTone(dom, liveNow);
  const errMsg = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null;

  // headlineText — Rohy's wording (OyonCaptureWidget liveWord/headlineText).
  const headlineText = status === 'error'
    ? 'Error'
    : active ? (dom || '…')
      : starting ? 'camera…'
        : 'Ready'; // idle / ready / stopping / stopped — waiting to (re)start capture

  async function handleCalibrate() {
    if (!panelRef.current || !runtime) return;
    setCalibrating(true);
    try {
      await panelRef.current.start(runtime);
    } finally {
      setCalibrating(false);
    }
  }

  function handleCalibrationComplete(detail: GazeCalibrationCompleteDetail) {
    if (!detail.ok) return;
    const quality = typeof detail.quality === 'number' ? detail.quality : null;
    setSessionContext({
      calibration:
        quality != null ? { status: 'ok', quality, ageMs: 0 } : { status: 'never' },
    });
  }

  // captureControls — verbatim shape from Rohy: a Start button when not
  // running, else a pause/resume toggle + a danger stop.
  const captureControls = !active ? (
    <IconBtn onClick={() => void start()} disabled={starting} title="Start capture">
      {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
    </IconBtn>
  ) : (
    <>
      <IconBtn onClick={() => (paused ? resume() : pause())} title={paused ? 'Resume' : 'Pause'}>
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </IconBtn>
      <IconBtn onClick={() => void stop()} title="Stop" danger>
        <Square className="h-4 w-4" />
      </IconBtn>
    </>
  );

  // One discriminator drives both the gaze tooltip and the icon tone so the
  // two can never drift apart — mapped from Oyon's gazeDiag + sample count.
  const gazeState = gazeDiag?.error != null
    ? 'error'
    : gazeSampleCount > 0
      ? 'active'
      : gazeDiag && gazeDiag.status && gazeDiag.status !== 'inference'
        ? 'no-signal'
        : 'waiting';
  const gazeTitle = {
    error: `Gaze error: ${gazeDiag?.error}`,
    active: `Gaze active: ${gazeSampleCount} samples`,
    'no-signal': `Gaze running: adapter status "${gazeDiag?.status}", no usable sample yet.`,
    waiting: `Gaze status: ${gazeDiag?.status ?? 'waiting'}`,
  }[gazeState];
  const gazeTone = {
    error: 'text-red-300',
    active: 'text-emerald-300',
    'no-signal': 'text-amber-300',
    waiting: gazeCalibrated ? '' : 'text-cyan-300',
  }[gazeState];

  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full border py-2 pl-3 pr-1.5 text-sm text-cyan-50 ${
        status === 'error' ? 'border-red-500/50 bg-red-950/40' : 'border-white/10 bg-black/40'
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${liveNow ? 'animate-pulse' : ''}`}
        style={{ background: status === 'error' ? '#f87171' : tone.dot }}
      />
      <span title={errMsg ?? ''} className="max-w-[110px] truncate font-semibold capitalize leading-none tracking-wide">
        {headlineText}
      </span>
      {active && conf != null && (
        <span className="shrink-0 text-xs leading-none tabular-nums text-cyan-100/70">{conf}%</span>
      )}
      {captureControls}
      {/* Manual gaze calibration — only while capture is live (the overlay
          needs the running runtime). Highlighted until calibrated; opt-in. */}
      {active && (
        <IconBtn
          onClick={handleCalibrate}
          disabled={calibrating || !runtime}
          title={gazeCalibrated ? `Re-calibrate gaze. ${gazeTitle}` : `Calibrate gaze tracking. ${gazeTitle}`}
        >
          {calibrating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Crosshair className={`h-4 w-4 ${gazeTone}`} />
          )}
        </IconBtn>
      )}
      {/* The ↗ in chatoyon opened a static dashboard tab; in-element we route
          to the embedded Analyze view instead (host-reachable via `page`). */}
      <Link
        to="/analyze"
        title="Open Oyon analytics for this session"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-cyan-100/80 hover:bg-white/10"
      >
        <ExternalLink className="h-4 w-4" />
      </Link>
      {/* Full-screen overlay panel — mounted always so the imperative ref is
          available the moment the crosshair is pressed. */}
      <GazeCalibrationPanel
        ref={panelRef}
        runtime={runtime}
        onComplete={handleCalibrationComplete}
      />
    </span>
  );
}

// Verbatim from the chatoyon/Rohy OyonCaptureWidget.emotionTone — drives only
// the dot color in the compact pill (the container stays dark glass).
function emotionTone(emotion: string | null, live: boolean) {
  const fallback = { dot: '#9ca3af' };
  if (!live) return fallback;
  const e = String(emotion || '').toLowerCase();
  const map: Record<string, { dot: string }> = {
    happy: { dot: '#34d399' },
    sad: { dot: '#60a5fa' },
    angry: { dot: '#f87171' },
    anger: { dot: '#f87171' },
    fear: { dot: '#fbbf24' },
    surprise: { dot: '#e879f9' },
    contempt: { dot: '#fda4af' },
    disgust: { dot: '#a3e635' },
    neutral: { dot: '#22d3ee' },
  };
  return map[e] || map.neutral;
}
