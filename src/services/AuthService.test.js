// CONTRACT tests for AuthService (src/services/authService.js).
//
// Locks the public surface that consumers (LoginScreen, route guards,
// fetch wrappers, etc.) rely on. The localStorage stub from
// tests/setup.js auto-resets between every `it()`, so individual cases
// don't need to clean up token state.
//
// We stub global `fetch` per-test rather than using MSW. fetch is the
// only IO this module performs, and a vi.spyOn lets us assert exact
// URLs, headers, and bodies — which IS the contract we want to lock.
//
// CONTRACT covered:
//   1. login()         — POSTs JSON to /api/auth/login, persists token, throws on failure paths
//   2. register()      — POSTs JSON to /api/auth/register, persists token, throws on failure
//   3. verifyToken()   — sends Bearer auth, returns user, clears token on 401/network error
//   4. getProfile()    — sends Bearer auth, returns user, throws on !ok
//   5. logout()        — clears 'token' from localStorage
//   6. getToken()      — reads 'token' from localStorage
//   7. authHeaders()   — returns { Authorization: 'Bearer <t>' } when token present, {} otherwise
//   8. isAuthenticated() — boolean form of token-presence check

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService } from './authService.js';

// Helper: build a fake fetch Response with .ok, .json(), .text() shaped
// to match what AuthService consumes. login() reads .text() then
// JSON.parses it; the others call .json() directly.
function makeResponse({ ok = true, status = 200, body = {}, raw = null } = {}) {
    const text = raw !== null ? raw : JSON.stringify(body);
    return {
        ok,
        status,
        json: async () => JSON.parse(text),
        text: async () => text,
    };
}

let fetchSpy;

beforeEach(() => {
    // Fresh fetch stub per test. clearMocks/restoreMocks in vitest config
    // means we must (re)install the spy here, not in a top-level scope.
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    delete globalThis.fetch;
});

describe('AuthService.login', () => {
    it('POSTs JSON to /api/auth/login with username + password and stores token on success', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: true,
            body: { token: 'jwt-abc', user: { id: 1, username: 'alice' } },
        }));

        const result = await AuthService.login('alice', 'hunter2');

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toContain('/api/auth/login');
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(init.body)).toEqual({ username: 'alice', password: 'hunter2' });

        expect(localStorage.getItem('token')).toBe('jwt-abc');
        expect(result).toEqual({ token: 'jwt-abc', user: { id: 1, username: 'alice' } });
    });

    it('throws a friendly connection error when fetch rejects (server unreachable)', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

        await expect(AuthService.login('alice', 'pw')).rejects.toThrow(
            /Cannot connect to server/i,
        );
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('throws when the server returns an empty body', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({ ok: true, raw: '' }));

        await expect(AuthService.login('alice', 'pw')).rejects.toThrow(
            /empty response/i,
        );
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('throws an "Invalid server response" error when body is not JSON', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({ ok: true, raw: '<html>nope</html>' }));

        await expect(AuthService.login('alice', 'pw')).rejects.toThrow(
            /Invalid server response/i,
        );
    });

    it('throws the server-provided error message on a 4xx response', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: false,
            status: 401,
            body: { error: 'Bad credentials' },
        }));

        await expect(AuthService.login('alice', 'wrong')).rejects.toThrow('Bad credentials');
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('falls back to "Login failed" when the server omits an error message', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: false,
            status: 500,
            body: {},
        }));

        await expect(AuthService.login('alice', 'pw')).rejects.toThrow('Login failed');
    });

    it('does not write a token when the success body omits one', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: true,
            body: { user: { id: 1 } }, // no token field
        }));

        const result = await AuthService.login('alice', 'pw');
        expect(result).toEqual({ user: { id: 1 } });
        expect(localStorage.getItem('token')).toBeNull();
    });
});

