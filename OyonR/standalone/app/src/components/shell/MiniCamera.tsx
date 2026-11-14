import { useCallback, useEffect, useRef } from 'react';
import { Camera, Pause, Play, Square, X, Loader2 } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
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
  /*
   * Phone variant: a small floating preview instead of a full column.
   *
   * The dock's job on a laptop is preview PLUS reference readout — model,
   * window count, sample counters. On a phone the readout is the part that
   * does not earn its space: it is reference material you consult, and it is
   * already on Diagnostics. What you actually want mid-capture is "is my face
   * in frame", which needs a thumbnail, not a 390 px square. So compact keeps
   * the video and the transport controls and drops the rest.
   */
  compact?: boolean;
}

export function MiniCamera({ onHide, onShow, collapsedPill, compact }: MiniCameraProps) {
  const runtime = useRuntime();
  const navigate = useNavigate();

  /*
   * Starting the camera goes to Live. The dock is reachable from every route,
   * so you could previously start a capture while sitting on Settings or a
   * retrospective Analytics view and see nothing happen — the signal was
   * flowing, but every readout for it was on another screen. Starting capture
   * is a statement of intent to watch it.
   */
  const startAndShowLive = useCallback(() => {
    void runtime.start();
    void navigate({ to: '/live' });
  }, [runtime, navigate]);
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
        className="fixed bottom-4 left-4 z-modal flex items-center gap-2 rounded-full border border-status-info/40 bg-surface-1 px-4 py-2 text-sm font-medium text-status-info shadow-popover hover:bg-surface-2"
        aria-label="Show camera dock"
      >
        <Camera className="size-4" aria-hidden="true" />
        Open camera preview
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
    <div className={cn('flex flex-col', !compact && 'h-full')}>
      <header
        className={cn(
          'flex items-center justify-between gap-2 border-b border-line bg-surface-2',
          compact ? 'px-2 py-1' : 'px-3 py-2',
        )}
      >
        <span className="label-eyebrow text-ink-2">
          {compact ? 'Preview' : 'Live preview'}
        </span>
        <button
          type="button"
          onClick={onHide}
          className={cn(
            'rounded text-ink-3 hover:bg-surface-1 hover:text-ink-0',
            // A 14 px icon is a fine mouse target and a poor thumb target;
            // this is the control that dismisses a floating panel, so on a
            // phone it gets real hit area.
            compact ? 'touch-target -m-1 grid place-items-center p-1' : 'p-1',
          )}
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
                <div className="text-mini text-ink-3">
                  Press Start to begin a session.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {runtime.lastPrediction && showVideo ? (
          <div
            className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-mini font-medium backdrop-blur-sm"
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
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-micro text-white backdrop-blur-sm"
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

      <div
        className={cn(
          'flex items-center justify-between gap-2 border-t border-line bg-surface-2',
          compact ? 'px-2 py-1' : 'px-3 py-2',
        )}
      >
        <span className="label-eyebrow truncate">
          {runtime.status}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {/* Calibration is a full-screen guided flow — it does not belong on a
              120 px floating thumbnail. It stays one tap away in the dock at
              laptop width and on the Live page. */}
          {compact ? null : <CalibrateButton />}
          {idle || errored ? (
            <button
              type="button"
              onClick={startAndShowLive}
              disabled={initializing}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-mini font-medium text-white hover:opacity-90 disabled:opacity-50"
              aria-label="Start"
            >
              <Play className="size-3" aria-hidden="true" />
              Start
            </button>
          ) : null}
          {initializing ? (
            <span className="inline-flex items-center gap-1 px-1.5 text-mini text-ink-2">
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

      {/* Reference readout, not a live signal — dropped on a phone, where it
          would double the panel's height to restate what Diagnostics shows. */}
      {compact ? null : (
        <div className="flex-1 overflow-y-auto p-3 text-xs text-ink-2 space-y-2">
          <DockSummary />
        </div>
      )}
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
        <div className="rounded border border-status-bad/40 bg-status-bad-dim/40 px-2 py-1 text-mini text-status-bad">
          {runtime.error instanceof Error ? runtime.error.message : String(runtime.error)}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-1 last:border-b-0">
      <span className="label-eyebrow">
        {label}
      </span>
      <span className="font-medium tabular-nums text-ink-0">{value}</span>
    </div>
  );
}
