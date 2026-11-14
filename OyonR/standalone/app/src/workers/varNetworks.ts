/*
 * Web Worker for the group dashboard's VAR networks: psychaj fitMlVAR /
 * fitGraphicalVAR take 0.5–7 s, which would freeze the page on the main
 * thread. The worker only runs `fitVarNetworks` (lib/groupVarFit.js) and posts
 * back plain matrices, labels and psychaj's warnings; the main thread paints
 * them with ladyna. Started per fit and terminated to cancel
 * (lib/varFitRunner.ts).
 */
import { fitVarNetworks, type VarFitRequest } from '@/lib/groupVarFit';

interface FitMessage {
  id: number;
  request: VarFitRequest;
}

self.onmessage = (event: MessageEvent<FitMessage>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, ok: true, result: fitVarNetworks(request) });
  } catch (err) {
    const e = err as { code?: string; name?: string; message?: string };
    self.postMessage({ id, ok: false, error: { source: 'oyon', code: e.code ?? e.name ?? 'error', message: e.message ?? String(err) } });
  }
};
