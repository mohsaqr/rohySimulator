import { useMemo, useRef, useState } from 'react';
import { Camera, Pause, Play, Square, ExternalLink, Loader2, Crosshair } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { GazeCalibrationPanel } from 'oyon/react/gaze-calibration';
import type {
  GazeCalibrationCompleteDetail,
  GazeCalibrationPanelHandle,
} from 'oyon/react/gaze-calibration';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useBridge } from '@/lib/hostBridge';
import { useSessionContext } from '@/lib/sessionContext';
import { formatPillString, pillEmotionLabel, pillStrings } from '@/lib/pillStrings';

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
 *   - the ↗ routes to the in-element Analyze view when analytics are present,
 *     or emits `oyon:open-analytics` in pill-only mode so the host can open a
 *     current-session viewer;
 *   - gaze calibration is wired through `GazeCalibrationPanel` here, where the
 *     original deferred to a separate modal;
 *   - the original's "Off" / `disabled` headline is dropped — Oyon's
 *     RuntimeStatus has no `disabled` state;
 *   - every string comes from src/lib/pillStrings.js in the host's `lang`
 *     (with `labels` overrides), read from the bridge — never from the
 *     runtime — so a language switch re-renders text without restarting
 *     capture;
 *   - accessibility: the pill is a labelled group; every control has an
 *     accessible name (aria-label; the title stays as the hover tooltip and
 *     accessible description), its icon is aria-hidden, and an unavailable
 *     control is aria-disabled but still focusable, so a keyboard or screen
 *     reader user can reach it and hear why it is unavailable; buttons draw
 *     their own high-contrast focus ring (`.oyon-pill-focus`, globals.css),
 *     because the global blue ring is lost against the dark glass; the
 *     headline is a polite live region announcing Ready / Camera… / Error
 *     and, while capturing, a stable "Capturing" / "Paused" — the live
 *     emotion word itself is aria-hidden so it never chatters.
 */

