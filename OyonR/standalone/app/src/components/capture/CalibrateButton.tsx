import { useRef, useState } from 'react';
import { Target } from 'lucide-react';
import { GazeCalibrationPanel } from 'oyon/react/gaze-calibration';
import type {
  GazeCalibrationCompleteDetail,
  GazeCalibrationPanelHandle,
} from 'oyon/react/gaze-calibration';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useSessionContext } from '@/lib/sessionContext';
import { cn } from '@/lib/cn';

/*
 * CalibrateButton — the obvious, always-at-hand entry into the 9-point gaze
 * calibration flow.
 *
 * WHY this exists: WebGazer streams a screen-point prediction *before*
 * calibration (WebGazerAdapter sets requiresCalibration=false so gaze windows
 * keep flowing), but its regression has no eye→screen mapping yet — so the
 * live gaze dot barely moves until the user calibrates. Calibration used to be
 * buried in Settings; this puts it one click away wherever the camera dock is
 * visible.
 *
 * Self-contained: it mounts its OWN GazeCalibrationPanel (portaled to
 * document.body, so nesting it here is purely logical — it always overlays the
 * full page) and drives it through the imperative ref, the same contract
 * CalibrationSection uses. Renders only when calibration is actually
 * actionable — gaze tracking enabled AND a live capture stream exists — so it
 * never competes with the dock's Start affordance when idle.
 */
export function CalibrateButton({ className }: { className?: string }) {
  const runtime = useRuntime();
  const setSessionContext = useSessionContext((s) => s.setContext);
  const panelRef = useRef<GazeCalibrationPanelHandle>(null);
  const [busy, setBusy] = useState(false);

  const hasLiveCapture =
    Boolean(runtime.cameraStream) ||
    runtime.status === 'running' ||
    runtime.status === 'paused' ||
    runtime.status === 'starting-camera' ||
    runtime.windowCount > 0;
  const canCalibrate =
    runtime.settings.gaze_tracking_enabled &&
    Boolean(runtime.runtime) &&
    hasLiveCapture;

  if (!canCalibrate) return null;

  async function handleClick() {
    if (!panelRef.current || !runtime.runtime) return;
    setBusy(true);
    try {
      await panelRef.current.start(runtime.runtime);
    } finally {
      setBusy(false);
    }
  }

  function handleComplete(detail: GazeCalibrationCompleteDetail) {
    if (!detail.ok) return;
    const quality = typeof detail.quality === 'number' ? detail.quality : null;
    setSessionContext({
      calibration:
        quality != null
          ? { status: 'ok', quality, ageMs: 0 }
          : { status: 'never' },
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title="Calibrate gaze — run the 9-point flow so the live dot tracks where you look"
        aria-label="Calibrate gaze"
        className={cn(
          'inline-flex items-center gap-1 rounded bg-status-info px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50',
          className,
        )}
      >
        <Target className="size-3" aria-hidden="true" />
        {busy ? 'Calibrating…' : 'Calibrate'}
      </button>
      <GazeCalibrationPanel
        ref={panelRef}
        runtime={runtime.runtime}
        onComplete={handleComplete}
      />
    </>
  );
}
