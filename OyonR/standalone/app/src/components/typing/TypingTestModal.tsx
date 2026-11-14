import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { TypingStatsPanel } from './TypingStatsPanel';
import { useTypingTest } from './useTypingTest';

/*
 * TypingTestModal — a DIAGNOSTIC tool for seeing typing statistics, not a
 * production composer. Mount it to open (the parent renders it
 * conditionally); unmounting is a full teardown: the in-flight episode is
 * abandoned (so the abandon event is logged), the adapter is disposed
 * (listener add/remove symmetry), and persistence is flushed to IndexedDB.
 *
 * Overlay conventions follow MenuPopover (the app's only other layered
 * surface): Escape closes, clicking outside closes, `z-modal` token. The
 * panel is a `role="dialog"` because unlike the popover it really is modal.
 */

export function TypingTestModal({
  sessionId,
  onClose,
}: {
  /** Runtime session id to stamp on logged events; falls back to the capture id. */
  sessionId?: string | null;
  onClose: () => void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const test = useTypingTest({ sessionId });
  const { begin, teardown } = test;

  // Wire the pipeline to the textarea exactly once per mount; the cleanup IS
  // the teardown contract (close, unmount, navigation — all end here).
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    begin(element);
    element.focus();
    return () => {
      teardown();
    };
  }, [begin, teardown]);

  // Escape closes (same convention as MenuPopover).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const recording = test.status === 'recording';
  const finalized = test.status === 'submitted' || test.status === 'abandoned';

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      {/* Backdrop — clicking it closes (teardown runs via unmount). */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="typing-test-title"
        className="relative w-full max-w-4xl rounded-lg border border-line bg-surface-1 shadow-popover"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 id="typing-test-title" className="m-0 text-sm font-semibold text-ink-0">
              Typing test
            </h2>
            <StatusPill tone={recording ? 'ok' : finalized ? 'info' : 'null'} size="sm">
              {test.status}
            </StatusPill>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close typing test">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <p className="m-0 text-xs text-ink-3">
            Diagnostic test tool — not a production composer. Every input event feeds the real
            adapter → aggregator pipeline; state events persist to IndexedDB
            (<code className="font-mono">oyon-app/signal_events</code>) and appear on the Analyze
            screens afterwards. Metrics below are recomputed live by replaying the recorded inputs
            into a throwaway aggregator; the live episode itself is only finalized by Submit or
            Abandon.
          </p>

          <textarea
            ref={textareaRef}
            disabled={finalized}
            placeholder="Type here. Try pausing, deleting, pasting, selecting and typing over text…"
            className="min-h-32 w-full resize-y rounded border border-line bg-surface-0 p-3 text-sm text-ink-0 placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info disabled:opacity-60"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" disabled={!recording} onClick={test.submit}>
              Submit episode
            </Button>
            <Button variant="outline" size="sm" disabled={!recording} onClick={test.abandon}>
              Abandon episode
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const element = textareaRef.current;
                if (element) test.reset(element);
              }}
            >
              Reset
            </Button>
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-mini tabular-nums text-ink-3">
              <span>{test.counts.inputEvents} inputs</span>
              <span>{test.counts.loggedStates} states</span>
              <span>
                {test.counts.persisted} persisted
                {test.counts.pendingWrites > 0 ? ` (+${test.counts.pendingWrites} pending)` : ''}
              </span>
              {test.modes ? (
                <span>
                  graphemes: {test.modes.grapheme} · words: {test.modes.word}
                </span>
              ) : null}
            </div>
          </div>

          {test.persistError ? (
            <p className="m-0 text-xs text-status-bad">
              IndexedDB persistence failed: {test.persistError} ({test.counts.failedWrites} events lost)
            </p>
          ) : null}

          {finalized && test.finalWindow ? (
            <p className="m-0 rounded border border-line bg-surface-0 p-2 text-xs text-ink-2">
              Episode <span className="font-medium text-ink-0">{test.status}</span>
              {test.captureId ? (
                <>
                  {' '}as capture <code className="font-mono">{test.captureId}</code>
                </>
              ) : null}
              . Events are persisted — see the Analyze screens for the sequence view, or Reset to
              start a new episode. Metrics below are the finalized window.
            </p>
          ) : null}

          <TypingStatsPanel
            typing={test.finalWindow?.typing ?? test.live?.typing ?? null}
            quality={test.finalWindow?.quality ?? test.live?.quality}
          />
        </div>
      </div>
    </div>
  );
}
