import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchTimeoutError, fetchWithTimeout } from '../../server/services/fetchWithTimeout.js';

let originalFetch;
let originalEnv;
let stdoutSpy;
let stderrSpy;

beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    process.env = originalEnv;
});

function captureLogs() {
    const stdout = [];
    const stderr = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
    });
    return {
        entries() {
            return `${stdout.join('')}${stderr.join('')}`
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        }
    };
}

describe('fetchWithTimeout (audit #10)', () => {
    it('passes through a fast fetch unchanged', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
        const res = await fetchWithTimeout('https://example.com', {}, { timeoutMs: 1000 });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok');
    });

    it('throws FetchTimeoutError when the upstream is slower than timeoutMs', async () => {
        globalThis.fetch = vi.fn((_url, init) => new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'));
            });
        }));

        const start = Date.now();
        await expect(
            fetchWithTimeout('https://slow.example.com', {}, { timeoutMs: 50 })
        ).rejects.toMatchObject({
            name: 'FetchTimeoutError',
            url: 'https://slow.example.com',
            timeoutMs: 50,
        });
        // Elapsed < 1s — proves the timeout actually fired.
        expect(Date.now() - start).toBeLessThan(1000);
    });

    it('FetchTimeoutError is an Error subclass with stable shape', () => {
        const e = new FetchTimeoutError('https://x', 10);
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('FetchTimeoutError');
        expect(e.url).toBe('https://x');
        expect(e.timeoutMs).toBe(10);
        expect(e.message).toContain('https://x');
        expect(e.message).toContain('10ms');
    });

    it('forwards a caller-supplied AbortSignal — an external abort propagates', async () => {
        // CONTRACT: the caller can still cancel with their own signal.
        // The internal timeout shouldn't override that — both should
        // be wired into the same fetch.
        const ctrl = new AbortController();
        globalThis.fetch = vi.fn((_url, init) => new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'));
            });
        }));

        setTimeout(() => ctrl.abort(), 10);
        await expect(
            fetchWithTimeout('https://x', { signal: ctrl.signal }, { timeoutMs: 60_000 })
        ).rejects.toThrow();
    });

    it('does NOT throw FetchTimeoutError when caller-aborted (preserve original error type)', async () => {
        // If the caller's signal is the source of the abort, the wrapper
        // should NOT misclassify it as a timeout.
        globalThis.fetch = vi.fn((_url, init) => new Promise((_, reject) => {
            if (init?.signal?.aborted) {
                reject(new DOMException('aborted', 'AbortError'));
                return;
            }
            init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'));
            });
        }));

        const ctrl = new AbortController();
        ctrl.abort();
        try {
            await fetchWithTimeout('https://x', { signal: ctrl.signal }, { timeoutMs: 60_000 });
            throw new Error('should have rejected');
        } catch (err) {
            expect(err.name).not.toBe('FetchTimeoutError');
        }
    });

    it('cleans up the timer on success (no setTimeout leak)', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
        const spy = vi.spyOn(globalThis, 'clearTimeout');
        await fetchWithTimeout('https://x', {}, { timeoutMs: 1000 });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('emits structured outbound HTTP logs without query strings', async () => {
        process.env.LOG_FORMAT = 'json';
        process.env.LOG_LEVEL = 'debug';
        process.env.NODE_ENV = 'test';
        const cap = captureLogs();
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok', { status: 202 })));

        await fetchWithTimeout('https://example.com/path?api_key=secret', { method: 'POST' }, {
            timeoutMs: 1000,
            attempt: 2,
            breakerState: 'closed'
        });

        const logs = cap.entries().filter((entry) => entry.component === 'http-out');
        expect(logs.map((entry) => entry.msg)).toEqual([
            'outbound request started',
            'outbound request completed',
        ]);
        expect(logs[0]).toEqual(expect.objectContaining({
            level: 'debug',
            target: 'https://example.com/path',
            method: 'POST',
            attempt: 2,
            breaker_state: 'closed',
        }));
        expect(logs[1]).toEqual(expect.objectContaining({
            level: 'info',
            status: 202,
            duration_ms: expect.any(Number),
        }));
        expect(JSON.stringify(logs)).not.toContain('secret');
    });
});
