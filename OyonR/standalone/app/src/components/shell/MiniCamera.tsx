import { useEffect, useRef } from 'react';
import { Pause, Play, Square, X, EyeOff, Loader2 } from 'lucide-react';
import { useRuntime } from '@/lib/RuntimeProvider';
import { FaceOverlay } from '@/components/capture/FaceOverlay';
import { CalibrateButton } from '@/components/capture/CalibrateButton';
import { emotionColor } from '@/lib/emotionColors';
import { cn } from '@/lib/cn';

/*
 * MiniCamera — the persistent camera surface. Renders in two modes:
 *
 *   1. Docked column (default): the AppShell mounts MiniCamera as the
 *      right-side column. The component fills its container so it doesn't
 *      overlap main content.
 *   2. Collapsed pill (when the dock is hidden): a fixed bottom-right
 *      button restores the dock.
 *
 * Owns the only authoritative <video> element bound to the runtime's
 * MediaStream. Square frame with a head-centering crop (legacy parity
 * with standalone/index.html `.preview-zoom`).
 */

const HEAD_ZOOM = 1.18;
const HEAD_OFFSET_Y = '-6%';

export interface MiniCameraProps {
  onHide?: () => void;
  onShow?: () => void;
  collapsedPill?: boolean;
}

export function MiniCamera({ onHide, onShow, collapsedPill }: MiniCameraProps) {
  const runtime = useRuntime();
  const localRef = useRef<HTMLVideoElement | null>(null);

  // Bridge: keep runtime.videoRef pointing at the only on-screen video so
  // future start() calls bind their MediaStream into this element.
  useEffect(() => {
    if (collapsedPill) return;
    runtime.videoRef.current = localRef.current;
    return () => {
      if (runtime.videoRef.current === localRef.current) {
        runtime.videoRef.current = null;
      }
    };
  }, [runtime.videoRef, collapsedPill]);

  useEffect(() => {
    if (collapsedPill) return;
    const v = localRef.current;
    if (!v) return;
    if (runtime.cameraStream && v.srcObject !== runtime.cameraStream) {
      v.srcObject = runtime.cameraStream;
      v.play().catch(() => {
        /* autoplay blocked is harmless — user clicked Start */
      });
    } else if (!runtime.cameraStream && v.srcObject) {
      v.srcObject = null;
    }
  }, [runtime.cameraStream, collapsedPill]);

  if (collapsedPill) {
    return (
      <button
        type="button"
        onClick={onShow}
        className="fixed bottom-4 right-4 z-dock flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-xs text-ink-1 shadow-popover hover:bg-surface-2"
        aria-label="Show camera dock"
      >
        <EyeOff className="size-3.5" aria-hidden="true" />
        Show preview
      </button>
    );
  }

  const initializing =
    runtime.status === 'initializing' || runtime.status === 'starting-camera';
  const running = runtime.status === 'running';
  const paused = runtime.status === 'paused';
  const idle =
    runtime.status === 'idle' ||
    runtime.status === 'ready' ||
    runtime.status === 'stopped';
  const errored = runtime.status === 'error';
  const showVideo = (running || paused) && Boolean(runtime.cameraStream);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-2">
          Live preview
        </span>
        <button
          type="button"
          onClick={onHide}
          className="rounded p-1 text-ink-3 hover:bg-surface-1 hover:text-ink-0"
          aria-label="Hide camera dock"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      <div className="relative aspect-square w-full overflow-hidden bg-surface-3">
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(0, ${HEAD_OFFSET_Y}) scale(${HEAD_ZOOM})`,
            transformOrigin: 'center',
          }}
        >
          <video
            ref={localRef}
            className={cn('size-full object-cover', !showVideo && 'opacity-0')}
            playsInline
            muted
            autoPlay
            aria-label="Camera mini preview"
          />
        </div>
        {showVideo ? <FaceOverlay lastFace={runtime.lastFace} /> : null}
        {!showVideo ? (
          <div className="absolute inset-0 grid place-items-center text-center text-ink-3">
            <div className="space-y-1 px-3">
              <div className="text-xs uppercase tracking-wider">
                {errored
                  ? 'Camera unavailable'
                  : initializing
                    ? 'Requesting camera…'
                    : 'Camera off'}
              </div>
              {idle ? (
                <div className="text-[11px] text-ink-3">
                  Press Start to begin a session.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {runtime.lastPrediction && showVideo ? (
          <div
            className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm"
            style={{ color: emotionColor(runtime.lastPrediction.label) }}
          >
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: emotionColor(runtime.lastPrediction.label) }}
              aria-hidden="true"
            />
            <span className="capitalize text-white">
              {runtime.lastPrediction.label}
            </span>
            <span className="tabular-nums text-white/70">
              {(runtime.lastPrediction.confidence * 100).toFixed(0)}%
            </span>
          </div>
        ) : null}
        {runtime.lastGaze && showVideo ? (
          <div
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm"
            title="Live gaze sample"
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                runtime.lastGaze.quality > 0.5
                  ? 'bg-status-ok'
                  : 'bg-status-warn',
              )}
              aria-hidden="true"
            />
            gaze · q{(runtime.lastGaze.quality || 0).toFixed(2)}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          {runtime.status}
        </span>
        <div className="flex items-center gap-1">
          <CalibrateButton />
          {idle || errored ? (
            <button
              type="button"
              onClick={runtime.start}
              disabled={initializing}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              aria-label="Start"
            >
              <Play className="size-3" aria-hidden="true" />
              Start
            </button>
          ) : null}
          {initializing ? (
            <span className="inline-flex items-center gap-1 px-1.5 text-[11px] text-ink-2">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              starting
            </span>
          ) : null}
          {running ? (
            <button
              type="button"
              onClick={runtime.pause}
              className="rounded p-1 text-ink-2 hover:bg-surface-1 hover:text-ink-0"
              aria-label="Pause"
            >
              <Pause className="size-3.5" aria-hidden="true" />
            </button>
          ) : paused ? (
            <button
              type="button"
              onClick={runtime.resume}
              className="rounded p-1 text-ink-2 hover:bg-surface-1 hover:text-ink-0"
              aria-label="Resume"
            >
              <Play className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
          {running || paused ? (
            <button
              type="button"
              onClick={runtime.stop}
              className="rounded p-1 text-ink-2 hover:bg-surface-1 hover:text-status-bad"
              aria-label="Stop"
            >
              <Square className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs text-ink-2 space-y-2">
        <DockSummary />
      </div>
    </div>
  );
}

function DockSummary() {
  const runtime = useRuntime();
  return (
    <div className="space-y-1.5">
      <Row label="Model" value={runtime.modelLabel} />
      <Row label="Windows" value={String(runtime.windowCount)} />
      <Row
        label="Eye samples"
        value={runtime.settings.eye_tracking_enabled ? String(runtime.eyeSampleCount) : 'off'}
      />
      <Row
        label="Gaze samples"
        value={runtime.settings.gaze_tracking_enabled ? String(runtime.gazeSampleCount) : 'off'}
      />
      {runtime.lastGaze ? (
        <Row label="Gaze q" value={runtime.lastGaze.quality.toFixed(2)} />
      ) : null}
      {runtime.error ? (
        <div className="rounded border border-status-bad/40 bg-status-bad-dim/40 px-2 py-1 text-[11px] text-status-bad">
          {runtime.error instanceof Error ? runtime.error.message : String(runtime.error)}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-1 last:border-b-0">
      <span className="text-[10px] uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <span className="font-medium tabular-nums text-ink-0">{value}</span>
    </div>
  );
}
