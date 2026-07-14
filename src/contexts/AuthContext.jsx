import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthService } from '../services/authService';
import { apiPost } from '../services/apiClient';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is already logged in on mount
        const verifyUser = async () => {
            try {
                const userData = await AuthService.verifyToken();
                setUser(userData);
            } catch (error) {
                console.error('Token verification failed:', error);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };

        verifyUser();
    }, []);

    // JWT refresh scheduling.
    //
    // Pre-fix this used a hardcoded 3h setInterval, which broke for any
    // user whose tab was active longer than the 4h JWT TTL: the first
    // tick fired AFTER the token had already expired, every API call
    // 403'd with "Invalid or expired token" in between, and the user saw
    // a "no cases / no users / no analytics" screen until they manually
    // re-logged-in. Reported 2026-05-07.
    //
    // The fix decodes the JWT's `exp` claim and schedules the FIRST
    // refresh for (exp - now - 5min) — i.e. five minutes before expiry,
    // regardless of when the user mounted the app. After a successful
    // refresh, we re-decode the new token's exp and schedule again.
    // If the exp claim can't be read (legacy token, malformed payload),
    // we fall back to a conservative 30 minutes.
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        let timer = null;

        const decodeJwtExp = (token) => {
            try {
                const payload = token.split('.')[1];
                const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
                const json = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
                return Number.isFinite(json.exp) ? json.exp * 1000 : null;
            } catch (err) {
                console.warn('[auth] failed to decode JWT exp claim, using fallback refresh interval', err);
                return null;
            }
        };

        const computeDelay = () => {
            const token = AuthService.getToken();
            const FALLBACK_MS = 30 * 60 * 1000; // 30 min
            const SAFETY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
            const MIN_DELAY_MS = 5 * 1000; // never schedule sooner than 5s
            if (!token) return FALLBACK_MS;
            const expMs = decodeJwtExp(token);
            if (!expMs) return FALLBACK_MS;
            const delay = expMs - Date.now() - SAFETY_BUFFER_MS;
            return Math.max(MIN_DELAY_MS, delay);
        };

        const tick = async () => {
            if (cancelled) return;
            const result = await AuthService.refreshToken();
            if (cancelled) return;
            if (!result) {
                AuthService.logout();
                setUser(null);
                return;
            }
            // Schedule the next refresh based on the freshly-issued token.
            timer = setTimeout(tick, computeDelay());
        };

        // First refresh fires based on the existing token's exp.
        timer = setTimeout(tick, computeDelay());
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [user]);

    const login = async (username, password) => {
        const data = await AuthService.login(username, password);
        setUser(data.user);
        return data;
    };

    // `extra` carries the invite token when one was used. Guarded setUser because
    // a future approval-mode registration answers 202 with NO user and NO token —
    // setUser(undefined) there would log the caller into a ghost session.
    const register = async (username, email, password, extra = {}) => {
        const data = await AuthService.register(username, email, password, extra);
        if (data?.user) setUser(data.user);
        return data;
    };

    const logout = async () => {
        // Always hit /auth/logout — the server needs to revoke the
        // active_sessions row and clear the HttpOnly rohy_auth cookie.
        // Cookie-only users have no localStorage token, so a token-gated
        // call (the pre-F-003 shape) silently skipped the server side and
        // left the cookie alive: refresh would re-authenticate, and on a
        // shared machine a second user could resume the prior session.
        // apiPost rides credentials:'include' so the cookie path still works.
        try {
            await apiPost('/auth/logout');
        } catch (error) {
            console.error('Failed to log logout:', error);
        }

        // Logout is an explicit exit (per the persistence rule), so we
        // wipe the per-user session/view/chat blobs. Without this,
        // logging out and back in as the same user — or as a different
        // user on a shared machine — would silently restore the prior
        // user's case, view, and chat into the new login.
        try {
            localStorage.removeItem('rohy_active_session');
            localStorage.removeItem('rohy_chat_history');
            localStorage.removeItem('rohy_view');
            // Per-session debrief keys are tagged with the session id; we
            // don't have it in scope here, but they'll be overwritten on
            // the next session and never read without a matching active
            // session anyway, so they self-prune.
        } catch (e) {
            console.warn('[Auth] failed to clear local session state on logout:', e.message);
        }

        AuthService.logout();
        setUser(null);
    };

    const isAdmin = () => {
        return user?.role === 'admin';
    };

    const value = {
        user,
        loading,
        login,
        register,
        logout,
        isAdmin,
        isAuthenticated: !!user
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
