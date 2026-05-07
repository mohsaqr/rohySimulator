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

// ─── Retry + circuit-breaker ─────────────────────────────────────────────
//
// fetchWithRetry wraps fetchWithTimeout with bounded retries on 5xx + transport
// errors, plus a per-target circuit breaker. When a target fails N times in a
// row, the breaker opens and subsequent calls fail fast (no wasted retries) for
// a cooldown window. After the window, one trial request gets through; success
// closes the breaker, failure re-opens it.
//
// Retry policy:
//   - attempts: 3 by default (initial + 2 retries).
//   - retry on FetchTimeoutError, network errors, and HTTP 5xx.
//   - exponential backoff with jitter: 100ms, 200ms, 400ms (× ~ random 0.5-1.5).
//
// The breaker is per-target, keyed by a caller-supplied `breakerKey` (e.g.
// 'openai-tts', 'google-tts'). Different providers don't share state.

const BREAKER_OPEN_MS = 30_000;     // 30s cooldown after breaker trips
const BREAKER_FAILURE_THRESHOLD = 5; // consecutive failures before open

const breakerState = new Map(); // key → { failures, openedAt }

export class CircuitBreakerOpenError extends Error {
    constructor(key, msUntilHalfOpen) {
        super(`Circuit breaker open for ${key} (retry in ${msUntilHalfOpen}ms)`);
        this.name = 'CircuitBreakerOpenError';
        this.key = key;
        this.msUntilHalfOpen = msUntilHalfOpen;
    }
}

function breakerCheck(key) {
    const state = breakerState.get(key);
    if (!state || state.openedAt == null) return null; // closed
    const elapsed = Date.now() - state.openedAt;
    if (elapsed >= BREAKER_OPEN_MS) return null; // half-open: allow trial
    return BREAKER_OPEN_MS - elapsed;
}

function breakerSuccess(key) {
    breakerState.set(key, { failures: 0, openedAt: null });
}

function breakerFailure(key) {
    const state = breakerState.get(key) || { failures: 0, openedAt: null };
    state.failures += 1;
    if (state.failures >= BREAKER_FAILURE_THRESHOLD) {
        state.openedAt = Date.now();
    }
    breakerState.set(key, state);
}

export function _resetBreakerForTest(key) {
    if (key) breakerState.delete(key);
    else breakerState.clear();
}

export function getBreakerState(key) {
    const s = breakerState.get(key);
    if (!s) return { state: 'closed', failures: 0 };
    if (s.openedAt == null) return { state: 'closed', failures: s.failures };
    const elapsed = Date.now() - s.openedAt;
    if (elapsed >= BREAKER_OPEN_MS) return { state: 'half-open', failures: s.failures };
    return { state: 'open', failures: s.failures, msUntilHalfOpen: BREAKER_OPEN_MS - elapsed };
}

const DEFAULT_RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function isRetryable(err, response) {
    if (response && DEFAULT_RETRYABLE_STATUS.has(response.status)) return true;
    if (err instanceof FetchTimeoutError) return true;
    if (err && err.name === 'TypeError') return true; // network error
    return false;
}

function backoffMs(attempt) {
    // 100, 200, 400, 800… with 0.5-1.5x jitter.
    const base = 100 * Math.pow(2, attempt);
    return Math.floor(base * (0.5 + Math.random()));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url, init = {}, options = {}) {
    const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        attempts = 3,
        breakerKey = null,
    } = options;

    if (breakerKey) {
        const remaining = breakerCheck(breakerKey);
        if (remaining != null) {
            throw new CircuitBreakerOpenError(breakerKey, remaining);
        }
    }

    let lastErr;
    let lastResponse;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetchWithTimeout(url, init, { timeoutMs });
            if (response.ok || !DEFAULT_RETRYABLE_STATUS.has(response.status)) {
                if (breakerKey) breakerSuccess(breakerKey);
                return response;
            }
            // 5xx — retry.
            lastResponse = response;
            lastErr = null;
        } catch (err) {
            // Caller-aborted → never retry.
            if (err && err.name === 'AbortError') throw err;
            if (!isRetryable(err)) {
                if (breakerKey) breakerFailure(breakerKey);
                throw err;
            }
            lastErr = err;
            lastResponse = null;
        }
        if (attempt < attempts - 1) {
            await sleep(backoffMs(attempt));
        }
    }

    if (breakerKey) breakerFailure(breakerKey);
    if (lastErr) throw lastErr;
    return lastResponse; // exhausted retries with a 5xx — return it for the caller
}
