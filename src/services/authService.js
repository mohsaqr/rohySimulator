
import { apiUrl } from '../config/api';

// Flag-day note: as of this commit, login/register no longer write the JWT
// to localStorage by default. The HttpOnly rohy_auth cookie carries auth;
// CSRF protection is enforced via the rohy_csrf double-submit pair.
//
// Backwards compatibility: any browser that already has a localStorage
// token from before this change keeps working — apiClient still sends it
// as Authorization: Bearer if present, and verifyToken() still picks it up.
// Once that legacy token expires (4h JWT TTL), the next login goes through
// the cookie-only path and localStorage stays clean.
//
// Tests / explicit cross-origin callers can opt back into bearer mode by
// passing { rememberToken: true } to login/register.

export const AuthService = {
    async register(username, email, password, { rememberToken = false } = {}) {
        const response = await fetch(apiUrl(`/auth/register`), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
        }

        if (rememberToken && data.token) {
            localStorage.setItem('token', data.token);
        }

        return data;
    },

    async login(username, password, { rememberToken = false } = {}) {
        let response;
        try {
            response = await fetch(apiUrl(`/auth/login`), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
        } catch (err) {
            throw new Error('Cannot connect to server. Is the backend running?');
        }

        const text = await response.text();
        if (!text) {
            throw new Error('Server returned empty response. Check if backend is running on port 4000.');
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            throw new Error(`Invalid server response: ${text.substring(0, 100)}`);
        }

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        if (rememberToken && data.token) {
            localStorage.setItem('token', data.token);
        }

        return data;
    },

    // Verify the current session. Cookie-mode clients send the rohy_auth
    // cookie via credentials:'same-origin'; legacy bearer-mode clients
    // send Authorization: Bearer if they still have a localStorage token.
    // Either path returns the user record on success.
    async verifyToken() {
        const legacyToken = localStorage.getItem('token');
        const headers = legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {};
        try {
            const response = await fetch(apiUrl(`/auth/verify`), {
                credentials: 'same-origin',
                headers,
            });

            if (!response.ok) {
                if (legacyToken) localStorage.removeItem('token');
                return null;
            }

            const data = await response.json();
            return data.user;
        } catch (error) {
            if (legacyToken) localStorage.removeItem('token');
            return null;
        }
    },

    // Get current user profile
    async getProfile() {
        const token = localStorage.getItem('token');
        if (!token) return null;

        const response = await fetch(apiUrl(`/auth/profile`), {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch profile');
        }

        const data = await response.json();
        return data.user;
    },

    // Refresh the current session's JWT. The server rotates the
    // active_sessions row server-side; on the client, if there's a
    // legacy bearer-mode tab, we update its localStorage token too.
    // Returns the parsed body on success, null on failure.
    async refreshToken() {
        const existing = localStorage.getItem('token');
        try {
            // CSRF: refresh is a state-changing POST under cookie auth, so
            // the server's double-submit check applies. Read the rohy_csrf
            // cookie if present and echo it as the header. Cookie-only
            // clients always have it; bearer-only clients don't (and don't
            // need it — bearer requests skip the CSRF check).
            const headers = existing
                ? { Authorization: `Bearer ${existing}` }
                : {};
            try {
                if (typeof document !== 'undefined' && document.cookie) {
                    for (const pair of document.cookie.split(';')) {
                        const eq = pair.indexOf('=');
                        if (eq === -1) continue;
                        const k = pair.slice(0, eq).trim();
                        if (k === 'rohy_csrf') {
                            headers['X-CSRF-Token'] = decodeURIComponent(pair.slice(eq + 1).trim());
                            break;
                        }
                    }
                }
            } catch { /* ignore — cookie read is best-effort */ }

            const response = await fetch(apiUrl('/auth/refresh'), {
                method: 'POST',
                credentials: 'same-origin',
                headers,
            });
            if (!response.ok) return null;
            const data = await response.json();
            if (data?.token && existing) {
                // Bearer-mode tabs keep working — refresh the stored token.
                // Cookie-mode tabs ignore this; the cookie was already set
                // by the server in the same response.
                localStorage.setItem('token', data.token);
            }
            return data;
        } catch {
            return null;
        }
    },

    // Logout
    logout() {
        localStorage.removeItem('token');
    },

    // Get token
    getToken() {
        return localStorage.getItem('token');
    },

    // Authorization header bag for fetch(). Spread into a headers object.
    authHeaders() {
        const t = localStorage.getItem('token');
        return t ? { Authorization: `Bearer ${t}` } : {};
    },

    // Check if user is authenticated
    isAuthenticated() {
        return !!localStorage.getItem('token');
    }
};
