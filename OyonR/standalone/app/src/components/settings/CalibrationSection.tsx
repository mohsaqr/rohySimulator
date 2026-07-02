import { useRef, useState } from 'react';
import { Target } from 'lucide-react';
import { GazeCalibrationPanel } from 'oyon/react/gaze-calibration';
import type {
  GazeCalibrationCompleteDetail,
  GazeCalibrationPanelHandle,
} from 'oyon/react/gaze-calibration';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useSessionContext } from '@/lib/sessionContext';

interface CalibrationEvent {
  at: number;
  detail: GazeCalibrationCompleteDetail;
}

export function CalibrationSection() {
  const runtime = useRuntime();
  const setSessionContext = useSessionContext((s) => s.setContext);
  const panelRef = useRef<GazeCalibrationPanelHandle>(null);
  const [history, setHistory] = useState<CalibrationEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const hasRuntime = Boolean(runtime.runtime);
  const hasLiveCapture =
    Boolean(runtime.cameraStream) ||
    runtime.status === 'running' ||
    runtime.status === 'paused' ||
    runtime.status === 'starting-camera' ||
    runtime.windowCount > 0;
  const canCalibrate = hasRuntime && hasLiveCapture;

  async function handleStart() {
    if (!panelRef.current || !runtime.runtime) return;
    setBusy(true);
    try {
      await panelRef.current.start(runtime.runtime);
    } finally {
      setBusy(false);
    }
  }

  async function handleStartCapture() {
    setBusy(true);
    try {
      await runtime.start();
    } finally {
      setBusy(false);
    }
  }

  function handleComplete(detail: GazeCalibrationCompleteDetail) {
    setHistory((h) => [{ at: Date.now(), detail }, ...h]);
    if (detail.ok) {
      const quality = typeof detail.quality === 'number' ? detail.quality : null;
      setSessionContext({
        calibration:
          quality != null
            ? { status: 'ok', quality, ageMs: 0 }
            : { status: 'never' },
      });
    }
  }

  const latest = history[0]?.detail ?? null;

  return (
    <Section
      id="settings-calibration"
      title="Gaze calibration"
      description="Record gaze accuracy and provenance. Honest about absence — quality is null when the adapter can't measure."
    >
      <Card>
        <CardHeader>
          <CardTitle>Calibrate</CardTitle>
          <Button
            onClick={canCalibrate ? handleStart : handleStartCapture}
            variant="primary"
            size="sm"
            disabled={busy || runtime.status === 'initializing' || runtime.status === 'starting-camera'}
          >
            <Target className="size-3.5" aria-hidden="true" />
            {busy ? 'Working…' : canCalibrate ? 'Start calibration' : 'Start capture first'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canCalibrate ? (
            <EmptyState
              icon={<Target className="size-6" />}
              title="Calibration needs the live camera stream"
              description="Press Start calibration above — it will start capture and run the 9-point flow."
            />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Metric
                  label="Quality"
                  value={latest?.quality ?? null}
                  format={(v) => v.toFixed(2)}
                  tone={
                    latest == null
                      ? 'null'
                      : latest.quality == null
                        ? 'null'
                        : latest.quality > 0.7
                          ? 'ok'
                          : latest.quality > 0.4
                            ? 'warn'
                            : 'bad'
                  }
                  reason={
                    latest == null
                      ? 'no calibration yet'
                      : latest.quality == null
                        ? 'adapter cannot quantify'
                        : undefined
                  }
                />
                <Metric
                  label="Confidence"
                  value={latest?.confidence ?? null}
                  tone={
                    latest?.confidence === 'measured'
                      ? 'ok'
                      : latest?.confidence === 'inferred'
                        ? 'warn'
                        : 'null'
                  }
                  reason={latest == null ? 'no calibration yet' : undefined}
                />
                <Metric
                  label="Engine"
                  value={latest?.model ?? runtime.gazeEngine}
                  tone="info"
                  hint="active gaze adapter"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-ink-3">
                    History
                  </span>
                  <StatusPill tone="info" size="sm">
                    {history.length} record{history.length === 1 ? '' : 's'}
                  </StatusPill>
                </div>
                {history.length === 0 ? (
                  <div className="text-sm text-ink-3 py-2">
                    No calibration recorded yet.
                  </div>
                ) : (
                  <ul className="flex flex-col divide-y divide-line" role="list">
                    {history.map((ev) => (
                      <li
                        key={ev.at}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="text-ink-3 tabular-nums">
                          {new Date(ev.at).toLocaleTimeString()}
                        </span>
                        <span className="text-ink-1">{ev.detail.model}</span>
                        <StatusPill
                          tone={
                            ev.detail.confidence === 'measured'
                              ? 'ok'
                              : ev.detail.confidence === 'inferred'
                                ? 'warn'
                                : 'null'
                          }
                          size="sm"
                          reason={
                            ev.detail.confidence === 'unknown'
                              ? 'unknown confidence'
                              : undefined
                          }
                        >
                          {ev.detail.quality != null
                            ? `q ${ev.detail.quality.toFixed(2)}`
                            : 'q n/a'}
                        </StatusPill>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Full-screen overlay panel — mounted always so the imperative ref is available. */}
      <GazeCalibrationPanel
        ref={panelRef}
        runtime={runtime.runtime}
        onComplete={handleComplete}
      />
    </Section>
  );
}
