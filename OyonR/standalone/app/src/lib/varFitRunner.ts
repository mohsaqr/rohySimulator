import type { NetworkErrorInfo, VarFitRequest, VarFitResult } from './groupVarFit';

/*
 * Runs `fitVarNetworks` off the main thread and lets the page cancel it.
 *
 * One module Web Worker per fit (src/workers/varNetworks.ts), terminated on
 * cancel or when it answers. The `new Worker(new URL(...), { type: 'module' })`
 * form is the one Vite detects and emits as a separate chunk — in the
 * standalone build and in the <oyon-app> element build alike (both set
 * `worker.format: 'es'`; the element's worker lands beside
 * oyon-app.element.js, like the voice-analysis worker).
 *
 * Fallback: when a worker cannot start (no Worker, a CSP that forbids it, the
 * element served from another origin) or its script fails to load, the fit
 * runs on the main thread instead and the result says so (`thread: 'main'`,
 * `note`) — the page shows that line; nothing is hidden.
 */

export interface VarFitOutcome {
  result: VarFitResult | null;
  error: NetworkErrorInfo | null;
  thread: 'worker' | 'main';
  note: string | null;
  elapsed_ms: number;
}

export interface VarFitHandle {
  cancel: () => void;
}

let nextId = 1;

function errorInfo(err: unknown): NetworkErrorInfo {
  const e = err as { code?: string; name?: string; message?: string };
  return { source: 'oyon', code: e?.code ?? e?.name ?? 'error', message: e?.message ?? String(err) };
}

function runOnMainThread(request: VarFitRequest, reason: string, t0: number, done: (o: VarFitOutcome) => void, isCancelled: () => boolean) {
  const note = `Ran on the main thread (${reason}); the page is unresponsive while it fits.`;
  // Let the "fitting" state paint before the synchronous fit blocks the thread.
  window.setTimeout(() => {
    if (isCancelled()) return;
    import('./groupVarFit').then(
      ({ fitVarNetworks }) => {
        if (isCancelled()) return;
        try {
          done({ result: fitVarNetworks(request), error: null, thread: 'main', note, elapsed_ms: performance.now() - t0 });
        } catch (err) {
          done({ result: null, error: errorInfo(err), thread: 'main', note, elapsed_ms: performance.now() - t0 });
        }
      },
      (err: unknown) => {
        if (!isCancelled()) done({ result: null, error: errorInfo(err), thread: 'main', note, elapsed_ms: performance.now() - t0 });
      },
    );
  }, 30);
}

/** Start a fit; `done` is called once (never after `cancel()`). */
export function runVarFit(request: VarFitRequest, done: (outcome: VarFitOutcome) => void): VarFitHandle {
  const t0 = performance.now();
  let cancelled = false;
  const isCancelled = () => cancelled;
  let worker: Worker | null = null;
  const id = nextId++;

  const fallback = (reason: string) => {
    worker?.terminate();
    worker = null;
    runOnMainThread(request, reason, t0, done, isCancelled);
  };

  if (typeof Worker === 'undefined') {
    fallback('this browser has no Web Workers');
  } else {
    try {
      worker = new Worker(new URL('../workers/varNetworks.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      fallback(`the worker could not start: ${(err as Error).message}`);
    }
  }
  if (worker) {
    const w = worker;
    w.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: VarFitResult; error?: NetworkErrorInfo }>) => {
      if (cancelled || event.data?.id !== id) return;
      w.terminate();
      worker = null;
      done({
        result: event.data.ok ? event.data.result ?? null : null,
        error: event.data.ok ? null : event.data.error ?? { source: 'oyon', code: 'error', message: 'the worker returned no result' },
        thread: 'worker',
        note: null,
        elapsed_ms: performance.now() - t0,
      });
    };
    // An error event here is the worker script failing to load or an uncaught
    // throw outside fitVarNetworks (which catches its own fit errors).
    w.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      if (cancelled) return;
      fallback(`the worker failed: ${event.message || 'its script did not load'}`);
    };
    w.onmessageerror = () => {
      if (!cancelled) fallback('the worker result could not be read');
    };
    try {
      w.postMessage({ id, request });
    } catch (err) {
      fallback(`the rows could not be sent to the worker: ${(err as Error).message}`);
    }
  }

  return {
    cancel: () => {
      cancelled = true;
      worker?.terminate();
      worker = null;
    },
  };
}
