import { useEffect, useRef } from 'react';
import { CameraOff, Pause, Play, Square, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { useRuntime } from '@/lib/RuntimeProvider';
import { cn } from '@/lib/cn';
import { QualityBanner } from './QualityBanner';
import { FaceOverlay } from './FaceOverlay';

/*
 * CameraPreview — the on-page surface that mounts the camera <video>,
 * exposes transport controls, and surfaces the current runtime status.
 *
 * The <video> element is a *portal-style* target: the runtime owns the
 * MediaStream, this component owns the visible DOM node. On mount we
 * forward the node to `runtime.videoRef`; on unmount we release it so a
 * different page can re-claim it later.
 */

export function CameraPreview() {
  const runtime = useRuntime();
  const localRef = useRef<HTMLVideoElement | null>(null);

  // Bridge: when this <video> mounts, expose it to the runtime context so
  // the next `start()` call can pipe its stream into it. When it unmounts,
  // null the ref so a future mount on another page can take ownership.
  useEffect(() => {
    runtime.videoRef.current = localRef.current;
    // If the runtime is already running (we navigated here mid-capture),
    // attach the existing stream now rather than waiting for the next start.
    if (localRef.current && runtime.cameraStream) {
      localRef.current.srcObject = runtime.cameraStream;
      void localRef.current.play().catch(() => {
        /* autoplay can still be blocked after navigation; Start rebinds too */
      });
    }
    return () => {
      runtime.videoRef.current = null;
    };
  }, [runtime.videoRef, runtime.status, runtime.cameraStream]);

  const showingVideo =
    runtime.status === 'running' || runtime.status === 'paused';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Camera preview</CardTitle>
        <RuntimeStatusBadge />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className={cn(
            'relative aspect-video w-full overflow-hidden rounded border border-line bg-surface-3',
            !showingVideo && 'grid place-items-center',
          )}
        >
          <video
            ref={localRef}
            className={cn(
              'h-full w-full object-cover',
              !showingVideo && 'invisible',
            )}
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
          />
          {showingVideo ? <FaceOverlay lastFace={runtime.lastFace} /> : null}
          {!showingVideo ? (
            <div className="absolute inset-0 grid place-items-center text-center text-ink-3">
              <div className="space-y-1">
                <CameraOff className="mx-auto size-8" aria-hidden="true" />
                <div className="text-sm">
                  {runtime.status === 'idle'
                    ? 'Camera not started'
                    : runtime.status === 'initializing'
                      ? 'Requesting camera…'
                      : runtime.status === 'error'
                        ? 'Camera unavailable'
                        : 'Camera stopped'}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <TransportButtons />

        <QualityBanner lastWindow={runtime.lastWindow} />

        {runtime.error ? (
          <div className="rounded border border-status-bad/40 bg-status-bad-dim px-3 py-2 text-sm text-status-bad">
            {errorMessage(runtime.error)}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RuntimeStatusBadge() {
  const { status } = useRuntime();
  switch (status) {
    case 'running':
      return <StatusPill tone="ok">Running</StatusPill>;
    case 'paused':
      return <StatusPill tone="warn">Paused</StatusPill>;
    case 'initializing':
    case 'ready':
    case 'starting-camera':
    case 'stopping':
      return <StatusPill tone="info">{status}</StatusPill>;
    case 'error':
      return <StatusPill tone="bad">Error</StatusPill>;
    case 'idle':
    case 'stopped':
    default:
      return (
        <StatusPill tone="null" reason="not started">
          Idle
        </StatusPill>
      );
  }
}

function TransportButtons() {
  const { status, start, pause, resume, stop } = useRuntime();
  const running = status === 'running';
  const paused = status === 'paused';
  const initializing = status === 'initializing' || status === 'stopping';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!running && !paused ? (
        <Button onClick={start} variant="primary" disabled={initializing}>
          {initializing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
          Start
        </Button>
      ) : null}
      {running ? (
        <Button onClick={pause} variant="secondary">
          <Pause className="size-4" aria-hidden="true" />
          Pause
        </Button>
      ) : null}
      {paused ? (
        <Button onClick={resume} variant="primary">
          <Play className="size-4" aria-hidden="true" />
          Resume
        </Button>
      ) : null}
      {(running || paused) && (
        <Button onClick={stop} variant="danger">
          <Square className="size-4" aria-hidden="true" />
          Stop
        </Button>
      )}
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}