describe('AuthService.register', () => {
    it('POSTs username/email/password JSON and stores token on success', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: true,
            body: { token: 'reg-token', user: { id: 7 } },
        }));

        const data = await AuthService.register('bob', 'b@x.com', 'pw');

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toContain('/api/auth/register');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            username: 'bob',
            email: 'b@x.com',
            password: 'pw',
        });

        expect(localStorage.getItem('token')).toBe('reg-token');
        expect(data.user).toEqual({ id: 7 });
    });

    it('throws server-provided error on failure and does not write token', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: false,
            status: 409,
            body: { error: 'Username taken' },
        }));

        await expect(AuthService.register('bob', 'b@x.com', 'pw')).rejects.toThrow('Username taken');
        expect(localStorage.getItem('token')).toBeNull();
    });
});

describe('AuthService.verifyToken', () => {
    it('returns null without hitting the network when no token is stored', async () => {
        const result = await AuthService.verifyToken();
        expect(result).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends Authorization: Bearer <token> and returns the user from the response', async () => {
        localStorage.setItem('token', 'tok-123');
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: true,
            body: { user: { id: 42, username: 'carol' } },
        }));

        const user = await AuthService.verifyToken();

        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toContain('/api/auth/verify');
        expect(init.headers).toEqual({ Authorization: 'Bearer tok-123' });
        expect(user).toEqual({ id: 42, username: 'carol' });
        // Token must remain on success.
        expect(localStorage.getItem('token')).toBe('tok-123');
    });

    it('clears the stored token and returns null when the server says the token is invalid', async () => {
        localStorage.setItem('token', 'expired');
        fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 401, body: {} }));

        const user = await AuthService.verifyToken();

        expect(user).toBeNull();
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('clears the token and returns null when fetch throws (network error)', async () => {
        localStorage.setItem('token', 'tok-net');
        fetchSpy.mockRejectedValueOnce(new TypeError('network down'));

        const user = await AuthService.verifyToken();

        expect(user).toBeNull();
        expect(localStorage.getItem('token')).toBeNull();
    });
});

describe('AuthService.getProfile', () => {
    it('returns null without calling fetch when there is no token', async () => {
        const profile = await AuthService.getProfile();
        expect(profile).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends Bearer token and returns the user payload on success', async () => {
        localStorage.setItem('token', 'tok-profile');
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: true,
            body: { user: { id: 9, username: 'dora' } },
        }));

        const user = await AuthService.getProfile();

        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toContain('/api/auth/profile');
        expect(init.headers).toEqual({ Authorization: 'Bearer tok-profile' });
        expect(user).toEqual({ id: 9, username: 'dora' });
    });

    it('throws "Failed to fetch profile" when the response is not ok', async () => {
        localStorage.setItem('token', 'tok-profile');
        fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 500, body: {} }));

        await expect(AuthService.getProfile()).rejects.toThrow('Failed to fetch profile');
        // getProfile does NOT clear the token on failure (unlike verifyToken).
        // Locking that asymmetry intentionally — callers rely on it.
        expect(localStorage.getItem('token')).toBe('tok-profile');
    });
});

describe('AuthService.logout / getToken / isAuthenticated / authHeaders', () => {
    it('logout() removes the token from localStorage', () => {
        localStorage.setItem('token', 'will-be-cleared');
        AuthService.logout();
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('logout() is a no-op when no token is stored', () => {
        expect(() => AuthService.logout()).not.toThrow();
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('getToken() returns the stored token, or null when none', () => {
        expect(AuthService.getToken()).toBeNull();
        localStorage.setItem('token', 'visible');
        expect(AuthService.getToken()).toBe('visible');
    });

    it('isAuthenticated() reflects token presence as a boolean', () => {
        expect(AuthService.isAuthenticated()).toBe(false);
        localStorage.setItem('token', 'present');
        expect(AuthService.isAuthenticated()).toBe(true);
    });

    it('authHeaders() returns {} when no token is stored', () => {
        expect(AuthService.authHeaders()).toEqual({});
    });

    it('authHeaders() returns { Authorization: "Bearer <token>" } when a token is stored', () => {
        localStorage.setItem('token', 'tok-xyz');
        expect(AuthService.authHeaders()).toEqual({ Authorization: 'Bearer tok-xyz' });
    });
});
