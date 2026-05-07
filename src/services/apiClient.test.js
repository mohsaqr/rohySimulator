import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiDelete, apiFetch, apiGet, apiPatch, apiPost, apiPut } from './apiClient.js';

function jsonResponse(body, init = {}) {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

function textResponse(body, init = {}) {
    return new Response(body, {
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        headers: { 'Content-Type': 'text/plain', ...(init.headers || {}) },
    });
}

describe('apiClient', () => {
    let fetchSpy;
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    beforeEach(() => {
        localStorage.clear();
        fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    describe('auth header injection', () => {
        it('attaches a fresh X-Request-Id UUID v4 to every request', async () => {
            fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));

            await apiFetch('/one');
            await apiFetch('/two');

            const first = fetchSpy.mock.calls[0][1].headers['X-Request-Id'];
            const second = fetchSpy.mock.calls[1][1].headers['X-Request-Id'];
            expect(first).toMatch(uuidV4);
            expect(second).toMatch(uuidV4);
            expect(second).not.toBe(first);
        });

        it('attaches Bearer token from localStorage by default', async () => {
            localStorage.setItem('token', 'abc.def.ghi');
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

            await apiFetch('/anything');

            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['Authorization']).toBe('Bearer abc.def.ghi');
        });

        it('omits Authorization when no token is present', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
            await apiFetch('/anything');
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['Authorization']).toBeUndefined();
        });

        it('respects auth: false (public endpoints)', async () => {
            localStorage.setItem('token', 'abc');
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
            await apiFetch('/auth/login', { auth: false });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['Authorization']).toBeUndefined();
        });

        it('lets caller override Authorization explicitly', async () => {
            localStorage.setItem('token', 'localStorage-token');
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
            await apiFetch('/x', { headers: { Authorization: 'Bearer custom' } });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['Authorization']).toBe('Bearer custom');
        });
    });

    describe('URL resolution', () => {
        it('prefixes /api for relative paths', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiFetch('/sessions');
            expect(fetchSpy.mock.calls[0][0]).toBe('/api/sessions');
        });

        it('passes absolute URLs through unchanged', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiFetch('https://example.com/x');
            expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/x');
        });

        it('rejects non-string paths', async () => {
            await expect(apiFetch(null)).rejects.toThrow(TypeError);
        });
    });

    describe('JSON body shorthand', () => {
        it('serialises json option and sets Content-Type', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
            await apiPost('/x', { a: 1 });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.method).toBe('POST');
            expect(init.headers['Content-Type']).toBe('application/json');
            expect(init.body).toBe('{"a":1}');
        });

        it('does not set Content-Type when json option is not used', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
            await apiFetch('/x', { method: 'POST', body: 'raw' });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['Content-Type']).toBeUndefined();
            expect(init.body).toBe('raw');
        });
    });

    describe('response parsing', () => {
        it('auto-parses JSON when Content-Type is application/json', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ greeting: 'hi' }, {
                headers: { 'X-Request-Id': '123e4567-e89b-42d3-a456-426614174000' },
            }));
            const data = await apiGet('/x');
            expect(data).toEqual({ greeting: 'hi' });
            expect(data.__requestId).toBe('123e4567-e89b-42d3-a456-426614174000');
            expect(Object.keys(data)).toEqual(['greeting']);
        });

        it('auto-returns text for non-JSON responses', async () => {
            fetchSpy.mockResolvedValue(textResponse('plain'));
            const data = await apiGet('/x');
            expect(data).toBe('plain');
        });

        it('returns null on 204 No Content', async () => {
            fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
            const data = await apiGet('/x');
            expect(data).toBeNull();
        });

        it('parseAs:response returns the raw Response for streaming/binary callers', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ ok: true }, {
                headers: { 'X-Request-Id': '123e4567-e89b-42d3-a456-426614174999' },
            }));
            const res = await apiFetch('/x', { parseAs: 'response' });
            expect(res).toBeInstanceOf(Response);
            expect(res.headers.get('X-Request-Id')).toBe('123e4567-e89b-42d3-a456-426614174999');
            expect(res.__requestId).toBe('123e4567-e89b-42d3-a456-426614174999');
            const body = await res.json();
            expect(body).toEqual({ ok: true });
        });

        it('parseAs:response does not throw on non-2xx — caller handles it', async () => {
            fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }));
            const res = await apiFetch('/x', { parseAs: 'response' });
            expect(res.status).toBe(500);
        });

        it('parseAs:blob returns a blob', async () => {
            fetchSpy.mockResolvedValue(new Response('xyz', { status: 200 }));
            const blob = await apiFetch('/x', { parseAs: 'blob' });
            expect(blob).toBeInstanceOf(Blob);
        });

        it('parseAs:arrayBuffer returns an ArrayBuffer', async () => {
            fetchSpy.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }));
            const buf = await apiFetch('/x', { parseAs: 'arrayBuffer' });
            expect(buf).toBeInstanceOf(ArrayBuffer);
        });
    });

    describe('error contract', () => {
        it('throws ApiError on non-2xx with status, code, body, url', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ error: 'forbidden', code: 'NO_TENANT' }, { status: 403 }));
            await expect(apiGet('/x')).rejects.toMatchObject({
                name: 'ApiError',
                status: 403,
                code: 'NO_TENANT',
                message: 'forbidden',
                url: '/api/x',
            });
        });

        it('uses HTTP_<status> code when server body lacks one', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({ error: 'nope' }, { status: 404 }));
            try {
                await apiGet('/x');
            } catch (err) {
                expect(err).toBeInstanceOf(ApiError);
                expect(err.code).toBe('HTTP_404');
                expect(err.body).toEqual({ error: 'nope' });
            }
        });

        it('handles non-JSON error bodies', async () => {
            fetchSpy.mockResolvedValue(new Response('Internal failure', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            }));
            try {
                await apiGet('/x');
            } catch (err) {
                expect(err.status).toBe(500);
                expect(err.body).toBe('Internal failure');
                expect(err.message).toBe('Internal failure');
            }
        });

        it('throws ApiError(status:0, code:NETWORK) on transport failure', async () => {
            fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
            await expect(apiGet('/x')).rejects.toMatchObject({
                name: 'ApiError',
                status: 0,
                code: 'NETWORK',
            });
        });

        it('propagates AbortError without wrapping', async () => {
            const abortErr = new DOMException('aborted', 'AbortError');
            fetchSpy.mockRejectedValue(abortErr);
            await expect(apiGet('/x')).rejects.toBe(abortErr);
        });
    });

    describe('method shortcuts', () => {
        it('apiGet uses GET', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiGet('/x');
            expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
        });

        it('apiPost uses POST and serialises body', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPost('/x', { v: 1 });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.method).toBe('POST');
            expect(init.body).toBe('{"v":1}');
        });

        it('apiPut uses PUT', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPut('/x', { v: 1 });
            expect(fetchSpy.mock.calls[0][1].method).toBe('PUT');
        });

        it('apiPatch uses PATCH', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPatch('/x', { v: 1 });
            expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
        });

        it('apiDelete uses DELETE', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiDelete('/x');
            expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
        });
    });

    describe('CSRF header (X-CSRF-Token)', () => {
        // The server sets a non-HttpOnly rohy_csrf cookie at login. apiClient
        // reads it from document.cookie and echoes it as X-CSRF-Token on
        // state-changing requests so the server's double-submit check
        // (server/middleware/csrf.js) can validate the pair.

        function setCsrfCookie(value) {
            document.cookie = `rohy_csrf=${value}; path=/`;
        }
        function clearCsrfCookie() {
            document.cookie = 'rohy_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        }

        beforeEach(() => {
            clearCsrfCookie();
        });

        it('attaches X-CSRF-Token on POST when the rohy_csrf cookie exists', async () => {
            setCsrfCookie('csrf-abc-123');
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPost('/x', { v: 1 });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['X-CSRF-Token']).toBe('csrf-abc-123');
        });

        it('attaches X-CSRF-Token on PUT/PATCH/DELETE too', async () => {
            setCsrfCookie('csrf-multi');
            // Each call needs its own Response — body is single-use.
            fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse({})));
            await apiPut('/x', { v: 1 });
            await apiPatch('/x', { v: 1 });
            await apiDelete('/x');
            for (const [, init] of fetchSpy.mock.calls) {
                expect(init.headers['X-CSRF-Token']).toBe('csrf-multi');
            }
        });

        it('does NOT attach X-CSRF-Token on GET (read methods are exempt)', async () => {
            setCsrfCookie('csrf-get-skip');
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiGet('/x');
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['X-CSRF-Token']).toBeUndefined();
        });

        it('does NOT attach X-CSRF-Token when the cookie is absent', async () => {
            // No setCsrfCookie call.
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPost('/x', { v: 1 });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['X-CSRF-Token']).toBeUndefined();
        });

        it('does NOT attach X-CSRF-Token when auth:false (public endpoint)', async () => {
            setCsrfCookie('csrf-public-skip');
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPost('/auth/login', { username: 'u', password: 'p' }, { auth: false });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['X-CSRF-Token']).toBeUndefined();
        });

        it('decodes URL-encoded cookie values', async () => {
            setCsrfCookie(encodeURIComponent('weird value/=='));
            fetchSpy.mockResolvedValue(jsonResponse({}));
            await apiPost('/x', { v: 1 });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.headers['X-CSRF-Token']).toBe('weird value/==');
        });
    });

    describe('signal forwarding', () => {
        it('passes AbortSignal through to fetch', async () => {
            fetchSpy.mockResolvedValue(jsonResponse({}));
            const ctrl = new AbortController();
            await apiFetch('/x', { signal: ctrl.signal });
            const [, init] = fetchSpy.mock.calls[0];
            expect(init.signal).toBe(ctrl.signal);
        });
    });
});
