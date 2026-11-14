import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { VoiceStatsPanel } from './VoiceStatsPanel';
import { VoiceSpeechStrip } from '@/components/charts/VoiceSpeechStrip';
import { VoiceLoudnessEnvelope } from '@/components/charts/VoiceLoudnessEnvelope';
import {
  useVoiceTest,
  useVoiceEnabled,
  type VoiceTestStatus,
} from './useVoiceTest';
import type { VoiceStateLabel } from '../../../../../types/voice';

/*
 * VoiceTestModal — a DIAGNOSTIC tool for the voice pipeline, not a
 * production voice UI. Mount it to open; unmounting is a full teardown:
 * any in-flight turn is stopped (every MediaStreamTrack stops synchronously
 * inside the controller), the partial window is finalized and persisted,
 * the VAD adapter is disposed and event persistence is flushed — see
 * useVoiceTest's teardown contract. A microphone left running after this
 * dialog closes would be the single worst failure of the feature.
 *
 * The ACTIVATION GATE is honoured, never bypassed: recording is impossible
 * until the persisted `voice_enabled` setting is on. When it is off the
 * Start button is disabled, the reason is stated in full, and the modal
 * points at Settings → Voice — the ONE place the setting is flipped (it
 * used to be an inline stopgap control here, removed once the Settings
 * section existed). Opening this dialog touches no microphone hardware;
 * only Start (the per-turn user action the controller's gate requires) can.
 *
 * PROCESSING MODE is badged next to the VAD engine: `worker` means this
 * turn's VAD + FFT + pitch ran in the dedicated Worker, off the UI thread
 * where MediaPipe face/pose and ONNX emotion run; `main-thread` is either
 * the analyzer's visible fallback (reason shown in full) or the user's own
 * voice_worker_enabled choice. A silent fallback would make the feature
 * look fine while doing exactly what the worker exists to avoid.
 *
 * Overlay conventions follow TypingTestModal/MenuPopover: Escape closes,
 * clicking the backdrop closes, `z-modal` token, role="dialog".
 */

const STATE_TONE: Partial<Record<VoiceStateLabel, 'ok' | 'warn' | 'bad' | 'info' | 'null'>> = {
  speech: 'ok',
  silence: 'info',
  pause: 'warn',
  clipped: 'bad',
  muted: 'warn',
  playback: 'info',
  contaminated: 'bad',
  start: 'info',
  end: 'null',
};

function statusTone(status: VoiceTestStatus): 'ok' | 'info' | 'null' {
  if (status === 'recording') return 'ok';
  if (status === 'starting' || status === 'finalized') return 'info';
  return 'null';
}

/** Level meter: full scale at RMS 0.25 (loud close-mic speech). */
const METER_FULL_SCALE_RMS = 0.25;

