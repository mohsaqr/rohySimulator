// Regression lock (security audit 2026-10-26, F-14): the server now leaves the
// JWT out of a browser's login/register response unless asked. The explicit
// `rememberToken` opt-in must therefore ask — with `X-Rohy-Auth: bearer` — and
// the default cookie mode must not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './authService.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('AuthService — bearer opt-in header', () => {
    let fetchSpy;
    beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
    afterEach(() => { fetchSpy.mockRestore(); });

    it('login with rememberToken sends X-Rohy-Auth: bearer and stores the token', async () => {
        fetchSpy.mockResolvedValueOnce(ok({ token: 'jwt-x', user: { id: 1 } }));
        await AuthService.login('alice', 'pw', { rememberToken: true });
        expect(fetchSpy.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Rohy-Auth': 'bearer' });
        expect(localStorage.getItem('token')).toBe('jwt-x');
    });

    it('register with rememberToken sends it too; the default modes send nothing extra', async () => {
        fetchSpy.mockResolvedValueOnce(ok({ token: 'jwt-y', user: { id: 2 } }));
        await AuthService.register('bob', 'bob@example.test', 'P@ssw0rdLong', { rememberToken: true });
        expect(fetchSpy.mock.calls[0][1].headers['X-Rohy-Auth']).toBe('bearer');

        fetchSpy.mockResolvedValueOnce(ok({ user: { id: 3 } }));
        await AuthService.register('carol', 'carol@example.test', 'P@ssw0rdLong');
        expect(fetchSpy.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json' });
    });
});
