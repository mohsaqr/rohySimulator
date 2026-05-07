import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CircuitBreakerOpenError,
    FetchTimeoutError,
    _resetBreakerForTest,
    fetchWithRetry,
    getBreakerState,
} from '../../server/services/fetchWithTimeout.js';

let originalFetch;

beforeEach(() => {
    originalFetch = globalThis.fetch;
    _resetBreakerForTest();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetBreakerForTest();
});

describe('fetchWithRetry — happy path', () => {
    it('returns the response on first success', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
        const res = await fetchWithRetry('https://x', {}, { attempts: 3 });
        expect(res.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 4xx (caller error)', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('nope', { status: 404 })));
        const res = await fetchWithRetry('https://x', {}, { attempts: 3 });
        expect(res.status).toBe(404);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});

describe('fetchWithRetry — retry on transient failures', () => {
    it('retries on 503 and returns the 200 from a later attempt', async () => {
        let n = 0;
        globalThis.fetch = vi.fn(() => {
            n += 1;
            if (n < 3) return Promise.resolve(new Response('busy', { status: 503 }));
            return Promise.resolve(new Response('ok', { status: 200 }));
        });
        const res = await fetchWithRetry('https://x', {}, { attempts: 3 });
        expect(res.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('retries on a network TypeError', async () => {
        let n = 0;
        globalThis.fetch = vi.fn(() => {
            n += 1;
            if (n === 1) return Promise.reject(new TypeError('Failed to fetch'));
            return Promise.resolve(new Response('ok', { status: 200 }));
        });
        const res = await fetchWithRetry('https://x', {}, { attempts: 3 });
        expect(res.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('exhausts attempts and returns the last 5xx response', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('busy', { status: 503 })));
        const res = await fetchWithRetry('https://x', {}, { attempts: 3 });
        expect(res.status).toBe(503);
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('does not retry when the caller aborts', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError')));
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(
            fetchWithRetry('https://x', { signal: ctrl.signal }, { attempts: 3 }),
        ).rejects.toThrow();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});

describe('fetchWithRetry — circuit breaker', () => {
    it('opens after 5 consecutive failures and fails fast on the 6th', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('busy', { status: 503 })));
        // 5 calls each exhaust their attempts (3) → 5 failures → breaker opens.
        for (let i = 0; i < 5; i++) {
            await fetchWithRetry('https://x', {}, { attempts: 1, breakerKey: 'test-svc' });
        }
        expect(getBreakerState('test-svc').state).toBe('open');

        const fetchCallsBefore = globalThis.fetch.mock.calls.length;
        await expect(
            fetchWithRetry('https://x', {}, { attempts: 1, breakerKey: 'test-svc' }),
        ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
        // Fast-fail: no fetch was made.
        expect(globalThis.fetch.mock.calls.length).toBe(fetchCallsBefore);
    });

    it('separate breaker keys do not share state', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('busy', { status: 503 })));
        for (let i = 0; i < 5; i++) {
            await fetchWithRetry('https://x', {}, { attempts: 1, breakerKey: 'svc-a' });
        }
        expect(getBreakerState('svc-a').state).toBe('open');
        expect(getBreakerState('svc-b').state).toBe('closed');
    });

    it('a successful call closes the breaker (resets failure count)', async () => {
        let n = 0;
        globalThis.fetch = vi.fn(() => {
            n += 1;
            if (n <= 2) return Promise.resolve(new Response('busy', { status: 503 }));
            return Promise.resolve(new Response('ok', { status: 200 }));
        });
        await fetchWithRetry('https://x', {}, { attempts: 1, breakerKey: 'svc-c' });
        await fetchWithRetry('https://x', {}, { attempts: 1, breakerKey: 'svc-c' });
        expect(getBreakerState('svc-c').failures).toBe(2);
        // Third call succeeds.
        const ok = await fetchWithRetry('https://x', {}, { attempts: 1, breakerKey: 'svc-c' });
        expect(ok.status).toBe(200);
        expect(getBreakerState('svc-c').failures).toBe(0);
        expect(getBreakerState('svc-c').state).toBe('closed');
    });
});
