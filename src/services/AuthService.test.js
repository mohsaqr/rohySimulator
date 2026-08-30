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
//   3. verifyToken()   — sends Bearer auth, returns user; null + token cleared on
//                        definitive rejection; THROWS (token kept) on network error
//   4. logout()        — clears 'token' from localStorage
//   5. getToken()      — reads 'token' from localStorage
//   6. authHeaders()   — returns { Authorization: 'Bearer <t>' } when token present, {} otherwise
//   7. isAuthenticated() — boolean form of token-presence check
//
// getProfile() was removed in the F-013 fix — it was localStorage-only in
// a cookie-auth world and had no production callers. Use apiGet('/auth/verify').

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

// Regression lock: login()/register() used to throw a bare
// `new Error(data.error)`, discarding the HTTP status and the server's
// machine-readable `code` — which forced the auth pages to translate
// failures by matching English message literals. The thrown error now
// carries {status, code, body}.
describe('AuthService error contract — status and code ride on the throw', () => {
    it('login failure exposes status, code and body', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: false,
            status: 401,
            body: { error: 'Invalid credentials', code: 'invalid_credentials' },
        }));
        const err = await AuthService.login('u', 'wrong').catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(401);
        expect(err.code).toBe('invalid_credentials');
        expect(err.body).toEqual({ error: 'Invalid credentials', code: 'invalid_credentials' });
    });

    it('register failure exposes status, code and body', async () => {
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: false,
            status: 403,
            body: { error: 'Registration is closed', code: 'registration_closed' },
        }));
        const err = await AuthService.register('u', 'u@example.test', 'P@ssw0rd!Long').catch((e) => e);
        expect(err.status).toBe(403);
        expect(err.code).toBe('registration_closed');
    });
});

describe('AuthService.login', () => {
    it('POSTs JSON to /api/auth/login and does NOT write localStorage by default (cookie-mode flag day)', async () => {
        // Flag-day contract: cookie auth carries the session, so login no
        // longer writes localStorage by default. The server still includes
        // the token in the body for backwards compat / explicit use.
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

        // The localStorage token slot stays empty — auth rides the cookie.
        expect(localStorage.getItem('token')).toBeNull();
        expect(result).toEqual({ token: 'jwt-abc', user: { id: 1, username: 'alice' } });
    });

    it('opts back into bearer mode when rememberToken: true is passed', async () => {
        // Explicit cross-origin callers / tests that need bearer-mode auth
        // can still get it via the documented opt-in flag.
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: true,
            body: { token: 'jwt-bear', user: { id: 1 } },
        }));

        await AuthService.login('alice', 'pw', { rememberToken: true });
        expect(localStorage.getItem('token')).toBe('jwt-bear');
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
    it('POSTs username/email/password JSON and does NOT write localStorage by default', async () => {
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

        // Flag-day: register no longer writes localStorage by default.
        expect(localStorage.getItem('token')).toBeNull();
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
    it('hits /auth/verify even when no localStorage token is present (cookie-mode)', async () => {
        // Flag-day: cookie-mode clients have no localStorage token, but
        // the verify call must still fire so the cookie is exercised.
        // The server returns null (or 401) when no auth is present;
        // verifyToken returns null in that case.
        fetchSpy.mockResolvedValueOnce(makeResponse({
            ok: false, status: 401, body: { error: 'Access token required' },
        }));
        const result = await AuthService.verifyToken();
        expect(result).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
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

    // Regression lock: verifyToken treated EVERY non-2xx as a definitive auth
    // rejection — deleting the token and returning null. But 429/502/503/504
    // are transient server answers: a rate-limit burst or a rolling deploy
    // landing on /auth/verify silently logged every open tab out mid-case
    // (observed live in the 2026-08-30 e2e run: three 429s on verify wiped
    // otherwise-healthy sessions). Transient statuses must THROW like a
    // network failure so the caller's retry branch handles them.
    it.each([429, 502, 503, 504])('throws (and keeps the token) on transient HTTP %i', async (status) => {
        localStorage.setItem('token', 'tok-alive');
        fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status, body: {} }));

        await expect(AuthService.verifyToken()).rejects.toThrow(String(status));
        expect(localStorage.getItem('token')).toBe('tok-alive');
    });

    it('403 is still a definitive rejection: token cleared, null returned', async () => {
        localStorage.setItem('token', 'revoked');
        fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 403, body: {} }));

        const user = await AuthService.verifyToken();
        expect(user).toBeNull();
        expect(localStorage.getItem('token')).toBeNull();
    });

    // Regression lock: verifyToken used to swallow network errors into the
    // same null as a real rejection AND delete the token — so a wifi blip
    // read as "logged out", while AuthContext's verify-before-logout branch
    // (which expected a throw) was dead code and revoked sessions kept a
    // zombie UI (Codex adversarial review of v2.9.20).
    it('THROWS on network error and keeps the stored token', async () => {
        localStorage.setItem('token', 'tok-net');
        fetchSpy.mockRejectedValueOnce(new TypeError('network down'));

        await expect(AuthService.verifyToken()).rejects.toThrow();
        expect(localStorage.getItem('token')).toBe('tok-net');
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