export function VoiceTestModal({
  sessionId,
  onClose,
}: {
  /** Runtime session id to stamp on logged events; falls back to the capture id. */
  sessionId?: string | null;
  onClose: () => void;
}): JSX.Element {
  const voiceEnabled = useVoiceEnabled();
  const navigate = useNavigate();
  const test = useVoiceTest({ sessionId });
  const { teardown } = test;

  // Navigating away unmounts the modal (teardown runs); onClose keeps the
  // Live page's own modal state honest.
  const openVoiceSettings = () => {
    onClose();
    void navigate({ to: '/settings', hash: 'settings-voice' });
  };

  // Unmount IS the teardown contract (close, backdrop, Escape, navigation).
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  // Escape closes (same convention as MenuPopover / TypingTestModal).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const recording = test.status === 'recording';
  const starting = test.status === 'starting';
  const finalized = test.status === 'finalized';
  const busy = recording || starting;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      {/* Backdrop — clicking it closes (teardown runs via unmount). */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-test-title"
        className="relative w-full max-w-4xl rounded-lg border border-line bg-surface-1 shadow-popover"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="voice-test-title" className="m-0 text-sm font-semibold text-ink-0">
              Voice test
            </h2>
            <StatusPill tone={statusTone(test.status)} size="sm">
              {test.status}
            </StatusPill>
            {/* The VAD badge: which engine produced every speech decision.
                A fallback silently standing in for the neural model would
                make every number meaningless without the user knowing. */}
            {test.vadEngine ? (
              <StatusPill tone={test.vadEngine === 'silero' ? 'ok' : 'warn'} size="sm">
                {test.vadEngine === 'silero' ? 'VAD: Silero (neural)' : 'VAD: energy-threshold fallback'}
              </StatusPill>
            ) : null}
            {/* Which thread measured this turn. Main-thread is warn-toned
                when it is a FALLBACK (the worker was requested but could
                not start) and neutral when the user turned the worker off. */}
            {test.processingMode ? (
              <StatusPill
                tone={
                  test.processingMode === 'worker'
                    ? 'ok'
                    : test.workerRequested
                      ? 'warn'
                      : 'info'
                }
                size="sm"
              >
                {test.processingMode === 'worker' ? 'analysis: worker' : 'analysis: main-thread'}
              </StatusPill>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close voice test">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <p className="m-0 text-xs text-ink-3">
            Diagnostic test tool — not a production voice UI. One turn = press Start, speak, press
            Stop. Every audio frame runs the real controller → DSP → aggregator pipeline; the
            finalized <code className="font-mono">voice-v1</code> window persists to IndexedDB
            (<code className="font-mono">oyon-app/signal_windows</code>) and its state events to{' '}
            <code className="font-mono">signal_events</code> — both appear on the Analyze screens
            (Voice tab, and the voice channel on Dynamics/Patterns). Audio never leaves this
            browser; only derived features are stored.
          </p>

          {!voiceEnabled ? (
            <div className="rounded border border-status-warn bg-surface-0 p-3 text-sm text-ink-1">
              <p className="m-0 font-medium text-ink-0">
                Voice capture is disabled — <code className="font-mono">voice_enabled</code> is off.
              </p>
              <p className="m-0 mt-1 text-xs text-ink-2">
                This is the first condition of the library&rsquo;s three-part activation gate: while
                it is off, no microphone hardware is ever touched and Start below stays disabled.
                The setting lives in Settings → Voice (an activation gate on hardware access, not
                a data gate). Nothing starts recording until you also press Start — the deliberate
                per-turn action the gate requires.
              </p>
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={openVoiceSettings}>
                  Open Settings → Voice
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <span>
                <code className="font-mono">voice_enabled</code>: on
              </span>
              <button
                type="button"
                onClick={openVoiceSettings}
                className="rounded border border-line bg-surface-1 px-1.5 py-0.5 text-mini font-medium text-ink-2 hover:bg-surface-2"
              >
                change in Settings → Voice
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!voiceEnabled || busy}
              onClick={() => {
                // The deliberate per-turn user action the gate requires.
                void test.startTurn();
              }}
            >
              Start turn
            </Button>
            <Button variant="outline" size="sm" disabled={!recording} onClick={test.stop}>
              Stop &amp; finalize
            </Button>
            {starting ? (
              <span className="text-xs text-ink-3">
                {test.phase === 'vad-init'
                  ? 'Loading VAD… (trying the Silero model; falls back to energy threshold)'
                  : 'Waiting for microphone permission — answer the browser prompt.'}
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-mini tabular-nums text-ink-3">
              <span>{test.counts.frames} frames</span>
              <span>{test.counts.loggedStates} states</span>
              <span>
                {test.counts.persisted} persisted
                {test.counts.pendingWrites > 0 ? ` (+${test.counts.pendingWrites} pending)` : ''}
              </span>
            </div>
          </div>

          {test.gateError ? <p className="m-0 text-xs text-status-warn">{test.gateError}</p> : null}
          {test.micError ? <p className="m-0 text-xs text-status-bad">{test.micError}</p> : null}
          {test.persistError ? (
            <p className="m-0 text-xs text-status-bad">
              IndexedDB persistence failed: {test.persistError} ({test.counts.failedWrites} events lost)
            </p>
          ) : null}
          {test.vadEngine === 'energy' && test.vadReason ? (
            <p className="m-0 text-xs text-status-warn">
              Silero VAD unavailable ({test.vadReason}) — speech decisions come from a crude RMS
              energy threshold. Structure figures (speech ratio, pauses) are rough; treat them as
              plumbing verification, not measurement.
            </p>
          ) : null}
          {/* A silent worker fallback would make the feature look fine while
              running VAD + FFT + pitch on the very thread the worker exists
              to spare (MediaPipe face/pose + ONNX emotion at 16 fps). */}
          {test.processingMode === 'main-thread' ? (
            test.workerRequested ? (
              <p className="m-0 text-xs text-status-warn">
                Worker analysis unavailable
                {test.workerFallbackReason ? ` (${test.workerFallbackReason})` : ''} — this
                turn&rsquo;s VAD and per-frame DSP ran on the main thread, alongside the camera
                pipelines. The stored window records this as{' '}
                <code className="font-mono">quality.processing_mode</code>.
              </p>
            ) : (
              <p className="m-0 text-xs text-ink-3">
                Worker analysis is off (<code className="font-mono">voice_worker_enabled</code> in
                Settings → Voice) — VAD and per-frame DSP run on the main thread by choice.
              </p>
            )
          ) : null}

          {recording ? (
            <div className="rounded border border-line bg-surface-0 p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  <span className="label-eyebrow">State</span>
                  <StatusPill tone={STATE_TONE[test.live?.state ?? 'start'] ?? 'null'} size="sm">
                    {test.live?.state ?? 'waiting'}
                  </StatusPill>
                </div>
                <ReadoutRow
                  label="Elapsed"
                  value={test.live ? `${(test.live.elapsedMs / 1000).toFixed(1)}s` : '—'}
                />
                <ReadoutRow
                  label="Speech time"
                  value={test.live ? `${(test.live.speechMs / 1000).toFixed(1)}s` : '—'}
                />
                <ReadoutRow
                  label="Live F0"
                  value={
                    test.live?.f0Hz != null
                      ? `${test.live.f0Hz.toFixed(0)} Hz (conf ${test.live.f0Confidence?.toFixed(2) ?? '—'})`
                      : '— unvoiced'
                  }
                />
                <ReadoutRow
                  label="Speech prob."
                  value={
                    test.live?.speechProbability != null
                      ? test.live.speechProbability.toFixed(2)
                      : '— no VAD'
                  }
                />
                <ReadoutRow label="Clipped frames" value={test.live ? String(test.live.clippedFrames) : '—'} />
                {/* Backpressure drops are the thing a user would otherwise
                    never notice — surfaced live, not only in the report. */}
                <ReadoutRow
                  label="Dropped frames"
                  value={test.live ? String(test.live.droppedFrames) : '—'}
                />
              </div>
              {/* RMS level meter — live loudness, full scale at rms 0.25. */}
              <div className="mt-3 flex items-center gap-2">
                <span className="label-eyebrow w-10">Level</span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className="h-full bg-status-ok transition-[width] duration-100"
                    style={{
                      width: `${Math.min(1, (test.live?.rms ?? 0) / METER_FULL_SCALE_RMS) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-right text-mini tabular-nums text-ink-2">
                  {test.live ? test.live.rms.toFixed(3) : '—'}
                </span>
              </div>
            </div>
          ) : null}

          {finalized && test.finalWindow ? (
            <p className="m-0 rounded border border-line bg-surface-0 p-2 text-xs text-ink-2">
              Turn finalized
              {test.captureId ? (
                <>
                  {' '}as capture <code className="font-mono">{test.captureId}</code>
                </>
              ) : null}
              . The window and its state events are persisted — open Analyze → Voice for the
              pitch contour and distribution, the across-turn trends and the full turn table, or
              start another turn.
            </p>
          ) : null}

          {/*
           * The two charts that answer "what did I just record?" without a
           * page change. Diagnosing a bad capture is exactly what this modal
           * is for, and structure + level is where a bad capture shows: all
           * silence, clipping throughout, a level pinned to the floor. The
           * per-frame series is already in hand (framesRef, kept precisely
           * for this); reading it as numbers only was leaving the diagnosis
           * to the user. Pitch stays on the analytics page — it is analysis,
           * not a capture check.
           */}
          {finalized && test.finalWindow && test.framesRef.current.length > 0 ? (
            <div className="flex flex-col gap-3 rounded border border-line bg-surface-0 p-3">
              <div>
                <p className="m-0 mb-1 text-xs font-medium text-ink-1">Speech structure</p>
                <VoiceSpeechStrip
                  frames={test.framesRef.current}
                  voice={test.finalWindow.voice}
                  quality={test.finalWindow.quality ?? null}
                />
              </div>
              <div>
                <p className="m-0 mb-1 text-xs font-medium text-ink-1">Level</p>
                <VoiceLoudnessEnvelope
                  frames={test.framesRef.current}
                  voice={test.finalWindow.voice}
                  quality={test.finalWindow.quality ?? null}
                />
              </div>
            </div>
          ) : null}

          <VoiceStatsPanel
            voice={test.finalWindow?.voice ?? null}
            quality={test.finalWindow?.quality ?? null}
            vadEngine={test.vadEngine}
          />
        </div>
      </div>
    </div>
  );
}

function ReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line py-1 last:border-b-0 sm:border-b-0">
      <span className="label-eyebrow">{label}</span>
      <span className="font-medium tabular-nums text-ink-0">{value}</span>
    </div>
  );
}
