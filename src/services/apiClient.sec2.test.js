// Lane A handoff (security audit 2026-10-26, F-13): the CSRF token is now bound
// to the session. A tab holding a pre-binding token gets 403 `csrf_stale` plus
// a Set-Cookie carrying the bound token; apiFetch re-sends the request ONCE.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiPost } from './apiClient.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});
const setCsrfCookie = (v) => { document.cookie = `rohy_csrf=${v}; path=/`; };

describe('csrf_stale', () => {
    let fetchSpy;
    beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); setCsrfCookie('old-unbound'); });
    afterEach(() => { fetchSpy.mockRestore(); document.cookie = 'rohy_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });

    // Regression lock: an open tab with a pre-binding CSRF token failed every save after the deploy.
    it('re-sends once with the healed cookie and returns the second answer', async () => {
        fetchSpy
            .mockImplementationOnce(() => { setCsrfCookie('bound-new'); return Promise.resolve(json({ error: 'stale', code: 'csrf_stale' }, 403)); })
            .mockImplementationOnce(() => Promise.resolve(json({ ok: true })));
        await expect(apiPost('/notes', { a: 1 })).resolves.toEqual({ ok: true });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls[0][1].headers['X-CSRF-Token']).toBe('old-unbound');
        expect(fetchSpy.mock.calls[1][1].headers['X-CSRF-Token']).toBe('bound-new');
        expect(fetchSpy.mock.calls[1][1].body).toBe(JSON.stringify({ a: 1 }));
    });

    it('does not loop when the cookie did not change', async () => {
        fetchSpy.mockResolvedValue(json({ error: 'stale', code: 'csrf_stale' }, 403));
        await expect(apiPost('/notes', {})).rejects.toMatchObject({ status: 403, code: 'csrf_stale' });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves other 403s and GETs alone', async () => {
        fetchSpy.mockImplementation(() => { setCsrfCookie('changed'); return Promise.resolve(json({ error: 'no', code: 'forbidden' }, 403)); });
        await expect(apiPost('/x', {})).rejects.toMatchObject({ status: 403, code: 'forbidden' });
        await expect(apiFetch('/y')).rejects.toMatchObject({ status: 403 });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
});