// IconBtn — shape from the chatoyon/Rohy OyonCaptureWidget.IconBtn, made
// accessible: `label` is the accessible name (required — an icon-only button
// has no other), `title` the tooltip/description (defaults to the label), and
// `disabled` maps to aria-disabled rather than the native attribute, so the
// control stays in the tab order and announces itself as unavailable instead
// of silently vanishing. Clicks while disabled are swallowed here.
function IconBtn({
  children, onClick, disabled, label, title, danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  label: string;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      title={title ?? label}
      className={`oyon-pill-focus grid h-7 w-7 shrink-0 place-items-center rounded-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${
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
    sessionId,
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
  const chromeMode = useBridge((s) => s.chromeMode);
  const userId = useBridge((s) => s.userId);
  const emitHostEvent = useBridge((s) => s.emitHostEvent);
  // Presentation-only bridge fields: a host changing `lang` / `labels`
  // re-renders this component and nothing else — the runtime never reads
  // them, so capture keeps running.
  const lang = useBridge((s) => s.lang);
  const labels = useBridge((s) => s.labels);
  const t = useMemo(() => pillStrings(lang, labels), [lang, labels]);
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

  // headlineText — Rohy's states (OyonCaptureWidget liveWord/headlineText),
  // localised. idle / ready / stopping / stopped → "Ready" (waiting to
  // (re)start capture).
  const headlineText = status === 'error'
    ? t.error
    : active ? (dom ? pillEmotionLabel(t, dom) : '…')
      : starting ? t.starting
        : t.ready;
  // While capturing, the visible headline is the live emotion word, which can
  // change every few hundred ms. Screen readers get a stable status instead.
  const liveStatusText = paused ? t.paused : t.capturing;

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

  function handleOpenAnalytics() {
    if (!sessionId) return;
    emitHostEvent?.('oyon:open-analytics', { sessionId, userId });
  }

  // captureControls — verbatim shape from Rohy: a Start button when not
  // running, else a pause/resume toggle + a danger stop.
  const captureControls = !active ? (
    <IconBtn
      onClick={() => void start()}
      disabled={starting}
      label={starting ? t.startingCapture : t.startCapture}
    >
      {starting
        ? <Loader2 aria-hidden="true" focusable="false" className="h-4 w-4 animate-spin" />
        : <Camera aria-hidden="true" focusable="false" className="h-4 w-4" />}
    </IconBtn>
  ) : (
    <>
      <IconBtn
        onClick={() => (paused ? resume() : pause())}
        label={paused ? t.resumeCapture : t.pauseCapture}
      >
        {paused
          ? <Play aria-hidden="true" focusable="false" className="h-4 w-4" />
          : <Pause aria-hidden="true" focusable="false" className="h-4 w-4" />}
      </IconBtn>
      <IconBtn onClick={() => void stop()} label={t.stopCapture} danger>
        <Square aria-hidden="true" focusable="false" className="h-4 w-4" />
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
    error: formatPillString(t.gazeError, { error: String(gazeDiag?.error) }),
    active: formatPillString(t.gazeActive, { count: gazeSampleCount }),
    'no-signal': formatPillString(t.gazeNoSignal, { status: gazeDiag?.status }),
    waiting: formatPillString(t.gazeWaiting, { status: gazeDiag?.status ?? t.gazeWaitingStatus }),
  }[gazeState];
  const calibrateLabel = calibrating
    ? t.calibratingGaze
    : gazeCalibrated ? t.recalibrateGaze : t.calibrateGaze;
  const analyticsLabel = sessionId ? t.openAnalytics : t.openAnalyticsUnavailable;
  const gazeTone = {
    error: 'text-red-300',
    active: 'text-emerald-300',
    'no-signal': 'text-amber-300',
    waiting: gazeCalibrated ? '' : 'text-cyan-300',
  }[gazeState];

  return (
    <span
      role="group"
      aria-label={t.pillLabel}
      lang={lang}
      className={`inline-flex w-fit items-center gap-2 rounded-full border py-2 pl-3 pr-1.5 text-sm text-cyan-50 ${
        status === 'error' ? 'border-red-500/50 bg-red-950/40' : 'border-white/10 bg-black/40'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${liveNow ? 'animate-pulse' : ''}`}
        style={{ background: status === 'error' ? '#f87171' : tone.dot }}
      />
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        title={errMsg ?? undefined}
        className="max-w-[110px] truncate font-semibold capitalize leading-none tracking-wide"
      >
        <span aria-hidden={active ? true : undefined}>{headlineText}</span>
        {active && <span className="sr-only">{liveStatusText}</span>}
      </span>
      {active && conf != null && (
        <span aria-hidden="true" className="shrink-0 text-xs leading-none tabular-nums text-cyan-100/70">{conf}%</span>
      )}
      {captureControls}
      {/* Manual gaze calibration — only while capture is live (the overlay
          needs the running runtime). Highlighted until calibrated; opt-in. */}
      {active && (
        <IconBtn
          onClick={handleCalibrate}
          disabled={calibrating || !runtime}
          label={calibrateLabel}
          title={`${calibrateLabel}. ${gazeTitle}`}
        >
          {calibrating ? (
            <Loader2 aria-hidden="true" focusable="false" className="h-4 w-4 animate-spin" />
          ) : (
            <Crosshair aria-hidden="true" focusable="false" className={`h-4 w-4 ${gazeTone}`} />
          )}
        </IconBtn>
      )}
      {/* Pill-only mode has no analytics outlet, so ask the host to open one
          and include the exact active session. Combined/full modes navigate
          internally; their dashboards are session-locked in embed mode. */}
      {chromeMode === 'capture' ? (
        <IconBtn
          onClick={handleOpenAnalytics}
          disabled={!sessionId}
          label={analyticsLabel}
        >
          <ExternalLink aria-hidden="true" focusable="false" className="h-4 w-4" />
        </IconBtn>
      ) : (
        <Link
          to="/analyze"
          aria-label={t.openAnalytics}
          title={t.openAnalytics}
          className="oyon-pill-focus grid h-7 w-7 shrink-0 place-items-center rounded-full text-cyan-100/80 hover:bg-white/10"
        >
          <ExternalLink aria-hidden="true" focusable="false" className="h-4 w-4" />
        </Link>
      )}
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
