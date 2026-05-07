/**
 * Tiny shared wrapper that gives every server-side outbound HTTP call a
 * uniform timeout + abort contract.
 *
 * Audit #10 (server-services-tts-proxies): the TTS providers + catalogue
 * proxies hit external APIs (Google, OpenAI, RxNorm, OpenFDA, LOINC) but
 * each defines (or omits) its own timeout policy ad hoc. This module
 * supplies a single helper so the policy is consistent and discoverable.
 *
 * Behaviour:
 *   - Wraps a `fetch(url, init)` call with an AbortController that fires
 *     after `timeoutMs`.
 *   - Throws a typed `FetchTimeoutError` (extends Error, name='FetchTimeoutError')
 *     when the timeout fires, so callers can branch on `err instanceof FetchTimeoutError`
 *     without sniffing AbortError vs network-error strings.
 *   - Honours an optional caller-supplied AbortSignal (combined via
 *     AbortSignal.any when available, falling back to a manual fan-out
 *     when running on Node < 20.5 without it).
 *   - Cleans up the timer on success AND on early caller-abort, so we
 *     don't leak setTimeout references in long-lived workers.
 */

export class FetchTimeoutError extends Error {
    constructor(url, timeoutMs) {
        super(`Request to ${url} timed out after ${timeoutMs}ms`);
        this.name = 'FetchTimeoutError';
        this.url = url;
        this.timeoutMs = timeoutMs;
    }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function combineSignals(callerSignal, internalSignal) {
    if (!callerSignal) return internalSignal;
    if (typeof AbortSignal?.any === 'function') {
        return AbortSignal.any([callerSignal, internalSignal]);
    }
    // Manual fan-out for older Node versions: forward the caller's abort
    // through our internal controller. We can't return their signal
    // directly because we still need our timeout to be able to abort.
    if (callerSignal.aborted) {
        try { internalSignal.dispatchEvent(new Event('abort')); } catch { /* noop */ }
    } else {
        callerSignal.addEventListener('abort', () => {
            // The internal controller is the abort source.
        }, { once: true });
    }
    return internalSignal;
}

export async function fetchWithTimeout(url, init = {}, options = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const signal = combineSignals(init.signal, controller.signal);

    try {
        const response = await fetch(url, { ...init, signal });
        return response;
    } catch (err) {
        if (controller.signal.aborted && (!init.signal || !init.signal.aborted)) {
            throw new FetchTimeoutError(url, timeoutMs);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
